// Where the player can actually reach. Fireflies must never sit somewhere
// that would require leaving the Quest boundary.
//
// Preferred source: the guardian polygon from the 'bounded-floor' reference
// space. Fallback: the places the player has actually stood (their head's
// footprint), which grows as they move around.
import * as THREE from 'three';

export const ARM_REACH = 0.5; // how far past the walkable edge a hand reaches (m)
const CELL = 0.25;
const VISITED_REACH = 0.85; // fallback: within this of somewhere you've stood

export class PlayArea {
  constructor() {
    this.bounds = null; // THREE.Vector2[] in local-floor x/z
    this.visited = new Map();
  }

  setBounds(poly) {
    this.bounds = poly && poly.length >= 3 ? poly : null;
  }

  visit(head) {
    const key = `${Math.round(head.x / CELL)},${Math.round(head.z / CELL)}`;
    if (!this.visited.has(key)) this.visited.set(key, new THREE.Vector2(head.x, head.z));
  }

  reset() {
    this.visited.clear();
  }

  get mode() {
    return this.bounds ? `boundary (${this.bounds.length} pts)` : `footprint (${this.visited.size} cells)`;
  }

  // Horizontal distance from (x, z) to the walkable region (0 if inside).
  distance(x, z) {
    if (this.bounds) {
      if (this._inside(x, z)) return 0;
      let best = Infinity;
      const b = this.bounds;
      for (let i = 0, j = b.length - 1; i < b.length; j = i++) best = Math.min(best, segDist(x, z, b[j], b[i]));
      return best;
    }
    let best = Infinity;
    for (const v of this.visited.values()) best = Math.min(best, Math.hypot(x - v.x, z - v.y));
    return Math.max(0, best - (VISITED_REACH - ARM_REACH));
  }

  reachable(p) {
    return p.y > 0.05 && p.y < 1.95 && this.distance(p.x, p.z) <= ARM_REACH;
  }

  // A random point comfortably inside the walkable region, for floating spawns.
  randomInside(head) {
    if (this.bounds) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of this.bounds) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.y);
        maxZ = Math.max(maxZ, p.y);
      }
      for (let i = 0; i < 30; i++) {
        const x = minX + Math.random() * (maxX - minX);
        const z = minZ + Math.random() * (maxZ - minZ);
        if (this._inside(x, z)) return new THREE.Vector3(x, 0, z);
      }
    }
    const cells = [...this.visited.values()];
    const c = cells.length ? cells[(Math.random() * cells.length) | 0] : new THREE.Vector2(head.x, head.z);
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 0.4;
    return new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.y + Math.sin(a) * r);
  }

  _inside(x, z) {
    let inside = false;
    const b = this.bounds;
    for (let i = 0, j = b.length - 1; i < b.length; j = i++) {
      const xi = b[i].x, zi = b[i].y, xj = b[j].x, zj = b[j].y;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
}

function segDist(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / l2)) : 0;
  return Math.hypot(x - (a.x + t * dx), z - (a.y + t * dz));
}
