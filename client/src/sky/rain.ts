import * as THREE from 'three/webgpu';
import { attribute, cos, cross, float, fract, mix, normalize, positionGeometry, sin, time, uniform, vec3 } from 'three/tsl';

/** Rain falls inside a box this large around the camera; drops leaving one side come back in at the other. */
const BOX = new THREE.Vector3(40, 26, 40);
const DROPS = 9000;

/** Streaks of rain, or flakes of snow, near the camera, moved entirely in the vertex shader. */
export class Rain {
  readonly mesh: THREE.Mesh;
  private readonly viewer = uniform(new THREE.Vector3());
  /** Sideways speed of the drops in m/s (x east, y unused, z south). */
  private readonly wind = uniform(new THREE.Vector3());
  private readonly strength = uniform(0);
  /** 0 rain, 1 snow. */
  private readonly snow = uniform(0);
  private readonly geometry = new THREE.InstancedBufferGeometry();

  constructor() {
    const seeds = new Float32Array(DROPS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random(); // only looks: no need to match between players
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geometry.instanceCount = 0;

    const seed = attribute<'vec4'>('iSeed', 'vec4');
    const box = vec3(BOX.x, BOX.y, BOX.z);
    // Snow drifts down slowly and goes more with the wind.
    const fall = mix(seed.w.mul(3).add(9), seed.w.mul(0.6).add(0.9), this.snow);
    const velocity = vec3(this.wind.x.mul(mix(1, 0.7, this.snow)), fall.negate(), this.wind.z.mul(mix(1, 0.7, this.snow)));
    // Each drop has a place in the world that keeps falling; it is drawn where that place
    // lands inside the box around the camera.
    const where = fract(seed.xyz.add(velocity.mul(time).sub(this.viewer).div(box)).add(0.5)).sub(0.5);
    // Flakes flutter from side to side as they fall.
    const flutter = vec3(sin(time.mul(1.3).add(seed.x.mul(40))), 0, cos(time.mul(1.1).add(seed.z.mul(40)))).mul(this.snow.mul(0.35));
    const centre = this.viewer.add(where.mul(box)).add(flutter);
    // A rain streak is long and thin; a flake is a small square.
    const along = normalize(velocity).mul(mix(seed.w.mul(0.35).add(0.3), seed.w.mul(0.015).add(0.025), this.snow)).negate();
    const side = normalize(cross(along, this.viewer.sub(centre))).mul(mix(0.014, 0.03, this.snow));

    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.positionNode = centre.add(along.mul(positionGeometry.y)).add(side.mul(positionGeometry.x));
    material.colorNode = mix(vec3(0.78, 0.82, 0.86), vec3(0.95, 0.96, 0.98), this.snow);
    material.opacityNode = float(0.16).add(this.strength.mul(0.2)).add(this.snow.mul(0.45));
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** `rain` 0..1; `windX`, `windZ` in m/s; with `snow` it falls as flakes. */
  update(camera: THREE.Vector3, rain: number, windX: number, windZ: number, snow = false): void {
    this.snow.value = snow ? 1 : 0;
    this.geometry.instanceCount = Math.round(DROPS * Math.min(1, rain));
    this.mesh.visible = this.geometry.instanceCount > 0;
    this.viewer.value.copy(camera);
    this.wind.value.set(windX, 0, windZ);
    this.strength.value = rain;
  }
}
