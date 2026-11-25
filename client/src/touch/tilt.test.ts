import { describe, expect, it } from 'vitest';
import { TILT_FULL, tiltAngle, tiltSteer } from './tilt';

const DEG = Math.PI / 180;

/**
 * The sensor's gravity, in the device's axes, for a screen turned `screenAngle` and then the
 * phone turned clockwise `turn` degrees, held upright; `sign` −1 for the browsers that give it
 * the other way round. `back` tips it back, degrees.
 */
function gravity(screenAngle: number, turn: number, sign = 1, back = 0): [number, number] {
  const g = 9.81 * Math.cos(back * DEG) * sign;
  // Up in the screen's own axes, after turning clockwise.
  const sx = -Math.sin(turn * DEG) * g, sy = Math.cos(turn * DEG) * g;
  const a = -screenAngle * DEG;
  return [sx * Math.cos(a) - sy * Math.sin(a), sx * Math.sin(a) + sy * Math.cos(a)];
}

describe('tilt steering', () => {
  for (const screen of [0, 90, 180, 270]) {
    for (const sign of [1, -1]) {
      it(`reads the turn with the screen at ${screen}° (gravity ${sign > 0 ? 'up' : 'down'})`, () => {
        for (const turn of [-40, -15, 0, 10, 30]) {
          const [x, y] = gravity(screen, turn, sign);
          expect(tiltAngle(x, y, screen)! / DEG).toBeCloseTo(-turn, 6);
        }
      });
    }
  }

  it('is the same turned sideways either way round', () => {
    const [x1, y1] = gravity(90, 20);
    const [x2, y2] = gravity(270, 20);
    expect(tiltAngle(x1, y1, 90)).toBeCloseTo(tiltAngle(x2, y2, 270)!, 6);
  });

  it('does not mind the phone tipped back', () => {
    const [x, y] = gravity(90, 12, 1, 60);
    expect(tiltAngle(x, y, 90)! / DEG).toBeCloseTo(-12, 6);
  });

  it('cannot tell lying flat', () => {
    const [x, y] = gravity(90, 12, 1, 85);
    expect(tiltAngle(x, y, 90)).toBeNull();
  });

  it('turned clockwise steers right (negative), full at the full angle', () => {
    expect(tiltSteer(-TILT_FULL * DEG)).toBeCloseTo(-1, 9);
    expect(tiltSteer(-50 * DEG)).toBe(-1);
    expect(tiltSteer(TILT_FULL * DEG)).toBeCloseTo(1, 9);
    expect(tiltSteer(1 * DEG)).toBe(0);
    const half = tiltSteer(16 * DEG);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });
});
