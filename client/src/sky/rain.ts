import * as THREE from 'three/webgpu';
import { attribute, cross, float, fract, normalize, positionGeometry, time, uniform, vec3 } from 'three/tsl';

/** Rain falls inside a box this large around the camera; drops leaving one side come back in at the other. */
const BOX = new THREE.Vector3(40, 26, 40);
const DROPS = 9000;

/** Streaks of rain near the camera, moved entirely in the vertex shader. */
export class Rain {
  readonly mesh: THREE.Mesh;
  private readonly viewer = uniform(new THREE.Vector3());
  /** Sideways speed of the drops in m/s (x east, y unused, z south). */
  private readonly wind = uniform(new THREE.Vector3());
  private readonly strength = uniform(0);
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
    const velocity = vec3(this.wind.x, seed.w.mul(3).add(9).negate(), this.wind.z);
    // Each drop has a place in the world that keeps falling; it is drawn where that place
    // lands inside the box around the camera.
    const where = fract(seed.xyz.add(velocity.mul(time).sub(this.viewer).div(box)).add(0.5)).sub(0.5);
    const centre = this.viewer.add(where.mul(box));
    const along = normalize(velocity).mul(seed.w.mul(0.35).add(0.3)).negate();
    const side = normalize(cross(along, this.viewer.sub(centre))).mul(0.014);

    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.positionNode = centre.add(along.mul(positionGeometry.y)).add(side.mul(positionGeometry.x));
    material.colorNode = vec3(0.78, 0.82, 0.86);
    material.opacityNode = float(0.16).add(this.strength.mul(0.2));
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** `rain` 0..1; `windX`, `windZ` in m/s. */
  update(camera: THREE.Vector3, rain: number, windX: number, windZ: number): void {
    this.geometry.instanceCount = Math.round(DROPS * Math.min(1, rain));
    this.mesh.visible = this.geometry.instanceCount > 0;
    this.viewer.value.copy(camera);
    this.wind.value.set(windX, 0, windZ);
    this.strength.value = rain;
  }
}
