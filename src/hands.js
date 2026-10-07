// Hand geometry from WebXR joints: the true palm centre, which way the palm
// faces, and whether the hand is a fist. Pure functions, no WebXR objects.
import * as THREE from 'three';

const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _t = new THREE.Vector3();

export const FIST_CLOSE = 0.085; // mean fingertip→palm distance (m) to count as closed
export const FIST_OPEN = 0.115; // …and to count as open again (hysteresis)

// `joint(name)` returns a THREE.Vector3 (or null) in world space.
// Returns { center, normal, fistDist } or null when the hand isn't readable.
export function analyzeHand(joint, handedness) {
  const wrist = joint('wrist');
  const index = joint('index-finger-metacarpal');
  const middle = joint('middle-finger-metacarpal');
  const pinky = joint('pinky-finger-metacarpal');
  if (!wrist || !index || !pinky) return null;

  // The palm centre sits between the wrist and the knuckle line, not on the
  // knuckles: average the wrist with the index and pinky metacarpals (and the
  // middle one, which is nearer the knuckle line, counted once).
  const center = new THREE.Vector3().add(wrist).add(index).add(pinky);
  if (middle) center.add(middle).divideScalar(4);
  else center.divideScalar(3);

  // Normal out of the palm from geometry, so it doesn't depend on a runtime's
  // joint-axis convention: forward (wrist→middle) × across (index→pinky),
  // flipped for the left hand.
  _f.subVectors(middle || index, wrist);
  _l.subVectors(pinky, index);
  const normal = new THREE.Vector3().crossVectors(_f, _l).normalize();
  if (handedness === 'left') normal.negate();

  let fistDist = Infinity;
  const tips = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'].map(joint);
  if (tips.every(Boolean)) {
    fistDist = 0;
    for (const t of tips) fistDist += _t.subVectors(t, center).length();
    fistDist /= tips.length;
  }
  return { center, normal, fistDist };
}
