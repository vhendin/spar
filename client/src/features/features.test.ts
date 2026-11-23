import { describe, expect, it } from 'vitest';
import type { Building, FenceLine, Lift, PowerLine } from '@spar/shared';
import { buildTile } from './build';
import { OBJECTS } from './defs';
import { footprintRect, rectWings } from './generators/building';
import { alongLine } from './generators/fence';
import { liftSupports } from './generators/lift';
import { assignToTiles, type FeatureVectors, type TileJob } from './layout';
import { FeatureMesh } from './mesh';

const flat = (): number => 500;
const hilly = (x: number, z: number): number => 500 + 3 * Math.sin(x / 7) + 2 * Math.cos(z / 5);

const house: Building = { id: 'w1', kind: 'yes', outline: [[100, 100], [110, 100], [110, 106], [100, 106]] };
const turned: Building = {
  id: 'w2',
  kind: 'house',
  // A 12 x 7 rectangle turned by 30 degrees.
  outline: [[0, 0], [12, 0], [12, 7], [0, 7]].map(([u, v]) => {
    const a = Math.PI / 6;
    return [200 + u! * Math.cos(a) - v! * Math.sin(a), 200 + u! * Math.sin(a) + v! * Math.cos(a)] as [number, number];
  }) as Building['outline'],
};
const lShape: Building = { id: 'w3', kind: 'yes', outline: [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]].map(([x, z]) => [x! + 50, z! + 300]) as Building['outline'] };
const line: PowerLine = { id: 'w9', kind: 'minor_line', points: [[-30, 40], [20, 40], [70, 45], [120, 60], [300, 60]] };
const fenceLine: FenceLine = { id: 'field7.0', kind: 'roundpole', points: [[10, 10], [500, 10], [500, 30]] };

const vectors: FeatureVectors = {
  buildings: [house, turned, lShape],
  powerLines: [line],
  fences: [fenceLine, { id: 'f2', kind: 'wire', points: [[30, 200], [60, 210]] }, { id: 'f3', kind: 'stone_wall', points: [[40, 220], [60, 225]] }],
  objects: [{ id: 'logs1', kind: 'log_pile', x: 150, z: 150, heading: 30 }],
};

describe('footprintRect', () => {
  it('recovers a turned rectangle, long side first', () => {
    const r = footprintRect(turned.outline);
    expect(r.hl).toBeCloseTo(6, 6);
    expect(r.hw).toBeCloseTo(3.5, 6);
    expect(Math.abs(Math.cos(r.angle - Math.PI / 6))).toBeCloseTo(1, 6);
  });
});

describe('rectWings', () => {
  it('splits an L-shaped footprint into two wings that together cover it', () => {
    const wings = rectWings(lShape.outline, footprintRect(lShape.outline))!;
    expect(wings).toHaveLength(2);
    // The L is a 20 x 8 bar and an 8 x 20 bar sharing an 8 x 8 corner.
    expect(wings.map((w) => [w.hl * 2, w.hw * 2].map((v) => Math.round(v))).sort()).toEqual([[20, 8], [20, 8]]);
  });

  it('refuses outlines with slanted sides', () => {
    const slanted = [[0, 0], [10, 0], [14, 6], [10, 12], [0, 12]];
    expect(rectWings(slanted, footprintRect(slanted))).toBeNull();
  });
});

describe('alongLine', () => {
  it('spaces points evenly across corners and ends on the last point', () => {
    const p = alongLine([[0, 0], [10, 0], [10, 10]], 2.5);
    expect(p.length).toBe(9);
    expect(p[4]).toMatchObject({ x: 10, z: 0 });
    expect(p[8]).toMatchObject({ x: 10, z: 10 });
  });
});

describe('assignToTiles', () => {
  const jobs = assignToTiles(vectors, 256, 1024);
  const all = [...jobs.values()];

  it('gives every building and object to exactly one tile', () => {
    expect(all.flatMap((j) => j.buildings).map((b) => b.id).sort()).toEqual(['w1', 'w2', 'w3']);
    expect(all.flatMap((j) => j.objects)).toHaveLength(1);
  });

  it('gives each pole inside the region to one tile and skips those outside', () => {
    const poles = all.flatMap((j) => j.power.flatMap((p) => p.poles)).sort();
    expect(poles).toEqual([1, 2, 3, 4]);
  });

  it('cuts fences at tile edges into pieces with stable names that together cover the line', () => {
    const pieces = all.flatMap((j) => j.fences).filter((f) => f.id.startsWith('field7.0#'));
    expect(pieces.length).toBeGreaterThan(1);
    const length = pieces.reduce((sum, f) => sum + f.points.slice(1).reduce((s, p, k) => s + Math.hypot(p[0]! - f.points[k]![0]!, p[1]! - f.points[k]![1]!), 0), 0);
    expect(length).toBeCloseTo(510, 6);
    const again = [...assignToTiles(vectors, 256, 1024).values()].flatMap((j) => j.fences).map((f) => f.id);
    expect(again).toEqual(all.flatMap((j) => j.fences).map((f) => f.id));
  });
});

describe('buildTile', () => {
  const job: TileJob = { buildings: [house, turned, lShape], power: [{ line, poles: [1, 2, 3] }], fences: [], objects: vectors.objects, lifts: [] };
  for (const f of vectors.fences) job.fences.push({ id: f.id, kind: f.kind, points: f.points });

  it('builds the same tile identically every time', () => {
    const a = buildTile(job, OBJECTS, 42, hilly);
    const b = buildTile(job, OBJECTS, 42, hilly);
    expect(a.parts.map((p) => p.kind)).toEqual(b.parts.map((p) => p.kind));
    for (let k = 0; k < a.parts.length; k++) {
      expect(a.parts[k]!.positions).toEqual(b.parts[k]!.positions);
      expect(a.parts[k]!.colors).toEqual(b.parts[k]!.colors);
    }
    expect(a.solids).toEqual(b.solids);
  });

  it('makes a mesh for every kind and colliders with unique names', () => {
    const t = buildTile(job, OBJECTS, 1, hilly);
    expect(t.parts.map((p) => p.kind).sort()).toEqual(['building', 'log_pile', 'power_pole', 'roundpole', 'stone_wall', 'wire']);
    for (const p of t.parts) {
      expect(p.indices.length % 3).toBe(0);
      expect(Math.max(...p.indices)).toBeLessThan(p.positions.length / 3);
      expect(p.positions.every(Number.isFinite)).toBe(true);
    }
    const keys = t.solids.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('bw1');
    expect(keys).toContain('pw9:2');
    expect(keys).toContain('ologs1');
    // Wires hang between poles; the wire fence has strands.
    expect(t.parts.find((p) => p.kind === 'power_pole')!.lines.length).toBeGreaterThan(0);
    expect(t.parts.find((p) => p.kind === 'wire')!.lines.length).toBeGreaterThan(0);
  });

  it('lets wooden fences break in stretches that between them hold every post, but not stone walls', () => {
    // As the game has them: cut into pieces at tile edges, each named <fence>#<piece>.
    const t = buildTile({ buildings: [], power: [], fences: job.fences.map((f) => ({ ...f, id: `${f.id}#0` })), objects: [], lifts: [] }, OBJECTS, 7, hilly);
    for (const kind of ['roundpole', 'wire']) {
      const part = t.parts.find((p) => p.kind === kind)!;
      const stretches = t.solids.filter((s) => s.breaks?.kind === kind).map((s) => s.breaks!);
      expect(stretches.length).toBeGreaterThan(0);
      // Back to back from the first vertex to the last, for the mesh and for the wires.
      for (const [range, total] of [['verts', part.positions.length / 3], ['lines', part.lines.length / 3]] as const) {
        expect(stretches[0]![range][0]).toBe(0);
        for (let k = 1; k < stretches.length; k++) expect(stretches[k]![range][0]).toBe(stretches[k - 1]![range][1]);
        expect(stretches[stretches.length - 1]![range][1]).toBe(total);
      }
      // The keys can be told from trees' when passed to the others.
      for (const s of t.solids.filter((s) => s.breaks?.kind === kind)) expect(s.key).toMatch(/^f[0-9A-Za-z_.-]+#[0-9]+:[0-9]+$/);
    }
    expect(t.solids.some((s) => s.key.startsWith('ff3') && s.breaks)).toBe(false);
  });

  it('stands buildings on the ground: walls start at or below the lowest corner', () => {
    const t = buildTile({ buildings: [house], power: [], fences: [], objects: [], lifts: [] }, OBJECTS, 3, hilly);
    const ys = t.parts[0]!.positions.filter((_, k) => k % 3 === 1);
    const corners = house.outline.map(([x, z]) => hilly(x, z));
    expect(Math.min(...ys)).toBeLessThanOrEqual(Math.min(...corners));
    const solid = t.solids[0]!;
    expect(solid.y - solid.hy).toBeLessThanOrEqual(Math.min(...corners));
  });

  it('turns the faces of a rectangular house outward', () => {
    const t = buildTile({ buildings: [house], power: [], fences: [], objects: [], lifts: [] }, OBJECTS, 5, flat);
    const { positions: p, normals: n } = t.parts[0]!;
    // Walls of the 10 x 6 house centred at (105, 103): their normals point away from the middle.
    let checked = 0;
    for (let v = 0; v < p.length / 3; v++) {
      const x = p[v * 3]!, z = p[v * 3 + 2]!;
      const nx = n[v * 3]!, nz = n[v * 3 + 2]!;
      if (Math.abs(n[v * 3 + 1]!) > 0.1) continue;
      const onWall = Math.abs(Math.abs(x - 105) - 5) < 0.01 || Math.abs(Math.abs(z - 103) - 3) < 0.01;
      if (!onWall) continue;
      expect((x - 105) * nx + (z - 103) * nz).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });
});

describe('FeatureMesh.box', () => {
  it('points every face away from the centre, turned or not', () => {
    for (const yaw of [0, 0.7, -2]) {
      const m = new FeatureMesh();
      m.box([3, 2, -1], 2, 1, 0.5, yaw, [1, 1, 1], true);
      const { positions: p, normals: n } = m.build();
      for (let v = 0; v < p.length / 3; v++) {
        const d = (p[v * 3]! - 3) * n[v * 3]! + (p[v * 3 + 1]! - 2) * n[v * 3 + 1]! + (p[v * 3 + 2]! + 1) * n[v * 3 + 2]!;
        expect(d).toBeGreaterThan(0);
      }
    }
  });
});

describe('lifts', () => {
  // A chair lift 1200 m up a slope with a bump in the middle, mapped by its two ends only.
  const chair: Lift = { id: 'a7', kind: 'chair_lift', name: 'Testliften', points: [[100, 500], [100, 1700]] };
  const slope = (x: number, z: number): number => 800 - (z - 500) * 0.3 + 25 * Math.exp(-(((z - 1100) / 60) ** 2)) + 0 * x;
  const def = OBJECTS.chair_lift!;

  it('stands towers no farther apart than the longest span, with the rope clear of the ground', () => {
    const s = liftSupports(chair, def, 3, slope);
    expect(s[0]!.station && s[s.length - 1]!.station).toBe(true);
    expect(s.slice(1, -1).every((p) => !p.station)).toBe(true);
    expect(s.length).toBeGreaterThan(5);
    const longest = (def.params.maxSpan as number) + 4;
    for (let k = 1; k < s.length; k++) {
      const a = s[k - 1]!, b = s[k]!;
      expect(b.s - a.s).toBeLessThanOrEqual(longest);
      for (let t = 0.05; t < 1; t += 0.05) {
        const z = a.z + (b.z - a.z) * t;
        if (z - 500 < 25 || 1700 - z < 25) continue;
        const rope = a.y + a.height + (b.y + b.height - a.y - a.height) * t;
        expect(rope - slope(100, z)).toBeGreaterThanOrEqual((def.params.clearance as number) - 0.5);
      }
    }
    // A tower close to the top of the bump.
    expect(s.some((p) => Math.abs(p.z - 1100) < 60)).toBe(true);
    expect(liftSupports(chair, def, 3, slope)).toEqual(s);
  });

  it('builds each tower and station in exactly one tile, with chairs and rope', () => {
    const jobs = [...assignToTiles({ buildings: [], powerLines: [], fences: [], objects: [], lifts: [chair] }, 256, 2048).values()];
    expect(jobs.length).toBe(6); // z 500 to 1700 crosses tiles 1 to 6
    const keys = jobs.flatMap((j) => buildTile(j, OBJECTS, 3, slope).solids.map((s) => s.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(liftSupports(chair, def, 3, slope).length);
    const t = buildTile(jobs[2]!, OBJECTS, 3, slope);
    const part = t.parts.find((p) => p.kind === 'chair_lift')!;
    expect(part.lines.length).toBeGreaterThan(0);
    expect(part.indices.length / 3).toBeGreaterThan(200);
    expect(part.positions.every(Number.isFinite)).toBe(true);
  });

  it('builds drag lifts, gondolas and walkways too', () => {
    for (const kind of ['t-bar', 'platter', 'rope_tow', 'gondola', 'cable_car', 'magic_carpet']) {
      const l: Lift = { id: `k${kind}`, kind, points: [[300, 300], [300, 420]] };
      const jobs = [...assignToTiles({ buildings: [], powerLines: [], fences: [], objects: [], lifts: [l] }, 256, 2048).values()];
      const parts = jobs.flatMap((j) => buildTile(j, OBJECTS, 1, slope).parts);
      expect(parts.length, kind).toBeGreaterThan(0);
      expect(parts.every((p) => p.positions.every(Number.isFinite)), kind).toBe(true);
    }
  });
});
