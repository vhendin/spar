// Engine, gearbox, transfer case and differentials: how much drive force each wheel gets.
// Plain arithmetic with no physics engine in it, so it runs the same in a browser, on a
// server and in tests.

import type { VehicleDef } from '../generated/vehicle';

export type Range = 'high' | 'low';

export interface DrivetrainState {
  /** -1 reverse, 1.. forward gears. */
  gear: number;
  range: Range;
  /** Engine speed, for the dashboard and for sound later. */
  rpm: number;
  /** Seconds until the gear change in progress is done; no drive meanwhile. */
  shifting: number;
  /** Seconds since the last gear change, to stop the gearbox hunting. */
  sinceShift: number;
}

export const newDrivetrainState = (): DrivetrainState => ({ gear: 1, range: 'high', rpm: 0, shifting: 0, sinceShift: 10 });

const SHIFT_TIME = 0.25;
const MIN_TIME_IN_GEAR = 0.9;
const RPM_PER_RAD_S = 60 / (2 * Math.PI);

/** The engine speed of the most torque on the curve. */
export function peakTorqueRpm(curve: number[][]): number {
  let best = curve[0]!;
  for (const point of curve) if (point[1]! > best[1]!) best = point;
  return best[0]!;
}

/** Full-throttle torque at an engine speed, interpolated along the curve. */
export function engineTorque(curve: number[][], rpm: number): number {
  const first = curve[0]!;
  if (rpm <= first[0]!) return first[1]!;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (rpm <= b[0]!) return a[1]! + ((b[1]! - a[1]!) * (rpm - a[0]!)) / (b[0]! - a[0]!);
  }
  return curve[curve.length - 1]![1]!;
}

/** Engine turns per wheel turn in the current gear and range. */
export function totalRatio(def: VehicleDef, state: DrivetrainState): number {
  const d = def.drivetrain;
  const gear = state.gear < 0 ? d.reverse : d.gears[Math.min(d.gears.length, Math.max(1, state.gear)) - 1]!;
  return gear * d.ranges[state.range] * d.finalDrive;
}

export interface DriveOutput {
  /** Force pushing the vehicle along its heading, summed over the driven wheels; negative in reverse. */
  driveForce: number;
  /** Force holding the vehicle back through the driven wheels with the throttle closed. */
  engineBrakeForce: number;
}

/**
 * Advances the gearbox and engine by dt seconds. `throttle` is 0..1, `wheelSpeed` the
 * driven wheels' speed over the ground in m/s (signed, forward positive).
 */
export function stepDrivetrain(def: VehicleDef, state: DrivetrainState, throttle: number, wheelSpeed: number, dt: number): DriveOutput {
  const d = def.drivetrain;
  const radius = def.wheels.radius;
  // Only motion in the gear's own direction turns the engine; rolling the other way (back
  // down a hill in first, say) just slips the clutch.
  const along = state.gear < 0 ? -wheelSpeed : wheelSpeed;
  const wheelRpm = (Math.max(0, along) / radius) * RPM_PER_RAD_S;
  state.sinceShift += dt;

  // Automatic gear change, forward gears only.
  if (state.gear > 0 && state.shifting <= 0 && state.sinceShift >= MIN_TIME_IN_GEAR) {
    const rpm = wheelRpm * totalRatio(def, state);
    let next = state.gear;
    if (rpm > d.shift.up && state.gear < d.gears.length) next++;
    else if (rpm < d.shift.down && state.gear > 1) next--;
    if (next !== state.gear) {
      state.gear = next;
      state.shifting = SHIFT_TIME;
      state.sinceShift = 0;
    }
  }

  const ratio = totalRatio(def, state);
  const coupled = wheelRpm * ratio;
  // Below idle the clutch slips: the engine holds its own speed, higher the more throttle,
  // up to where it pulls hardest at full throttle (as a driver pulling away on a hill would).
  const slipping = d.idle + throttle * (peakTorqueRpm(d.torqueCurve) - d.idle);
  state.rpm = Math.min(d.redline, Math.max(coupled, slipping));

  if (state.shifting > 0) {
    state.shifting -= dt;
    return { driveForce: 0, engineBrakeForce: 0 };
  }

  const direction = state.gear < 0 ? -1 : 1;
  // Over the redline the limiter cuts in.
  const torque = coupled >= d.redline ? 0 : engineTorque(d.torqueCurve, state.rpm) * throttle;
  const driveForce = (direction * torque * ratio * d.efficiency) / radius;

  let peak = 0;
  for (const point of d.torqueCurve) peak = Math.max(peak, point[1]!);
  const closed = Math.max(0, 1 - throttle * 4);
  const engineBrakeForce = (closed * d.engineBraking * peak * Math.min(1, coupled / d.redline) * ratio) / radius;
  return { driveForce, engineBrakeForce };
}

/** Changes direction: reverse, or first gear. */
export function selectDirection(state: DrivetrainState, reverse: boolean): void {
  const want = reverse ? -1 : 1;
  if ((state.gear < 0) === reverse) return;
  state.gear = want;
  state.shifting = SHIFT_TIME;
  state.sinceShift = 0;
}

export interface AxleDrive {
  /** Both wheels turn together: a locked or permanently locked differential. */
  locked: boolean;
  /** Traction control: an open differential whose spinning wheel is braked (see splitDrive). */
  braked?: boolean;
  /** Largest force each wheel can put down right now: grip times load. Left wheel first. */
  available: [number, number];
}

/**
 * Shares a drive force among the driven axles and their wheels. The axles are coupled
 * rigidly (no centre differential), so each gets an equal share. An open differential can
 * only push as hard on either side as its weakest wheel holds; a locked one sends the
 * force to whichever wheel has grip.
 *
 * Returns the force per wheel, in the order of `axles`, left wheel first, and for each
 * wheel how far the force asked of it exceeds what it can hold (0 = not spinning).
 */
export function splitDrive(force: number, axles: AxleDrive[]): { forces: number[]; spin: number[] } {
  const forces: number[] = [];
  const spin: number[] = [];
  const share = axles.length > 0 ? Math.abs(force) / axles.length : 0;
  const sign = force < 0 ? -1 : 1;
  for (const axle of axles) {
    const [left, right] = axle.available;
    let fl: number, fr: number;
    if (axle.locked) {
      const total = left + right;
      const put = Math.min(share, total);
      fl = total > 0 ? (put * left) / total : 0;
      fr = total > 0 ? (put * right) / total : 0;
      const over = total > 0 ? Math.max(0, share / total - 1) : share > 0 ? 1 : 0;
      spin.push(Math.min(1, over), Math.min(1, over));
    } else if (axle.braked) {
      // The differential still gives each wheel half the torque, but the brake holds the
      // spinning one so the other can push with its half. What the brake holds is lost.
      const half = share / 2;
      fl = Math.min(half, left);
      fr = Math.min(half, right);
      // The brake catches the spin quickly, so only a little shows.
      spin.push(left > 0 ? Math.min(1, Math.max(0, half / left - 1)) * 0.25 : half > 0 ? 1 : 0, right > 0 ? Math.min(1, Math.max(0, half / right - 1)) * 0.25 : half > 0 ? 1 : 0);
    } else {
      const weakest = Math.min(left, right);
      fl = fr = Math.min(share / 2, weakest);
      // The wheel with less grip is the one that spins; the other just stops pushing.
      const over = weakest > 0 ? Math.max(0, share / 2 / weakest - 1) : share > 0 ? 1 : 0;
      spin.push(left <= right ? Math.min(1, over) : 0, right < left ? Math.min(1, over) : 0);
    }
    forces.push(sign * fl, sign * fr);
  }
  return { forces, spin };
}
