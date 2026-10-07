// The app registry. Add an app here and it appears in the launcher.
//
// App contract:
//   id, name, tagline, kind ('mr' mixed reality | 'vr' fully virtual), color,
//   paint(ctx, w, h)  draws the launcher card art
//   create(shell) →   { root: THREE.Group, mount(now), update(dt, now), unmount(),
//                       onSelect?(pos, now, source), onKey?(code, down),
//                       simHands?(ray, clicked, keys, dt), debugLines?(line, ok) }
import firefly from '../apps/firefly/index.js';
import piano from '../apps/piano/index.js';

const soon = {
  id: 'soon',
  soon: true,
  name: 'More soon',
  tagline: 'new apps are on the way',
  kind: 'mr',
  color: '#8aa0ff',
  paint(ctx, W, H) {
    ctx.strokeStyle = 'rgba(190,205,255,0.5)';
    ctx.lineWidth = W * 0.012;
    ctx.setLineDash([W * 0.03, W * 0.03]);
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.5, W * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(190,205,255,0.6)';
    ctx.font = `700 ${W * 0.28}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', W / 2, H * 0.52);
  },
  create: () => null,
};

export const APPS = [piano, firefly, soon];
