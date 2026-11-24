import { describe, expect, it } from 'vitest';
import { footprints, onFootprint } from './footprints';

describe('footprints', () => {
  // An L-shaped house: 20 x 10 m with a 10 x 10 m wing to the north.
  const f = footprints([[[100, 100], [120, 100], [120, 110], [110, 110], [110, 120], [100, 120]]]);

  it('keeps plants out of a building and off its walls, but not out of the corner it bends round', () => {
    expect(onFootprint(f, 105, 115)).toBe(true);
    expect(onFootprint(f, 115, 105)).toBe(true);
    expect(onFootprint(f, 121, 105)).toBe(true);
    expect(onFootprint(f, 115, 115)).toBe(false);
    expect(onFootprint(f, 125, 105)).toBe(false);
    expect(onFootprint(f, 500, 500)).toBe(false);
  });
});
