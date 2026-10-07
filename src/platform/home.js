// The "home" button: a small glass orb that rides on the back of your left wrist
// (or above a controller). Touch it with a finger of the other hand and hold
// for a moment to return to the launcher. The hold makes it impossible to
// trigger by accident while you're playing.
import * as THREE from 'three';
import { Label } from '../core/fx.js';

const HOLD = 0.9; // seconds
const REACH = 0.05; // metres

const ringVert = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const ringFrag = /* glsl */ `
  uniform float uProgress;
  uniform float uAlpha;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    if (r < 0.027 || r > 0.034) discard;
    float a = atan(vP.x, vP.y) / 6.2831853;
    a = a < 0.0 ? a + 1.0 : a;
    float on = step(a, uProgress);
    vec3 col = mix(vec3(0.45, 0.6, 1.0), vec3(0.7, 1.0, 0.8), on);
    gl_FragColor = vec4(col, uAlpha * mix(0.25, 1.0, on));
  }
`;

function orbTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(96, 96, 8, 96, 96, 92);
  g.addColorStop(0, 'rgba(60,80,170,0.95)');
  g.addColorStop(0.8, 'rgba(14,20,56,0.92)');
  g.addColorStop(1, 'rgba(120,160,255,0.9)');
  x.fillStyle = g;
  x.beginPath();
  x.arc(96, 96, 90, 0, Math.PI * 2);
  x.fill();
  // a little house
  x.fillStyle = '#f2f6ff';
  x.beginPath();
  x.moveTo(96, 48);
  x.lineTo(142, 92);
  x.lineTo(126, 92);
  x.lineTo(126, 138);
  x.lineTo(66, 138);
  x.lineTo(66, 92);
  x.lineTo(50, 92);
  x.closePath();
  x.fill();
  x.fillStyle = 'rgba(14,20,56,0.95)';
  x.fillRect(88, 104, 16, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class HomeOrb {
  constructor(shell) {
    this.shell = shell;
    this.group = new THREE.Group();
    this.tex = orbTexture();
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.055), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      transparent: true,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), this.ringMat);
    this.disc.renderOrder = this.ring.renderOrder = 45;
    this.group.add(this.disc, this.ring);
    this.group.visible = false;
    shell.scene.add(this.group);
    this.label = new Label(shell.scene, { width: 0.22, px: 512, aspect: 0.3, order: 46 });
    this.label.draw([{ text: 'hold to go home', size: 70, weight: 600 }]);
    this.progress = 0;
    this.alpha = 0;
    this.shownFor = 0;
    this.pos = new THREE.Vector3();
    this.hasPos = false;
    this.fired = false;
  }

  // Where does the orb live right now? On the back of the left wrist, else right.
  _anchor() {
    const hs = this.shell.input.hands;
    for (const side of ['left', 'right']) {
      const palm = hs.find((h) => h.side === side && h.normal && h.wrist);
      if (palm) {
        const p = palm.wrist.clone().addScaledVector(palm.normal, -0.055).addScaledVector(palm.forearm, 0.035);
        return { pos: p, side };
      }
      const grip = hs.find((h) => h.side === side && h.kind === 'controller');
      if (grip) return { pos: grip.pos.clone().add(new THREE.Vector3(0, 0.09, 0)), side };
    }
    return null;
  }

  show() {
    this.shownFor = 0;
    this.progress = 0;
    this.fired = false;
  }

  update(dt, active) {
    const shell = this.shell;
    const a = active ? this._anchor() : null;
    if (a) {
      if (!this.hasPos) this.pos.copy(a.pos);
      this.pos.lerp(a.pos, Math.min(1, dt * 14));
      this.hasPos = true;
    } else this.hasPos = false;
    this.alpha += ((a ? 1 : 0) - this.alpha) * Math.min(1, dt * 6);
    this.group.visible = this.alpha > 0.02;
    if (!a) {
      this.label.hide();
      this.label.update(dt);
      this.progress = 0;
      return;
    }
    this.shownFor += dt;
    this.group.position.copy(this.pos);
    this.group.lookAt(shell.input.head);
    this.disc.material.opacity = 0.9 * this.alpha;
    this.ringMat.uniforms.uAlpha.value = this.alpha;

    // Hold a finger (or controller tip) of the OTHER hand near the orb.
    let near = false;
    for (const p of shell.input.pokers) {
      if (p.side === a.side) continue;
      if (p.pos.distanceTo(this.pos) < REACH) near = true;
    }
    if (shell.pointer?.homeHeld) near = true; // desktop preview: hold H
    this.progress = near ? Math.min(1, this.progress + dt / HOLD) : Math.max(0, this.progress - dt * 2);
    this.ringMat.uniforms.uProgress.value = this.progress;
    this.disc.scale.setScalar(1 + this.progress * 0.25);
    if (this.progress >= 1 && !this.fired) {
      this.fired = true;
      shell.goHome();
      return;
    }
    if (this.progress < 0.05) this.fired = false;

    // Hint for the first few seconds of every app, and whenever a finger nears.
    if (this.shownFor < 6 || near) this.label.show();
    else this.label.hide();
    this.label.mesh.position.copy(this.pos).add(new THREE.Vector3(0, 0.075, 0));
    this.label.mesh.lookAt(shell.input.head);
    this.label.update(dt);
  }
}
