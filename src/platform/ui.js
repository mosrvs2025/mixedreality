// Pokable 3D UI. A Panel is a flat group of Buttons floating in the room.
// You press a button by touching it with a fingertip or controller tip
// (no pinch needed — pinch-with-palm-up is the Quest system gesture).
// On desktop the mouse does the same job through a ray.
import * as THREE from 'three';

const PX_PER_M = 3200;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const plane = new THREE.PlaneGeometry(1, 1);
plane.userData.shared = true;

export class Button {
  constructor(panel, o) {
    this.panel = panel;
    this.id = o.id;
    this.w = o.w ?? 0.06;
    this.h = o.h ?? 0.05;
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.label = o.label ?? '';
    this.sub = o.sub ?? '';
    this.color = o.color ?? '#7fb8ff';
    this.toggle = !!o.toggle;
    this.active = !!o.active;
    this.disabled = !!o.disabled;
    this.paint = o.paint || null; // (ctx, w, h, button) custom art
    this.onPress = o.onPress || (() => {});
    this.hover = 0;
    this.flash = 0;
    this.depress = 0;
    this.state = new Map(); // per-poker arming

    const cw = Math.max(64, Math.min(1024, Math.round(this.w * PX_PER_M)));
    const ch = Math.max(64, Math.min(1024, Math.round(this.h * PX_PER_M)));
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.face = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.face.scale.set(this.w, this.h, 1);
    this.glow = new THREE.Mesh(
      plane,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.glow.scale.set(this.w * 1.06, this.h * 1.06, 1);
    this.glow.position.z = 0.001;
    this.group = new THREE.Group();
    this.group.add(this.face, this.glow);
    this.group.position.set(this.x, this.y, 0);
    this.face.renderOrder = this.glow.renderOrder = 40;
    this.redraw();
  }

  redraw() {
    const { canvas } = this;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const r = Math.min(W, H) * 0.22;
    roundRect(ctx, 3, 3, W - 6, H - 6, r);
    const c = new THREE.Color(this.color);
    const rgb = `${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0}`;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (this.active) {
      g.addColorStop(0, `rgba(${rgb},0.95)`);
      g.addColorStop(1, `rgba(${rgb},0.7)`);
    } else {
      g.addColorStop(0, 'rgba(24,30,64,0.88)');
      g.addColorStop(1, 'rgba(10,14,36,0.9)');
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(3, W * 0.012);
    ctx.strokeStyle = `rgba(${rgb},${this.disabled ? 0.25 : 0.85})`;
    ctx.stroke();
    if (this.paint) this.paint(ctx, W, H, this);
    if (this.label || this.sub) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.active ? '#06101f' : this.disabled ? 'rgba(220,230,255,0.4)' : '#f4f8ff';
      const hasSub = !!this.sub;
      const size = Math.min(H * (hasSub ? 0.34 : 0.46), (W * 0.9) / Math.max(3, this.label.length * 0.62));
      ctx.font = `700 ${size}px ${FONT}`;
      ctx.fillText(this.label, W / 2, hasSub ? H * 0.42 : H / 2);
      if (hasSub) {
        ctx.font = `500 ${size * 0.62}px ${FONT}`;
        ctx.globalAlpha = 0.8;
        ctx.fillText(this.sub, W / 2, H * 0.74);
        ctx.globalAlpha = 1;
      }
    }
    this.tex.needsUpdate = true;
  }

  set(o) {
    Object.assign(this, o);
    this.redraw();
  }

  press(source) {
    if (this.disabled) return;
    if (this.toggle) {
      this.active = !this.active;
      this.redraw();
    }
    this.flash = 1;
    this.panel.shell?.audio?.ui?.('press');
    this.panel.shell?.haptic?.(source, 0.35, 35);
    this.onPress(this, source);
  }

  dispose() {
    this.tex.dispose();
    this.face.material.dispose();
    this.glow.material.dispose();
  }
}

const _inv = new THREE.Matrix4();
const _lp = new THREE.Vector3();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pt = new THREE.Vector3();

export class Panel {
  constructor(shell, parent) {
    this.shell = shell;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.buttons = [];
    this.enabled = true;
    this.backing = null;
  }

  // A soft dark plate so buttons read against any passthrough.
  addBacking(w, h, cx = 0, cy = 0, opacity = 0.55) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.max(64, Math.round((512 * h) / w));
    const ctx = c.getContext('2d');
    roundRect(ctx, 2, 2, c.width - 4, c.height - 4, Math.min(c.width, c.height) * 0.12);
    ctx.fillStyle = `rgba(6,9,26,${opacity})`;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(140,170,255,0.35)';
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.backing = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.backing.scale.set(w, h, 1);
    this.backing.position.set(cx, cy, -0.004);
    this.backing.renderOrder = 39;
    this.group.add(this.backing);
    return this.backing;
  }

  add(o) {
    const b = new Button(this, o);
    this.buttons.push(b);
    this.group.add(b.group);
    return b;
  }

  get(id) {
    return this.buttons.find((b) => b.id === id);
  }

  // pokers: fingertip / controller points; pointer: desktop mouse ray (or null).
  update(dt, now) {
    const { shell } = this;
    this.group.updateMatrixWorld(true);
    _inv.copy(this.group.matrixWorld).invert();
    const pokers = this.enabled ? shell.input.pokers : [];
    for (const b of this.buttons) b.hoverTarget = 0;

    for (const p of pokers) {
      _lp.copy(p.pos).applyMatrix4(_inv);
      for (const b of this.buttons) {
        if (b.disabled) continue;
        const dx = Math.abs(_lp.x - b.x);
        const dy = Math.abs(_lp.y - b.y);
        const inside = dx < b.w / 2 + 0.006 && dy < b.h / 2 + 0.006;
        const z = _lp.z;
        let st = b.state.get(p.id);
        if (!st) b.state.set(p.id, (st = { armed: false }));
        if (inside && z > 0 && z < 0.07) b.hoverTarget = Math.max(b.hoverTarget, 1 - z / 0.07);
        if (z > 0.022) st.armed = true;
        if (z < 0.009) {
          if (inside && st.armed && z > -0.03) {
            st.armed = false;
            b.press(p.source);
          } else if (!inside) st.armed = false;
        }
        if (inside && z > -0.01 && z < 0.04) b.depress = Math.max(b.depress, Math.max(0, 0.02 - z) * 0.6);
      }
    }

    const ptr = shell.pointer;
    if (this.enabled && ptr?.ray) {
      _n.set(0, 0, 1).transformDirection(this.group.matrixWorld);
      _pt.setFromMatrixPosition(this.group.matrixWorld);
      _plane.setFromNormalAndCoplanarPoint(_n, _pt);
      if (ptr.ray.intersectPlane(_plane, _hit)) {
        _lp.copy(_hit).applyMatrix4(_inv);
        for (const b of this.buttons) {
          if (b.disabled) continue;
          if (Math.abs(_lp.x - b.x) < b.w / 2 && Math.abs(_lp.y - b.y) < b.h / 2) {
            b.hoverTarget = 1;
            if (ptr.clicked) b.press(null);
          }
        }
      }
    }

    for (const b of this.buttons) {
      const k = Math.min(1, dt * 14);
      b.hover += ((b.hoverTarget || 0) - b.hover) * k;
      b.flash = Math.max(0, b.flash - dt * 4);
      const scale = 1 + b.hover * 0.06;
      b.face.scale.set(b.w * scale, b.h * scale, 1);
      b.glow.material.opacity = b.hover * 0.25 + b.flash * 0.55;
      b.glow.scale.set(b.w * scale * 1.06, b.h * scale * 1.06, 1);
      b.group.position.z = b.hover * 0.008 - b.depress;
      b.depress *= Math.exp(-dt * 12);
    }
  }

  dispose() {
    for (const b of this.buttons) b.dispose();
    if (this.backing) {
      this.backing.material.map?.dispose();
      this.backing.material.dispose();
    }
    this.group.removeFromParent();
  }
}

// Free every geometry/material/texture under an object (not shared ones).
export function disposeTree(root, keep = new Set()) {
  root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry) && !o.geometry.userData.shared) o.geometry.dispose?.();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
  root.removeFromParent();
}
