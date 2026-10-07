// Firefly Night — game director.
// Night falls inside your real room; fireflies emerge from your real surfaces
// and hide behind your real furniture. Catch them gently before dawn, then
// watch them settle on your walls, where they'll still be tomorrow night.
import * as THREE from 'three';
import { Firefly, KINDS } from './firefly.js';
import { Moth } from './moth.js';
import { PlayArea } from './area.js';
import { PULSE_SPEED, MAX_LIGHTS } from '../../core/room.js';
import { loadBest, saveBest } from './memory.js';

export const PLAY_LEN = 160; // + ~20 s of intro = a 3-minute night
const NIGHT = 0.64;
const GOLDEN_AT = [30, 80, 125];
const LANTERN = new THREE.Color('#ffd27a');
const SEED = new THREE.Color('#7fe8ff');
const DAWN_MOTE = new THREE.Color('#ffd0a0');
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, -1);
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const MOTH = new THREE.Color('#8a4dff');

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const fmt = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Game {
  constructor({ scene, room, audio, particles, sky, label, scoreLabel, memories, glowTex, sim }) {
    Object.assign(this, { scene, room, audio, particles, sky, label, scoreLabel, memories, glowTex, sim });
    this.flies = [];
    this.area = new PlayArea();
    this.moths = [];
    this.memoryNights = [];
    this.lanterns = [];
    this.haloCenter = new THREE.Vector3(0, 1, 0);
    this.labelPos = new THREE.Vector3(0, 1.5, -1.5);
    this.best = loadBest();
    this.night = 0;
    this.dawn = 0;
    this.phase = 'idle';
    this.events = [];
  }

  // ---- lifecycle ---------------------------------------------------------------

  start(now) {
    this.phase = 'intro';
    this.t0 = now;
    this.score = 0;
    this.caught = [];
    this.combo = 0;
    this.lastCatch = -10;
    this.chimes = 0;
    this.lastChime = -10;
    this.spawnTimer = 0;
    this.goldenIdx = 0;
    this.events = [];
    this.introSonar = false;
    this.firstFly = null;
    this.seeds = [];
    this.persisted = null;
    this.hinted = {};
    this.window = null;
    for (const m of this.moths) m.dispose();
    this.moths = [];
    this.mothTimer = 0;
    this.snuffed = 0;
    this.night = Math.min(this.night, 0.2);
    this.dawn = 0;
    // Last round's resting fireflies stay as quiet memories.
    for (const f of this.flies) {
      if (f.state === 'resting' && f.kind !== 'memory') f.dim = 0.6;
    }
    for (const f of this.flies) if (f.state !== 'resting') f.dispose();
    this.flies = this.flies.filter((f) => f.state === 'resting');
    this.at(0.6, () => this.say('Shh…', 'night is falling in your room'));
  }

  get chimeHint() {
    if (this.sim) return 'press Space to chime';
    return this.inputKind === 'controller' ? 'pull the trigger to chime' : 'make a fist to chime';
  }

  // Schedule fn at phase-relative time.
  at(t, fn) {
    this.events.push({ t, fn });
  }

  say(title, sub, extra) {
    const lines = [{ text: title, size: 92, weight: 700 }];
    if (sub) lines.push({ text: sub, size: 52, weight: 500, color: '#ffeec2' });
    if (extra) lines.push({ text: extra, size: 40, weight: 500, color: '#bfe9ff', glow: 'rgba(120,200,255,0.8)' });
    this.label.show(lines);
  }

  addMemoryNight(night, getPts) {
    const flies = night.pts.map(() => {
      const f = new Firefly(this.scene, this.glowTex, 'memory');
      f.state = 'resting';
      f.scale = 0;
      f.dim = 0;
      return f;
    });
    this.memoryNights.push({ night, getPts, flies, located: false });
  }

  // ---- input ---------------------------------------------------------------------

  onSelect(pos, now) {
    if (this.phase === 'over') {
      this.start(now);
      return;
    }
    if (this.phase !== 'play' && !(this.phase === 'intro' && this.introSonar)) return;
    if (now - this.lastChime < 0.9) return;
    this.lastChime = now;
    this.chimes++;
    this.room.addPulse(pos, now);
    this.audio.sonar(pos);
    this.particles.burst(pos, SEED, 18, 0.5, { gravity: 0 });
    for (const f of this.flies) {
      const d = f.pos.distanceTo(pos);
      if (d < 9) f.pingAt = now + d / PULSE_SPEED;
    }
    for (const m of this.moths) {
      const d = m.pos.distanceTo(pos);
      if (d < 9) {
        m.pingAt = now + d / PULSE_SPEED;
        m.pingFrom = pos.clone();
      }
    }
  }

  // ---- spawning ------------------------------------------------------------------

  // A real surface where a firefly can perch. With reach on (the default) it
  // must be touchable from inside the player's boundary.
  findPerch(head, { hidden = false, minD = 0.35, maxD = 4.5, inView = null, near = null, reach = true } = {}) {
    let fallback = null;
    let rays = 3; // raycasts against a full room mesh aren't free
    for (let i = 0; i < 60; i++) {
      const s = this.room.sample();
      if (!s) break;
      const h = s.pos.y;
      if (h < 0.03 || h > 2.05) continue;
      if (s.normal.y < -0.7 && h > 1.3) continue; // ceiling: out of reach
      const dx = s.pos.x - head.x;
      const dz = s.pos.z - head.z;
      const hd = Math.hypot(dx, dz);
      if (hd < minD || hd > maxD) continue;
      if (reach && !this.area.reachable(_v.copy(s.pos).addScaledVector(s.normal, 0.05))) continue;
      if (near && s.pos.distanceTo(near.pos) > near.max) continue;
      if (h < 0.1 && s.normal.y > 0.7 && Math.random() < 0.6) continue; // floors are big; prefer furniture
      if (this.flies.some((f) => f.inField && f.perch.distanceTo(s.pos) < 0.35)) continue;
      if (inView) {
        _v.subVectors(s.pos, head).normalize();
        if (_v.dot(inView) < 0.8) continue;
      }
      fallback ??= s;
      if (hidden && (rays-- <= 0 || !this.room.isHidden(head, s.pos))) continue;
      return s;
    }
    if (fallback) return fallback;
    // Nowhere suitable on a surface: drift in the air, always within reach.
    const pos = reach ? this.area.randomInside(head) : new THREE.Vector3().randomDirection().setY(0).multiplyScalar(1.5).add(head);
    pos.y = 0.6 + Math.random() * 0.9;
    if (inView) pos.copy(head).addScaledVector(inView, 0.7).setY(Math.max(0.6, head.y - 0.45));
    return { pos, normal: _w.subVectors(head, pos).normalize().clone(), label: '' };
  }

  findWall(head) {
    for (let i = 0; i < 40; i++) {
      const s = this.room.sample();
      if (!s) break;
      const d = s.pos.distanceTo(head);
      if (d < 0.8 || d > 4.5) continue;
      const wall = Math.abs(s.normal.y) < 0.5 && s.pos.y > 0.7 && s.pos.y < 2.4;
      const ceiling = s.normal.y < -0.7 && s.pos.y > 1.9;
      if (wall || ceiling) return s;
    }
    const pos = new THREE.Vector3().randomDirection();
    pos.y = Math.abs(pos.y) * 0.5 + 0.1;
    pos.multiplyScalar(1.6 + Math.random()).add(head);
    return { pos, normal: _w.subVectors(head, pos).normalize().clone() };
  }

  spawn(head, kind = 'normal', opts = {}) {
    const f = new Firefly(this.scene, this.glowTex, kind);
    const s = opts.sample || this.findPerch(head, opts);
    f.emergeAt(s);
    this.flies.push(f);
    this.audio.emerge(s.pos);
    for (let i = 0; i < 14; i++) {
      _v.copy(s.normal).multiplyScalar(0.15 + Math.random() * 0.25).add(_w.randomDirection().multiplyScalar(0.12));
      this.particles.emit(s.pos, _v, f.color, { life: 0.5 + Math.random() * 0.7, size: 0.012, drag: 3, gravity: 0.02 });
    }
    return f;
  }

  catch(f, hand, now) {
    this.combo = now - this.lastCatch < 3.5 ? this.combo + 1 : 0;
    this.lastCatch = now;
    this.score += f.value;
    f.state = 'caught';
    f.dim = 1;
    f.boost = 1.5;
    f.syncOffset = Math.random() * 2 - 1;
    this.caught.push(f);
    this.audio.catch(f.pos.clone(), Math.min(this.combo, 9), f.kind === 'golden');
    this.particles.burst(f.pos, f.color, f.kind === 'golden' ? 80 : 36, f.kind === 'golden' ? 1.2 : 0.7);
    this.particles.burst(f.pos, LANTERN, 12, 0.3);
    const act = hand?.source?.gamepad?.hapticActuators?.[0];
    act?.pulse?.(f.kind === 'golden' ? 1 : 0.55, f.kind === 'golden' ? 160 : 60);
    if (f.kind === 'golden') {
      this.say('Golden!', '+5 fireflies');
      this.at(now - this.t0 + 2.5, () => this.label.hide());
    }
    // Keep the halo light: the oldest ones melt into the glow.
    if (this.caught.length > 70) this.caught.shift().state = 'gone';
  }

  // ---- per-frame -----------------------------------------------------------------

  update(dt, now, ctx) {
    const { head, fwd, hands } = ctx;
    this.area.visit(head);
    const pt = now - this.t0;
    const fwdFlat = _w.set(fwd.x, 0, fwd.z);
    if (fwdFlat.lengthSq() < 1e-4) fwdFlat.set(0, 0, -1);
    fwdFlat.normalize();
    const fwdF = fwdFlat.clone();

    // scheduled events
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].t <= pt) {
        const e = this.events.splice(i, 1)[0];
        e.fn();
      }
    }

    if (this.phase === 'intro') this.updateIntro(pt, now, head, fwdF, hands);
    else if (this.phase === 'play') this.updatePlay(pt, now, head, dt);
    else if (this.phase === 'dawn' || this.phase === 'over') this.updateDawn(pt, now, head, ctx);

    // sky: dusk → night → dawn
    const nightTarget = this.phase === 'intro' || this.phase === 'play' ? NIGHT : this.phase === 'idle' ? 0 : 0.2;
    if (this.phase === 'intro') {
      // Dusk falls over ~3.5 s, eased, independent of frame rate.
      const k = Math.min(1, pt / 3.5);
      this.night = Math.max(this.night, nightTarget * k * k * (3 - 2 * k));
    } else this.night += (nightTarget - this.night) * Math.min(1, dt * 0.35);
    let dawnT = 0;
    if (this.phase === 'play') dawnT = Math.max(0, (pt - (PLAY_LEN - 40)) / 40) * 0.55;
    if (this.phase === 'dawn' || this.phase === 'over') dawnT = 1;
    this.dawn += (dawnT - this.dawn) * Math.min(1, dt * 0.5);
    const stars = this.introSonar ? Math.max(0, 1 - this.dawn * 1.4) * (this.night / NIGHT) : 0;
    this.sky.set(this.night, this.dawn, now, this.room.realArea > 0.5 ? 0 : stars * 0.8);
    this.sky.follow(head);
    this.room.update(now, stars);
    const sun = this.room.uniforms.uSun.value;
    if (this.window && (this.phase === 'dawn' || this.phase === 'over')) {
      sun.set(this.window.x, this.window.y, this.window.z, Math.min(1, pt / 5));
      // dust motes drifting in the morning light
      if (Math.random() < dt * 12) {
        _v.copy(this.window).add(_w.randomDirection().multiplyScalar(0.5));
        this.particles.emit(_v, _w.subVectors(head, this.window).normalize().multiplyScalar(0.12), DAWN_MOTE, { life: 3, size: 0.01, drag: 0.2, gravity: -0.01 });
      }
    } else sun.w = 0;
    this.audio.night = this.night / NIGHT * (1 - this.dawn);

    // A closing fist: grab a firefly in your palm, or (nothing there) chime.
    this.inputKind = hands.some((h) => h.kind === 'hand') ? 'hand' : hands.some((h) => h.kind === 'controller') ? 'controller' : this.inputKind;
    for (const h of hands) {
      if (!h.fistStart) continue;
      const near = this.flies.find((f) => f.catchable && f.pos.distanceTo(h.pos) < 0.2);
      if (near && (this.phase === 'intro' || this.phase === 'play')) {
        this.catch(near, h, now);
        if (near === this.firstFly) this.beginPlay(now, head, fwdF);
      } else this.onSelect(h.pos.clone(), now);
    }

    // catching & startling
    if (this.phase === 'intro' || this.phase === 'play') {
      for (const f of this.flies) {
        if (!f.catchable) continue;
        for (const h of hands) {
          if (!h.radius) continue;
          const d = f.pos.distanceTo(h.pos);
          // A palm only catches fireflies on its palm side, never from behind the hand.
          const onPalmSide = !h.normal || _v.subVectors(f.pos, h.pos).normalize().dot(h.normal) > -0.02;
          if (d < h.radius * (f.kind === 'golden' ? 1.25 : 1) && onPalmSide && !h.fist) {
            this.catch(f, h, now);
            if (f === this.firstFly) this.beginPlay(now, head, fwdF);
            break;
          }
          // An open palm facing a firefly within 25 cm draws it in, like a magnet.
          if (h.normal && !h.fist && d < 0.25 && onPalmSide && h.vel.length() < 1.6 && (f.state === 'perched' || f.state === 'hover')) {
            const goal = _w.copy(h.pos).addScaledVector(h.normal, 0.04);
            (f.state === 'hover' ? f.hoverTarget : f.perch).lerp(goal, Math.min(1, dt * (f.kind === 'golden' ? 1.5 : 3.5)));
            continue;
          }
          const speed = h.vel.length();
          // A real swipe startles a firefly once; it hops somewhere close and reachable.
          if (f !== this.firstFly && !f.startled && d < 0.22 && speed > 2.8 && f.state === 'perched' && f.kind !== 'golden') {
            f.startled = true;
            const s = this.findPerch(head, { minD: 0.2, near: { pos: f.pos, max: 1.3 } });
            this.audio.startle(f.pos.clone());
            f.flyTo(s.pos, s.normal, 'perched', 2.2);
            break;
          }
          // A slow fingertip nearby: the firefly drifts onto your finger.
          if (!h.normal && d < 0.2 && speed < 1.6 && (f.state === 'perched' || f.state === 'hover')) {
            const pull = Math.min(1, dt * (f.kind === 'golden' ? 1.2 : 2.2) * (1 - d / 0.2 + 0.3));
            (f.state === 'hover' ? f.hoverTarget : f.perch).lerp(h.pos, pull);
          }
        }
      }
    }

    // fireflies
    const haloTarget = _v.set(head.x, head.y - 0.55, head.z);
    this.haloCenter.lerp(haloTarget, Math.min(1, dt * 3));
    let ci = 0;
    const cradle = this.updateCradle(dt, now, hands);
    for (const f of this.flies) {
      if (f.state === 'caught') {
        let target;
        if (cradle) {
          // Nestle in the palm: within ~4 cm of its centre, on its palm side.
          const a = ci * 2.39996 + now * 1.6;
          const k = (ci % 12) / 12;
          const r = 0.012 + 0.028 * k;
          const n = this.cradleNormal;
          _t1.crossVectors(n, Math.abs(n.y) > 0.9 ? _fwd : _up).normalize();
          _t2.crossVectors(n, _t1);
          target = _v.copy(cradle)
            .addScaledVector(n, 0.035 + 0.03 * k + 0.008 * Math.sin(now * 3 + ci))
            .addScaledVector(_t1, Math.cos(a) * r)
            .addScaledVector(_t2, Math.sin(a) * r);
        } else {
          const a = ci * 2.39996 + now * 0.35;
          const r = 0.55 + 0.06 * Math.sin(now * 0.7 + ci);
          target = _v.set(
            this.haloCenter.x + Math.cos(a) * r,
            this.haloCenter.y + 0.12 * Math.sin(now * 0.9 + ci * 1.7),
            this.haloCenter.z + Math.sin(a) * r,
          );
        }
        f.pos.lerp(target, Math.min(1, dt * (cradle ? 4 : 2.2)));
        f.scale += ((cradle ? 0.45 : 0.7) - f.scale) * Math.min(1, dt * 2);
        ci++;
      }
      f.nearGlow = f.inField && f.state === 'perched' && f.pos.distanceToSquared(head) < 2.4 * 2.4 ? 1 : 0;
      f.update(dt, now);
      if (f.pinged) {
        f.pinged = false;
        if (f.inField) this.audio.chirp(f.pos.clone(), f.kind === 'golden', 0.07);
      }
      // Stranded out of reach (e.g. the boundary arrived late)? Flit somewhere touchable.
      if (f.inField && f.state === 'perched' && f !== this.firstFly && f.t > 1.5 && (f.reachCheck = (f.reachCheck || 0) + 1) % 15 === 0 && !this.area.reachable(f.perch)) {
        const s = this.findPerch(head);
        f.flyTo(s.pos, s.normal, 'perched', 1.6);
      }
      if (f.inField && (f.state === 'perched' || f.state === 'hover')) {
        f.nextChirp -= dt;
        if (f.nextChirp <= 0) {
          f.nextChirp = f.kind === 'golden' ? 1.8 : 4 + Math.random() * 5;
          this.audio.chirp(f.pos.clone(), f.kind === 'golden', 0.04);
          f.boost = Math.max(f.boost, 0.6);
        }
      }
      if (f.state === 'flying' && Math.random() < dt * 25) {
        this.particles.emit(f.pos, _w.set(0, 0.05, 0), f.color, { life: 0.6, size: 0.01, drag: 2 });
      }
      if (f.state === 'resting' && f.arrived) {
        f.arrived = false;
        this.audio.plink(f.pos.clone(), (this.plinkStep = (this.plinkStep ?? 0) + 1) % 10);
        this.particles.burst(f.pos, f.color, 10, 0.25);
      }
    }
    for (let i = this.flies.length - 1; i >= 0; i--) {
      if (this.flies[i].state === 'gone') {
        this.flies[i].dispose();
        this.flies.splice(i, 1);
      }
    }

    this.updateMoths(dt, now, hands);
    this.updateMemories(dt, now, ctx);
    this.updateSeeds(now);
    this.updateLanterns(hands, now);
    this.updateLights(head, hands);
    this.updateHud(dt, now, pt, head, fwdF);
    this.audio.musicLevel = this.phase === 'play' ? Math.min(1, this.caught.length / 30) : this.phase === 'intro' ? 0 : this.audio.musicLevel * Math.exp(-dt * 0.2);
    this.audio.tempo = this.phase === 'play' && pt > PLAY_LEN - 30 ? 0.24 : 0.34;
    this.audio.update(dt, this.phase === 'idle' ? 0 : 0.4 + 0.6 * Math.min(1, this.caught.length / 20));
  }

  // Hold a palm up (or squeeze a grip) and your fireflies pour into your hand.
  updateCradle(dt, now, hands) {
    const h = this.phase === 'play' || this.phase === 'intro' ? hands.find((x) => x.cradle) : null;
    this.cradleHold = h ? (this.cradleHold || 0) + dt : 0;
    if (!h || this.cradleHold < 0.35 || !this.caught.length) {
      if (this.cradling) this.cradling = false;
      return null;
    }
    if (!this.cradling) {
      this.cradling = true;
      this.audio.chord([4, 7, 9], 0.025, 2.5);
      this.hinted.cradle = true;
    }
    this.cradlePos ??= new THREE.Vector3();
    this.cradlePos.copy(h.pos);
    this.cradleNormal ??= new THREE.Vector3(0, 1, 0);
    this.cradleNormal.copy(h.normal || _up);
    return this.cradlePos;
  }

  updateIntro(pt, now, head, fwdF, hands) {
    // The first great ripple: it rolls out from your feet across your room.
    if (!this.introSonar && pt > 3.2 && (this.room.hasGeometry || pt > 6)) {
      if (!this.room.hasGeometry) this.room.ensureSyntheticFloor();
      this.introSonar = true;
      this.sonarAt = pt;
      const origin = new THREE.Vector3(head.x, 0, head.z);
      this.room.addPulse(origin, now);
      this.room.addPulse(origin, now + 0.35);
      this.room.revealStars(origin, now);
      this.audio.bigSonar();
      // seeds of light wake wherever the ripple touches
      for (let i = 0; i < 46; i++) {
        const s = this.room.sample();
        if (!s) break;
        this.seeds.push({ at: now + s.pos.distanceTo(origin) / PULSE_SPEED, s });
      }
      for (const m of this.memoryNights) m.revealFrom = { origin, now };
      this.label.hide();
    }
    if (this.introSonar && !this.firstFly && pt > this.sonarAt + 2.0) {
      const s = this.findPerch(head, { inView: fwdF, minD: 0.5, maxD: 1.8 });
      this.firstFly = this.spawn(head, 'normal', { sample: s });
      this.at(pt + 1.6, () => this.say('A firefly noticed you', 'reach out… gently'));
    }
    const f = this.firstFly;
    if (f && f.state === 'perched' && f.age > 2.6) f.state = 'hover';
    if (f && f.state === 'hover') {
      // Settle at arm's length; stay put while the player leans in to reach.
      if (!f.hoverSet || f.hoverTarget.distanceTo(head) > 1.1) {
        f.hoverSet = true;
        f.hoverTarget.copy(head).addScaledVector(fwdF, 0.42);
        f.hoverTarget.y -= 0.3;
      }
      // Shy players: after a while it lands on your hand by itself.
      if (f.age > 11 && hands.length) f.hoverTarget.copy(hands[0].pos);
    }
  }

  beginPlay(now, head, fwdF) {
    this.phase = 'play';
    this.t0 = now;
    this.events = [];
    this.room.addPulse(this.firstFly.pos.clone(), now);
    this.audio.chord([0, 2, 4, 7], 0.05, 6);
    // A wave of fireflies answers from all around your room.
    for (let i = 0; i < 6; i++) {
      this.at(0.4 + i * 0.35, () => {
        const f = this.spawn(head, 'normal', { hidden: i % 3 === 2 });
        this.audio.chirp(f.perch.clone(), false, 0.07);
      });
    }
    this.at(0.5, () => this.say('Your room is full of them', 'catch them all before dawn'));
    this.at(6.5, () => this.say('Lost one?', this.chimeHint, '…then listen where they answer'));
    this.at(12, () => this.label.hide());
  }

  updatePlay(pt, now, head, dt) {
    const left = PLAY_LEN - pt;
    // Population grows through the night; dawn brings a last frenzy.
    const field = this.flies.filter((f) => f.inField && f.kind === 'normal').length;
    const target = Math.round(6 + 8 * Math.min(1, pt / PLAY_LEN) + (left < 30 ? 3 : 0));
    this.spawnTimer -= dt;
    if (pt > 2.5 && field < target && this.spawnTimer <= 0) {
      this.spawnTimer = left < 30 ? 0.45 : 1.1;
      this.spawn(head, 'normal', { hidden: Math.random() < 0.35 });
    }
    if (this.goldenIdx < GOLDEN_AT.length && pt > GOLDEN_AT[this.goldenIdx]) {
      this.goldenIdx++;
      const g = this.spawn(head, 'golden', { minD: 1.2 });
      g.leaveAt = pt + 24;
      this.say('A golden firefly!', 'it never sits still', 'worth 5');
      this.at(pt + 3.5, () => this.label.hide());
    }
    for (const f of this.flies) {
      if (f.kind !== 'golden' || !f.inField) continue;
      if (pt > f.leaveAt) {
        f.fade();
        continue;
      }
      if (f.state === 'perched' && f.t > 2.6 + Math.random() * 2) {
        const s = this.findPerch(head, { minD: 0.5, near: { pos: f.pos, max: 2.5 } });
        f.flyTo(s.pos, s.normal, 'perched', 2.0);
      }
    }
    if (pt > 22 && this.chimes === 0 && !this.hinted.chime) {
      this.hinted.chime = true;
      this.say('Listen…', this.chimeHint);
      this.at(pt + 4, () => this.label.hide());
    }
    // The last stretch of night: gloom moths come for the light.
    this.mothTimer -= dt;
    const alive = this.moths.filter((m) => m.state !== 'fleeing').length;
    if (left < 75 && left > 6 && this.mothTimer <= 0 && alive < (left < 30 ? 3 : 2)) {
      this.mothTimer = left < 30 ? 6 : 10;
      const s = this.findPerch(head, { minD: 1.6, maxD: 4.5, reach: false });
      const m = new Moth(this.scene, this.glowTex, s.pos.clone().addScaledVector(s.normal, 0.12));
      this.moths.push(m);
      this.audio.moth(m.pos.clone());
      if (!this.hinted.moth) {
        this.hinted.moth = true;
        this.say('Something is hungry for light…', this.sim ? 'chime (Space) or swat to scare it' : 'chime or swat to scare it away');
        this.at(pt + 4.5, () => this.label.hide());
      }
    }
    if (pt > 40 && this.caught.length >= 5 && !this.hinted.cradle && left > 40) {
      this.hinted.cradle = true;
      this.say('Hold out an open palm', this.sim ? '(hold Shift)' : 'or squeeze a grip', 'your fireflies will come to you');
      this.at(pt + 4.5, () => this.label.hide());
    }
    if (left < 30 && !this.hinted.dawn) {
      this.hinted.dawn = true;
      this.say('Dawn is coming', 'last chance!');
      this.at(pt + 3, () => this.label.hide());
    }
    if (left <= 0) this.endNight(now, head);
  }

  endNight(now, head) {
    this.phase = 'dawn';
    this.t0 = now;
    this.events = [];
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      saveBest(this.best);
    } else this.newBest = false;
    this.audio.chord([0, 4, 7, 9, 11], 0.06, 8);
    // If the room knows where its window is, dawn comes in through it, and
    // the fireflies you didn't catch fly out through it.
    for (const m of this.moths) m.scatter(head);
    this.window = this.room.findLabeled('window').sort((a, b) => a.distanceTo(head) - b.distanceTo(head))[0] || null;
    this.say('Dawn', this.window ? 'look — the light is coming in' : '');
    for (const f of this.flies) {
      if (!f.inField) continue;
      if (this.window) f.flyTo(this.window, _w.subVectors(head, this.window).normalize(), 'fading', 1.2);
      else f.fade();
    }
    // Your fireflies leave the halo and settle on your walls.
    const kept = this.caught.slice();
    kept.forEach((f, i) => {
      this.at(1.2 + i * 0.09, () => {
        const s = this.findWall(head);
        f.flyTo(s.pos, s.normal, 'resting', 1.4);
        f.dim = 0.9;
      });
    });
    this.releaseEnd = 1.2 + kept.length * 0.09 + 3;
    this.at(this.releaseEnd, () => {
      this.toRemember = kept.map((f) => f.to.clone());
      this.showResult();
    });
    this.at(this.releaseEnd + 5, () => {
      this.phase = 'over';
      this.showResult(true);
    });
  }

  showResult(again = false) {
    const n = this.score;
    const lines = [
      { text: `You kept ${n} firefl${n === 1 ? 'y' : 'ies'}`, size: 80, weight: 700 },
      {
        text: this.persisted ? 'they’ll still be on your walls next time' : this.newBest ? 'a new personal best!' : `best night: ${this.best}`,
        size: 46,
        weight: 500,
        color: '#ffeec2',
      },
    ];
    if (again) lines.push({ text: this.sim ? 'press Space for another night' : this.inputKind === 'controller' ? 'pull the trigger for another night' : 'make a fist for another night', size: 38, weight: 500, color: '#bfe9ff', glow: 'rgba(120,200,255,0.8)' });
    this.label.show(lines);
  }

  updateDawn(pt, now, head, ctx) {
    if (this.toRemember) {
      const pts = this.toRemember;
      this.toRemember = null;
      this.memories.remember(ctx.frame, ctx.refSpace, pts).then((ok) => {
        this.persisted = ok;
        if (ok && this.label.target) this.showResult(this.phase === 'over');
      });
    }
    if (pt > 3 && Math.random() < 0.012) {
      const a = Math.random() * Math.PI * 2;
      this.audio.bird({ x: head.x + Math.cos(a) * 3, y: 2, z: head.z + Math.sin(a) * 3 });
    }
  }

  updateMoths(dt, now, hands) {
    for (const m of this.moths) {
      if (m.state === 'hunting' || m.state === 'arriving') {
        if (m.pingAt <= now) {
          m.pingAt = Infinity;
          this.shoo(m, m.pingFrom);
        }
        for (const h of hands) if (h.pos.distanceTo(m.pos) < 0.16) this.shoo(m, h.pos, h);
      }
      if (m.state === 'hunting') {
        if (!m.target || !m.target.inField || m.target.state === 'caught') {
          let best = null;
          let bd = Infinity;
          for (const f of this.flies) {
            if (!f.inField || f.state !== 'perched') continue;
            const d = f.pos.distanceToSquared(m.pos);
            if (d < bd) {
              bd = d;
              best = f;
            }
          }
          m.target = best;
        }
        if (m.target && m.target.state === 'perched' && m.target.pos.distanceTo(m.pos) < 0.07) {
          // The light goes out.
          this.audio.snuff(m.target.pos.clone());
          this.particles.burst(m.target.pos, MOTH, 14, 0.25);
          m.target.fade();
          m.target = null;
          this.snuffed++;
        }
      }
      m.update(dt, now);
      if (m.state !== 'fleeing' && Math.random() < dt * 14) {
        this.particles.emit(m.pos, _w.set(0, -0.03, 0), MOTH, { life: 1.2, size: 0.016, drag: 1, gravity: -0.02 });
      }
    }
    for (let i = this.moths.length - 1; i >= 0; i--) {
      if (this.moths[i].state === 'gone') {
        this.moths[i].dispose();
        this.moths.splice(i, 1);
      }
    }
  }

  shoo(m, from, hand) {
    if (!m.scatter(from)) return;
    this.audio.startle(m.pos.clone());
    this.particles.burst(m.pos, MOTH, 24, 0.6);
    hand?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(0.4, 40);
  }

  updateMemories(dt, now, ctx) {
    for (const m of this.memoryNights) {
      const pts = m.getPts(ctx.frame, ctx.refSpace);
      if (!pts) continue;
      m.flies.forEach((f, i) => {
        f.perch.copy(pts[i]);
        if (!m.located) f.pos.copy(pts[i]);
        // Revealed by the opening ripple, or faded in if located later.
        let vis = 1;
        if (m.revealFrom) vis = (now - m.revealFrom.now) * PULSE_SPEED - pts[i].distanceTo(m.revealFrom.origin) > 0 ? 1 : 0;
        else if (this.phase === 'intro' && !this.introSonar) vis = 0;
        if (vis && f.dim === 0) {
          f.boost = 1;
          this.particles.burst(pts[i], f.color, 6, 0.2);
        }
        f.dim += ((vis ? 0.75 : 0) - f.dim) * 0.1;
        f.dim = vis && f.dim < 0.01 ? 0.01 : f.dim;
        f.update(dt, now);
      });
      if (!m.located) {
        m.located = true;
        if (this.phase === 'intro' && !this.hinted.memory) {
          this.hinted.memory = true;
          this.at(now - this.t0 + 2.6, () => this.say('Your room remembers', 'last night’s fireflies are still here'));
        }
      }
    }
  }

  updateSeeds(now) {
    for (let i = this.seeds.length - 1; i >= 0; i--) {
      const { at, s } = this.seeds[i];
      if (now < at) continue;
      this.seeds.splice(i, 1);
      for (let k = 0; k < 4; k++) {
        _v.copy(s.normal).multiplyScalar(0.1 + Math.random() * 0.2).add(_w.randomDirection().multiplyScalar(0.06));
        this.particles.emit(s.pos, _v, Math.random() < 0.5 ? SEED : KINDS.normal.color, { life: 1 + Math.random() * 1.5, size: 0.014, drag: 1.2, gravity: 0.04 });
      }
    }
  }

  updateLanterns(hands, now) {
    while (this.lanterns.length < hands.length) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: LANTERN, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      s.renderOrder = 6;
      this.scene.add(s);
      this.lanterns.push(s);
    }
    const glow = this.phase === 'idle' ? 0 : 0.35 + 0.5 * Math.min(1, this.caught.length / 25);
    this.lanterns.forEach((s, i) => {
      const h = hands[i];
      s.visible = !!h && h.lantern;
      if (!h) return;
      s.position.copy(h.pos);
      s.scale.setScalar(0.045 + 0.01 * Math.sin(now * 9 + i));
      s.material.opacity = glow;
    });
  }

  // The brightest nearby lights paint onto your real surfaces.
  updateLights(head, hands) {
    const L = [];
    const lantern = this.phase === 'idle' ? 0 : 0.25 + 0.35 * Math.min(1, this.caught.length / 25);
    for (const h of hands) if (h.lantern) L.push({ pos: h.pos, intensity: lantern, color: LANTERN });
    if (this.cradling) L.push({ pos: this.cradlePos, intensity: Math.min(1.2, 0.3 + this.caught.length * 0.04), color: KINDS.normal.color });
    else if (this.caught.length && this.phase === 'play') L.push({ pos: this.haloCenter, intensity: Math.min(0.8, 0.1 + this.caught.length * 0.03), color: KINDS.normal.color });
    const flies = this.flies
      .filter((f) => f.state !== 'caught' && f.brightness > 0.05)
      .map((f) => ({ f, d: f.pos.distanceToSquared(head) }))
      .sort((a, b) => a.d - b.d);
    for (const { f } of flies) {
      if (L.length >= MAX_LIGHTS) break;
      L.push({ pos: f.pos, intensity: f.brightness * 0.9 * f.scale, color: f.color });
    }
    this.room.setLights(L);
  }

  updateHud(dt, now, pt, head, fwdF) {
    // Main text floats ahead of you, lazily following your gaze.
    // Text floats a little below eye level so it never blocks the room you're looking at.
    const target = _v.copy(head).addScaledVector(fwdF, 1.6);
    target.y = head.y - 0.2;
    if (!this.label.mesh.visible) this.labelPos.copy(target);
    this.labelPos.lerp(target, Math.min(1, dt * 1.5));
    this.label.mesh.position.copy(this.labelPos);
    this.label.mesh.lookAt(head);
    this.label.update(dt);

    // Glance down at your halo: score and the night's remaining time.
    if (this.phase === 'play') {
      const left = PLAY_LEN - pt;
      const lines = [{ text: `✦ ${this.score}`, size: 64, weight: 700 }];
      lines.push({ text: left < 11 ? `dawn in ${Math.ceil(left)}…` : `${fmt(left)} until dawn`, size: 34, weight: 500, color: left < 11 ? '#ffb27a' : '#cfe9ff', glow: 'rgba(120,200,255,0.7)' });
      this.scoreLabel.show(lines);
    } else this.scoreLabel.hide();
    const sp = _w.copy(this.haloCenter).addScaledVector(fwdF, 0.5);
    sp.y = this.haloCenter.y + 0.1;
    this.scoreLabel.mesh.position.copy(sp);
    this.scoreLabel.mesh.lookAt(head);
    this.scoreLabel.update(dt);
  }
}
