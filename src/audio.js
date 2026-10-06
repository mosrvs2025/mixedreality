// All sound is synthesized: spatial chirps, bells, sonar, crickets and a
// pentatonic music bed that grows richer with every firefly you keep.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// D major pentatonic
const SCALE = [62, 64, 66, 69, 71];
export const note = (step, octave = 0) => {
  const o = Math.floor(step / SCALE.length);
  const i = ((step % SCALE.length) + SCALE.length) % SCALE.length;
  return midi(SCALE[i] + 12 * (o + octave));
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicLevel = 0;
    this.beat = 0;
    this.beatTimer = 0;
    this.cricketTimer = 1;
    this.night = 0;
    this.dawn = 0;
    this.tempo = 0.34;
    this.listener = { x: 0, y: 1.6, z: 0 };
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Generated impulse response: a soft room-ish night reverb.
    const len = ctx.sampleRate * 2.8;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.wet.connect(conv).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this._startPad();
  }

  resume() {
    this.ctx?.resume?.();
  }

  get now() {
    return this.ctx.currentTime;
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // A destination node: spatial at pos, or plain stereo if pos is null.
  _out(pos, wet = 0.35) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let head = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 0.6;
      p.rolloffFactor = 1.1;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      head = p;
    }
    head.connect(this.master);
    const s = ctx.createGain();
    s.gain.value = wet;
    head.connect(s).connect(this.wet);
    return g;
  }

  _tone(dest, { freq, type = 'sine', at = 0, attack = 0.005, dur = 0.4, gain = 0.2, glide = null, detune = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dest, { at = 0, dur = 0.3, gain = 0.1, freq = 2000, q = 1, sweep = null, type = 'bandpass' }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  // ---- sound vocabulary ------------------------------------------------------

  bell(pos, step, gain = 0.22, at = 0) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.5);
    const f = note(step, 1);
    this._tone(out, { freq: f, dur: 1.6, gain, at });
    this._tone(out, { freq: f * 2.756, dur: 0.6, gain: gain * 0.35, at });
    this._tone(out, { freq: f * 5.404, dur: 0.25, gain: gain * 0.15, at });
  }

  catch(pos, combo, golden) {
    if (!this.ctx) return;
    this.bell(pos, combo, 0.24);
    this.bell(null, combo + 2, 0.08, 0.07);
    if (golden) for (let i = 0; i < 6; i++) this.bell(pos, combo + 3 + i, 0.12, 0.06 * i);
  }

  chirp(pos, golden = false, gain = 0.05) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.25);
    const base = golden ? 2600 : 3400 + Math.random() * 900;
    for (let i = 0; i < 2; i++) {
      this._tone(out, { freq: base, glide: base * 1.25, dur: 0.06, gain, at: i * 0.085, type: 'sine' });
    }
    if (golden) for (let i = 0; i < 5; i++) this._tone(out, { freq: note(5 + i, 1), dur: 0.35, gain: gain * 0.9, at: 0.18 + i * 0.05 });
  }

  sonar(pos) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.9);
    this._tone(out, { freq: 1180, glide: 520, dur: 1.1, gain: 0.16 });
    this._tone(out, { freq: 1770, glide: 780, dur: 0.8, gain: 0.05 });
    this._noise(out, { dur: 0.7, gain: 0.05, freq: 3000, sweep: 600, q: 2 });
  }

  bigSonar() {
    if (!this.ctx) return;
    const out = this._out(null, 1.0);
    this._tone(out, { freq: 90, glide: 45, dur: 3.0, gain: 0.35, attack: 0.05 });
    this._tone(out, { freq: note(0, -1), dur: 4, gain: 0.08, attack: 0.6 });
    this._tone(out, { freq: note(2, 0), dur: 4, gain: 0.05, attack: 0.9 });
    this._noise(out, { dur: 2.5, gain: 0.08, freq: 400, sweep: 5000, q: 0.8 });
  }

  emerge(pos) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.4);
    this._tone(out, { freq: 900, glide: 2400, dur: 0.35, gain: 0.04, attack: 0.2 });
  }

  startle(pos) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.2);
    for (let i = 0; i < 5; i++) this._noise(out, { at: i * 0.035, dur: 0.05, gain: 0.07, freq: 1800 + i * 300, q: 3 });
  }

  snuff(pos) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.5);
    this._tone(out, { freq: 900, glide: 220, dur: 0.7, gain: 0.07 });
    this._noise(out, { dur: 0.5, gain: 0.03, freq: 600, sweep: 150, q: 1, type: 'lowpass' });
  }

  moth(pos) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.3);
    for (let i = 0; i < 6; i++) this._noise(out, { at: i * 0.06, dur: 0.06, gain: 0.035, freq: 380 + i * 20, q: 4 });
    this._tone(out, { freq: 110, dur: 1.2, gain: 0.05, attack: 0.3 });
  }

  plink(pos, step) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.6);
    this._tone(out, { freq: note(step, 2), dur: 0.9, gain: 0.06 });
  }

  chord(steps, gain = 0.06, dur = 5) {
    if (!this.ctx) return;
    const out = this._out(null, 0.8);
    steps.forEach((s, i) => this._tone(out, { freq: note(s, 0), dur, gain, attack: 1.2, at: i * 0.12, type: 'triangle' }));
  }

  bird(pos) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.3);
    const b = 2200 + Math.random() * 1200;
    for (let i = 0; i < 3; i++) this._tone(out, { freq: b, glide: b * 1.6, dur: 0.09, gain: 0.04, at: i * 0.12 });
  }

  _cricket() {
    const a = Math.random() * Math.PI * 2;
    const r = 2.5 + Math.random() * 2;
    const L = this.listener;
    const out = this._out({ x: L.x + Math.cos(a) * r, y: 0.2, z: L.z + Math.sin(a) * r }, 0.4);
    const f = 4300 + Math.random() * 500;
    for (let i = 0; i < 3; i++) this._tone(out, { freq: f, dur: 0.03, gain: 0.03 * this.night, at: i * 0.05 });
  }

  // ---- ambient bed ---------------------------------------------------------------

  _startPad() {
    const ctx = this.ctx;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.padGain.connect(lp).connect(this.master);
    const s = ctx.createGain();
    s.gain.value = 0.6;
    lp.connect(s).connect(this.wet);
    this.padOsc = [0, 2, 4].map((st, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = note(st, -1);
      o.detune.value = (i - 1) * 6;
      o.connect(this.padGain);
      o.start();
      return o;
    });
    this.padChords = [
      [0, 2, 4],
      [-2, 1, 3],
      [-1, 2, 4],
      [-3, 0, 2],
    ];
    this.padIdx = 0;
    this.padTimer = 8;
  }

  update(dt, padLevel) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.padGain.gain.setTargetAtTime(padLevel * 0.05, t, 0.8);
    this.padTimer -= dt;
    if (this.padTimer <= 0) {
      this.padTimer = 8;
      this.padIdx = (this.padIdx + 1) % this.padChords.length;
      this.padChords[this.padIdx].forEach((st, i) => this.padOsc[i].frequency.setTargetAtTime(note(st, -1), t, 1.5));
    }
    this.cricketTimer -= dt;
    if (this.cricketTimer <= 0 && this.night > 0.2) {
      this._cricket();
      this.cricketTimer = 0.4 + Math.random() * 1.6;
    }
    // Music box: each kept firefly adds a little density to the melody.
    this.beatTimer -= dt;
    if (this.beatTimer <= 0) {
      this.beatTimer += this.tempo;
      this.beat++;
      if (this.musicLevel > 0 && Math.random() < 0.15 + this.musicLevel * 0.75) {
        const chord = this.padChords[this.padIdx];
        const step = chord[this.beat % 3] + (this.beat % 8 < 4 ? 5 : 10) + (Math.random() < 0.2 ? 1 : 0);
        const out = this._out(null, 0.6);
        this._tone(out, { freq: note(step, 0), dur: 0.9, gain: 0.025 + 0.03 * this.musicLevel, type: 'sine' });
      }
    }
  }
}
