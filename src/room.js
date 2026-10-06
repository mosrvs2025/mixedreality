// The player's real room: detected meshes / planes / hit-test points become
// (1) invisible depth occluders, so fireflies can hide behind real furniture,
// (2) a canvas for light — sonar ripples, firefly glow and lantern light are
//     painted directly onto real surfaces, and the ceiling turns into a night sky,
// (3) a sampler of real surface points where fireflies perch.
import * as THREE from 'three';

export const PULSE_SPEED = 2.4; // m/s
export const PULSE_LIFE = 4.0; // s
const MAX_PULSES = 6;
export const MAX_LIGHTS = 12;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uPulse[${MAX_PULSES}];
  uniform vec4 uLights[${MAX_LIGHTS}];
  uniform vec3 uLightColor[${MAX_LIGHTS}];
  uniform vec4 uStarOrigin;
  uniform float uStars;
  uniform float uSpeed;
  uniform float uLife;
  varying vec3 vWorld;
  varying vec3 vN;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 col = vec3(0.0);

    // Contour lines that hug whatever real surface this is.
    vec3 s = vWorld * 6.0;
    vec3 f = abs(fract(s - 0.5) - 0.5) / max(fwidth(s), vec3(1e-4));
    float line = 1.0 - clamp(min(min(f.x, f.y), f.z), 0.0, 1.0);

    // Sonar ripples travelling across the room.
    for (int i = 0; i < ${MAX_PULSES}; i++) {
      vec4 p = uPulse[i];
      float age = uTime - p.w;
      if (age > 0.0 && age < uLife) {
        float r = age * uSpeed;
        float d = distance(vWorld, p.xyz);
        float k = d - r;
        float fade = 1.0 - age / uLife;
        float ring = exp(-k * k * 30.0) * fade;
        float wake = smoothstep(r, r - 1.2, d) * step(d, r) * 0.18 * fade * fade;
        col += vec3(0.35, 0.85, 1.0) * (ring * (0.35 + 1.4 * line) + wake * line);
      }
    }

    // Warm light pools cast by fireflies and the player's lantern hands.
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      vec4 l = uLights[i];
      if (l.w > 0.001) {
        vec3 dv = vWorld - l.xyz;
        float d2 = dot(dv, dv);
        col += uLightColor[i] * l.w * (exp(-d2 * 28.0) * 0.55 + exp(-d2 * 4.0) * 0.06);
      }
    }

    // The real ceiling becomes a starry sky, revealed by the first ripple.
    if (abs(vN.y) > 0.8 && vWorld.y > 1.75 && uStars > 0.0) {
      float reveal = clamp(((uTime - uStarOrigin.w) * uSpeed - distance(vWorld, uStarOrigin.xyz)) * 0.8, 0.0, 1.0);
      vec2 g = vWorld.xz * 11.0;
      vec2 c = floor(g);
      float h = hash(c);
      if (h > 0.9) {
        vec2 off = vec2(hash(c + 3.1), hash(c + 7.7)) - 0.5;
        float st = smoothstep(0.12, 0.0, length(fract(g) - 0.5 - off * 0.6));
        float tw = 0.55 + 0.45 * sin(uTime * (0.7 + h * 3.0) + h * 91.0);
        col += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.95, 0.8), hash(c + 1.3)) * st * tw * (h - 0.9) * 10.0 * uStars * reveal;
      }
    }

    float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    gl_FragColor = vec4(col / max(a, 1e-3), a);
  }
`;

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class Room {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = {
      uTime: { value: 0 },
      uPulse: { value: Array.from({ length: MAX_PULSES }, () => new THREE.Vector4(0, 0, 0, -999)) },
      uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uLightColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(1, 0.9, 0.5)) },
      uStarOrigin: { value: new THREE.Vector4(0, 0, 0, 1e9) },
      uStars: { value: 0 },
      uSpeed: { value: PULSE_SPEED },
      uLife: { value: PULSE_LIFE },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
    });
    this.entries = new Map();
    this.hitPoints = [];
    this.hitKeys = new Set();
    this.pulseIdx = 0;
    this.hasMeshes = false;
    this.realArea = 0;
    this.version = 0;
  }

  // ---- geometry sources ----------------------------------------------------

  _addEntry(key, geometry, kind, label, matrix) {
    const obj = new THREE.Mesh(geometry, this.material);
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(matrix);
    obj.matrixWorldNeedsUpdate = true;
    obj.renderOrder = -10;
    obj.frustumCulled = false;
    this.group.add(obj);
    const e = { key, obj, kind, label, changed: -1, flip: false };
    this._index(e);
    this.entries.set(key, e);
    this.version++;
    return e;
  }

  _remove(key) {
    const e = this.entries.get(key);
    if (!e) return;
    this.group.remove(e.obj);
    e.obj.geometry.dispose();
    this.entries.delete(key);
    this.version++;
  }

  // Area-weighted triangle table for uniform sampling of the surface.
  _index(e) {
    const g = e.obj.geometry;
    const pos = g.attributes.position.array;
    const idx = g.index ? g.index.array : null;
    const triCount = idx ? idx.length / 3 : pos.length / 9;
    const cum = new Float32Array(triCount);
    let total = 0;
    let floorDir = 0;
    let floorArea = 0;
    let outward = 0;
    const centroid = new THREE.Vector3();
    g.computeBoundingBox();
    g.boundingBox.getCenter(centroid);
    for (let t = 0; t < triCount; t++) {
      this._tri(pos, idx, t, _v0, _v1, _v2);
      _e1.subVectors(_v1, _v0);
      _e2.subVectors(_v2, _v0);
      _n.crossVectors(_e1, _e2);
      const area = _n.length() * 0.5;
      total += area;
      cum[t] = total;
      if (e.kind === 'mesh' && area > 0) {
        _n.normalize();
        const cy = (_v0.y + _v1.y + _v2.y) / 3;
        _e1.set((_v0.x + _v1.x + _v2.x) / 3, cy, (_v0.z + _v1.z + _v2.z) / 3);
        // world-space test for "floor" triangles
        _e2.copy(_e1).applyMatrix4(e.obj.matrix);
        const wn = _v0.copy(_n).transformDirection(e.obj.matrix);
        if (_e2.y < 0.15 && Math.abs(wn.y) > 0.7) {
          floorDir += Math.sign(wn.y) * area;
          floorArea += area;
        }
        outward += _n.dot(_e1.sub(centroid)) * area;
      }
    }
    // Normals must point out of the surface into the air; winding varies by
    // runtime, so infer it: the floor faces up, a furniture volume faces out.
    // (Only a room-scale mesh is judged by its floor: furniture has a bottom too.)
    const size = g.boundingBox.getSize(_e1);
    const roomScale = size.x > 2.5 && size.z > 2.5;
    if (e.kind === 'mesh') e.flip = roomScale && floorArea > 0.3 ? floorDir < 0 : outward < 0;
    e.cum = cum;
    e.area = total;
    e.triCount = triCount;
  }

  _tri(pos, idx, t, a, b, c) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    a.fromArray(pos, i0 * 3);
    b.fromArray(pos, i1 * 3);
    c.fromArray(pos, i2 * 3);
  }

  addStatic(key, geometry, matrix = new THREE.Matrix4(), label = '') {
    const e = this._addEntry(key, geometry, 'mesh', label, matrix);
    this._refreshFlags();
    return e;
  }

  _meshGeometry(xrMesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(xrMesh.vertices), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(xrMesh.indices), 1));
    g.computeVertexNormals();
    return g;
  }

  _planeGeometry(plane) {
    const pts = plane.polygon.map((p) => new THREE.Vector2(p.x, p.z));
    if (pts.length < 3) return null;
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const pos = new Float32Array(pts.length * 3);
    const nrm = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      pos[i * 3] = p.x;
      pos[i * 3 + 2] = p.y;
      nrm[i * 3 + 1] = 1;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(tris.flat());
    return g;
  }

  // Pull the latest scene understanding from the XR frame.
  updateFromFrame(frame, refSpace) {
    const seen = new Set();
    const _m = new THREE.Matrix4();
    const meshes = frame.detectedMeshes;
    if (meshes) {
      for (const m of meshes) {
        const pose = frame.getPose(m.meshSpace, refSpace);
        if (!pose) continue;
        seen.add(m);
        _m.fromArray(pose.transform.matrix);
        let e = this.entries.get(m);
        if (!e || e.changed !== m.lastChangedTime) {
          if (e) this._remove(m);
          if (!m.vertices || m.vertices.length < 9) continue;
          e = this._addEntry(m, this._meshGeometry(m), 'mesh', m.semanticLabel || '', _m);
          e.changed = m.lastChangedTime;
        } else if (!_m.equals(e.obj.matrix)) {
          e.obj.matrix.copy(_m);
          e.obj.matrixWorldNeedsUpdate = true;
        }
      }
    }
    const planes = frame.detectedPlanes;
    if (planes) {
      for (const p of planes) {
        const pose = frame.getPose(p.planeSpace, refSpace);
        if (!pose) continue;
        seen.add(p);
        _m.fromArray(pose.transform.matrix);
        let e = this.entries.get(p);
        if (!e || e.changed !== p.lastChangedTime) {
          if (e) this._remove(p);
          const g = this._planeGeometry(p);
          if (!g) continue;
          e = this._addEntry(p, g, 'plane', p.semanticLabel || '', _m);
          e.changed = p.lastChangedTime;
        } else if (!_m.equals(e.obj.matrix)) {
          e.obj.matrix.copy(_m);
          e.obj.matrixWorldNeedsUpdate = true;
        }
      }
    }
    for (const [key, e] of this.entries) {
      if (e.kind !== 'synthetic' && typeof key !== 'string' && !seen.has(key)) this._remove(key);
    }
    this._refreshFlags();
  }

  _refreshFlags() {
    let hasMeshes = false;
    let real = 0;
    for (const e of this.entries.values()) if (e.kind === 'mesh') hasMeshes = true;
    for (const e of this.entries.values()) {
      // Meshes already cover what planes describe; avoid doubled surfaces.
      const active = e.kind === 'mesh' || (e.kind === 'plane' && !hasMeshes) || (e.kind === 'synthetic' && this.realArea === 0);
      e.active = active;
      e.obj.visible = active;
      if (active && e.kind !== 'synthetic') real += e.area;
    }
    this.hasMeshes = hasMeshes;
    this.realArea = real;
    const synth = this.entries.get('synthetic-floor');
    if (synth) {
      synth.active = real === 0;
      synth.obj.visible = synth.active;
    }
  }

  // When the runtime gives us no room data, the real floor (local-floor y=0)
  // still exists — so ripples can roll across it.
  ensureSyntheticFloor() {
    if (this.entries.has('synthetic-floor')) return;
    const g = new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2);
    const e = this._addEntry('synthetic-floor', g, 'synthetic', 'floor', new THREE.Matrix4());
    e.kind = 'synthetic';
    this._refreshFlags();
  }

  // A new XR session has a new origin: forget everything tied to the old one.
  resetDynamic() {
    for (const [key, e] of [...this.entries]) if (typeof key !== 'string' || e.kind === 'synthetic') this._remove(key);
    this.hitPoints = [];
    this.hitKeys.clear();
    this._refreshFlags();
  }

  addHitPoint(pos, normal) {
    const key = `${Math.round(pos.x / 0.12)},${Math.round(pos.y / 0.12)},${Math.round(pos.z / 0.12)}`;
    if (this.hitKeys.has(key) || this.hitPoints.length > 800) return false;
    this.hitKeys.add(key);
    this.hitPoints.push({ pos: pos.clone(), normal: normal.clone() });
    return true;
  }

  get hasGeometry() {
    return this.realArea > 0.5 || this.hitPoints.length > 12;
  }

  // ---- sampling -------------------------------------------------------------

  // Random point on a real surface: { pos, normal, label } or null.
  sample() {
    if (this.realArea > 0.5) {
      let r = Math.random() * this.realArea;
      for (const e of this.entries.values()) {
        if (!e.active || e.kind === 'synthetic') continue;
        if (r > e.area) {
          r -= e.area;
          continue;
        }
        const cum = e.cum;
        let lo = 0;
        let hi = e.triCount - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < r) lo = mid + 1;
          else hi = mid;
        }
        const g = e.obj.geometry;
        this._tri(g.attributes.position.array, g.index ? g.index.array : null, lo, _v0, _v1, _v2);
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const p = new THREE.Vector3()
          .copy(_v0)
          .addScaledVector(_e1.subVectors(_v1, _v0), u)
          .addScaledVector(_e2.subVectors(_v2, _v0), v);
        const n = new THREE.Vector3();
        if (e.kind === 'plane') n.set(0, 1, 0);
        else {
          n.crossVectors(_e1, _e2).normalize();
          if (e.flip) n.negate();
        }
        p.applyMatrix4(e.obj.matrix);
        n.applyMatrix3(_nm.getNormalMatrix(e.obj.matrix)).normalize();
        return { pos: p, normal: n, label: e.label };
      }
    }
    if (this.hitPoints.length) {
      const h = this.hitPoints[(Math.random() * this.hitPoints.length) | 0];
      return { pos: h.pos.clone(), normal: h.normal.clone(), label: '' };
    }
    return null;
  }

  // Is the straight line from eye to point blocked by real geometry?
  isHidden(eye, point) {
    if (this.realArea <= 0.5) return false;
    const dir = _v0.subVectors(point, eye);
    const dist = dir.length();
    this._ray ??= new THREE.Raycaster();
    this._ray.set(eye, dir.normalize());
    this._ray.far = dist - 0.12;
    const targets = [];
    for (const e of this.entries.values()) if (e.active && e.kind !== 'synthetic') targets.push(e.obj);
    this.group.updateMatrixWorld(true);
    return this._ray.intersectObjects(targets, false).length > 0;
  }

  // ---- light & ripples --------------------------------------------------------

  addPulse(pos, time) {
    this.uniforms.uPulse.value[this.pulseIdx].set(pos.x, pos.y, pos.z, time);
    this.pulseIdx = (this.pulseIdx + 1) % MAX_PULSES;
  }

  revealStars(pos, time) {
    this.uniforms.uStarOrigin.value.set(pos.x, pos.y, pos.z, time);
  }

  setLights(list) {
    const L = this.uniforms.uLights.value;
    const C = this.uniforms.uLightColor.value;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = list[i];
      if (l) {
        L[i].set(l.pos.x, l.pos.y, l.pos.z, l.intensity);
        C[i].copy(l.color);
      } else L[i].w = 0;
    }
  }

  update(time, stars) {
    this.uniforms.uTime.value = time;
    this.uniforms.uStars.value = stars;
  }
}
