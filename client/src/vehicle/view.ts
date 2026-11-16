import * as THREE from 'three/webgpu';
import { buildVehicleMeshes } from './body';
import type { VehicleSim } from './sim';

/** Draws a simulated vehicle, smoothing between physics steps. */
export class VehicleView {
  readonly group = new THREE.Group();
  readonly headlights: THREE.Mesh;
  readonly taillights: THREE.Mesh;
  private readonly wheels: THREE.Mesh[] = [];
  private readonly from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private readonly to = { p: new THREE.Vector3(), q: new THREE.Quaternion() };

  constructor(private readonly sim: VehicleSim) {
    const meshes = buildVehicleMeshes(sim.def);
    this.headlights = meshes.headlights;
    this.taillights = meshes.taillights;
    this.group.add(meshes.body, meshes.headlights, meshes.taillights);
    for (let i = 0; i < sim.wheels.length; i++) {
      const wheel = meshes.wheel.clone();
      wheel.rotation.order = 'YXZ';
      this.wheels.push(wheel);
      this.group.add(wheel);
    }
    this.snap();
  }

  /** Jumps to the body's current pose, after placing or resetting the vehicle. */
  snap(): void {
    this.read(this.to);
    this.from.p.copy(this.to.p);
    this.from.q.copy(this.to.q);
  }

  /** Call after every physics step. */
  capture(): void {
    this.from.p.copy(this.to.p);
    this.from.q.copy(this.to.q);
    this.read(this.to);
  }

  /** Call every frame; `alpha` is how far the frame lies between the last two physics steps. */
  render(alpha: number): void {
    this.group.position.lerpVectors(this.from.p, this.to.p, alpha);
    this.group.quaternion.slerpQuaternions(this.from.q, this.to.q, alpha);
    this.wheels.forEach((mesh, i) => {
      const at = this.sim.wheelPosition(i);
      const wheel = this.sim.wheels[i]!;
      mesh.position.set(at.x, at.y, at.z);
      mesh.rotation.set(wheel.rotation, wheel.steer, 0);
    });
  }

  private read(target: { p: THREE.Vector3; q: THREE.Quaternion }): void {
    const p = this.sim.body.translation();
    const q = this.sim.body.rotation();
    target.p.set(p.x, p.y, p.z);
    target.q.set(q.x, q.y, q.z, q.w);
  }
}
