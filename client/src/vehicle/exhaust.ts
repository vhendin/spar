// Exhaust fumes from the pipe: a thin haze at idle, darker puffs when the engine is pushed,
// and a white plume of condensing water vapour in cold air. Carried by the vehicle's speed,
// rising a little and drifting off with the wind. Nothing while the engine is drowned or the
// pipe is under water.

import * as THREE from 'three/webgpu';
import { attribute, float, positionGeometry, uniform, uv, vec3 } from 'three/tsl';
import { exhaustOutlet } from './body';
import { Batch } from './spray';
import type { VehicleSim } from './sim';

const PUFFS = 500;
/** Only emitted while the camera is this close to the vehicle, metres. */
const NEAR = 160;

/** Mean air temperature by month in the mountain valleys, °C (mid-month, January first). */
const MONTHLY = [-10, -9, -6, -1, 5, 10, 12, 11, 6, 1, -5, -8];

/**
 * A rough air temperature, °C, for a day of the year (1 is 1 January) and the sun's height
 * (radians): the month's mean, warmer by day and colder at night.
 */
export function airTemperature(day: number, sunElevation: number): number {
  const m = (((day - 15) / 30.42) % 12 + 12) % 12;
  const i = Math.floor(m), f = m - i;
  const mean = MONTHLY[i]! + (MONTHLY[(i + 1) % 12]! - MONTHLY[i]!) * f;
  return mean + 5 * Math.max(-0.4, Math.sin(sunElevation)) - 1;
}

/** How much the exhaust's water condenses into a white plume: 0 above 8 °C, 1 from -8 °C. */
export function condensation(celsius: number): number {
  const t = Math.min(1, Math.max(0, (8 - celsius) / 16));
  return t * t * (3 - 2 * t);
}

const HAZE: [number, number, number] = [0.55, 0.56, 0.58];
const SOOT: [number, number, number] = [0.16, 0.15, 0.14];
const VAPOUR: [number, number, number] = [0.92, 0.93, 0.95];

export class Exhaust {
  readonly group = new THREE.Group();
  private readonly right = uniform(new THREE.Vector3(1, 0, 0));
  private readonly up = uniform(new THREE.Vector3(0, 1, 0));
  private readonly puffs: Batch;
  private owed = 0;
  /** The engine's effort, smoothed, and how fast it is rising (a sudden push gives soot). */
  private load = 0;
  private surge = 0;
  private readonly outlet = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  constructor() {
    const at = attribute<'vec4'>('iAt', 'vec4');
    const tint = attribute<'vec4'>('iTint', 'vec4');
    const r = uv().sub(0.5).length();
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.positionNode = at.xyz.add(this.right.mul(positionGeometry.x).add(this.up.mul(positionGeometry.y)).mul(at.w));
    material.colorNode = tint.rgb;
    material.normalNode = vec3(0, 0, 1);
    material.opacityNode = tint.a.mul(float(1).sub(r.mul(2)).max(0).pow(1.5));
    this.puffs = new Batch(PUFFS, material, 'exhaust');
    this.puffs.mesh.castShadow = false;
    this.group.add(this.puffs.mesh);
  }

  /**
   * Call every frame after the vehicle view is placed. `running` false when the engine is not
   * going (not yet placed); `winch` 0..1 how hard the winch pulls; `wind` in m/s (x east,
   * z south); `celsius` the air temperature.
   */
  update(dt: number, sim: VehicleSim, vehicle: THREE.Object3D, camera: THREE.Camera, running: boolean, winch: number, wind: THREE.Vector2, celsius: number): void {
    camera.updateMatrixWorld();
    this.right.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.value.setFromMatrixColumn(camera.matrixWorld, 1);
    if (dt > 0) {
      const [ox, oy, oz] = exhaustOutlet(sim.def);
      this.outlet.set(ox, oy, oz).applyQuaternion(vehicle.quaternion).add(vehicle.position);
      const effort = Math.max(sim.drivetrain.shifting > 0 ? 0 : sim.pedal, winch * 0.7);
      const before = this.load;
      this.load += (effort - this.load) * Math.min(1, dt * 6);
      this.surge = Math.max(this.surge * Math.exp(-3 * dt), Math.max(0, (this.load - before) / dt) * 0.25);
      // The pipe under water: the gas bubbles away unseen.
      const submerged = sim.wading > oy - 0.02;
      const near = camera.position.distanceTo(this.outlet) < NEAR;
      if (running && !sim.drowned && !submerged && near) this.emit(dt, sim, vehicle, condensation(celsius));
      else this.owed = 0;
      this.move(dt, wind);
    }
    // Small at the pipe, spreading as it goes; fading out.
    this.puffs.upload((left) => [1 + (1 - left) * 9, Math.min(1, left * 1.4) * Math.sqrt(left)]);
  }

  private emit(dt: number, sim: VehicleSim, vehicle: THREE.Object3D, cold: number): void {
    const def = sim.def.drivetrain;
    const rev = Math.max(def.idle, sim.drivetrain.rpm || def.idle) / def.redline;
    const load = this.load, soot = Math.min(1, this.surge + load * 0.35);
    // More gas the faster and harder the engine turns.
    this.owed += (10 + 40 * rev + 25 * load) * dt;
    let n = Math.floor(this.owed);
    this.owed -= n;
    n = Math.min(n, 12);
    const v = sim.body.linvel();
    // Out of the pipe backwards, a little down and out.
    this.d.set(-0.25, -0.15, -1).normalize().applyQuaternion(vehicle.quaternion);
    for (let k = 0; k < n; k++) {
      const speed = 2 + 4 * rev + 3 * load;
      const jitter = (): number => (Math.random() * 2 - 1) * 0.4;
      // Haze, darkened by soot under effort; whitened by vapour in the cold.
      const rgb = HAZE.map((c, i) => {
        const sooty = c + (SOOT[i]! - c) * soot;
        return sooty + (VAPOUR[i]! - sooty) * cold * (1 - soot * 0.6);
      }) as [number, number, number];
      const alpha = 0.2 + 0.35 * soot + 0.5 * cold;
      const life = 0.9 + 0.6 * load + 2.6 * cold + Math.random() * 0.6;
      const t = Math.random() * dt;
      this.p.copy(this.outlet).addScaledVector(this.d, speed * t);
      this.puffs.add(
        this.p.x, this.p.y, this.p.z,
        this.d.x * speed + v.x * 0.8 + jitter(), this.d.y * speed + v.y * 0.8 + jitter(), this.d.z * speed + v.z * 0.8 + jitter(),
        life, 0.14 + 0.08 * load + Math.random() * 0.05, rgb, 0.9 + Math.random() * 0.2, alpha,
      );
    }
  }

  private move(dt: number, wind: THREE.Vector2): void {
    // Slowed by the air and taken by the wind (less of it close to the ground), warm gas rising.
    const p = this.puffs;
    const k = 1 - Math.exp(-1.6 * dt);
    const wx = wind.x * 0.5, wz = wind.y * 0.5;
    for (let i = p.count - 1; i >= 0; i--) {
      if ((p.life[i]! -= dt) <= 0) {
        p.remove(i);
        continue;
      }
      const j = i * 3;
      p.vel[j]! += (wx - p.vel[j]!) * k;
      p.vel[j + 1]! += (0.5 - p.vel[j + 1]!) * k;
      p.vel[j + 2]! += (wz - p.vel[j + 2]!) * k;
      p.pos[j]! += p.vel[j]! * dt;
      p.pos[j + 1]! += p.vel[j + 1]! * dt;
      p.pos[j + 2]! += p.vel[j + 2]! * dt;
    }
  }
}
