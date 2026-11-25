import { describe, expect, it } from 'vitest';
import { knob, PEDAL_MIN, pedalValue, STICK_RADIUS, stickAxis } from './stick';

describe('thumb stick', () => {
  it('does nothing in the middle', () => {
    expect(stickAxis(0)).toBe(0);
    expect(stickAxis(STICK_RADIUS * 0.05)).toBe(0);
    expect(stickAxis(-STICK_RADIUS * 0.05)).toBe(0);
  });

  it('is full at the ring and beyond, either way', () => {
    expect(stickAxis(STICK_RADIUS)).toBeCloseTo(1);
    expect(stickAxis(-STICK_RADIUS * 2)).toBeCloseTo(-1);
  });

  it('is gentle half way out', () => {
    const half = stickAxis(STICK_RADIUS / 2);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.45);
    expect(stickAxis(-STICK_RADIUS / 2)).toBeCloseTo(-half);
  });

  it('keeps the knob inside the ring', () => {
    expect(knob(10, -20)).toEqual([10, -20]);
    const [x, y] = knob(STICK_RADIUS * 3, STICK_RADIUS * 4);
    expect(Math.hypot(x, y)).toBeCloseTo(STICK_RADIUS);
    expect(x / y).toBeCloseTo(3 / 4);
  });
});

describe('pedals', () => {
  it('press lightly at the foot and fully near the top', () => {
    expect(pedalValue(0, 160)).toBeCloseTo(PEDAL_MIN);
    expect(pedalValue(80, 160)).toBeGreaterThan(0.7);
    expect(pedalValue(130, 160)).toBe(1);
  });

  it('hold their range when the finger slides off', () => {
    expect(pedalValue(-40, 160)).toBeCloseTo(PEDAL_MIN);
    expect(pedalValue(400, 160)).toBe(1);
  });
});
