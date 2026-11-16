import * as THREE from 'three/webgpu';

const UP = new THREE.Vector3(0, 1, 0);

/** Follows behind and above a vehicle, easing after it rather than being bolted on. */
export class ChaseCamera {
  /** Metres behind the vehicle; the mouse wheel changes it. */
  distance = 9;
  private readonly forward = new THREE.Vector3();
  private readonly wanted = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private settled = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    private readonly active: () => boolean,
  ) {
    element.addEventListener(
      'wheel',
      (e) => {
        if (this.active()) this.distance = Math.max(4, Math.min(30, this.distance * (e.deltaY < 0 ? 0.9 : 1.1)));
      },
      { passive: true },
    );
  }

  /** Forget the eased position, e.g. after the vehicle was moved somewhere else. */
  reset(): void {
    this.settled = false;
  }

  /** `groundAt` gives the terrain height under a point, to keep the camera out of hillsides. */
  update(dt: number, vehicle: THREE.Object3D, groundAt: (x: number, z: number) => number | null): void {
    this.forward.set(0, 0, 1).applyQuaternion(vehicle.quaternion).setY(0);
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, 1);
    this.forward.normalize();
    this.wanted.copy(vehicle.position).addScaledVector(this.forward, -this.distance).addScaledVector(UP, 1.6 + this.distance * 0.28);
    const floor = groundAt(this.wanted.x, this.wanted.z);
    if (floor !== null && this.wanted.y < floor + 1.2) this.wanted.y = floor + 1.2;

    if (this.settled) this.camera.position.lerp(this.wanted, 1 - Math.exp(-dt * 5));
    else this.camera.position.copy(this.wanted);
    this.settled = true;
    this.aim.copy(vehicle.position).addScaledVector(UP, 1.5).addScaledVector(this.forward, 2.5);
    this.camera.lookAt(this.aim);
  }
}
