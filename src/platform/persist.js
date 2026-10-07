// Spatial persistence for apps: remember where something lives in the room.
//
// In a headset this uses WebXR persistent anchors (the headset itself
// re-locates them next session, even if its tracking origin moved). In the
// desktop preview the room never moves, so plain coordinates are enough.
import * as THREE from 'three';

const PREFIX = 'roomspace.slot.';

function read(name) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + name));
  } catch {
    return null;
  }
}
function write(name, v) {
  try {
    if (v) localStorage.setItem(PREFIX + name, JSON.stringify(v));
    else localStorage.removeItem(PREFIX + name);
  } catch {
    /* storage unavailable: nothing persists */
  }
}

export class PersistedPose {
  constructor(name, shell) {
    this.name = name;
    this.shell = shell;
    this.anchor = null; // live XRAnchor, if tracking one this session
    this.rec = read(name);
  }

  get extra() {
    return this.rec?.extra || null;
  }

  get supported() {
    return this.shell.sim || !!this.shell.session?.restorePersistentAnchor;
  }

  get hasSaved() {
    return !!this.rec;
  }

  // Try to bring last session's anchor back. Resolves true when something
  // saved can be used (XR: the anchor; sim: the stored matrix).
  async restore() {
    if (!this.rec) return false;
    if (this.shell.sim) return true;
    const s = this.shell.session;
    if (!this.rec.uuid || !s?.restorePersistentAnchor) return false;
    try {
      this.anchor = await s.restorePersistentAnchor(this.rec.uuid);
      return true;
    } catch {
      // The anchor is gone (room changed, storage cleared): forget it.
      this.forget();
      return false;
    }
  }

  // Current world pose of the saved thing, or null until the headset has
  // located it again.
  pose(frame, refSpace, out = new THREE.Matrix4()) {
    if (this.shell.sim) return this.rec ? out.fromArray(this.rec.m) : null;
    if (!this.anchor || !frame) return null;
    const p = frame.getPose(this.anchor.anchorSpace, refSpace);
    return p ? out.fromArray(p.transform.matrix) : null;
  }

  // Pin `matrix` (world) in the room. Needs the current XRFrame in a headset.
  async save(frame, refSpace, matrix, extra = {}) {
    const rec = { m: matrix.toArray(), extra, when: Date.now() };
    if (this.shell.sim) {
      this.rec = rec;
      write(this.name, rec);
      return true;
    }
    const s = this.shell.session;
    if (!frame?.createAnchor) return false;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    matrix.decompose(pos, quat, new THREE.Vector3());
    try {
      const anchor = await frame.createAnchor(new XRRigidTransform({ x: pos.x, y: pos.y, z: pos.z }, { x: quat.x, y: quat.y, z: quat.z, w: quat.w }), refSpace);
      const old = this.rec?.uuid;
      this.anchor = anchor;
      if (s?.restorePersistentAnchor && anchor.requestPersistentHandle) {
        rec.uuid = await anchor.requestPersistentHandle();
        if (old && old !== rec.uuid) s.deletePersistentAnchor?.(old).catch(() => {});
      }
      this.rec = rec;
      write(this.name, rec);
      return !!rec.uuid;
    } catch (e) {
      console.warn('Could not anchor', e);
      return false;
    }
  }

  // Update only the settings stored alongside the pose.
  saveExtra(extra) {
    if (!this.rec) return;
    this.rec.extra = extra;
    write(this.name, this.rec);
  }

  forget() {
    const uuid = this.rec?.uuid;
    if (uuid) this.shell.session?.deletePersistentAnchor?.(uuid).catch(() => {});
    this.anchor = null;
    this.rec = null;
    write(this.name, null);
  }
}

// Small key/value settings for apps (instrument, volume, …).
export function loadSettings(name, fallback) {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(`roomspace.settings.${name}`)) || {}) };
  } catch {
    return { ...fallback };
  }
}
export function saveSettings(name, value) {
  try {
    localStorage.setItem(`roomspace.settings.${name}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
