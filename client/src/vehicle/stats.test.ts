import { describe, expect, it } from 'vitest';
import type { VehicleDef } from '@spar/shared';
import { extrasText, gearsText, locksText, vehicleStats } from './stats';
import tgb11 from '../../../defs/vehicles/tgb11.json';
import tgb13 from '../../../defs/vehicles/tgb13.json';
import elpickup from '../../../defs/vehicles/elpickup.json';

const tgb = tgb11 as unknown as VehicleDef;
const six = tgb13 as unknown as VehicleDef;
const pickup = elpickup as unknown as VehicleDef;

describe('vehicle stats', () => {
  it('works out the figures from the definition', () => {
    const s = vehicleStats(tgb);
    expect(s.mass).toBe(2400);
    expect(s.torque).toBe(206);
    expect(s.power / 1000).toBeCloseTo(86, 0);
    expect(s.wheels).toBe(4);
    expect(s.driven).toBe(4);
    // Geared and draggy: about a hundred on the flat.
    expect(s.topSpeed).toBeGreaterThan(90);
    expect(s.topSpeed).toBeLessThan(120);
    expect(s.climb).toBeGreaterThan(40);
    expect(s.winch).toEqual({ pull: 40000, cable: 40 });
  });

  it('gives a 6×6 lower ground pressure than the 4×4', () => {
    expect(vehicleStats(six).wheels).toBe(6);
    expect(vehicleStats(six).pressure).toBeLessThan(vehicleStats(tgb).pressure);
  });

  it('spans the air suspension heights, and wades deeper raised', () => {
    const s = vehicleStats(pickup);
    expect(s.clearance).toEqual([0.25, 0.44]);
    expect(s.wading).toBeCloseTo(0.79 + 0.14, 5);
  });

  it('describes gearbox, locks and extras in words', () => {
    expect(gearsText(tgb)).toBe('4 gears + low range (2.1:1)');
    expect(gearsText(pickup)).toBe('Single speed');
    expect(locksText(tgb)).toBe('Lockable, every axle');
    expect(locksText(pickup)).toBe('Front lockable, rear traction control');
    expect(extrasText(pickup).some((e) => e.startsWith('Air suspension'))).toBe(true);
    expect(extrasText(tgb)).toEqual([]);
  });
});
