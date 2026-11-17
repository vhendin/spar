// Seeing the vehicle through what stands in front of it. Trees, rocks and buildings drop
// their fragments inside a cone from the camera to the vehicle, in a fine stipple rather
// than all at once, so they read as see-through ghosts and keep their shape. The stipple
// needs no sorting: everything stays in the opaque pass. The shadow pass keeps every
// fragment, so shadows do not get holes.

import * as THREE from 'three/webgpu';
import { bool, float, fract, positionWorld, screenCoordinate, smoothstep, uniform, vec3 } from 'three/tsl';

/** Radius of the cone around the vehicle's middle, and at the camera, in metres. */
const RADIUS_AT_VEHICLE = 3;
const RADIUS_AT_CAMERA = 0.6;
/** Below the line of sight, distances count this much more, so the ground cover round the wheels stays. */
const BELOW = 2.2;
/** Share of fragments dropped at the heart of the cone: the rest outline what is there. */
const MOST = 0.82;

export class SeeThrough {
  /** The player's camera and the point it looks at, in world coordinates. */
  readonly eye = uniform(new THREE.Vector3());
  readonly focus = uniform(new THREE.Vector3(0, -1e6, 0));
  /** 0 turns it off (from the cab or in free flight), 1 on. */
  readonly strength = uniform(0);

  /** Makes `material` see-through between camera and vehicle. */
  apply(material: THREE.NodeMaterial): void {
    const axis = this.focus.sub(this.eye);
    const length = axis.length().max(0.01);
    const dir = axis.div(length);
    const rel = positionWorld.sub(this.eye);
    const along = rel.dot(dir);
    const off = rel.sub(dir.mul(along));
    // Squash the cone below the line of sight; the sign of y says which side we are on.
    const offset = vec3(off.x, off.y.mul(off.y.lessThan(0).select(float(BELOW), float(1))), off.z).length();
    const t = along.div(length).clamp(0, 1);
    const radius = t.mix(float(RADIUS_AT_CAMERA), float(RADIUS_AT_VEHICLE));
    const inside = float(1).sub(smoothstep(radius.mul(0.7), radius, offset));
    // Only what lies between: from just ahead of the lens to short of the vehicle.
    const between = smoothstep(0.2, 0.8, along).mul(float(1).sub(smoothstep(length.sub(2.6), length.sub(1.6), along)));
    const amount = inside.mul(between).mul(this.strength).mul(MOST);
    // Interleaved gradient noise: an even stipple that does not crawl as the view turns.
    const p = screenCoordinate.xy.floor();
    const noise = fract(fract(p.x.mul(0.06711056).add(p.y.mul(0.00583715))).mul(52.9829189));
    material.maskNode = noise.greaterThanEqual(amount);
    material.maskShadowNode = bool(true);
  }
}
