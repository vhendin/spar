import { describe, expect, it } from 'vitest';
import { mergeAccountValue } from './account';
import { TRAILS_KEY, addRun, mergeTrails, readTrails } from './trails';

const run = (at: number, seconds: number, vehicle = 'Hilux') => ({ at, seconds, vehicle, date: '14 Mar', season: 'winter' });

describe('trails driven', () => {
  it('adds runs: counted, first and last kept, the quickest remembered with its vehicle', () => {
    let d = addRun(undefined, run(100, 900));
    d = addRun(d, run(200, 700, 'Unimog'));
    d = addRun(d, run(300, 800));
    expect(d).toMatchObject({ first: 100, last: 300, runs: 3, best: 700, vehicle: 'Unimog' });
  });

  it('merges two stores: every trail, the earliest first, the larger count, the quicker best', () => {
    const a = JSON.stringify({ valadalen: { t1: addRun(addRun(undefined, run(100, 900)), run(150, 950)) } });
    const b = JSON.stringify({ valadalen: { t1: addRun(undefined, run(50, 600, 'Unimog')) }, are: { t2: addRun(undefined, run(400, 300)) } });
    const merged = readTrails(mergeTrails(a, b));
    expect(merged.valadalen!.t1).toMatchObject({ first: 50, last: 150, runs: 2, best: 600, vehicle: 'Unimog' });
    expect(merged.are!.t2!.best).toBe(300);
    expect(mergeAccountValue(TRAILS_KEY, a, b)).toBe(mergeTrails(a, b));
  });

  it('leaves out what is malformed', () => {
    expect(readTrails('not json')).toEqual({});
    expect(readTrails(JSON.stringify({ valadalen: { t1: { first: 1 } }, are: 3 }))).toEqual({});
  });
});
