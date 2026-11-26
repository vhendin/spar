import { describe, expect, it } from 'vitest';
import { isServerMessage } from '@spar/shared/validate';
import { Camps, type Where } from './camps';
import { loadConfig } from './config';
import { WorldState } from './world';

const place = { id: 'n1', name: 'Stensdalen', kind: 'shelter', x: 100, z: 100 };
const ready = { type: 'camp' as const, region: 'valadalen', action: 'ready' as const, place, until: 5_000_000, ended: 'dawn' as const };

function setup(positions: Record<string, Where>) {
  const where = new Map(Object.entries(positions));
  return { where, camps: new Camps((id) => where.get(id), () => [...where.keys()]) };
}

describe('Camps', () => {
  it('starts the night at once for one player alone', () => {
    const { camps } = setup({ p1: { region: 'valadalen', x: 105, z: 100 } });
    const change = camps.message('p1', ready)!;
    expect(change.start).toBe(true);
    expect(change.state.state).toBe('night');
    expect(isServerMessage(change.state)).toBe(true);
  });

  it('waits for everyone near the fire, not those far off', () => {
    const { camps } = setup({
      p1: { region: 'valadalen', x: 105, z: 100 },
      p2: { region: 'valadalen', x: 120, z: 110 },
      p3: { region: 'valadalen', x: 900, z: 900 },
      p4: { region: 'are', x: 100, z: 100 },
    });
    const first = camps.message('p1', ready)!;
    expect(first.start).toBeUndefined();
    expect(first.state).toMatchObject({ state: 'waiting', ready: ['p1'], waiting: ['p2'] });
    const second = camps.message('p2', ready)!;
    expect(second.start).toBe(true);
    expect(second.state.ready.sort()).toEqual(['p1', 'p2']);
  });

  it('gives up when the one waiting drives off', () => {
    const { camps, where } = setup({ p1: { region: 'valadalen', x: 105, z: 100 }, p2: { region: 'valadalen', x: 110, z: 100 } });
    expect(camps.message('p1', ready)!.state.state).toBe('waiting');
    where.set('p1', { region: 'valadalen', x: 500, z: 100 });
    expect(camps.check()!.state.state).toBe('over');
    expect(camps.current).toBeNull();
    // Back, and asking again: the other near is told again.
    where.set('p1', { region: 'valadalen', x: 105, z: 100 });
    expect(camps.message('p1', ready)!.state).toMatchObject({ state: 'waiting', waiting: ['p2'] });
  });

  it('ends in the morning, early when one who camped wakes', () => {
    const { camps } = setup({ p1: { region: 'valadalen', x: 105, z: 100 } });
    camps.message('p1', ready);
    expect(camps.current?.night).toBe(true);
    expect(camps.message('p1', { type: 'camp', region: 'valadalen', action: 'wake' })!.state.state).toBe('morning');
    expect(camps.current).toBeNull();
  });
});

describe('a night passing', () => {
  it('runs the clock fast to dawn, stops there, then goes on at its old pace', () => {
    let now = 0;
    const world = new WorldState(loadConfig({ START_TIME: '2026-08-15T22:00', DAY_LENGTH_MINUTES: '24' }), () => now);
    const start = world.utc();
    const dawn = start + 7 * 3_600_000;
    world.passNight(dawn, 18_000);
    expect(world.message().time.until).toBe(dawn);
    expect(isServerMessage(world.message())).toBe(true);
    now += 9_000;
    expect(world.utc()).toBeCloseTo(start + 3.5 * 3_600_000, -3);
    now += 9_000;
    expect(world.utc()).toBe(dawn);
    expect(world.resting).toBe(false);
    now += 60_000; // back to a real minute an in-game hour
    expect(world.utc()).toBe(dawn + 3_600_000);
    expect(world.message().time.rate).toBe(60);
  });

  it('wakes early at dawn, and a change to the clock ends it where it is', () => {
    let now = 0;
    const world = new WorldState(loadConfig({ START_TIME: '2026-08-15T22:00', DAY_LENGTH_MINUTES: '0' }), () => now);
    const dawn = world.utc() + 6 * 3_600_000;
    world.passNight(dawn, 18_000);
    now += 1000;
    world.wake();
    expect(world.utc()).toBe(dawn);
    expect(world.message().time.rate).toBe(0);
    world.passNight(dawn + 3_600_000 * 20, 18_000);
    now += 9000;
    world.set({ type: 'set_world', weather: 'clear' });
    expect(world.resting).toBe(false);
    expect(world.utc()).toBeCloseTo(dawn + 10 * 3_600_000, -4);
  });
});
