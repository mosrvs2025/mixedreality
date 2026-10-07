// Learn mode: notes fall onto the keys like light. The song's clock WAITS for
// you — it stops at each note until you've played it — so there is no way to
// fall behind, only to take your time.
import * as THREE from 'three';
import { pitchColor } from './keyboard.js';

const SPEED = 0.13; // metres a bar falls per beat
const LEAD_IN = 2.5; // beats of falling before the first note arrives
const LOOKAHEAD = 5; // beats shown above the keys
const EARLY = 0.35; // seconds: pressing a note slightly early still counts
const BASE_Y = 0.016; // bars land just above the key tops

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Learner {
  constructor(parent) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
      220,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 36;
    this.mesh.count = 0;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.song = null;
    this.state = 'idle'; // idle | playing | done
    this.notes = [];
    this.t = 0;
    this.waiting = false;
    this.stats = { played: 0, total: 0, wrong: 0 };
    this.due = new Set();
  }

  load(song, kb) {
    this.song = song;
    this.notes = song.notes.map((n) => ({ ...n, played: false }));
    this.stats = { played: 0, total: this.notes.length, wrong: 0 };
    this.t = -LEAD_IN;
    this.state = 'playing';
    this.waiting = false;
    this.mesh.count = this.notes.length;
    this.mesh.visible = true;
    this.notes.forEach((n, i) => this.mesh.setColorAt(i, pitchColor(n.midi, new THREE.Color())));
    this.mesh.instanceColor.needsUpdate = true;
    this.kb = kb;
  }

  stop() {
    this.state = 'idle';
    this.song = null;
    this.mesh.visible = false;
    this.mesh.count = 0;
    this.due.clear();
  }

  get bps() {
    return (this.song?.bpm || 100) / 60;
  }

  // Which of your presses counts? Returns the matched note, 'wrong', or null.
  noteOn(midi) {
    if (this.state !== 'playing') return null;
    const horizon = this.t + EARLY * this.bps;
    const n = this.notes.find((x) => !x.played && x.midi === midi && x.start <= horizon);
    if (n) {
      n.played = true;
      this.stats.played++;
      if (this.stats.played === this.stats.total) this.state = 'done';
      return n;
    }
    this.stats.wrong++;
    return 'wrong';
  }

  update(dt) {
    const { kb } = this;
    this.due.clear();
    if (!this.song) return;
    if (this.state === 'playing') {
      const first = this.notes.find((n) => !n.played);
      let next = this.t + dt * this.bps;
      this.waiting = false;
      if (first && next >= first.start) {
        next = Math.max(this.t, first.start);
        this.waiting = true;
      }
      this.t = next;
      for (const n of this.notes) if (!n.played && n.start <= this.t + 0.02) this.due.add(n.midi);
    }
    // Place every bar.
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      const key = kb.byMidi.get(n.midi);
      const until = n.start - this.t;
      if (!key || n.played || until > LOOKAHEAD) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      const h = Math.max(0.014, n.dur * SPEED * 0.92);
      const y = BASE_Y + Math.max(0, until) * SPEED + h / 2;
      const zc = key.black ? (key.zMin + key.zMax) / 2 : kb.len * 0.12;
      _p.set(key.x, y, zc);
      _s.set(key.w * 0.82, h, 0.016 * kb.scale);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  summary() {
    const { played, total, wrong } = this.stats;
    return { played, total, wrong };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose?.();
    this.mesh.removeFromParent();
  }
}
