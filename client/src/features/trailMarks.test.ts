import { describe, expect, it } from 'vitest';
import type { Lake, RoadLine, TrailLine } from '@spar/shared';
import { buildTile } from './build';
import { OBJECTS } from './defs';
import { trailMarks } from './trailMarks';

const trail = (kind: TrailLine['kind'], points: number[][]): TrailLine => ({ id: `${kind}:w1:0`, kind, name: kind, points: points as TrailLine['points'], length: 0 });
const north = [[100, 1000], [100, 0]];

describe('trail marks', () => {
  it('stands a mark of the trail’s kind every so often, to the right of the way; none along a power line', () => {
    const crosses = trailMarks([trail('snowmobile', north)], [], []);
    expect(crosses).toHaveLength(14);
    expect(crosses.every((o) => o.kind === 'trail_cross' && o.x === 102.5 && o.heading === 0)).toBe(true);
    expect(trailMarks([trail('hiking', north)], [], []).every((o) => o.kind === 'trail_cairn')).toBe(true);
    expect(trailMarks([trail('ascent', north)], [], []).every((o) => o.kind === 'trail_wand')).toBe(true);
    expect(trailMarks([trail('power', north)], [], [])).toEqual([]);
  });

  it('leaves out marks in a lake and on a drivable road, not on a footpath', () => {
    const lake: Lake = { id: 'w9', level: 400, outline: [[0, 0], [200, 0], [200, 300], [0, 300]] };
    const road = (drivable: boolean): RoadLine => ({ id: 'w8', kind: 'track', surface: 'gravel', width: 4, drivable, points: [[100, 600], [100, 800]] });
    const all = trailMarks([trail('snowmobile', north)], [], []).length;
    const dry = trailMarks([trail('snowmobile', north)], [road(true)], [lake]);
    expect(dry.some((o) => o.z < 300 || (o.z > 600 && o.z < 800))).toBe(false);
    expect(dry.length).toBeLessThan(all - 5);
    expect(trailMarks([trail('snowmobile', north)], [road(false)], []).length).toBe(all);
  });

  it('builds each mark; the cross and the cairn can be hit, the wand not', () => {
    const objects = [...trailMarks([trail('snowmobile', north)], [], []), ...trailMarks([trail('hiking', north)], [], []), ...trailMarks([trail('ascent', north)], [], [])];
    const tile = buildTile({ buildings: [], power: [], fences: [], objects, lifts: [] }, OBJECTS, 7, (x, z) => 400 + x * 0.05 + z * 0.02);
    expect(tile.parts.map((p) => p.kind).sort()).toEqual(['trail_cairn', 'trail_cross', 'trail_wand']);
    for (const p of tile.parts) for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
    expect(tile.solids.some((s) => s.key.includes('snowmobile'))).toBe(true);
    expect(tile.solids.some((s) => s.key.includes('hiking'))).toBe(true);
    expect(tile.solids.some((s) => s.key.includes('ascent'))).toBe(false);
  });
});
