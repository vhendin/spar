import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayOfYear, onDayOfYear } from './sky/clock';
import { seasonAt, snowDepthAt } from './season';
import type { SeasonCalendar } from './generated/seasons';
import { isSeasonCalendar } from './validate';

const calendar = JSON.parse(readFileSync(join(import.meta.dirname, '../../defs/seasons.json'), 'utf8')) as SeasonCalendar;
const main = (shares: Record<string, number>): string => Object.entries(shares).sort((a, b) => b[1] - a[1])[0]![0];

describe('season calendar', () => {
  it('matches the schema, with its days in order', () => {
    expect(isSeasonCalendar(calendar), JSON.stringify(isSeasonCalendar.errors)).toBe(true);
    const days = calendar.calendar.map((k) => k.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  it('has bare trees and withered ground in winter, green in summer and coloured leaves in autumn', () => {
    const winter = seasonAt(calendar, 30);
    expect(winter.leaves).toBe(0);
    expect(main(winter.foliage)).toBe('winter');
    expect(main(winter.ground)).toBe('dormant');
    const summer = seasonAt(calendar, 200);
    expect(summer.leaves).toBe(1);
    expect(main(summer.foliage)).toBe('summer');
    expect(main(summer.ground)).toBe('summer');
    const autumn = seasonAt(calendar, 258);
    expect(main(autumn.foliage)).toBe('autumn');
    expect(main(autumn.ground)).toBe('autumn');
    expect(main(seasonAt(calendar, 160).foliage)).toBe('spring');
  });

  it('blends evenly between entries, with shares adding up to one, across the new year too', () => {
    for (let day = 1; day <= 365; day += 0.5) {
      const s = seasonAt(calendar, day);
      const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
      expect(sum(s.foliage)).toBeCloseTo(1, 9);
      expect(sum(s.ground)).toBeCloseTo(1, 9);
      expect(s.leaves).toBeGreaterThanOrEqual(0);
      expect(s.leaves).toBeLessThanOrEqual(1);
    }
    const half = seasonAt(calendar, 159);
    expect(half.leaves).toBeCloseTo((0.35 + 1) / 2, 5);
    expect(seasonAt(calendar, 365.9).leaves).toBe(0);
  });
});

describe('snow', () => {
  it('lies from November to May, deepest in March, and deeper higher up', () => {
    expect(seasonAt(calendar, 75).snow).toBeGreaterThan(0.5);
    expect(seasonAt(calendar, 15).snow).toBeGreaterThan(0.3);
    expect(seasonAt(calendar, 200).snow).toBe(0);
    expect(seasonAt(calendar, 258).snow).toBe(0);
    const march = seasonAt(calendar, 75).snow;
    expect(snowDepthAt(calendar, march, 1200)).toBeGreaterThan(march * 1.5);
    expect(snowDepthAt(calendar, march, 500)).toBeLessThan(march);
    expect(snowDepthAt(calendar, 0, 1400)).toBe(0);
  });
});

describe('day of the year', () => {
  it('counts from 1 January on the region clocks, and jumps to another day at the same time', () => {
    expect(dayOfYear(Date.UTC(2026, 0, 1, 0, 0), 1)).toBeCloseTo(1 + 1 / 24, 9);
    expect(Math.floor(dayOfYear(Date.UTC(2026, 6, 15, 12), 1))).toBe(196);
    expect(onDayOfYear(Date.UTC(2026, 7, 15, 8), 1, 1)).toBe(Date.UTC(2026, 0, 1, 8));
    // Half past eleven UTC is already the next day on clocks an hour ahead.
    expect(onDayOfYear(Date.UTC(2026, 7, 15, 23, 30), 1, 32)).toBe(Date.UTC(2026, 0, 31, 23, 30)); // 00:30 on 1 February locally
  });
});
