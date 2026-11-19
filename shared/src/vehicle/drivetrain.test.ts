import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VehicleDef } from '../generated/vehicle';
import { engineTorque, newDrivetrainState, selectDirection, splitDrive, stepDrivetrain, totalRatio } from './drivetrain';
import { tireOnGround } from './tires';

const def = JSON.parse(readFileSync(join(import.meta.dirname, '../../../defs/vehicles/tgb11.json'), 'utf8')) as VehicleDef;
const DT = 1 / 60;

describe('engineTorque', () => {
  it('follows the curve and holds its ends', () => {
    const curve = def.drivetrain.torqueCurve;
    expect(engineTorque(curve, 2500)).toBe(230);
    expect(engineTorque(curve, 2000)).toBe(221);
    expect(engineTorque(curve, 100)).toBe(167);
    expect(engineTorque(curve, 9000)).toBe(184);
  });
});

describe('stepDrivetrain', () => {
  it('pulls away with a slipping clutch and gives first-gear force', () => {
    const s = newDrivetrainState();
    const out = stepDrivetrain(def, s, 1, 0, DT);
    expect(s.gear).toBe(1);
    expect(s.rpm).toBe(2500);
    const expected = (engineTorque(def.drivetrain.torqueCurve, 2500) * 4.03 * 5.99 * 0.85) / 0.45;
    expect(out.driveForce).toBeCloseTo(expected, 3);
    expect(out.driveForce).toBeGreaterThan(8000); // enough to climb steeply: weight is about 23.5 kN
    expect(out.engineBrakeForce).toBe(0);
  });

  it('idles and gives no drive without throttle', () => {
    const s = newDrivetrainState();
    const out = stepDrivetrain(def, s, 0, 0, DT);
    expect(s.rpm).toBe(800);
    expect(out.driveForce).toBe(0);
  });

  it('shifts up through the gears as speed rises and back down as it falls', () => {
    const s = newDrivetrainState();
    const seen = new Set<number>();
    for (let v = 0; v <= 28; v += 0.02) { stepDrivetrain(def, s, 1, v, DT); seen.add(s.gear); }
    expect([...seen]).toEqual([1, 2, 3, 4]);
    expect(s.rpm).toBeGreaterThan(1500);
    expect(s.rpm).toBeLessThan(def.drivetrain.redline);
    for (let v = 28; v >= 0; v -= 0.02) stepDrivetrain(def, s, 0, v, DT);
    expect(s.gear).toBe(1);
  });

  it('interrupts drive briefly while changing gear', () => {
    const s = newDrivetrainState();
    const speed = (3800 / totalRatio(def, s) / (60 / (2 * Math.PI))) * 0.45; // just past the shift point in first
    expect(stepDrivetrain(def, s, 1, speed, DT).driveForce).toBe(0);
    expect(s.gear).toBe(2);
    for (let k = 0; k < 20; k++) stepDrivetrain(def, s, 1, speed, DT);
    expect(stepDrivetrain(def, s, 1, speed, DT).driveForce).toBeGreaterThan(0);
  });

  it('tops out at a believable speed in top gear', () => {
    const s = newDrivetrainState();
    s.gear = 4;
    const top = (def.drivetrain.redline / (1.0 * 5.99) / (60 / (2 * Math.PI))) * 0.45;
    expect(top * 3.6).toBeGreaterThan(100);
    expect(top * 3.6).toBeLessThan(140);
    expect(stepDrivetrain(def, s, 1, top + 1, DT).driveForce).toBe(0); // limiter
  });

  it('slips the clutch instead of changing up when rolling backwards in a forward gear', () => {
    const s = newDrivetrainState();
    for (let k = 0; k < 120; k++) stepDrivetrain(def, s, 1, -6, DT);
    expect(s.gear).toBe(1);
    expect(s.rpm).toBe(2500);
    expect(stepDrivetrain(def, s, 1, -6, DT).driveForce).toBeGreaterThan(8000);
  });

  it('multiplies force in low range', () => {
    const high = newDrivetrainState();
    const low = newDrivetrainState();
    low.range = 'low';
    const a = stepDrivetrain(def, high, 1, 1, DT).driveForce;
    const b = stepDrivetrain(def, low, 1, 1, DT).driveForce;
    expect(b / a).toBeGreaterThan(1.9);
  });

  it('pushes backwards in reverse and brakes on a closed throttle', () => {
    const s = newDrivetrainState();
    selectDirection(s, true);
    expect(s.gear).toBe(-1);
    for (let k = 0; k < 20; k++) stepDrivetrain(def, s, 1, 0, DT);
    expect(stepDrivetrain(def, s, 1, -1, DT).driveForce).toBeLessThan(-5000);

    const coasting = newDrivetrainState();
    coasting.gear = 2;
    const out = stepDrivetrain(def, coasting, 0, 10, DT);
    expect(out.driveForce).toBe(0);
    expect(out.engineBrakeForce).toBeGreaterThan(300);
    expect(out.engineBrakeForce).toBeLessThan(3000);
  });
});

describe('splitDrive', () => {
  it('shares evenly on good ground', () => {
    const { forces, spin } = splitDrive(8000, [
      { locked: false, available: [5000, 5000] },
      { locked: false, available: [5000, 5000] },
    ]);
    expect(forces).toEqual([2000, 2000, 2000, 2000]);
    expect(spin).toEqual([0, 0, 0, 0]);
  });

  it('loses an open axle to its spinning wheel', () => {
    const { forces, spin } = splitDrive(8000, [
      { locked: false, available: [500, 5000] },
      { locked: false, available: [5000, 5000] },
    ]);
    expect(forces).toEqual([500, 500, 2000, 2000]);
    expect(spin[0]).toBe(1);
    expect(spin[1]).toBe(0);
  });

  it('keeps pulling with the differential locked', () => {
    const { forces, spin } = splitDrive(8000, [
      { locked: true, available: [500, 5000] },
      { locked: true, available: [5000, 5000] },
    ]);
    expect(forces[0]).toBeCloseTo(4000 * (500 / 5500), 6);
    expect(forces[0]! + forces[1]!).toBeCloseTo(4000, 6);
    expect(spin).toEqual([0, 0, 0, 0]);
    // A wheel in the air takes nothing; the one on the ground takes it all.
    expect(splitDrive(6000, [{ locked: true, available: [0, 5000] }]).forces).toEqual([0, 5000]);
    expect(splitDrive(6000, [{ locked: false, available: [0, 5000] }]).forces).toEqual([0, 0]);
  });

  it('handles any number of axles, and reverse', () => {
    const three = splitDrive(-9000, Array.from({ length: 3 }, () => ({ locked: false, available: [9000, 9000] as [number, number] })));
    expect(three.forces).toEqual([-1500, -1500, -1500, -1500, -1500, -1500]);
  });
});

describe('tireOnGround', () => {
  it('grips less off road and in the wet', () => {
    expect(tireOnGround(def, 'asphalt').grip).toBeGreaterThan(tireOnGround(def, 'gravel').grip);
    expect(tireOnGround(def, 'gravel').grip).toBeGreaterThan(tireOnGround(def, 'bog').grip);
    expect(tireOnGround(def, 'asphalt', 1).grip).toBeCloseTo(0.95 * 0.8, 6);
    expect(tireOnGround(def, 'asphalt', 0.5).grip).toBeCloseTo(0.95 * 0.9, 6);
    expect(tireOnGround(def, 'bog').rollingResistance).toBeGreaterThan(tireOnGround(def, 'asphalt').rollingResistance * 5);
    expect(tireOnGround(def, 'moon dust')).toEqual({ grip: 0.6, rollingResistance: 0.05 });
  });
});
