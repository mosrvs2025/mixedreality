// Spatial persistence: the fireflies you keep settle on your real walls and
// are pinned there with a persistent anchor, so tomorrow night they are still
// glowing in the same spots of your room.
import * as THREE from 'three';

const KEY = 'firefly-night.memories.v1';
const SIM_KEY = 'firefly-night.sim-memories.v1';
const MAX_NIGHTS = 4;
const MAX_POINTS = 60;

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}
function store(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: memories just won't persist */
  }
}

export class Memories {
  constructor(sim) {
    this.sim = sim;
    this.nights = load(sim ? SIM_KEY : KEY);
    this.live = []; // { anchor, night, located }
  }

  get supported() {
    return this.sim || !!this.session?.restorePersistentAnchor;
  }

  // Restore anchors from previous nights. onPoints(night, getWorldPoints) is
  // called for each night that comes back.
  async restore(session, onNight) {
    this.session = session;
    if (this.sim) {
      for (const n of this.nights) onNight(n, () => n.pts.map((p) => new THREE.Vector3().fromArray(p)));
      return;
    }
    if (!session?.restorePersistentAnchor) return;
    const keep = [];
    for (const n of this.nights) {
      try {
        const anchor = await session.restorePersistentAnchor(n.uuid);
        const rec = { anchor, night: n };
        this.live.push(rec);
        keep.push(n);
        onNight(n, (frame, refSpace) => {
          const pose = frame?.getPose(anchor.anchorSpace, refSpace);
          if (!pose) return null;
          const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
          return n.pts.map((p) => new THREE.Vector3().fromArray(p).applyMatrix4(m));
        });
      } catch {
        // Anchor no longer exists (room changed, storage cleared): forget it.
      }
    }
    this.nights = keep;
    store(KEY, this.nights);
  }

  // Pin tonight's resting fireflies to the room. Needs an XRFrame.
  async remember(frame, refSpace, worldPts) {
    const pts = worldPts.slice(0, MAX_POINTS);
    if (!pts.length) return false;
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    c.divideScalar(pts.length);
    const local = pts.map((p) => p.clone().sub(c).toArray().map((v) => +v.toFixed(3)));
    if (this.sim) {
      this.nights.push({ when: Date.now(), pts: pts.map((p) => p.toArray().map((v) => +v.toFixed(3))) });
      while (this.nights.length > MAX_NIGHTS) this.nights.shift();
      store(SIM_KEY, this.nights);
      return true;
    }
    const session = this.session;
    if (!frame?.createAnchor || !session?.restorePersistentAnchor) return false;
    try {
      const anchor = await frame.createAnchor(new XRRigidTransform({ x: c.x, y: c.y, z: c.z }), refSpace);
      const uuid = await anchor.requestPersistentHandle();
      this.nights.push({ uuid, when: Date.now(), pts: local });
      while (this.nights.length > MAX_NIGHTS) {
        const old = this.nights.shift();
        session.deletePersistentAnchor?.(old.uuid).catch(() => {});
      }
      store(KEY, this.nights);
      return true;
    } catch (e) {
      console.warn('Could not persist anchor', e);
      return false;
    }
  }
}

export function loadBest() {
  try {
    return +localStorage.getItem('firefly-night.best') || 0;
  } catch {
    return 0;
  }
}
export function saveBest(v) {
  try {
    localStorage.setItem('firefly-night.best', String(v));
  } catch {
    /* ignore */
  }
}
