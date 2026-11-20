import { describe, expect, it } from 'vitest';
import { bearing, offset } from './compass';

describe('compass', () => {
  it('measures bearings clockwise from north, with z running south', () => {
    expect(bearing(0, 0, 0, -10)).toBeCloseTo(0);
    expect(bearing(0, 0, 10, 0)).toBeCloseTo(90);
    expect(bearing(0, 0, 0, 10)).toBeCloseTo(180);
    expect(bearing(0, 0, -10, 0)).toBeCloseTo(270);
  });

  it('places a direction left or right of the heading the short way round', () => {
    expect(offset(10, 350)).toBeCloseTo(20);
    expect(offset(350, 10)).toBeCloseTo(-20);
    expect(offset(225, 225)).toBeCloseTo(0);
    expect(Math.abs(offset(180, 0))).toBeCloseTo(180);
  });
});
