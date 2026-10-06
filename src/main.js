import * as THREE from 'three';
import { Room } from './room.js';
import { Particles, Sky, Label, makeGlowTexture } from './fx.js';
import { AudioEngine } from './audio.js';
import { Memories } from './memory.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(0.5);
renderer.domElement.id = 'gl';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 100);
camera.position.set(0, 1.6, 1.4);
camera.rotation.order = 'YXZ';

const glowTex = makeGlowTexture();
const room = new Room(scene);
const particles = new Particles(scene);
const sky = new Sky(scene);
const label = new Label(scene, { width: 1.1, aspect: 0.32 });
const scoreLabel = new Label(scene, { width: 0.32, px: 512, aspect: 0.4, order: 51 });
const audio = new AudioEngine();

let game = null;
let mode = 'landing'; // landing | xr | sim
let last = performance.now() / 1000;

const head = new THREE.Vector3(0, 1.6, 0);
const headQ = new THREE.Quaternion();
const fwd = new THREE.Vector3(0, 0, -1);
const up = new THREE.Vector3(0, 1, 0);
const prevPts = new Map();
const handBySource = new Map();
let hands = [];

function makeGame(sim) {
  const memories = new Memories(sim);
  game = new Game({ scene, room, audio, particles, sky, label, scoreLabel, memories, glowTex, sim });
  return memories;
}

function trackPoint(key, pos, dt, extra) {
  const prev = prevPts.get(key);
  const vel = new THREE.Vector3();
  if (prev && dt > 0) vel.subVectors(pos, prev).divideScalar(dt);
  prevPts.set(key, pos.clone());
  return { pos, vel, ...extra };
}

// ---------------------------------------------------------------------------
// WebXR

let hitSources = [];
let frameNo = 0;

const BASE_FEATURES = ['hand-tracking', 'hit-test', 'plane-detection', 'mesh-detection', 'anchors'];

// Depth sensing lets real hands, people and pets hide fireflies. Some runtimes
// reject a session whose depth preferences they can't meet, so fall back.
async function requestARSession() {
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

async function startXR() {
  audio.init();
  audio.resume();
  let session;
  try {
    session = await requestARSession();
  } catch (e) {
    $('status').textContent = `Couldn't start mixed reality: ${e.message}`;
    return;
  }
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
  mode = 'xr';
  room.resetDynamic();
  document.body.classList.add('playing');
  await renderer.xr.setSession(session);
  const memories = makeGame(false);
  game.start(performance.now() / 1000);

  session.addEventListener('selectstart', (e) => {
    const h = handBySource.get(e.inputSource);
    game?.onSelect(h ? h.pos.clone() : head.clone().add(new THREE.Vector3(0, -0.3, 0)), performance.now() / 1000);
  });
  session.addEventListener('end', () => {
    mode = 'landing';
    hitSources = [];
    document.body.classList.remove('playing');
    $('status').textContent = game?.score ? `Last night you kept ${game.score} fireflies.` : '';
    resetScene();
  });

  // A fan of hit-test rays: even without Space Setup, we learn real surfaces
  // wherever the player looks.
  try {
    const viewer = await session.requestReferenceSpace('viewer');
    for (const [x, y] of [[0, 0], [-0.35, 0], [0.35, 0], [0, -0.35], [0, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.6, -0.2], [0.6, -0.2]]) {
      const offsetRay = new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x, y, z: -1, w: 0 });
      hitSources.push(await session.requestHitTestSource({ space: viewer, offsetRay }));
    }
  } catch {
    /* hit-test unavailable: planes/meshes or floating fireflies still work */
  }

  memories.restore(session, (night, getPts) => game.addMemoryNight(night, getPts));
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

function readXR(frame, dt) {
  const refSpace = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(refSpace);
  if (pose) {
    const t = pose.transform;
    head.set(t.position.x, t.position.y, t.position.z);
    headQ.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
    fwd.set(0, 0, -1).applyQuaternion(headQ);
    up.set(0, 1, 0).applyQuaternion(headQ);
  }
  room.updateFromFrame(frame, refSpace);

  if (hitSources.length && frameNo % 3 === 0) {
    for (const src of hitSources) {
      const r = frame.getHitTestResults(src)[0];
      const hp = r?.getPose(refSpace);
      if (!hp) continue;
      _p.set(hp.transform.position.x, hp.transform.position.y, hp.transform.position.z);
      const o = hp.transform.orientation;
      _n.set(0, 1, 0).applyQuaternion(_q.set(o.x, o.y, o.z, o.w));
      room.addHitPoint(_p, _n);
    }
  }

  hands = [];
  handBySource.clear();
  for (const src of frame.session.inputSources) {
    if (src.hand) {
      const tip = frame.getJointPose(src.hand.get('index-finger-tip'), refSpace);
      const palm = frame.getJointPose(src.hand.get('middle-finger-metacarpal'), refSpace);
      if (tip) {
        const p = tip.transform.position;
        const h = trackPoint(`${src.handedness}-tip`, new THREE.Vector3(p.x, p.y, p.z), dt, { radius: 0.085, kind: 'hand', lantern: true, source: src });
        hands.push(h);
        handBySource.set(src, h);
      }
      if (palm) {
        const p = palm.transform.position;
        const o = palm.transform.orientation;
        // Joint -Y points out of the palm: palm facing the sky = cradling.
        const palmUp = -_n.set(0, 1, 0).applyQuaternion(_q.set(o.x, o.y, o.z, o.w)).y;
        hands.push(
          trackPoint(`${src.handedness}-palm`, new THREE.Vector3(p.x, p.y, p.z), dt, { radius: 0.09, kind: 'hand', lantern: false, source: src, cradle: palmUp > 0.65 }),
        );
      }
    } else if (src.gripSpace) {
      const gp = frame.getPose(src.gripSpace, refSpace);
      if (!gp) continue;
      _m.fromArray(gp.transform.matrix);
      const pos = new THREE.Vector3(0, 0.01, -0.06).applyMatrix4(_m);
      const squeeze = !!src.gamepad?.buttons?.[1]?.pressed;
      const h = trackPoint(`${src.handedness}-grip`, pos, dt, { radius: 0.11, kind: 'controller', lantern: true, source: src, cradle: squeeze });
      hands.push(h);
      handBySource.set(src, h);
    }
  }
  return { refSpace };
}

// ---------------------------------------------------------------------------
// Desktop preview: a furnished stand-in room so the game can be tried
// without a headset. The headset version uses your real room instead.

let simVisuals = null;
const mouse = { x: 0, y: 0, down: false, dragged: false, clicked: false };
const keys = new Set();
const ray = new THREE.Raycaster();

function buildSimRoom() {
  simVisuals = new THREE.Group();
  scene.add(simVisuals);
  simVisuals.add(new THREE.HemisphereLight('#c8d4ff', '#4a3a2a', 1.4));
  const lamp = new THREE.PointLight('#ffd9a0', 6, 8);
  lamp.position.set(1.6, 2.2, -1.2);
  simVisuals.add(lamp);
  const add = (key, w, h, d, x, y, z, color, inside = false) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().makeTranslation(x, y, z);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        side: inside ? THREE.BackSide : THREE.FrontSide,
        // sit just behind the light layer, as real surfaces do in passthrough
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 8,
      }));
    mesh.applyMatrix4(m);
    simVisuals.add(mesh);
    room.addStatic(key, g.clone(), m, key);
  };
  add('room', 5, 2.6, 4.6, 0, 1.3, 0, '#8d8579', true);
  add('table', 1.2, 0.05, 0.7, 0.9, 0.73, -0.9, '#6b4b33');
  for (const [lx, lz] of [[0.35, 0.3], [-0.35, 0.3], [0.35, -0.3], [-0.35, -0.3]]) add(`leg${lx}${lz}`, 0.05, 0.7, 0.05, 0.9 + lx * 1.5, 0.35, -0.9 + lz, '#5a3e2a');
  add('couch', 2.0, 0.45, 0.9, -1.2, 0.225, -1.7, '#4a5f7a');
  add('couch-back', 2.0, 0.5, 0.2, -1.2, 0.7, -2.1, '#4a5f7a');
  add('shelf', 0.4, 1.8, 1.0, 2.25, 0.9, 0.9, '#5d4a3a');
  add('armchair', 0.8, 0.5, 0.8, -1.8, 0.25, 1.0, '#7a4a4a');
  add('plant-pot', 0.35, 0.4, 0.35, 1.9, 0.2, -1.9, '#3f6b45');
}

function startSim() {
  audio.init();
  audio.resume();
  mode = 'sim';
  document.body.classList.add('playing', 'sim');
  if (!simVisuals) buildSimRoom();
  const memories = makeGame(true);
  memories.restore(null, (night, getPts) => game.addMemoryNight(night, getPts));
  game.start(performance.now() / 1000);
}

function readSim(dt) {
  const k = (c) => (keys.has(c) ? 1 : 0);
  const speed = 1.6 * dt;
  const f = new THREE.Vector3(-Math.sin(camera.rotation.y), 0, -Math.cos(camera.rotation.y));
  const r = new THREE.Vector3(-f.z, 0, f.x);
  camera.position.addScaledVector(f, (k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown')) * speed);
  camera.position.addScaledVector(r, (k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft')) * speed);
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -2.3, 2.3);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -2.1, 2.1);
  camera.updateMatrixWorld();
  head.copy(camera.position);
  fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);

  // The mouse is your hand: it reaches 0.7 m into the room, or all the way to
  // a firefly when you click right on it.
  ray.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), camera);
  let pos = ray.ray.at(0.7, new THREE.Vector3());
  if (mouse.clicked && game) {
    let best = null;
    let bestAng = 0.06;
    for (const fl of game.flies) {
      if (!fl.catchable) continue;
      const toF = _p.subVectors(fl.pos, ray.ray.origin);
      const dist = toF.length();
      if (dist > 4.5) continue;
      const ang = toF.normalize().angleTo(ray.ray.direction);
      if (ang < bestAng) {
        bestAng = ang;
        best = fl;
      }
    }
    if (best) pos = best.pos.clone();
  }
  mouse.clicked = false;
  hands = [trackPoint('mouse', pos, dt, { radius: 0.1, kind: 'mouse', lantern: false })];
  hands[0].vel.set(0, 0, 0);
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) {
    const palm = new THREE.Vector3(0.05, -0.35, -0.45).applyQuaternion(camera.quaternion).add(camera.position);
    hands.push({ pos: palm, vel: new THREE.Vector3(), radius: 0, kind: 'mouse', lantern: false, cradle: true });
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'sim') return;
  audio.resume();
  if (e.button === 2) {
    game?.onSelect(head.clone().add(new THREE.Vector3(0, -0.3, 0)), performance.now() / 1000);
    return;
  }
  mouse.down = true;
  mouse.dragged = false;
  mouse.sx = e.clientX;
  mouse.sy = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  if (mode === 'sim' && mouse.down) {
    if (Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 4) mouse.dragged = true;
    camera.rotation.y -= e.movementX * 0.004;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - e.movementY * 0.004, -1.3, 1.3);
  }
});
window.addEventListener('pointerup', () => {
  if (mode === 'sim' && mouse.down && !mouse.dragged) mouse.clicked = true;
  mouse.down = false;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (mode === 'sim' && e.code === 'Space') {
    e.preventDefault();
    game?.onSelect(head.clone().add(new THREE.Vector3(0, -0.3, 0)), performance.now() / 1000);
  }
  if (mode === 'sim' && e.code === 'Escape') {
    mode = 'landing';
    document.body.classList.remove('playing', 'sim');
    resetScene();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// ---------------------------------------------------------------------------

function resetScene() {
  if (game) {
    for (const f of game.flies) f.dispose();
    for (const m of game.moths) m.dispose();
    game.moths = [];
    for (const m of game.memoryNights) m.flies.forEach((f) => f.dispose());
    game.flies = [];
    game.memoryNights = [];
    game.phase = 'idle';
    game.label.hide();
    game.scoreLabel.hide();
  }
}

const depthActive = () => renderer.xr.isPresenting && renderer.xr.hasDepthSensing();

// ---------------------------------------------------------------------------
// ?debug — a floating panel that reports what the headset actually granted.

const DEBUG = new URLSearchParams(location.search).has('debug');
const debugLabel = DEBUG ? new Label(scene, { width: 0.5, px: 1024, aspect: 0.62, order: 60 }) : null;
let dbgTimer = 0;
let dbgFrames = 0;

function updateDebug(dt, frame) {
  dbgFrames++;
  dbgTimer += dt;
  const pos = new THREE.Vector3(-0.32, -0.22, -0.9).applyQuaternion(mode === 'sim' ? camera.quaternion : headQ).add(head);
  debugLabel.mesh.position.copy(pos);
  debugLabel.mesh.lookAt(head);
  debugLabel.update(dt);
  if (dbgTimer < 0.5) return;
  const fps = Math.round(dbgFrames / dbgTimer);
  dbgTimer = 0;
  dbgFrames = 0;
  const session = frame?.session;
  const st = room.stats();
  const line = (text, color) => ({ text, size: 34, weight: 500, color: color || '#e8f4ff', glow: 'rgba(0,0,0,0)' });
  const ok = (b) => (b ? '#a6ff8a' : '#ff9a7a');
  const feats = session?.enabledFeatures;
  const has = (f) => (feats ? feats.includes(f) : null);
  const g = game;
  debugLabel.show([
    line(`${mode}  ·  ${fps} fps  ·  ${g?.phase ?? '-'}  ·  ✦${g?.score ?? 0}`, fps >= 65 || mode !== 'xr' ? '#a6ff8a' : '#ffd27a'),
    line(feats ? `features: ${feats.filter((f) => !/viewer|local/.test(f)).join(', ') || 'none'}` : 'features: (not reported)'),
    line(`depth occlusion: ${depthActive() ? 'on' : 'off'}`, ok(depthActive())),
    line(`room: ${st.meshes} meshes · ${st.planes} planes · ${st.area.toFixed(0)} m² · ${st.hits} hits`, ok(st.area > 0.5 || st.hits > 12)),
    line(`labels: ${st.labels.slice(0, 6).join(', ') || '—'}`),
    line(`inputs: ${hands.map((h) => h.kind).join(', ') || 'none'}`, ok(hands.length)),
    line(`memories: ${g?.memoryNights.length ?? 0} nights · ${g?.memoryNights.filter((m) => m.located).length ?? 0} located · anchors ${has('anchors') ? 'yes' : 'no'}`),
    line(`fireflies: ${g?.flies.filter((f) => f.inField).length ?? 0} in room · ${g?.caught?.length ?? 0} kept`),
  ]);
}

renderer.setAnimationLoop((time, frame) => {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, Math.max(0, now - last));
  last = now;
  frameNo++;
  let ctx = { frame: null, refSpace: null };
  if (frame && mode === 'xr') ctx = { frame, ...readXR(frame, dt) };
  else if (mode === 'sim') readSim(dt);
  else {
    camera.rotation.y += dt * 0.05;
    hands = [];
  }
  if (game && mode !== 'landing') {
    game.update(dt, now, { ...ctx, head, fwd, hands });
    audio.setListener(head, fwd, up);
  } else {
    sky.set(0, 0, now, 0);
  }
  particles.uniforms.uScale.value = renderer.xr.isPresenting ? 1000 : renderer.domElement.height * 0.5;
  particles.update(dt);
  room.uniforms.uLift.value = depthActive() ? 0.04 : 0;
  if (simVisuals) simVisuals.visible = mode === 'sim';
  if (DEBUG) updateDebug(dt, frame);
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Landing page

async function init() {
  const enter = $('enter');
  const preview = $('preview');
  let ar = false;
  try {
    ar = !!(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    ar = false;
  }
  if (ar) {
    enter.disabled = false;
    enter.addEventListener('click', startXR);
  } else {
    enter.disabled = true;
    enter.textContent = 'Open in Meta Quest Browser to play';
    $('status').textContent = 'This device can’t do mixed reality — try the desktop preview below.';
  }
  preview.addEventListener('click', startSim);
  if (new URLSearchParams(location.search).has('preview')) startSim();
}
init();

window.__fireflyNight = { get game() { return game; }, room, camera };
