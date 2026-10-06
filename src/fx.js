// Glow sprites, sparkle particles, the night-sky dome and floating text.
import * as THREE from 'three';

// Soft radial glow with rgb == alpha so additive blending never paints a box.
export function makeGlowTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const halo = Math.pow(Math.max(0, 1 - r), 1.8);
      const core = Math.exp(-r * r * 40);
      const v = Math.min(1, halo * 0.75 + core) * 255;
      data.set([v, v, v, v], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------

const P_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale * projectionMatrix[1][1] / max(-mv.z, 0.05);
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;
const P_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float g = pow(max(0.0, 1.0 - d), 2.0);
    if (vAlpha * g < 0.003) discard;
    gl_FragColor = vec4(vColor, g * vAlpha);
  }
`;

export class Particles {
  constructor(scene, capacity = 1500) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 900 } };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: P_VERT,
        fragmentShader: P_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
  }

  emit(p, v, color, { size = 0.02, life = 1, drag = 1.5, gravity = 0.05 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.baseSize[i] = size;
    this.life[i] = life;
    this.max[i] = life;
    this.drag[i] = drag;
    this.grav[i] = gravity;
  }

  burst(p, color, n = 30, speed = 0.8, opts = {}) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      this.emit(p, v, color, { life: 0.6 + Math.random() * 0.9, size: 0.012 + Math.random() * 0.02, ...opts });
    }
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = k * (0.75 + 0.25 * Math.sin(this.life[i] * 25 + i));
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * k);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Inside-out sphere that lowers the passthrough into dusk and back to dawn.

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uAlpha: { value: 0 },
      uTop: { value: new THREE.Color('#03061a') },
      uHorizon: { value: new THREE.Color('#0d0f33') },
      uTime: { value: 0 },
      uStars: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(40, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform float uTime;
          uniform float uStars;
          varying vec3 vDir;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          void main() {
            float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 c = mix(uHorizon, uTop, smoothstep(0.35, 0.9, h));
            float a = uAlpha;
            if (uStars > 0.0 && vDir.y > 0.2) {
              vec3 g = vDir * 90.0;
              vec3 cell = floor(g);
              float r = hash(cell);
              if (r > 0.985) {
                float s = smoothstep(0.35, 0.0, length(fract(g) - 0.5));
                float tw = 0.6 + 0.4 * sin(uTime * (1.0 + r * 4.0) + r * 50.0);
                c += vec3(s * tw * uStars);
                a = max(a, s * tw * uStars);
              }
            }
            gl_FragColor = vec4(c, a);
          }`,
      }),
    );
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._nightTop = new THREE.Color('#03061a');
    this._nightHz = new THREE.Color('#0d0f33');
    this._dawnTop = new THREE.Color('#3a4a8a');
    this._dawnHz = new THREE.Color('#ff9a70');
  }

  // night: 0..1 darkness, dawn: 0..1 warmth
  set(night, dawn, time, starsFallback) {
    this.uniforms.uAlpha.value = night;
    this.uniforms.uTop.value.copy(this._nightTop).lerp(this._dawnTop, dawn);
    this.uniforms.uHorizon.value.copy(this._nightHz).lerp(this._dawnHz, dawn);
    this.uniforms.uTime.value = time;
    this.uniforms.uStars.value = starsFallback;
  }

  follow(pos) {
    this.mesh.position.copy(pos);
  }
}

// ---------------------------------------------------------------------------
// Text that floats in space, drawn to a canvas.

export class Label {
  constructor(scene, { width = 1.0, px = 1024, aspect = 0.3, order = 50 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = Math.round(px * aspect);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * aspect), this.mat);
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.text = '';
    this.opacity = 0;
    this.target = 0;
  }

  draw(lines) {
    const key = JSON.stringify(lines);
    if (key === this.text) return;
    this.text = key;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const total = lines.reduce((s, l) => s + l.size * 1.3, 0);
    let y = canvas.height / 2 - total / 2;
    for (const l of lines) {
      y += l.size * 0.65;
      let size = l.size;
      ctx.font = `${l.weight || 600} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const w = ctx.measureText(l.text).width;
      if (w > canvas.width * 0.9) {
        size = Math.floor((size * canvas.width * 0.9) / w);
        ctx.font = `${l.weight || 600} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      }
      ctx.shadowColor = l.glow || 'rgba(255,220,120,0.9)';
      ctx.shadowBlur = size * 0.45;
      ctx.fillStyle = l.color || '#fff6dc';
      ctx.fillText(l.text, canvas.width / 2, y);
      ctx.shadowBlur = 0;
      ctx.fillText(l.text, canvas.width / 2, y);
      y += l.size * 0.65;
    }
    this.tex.needsUpdate = true;
  }

  show(lines) {
    if (lines) this.draw(lines);
    this.target = 1;
  }

  hide() {
    this.target = 0;
  }

  update(dt) {
    this.opacity += (this.target - this.opacity) * Math.min(1, dt * 4);
    this.mat.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01;
  }
}
