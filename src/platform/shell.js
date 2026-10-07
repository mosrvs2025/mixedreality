// Roomspace shell: everything apps share.
//
//   shell.input      head, hands, every fingertip, poke points  (see input.js)
//   shell.room       the scanned room: occluders, light & ripple shader, raycasts
//   shell.audio      synthesized, spatial audio
//   shell.particles / sky / glowTex   shared effects
//   shell.session / frame / refSpace  the live WebXR session (null on desktop)
//   shell.pointer    the mouse ray in the desktop preview (null in a headset)
//
// An app is { id, name, tagline, kind, color, paint(), create(shell) } where
// create() returns { root, mount(now), update(dt, now), unmount(), onSelect?() }.
import * as THREE from 'three';
import { Room } from '../core/room.js';
import { Particles, Sky, Label, makeGlowTexture } from '../core/fx.js';
import { AudioEngine } from '../core/audio.js';
import { Input } from './input.js';
import { Sim } from './sim.js';
import { Launcher } from './launcher.js';
import { HomeOrb } from './home.js';
import { disposeTree } from './ui.js';
import { APPS } from './apps.js';

const BASE_FEATURES = ['hand-tracking', 'hit-test', 'plane-detection', 'mesh-detection', 'anchors', 'bounded-floor'];
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _n = new THREE.Vector3();

export class Shell {
  constructor({ onEnd } = {}) {
    this.onEnd = onEnd || (() => {});
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(0.5);
    renderer.domElement.id = 'gl';
    document.body.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 100);
    this.camera.position.set(0, 1.6, 1.4);
    this.camera.rotation.order = 'YXZ';

    this.glowTex = makeGlowTexture();
    this.room = new Room(this.scene);
    this.particles = new Particles(this.scene);
    this.sky = new Sky(this.scene);
    this.audio = new AudioEngine();
    this.input = new Input();

    this.mode = 'landing'; // landing | xr | sim
    this.session = null;
    this.frame = null;
    this.refSpace = null;
    this.pointer = null;
    this.bounds = null;
    this.boundedSpace = null;
    this.hitSources = [];
    this.frameNo = 0;
    this.last = performance.now() / 1000;

    this.apps = APPS;
    this.appDef = null;
    this.app = null;
    this.simulator = new Sim(this);
    this.launcher = new Launcher(this, this.apps);
    this.home = new HomeOrb(this);

    this.debug = new URLSearchParams(location.search).has('debug');
    this.debugLabel = this.debug ? new Label(this.scene, { width: 0.5, px: 1024, aspect: 0.7, order: 60 }) : null;
    this.dbgTimer = 0;
    this.dbgFrames = 0;

    renderer.setAnimationLoop((t, frame) => this.tick(frame));
    window.addEventListener('resize', () => {
      if (renderer.xr.isPresenting) return; // the headset owns the size
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // True in the desktop preview (apps branch on this for mouse/keyboard input).
  get sim() {
    return this.mode === 'sim';
  }

  get depthActive() {
    return this.renderer.xr.isPresenting && this.renderer.xr.hasDepthSensing();
  }

  // ---- sessions -------------------------------------------------------------

  async requestARSession() {
    // Depth sensing lets real hands, people and pets hide virtual things. Some
    // runtimes reject a session whose depth preferences they can't meet.
    try {
      return await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: [...BASE_FEATURES, 'depth-sensing'],
        depthSensing: { usagePreference: ['gpu-optimized'], dataFormatPreference: ['float32', 'luminance-alpha', 'unsigned-short'] },
      });
    } catch (e) {
      console.warn('Session with depth sensing failed, retrying without', e);
      return navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: BASE_FEATURES });
    }
  }

  async startXR(openApp = null) {
    this.audio.init();
    this.audio.resume();
    const session = await this.requestARSession();
    // three.js reads depth through the WebXR Layers binding; on a runtime that
    // grants depth-sensing without layers that would throw every frame, so
    // hide the feature from three there (we just lose real-world occlusion).
    const feats = session.enabledFeatures;
    if (feats?.includes('depth-sensing') && session.renderState.layers === undefined) {
      const kept = feats.filter((f) => f !== 'depth-sensing');
      try {
        Object.defineProperty(session, 'enabledFeatures', { get: () => kept, configurable: true });
      } catch (e) {
        console.warn('Could not mask depth-sensing', e);
      }
    }
    this.session = session;
    this.mode = 'xr';
    this.room.clearAll();
    this.input.reset();
    document.body.classList.add('playing');
    await this.renderer.xr.setSession(session);

    session.addEventListener('selectstart', (e) => {
      const h = this.input.handBySource.get(e.inputSource);
      // A bare-hand pinch with the palm turned toward your face is Meta's system
      // menu gesture, so never treat it as a select. (Fist = our hand gesture.)
      if (e.inputSource.hand && (!h || h.facingHead)) return;
      this.select(h ? h.pos.clone() : this.input.head.clone().add(new THREE.Vector3(0, -0.3, 0)), e.inputSource);
    });
    session.addEventListener('end', () => this.onSessionEnd());

    // A fan of hit-test rays: even without Space Setup, we learn real surfaces
    // wherever the player looks.
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      for (const [x, y] of [[0, 0], [-0.35, 0], [0.35, 0], [0, -0.35], [0, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.6, -0.2], [0.6, -0.2]]) {
        const offsetRay = new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x, y, z: -1, w: 0 });
        this.hitSources.push(await session.requestHitTestSource({ space: viewer, offsetRay }));
      }
    } catch {
      /* hit-test unavailable: planes/meshes or floating content still work */
    }
    // The guardian boundary: apps keep things within reach from inside it.
    try {
      const b = await session.requestReferenceSpace('bounded-floor');
      this.boundedSpace = b.boundsGeometry && b.boundsGeometry.length >= 3 ? b : null;
    } catch {
      this.boundedSpace = null;
    }

    this.goHome(true);
    if (openApp) this.open(openApp);
  }

  startSim(openApp = null) {
    this.audio.init();
    this.audio.resume();
    this.mode = 'sim';
    this.input.reset();
    document.body.classList.add('playing', 'sim');
    this.simulator.start();
    this.goHome(true);
    if (openApp) this.open(openApp);
  }

  onSessionEnd() {
    const summary = this.app?.summary?.() || '';
    this.closeApp();
    this.launcher.hide();
    this.session = null;
    this.hitSources = [];
    this.boundedSpace = null;
    this.bounds = null;
    this.mode = 'landing';
    this.frame = null;
    document.body.classList.remove('playing');
    this.onEnd(summary);
  }

  exit() {
    if (this.mode === 'xr') this.session?.end();
    else if (this.mode === 'sim') {
      this.closeApp();
      this.launcher.hide();
      this.simulator.stop();
      this.pointer = null;
      this.mode = 'landing';
      document.body.classList.remove('playing', 'sim');
      this.onEnd('');
    }
  }

  // ---- apps -----------------------------------------------------------------

  open(id) {
    const def = this.apps.find((a) => a.id === id && !a.soon);
    if (!def) return;
    this.closeApp();
    this.launcher.hide();
    this.appDef = def;
    this.app = def.create(this);
    this.scene.add(this.app.root);
    this.app.mount(performance.now() / 1000);
    this.home.show();
    this.audio.ui('open');
    this.setSimHelp(def.simHelp);
  }

  // The desktop preview's help strip changes with what's on screen.
  setSimHelp(text) {
    const el = document.getElementById('simhelp');
    if (el) el.textContent = text || 'Desktop preview · drag to look · WASD to walk · click a card to open it · Esc to leave';
  }

  closeApp() {
    if (!this.app) return;
    try {
      this.app.unmount();
    } finally {
      disposeTree(this.app.root);
      this.app = null;
      this.appDef = null;
      this.room.clearEffects();
      this.sky.set(0, 0, 0, 0);
    }
  }

  goHome(silent = false) {
    this.closeApp();
    this.launcher.show();
    this.setSimHelp(null);
    if (!silent) this.audio.ui('back');
  }

  // A select gesture/click from the player: trigger, palm-away pinch, Space.
  select(pos, source) {
    this.app?.onSelect?.(pos, performance.now() / 1000, source);
  }

  haptic(source, intensity = 0.4, ms = 40) {
    const act = source?.gamepad?.hapticActuators?.[0];
    act?.pulse?.(intensity, ms);
  }

  makeLabel(parent, opts) {
    return new Label(parent || this.scene, opts);
  }

  // ---- per-frame ------------------------------------------------------------

  readXRServices(frame, refSpace) {
    this.room.updateFromFrame(frame, refSpace);
    if (this.frameNo % 3 === 0) {
      for (const src of this.hitSources) {
        const r = frame.getHitTestResults(src)[0];
        const hp = r?.getPose(refSpace);
        if (!hp) continue;
        _p.set(hp.transform.position.x, hp.transform.position.y, hp.transform.position.z);
        const o = hp.transform.orientation;
        _n.set(0, 1, 0).applyQuaternion(_q.set(o.x, o.y, o.z, o.w));
        this.room.addHitPoint(_p, _n);
      }
    }
    if (this.frameNo % 30 === 0 && this.boundedSpace) {
      const pose = frame.getPose(this.boundedSpace, refSpace);
      if (pose) {
        _m.fromArray(pose.transform.matrix);
        this.bounds = this.boundedSpace.boundsGeometry.map((p) => {
          _p.set(p.x, 0, p.z).applyMatrix4(_m);
          return new THREE.Vector2(_p.x, _p.z);
        });
      }
    }
  }

  tick(frame) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0, now - this.last));
    this.last = now;
    this.frameNo++;
    this.frame = null;
    this.refSpace = null;

    if (frame && this.mode === 'xr') {
      this.frame = frame;
      this.refSpace = this.renderer.xr.getReferenceSpace();
      this.pointer = null;
      this.input.readXR(frame, this.refSpace, dt);
      this.readXRServices(frame, this.refSpace);
    } else if (this.mode === 'sim') {
      this.simulator.read(dt);
    } else {
      this.camera.rotation.y += dt * 0.05;
      this.input.hands = [];
      this.input.tips = [];
      this.input.pokers = [];
    }

    if (this.mode !== 'landing') {
      this.audio.setListener(this.input.head, this.input.fwd, this.input.up);
      if (this.app) {
        this.app.update(dt, now);
      } else {
        this.sky.set(0, 0, now, 0);
        this.launcher.update(dt, now);
      }
      this.home.update(dt, !!this.app);
    } else {
      this.sky.set(0, 0, now, 0);
    }

    this.particles.uniforms.uScale.value = this.renderer.xr.isPresenting ? 1000 : this.renderer.domElement.height * 0.5;
    this.particles.update(dt);
    this.room.uniforms.uLift.value = this.depthActive ? 0.04 : 0;
    if (this.debug) this.updateDebug(dt, frame);
    if (this.mode === 'sim') this.simulator.endFrame();
    this.renderer.render(this.scene, this.camera);
  }

  // ?debug — a floating panel that reports what the headset actually granted.
  updateDebug(dt, frame) {
    const L = this.debugLabel;
    const { input } = this;
    this.dbgFrames++;
    this.dbgTimer += dt;
    const pos = new THREE.Vector3(-0.32, -0.22, -0.9).applyQuaternion(input.headQ).add(input.head);
    L.mesh.position.copy(pos);
    L.mesh.lookAt(input.head);
    L.update(dt);
    if (this.dbgTimer < 0.5) return;
    const fps = Math.round(this.dbgFrames / this.dbgTimer);
    this.dbgTimer = 0;
    this.dbgFrames = 0;
    const st = this.room.stats();
    const line = (text, color) => ({ text, size: 34, weight: 500, color: color || '#e8f4ff', glow: 'rgba(0,0,0,0)' });
    const ok = (b) => (b ? '#a6ff8a' : '#ff9a7a');
    const feats = frame?.session?.enabledFeatures;
    const has = (f) => (feats ? feats.includes(f) : null);
    L.show([
      line(`${this.mode}  ·  ${fps} fps  ·  ${this.appDef?.id ?? 'hub'}`, fps >= 65 || this.mode !== 'xr' ? '#a6ff8a' : '#ffd27a'),
      line(feats ? `features: ${feats.filter((f) => !/viewer|local/.test(f)).join(', ') || 'none'}` : 'features: (not reported)'),
      line(`depth occlusion: ${this.depthActive ? 'on' : 'off'}`, ok(this.depthActive)),
      line(`room: ${st.meshes} meshes · ${st.planes} planes · ${st.area.toFixed(0)} m² · ${st.hits} hits`, ok(st.area > 0.5 || st.hits > 12)),
      line(`labels: ${st.labels.slice(0, 6).join(', ') || '—'}`),
      line(`inputs: ${input.hands.map((h) => h.kind).join(', ') || 'none'} · ${input.tips.length} tips`, ok(input.hands.length)),
      line(`boundary: ${this.bounds ? `${this.bounds.length} pts` : 'not shared'} · anchors ${has('anchors') ? 'yes' : 'no'}`),
      ...(this.app?.debugLines?.(line, ok) || []),
    ]);
  }
}
