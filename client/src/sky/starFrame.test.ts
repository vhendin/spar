import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { skyDirection, starPosition } from '@spar/shared';
import { starTurn } from './starFrame';

const LAT = 63.187, LON = 13.022;

describe('star frame', () => {
  it('keeps a star fixed in it as the sky turns', () => {
    const then = Date.UTC(2026, 0, 1), now = Date.UTC(2026, 11, 10, 22, 30);
    // Betelgeuse, Dubhe, Vega.
    for (const [ra, dec] of [[88.79, 7.41], [165.93, 61.75], [279.23, 38.78]] as const) {
      const fixed = new THREE.Vector3().fromArray(skyDirection(starPosition(then, LAT, LON, ra, dec))).applyMatrix3(starTurn(new THREE.Matrix3(), then, LAT, LON));
      const seen = fixed.applyMatrix3(starTurn(new THREE.Matrix3(), now, LAT, LON).transpose());
      const truth = new THREE.Vector3().fromArray(skyDirection(starPosition(now, LAT, LON, ra, dec)));
      expect(THREE.MathUtils.radToDeg(seen.angleTo(truth))).toBeLessThan(0.01);
    }
  });
});
