import { describe, expect, it } from 'vitest';
import { dateOfYear, formatDuration, seasonName, Trips } from './trips';

const info = { region: 'valadalen', vehicle: 'Terrängbil 4×4', date: '14 Mar', season: 'winter' };
const hut = { name: 'Testhut', kind: 'hut', x: 100, z: 200 };

describe('trips', () => {
  it('time the driving from choosing a destination to arriving, and write it in the logbook', () => {
    const trips = new Trips();
    trips.begin(hut);
    for (let s = 0; s < 600; s++) trips.tick(1, 5, s * 1000);
    const entry = trips.arrive(info, 1234);
    expect(entry).toEqual({ ...info, destination: 'Testhut', kind: 'hut', seconds: 600, metres: 3000, at: 1234 });
    expect(trips.entries).toHaveLength(1);
    expect(trips.reached('valadalen')).toEqual(new Set(['Testhut']));
    expect(trips.reached('are').size).toBe(0);
    expect(trips.current()).toBeNull();
  });

  it('do not count when the vehicle jumped on the way', () => {
    const trips = new Trips();
    trips.begin(hut);
    trips.tick(30, 100, 0);
    trips.jumped();
    expect(trips.current()?.counts).toBe(false);
    expect(trips.arrive(info)).toBeNull();
    expect(trips.entries).toHaveLength(0);
    // A new destination starts a fresh trip that counts again.
    trips.begin(hut);
    expect(trips.current()).toEqual({ seconds: 0, metres: 0, counts: true });
  });

  it('remember the quickest arrival at each place', () => {
    const trips = new Trips();
    for (const seconds of [900, 400, 700]) {
      trips.begin(hut);
      trips.tick(seconds, 0, 0);
      trips.arrive(info);
    }
    expect(trips.best('valadalen', 'Testhut')?.seconds).toBe(400);
    expect(trips.best('valadalen', 'Elsewhere')).toBeNull();
  });

  it('keep a trip to the shared destination beside the own one', () => {
    const trips = new Trips();
    const peak = { name: 'Peak', kind: 'peak', x: 900, z: 900 };
    trips.begin(hut);
    trips.tick(100, 500, 0);
    trips.begin(peak, 'shared');
    trips.tick(50, 200, 0);
    expect(trips.going(peak, 'shared')).toBe(true);
    expect(trips.going(peak)).toBe(false);
    expect(trips.arrive(info, 1, 'shared')).toMatchObject({ destination: 'Peak', seconds: 50, metres: 200 });
    expect(trips.current('shared')).toBeNull();
    expect(trips.current()).toEqual({ seconds: 150, metres: 700, counts: true });
    // A jump spoils both.
    trips.begin(peak, 'shared');
    trips.jumped();
    expect(trips.current()?.counts).toBe(false);
    expect(trips.current('shared')?.counts).toBe(false);
  });

  it('note who else arrived within a minute, before or after', () => {
    const trips = new Trips();
    trips.begin(hut);
    // Bo was there first, half a minute before.
    expect(trips.arrive({ ...info, with: ['Bo'] }, 100_000)?.with).toEqual(['Bo']);
    // Cilla comes 40 s after; Dan two minutes after; Cilla again counts once; elsewhere does not count.
    expect(trips.together('valadalen', 'Testhut', 'Cilla', 140_000)).toBe(true);
    expect(trips.together('valadalen', 'Testhut', 'Cilla', 141_000)).toBe(false);
    expect(trips.together('valadalen', 'Other hut', 'Eva', 141_000)).toBe(false);
    expect(trips.together('valadalen', 'Testhut', 'Dan', 220_000)).toBe(false);
    expect(trips.entries[0]!.with).toEqual(['Bo', 'Cilla']);
    // Alone, the entry has no list.
    trips.begin(hut);
    expect(trips.arrive(info, 500_000)).not.toHaveProperty('with');
  });
});

describe('logbook wording', () => {
  it('gives durations, dates and seasons in words', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(38 * 60)).toBe('38 min');
    expect(formatDuration(65 * 60)).toBe('1 h 05 min');
    expect(dateOfYear(73)).toBe('14 Mar');
    expect(dateOfYear(1.7)).toBe('1 Jan');
    const state = (foliage: Partial<Record<'spring' | 'summer' | 'autumn' | 'winter', number>>, snow = 0) => ({
      foliage: { spring: 0, summer: 0, autumn: 0, winter: 0, ...foliage },
      leaves: 1,
      ground: { summer: 1, autumn: 0, dormant: 0 },
      snow,
      ice: 0,
    });
    expect(seasonName(state({ winter: 1 }, 0.5), 60)).toBe('winter');
    expect(seasonName(state({ summer: 0.7, autumn: 0.3 }), 240)).toBe('summer');
    expect(seasonName(state({ autumn: 1 }), 258)).toBe('autumn');
    expect(seasonName(state({ winter: 1 }), 290)).toBe('late autumn');
    expect(seasonName(state({ winter: 1 }), 140)).toBe('early spring');
  });
});
