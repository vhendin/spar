// The stars' own frame: a direction fixed among the stars, turned by `starTurn` into where
// it stands in the world at a moment (x east, y up, z south), and back.

import * as THREE from 'three/webgpu';
import { siderealAngle } from '@spar/shared';

/** The celestial pole: due north, as high as the latitude (degrees). */
export function celestialPole(latitude: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latitude);
  return new THREE.Vector3(0, Math.sin(lat), -Math.cos(lat));
}

/** Sets `out` to turn world directions at `utcMs` into the stars' frame. Its transpose turns them back. */
export function starTurn(out: THREE.Matrix3, utcMs: number, latitude: number, longitude: number): THREE.Matrix3 {
  return out.setFromMatrix4(new THREE.Matrix4().makeRotationAxis(celestialPole(latitude), siderealAngle(utcMs, longitude)));
}
