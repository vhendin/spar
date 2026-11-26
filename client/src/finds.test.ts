import { beforeEach, describe, expect, it } from 'vitest';
import { FINDS_KEY, HIGHEST_KEY, type FindPoint, type Lake } from '@spar/shared';
import { atShore, Finds, findables } from './finds';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const info = () => ({ vehicle: 'Hilux', date: '14 Mar', season: 'winter' });
const finds: FindPoint[] = [
  { id: 'n1', kind: 'spring', name: 'Källan', x: 100, z: 100 },
  { id: 'n2', kind: 'ford', name: 'Ford at Ottsjö', x: 300, z: 100 },
  { id: 'n3', kind: 'pass', name: 'Passet', x: 500, z: 100 },
  { id: 'n4', kind: 'historic', what: 'boundary_stone', name: 'Rån', x: 700, z: 100 },
];
const square = (x0: number, z0: number, x1: number, z1: number): number[][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const lakes = [
  { id: 'w1', name: 'Långsjön', level: 500, outline: square(1000, 0, 1200, 200) },
  { id: 'w1.1', name: 'Långsjön', level: 500, outline: square(1300, 0, 1400, 200) },
  { id: 'w2', level: 500, outline: square(0, 1000, 100, 1100) },
] as Lake[];

describe('finds', () => {
  it('counts a named lake once, however many parts, and leaves unnamed lakes out', () => {
    const f = findables(finds, lakes);
    expect(f.points.filter((p) => p.kind === 'lake').map((p) => p.id)).toEqual(['lake:Långsjön']);
    expect(f.lakes[0]!.outlines).toHaveLength(2);
  });

  it('is at the shore near the edge or out on the water, not further off', () => {
    const o = [square(0, 0, 100, 100)];
    expect(atShore(o, 50, 50, 15)).toBe(true);
    expect(atShore(o, 110, 50, 15)).toBe(true);
    expect(atShore(o, 130, 50, 15)).toBe(false);
  });

  it('finds each by its own reach: a spring at 30 m, a ford only when driven through, a pass from further', () => {
    const f = new Finds('valadalen', finds, lakes);
    let now = 0;
    const at = (x: number, z: number) => f.update((now += 1000), x, z, null, info).map((n) => n.name);
    expect(at(125, 100)).toEqual(['Källan']);
    expect(at(125, 100)).toEqual([]);
    expect(at(320, 100)).toEqual([]);
    expect(at(305, 100)).toEqual(['Ford at Ottsjö']);
    expect(at(550, 100)).toEqual(['Passet']);
    expect(f.update((now += 1000), 700, 120, null, info)[0]!.what).toBe('boundary stone');
    expect(at(1350, 210)).toEqual(['Långsjön']);
    expect(f.found()).toEqual(new Set(['n1', 'n2', 'n3', 'n4', 'lake:Långsjön']));
  });

  it('keeps what was found, per region, for next time', () => {
    new Finds('valadalen', finds, lakes).update(1000, 100, 100, null, info);
    expect(JSON.parse(store.get(FINDS_KEY)!).valadalen.n1.vehicle).toBe('Hilux');
    const again = new Finds('valadalen', finds, lakes);
    expect(again.has('n1')).toBe(true);
    expect(new Finds('are', finds, lakes).has('n1')).toBe(false);
    const s = again.summary();
    expect(s.kinds.find((k) => k.kind === 'spring')).toMatchObject({ found: 1, total: 1 });
    expect(s.kinds.find((k) => k.kind === 'lake')).toMatchObject({ found: 0, total: 1 });
    expect(s.found.map((e) => e.name)).toEqual(['Källan']);
  });

  it('keeps the highest ground reached, saved now and then', () => {
    const f = new Finds('valadalen', [], []);
    f.update(20_000, 0, 0, 900.4, info);
    expect(JSON.parse(store.get(HIGHEST_KEY)!).valadalen.ele).toBe(900);
    f.update(21_000, 0, 0, 950, info);
    // Not saved again within ten seconds, but known.
    expect(JSON.parse(store.get(HIGHEST_KEY)!).valadalen.ele).toBe(900);
    expect(f.summary().highest!.ele).toBe(950);
    f.update(22_000, 0, 0, 920, info);
    f.save();
    expect(JSON.parse(store.get(HIGHEST_KEY)!).valadalen.ele).toBe(950);
  });
});
