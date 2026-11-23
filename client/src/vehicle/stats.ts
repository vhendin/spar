// A vehicle's figures for the vehicle menu, worked out from its definition with the same
// arithmetic the simulation uses: nothing here is typed in by hand.

import { engineTorque, isElectric, peakPower, type VehicleDef } from '@spar/shared';
import { groundPressure, WADING } from './sim';

const GRAVITY = 9.81;
const AIR_DENSITY = 1.2;
const RPM_PER_RAD_S = 60 / (2 * Math.PI);

export interface VehicleStats {
  /** Kilograms. */
  mass: number;
  /** Watts at the peak of the curve. */
  power: number;
  /** Newton metres at the peak of the curve. */
  torque: number;
  /** Highest speed on level asphalt in still air, km/h: where drive force meets drag and rolling resistance, or the redline in top gear. */
  topSpeed: number;
  /** The steepest slope in degrees the drivetrain can pull up in its lowest gear and range, grip permitting (90 = more than it ever needs). */
  climb: number;
  /** Lowest and highest ground clearance, metres (the same unless it has air suspension). */
  clearance: [number, number];
  /** Water depth it can drive through, metres, at its highest ride. */
  wading: number;
  /** Pascals standing on level ground. */
  pressure: number;
  /** Winch pull in newtons and cable in metres, or null without a winch. */
  winch: { pull: number; cable: number } | null;
  /** Wheels and driven wheels, as in 4×4. */
  wheels: number;
  driven: number;
}

/** Drive force at the wheels at full throttle and `v` m/s in the best forward gear (high range). */
function driveForce(def: VehicleDef, v: number): number {
  const d = def.drivetrain;
  const r = def.wheels.radius;
  let best = 0;
  for (const gear of d.gears) {
    const ratio = gear * d.ranges.high * d.finalDrive;
    const rpm = (v / r) * RPM_PER_RAD_S * ratio;
    if (rpm >= d.redline) continue;
    best = Math.max(best, (engineTorque(d.torqueCurve, Math.max(rpm, d.idle)) * ratio * d.efficiency) / r);
  }
  return best;
}

export function vehicleStats(def: VehicleDef): VehicleStats {
  const d = def.drivetrain;
  const c = def.chassis;
  const weight = c.mass * GRAVITY;
  const torque = Math.max(...d.torqueCurve.map((p) => p[1]!));
  const roll = (def.tires.rollingResistance.asphalt ?? 0.015) * weight;
  const drag = (v: number): number => 0.5 * AIR_DENSITY * (c.dragArea ?? 0) * v * v;
  // Step up in tenths of a metre a second until resistance wins.
  let v = 0;
  while (v < 100 && driveForce(def, v + 0.1) > roll + drag(v + 0.1)) v += 0.1;
  // Lowest gear in the lowest range, at the peak of the curve.
  const lowest = d.gears[0]! * Math.max(d.ranges.high, d.ranges.low ?? 0) * d.finalDrive;
  const pull = (torque * lowest * d.efficiency) / def.wheels.radius;
  const share = pull / weight;
  const air = c.airSuspension;
  const heights = air ? air.levels.map((l) => l.clearance) : [c.groundClearance];
  const clearance: [number, number] = [Math.min(...heights), Math.max(...heights)];
  return {
    mass: c.mass,
    power: peakPower(d.torqueCurve),
    torque,
    topSpeed: v * 3.6,
    climb: share >= 1 ? 90 : (Math.asin(share) * 180) / Math.PI,
    clearance,
    wading: (c.wading ?? WADING) + clearance[1] - c.groundClearance,
    pressure: groundPressure(def),
    winch: def.winch ? { pull: def.winch.pull, cable: def.winch.cable } : null,
    wheels: def.axles.length * 2,
    driven: def.axles.filter((a) => a.driven).length * 2,
  };
}

/** The gearbox in words: "4 gears + low range (2.1:1)", or "single speed". */
export function gearsText(def: VehicleDef): string {
  const d = def.drivetrain;
  const box = isElectric(def) && d.gears.length === 1 ? 'Single speed' : `${d.gears.length} gears`;
  return d.ranges.low !== undefined ? `${box} + low range (${d.ranges.low}:1)` : box;
}

const AXLE_NAMES = [[], ['axle'], ['front', 'rear'], ['front', 'middle', 'rear'], ['front', 'second', 'third', 'rear']];

/** The differentials per driven axle: "front lockable, rear lockable"; the same ones grouped. */
export function locksText(def: VehicleDef): string {
  const names = AXLE_NAMES[def.axles.length] ?? def.axles.map((_, i) => `axle ${i + 1}`);
  const words: Record<string, string> = { open: 'open', lockable: 'lockable', locked: 'locked', braked: 'traction control' };
  const driven = def.axles.map((a, i) => ({ name: names[i]!, kind: a.driven ? words[a.differential ?? 'open']! : 'not driven' }));
  if (driven.every((a) => a.kind === driven[0]!.kind)) return `${driven[0]!.kind[0]!.toUpperCase()}${driven[0]!.kind.slice(1)}, every axle`;
  const text = driven.map((a) => `${a.name} ${a.kind}`).join(', ');
  return text[0]!.toUpperCase() + text.slice(1);
}

/** What else it has: crawl control, steering rear wheels, air suspension. */
export function extrasText(def: VehicleDef): string[] {
  const out: string[] = [];
  if (def.drivetrain.crawl?.length) out.push(`Crawl control (${def.drivetrain.crawl.join(', ')} km/h)`);
  const steered = def.axles.filter((a) => a.steer).length;
  if (def.axles.some((a) => (a.steer ?? 0) < 0)) out.push('Rear-wheel steering');
  else if (steered > 1) out.push(`${steered} steered axles`);
  if (def.chassis.airSuspension) out.push(`Air suspension (${def.chassis.airSuspension.levels.map((l) => l.name).join(', ')})`);
  if (isElectric(def)) out.push('Electric: no gear changes, regenerative braking');
  return out;
}
