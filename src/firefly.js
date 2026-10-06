import * as THREE from 'three';

export const KINDS = {
  normal: { color: new THREE.Color('#d4ff5e'), size: 0.16, value: 1, base: 0.4 },
  golden: { color: new THREE.Color('#ffc23d'), size: 0.26, value: 5, base: 0.75 },
  memory: { color: new THREE.Color('#9ef7dc'), size: 0.11, value: 0, base: 0.3 },
};

const CORE = new THREE.Color('#fffbe6');
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Firefly {
  constructor(scene, tex, kind = 'normal') {
    this.scene = scene;
    this.kind = kind;
    const k = KINDS[kind];
    this.k = k;
    this.value = k.value;
    this.color = k.color.clone();
    this.group = new THREE.Group();
    const mk = (color, opts = {}) =>
      new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, ...opts });
    this.glow = new THREE.Sprite(mk(this.color));
    this.glow.scale.setScalar(k.size);
    this.core = new THREE.Sprite(mk(CORE));
    this.core.scale.setScalar(k.size * 0.3);
    // Only drawn where real geometry is in front: the chime "sees" through walls.
    this.xray = new THREE.Sprite(mk(this.color, { depthFunc: THREE.GreaterDepth, opacity: 0 }));
    this.xray.scale.setScalar(k.size * 2.6);
    this.glow.renderOrder = 5;
    this.core.renderOrder = 6;
    this.xray.renderOrder = 7;
    this.group.add(this.glow, this.core, this.xray);
    this.group.scale.setScalar(0.001);
    scene.add(this.group);

    this.pos = this.group.position;
    this.perch = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.state = 'idle';
    this.after = 'perched';
    this.t = 0;
    this.age = 0;
    this.scale = 0;
    this.targetScale = 1;
    this.phase = Math.random() * Math.PI * 2;
    this.rate = 1.4 + Math.random() * 1.4;
    this.xrayAmt = 0;
    this.pingAt = Infinity;
    this.boost = 0;
    this.brightness = 0;
    this.dim = 1;
    this.nextChirp = 1 + Math.random() * 4;
    this.startleCD = 0;
    this.syncOffset = Math.random() * Math.PI * 2;
    this.from = new THREE.Vector3();
    this.ctrl = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.hoverTarget = new THREE.Vector3();
    this.orbit = { angle: 0, radius: 0.6, height: 0 };
  }

  get catchable() {
    return (this.state === 'perched' || this.state === 'hover' || (this.state === 'flying' && this.after === 'perched') || (this.state === 'emerging' && this.t > 0.6)) && this.kind !== 'memory';
  }

  get inField() {
    return this.kind !== 'memory' && ['emerging', 'perched', 'flying', 'hover'].includes(this.state) && this.after !== 'resting';
  }

  emergeAt(s) {
    this.perch.copy(s.pos).addScaledVector(s.normal, 0.05);
    this.normal.copy(s.normal);
    this.pos.copy(s.pos);
    this.state = 'emerging';
    this.t = 0;
  }

  restAt(p) {
    this.perch.copy(p);
    this.pos.copy(p);
    this.state = 'resting';
    this.scale = 1;
  }

  flyTo(pos, normal, after = 'perched', speed = 1.6) {
    this.from.copy(this.pos);
    this.to.copy(pos).addScaledVector(normal, 0.05);
    this.normal.copy(normal);
    const dist = this.from.distanceTo(this.to);
    this.ctrl
      .addVectors(this.from, this.to)
      .multiplyScalar(0.5)
      .add(_a.set(Math.random() - 0.5, 0.5 + Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(Math.min(1.2, 0.3 + dist * 0.4)));
    // Arc, but don't punch through the real ceiling.
    this.ctrl.y = Math.min(this.ctrl.y, Math.max(this.from.y, this.to.y) + 0.3);
    this.dur = Math.max(0.5, dist / speed);
    this.t = 0;
    this.state = 'flying';
    this.after = after;
  }

  fade() {
    this.state = 'fading';
    this.t = 0;
    this.from.copy(this.pos);
  }

  update(dt, now) {
    this.age += dt;
    this.t += dt;
    this.startleCD -= dt;
    let flash = Math.pow(Math.max(0, Math.sin(now * this.rate + this.phase)), 12);
    switch (this.state) {
      case 'emerging': {
        const k = Math.min(1, this.t / 1.2);
        this.pos.lerpVectors(_b.copy(this.perch).addScaledVector(this.normal, -0.05), this.perch, k);
        this.scale = k * k * (3 - 2 * k);
        flash = Math.max(flash, 1 - k);
        if (k >= 1) {
          this.state = 'perched';
          this.t = 0;
        }
        break;
      }
      case 'perched':
      case 'resting': {
        const slow = this.state === 'resting' ? 0.5 : 1;
        this.pos
          .copy(this.perch)
          .addScaledVector(this.normal, 0.015 * Math.sin(now * 2.1 * slow + this.phase))
          .add(_a.set(Math.sin(now * 1.3 + this.phase), Math.sin(now * 1.7 + this.phase * 2), Math.cos(now * 1.1 + this.phase)).multiplyScalar(0.012));
        this.scale += (1 - this.scale) * Math.min(1, dt * 3);
        break;
      }
      case 'hover': {
        const target = _a.copy(this.hoverTarget).add(_b.set(Math.sin(now * 1.9), Math.sin(now * 2.6) * 0.6, Math.cos(now * 1.5)).multiplyScalar(0.03));
        this.pos.lerp(target, Math.min(1, dt * 1.2));
        this.scale += (1 - this.scale) * Math.min(1, dt * 3);
        break;
      }
      case 'flying': {
        const k = Math.min(1, this.t / this.dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const u = 1 - e;
        this.pos
          .copy(this.from)
          .multiplyScalar(u * u)
          .addScaledVector(this.ctrl, 2 * u * e)
          .addScaledVector(this.to, e * e);
        flash = Math.max(flash, 0.5);
        if (k >= 1) {
          this.perch.copy(this.to);
          this.state = this.after;
          this.t = 0;
          this.arrived = true;
        }
        break;
      }
      case 'caught': {
        this.syncOffset *= Math.exp(-dt * 0.25); // caught fireflies slowly synchronize
        flash = Math.pow(Math.max(0, Math.sin(now * 2.4 + this.syncOffset)), 8);
        break;
      }
      case 'fading': {
        this.pos.y += dt * 0.4;
        this.scale = Math.max(0, 1 - this.t / 1.5);
        if (this.t > 1.5) this.state = 'gone';
        break;
      }
    }
    if (this.pingAt <= now) {
      this.pingAt = Infinity;
      this.xrayAmt = 1;
      this.boost = 1;
      this.pinged = true;
    }
    this.xrayAmt = Math.max(0, this.xrayAmt - dt * 0.45);
    this.boost = Math.max(0, this.boost - dt * 1.5);
    this.brightness = Math.min(1.4, (this.k.base + flash * 0.9 + this.boost) * this.dim);
    this.glow.material.opacity = this.brightness;
    this.core.material.opacity = Math.min(1, this.brightness * 1.2);
    this.xray.material.opacity = this.xrayAmt * 0.9;
    const s = Math.max(0.001, this.scale) * (0.9 + 0.2 * flash);
    this.group.scale.setScalar(s);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const s of [this.glow, this.core, this.xray]) s.material.dispose();
  }
}
