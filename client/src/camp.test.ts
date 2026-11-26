import { beforeEach, describe, expect, it } from 'vitest';
import { NIGHTS_KEY, type DestinationPoint } from '@spar/shared';
import { Camp } from './camp';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const places: DestinationPoint[] = [
  { id: 'n1', kind: 'shelter', name: 'Stensdalen', x: 100, z: 100 },
  { id: 'n2', kind: 'hut', name: 'Lunndörren', x: 400, z: 100 },
  { id: 'n3', kind: 'peak', name: 'Ottfjället', x: 700, z: 100 },
];
const name = (id: string): string => ({ p2: 'Anna', p3: 'Bo' })[id] ?? id;
const night = { place: 'n1', name: 'Stensdalen', kind: 'shelter', vehicle: 'Hilux', date: '14 Mar', season: 'winter', ended: 'dawn' as const };

describe('Camp', () => {
  it('offers a night when stopped by a shelter, camp site, hut or lodge, not a summit, and not while moving', () => {
    const camp = new Camp('valadalen', places);
    expect(camp.places.map((p) => p.id)).toEqual(['n1', 'n2']);
    expect(camp.offer('p1', 110, 110, 0, name)).toMatchObject({ kind: 'offer', place: { id: 'n1' }, others: [] });
    expect(camp.offer('p1', 110, 110, 5, name).kind).toBe('none');
    expect(camp.offer('p1', 160, 100, 0, name).kind).toBe('none');
    expect(camp.offer('p1', 700, 100, 0, name).kind).toBe('none');
  });

  it('shows who is camping there already, then who we wait for, then the night', () => {
    const camp = new Camp('valadalen', places);
    const place = camp.places[0]!;
    camp.heard({ type: 'camp', region: 'valadalen', place, state: 'waiting', ready: ['p2'], waiting: ['p1', 'p3'] });
    expect(camp.offer('p1', 105, 100, 0, name)).toMatchObject({ kind: 'offer', others: ['Anna'] });
    camp.asked(place);
    expect(camp.offer('p1', 105, 100, 0, name)).toMatchObject({ kind: 'waiting', for: ['Bo'] });
    camp.heard({ type: 'camp', region: 'valadalen', place, state: 'night', ready: ['p1', 'p2', 'p3'], waiting: [], until: 5, ended: 'dawn' });
    expect(camp.offer('p1', 105, 100, 0, name)).toMatchObject({ kind: 'night', with: ['Anna', 'Bo'] });
  });

  it('gives up when driven off, and offers the place again only after driving away from it', () => {
    const camp = new Camp('valadalen', places);
    const place = camp.places[0]!;
    camp.asked(place);
    expect(camp.drivenOff(120, 100)).toBe(false);
    expect(camp.drivenOff(160, 100)).toBe(true);
    camp.rested(place);
    expect(camp.offer('p1', 105, 100, 0, name).kind).toBe('none');
    expect(camp.offer('p1', 200, 100, 3, name).kind).toBe('none');
    expect(camp.offer('p1', 105, 100, 0, name).kind).toBe('offer');
  });

  it('keeps each night, with the account key, and sums them up', () => {
    const camp = new Camp('valadalen', places);
    camp.record(night, 1000);
    camp.record({ ...night, ended: 'never_set', with: ['Anna'] }, 2000);
    camp.record({ ...night, place: 'n2', name: 'Lunndörren', kind: 'hut' }, 3000);
    expect(JSON.parse(store.get(NIGHTS_KEY)!).valadalen['n1@1000'].name).toBe('Stensdalen');
    const again = new Camp('valadalen', places);
    expect(again.campedAt()).toEqual(new Set(['n1', 'n2']));
    const s = again.summary();
    expect(s.nights).toBe(3);
    expect(s.places).toBe(2);
    expect(s.list.map((n) => n.kind)).toEqual(['shelter', 'shelter', 'hut']);
    expect(s.list[1]).toMatchObject({ ended: 'never_set', with: ['Anna'] });
    expect(new Camp('are', places).summary().nights).toBe(0);
  });
});
