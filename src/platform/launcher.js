// The hub: an arc of app cards floating at arm's length. Touch one to open it.
import * as THREE from 'three';
import { Label } from '../core/fx.js';
import { Panel, roundRect, disposeTree } from './ui.js';

const CARD_W = 0.2;
const CARD_H = 0.27;
const RADIUS = 0.55; // from the player's head
const ARC = (30 * Math.PI) / 180; // between neighbouring cards

function paintCard(app) {
  return (ctx, W, H) => {
    // Colour wash
    const c = new THREE.Color(app.color || '#7fb8ff');
    const rgb = `${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0}`;
    const g = ctx.createRadialGradient(W / 2, H * 0.36, 4, W / 2, H * 0.36, W * 0.8);
    g.addColorStop(0, `rgba(${rgb},0.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.save();
    roundRect(ctx, 3, 3, W - 6, H - 6, Math.min(W, H) * 0.22);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    app.paint?.(ctx, W, H * 0.62, rgb);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = app.soon ? 'rgba(220,230,255,0.55)' : '#f4f8ff';
    ctx.font = `700 ${W * 0.1}px system-ui, sans-serif`;
    ctx.fillText(app.name, W / 2, H * 0.72);
    ctx.font = `500 ${W * 0.056}px system-ui, sans-serif`;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#d6e2ff';
    ctx.fillText(app.tagline, W / 2, H * 0.83);
    ctx.fillText(app.kind === 'vr' ? 'VR' : 'MIXED REALITY', W / 2, H * 0.92);
    ctx.globalAlpha = 1;
  };
}

export class Launcher {
  constructor(shell, apps) {
    this.shell = shell;
    this.apps = apps;
    this.root = new THREE.Group();
    this.root.visible = false;
    shell.scene.add(this.root);
    this.title = new Label(this.root, { width: 0.5, px: 1024, aspect: 0.2, order: 50 });
    this.title.draw([
      { text: 'Roomspace', size: 120, weight: 800, glow: 'rgba(130,170,255,0.9)' },
    ]);
    this.cards = [];
    this.exit = null;
    this.visible = false;
    this.t = 0;
    this.build();
  }

  build() {
    const n = this.apps.length;
    this.apps.forEach((app, i) => {
      const panel = new Panel(this.shell, this.root);
      const btn = panel.add({
        id: app.id,
        w: CARD_W,
        h: CARD_H,
        color: app.color,
        disabled: !!app.soon,
        paint: paintCard(app),
        onPress: () => this.shell.open(app.id),
      });
      this.cards.push({ app, panel, btn, angle: -(i - (n - 1) / 2) * ARC });
    });
    const p = new Panel(this.shell, this.root);
    this.exit = p.add({ id: 'exit', w: 0.1, h: 0.04, label: 'Exit', color: '#ff9a9a', onPress: () => this.shell.exit() });
    this.exitPanel = p;
  }

  show() {
    const { head, fwd } = this.shell.input;
    const f = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    this.base = new THREE.Vector3(head.x, head.y - 0.2, head.z);
    this.yaw = Math.atan2(f.x, f.z); // bearing of "forward"
    this.t = 0;
    this.visible = true;
    this.root.visible = true;
    this.shell.audio.ui('open');
    this.layout(0);
  }

  hide() {
    this.visible = false;
    this.root.visible = false;
    this.title.hide();
  }

  layout(now) {
    const head = this.shell.input.head;
    for (const c of this.cards) {
      const a = this.yaw + c.angle;
      const g = c.panel.group;
      g.position.set(this.base.x + Math.sin(a) * RADIUS, this.base.y + 0.012 * Math.sin(now * 1.3 + c.angle * 4), this.base.z + Math.cos(a) * RADIUS);
      g.lookAt(head.x, g.position.y + (head.y - this.base.y) * 0.5, head.z);
    }
    const eg = this.exitPanel.group;
    eg.position.set(this.base.x + Math.sin(this.yaw) * (RADIUS - 0.04), this.base.y - 0.2, this.base.z + Math.cos(this.yaw) * (RADIUS - 0.04));
    eg.lookAt(head.x, eg.position.y + 0.1, head.z);
    this.title.mesh.position.set(this.base.x + Math.sin(this.yaw) * (RADIUS + 0.03), this.base.y + 0.26, this.base.z + Math.cos(this.yaw) * (RADIUS + 0.03));
    this.title.mesh.lookAt(head);
  }

  update(dt, now) {
    if (!this.visible) return;
    this.t += dt;
    this.layout(now);
    this.title.show();
    this.title.update(dt);
    const k = Math.min(1, this.t / 0.6);
    const ease = 1 - Math.pow(1 - k, 3);
    for (const c of this.cards) {
      c.panel.group.scale.setScalar(0.6 + 0.4 * ease);
      c.panel.update(dt, now);
      // a little star-dust around each card
      if (!c.app.soon && Math.random() < dt * 5) {
        const g = c.panel.group.position;
        this.shell.particles.emit(
          new THREE.Vector3(g.x + (Math.random() - 0.5) * CARD_W, g.y + (Math.random() - 0.5) * CARD_H, g.z + (Math.random() - 0.5) * 0.05),
          new THREE.Vector3(0, 0.03, 0),
          new THREE.Color(c.app.color),
          { life: 1.6, size: 0.012, drag: 0.6, gravity: 0.01 },
        );
      }
    }
    this.exitPanel.update(dt, now);
  }

  dispose() {
    this.title.mesh.removeFromParent();
    for (const c of this.cards) c.panel.dispose();
    this.exitPanel.dispose();
    disposeTree(this.root);
  }
}
