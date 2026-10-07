// A holographic keyboard that can sit on a real table or float in the air.
// Local axes (metres): +x runs low→high pitch to the player's right, +y is up,
// +z points at the player (the front edge of the keys). y = 0 is the top of
// the white keys.
import * as THREE from 'three';

export const WHITE_W = 0.0235;
export const WHITE_L = 0.15;
export const BLACK_W = 0.0145;
export const BLACK_L = 0.092;
export const KEY_H = 0.022;
export const BLACK_RISE = 0.013;
export const TRIGGER = 0.012; // a fingertip this close above a key top is "pressing" it
export const RELEASE = 0.034; // …and has to rise this far to let go (hysteresis)
const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const isBlack = (midi) => BLACK_PCS.has(((midi % 12) + 12) % 12);
export const noteName = (midi) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const pitchColor = (midi, out = new THREE.Color()) => out.setHSL((((midi % 12) + 12) % 12) / 12, 0.85, 0.62);

const _c = new THREE.Color();
const _c2 = new THREE.Color();

function labelPlane(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const x = c.getContext('2d');
  x.font = '700 40px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(30,40,90,0.9)';
  x.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.01), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export class Keyboard {
  constructor(parent, glowTex, { startMidi = 48, count = 37, scale = 1 } = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.glowTex = glowTex;
    this.keys = [];
    this.byMidi = new Map();
    this.opacity = 1;
    this.target = new Set(); // midi numbers to highlight as "play this"
    this.build({ startMidi, count, scale });
  }

  clear() {
    for (const c of [...this.group.children]) {
      c.traverse((o) => {
        o.geometry?.dispose?.();
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      });
      this.group.remove(c);
    }
    this.keys = [];
    this.byMidi.clear();
  }

  build({ startMidi, count, scale }) {
    this.clear();
    this.startMidi = startMidi;
    this.count = count;
    this.scale = scale;
    const ww = WHITE_W * scale;
    const len = WHITE_L * scale;
    const bw = BLACK_W * scale;
    const bl = BLACK_L * scale;
    const rise = BLACK_RISE * scale;
    const kh = KEY_H * scale;

    let last = startMidi + count - 1;
    while (isBlack(last)) last--; // end on a white key
    this.endMidi = last;
    const whites = [];
    for (let m = startMidi; m <= last; m++) if (!isBlack(m)) whites.push(m);
    this.ww = ww;
    this.len = len;
    this.nWhite = whites.length;
    this.width = whites.length * ww;
    const x0 = -this.width / 2;

    const whiteIndex = new Map(whites.map((m, i) => [m, i]));
    const mkEdges = (geo, color, opacity) => {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      l.renderOrder = 36;
      return l;
    };

    for (let m = startMidi; m <= last; m++) {
      const black = isBlack(m);
      let x;
      if (black) x = x0 + (whiteIndex.get(m - 1) + 1) * ww;
      else x = x0 + (whiteIndex.get(m) + 0.5) * ww;
      const w = black ? bw : ww * 0.955;
      const l = black ? bl : len;
      const top = black ? rise : 0;
      const h = black ? kh + rise : kh;
      const geo = new THREE.BoxGeometry(w, h, l);
      geo.translate(0, top - h / 2, black ? -len / 2 + bl / 2 : 0);
      const baseColor = new THREE.Color(black ? '#0d1230' : '#e6efff');
      const baseOpacity = black ? 0.9 : 0.4;
      const mat = new THREE.MeshBasicMaterial({ color: baseColor.clone(), transparent: true, opacity: baseOpacity, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = x;
      mesh.renderOrder = black ? 35 : 34;
      const edge = mkEdges(geo, black ? 0x7d8cff : 0xaec4ff, black ? 0.9 : 0.75);
      mesh.add(edge);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      glow.scale.set(0.11 * scale, 0.11 * scale, 1);
      glow.position.set(0, top + 0.012, black ? -len / 2 + bl * 0.55 : len * 0.2);
      glow.renderOrder = 37;
      mesh.add(glow);
      this.group.add(mesh);
      const key = {
        midi: m,
        black,
        x,
        w,
        top,
        zMin: black ? -len / 2 : -len / 2,
        zMax: black ? -len / 2 + bl : len / 2,
        mesh,
        mat,
        edge,
        glowSprite: glow,
        baseColor,
        baseOpacity,
        hue: pitchColor(m),
        press: 0, // 0..1 visual depression
        pressTarget: 0,
        lit: 0, // 0..1 coloured glow
        fingers: new Set(),
        voices: new Set(),
      };
      this.keys.push(key);
      this.byMidi.set(m, key);
      if (!black && m % 12 === 0) {
        const lab = labelPlane(noteName(m));
        lab.position.set(x, 0.0006, len / 2 - 0.016 * scale);
        lab.scale.setScalar(scale);
        lab.renderOrder = 38;
        this.group.add(lab);
      }
    }

    // A dark slab under the keys so they read against bright tables, and a rail behind.
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width + 0.04 * scale, len + 0.03 * scale),
      new THREE.MeshBasicMaterial({ color: 0x050816, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(0, -kh - 0.001, 0);
    slab.renderOrder = 30;
    this.group.add(slab);
    const railGeo = new THREE.BoxGeometry(this.width + 0.04 * scale, 0.03 * scale, 0.018 * scale);
    const rail = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: 0x0b1030, transparent: true, opacity: 0.85, depthWrite: false }));
    rail.position.set(0, -0.004 * scale, -len / 2 - 0.016 * scale);
    rail.renderOrder = 33;
    rail.add(new THREE.LineSegments(new THREE.EdgesGeometry(railGeo), new THREE.LineBasicMaterial({ color: 0x6f86ff, transparent: true, opacity: 0.8 })));
    this.group.add(rail);
    this.rail = rail;
    this.slab = slab;
    this.setOpacity(this.opacity);
  }

  setOpacity(a) {
    this.opacity = a;
    for (const k of this.keys) {
      k.mat.opacity = k.baseOpacity * a;
      k.edge.material.opacity = (k.black ? 0.9 : 0.75) * a;
    }
    this.slab.material.opacity = 0.5 * a;
    this.rail.material.opacity = 0.85 * a;
  }

  // The key a fingertip (in keyboard-local metres) is pressing, or null.
  keyAt(lx, ly, lz) {
    if (ly < -0.07) return null;
    // black keys first: they stand above their white neighbours
    for (const k of this.keys) {
      if (!k.black) continue;
      if (Math.abs(lx - k.x) < k.w / 2 && lz >= k.zMin - 0.004 && lz <= k.zMax && ly < k.top + TRIGGER * this.scale) return k;
    }
    const i = Math.floor((lx + this.width / 2) / this.ww);
    if (i < 0 || i >= this.nWhite || Math.abs(lz) > this.len / 2 + 0.006) return null;
    if (ly >= TRIGGER * this.scale) return null;
    let w = -1;
    for (const k of this.keys) {
      if (k.black) continue;
      if (++w === i) return k;
    }
    return null;
  }

  // World position of the top-centre of a key.
  keyWorld(key, out = new THREE.Vector3()) {
    out.set(key.x, key.top + 0.004, key.black ? this.zMin(key) + (key.zMax - key.zMin) * 0.5 : this.len * 0.2);
    return this.group.localToWorld(out);
  }

  zMin(key) {
    return key.zMin;
  }

  setTarget(set) {
    this.target = set;
  }

  update(dt, now) {
    for (const k of this.keys) {
      k.press += (k.pressTarget - k.press) * Math.min(1, dt * 28);
      k.lit = Math.max(k.lit - dt * (k.fingers.size ? 0.25 : 1.6), k.fingers.size ? 0.7 : 0);
      const wantTarget = this.target.has(k.midi);
      const pulse = wantTarget ? 0.5 + 0.5 * Math.sin(now * 7) : 0;
      const lit = Math.max(k.lit, pulse * 0.85);
      k.mesh.position.y = -k.press * 0.008 * this.scale;
      k.mesh.rotation.x = k.press * 0.02;
      _c.copy(k.baseColor).lerp(k.hue, Math.min(1, lit));
      k.mat.color.copy(_c);
      k.mat.opacity = Math.min(1, k.baseOpacity + lit * 0.45) * this.opacity;
      k.glowSprite.material.color.copy(k.hue);
      k.glowSprite.material.opacity = lit * 0.9 * this.opacity;
      _c2.copy(k.hue).lerp(_c.set(0xffffff), 0.5);
      k.edge.material.color.copy(lit > 0.05 ? _c2 : k.black ? _c.set(0x7d8cff) : _c.set(0xaec4ff));
    }
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
