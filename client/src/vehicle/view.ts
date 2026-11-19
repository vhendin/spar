import * as THREE from 'three/webgpu';
import { buildVehicleMeshes } from './body';
import { Grime } from './grime';
import type { VehicleDef } from '@spar/shared';

/**
 * What the view needs of a vehicle: its definition, its body's pose and its wheels. The
 * simulation provides it for our own vehicle, a remote vehicle for another driver's.
 */
export interface VehicleShape {
  readonly def: VehicleDef;
  readonly body: {
    translation(): { x: number; y: number; z: number };
    rotation(): { x: number; y: number; z: number; w: number };
  };
  readonly wheels: readonly { steer: number; rotation: number }[];
  /** Where wheel `i`'s centre is in the body's frame. */
  wheelPosition(i: number): { x: number; y: number; z: number };
}

export interface ViewOptions {
  /** Paint for the body, #rrggbb; the definition's own colours otherwise. */
  color?: string;
  /** Headlight beams that light the ground; without them only the lamps glow. */
  beams?: boolean;
}

/** The definition with its body painted `color`, and the roof a shade darker as on the real ones. */
export function painted(def: VehicleDef, color: string | undefined): VehicleDef {
  if (!color) return def;
  const roof = `#${new THREE.Color(color).multiplyScalar(0.9).getHexString()}`;
  return { ...def, body: { ...def.body, colors: { ...def.body.colors, body: color, roof } } };
}

/** Strength of one headlight beam. */
const HEADLIGHT = 34;

/** Draws a simulated vehicle, smoothing between physics steps. */
export class VehicleView {
  readonly group = new THREE.Group();
  readonly headlights: THREE.Mesh;
  readonly taillights: THREE.Mesh;
  /** Mud on the body and tyres. */
  readonly grime: Grime;
  private readonly glass: THREE.Mesh;
  private readonly wheels: THREE.Mesh[] = [];
  private readonly beams: THREE.SpotLight[] = [];
  private readonly from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private readonly to = { p: new THREE.Vector3(), q: new THREE.Quaternion() };

  constructor(private readonly sim: VehicleShape, options: ViewOptions = {}) {
    const meshes = buildVehicleMeshes(painted(sim.def, options.color));
    this.headlights = meshes.headlights;
    this.taillights = meshes.taillights;
    this.glass = meshes.glass;
    this.group.add(meshes.body, meshes.glass, meshes.headlights, meshes.taillights, meshes.interior);
    meshes.body.geometry.computeBoundingBox();
    this.grime = new Grime(meshes.body.geometry.boundingBox!.max.y);
    meshes.body.material = this.grime.body;
    meshes.wheel.material = this.grime.wheel;
    meshes.body.castShadow = meshes.body.receiveShadow = true;
    meshes.interior.receiveShadow = true;
    for (const at of options.beams === false ? [] : sim.def.body.headlights) {
      // Present from the start, at zero strength: adding lights later makes every material rebuild.
      const beam = new THREE.SpotLight(0xfff0d2, 0, 160, 0.62, 0.7, 1);
      beam.position.set(at[0]!, at[1]!, at[2]! + 0.05);
      beam.target.position.set(at[0]! * 0.6, at[1]! - 1.1, at[2]! + 22);
      this.beams.push(beam);
      this.group.add(beam, beam.target);
    }
    for (let i = 0; i < sim.wheels.length; i++) {
      const wheel = meshes.wheel.clone();
      wheel.castShadow = true;
      wheel.rotation.order = 'YXZ';
      this.wheels.push(wheel);
      this.group.add(wheel);
    }
    this.snap();
  }

  /** Switches the lamps: headlights with their beams, tail lights, and brake lights brighter still. */
  setLights(on: boolean, braking: boolean): void {
    for (const beam of this.beams) beam.intensity = on ? HEADLIGHT : 0;
    (this.headlights.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3 : 0;
    (this.taillights.material as THREE.MeshStandardMaterial).emissiveIntensity = braking ? 4 : on ? 1.2 : 0;
  }

  /** From the driver's seat the windows are left out: they are tinted panels, not see-through. */
  setInside(inside: boolean): void {
    this.glass.visible = !inside;
  }

  /** Frees the meshes' GPU memory, when the vehicle is swapped for another. */
  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) (m as THREE.Material).dispose();
    });
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
