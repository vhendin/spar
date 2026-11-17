// Materials for vegetation. Every instance carries its ground position, and the vertex
// shader uses the distance from there to the camera to decide whether this representation
// (full mesh, simplified mesh or flat picture) is the one to draw, so the three hand over
// to each other tree by tree without the CPU sorting anything per frame.

import * as THREE from 'three/webgpu';
import {
  attribute, float, fract, mix, normalViewGeometry, positionGeometry, positionLocal, select, sin, smoothstep, texture, time, uniform, vec2, vec3,
} from 'three/tsl';
import { FADE_END, FADE_START, JITTER_MIN, JITTER_SPAN } from './coverage';

/** Side of an impostor picture in units of tree height, and the empty margin below the tree. */
export const IMPOSTOR_CELL = 1.1;
export const IMPOSTOR_PAD = 0.03;

export interface MeshMaterialOptions {
  /** Drawn where near <= distance < far, both in metres. */
  near: number;
  far: number;
  /** Shrink away over the last stretch before `far` instead of switching to another representation. */
  fadeOut: boolean;
  stiffness: number;
  doubleSided: boolean;
}

export class VegetationShading {
  /** Wind strength, 0 calm to 1 storm, and the direction it blows towards (x east, y south). */
  readonly wind = uniform(0.35);
  readonly windDirection = uniform(new THREE.Vector2(0.8, 0.6));
  /** Brightness of the flat pictures, which carry baked light; follows the daylight. */
  readonly impostorLight = uniform(1.0);
  /**
   * Where the player's camera is. Distances are measured from here rather than from
   * whichever camera is drawing, so trees are picked the same way in the shadow pass.
   */
  readonly viewer = uniform(new THREE.Vector3());

  /**
   * For instanced meshes whose geometry has `sway` (float per vertex) and `iOrigin`
   * (vec4 per instance: ground position and a random number 0..1).
   */
  meshMaterial(o: MeshMaterialOptions): THREE.MeshLambertNodeMaterial {
    const origin = attribute<'vec4'>('iOrigin', 'vec4');
    const distance = origin.xyz.distance(this.viewer);
    // Each instance switches a little nearer or farther than the next, so no ring shows.
    const jitter = origin.w.mul(JITTER_SPAN).add(JITTER_MIN);
    const inRange = distance.greaterThanEqual(jitter.mul(o.near)).and(distance.lessThan(jitter.mul(o.far)));
    const shown = select(inRange, o.fadeOut ? float(1).sub(smoothstep(o.far * FADE_START, o.far * FADE_END, distance)) : float(1), 0);

    // positionLocal already includes the instance's own placement.
    const local = positionLocal.sub(origin.xyz);
    const phase = origin.x.mul(0.07).add(origin.z.mul(0.05)).add(origin.w.mul(6.28));
    const gust = sin(time.mul(1.6).add(phase)).mul(0.6).add(sin(time.mul(3.7).add(phase.mul(2.3))).mul(0.25)).add(0.5);
    const bend = attribute<'float'>('sway', 'float').mul(local.y).mul(0.05 * (1 - o.stiffness)).mul(this.wind).mul(gust);
    const push = vec3(this.windDirection.x, 0, this.windDirection.y).mul(bend);

    const material = new THREE.MeshLambertNodeMaterial({ vertexColors: true, side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    material.positionNode = origin.xyz.add(local.add(push).mul(shown));
    // Leaves and needles let light through: shade both sides of a surface alike, instead of
    // turning the normal on the back, which leaves crowns black from below.
    if (o.doubleSided) material.normalNode = normalViewGeometry;
    return material;
  }

  /**
   * For flat pictures of trees: a unit quad (x -0.5..0.5, y 0..1) per instance, with
   * `iOrigin` (vec4: ground position and tree height) and `iInfo` (vec4: atlas column,
   * atlas row, the instance's random number, brightness).
   */
  impostorMaterial(atlas: THREE.Texture, columns: number, rows: number, near: number, far: number): THREE.MeshBasicNodeMaterial {
    const origin = attribute<'vec4'>('iOrigin', 'vec4');
    const info = attribute<'vec4'>('iInfo', 'vec4');
    const corner = positionGeometry;
    const toCamera = this.viewer.sub(origin.xyz);
    const distance = toCamera.length();
    const jitter = info.z.mul(JITTER_SPAN).add(JITTER_MIN);
    // Far away a tree is a few pixels: draw fewer, wider ones for the same look.
    const thin = smoothstep(700, 2000, distance);
    const kept = fract(info.z.mul(13.7)).lessThan(mix(1, 0.3, thin));
    const shown = select(distance.greaterThanEqual(jitter.mul(near)).and(distance.lessThan(far)).and(kept), 1, 0);

    // Stand upright and turn about the vertical axis to face the camera.
    const right = vec3(toCamera.z, 0, toCamera.x.negate()).normalize();
    const size = origin.w.mul(IMPOSTOR_CELL).mul(shown);
    const across = right.mul(corner.x.mul(size).mul(mix(1, 1.6, thin)));
    const up = vec3(0, 1, 0).mul(corner.y.sub(IMPOSTOR_PAD / IMPOSTOR_CELL).mul(size));

    const uv = vec2(info.x.add(corner.x).add(0.5).div(columns), info.y.add(corner.y).div(rows));
    const texel = texture(atlas, uv);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
    // Small pictures blur their outline; firm it up so thin crowns do not dissolve with distance.
    material.positionNode = origin.xyz.add(across).add(up);
    material.colorNode = texel.xyz.mul(info.w).mul(this.impostorLight);
    material.opacityNode = texel.w.mul(1.8).min(1);
    return material;
  }
}
