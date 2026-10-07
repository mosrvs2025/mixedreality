// Reads the headset, hands and controllers into one simple per-frame snapshot
// that every app shares:
//   head / headQ / fwd / up        the viewer
//   hands   tracked points used by Firefly Night (fingertip, palm, grip)
//   tips    EVERY fingertip (10 per pair of hands) + controller tips, for the piano
//   pokers  the points used to press UI buttons (index tips + controller tips)
import * as THREE from 'three';
import { analyzeHand, FIST_CLOSE, FIST_OPEN } from '../core/hands.js';

const FINGER_TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();

export class Input {
  constructor() {
    this.head = new THREE.Vector3(0, 1.6, 0);
    this.headQ = new THREE.Quaternion();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.hands = [];
    this.tips = [];
    this.pokers = [];
    this.handBySource = new Map();
    this.hasHands = false;
    this._prev = new Map();
    this._vel = new Map();
    this._fist = new Map();
  }

  // Velocity is smoothed: hand-tracking jitter must never read as a swipe.
  track(key, pos, dt, extra) {
    const prev = this._prev.get(key);
    const raw = new THREE.Vector3();
    if (prev && dt > 0) raw.subVectors(pos, prev).divideScalar(dt);
    if (raw.length() > 8) raw.setScalar(0); // tracking jump, not motion
    const vel = this._vel.get(key) || new THREE.Vector3();
    vel.lerp(raw, 0.3);
    this._vel.set(key, vel);
    this._prev.set(key, pos.clone());
    return { pos, vel: vel.clone(), id: key, ...extra };
  }

  reset() {
    this._prev.clear();
    this._vel.clear();
    this._fist.clear();
    this.hands = [];
    this.tips = [];
    this.pokers = [];
    this.handBySource.clear();
  }

  readXR(frame, refSpace, dt) {
    const pose = frame.getViewerPose(refSpace);
    if (pose) {
      const t = pose.transform;
      this.head.set(t.position.x, t.position.y, t.position.z);
      this.headQ.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
      this.fwd.set(0, 0, -1).applyQuaternion(this.headQ);
      this.up.set(0, 1, 0).applyQuaternion(this.headQ);
    }

    const hands = [];
    const tips = [];
    const pokers = [];
    this.handBySource.clear();
    this.hasHands = false;

    for (const src of frame.session.inputSources) {
      if (src.hand) {
        this.hasHands = true;
        const side = src.handedness;
        const joint = (name) => {
          const j = src.hand.get(name);
          const jp = j && frame.getJointPose(j, refSpace);
          return jp ? new THREE.Vector3(jp.transform.position.x, jp.transform.position.y, jp.transform.position.z) : null;
        };
        const info = analyzeHand(joint, side);
        let facingHead = false;
        let fistStart = false;
        if (info) {
          // Which way is the palm facing relative to the player's face?
          _p.subVectors(this.head, info.center).normalize();
          facingHead = info.normal.dot(_p) > 0.35;
          const was = this._fist.get(side) || false;
          const now = was ? info.fistDist < FIST_OPEN : info.fistDist < FIST_CLOSE;
          fistStart = now && !was;
          this._fist.set(side, now);
        }

        let indexRec = null;
        for (const name of FINGER_TIPS) {
          const pos = joint(name);
          if (!pos) continue;
          const rec = this.track(`${side}-${name}`, pos, dt, { kind: 'hand', finger: name, side, source: src, tip: true });
          tips.push(rec);
          if (name === 'index-finger-tip') indexRec = rec;
        }
        if (indexRec) {
          pokers.push(indexRec);
          // Fingertip as a Firefly Night "hand": small, so you have to touch the firefly.
          const h = { ...indexRec, radius: 0.06, lantern: true, facingHead, source: src };
          hands.push(h);
          this.handBySource.set(src, h);
        }
        if (info) {
          // Palm: the TRUE palm centre. It only catches fireflies on the palm side.
          hands.push(
            this.track(`${side}-palm`, info.center, dt, {
              radius: 0.1,
              kind: 'hand',
              lantern: false,
              source: src,
              side,
              normal: info.normal,
              wrist: info.wrist,
              forearm: info.forearm,
              facingHead,
              fist: this._fist.get(side),
              fistStart,
              cradle: info.normal.y > 0.65 && info.fistDist > FIST_OPEN,
            }),
          );
        }
      } else if (src.gripSpace) {
        const gp = frame.getPose(src.gripSpace, refSpace);
        if (!gp) continue;
        _m.fromArray(gp.transform.matrix);
        const side = src.handedness;
        const pos = new THREE.Vector3(0, 0.01, -0.06).applyMatrix4(_m);
        const squeeze = !!src.gamepad?.buttons?.[1]?.pressed;
        const h = this.track(`${side}-grip`, pos, dt, { radius: 0.13, kind: 'controller', lantern: true, source: src, side, cradle: squeeze });
        hands.push(h);
        this.handBySource.set(src, h);
        // The pointing tip of the controller: pokes UI and presses piano keys.
        const tipPos = new THREE.Vector3(0, 0, -0.09).applyMatrix4(_m);
        const tip = this.track(`${side}-ctrl-tip`, tipPos, dt, { kind: 'controller', finger: 'tip', side, source: src, tip: true });
        // Where the controller points (used to aim at surfaces).
        const rp = src.targetRaySpace && frame.getPose(src.targetRaySpace, refSpace);
        if (rp) {
          _m.fromArray(rp.transform.matrix);
          tip.ray = { origin: new THREE.Vector3().setFromMatrixPosition(_m), dir: new THREE.Vector3(0, 0, -1).transformDirection(_m) };
        }
        tips.push(tip);
        pokers.push(tip);
      }
    }
    this.hands = hands;
    this.tips = tips;
    this.pokers = pokers;
  }
}
