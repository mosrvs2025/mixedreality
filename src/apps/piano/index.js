// Piano — a holographic keyboard you place on a real table (or in the air),
// then play with all ten fingers. It remembers where you put it.
import * as THREE from 'three';
import { Label } from '../../core/fx.js';
import { Panel } from '../../platform/ui.js';
import { PersistedPose, loadSettings, saveSettings } from '../../platform/persist.js';
import { Keyboard, KEY_H, TRIGGER, RELEASE, noteName } from './keyboard.js';
import { PianoSynth, INSTRUMENTS } from './synth.js';
import { SONGS, songRange } from './songs.js';
import { Learner } from './learn.js';

const DEFAULTS = { instrument: 'grand', startMidi: 48, count: 37, scale: 1, volume: 0.6 };

// Desktop preview: type the piano. Lower row = the octave above start+12.
const KEYS_LOW = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma'];
const KEYS_HIGH = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI'];

const _inv = new THREE.Matrix4();
const _lp = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class PianoApp {
  constructor(shell) {
    this.shell = shell;
    this.root = new THREE.Group();
    this.rig = new THREE.Group(); // the placed keyboard: position + yaw
    this.root.add(this.rig);
    this.capturesKeys = true; // desktop: letters are piano keys, not "walk"
    this.capturesSpace = true; // desktop: Space is the sustain pedal
    this.state = 'restoring'; // restoring | locating | placing | playing
    this.fingers = new Map(); // tip id → { key, voice, above }
    this.keyHeld = new Map(); // desktop keyboard
    this.offs = []; // scheduled note-offs (mouse clicks)
    this.lastPulse = 0;
    this.stateT = 0;
    this.ghost = { pos: new THREE.Vector3(), yaw: 0, init: false, onSurface: false };
    this.confirm = false;
    this.pedal = false;
    this.songIdx = 0;
    this.infoKey = '';
    this.lastLit = [];
    this.notesPlayed = 0;
  }

  // ---- lifecycle ----------------------------------------------------------

  mount(now) {
    const { shell, rig } = this;
    this.settings = loadSettings('piano', DEFAULTS);
    const ac = shell.audio;
    this.synth = ac.ctx ? new PianoSynth(ac.ctx, ac.master, ac.wet) : null;
    this.synth?.setInstrument(this.settings.instrument);
    this.synth?.setVolume(this.settings.volume);
    this.kb = new Keyboard(rig, shell.glowTex, this.settings);
    this.learner = new Learner(rig);
    this.buildPanel();
    this.hint = new Label(this.root, { width: 0.7, px: 1024, aspect: 0.3, order: 55 });
    this.slot = new PersistedPose('piano', shell);
    this.rig.visible = false;
    this.state = 'restoring';
    this.stateT = 0;
    this.slot.restore().then((ok) => {
      if (this.state !== 'restoring') return;
      if (ok) {
        this.state = 'locating';
        this.stateT = 0;
      } else this.beginPlacing();
    });
  }

  unmount() {
    this.synth?.allOff();
    this.learner?.stop();
    this.fingers.clear();
    this.keyHeld.clear();
    this.offs.length = 0;
    this.shell.room.setLights([]);
  }

  beginPlacing() {
    this.state = 'placing';
    this.stateT = 0;
    this.confirm = false;
    this.ghost.init = false;
    this.rig.visible = true;
    this.kb.setOpacity(0.5);
    this.learner.mesh.visible = false;
    this.panel.group.visible = false;
    this.placePanel.group.visible = true;
    this.synth?.allOff();
    this.fingers.clear();
    this.shell.audio.ui('open');
  }

  // A controller trigger (or a palm-away pinch) confirms where the piano goes.
  onSelect() {
    if (this.state === 'placing') this.confirm = true;
  }

  // ---- the controls panel -----------------------------------------------------

  buildPanel() {
    const { shell, rig } = this;
    const P = (this.panel = new Panel(shell, rig));
    P.addBacking(0.58, 0.2, 0, 0.02);
    this.info = new Label(P.group, { width: 0.54, px: 1024, aspect: 0.14, order: 56 });
    this.info.mesh.position.set(0, 0.095, 0.002);
    const row = (y, defs, gap = 0.008) => {
      const total = defs.reduce((s, d) => s + d.w, 0) + gap * (defs.length - 1);
      let x = -total / 2;
      for (const d of defs) {
        P.add({ ...d, h: d.h ?? 0.046, x: x + d.w / 2, y });
        x += d.w + gap;
      }
    };
    const inst = () => INSTRUMENTS.find((i) => i.id === this.settings.instrument) || INSTRUMENTS[0];
    row(0.04, [
      { id: 'inst', w: 0.17, label: inst().short, sub: 'sound', color: '#8fb4ff', onPress: () => this.cycleInstrument() },
      { id: 'octdn', w: 0.07, label: 'Oct −', color: '#8fb4ff', onPress: () => this.shiftOctave(-1) },
      { id: 'octup', w: 0.07, label: 'Oct +', color: '#8fb4ff', onPress: () => this.shiftOctave(1) },
      { id: 'sizedn', w: 0.07, label: 'Size −', color: '#8fb4ff', onPress: () => this.resize(-0.15) },
      { id: 'sizeup', w: 0.07, label: 'Size +', color: '#8fb4ff', onPress: () => this.resize(0.15) },
    ]);
    row(-0.02, [
      { id: 'songdn', w: 0.05, label: '◀', color: '#ffd27a', onPress: () => this.pickSong(-1) },
      { id: 'song', w: 0.15, label: 'Free play', sub: 'tap to learn a song', color: '#ffd27a', onPress: () => this.pickSong(0) },
      { id: 'songup', w: 0.05, label: '▶', color: '#ffd27a', onPress: () => this.pickSong(1) },
      { id: 'pedal', w: 0.08, label: 'Pedal', toggle: true, color: '#a6ffcf', onPress: (b) => this.setPedal(b.active) },
      { id: 'move', w: 0.07, label: 'Move', color: '#ffb59a', onPress: () => this.beginPlacing() },
      { id: 'home', w: 0.07, label: 'Home', color: '#ff9a9a', onPress: () => this.shell.goHome() },
    ]);

    // "Place here" floats over the ghost keyboard while you choose a spot.
    const PP = (this.placePanel = new Panel(shell, rig));
    PP.add({ id: 'place', w: 0.2, h: 0.055, label: 'Place here', color: '#a6ffcf', onPress: () => (this.confirm = true) });
    PP.group.position.set(0, 0.13, 0.02);
    PP.group.visible = false;
  }

  cycleInstrument() {
    const i = INSTRUMENTS.findIndex((x) => x.id === this.settings.instrument);
    const next = INSTRUMENTS[(i + 1) % INSTRUMENTS.length];
    this.settings.instrument = next.id;
    this.synth?.allOff();
    this.synth?.setInstrument(next.id);
    this.panel.get('inst').set({ label: next.short });
    this.save();
    this.preview(this.kb.startMidi + 12 + 4);
  }

  // Play a short note so a change (sound, octave) can be heard straight away.
  preview(midi) {
    const key = this.kb.byMidi.get(midi);
    if (!key || !this.synth) return;
    const v = this.synth.noteOn(midi, 0.6);
    this.offs.push({ t: performance.now() + 450, voice: v });
  }

  shiftOctave(d) {
    const next = THREE.MathUtils.clamp(this.settings.startMidi + 12 * d, 24, 72);
    if (next === this.settings.startMidi) return;
    this.settings.startMidi = next;
    this.rebuild();
    this.preview(next + 12);
  }

  resize(d) {
    this.settings.scale = THREE.MathUtils.clamp(+(this.settings.scale + d).toFixed(2), 0.7, 2);
    this.rebuild();
  }

  rebuild() {
    this.synth?.allOff();
    this.fingers.clear();
    this.kb.build({ startMidi: this.settings.startMidi, count: this.settings.count, scale: this.settings.scale });
    this.kb.setOpacity(this.state === 'placing' ? 0.5 : 1);
    this.panel.group.position.set(0, 0.19 * Math.max(1, this.settings.scale * 0.9), -0.2 * this.settings.scale);
    if (this.learner.song) this.learner.load(this.learner.song, this.kb);
    this.save();
    this.infoKey = '';
  }

  save() {
    saveSettings('piano', this.settings);
  }

  setPedal(on) {
    this.pedal = on;
    this.synth?.setSustain(on);
    const b = this.panel.get('pedal');
    if (b.active !== on) b.set({ active: on });
  }

  // ---- learn mode ---------------------------------------------------------------

  // ◀ / ▶ step through [free play, song 1, song 2, …]; tapping the title starts
  // the first song from free play, or restarts the current one.
  pickSong(d) {
    const n = SONGS.length + 1;
    if (d === 0) {
      if (this.songIdx === 0) this.songIdx = 1;
    } else this.songIdx = (this.songIdx + d + n) % n;
    this.startSong();
  }

  startSong() {
    const song = SONGS[this.songIdx - 1];
    const b = this.panel.get('song');
    this.synth?.allOff();
    if (!song) {
      this.learner.stop();
      b.set({ label: 'Free play', sub: 'tap to learn a song' });
      this.kb.setTarget(new Set());
      this.infoKey = '';
      return;
    }
    // Slide the keyboard's range so the whole song fits.
    const { lo, hi } = songRange(song);
    let start = this.settings.startMidi;
    if (lo < start || hi > start + 36) {
      start = THREE.MathUtils.clamp(12 * Math.floor(lo / 12) - 12, 24, 72);
      this.settings.startMidi = start;
      this.rebuild();
    }
    this.learner.load(song, this.kb);
    this.doneShown = false;
    b.set({ label: song.title, sub: `${song.level} · tap to restart` });
    this.infoKey = '';
  }

  // ---- notes ----------------------------------------------------------------------

  noteOn(key, vel, source, now) {
    const voice = this.synth?.noteOn(key.midi, vel);
    key.lit = 1;
    key.pressTarget = 1;
    this.notesPlayed++;
    const pos = this.kb.keyWorld(key, new THREE.Vector3());
    const { shell } = this;
    shell.particles.burst(pos, key.hue, 6 + Math.round(vel * 10), 0.25 + vel * 0.35, { gravity: 0.12, size: 0.01 });
    // Sound made visible: a ripple of that note's colour rolls across your real room.
    if (now - this.lastPulse > 0.09) {
      this.lastPulse = now;
      shell.room.addPulse(pos, now, key.hue, 0.35 + vel * 0.9);
    }
    shell.haptic(source, 0.15 + vel * 0.45, 22);
    const r = this.learner.noteOn(key.midi);
    if (r && r !== 'wrong') {
      shell.particles.burst(pos.clone().add(new THREE.Vector3(0, 0.03, 0)), key.hue, 24, 0.7, { gravity: 0.05, size: 0.014 });
      this.infoKey = '';
    } else if (r === 'wrong') this.infoKey = '';
    return voice;
  }

  noteOff(key, voice) {
    this.synth?.noteOff(voice);
    if (key.voices) key.voices.delete(voice);
    if (!key.fingers.size && !this.keyHeld.has(key.midi)) key.pressTarget = 0;
  }

  // Every fingertip is a player. A tip presses a key when it crosses the key's
  // top coming from above, and lets go when it lifts clear again.
  processTips(tips, now) {
    const { kb } = this;
    const sc = kb.scale;
    _inv.copy(this.rig.matrixWorld).invert();
    const seen = new Set();
    for (const tip of tips) {
      seen.add(tip.id);
      _lp.copy(tip.pos).applyMatrix4(_inv);
      let st = this.fingers.get(tip.id);
      const k = kb.keyAt(_lp.x, _lp.y, _lp.z);
      if (st?.key) {
        const held = st.key;
        if (!k || _lp.y > held.top + RELEASE * sc) {
          this._lift(tip.id, st);
          if (_lp.y > TRIGGER * sc + 0.012) this._markAbove(st, now);
        } else if (k !== held) {
          // dragged across the keys while still pressing: glissando
          this._lift(tip.id, st);
          this._press(tip, k, 0.4, now);
        }
        continue;
      }
      if (!st) this.fingers.set(tip.id, (st = { key: null, aboveAt: -1, aboveFrame: -99 }));
      if (_lp.y > TRIGGER * sc + 0.012) this._markAbove(st, now);
      // A press is a deliberate move DOWN onto a key: the fingertip must have been
      // clear above the keys within the last moment. (So a hand resting or sliding in
      // low over a real table never sounds a note.)
      if (k && (now - st.aboveAt < 0.25 || this.frame - st.aboveFrame <= 2)) {
        const down = Math.max(0, -tip.vel.y);
        const vel = THREE.MathUtils.clamp(0.22 + (0.78 * down) / 1.1, 0.22, 1);
        this._press(tip, k, vel, now);
        st.aboveAt = -1;
        st.aboveFrame = -99;
      }
    }
    // fingers that vanished (hand lost) let go
    for (const [id, st] of this.fingers) {
      if (!seen.has(id)) {
        if (st.key) this._lift(id, st);
        this.fingers.delete(id);
      }
    }
  }

  _markAbove(st, now) {
    st.aboveAt = now;
    st.aboveFrame = this.frame;
  }

  _press(tip, key, vel, now) {
    const st = this.fingers.get(tip.id);
    if (key.fingers.has(tip.id)) return;
    if (now - (key.lastOn || 0) < 0.05) return;
    key.lastOn = now;
    key.fingers.add(tip.id);
    st.key = key;
    st.voice = this.noteOn(key, vel, tip.source, now);
  }

  _lift(id, st) {
    const key = st.key;
    key.fingers.delete(id);
    this.noteOff(key, st.voice);
    st.key = null;
    st.voice = null;
  }

  // ---- desktop preview input --------------------------------------------------------

  onKey(code, down) {
    if (code === 'Space') {
      this.setPedal(down);
      return true;
    }
    if (this.state !== 'playing' || !this.kb) return false;
    let idx = KEYS_LOW.indexOf(code);
    let base = this.kb.startMidi + 12;
    if (idx < 0) {
      idx = KEYS_HIGH.indexOf(code);
      base += 12;
    }
    if (idx < 0) return false;
    const key = this.kb.byMidi.get(base + idx);
    if (!key) return true;
    const now = performance.now() / 1000;
    if (down && !this.keyHeld.has(key.midi)) {
      this.keyHeld.set(key.midi, this.noteOn(key, 0.7, null, now));
    } else if (!down && this.keyHeld.has(key.midi)) {
      const v = this.keyHeld.get(key.midi);
      this.keyHeld.delete(key.midi);
      this.noteOff(key, v);
    }
    return true;
  }

  // The mouse clicks a key (desktop preview).
  processPointer(now) {
    const ptr = this.shell.pointer;
    if (!ptr?.clicked) return;
    const rc = (this._rc ??= new THREE.Raycaster());
    rc.ray.copy(ptr.ray);
    this.rig.updateMatrixWorld(true);
    const blacks = this.kb.keys.filter((k) => k.black).map((k) => k.mesh);
    const whites = this.kb.keys.filter((k) => !k.black).map((k) => k.mesh);
    const hit = rc.intersectObjects(blacks, false)[0] || rc.intersectObjects(whites, false)[0];
    if (!hit) return;
    const key = this.kb.keys.find((k) => k.mesh === hit.object);
    if (!key) return;
    const v = this.noteOn(key, 0.75, null, now);
    this.offs.push({ t: performance.now() + 380, voice: v, key });
  }

  // ---- placement ----------------------------------------------------------------------

  // Where would the keyboard go right now? A real table you're looking at, else
  // floating at a comfortable height in front of you.
  aimPlacement() {
    const { shell } = this;
    const { head, fwd } = shell.input;
    let origin = head;
    let dir = fwd;
    if (shell.pointer?.ray) {
      origin = shell.pointer.ray.origin;
      dir = shell.pointer.ray.direction;
    } else {
      const c = shell.input.tips.filter((t) => t.ray).sort((a, b) => (a.side === 'right' ? 0 : 1) - (b.side === 'right' ? 0 : 1))[0];
      if (c) {
        origin = c.ray.origin;
        dir = c.ray.dir;
      }
    }
    const hit = shell.room.raycast(origin, dir, 3);
    const g = this.ghost;
    const scale = this.settings.scale;
    let pos;
    let surface = false;
    if (hit && hit.normal.y > 0.85 && hit.point.y > 0.3 && hit.point.y < 1.4) {
      pos = hit.point.clone();
      pos.y += KEY_H * scale;
      surface = true;
    } else {
      const f = _v.set(fwd.x, 0, fwd.z);
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      pos = new THREE.Vector3(head.x, THREE.MathUtils.clamp(head.y - 0.68, 0.55, 1.05), head.z).addScaledVector(f, 0.55);
    }
    // keys' front edge (+z) should face the player
    const yaw = Math.atan2(head.x - pos.x, head.z - pos.z);
    if (!g.init) {
      g.pos.copy(pos);
      g.yaw = yaw;
      g.init = true;
    } else {
      g.pos.lerp(pos, 0.25);
      let d = yaw - g.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.yaw += d * 0.25;
    }
    g.onSurface = surface;
    this.rig.position.copy(g.pos);
    this.rig.rotation.set(0, g.yaw, 0);
  }

  finalizePlacement(now) {
    const { shell } = this;
    this.state = 'playing';
    this.stateT = 0;
    this.kb.setOpacity(1);
    this.panel.group.visible = true;
    this.placePanel.group.visible = false;
    this.rig.updateMatrixWorld(true);
    const m = this.rig.matrixWorld.clone();
    this.slot.save(shell.frame, shell.refSpace, m, { surface: this.ghost.onSurface }).then((ok) => {
      this.persisted = ok;
      this.infoKey = '';
    });
    shell.audio.ui('place');
    const pos = this.rig.position.clone();
    shell.particles.burst(pos.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Color('#a6ffcf'), 60, 0.8, { gravity: 0 });
    shell.room.addPulse(pos, now, new THREE.Color('#a6ffcf'), 1);
    this.toast = { text: 'Your piano is set', sub: this.slot.supported ? 'it will be right here next time' : 'play it!', until: now + 3.2 };
  }

  applyPose(m) {
    // Keep the keyboard level whatever the anchor reports: only position + yaw.
    m.decompose(this.rig.position, _q, _s);
    _e.setFromQuaternion(_q, 'YXZ');
    this.rig.rotation.set(0, _e.y, 0);
  }

  // ---- per frame ----------------------------------------------------------------------

  update(dt, now) {
    const { shell, kb } = this;
    const input = shell.input;
    this.stateT += dt;
    this.frame = (this.frame || 0) + 1;
    this.rig.updateMatrixWorld(true);

    // scheduled note-offs (previews, mouse clicks)
    const t = performance.now();
    for (let i = this.offs.length - 1; i >= 0; i--) {
      if (this.offs[i].t <= t) {
        const o = this.offs.splice(i, 1)[0];
        if (o.key) this.noteOff(o.key, o.voice);
        else this.synth?.noteOff(o.voice);
      }
    }

    if (this.state === 'restoring') {
      this.setHint(['Finding your piano…'], now);
    } else if (this.state === 'locating') {
      const pose = this.slot.pose(shell.frame, shell.refSpace, _m);
      if (pose) {
        this.applyPose(pose);
        this.rig.visible = true;
        this.state = 'playing';
        this.stateT = 0;
        shell.audio.ui('place');
        this.toast = { text: 'Welcome back', sub: 'your piano stayed where you left it', until: now + 3.2 };
      } else if (this.stateT > 6) {
        this.slot.forget();
        this.beginPlacing();
      } else this.setHint(['Looking for your piano…', 'glance around the room'], now);
    } else if (this.state === 'placing') {
      this.aimPlacement();
      kb.setOpacity(0.45 + 0.1 * Math.sin(now * 4));
      const fist = input.hands.some((h) => h.fistStart);
      const clicked = !!shell.pointer?.clicked;
      if (this.stateT > 1 && (this.confirm || fist || clicked)) this.finalizePlacement(now);
      else {
        this.confirm = false;
        const ctrl = input.hands.some((h) => h.kind === 'controller');
        this.setHint(
          [this.ghost.onSurface ? 'A good spot' : 'Look at a table — or choose a spot in the air', shell.sim ? 'click to place' : ctrl ? 'pull the trigger to place' : 'make a fist, or touch Place here'],
          now,
        );
      }
    } else if (this.state === 'playing') {
      if (this.slot.anchor && !shell.sim) {
        const pose = this.slot.pose(shell.frame, shell.refSpace, _m);
        if (pose) this.applyPose(pose);
      } else if (shell.sim && this.slot.rec && this.stateT < 0.1) {
        this.applyPose(_m.fromArray(this.slot.rec.m));
        this.rig.visible = true;
      }
      this.rig.updateMatrixWorld(true);
      if (shell.sim) {
        this.processPointer(now);
      } else {
        this.processTips(input.tips, now);
        // Squeezing a controller grip is the sustain pedal.
        const grip = input.hands.some((h) => h.kind === 'controller' && h.cradle);
        if (grip !== !!this.gripDown) {
          this.gripDown = grip;
          this.setPedal(grip);
        }
      }
      this.learner.update(dt);
      kb.setTarget(this.learner.due);
      this.updateInfo(now);
      if (this.toast && now < this.toast.until) this.setHint([this.toast.text, this.toast.sub], now);
      else this.setHint(null, now);
      if (this.learner.state === 'done' && !this.doneShown) this.celebrate(now);
    }

    // sound comes from the keys themselves
    kb.group.getWorldPosition(_v);
    this.synth?.setPosition(_v);
    kb.update(dt, now);
    this.updateLights();

    // panels face you
    if (this.panel.group.visible) {
      this.panel.group.position.set(0, 0.19 * Math.max(1, this.settings.scale * 0.9), -0.2 * this.settings.scale);
      this.panel.group.lookAt(input.head);
      this.panel.update(dt, now);
      this.info.update(dt);
    }
    if (this.placePanel.group.visible) {
      this.placePanel.group.lookAt(input.head);
      this.placePanel.update(dt, now);
    }
    this.hint.update(dt);
    this.positionHint(input);
  }

  updateInfo(now) {
    const inst = INSTRUMENTS.find((i) => i.id === this.settings.instrument);
    const lo = noteName(this.kb.startMidi);
    const hi = noteName(this.kb.endMidi);
    const L = this.learner;
    const s = L.summary();
    const key = `${inst.id}|${lo}|${hi}|${L.state}|${s.played}|${s.wrong}|${this.persisted}|${this.pedal}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    const lines = [];
    if (L.song && L.state === 'playing') {
      lines.push({ text: `${L.song.title}   ${s.played}/${s.total}`, size: 62, weight: 700 });
      lines.push({ text: L.waiting ? 'play the glowing key' : 'get ready…', size: 40, weight: 500, color: '#bfe9ff', glow: 'rgba(120,200,255,0.8)' });
    } else if (L.state === 'done') {
      lines.push({ text: `${L.song.title} — complete`, size: 58, weight: 700 });
      lines.push({ text: s.wrong === 0 ? 'perfect!' : `${s.wrong} wrong note${s.wrong === 1 ? '' : 's'} along the way`, size: 40, weight: 500, color: '#bfe9ff', glow: 'rgba(120,200,255,0.8)' });
    } else {
      lines.push({ text: `${inst.name}   ${lo}–${hi}`, size: 58, weight: 700 });
      lines.push({ text: 'play with all ten fingers', size: 40, weight: 500, color: '#bfe9ff', glow: 'rgba(120,200,255,0.8)' });
    }
    this.info.show(lines);
  }

  celebrate(now) {
    this.doneShown = true;
    const { shell, kb } = this;
    const hues = kb.keys.filter((k) => !k.black);
    for (let i = 0; i < 14; i++) {
      const k = hues[(i * 5) % hues.length];
      setTimeout(() => {
        const p = kb.keyWorld(k, new THREE.Vector3()).add(new THREE.Vector3(0, 0.12 + Math.random() * 0.15, 0));
        shell.particles.burst(p, k.hue, 40, 0.9, { gravity: 0.08, size: 0.016 });
      }, i * 110);
    }
    const root = this.learner.song.notes[0]?.midi ?? 60;
    for (const [i, off] of [0, 4, 7, 12].entries()) {
      const key = kb.byMidi.get(root - (root % 12) + 12 + off) || kb.byMidi.get(root);
      if (key) setTimeout(() => this.preview(key.midi), 300 + i * 90);
    }
    shell.room.addPulse(this.rig.position, now, new THREE.Color('#ffd27a'), 1.2);
    this.infoKey = '';
  }

  updateLights() {
    const list = [];
    for (const k of this.kb.keys) {
      if (k.lit < 0.15) continue;
      list.push({ pos: this.kb.keyWorld(k, new THREE.Vector3()), intensity: k.lit * 0.7, color: k.hue });
      if (list.length >= 10) break;
    }
    this.shell.room.setLights(list);
  }

  // ---- floating text -----------------------------------------------------------------

  setHint(lines, now) {
    if (!lines) {
      this.hint.hide();
      return;
    }
    const out = [{ text: lines[0], size: 84, weight: 700 }];
    if (lines[1]) out.push({ text: lines[1], size: 50, weight: 500, color: '#bfe9ff', glow: 'rgba(120,200,255,0.8)' });
    this.hint.show(out);
  }

  positionHint(input) {
    const p = this.rig.position;
    this.hint.mesh.position.set(p.x, p.y + 0.6, p.z);
    this.hint.mesh.lookAt(input.head);
  }

  debugLines(line, ok) {
    return [
      line(`piano: ${this.state} · ${this.kb?.count} keys · ${this.notesPlayed} notes`),
      line(`anchor: ${this.slot?.anchor ? 'tracking' : this.slot?.hasSaved ? 'saved' : 'none'} · ${this.persisted ? 'persisted' : 'not persisted'}`, ok(this.slot?.anchor || this.shell.sim)),
      line(`fingers: ${[...this.fingers.values()].filter((f) => f.key).length} down / ${this.shell.input.tips.length} tracked`),
    ];
  }
}

export default {
  id: 'piano',
  name: 'Piano',
  tagline: 'play in your room',
  kind: 'mr',
  color: '#7fb8ff',
  simHelp: 'Desktop preview · click to place · click keys, or type: Z X C V B N M (low) · Q W E R T Y U (high) · S D G H J / 2 3 5 6 7 = black keys · Space = pedal · Esc = hub',
  paint(ctx, W, H) {
    // A little keyboard.
    const kw = W * 0.1;
    const x0 = W * 0.5 - kw * 3;
    const y0 = H * 0.3;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i === 2 ? 'rgba(255,210,122,0.95)' : 'rgba(236,243,255,0.9)';
      ctx.fillRect(x0 + i * kw + 2, y0, kw - 4, H * 0.42);
    }
    ctx.fillStyle = 'rgba(8,12,34,0.95)';
    for (const i of [0, 1, 3, 4]) ctx.fillRect(x0 + (i + 1) * kw - kw * 0.3, y0, kw * 0.6, H * 0.26);
    // a glowing note
    const g = ctx.createRadialGradient(x0 + kw * 2.5, y0 - H * 0.08, 1, x0 + kw * 2.5, y0 - H * 0.08, W * 0.12);
    g.addColorStop(0, 'rgba(255,230,160,0.95)');
    g.addColorStop(1, 'rgba(255,210,122,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x0 + kw * 2.5, y0 - H * 0.08, W * 0.12, 0, Math.PI * 2);
    ctx.fill();
  },
  create: (shell) => new PianoApp(shell),
};
