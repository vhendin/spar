import { describe, expect, it } from 'vitest';
import { mergeAccountValue } from './account';
import { FINDS_KEY, HIGHEST_KEY, mergeFinds, mergeHighest, readFinds, readHighest } from './finds';

const found = (at: number, vehicle = 'Hilux') => ({ at, vehicle, date: '14 Mar', season: 'winter' });

describe('finds', () => {
  it('merges two stores: all found in either, each at its first finding', () => {
    const a = JSON.stringify({ valadalen: { n1: found(200), n2: found(300) } });
    const b = JSON.stringify({ valadalen: { n1: found(100, 'Unimog') }, are: { w5: found(400) } });
    const merged = readFinds(mergeFinds(a, b));
    expect(merged.valadalen!.n1).toEqual(found(100, 'Unimog'));
    expect(merged.valadalen!.n2!.at).toBe(300);
    expect(merged.are!.w5!.at).toBe(400);
  });

  it('leaves out what is malformed', () => {
    expect(readFinds('not json')).toEqual({});
    expect(readFinds(JSON.stringify({ valadalen: { n1: { vehicle: 'x' } }, are: 3 }))).toEqual({});
  });

  it('keeps the higher of two highest points', () => {
    const a = JSON.stringify({ valadalen: { ele: 1100, vehicle: 'Hilux', date: '1 Jan', at: 1 } });
    const b = JSON.stringify({ valadalen: { ele: 1250, vehicle: 'Unimog', date: '2 Jan', at: 2 }, are: { ele: 900, vehicle: 'Hilux', date: '3 Jan', at: 3 } });
    const merged = readHighest(mergeHighest(a, b));
    expect(merged.valadalen!.ele).toBe(1250);
    expect(merged.valadalen!.vehicle).toBe('Unimog');
    expect(merged.are!.ele).toBe(900);
    expect(readHighest(mergeHighest(b, a)).valadalen!.ele).toBe(1250);
  });

  it('is merged on the account, not replaced', () => {
    const a = JSON.stringify({ valadalen: { n1: found(1) } });
    const b = JSON.stringify({ valadalen: { n2: found(2) } });
    expect(Object.keys(readFinds(mergeAccountValue(FINDS_KEY, a, b)).valadalen!)).toEqual(['n1', 'n2']);
    expect(mergeAccountValue(HIGHEST_KEY, null, null)).toBe('{}');
  });
});
