// Gloom moths: shadows that drift out of the room late in the night and eat
// the light of perched fireflies. A chime ripple, or a swat, scatters them.
import * as THREE from 'three';

const _a = new THREE.Vector3();

export class Moth {
  constructor(scene, tex, pos) {
    this.scene = scene;
    this.group = new THREE.Group();
    // A smudge of darkness: normal blending of black dims the passthrough.
    this.shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0 }));
    this.shadow.scale.setScalar(0.45);
    this.shadow.renderOrder = 4;
    this.rim = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color: new THREE.Color('#b25cff'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.rim.scale.setScalar(0.3);
    this.rim.renderOrder = 5;
    this.group.add(this.shadow, this.rim);
    scene.add(this.group);
    this.pos = this.group.position.copy(pos);
    this.vel = new THREE.Vector3();
    this.target = null;
    this.state = 'arriving';
    this.t = 0;
    this.phase = Math.random() * 10;
    this.pingAt = Infinity;
  }

  scatter(from) {
    if (this.state === 'fleeing' || this.state === 'gone') return false;
    this.state = 'fleeing';
    this.t = 0;
    this.vel.subVectors(this.pos, from).setY(0.3).normalize().multiplyScalar(2.2);
    return true;
  }

  update(dt, now) {
    this.t += dt;
    let alpha = 0.75;
    if (this.state === 'arriving') {
      alpha *= Math.min(1, this.t / 1.5);
      if (this.t > 1.5) this.state = 'hunting';
    }
    if (this.state === 'hunting' && this.target) {
      _a.subVectors(this.target.pos, this.pos);
      const d = _a.length();
      const speed = 0.28 + 0.1 * Math.sin(now * 2 + this.phase);
      this.vel.lerp(_a.normalize().multiplyScalar(Math.min(speed, d * 2)), Math.min(1, dt * 2));
    }
    if (this.state === 'fleeing') {
      alpha *= Math.max(0, 1 - this.t / 1.2);
      if (this.t > 1.2) this.state = 'gone';
    }
    // erratic moth flutter
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x += Math.sin(now * 13 + this.phase) * 0.004;
    this.pos.y += Math.sin(now * 17 + this.phase * 2) * 0.005;
    const flap = 0.8 + 0.2 * Math.abs(Math.sin(now * 14 + this.phase));
    this.shadow.material.opacity = alpha;
    this.shadow.scale.set(0.45 * flap, 0.32, 1);
    this.rim.scale.set(0.3 * flap, 0.2, 1);
    this.rim.material.opacity = alpha * 0.9 * flap;
  }

  dispose() {
    this.scene.remove(this.group);
    this.shadow.material.dispose();
    this.rim.material.dispose();
  }
}
