// Firefly Night as a Roomspace app.
import * as THREE from 'three';
import { Label } from '../../core/fx.js';
import { Memories } from './memory.js';
import { Game } from './game.js';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

class FireflyApp {
  constructor(shell) {
    this.shell = shell;
    this.root = new THREE.Group();
    this.game = null;
  }

  mount(now) {
    const { shell, root } = this;
    this.label = new Label(root, { width: 1.1, aspect: 0.32 });
    this.scoreLabel = new Label(root, { width: 0.32, px: 512, aspect: 0.4, order: 51 });
    const memories = new Memories(shell.sim);
    this.game = new Game({
      scene: root,
      room: shell.room,
      audio: shell.audio,
      particles: shell.particles,
      sky: shell.sky,
      label: this.label,
      scoreLabel: this.scoreLabel,
      memories,
      glowTex: shell.glowTex,
      sim: shell.sim,
    });
    this.game.start(now);
    memories.restore(shell.session, (night, getPts) => this.game.addMemoryNight(night, getPts));
  }

  update(dt, now) {
    const { shell, game } = this;
    if (shell.bounds) game.area.setBounds(shell.bounds);
    const i = shell.input;
    game.update(dt, now, { frame: shell.frame, refSpace: shell.refSpace, head: i.head, fwd: i.fwd, hands: i.hands });
  }

  onSelect(pos, now) {
    this.game?.onSelect(pos, now);
  }

  // Desktop preview: the mouse is your hand. It reaches 0.7 m into the room, or
  // all the way to a firefly when you click right on it.
  simHands(ray, clicked, keys, dt) {
    const { shell, game } = this;
    let pos = ray.at(0.7, new THREE.Vector3());
    if (clicked && game) {
      let best = null;
      let bestAng = 0.06;
      for (const fl of game.flies) {
        if (!fl.catchable) continue;
        const toF = _p.subVectors(fl.pos, ray.origin);
        if (toF.length() > 4.5) continue;
        const ang = toF.normalize().angleTo(ray.direction);
        if (ang < bestAng) {
          bestAng = ang;
          best = fl;
        }
      }
      if (best) pos = best.pos.clone();
    }
    const hands = [shell.input.track('mouse', pos, dt, { radius: 0.1, kind: 'mouse', lantern: false })];
    hands[0].vel.set(0, 0, 0);
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) {
      const palm = _v.set(0.05, -0.35, -0.45).applyQuaternion(shell.camera.quaternion).add(shell.camera.position).clone();
      hands.push({ pos: palm, vel: new THREE.Vector3(), radius: 0, kind: 'mouse', lantern: false, cradle: true });
    }
    return hands;
  }

  debugLines(line, ok) {
    const g = this.game;
    if (!g) return [];
    return [
      line(`firefly: ${g.phase} · ✦${g.score} · ${g.flies.filter((f) => f.inField).length} in room`),
      line(`play area: ${g.area.mode}`, ok(g.area.bounds)),
      line(`memories: ${g.memoryNights.length} nights · ${g.memoryNights.filter((m) => m.located).length} located`),
    ];
  }

  unmount() {
    const g = this.game;
    if (g) {
      for (const f of g.flies) f.dispose();
      for (const m of g.moths) m.dispose();
      for (const m of g.memoryNights) m.flies.forEach((f) => f.dispose());
      g.flies = [];
      g.moths = [];
      g.memoryNights = [];
      g.phase = 'idle';
    }
    this.shell.audio.silence();
    this.game = null;
  }
}

export default {
  id: 'firefly',
  name: 'Firefly Night',
  tagline: 'catch fireflies in your room',
  kind: 'mr',
  color: '#d4ff5e',
  simHelp: 'Desktop preview · drag to look · WASD to walk · click a firefly to catch · Space / right-click to chime · hold Shift to cradle · Esc = hub',
  paint(ctx, W, H) {
    // A few glowing fireflies.
    for (const [x, y, r] of [[0.3, 0.55, 0.05], [0.62, 0.35, 0.07], [0.5, 0.72, 0.04], [0.78, 0.68, 0.045], [0.22, 0.28, 0.035]]) {
      const g = ctx.createRadialGradient(W * x, H * y, 1, W * x, H * y, W * r * 3.2);
      g.addColorStop(0, 'rgba(255,255,220,1)');
      g.addColorStop(0.25, 'rgba(212,255,94,0.85)');
      g.addColorStop(1, 'rgba(212,255,94,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(W * x, H * y, W * r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  create: (shell) => new FireflyApp(shell),
};
