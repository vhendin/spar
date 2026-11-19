// Mud on the vehicle. Driving through mud, bog and wet ground, and above all spinning the
// wheels in it, plasters the tyres first and then the body from the sills upwards in
// blotches. Fresh mud is dark and glossy and dries paler. Wading through water washes the
// vehicle, and rain does so slowly.

import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, positionLocal, smoothstep, uniform, vec3, attribute } from 'three/tsl';
import type { VehicleState } from './state';

/** How readily each ground muddies the vehicle, dry and soaked. */
const MUDDY: Record<string, [number, number]> = {
  bog: [1, 1],
  dirt: [0.25, 0.9],
  grass: [0.05, 0.4],
  sand: [0.15, 0.3],
  gravel: [0.02, 0.15],
  snow: [0, 0.08],
};

const linear = (hex: number): THREE.Vector3 => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

export class Grime {
  /** 0 clean to 1 plastered. The tyres get dirty much faster than the body. */
  dirt = 0;
  tyres = 0;
  /** 1 fresh and wet, towards 0 dried. */
  fresh = 0;
  private readonly u = {
    body: uniform(0),
    tyres: uniform(0),
    fresh: uniform(0),
  };
  readonly body: THREE.MeshStandardNodeMaterial;
  readonly wheel: THREE.MeshStandardNodeMaterial;

  /** `height` is the top of the vehicle's body above the ground, metres. */
  constructor(height: number) {
    const u = this.u;
    const wetMud = vec3(linear(0x4a3420));
    const dryMud = vec3(linear(0x9c8867));
    const mud = mix(dryMud, wetMud, u.fresh);
    const p = positionLocal;
    // Blotches at two sizes, so the edge of the mud is ragged rather than a tide line.
    const blotch = mx_noise_float(p.mul(2.3)).mul(0.6).add(mx_noise_float(p.mul(7.1)).mul(0.25));

    // Body: mud climbs from the ground up as it builds, thickest low down.
    // It starts on the sills and wheel arches, not at the ground, and none shows on a clean vehicle.
    const reach = u.body.mul(height * 0.65).add(0.5);
    const body = smoothstep(-0.05, 0.08, reach.sub(p.y).add(blotch.mul(0.35))).mul(smoothstep(0, 0.08, u.body));
    this.body = new THREE.MeshStandardNodeMaterial({ metalness: 0.05 });
    const paint = attribute<'vec3'>('color', 'vec3');
    this.body.colorNode = mix(paint, mud, body.mul(0.92));
    this.body.roughnessNode = mix(float(0.82), float(0.45), body.mul(u.fresh));

    // Tyres and hubs: covered all round, in blotches until thoroughly plastered.
    const tyre = smoothstep(0.0, 0.15, u.tyres.mul(1.3).sub(0.3).add(blotch.mul(0.4)));
    this.wheel = new THREE.MeshStandardNodeMaterial({ metalness: 0.05 });
    this.wheel.colorNode = mix(paint, mud, tyre.mul(0.85));
    this.wheel.roughnessNode = mix(float(0.82), float(0.5), tyre.mul(u.fresh));
  }

  /** Call every frame with the time step; `wetness` of the ground and `rain` 0..1. */
  update(dt: number, sim: VehicleState, wetness: number, rain: number): void {
    if (dt <= 0) return;
    const speed = Math.abs(sim.speed);
    let gain = 0;
    let wash = rain * 0.0015;
    for (const wheel of sim.wheels) {
      if (!wheel.contact) continue;
      if (wheel.ground === 'water') {
        // Wading: the faster, the more it rinses off.
        wash += 0.03 * Math.min(1, 0.3 + speed / 4);
        continue;
      }
      const muddy = MUDDY[wheel.ground];
      if (!muddy) continue;
      const wet = wheel.ground === 'bog' ? 1 : wetness;
      const ground = muddy[0] + (muddy[1] - muddy[0]) * wet;
      const churn = Math.min(1, wheel.spin) + wheel.skid * 0.6 + Math.min(1, Math.abs(wheel.slide) / 4) * 0.5;
      // Ploughing along sunk in deep mud plasters it up the sides.
      const ploughing = Math.min(1, wheel.sink / 0.2) * Math.min(1, speed / 2);
      gain += ground * (0.004 * Math.min(1, speed / 8) + 0.03 * churn + 0.02 * ploughing);
    }
    gain /= Math.max(1, sim.wheels.length / 4);
    this.tyres = Math.min(1, Math.max(0, this.tyres + gain * 4 * dt - wash * 2 * dt));
    this.dirt = Math.min(1, Math.max(0, this.dirt + gain * dt * (1 - this.dirt * 0.5) - wash * dt));
    // Fresh mud stays wet in the rain and dries in a few minutes otherwise.
    if (gain > 0.002) this.fresh = Math.min(1, this.fresh + dt * 2);
    else this.fresh = Math.max(rain * 0.8, this.fresh - dt / 150);
    this.u.body.value = this.dirt;
    this.u.tyres.value = this.tyres;
    this.u.fresh.value = this.fresh;
  }
}
