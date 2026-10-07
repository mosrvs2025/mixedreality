// Piano synthesis. No samples: every note is built from a few oscillators,
// a brightness filter that darkens as the note decays, and a two-stage
// loudness envelope (fast initial drop, long tail) which is what makes a
// struck string sound like a piano rather than an organ.
//
// All voices share one bus that is spatialised (HRTF) at the keyboard, so the
// music comes from the keys in your room, with a send into the room reverb.

export const INSTRUMENTS = [
  { id: 'grand', name: 'Grand Piano', short: 'Grand' },
  { id: 'epiano', name: 'Electric Piano', short: 'E-Piano' },
  { id: 'bells', name: 'Music Box', short: 'Music Box' },
  { id: 'pad', name: 'Glow Pad', short: 'Glow Pad' },
];

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const MAX_VOICES = 24;

export class PianoSynth {
  // ctx: AudioContext · master: node for the dry/spatial mix · wet: reverb send node
  constructor(ctx, master, wet, { spatial = true } = {}) {
    this.ctx = ctx;
    this.instrument = 'grand';
    this.sustain = false;
    this.voices = new Set();
    this.volume = 0.6;

    this.bus = ctx.createGain();
    this.bus.gain.value = this.volume;
    if (spatial && ctx.createPanner) {
      this.panner = ctx.createPanner();
      this.panner.panningModel = 'HRTF';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 0.8;
      this.panner.rolloffFactor = 0.8;
      this.bus.connect(this.panner);
      this.panner.connect(master);
      this.send = ctx.createGain();
      this.send.gain.value = 0.28;
      this.panner.connect(this.send);
    } else {
      this.bus.connect(master);
      this.send = ctx.createGain();
      this.send.gain.value = 0.28;
      this.bus.connect(this.send);
    }
    if (wet) this.send.connect(wet);

    // noise for the hammer thump
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // A harmonic series with the gentle upper-partial roll-off of a struck string.
    const N = 14;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let n = 1; n < N; n++) imag[n] = Math.pow(n, -1.15) * (n % 2 === 0 ? 0.9 : 1) * (n > 8 ? 0.6 : 1);
    this.waveString = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  setPosition(p) {
    const pn = this.panner;
    if (!pn) return;
    const t = this.ctx.currentTime;
    if (pn.positionX) {
      pn.positionX.setTargetAtTime(p.x, t, 0.03);
      pn.positionY.setTargetAtTime(p.y, t, 0.03);
      pn.positionZ.setTargetAtTime(p.z, t, 0.03);
    } else pn.setPosition(p.x, p.y, p.z);
  }

  setVolume(v) {
    this.volume = v;
    this.bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setInstrument(id) {
    if (INSTRUMENTS.some((i) => i.id === id)) this.instrument = id;
  }

  // ---- playing ----------------------------------------------------------------

  noteOn(midi, velocity = 0.7, when = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const vel = Math.max(0.05, Math.min(1, velocity));
    if (this.voices.size >= MAX_VOICES) this._steal(t);
    const build = { grand: this._grand, epiano: this._epiano, bells: this._bells, pad: this._pad }[this.instrument];
    const v = build.call(this, midi, vel, t);
    v.midi = midi;
    v.held = true;
    v.sustained = false;
    v.t0 = t;
    this.voices.add(v);
    return v;
  }

  noteOff(v, when = 0) {
    if (!v || v.released) return;
    v.held = false;
    if (this.sustain) {
      v.sustained = true;
      return;
    }
    this._release(v, this.ctx.currentTime + when);
  }

  setSustain(on) {
    this.sustain = on;
    if (!on) for (const v of this.voices) if (v.sustained && !v.held) this._release(v, this.ctx.currentTime);
  }

  allOff() {
    for (const v of [...this.voices]) this._release(v, this.ctx.currentTime, 0.05);
  }

  _steal(t) {
    let oldest = null;
    for (const v of this.voices) if (!v.released && (!oldest || v.t0 < oldest.t0)) oldest = v;
    if (oldest) this._release(oldest, t, 0.04);
  }

  _release(v, t, tau = null) {
    if (v.released) return;
    v.released = true;
    const g = v.env.gain;
    const cur = Math.max(g.value, 0.0001); // read before cancelling the automation
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    const rel = tau ?? v.releaseTau;
    g.setTargetAtTime(0, t, rel);
    const end = t + rel * 7 + 0.05;
    for (const o of v.oscs) {
      try {
        o.stop(end);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => this.voices.delete(v), Math.max(50, (end - this.ctx.currentTime) * 1000));
  }

  // ---- instruments ------------------------------------------------------------

  _finish(v, oscs, env) {
    v.oscs = oscs;
    v.env = env;
    // a voice that ends on its own (long decay) cleans itself up
    oscs[0].onended = () => {
      v.released = true;
      this.voices.delete(v);
      try {
        env.disconnect();
      } catch {
        /* ignore */
      }
    };
    return v;
  }

  _thump(t, hz, vel, gain = 0.05) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = Math.min(6000, Math.max(1200, hz * 3));
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.05);
  }

  _grand(midi, vel, t) {
    const ctx = this.ctx;
    const hz = midiToHz(midi);
    const env = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 0.6;
    // Bright on the strike, mellowing as it rings.
    filt.frequency.setValueAtTime(Math.min(15000, hz * (2.5 + vel * 11)), t);
    filt.frequency.setTargetAtTime(Math.max(hz * 1.9, 500), t, 0.35 + 0.5 * (1 - vel));
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.setPeriodicWave(this.waveString);
    b.setPeriodicWave(this.waveString);
    a.frequency.value = hz;
    b.frequency.value = hz;
    a.detune.value = -3;
    b.detune.value = 3;
    const bg = ctx.createGain();
    bg.gain.value = 0.7;
    a.connect(filt);
    b.connect(bg).connect(filt);
    filt.connect(env).connect(this.bus);

    const comp = 1.15 - Math.max(0, midi - 48) / 90; // keep the top end from piercing
    const peak = (0.1 + 0.34 * Math.pow(vel, 1.25)) * comp;
    const tail = 2.6 * Math.exp(-(midi - 36) / 32) + 0.35;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.004);
    env.gain.setTargetAtTime(peak * 0.4, t + 0.004, 0.08);
    env.gain.setTargetAtTime(0.0001, t + 0.3, tail);
    a.start(t);
    b.start(t);
    const end = t + 0.3 + tail * 7;
    a.stop(end);
    b.stop(end);
    this._thump(t, hz, vel);
    return this._finish({ releaseTau: 0.035 + 0.13 * Math.exp(-(midi - 36) / 30) }, [a, b], env);
  }

  _epiano(midi, vel, t) {
    const ctx = this.ctx;
    const hz = midiToHz(midi);
    const env = ctx.createGain();
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const tine = ctx.createOscillator();
    const tineG = ctx.createGain();
    car.frequency.value = hz;
    mod.frequency.value = hz;
    tine.frequency.value = hz * 7;
    mod.connect(modG).connect(car.frequency);
    // FM index swells on the strike and relaxes: the "bark" of a Rhodes.
    const idx = hz * (0.5 + 2.4 * vel);
    modG.gain.setValueAtTime(idx, t);
    modG.gain.setTargetAtTime(idx * 0.12, t, 0.22);
    tine.connect(tineG).connect(env);
    tineG.gain.setValueAtTime(0.07 * vel, t);
    tineG.gain.setTargetAtTime(0, t, 0.06);
    car.connect(env);
    env.connect(this.bus);
    const peak = 0.12 + 0.3 * vel;
    const tail = 1.6 * Math.exp(-(midi - 36) / 40) + 0.3;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.003);
    env.gain.setTargetAtTime(peak * 0.5, t + 0.003, 0.12);
    env.gain.setTargetAtTime(0.0001, t + 0.35, tail);
    const end = t + 0.35 + tail * 7;
    for (const o of [car, mod, tine]) {
      o.start(t);
      o.stop(end);
    }
    return this._finish({ releaseTau: 0.12 }, [car, mod, tine], env);
  }

  _bells(midi, vel, t) {
    const ctx = this.ctx;
    const hz = midiToHz(midi);
    const env = ctx.createGain();
    env.connect(this.bus);
    const oscs = [];
    // inharmonic partials of a struck tine, each with its own short life
    for (const [ratio, level, tau] of [[1, 1, 1.3], [2.756, 0.38, 0.5], [5.404, 0.14, 0.22], [8.93, 0.05, 0.1]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = hz * ratio;
      g.gain.setValueAtTime(level * (0.1 + 0.28 * vel), t);
      g.gain.setTargetAtTime(0.0001, t + 0.004, tau);
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + tau * 8 + 0.1);
      oscs.push(o);
    }
    env.gain.value = 1;
    return this._finish({ releaseTau: 0.5 }, oscs, env);
  }

  _pad(midi, vel, t) {
    const ctx = this.ctx;
    const hz = midiToHz(midi);
    const env = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(hz * 1.5, t);
    filt.frequency.setTargetAtTime(Math.min(9000, hz * (3 + vel * 5)), t, 0.4);
    filt.Q.value = 1.2;
    const oscs = [];
    for (const [type, mult, det, lvl] of [['sawtooth', 1, -6, 0.5], ['sawtooth', 1, 6, 0.5], ['sine', 0.5, 0, 0.7]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = hz * mult;
      o.detune.value = det;
      g.gain.value = lvl;
      o.connect(g).connect(filt);
      o.start(t);
      oscs.push(o);
    }
    filt.connect(env).connect(this.bus);
    const peak = 0.05 + 0.1 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.14);
    return this._finish({ releaseTau: 0.45 }, oscs, env);
  }
}
