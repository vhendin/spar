import { describe, expect, it } from 'vitest';
import { changes, reconcile } from './account';

class Store {
  constructor(readonly data: Record<string, string> = {}) {}
  getItem(key: string): string | null {
    return this.data[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.data[key] = value;
  }
}

const entry = (at: number) => ({ region: 'r', destination: 'Hut', vehicle: 'v', date: '1 Jan', season: 'winter', seconds: 1, metres: 1, at });

describe('account', () => {
  it('on the first login, sends what this browser has kept', () => {
    const store = new Store({ 'spar.name': 'Anna', 'spar.settings': '{}', 'spar.token': 'tab' });
    const { send, sent } = reconcile(store, {});
    expect(send).toEqual({ 'spar.name': 'Anna', 'spar.settings': '{}' });
    expect(changes(store, sent)).toEqual(send);
  });

  it('on another device, takes what the account keeps and merges the logbooks', () => {
    const store = new Store({ 'spar.name': 'Old name', 'spar.logbook': JSON.stringify([entry(2)]) });
    const kept = { 'spar.name': 'Anna', 'spar.color': '#aa3322', 'spar.logbook': JSON.stringify([entry(1)]) };
    const { send, sent } = reconcile(store, kept);
    expect(store.data['spar.name']).toBe('Anna');
    expect(store.data['spar.color']).toBe('#aa3322');
    expect(JSON.parse(store.data['spar.logbook']!)).toEqual([entry(1), entry(2)]);
    expect(Object.keys(send)).toEqual(['spar.logbook']);
    // Later changes in the browser are found; removing one says so.
    store.setItem('spar.name', 'Anna B');
    delete store.data['spar.color'];
    expect(changes(store, { ...sent, ...send })).toEqual({ 'spar.name': 'Anna B', 'spar.color': null });
  });
});
