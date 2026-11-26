import { describe, expect, it } from 'vitest';
import { mergeAccountValue } from './account';
import { mergeNights, NIGHTS_KEY, nextDawn, readNights } from './camp';
import { parseLocalTime } from './sky/clock';

const at = (text: string): number => parseLocalTime(text, 1)!;
const hours = (ms: number): number => ms / 3_600_000;

describe('nextDawn', () => {
  it('is the next sunrise, the same night or the next morning', () => {
    // Vålådalen in mid August: sunrise about 04:40.
    const night = nextDawn(at('2026-08-15T22:00'), 63.15, 13.0);
    expect(night.kind).toBe('dawn');
    expect(hours(night.utc - at('2026-08-16T00:00'))).toBeGreaterThan(4);
    expect(hours(night.utc - at('2026-08-16T00:00'))).toBeLessThan(5.5);
    // In the morning, after sunrise: through the day to the next one.
    const day = nextDawn(at('2026-08-16T09:00'), 63.15, 13.0);
    expect(hours(day.utc - night.utc)).toBeCloseTo(24, 0);
  });

  it('rests 8 hours under the midnight sun and in the polar night', () => {
    const june = nextDawn(at('2026-06-21T22:00'), 67.9, 18.5);
    expect(june).toEqual({ utc: at('2026-06-21T22:00') + 8 * 3_600_000, kind: 'never_set' });
    expect(nextDawn(at('2026-12-21T12:00'), 69.5, 18.5).kind).toBe('never_rose');
  });
});

describe('nights', () => {
  const night = (place: string, at: number) => ({ place, name: 'Stensdalen', kind: 'shelter', at, vehicle: 'Hilux', date: '14 Mar', season: 'winter', ended: 'dawn' });
  it('merges two stores: every night in either', () => {
    const a = JSON.stringify({ valadalen: { 'n1@1': night('n1', 1) } });
    const b = JSON.stringify({ valadalen: { 'n2@2': night('n2', 2) }, are: { 'n3@3': night('n3', 3) } });
    const merged = readNights(mergeNights(a, b));
    expect(Object.keys(merged.valadalen!)).toEqual(['n1@1', 'n2@2']);
    expect(merged.are!['n3@3']!.place).toBe('n3');
    expect(Object.keys(readNights(mergeAccountValue(NIGHTS_KEY, a, b)).valadalen!)).toHaveLength(2);
  });

  it('leaves out what is malformed', () => {
    expect(readNights('nope')).toEqual({});
    expect(readNights(JSON.stringify({ valadalen: { x: { place: 'n1' } } }))).toEqual({});
  });
});
