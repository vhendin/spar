import { describe, expect, it } from 'vitest';
import type { Building, DestinationPoint, FindPoint, RoadLine } from '@spar/shared';
import { buildTile } from './build';
import { OBJECTS } from './defs';
import { poiFeatures } from './poi';

const place = (id: string, kind: DestinationPoint['kind'], x: number, z: number): DestinationPoint => ({ id, kind, name: id, x, z });
const find = (id: string, kind: FindPoint['kind'], x: number, z: number, what?: string): FindPoint => ({ id, kind, name: id, x, z, ...(what ? { what } : {}) });
const road: RoadLine = { id: 'w1', kind: 'track', surface: 'gravel', width: 3, drivable: true, points: [[0, 100], [400, 100]] } as RoadLine;
const hilly = (x: number, z: number): number => 500 + 0.2 * x + 2 * Math.cos(z / 9);

describe('poiFeatures', () => {
  it('puts a model at each kind of place, a building at huts and lodges, and nothing at lift tops', () => {
    const places = [place('n1', 'shelter', 50, 80), place('n2', 'peak', 300, 300), place('n3', 'viewpoint', 200, 50), place('n4', 'camp', 120, 160), place('n5', 'sight', 10, 10), place('n6', 'hut', 250, 120), place('n7', 'lodge', 350, 200), place('l1', 'lift', 30, 300)];
    const f = poiFeatures(places, [], [road], 1);
    expect(f.objects.map((o) => o.kind)).toEqual(['shelter', 'cairn', 'viewpoint', 'camp_site', 'info_board']);
    expect(f.buildings.map((b) => b.kind)).toEqual(['cabin', 'house']);
    expect(f.clear).toHaveLength(5);
    for (const o of f.objects) expect(OBJECTS[o.kind]?.generator).toBe('poi');
  });

  it('leaves out a place mapped as a building already', () => {
    const hut: Building = { id: 'w9', kind: 'hut', outline: [[45, 75], [55, 75], [55, 85], [45, 85]] };
    expect(poiFeatures([place('n1', 'shelter', 50, 80), place('n2', 'shelter', 50, 95)], [hut], [], 1).objects.map((o) => o.id)).toEqual(['poin2']);
  });

  it('faces the nearest road, or leaves it to the slope when none is near', () => {
    const [near, far] = poiFeatures([place('n1', 'shelter', 50, 80), place('n2', 'shelter', 50, 600)], [], [road], 1).objects;
    // The road runs east–west at z = 100, south of (50, 80): facing south is 180 degrees.
    expect(near!.heading).toBeCloseTo(180, 5);
    expect(far!.heading).toBe(-1);
  });
});

describe('camping', () => {
  it('names what lights up at each place to camp: its own model, or the building mapped there', () => {
    const mapped: Building = { id: 'w9', kind: 'hut', outline: [[345, 195], [355, 195], [355, 205], [345, 205]] };
    const f = poiFeatures([place('n1', 'shelter', 50, 80), place('n4', 'camp', 120, 160), place('n6', 'hut', 250, 120), place('n7', 'lodge', 350, 200), place('n2', 'peak', 300, 300)], [mapped], [road], 1);
    expect(f.camps).toEqual({ n1: 'poin1', n4: 'poin4', n6: 'poin6', n7: 'w9' });
    expect(f.glow.sort()).toEqual(['poin6', 'w9']);
  });

  it('marks the fire rings, and the windows and chimney of a hut to glow', () => {
    const f = poiFeatures([place('n1', 'shelter', 50, 80), place('n4', 'camp', 120, 160), place('n6', 'hut', 250, 120)], [], [road], 1);
    const tile = buildTile({ buildings: f.buildings, power: [], fences: [], objects: f.objects, lifts: [] }, OBJECTS, 7, hilly, new Set(f.glow));
    const fires = tile.spots.filter((s) => s.kind === 'fire');
    expect(fires.map((s) => s.key).sort()).toEqual(['poin1', 'poin4']);
    // The shelter's fire is in front of it, a few metres off.
    const shelterFire = fires.find((s) => s.key === 'poin1')!;
    expect(Math.hypot(shelterFire.x - 50, shelterFire.z - 80)).toBeGreaterThan(2);
    expect(shelterFire.y).toBeCloseTo(hilly(shelterFire.x, shelterFire.z), 0);
    const hut = tile.spots.filter((s) => s.key === 'poin6');
    expect(hut.filter((s) => s.kind === 'chimney')).toHaveLength(1);
    expect(hut.filter((s) => s.kind === 'window').length).toBeGreaterThanOrEqual(2);
    for (const w of hut.filter((s) => s.kind === 'window')) expect(Math.hypot(w.nx!, w.nz!)).toBeCloseTo(1, 5);
    // Without being marked, the same hut has none.
    expect(buildTile({ buildings: f.buildings, power: [], fences: [], objects: [], lifts: [] }, OBJECTS, 7, hilly).spots).toEqual([]);
  });
});

describe('poi generator', () => {
  it('builds every kind with something to hit', () => {
    const f = poiFeatures([place('n1', 'shelter', 50, 80), place('n2', 'peak', 300, 300), place('n3', 'viewpoint', 200, 50), place('n4', 'camp', 120, 160), place('n5', 'sight', 10, 10)], [], [road], 1);
    const tile = buildTile({ buildings: [], power: [], fences: [], objects: f.objects, lifts: [] }, OBJECTS, 7, hilly);
    expect(tile.parts.map((p) => p.kind).sort()).toEqual(['cairn', 'camp_site', 'info_board', 'shelter', 'viewpoint']);
    for (const p of tile.parts) {
      expect(p.indices.length).toBeGreaterThan(0);
      for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
    }
    // The shelter's body, the cairn, the bench, two tables and the tent, and the board.
    expect(tile.solids.length).toBe(7);
  });

  it('stands the shelter on the ground: its floor above the highest corner', () => {
    const [o] = poiFeatures([place('n1', 'shelter', 50, 80)], [], [road], 1).objects;
    const tile = buildTile({ buildings: [], power: [], fences: [], objects: [o!], lifts: [] }, OBJECTS, 7, hilly);
    const s = tile.solids[0]!;
    expect(s.y - s.hy).toBeLessThan(hilly(50, 80));
    expect(s.hy * 2).toBeGreaterThan(2);
  });
});

describe('finds', () => {
  const finds = [
    find('n1', 'spring', 50, 50),
    find('n2', 'pass', 100, 50),
    find('n3', 'historic', 150, 50, 'boundary_stone'),
    find('n4', 'historic', 200, 50, 'memorial'),
    find('n5', 'historic', 250, 50, 'aircraft_wreck'),
    find('n6', 'historic', 300, 50, 'mine'),
    find('n7', 'historic', 350, 50, 'ruins'),
    find('n8', 'historic', 400, 50, 'tomb'),
    find('n9', 'historic', 450, 50, 'cairn'),
    find('n10', 'waterfall', 500, 50),
    find('n11', 'ford', 550, 50),
    find('n12', 'farm', 300, 300),
  ];

  it('puts a model at each, barns at a summer farm, and nothing at water', () => {
    const f = poiFeatures([], [], [road], 1, finds);
    expect(f.objects.map((o) => o.kind)).toEqual(['spring', 'pass_cairn', 'boundary_stone', 'memorial', 'wreck', 'mine', 'ruins', 'grave', 'cairn']);
    expect(f.buildings.length).toBeGreaterThanOrEqual(2);
    expect(f.buildings.every((b) => b.kind === 'log_barn' && b.id.startsWith('findn12.'))).toBe(true);
    for (const o of f.objects) expect(OBJECTS[o.kind]?.generator).toBe('poi');
  });

  it('builds no barns at a summer farm with mapped buildings', () => {
    const barn: Building = { id: 'w9', kind: 'barn', outline: [[320, 300], [326, 300], [326, 306], [320, 306]] };
    expect(poiFeatures([], [barn], [], 1, [find('n12', 'farm', 300, 300)]).buildings).toEqual([]);
  });

  it('builds every model with something to hit', () => {
    const f = poiFeatures([], [], [road], 1, finds);
    const tile = buildTile({ buildings: [], power: [], fences: [], objects: f.objects, lifts: [] }, OBJECTS, 7, hilly);
    expect(new Set(tile.parts.map((p) => p.kind))).toEqual(new Set(f.objects.map((o) => o.kind)));
    for (const p of tile.parts) {
      expect(p.indices.length).toBeGreaterThan(0);
      for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
    }
    // Every model can be hit: at least one solid each.
    for (const o of f.objects) expect(tile.solids.some((s) => s.key.startsWith(`o${o.id}`))).toBe(true);
  });
});
