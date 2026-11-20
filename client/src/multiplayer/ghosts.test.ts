import { describe, expect, it } from 'vitest';
import type { VehicleSnapshot } from '@spar/shared';
import { Ghosts } from './ghosts';

const snap = (x: number, jump = 0): VehicleSnapshot => ({
  region: 'demo', vehicle: 'tgb11', jump, t: 0, paused: false,
  p: [x, 2, 0], q: [0, 0, 0, 1], v: [0, 0, 0], wheels: [], ground: [],
  engine: { rpm: 800, gear: 1, low: false, shifting: false, pedal: 0, drowned: false },
  wading: 0, lights: false, braking: false,
});

describe('ghosts', () => {
  it('follow our track a set distance apart, once there is room for them', () => {
    const ghosts = new Ghosts(2, 'demo');
    expect(ghosts.players.map((p) => p.id)).toEqual(['ghost1', 'ghost2']);
    let out: ReturnType<Ghosts['follow']> = [];
    for (let x = 0; x <= 20; x++) out = ghosts.follow(snap(x), x * 50);
    // 20 m driven: room for the first, 14 m behind, not yet for the second.
    expect(out.map((g) => [g.id, g.snapshot.p[0], g.snapshot.t])).toEqual([['ghost1', 6, 1000]]);
    for (let x = 21; x <= 100; x++) out = ghosts.follow(snap(x), x * 50);
    expect(out.map((g) => g.snapshot.p[0])).toEqual([86, 72]);
    // Standing still, they stay where they are.
    out = ghosts.follow(snap(100), 6000);
    expect(out.map((g) => g.snapshot.p[0])).toEqual([86, 72]);
    // Put somewhere new: they wait for room again.
    expect(ghosts.follow(snap(500, 1), 6100)).toEqual([]);
  });
});
