import { describe, expect, it } from 'vitest';
import { airTemperature, condensation } from './exhaust';

describe('air temperature', () => {
  it('is cold in a January night and mild on a July afternoon', () => {
    expect(airTemperature(15, -0.2)).toBeLessThan(-10);
    expect(airTemperature(196, 0.8)).toBeGreaterThan(14);
  });

  it('runs smoothly over the turn of the year', () => {
    expect(Math.abs(airTemperature(365, 0) - airTemperature(1, 0))).toBeLessThan(0.5);
  });
});

describe('condensation', () => {
  it('shows a white plume only in cold air', () => {
    expect(condensation(15)).toBe(0);
    expect(condensation(-10)).toBe(1);
    expect(condensation(0)).toBeCloseTo(0.5);
  });
});
