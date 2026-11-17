import { describe, expect, it } from 'vitest';
import { createRng } from '@spar/shared';
import { needsCopy, REFILL_MOVE, shownBy, type Ranges } from './coverage';

const CHUNK = 64;
const SIDE = 12; // chunks per side: 768 m

interface Plant { x: number; y: number; z: number; rand: number; chunk: number }

function plants(seed: number): Plant[] {
  const rng = createRng(seed);
  const out: Plant[] = [];
  for (let k = 0; k < 6000; k++) {
    const x = rng.range(0, SIDE * CHUNK), z = rng.range(0, SIDE * CHUNK);
    out.push({ x, z, y: 5 * Math.sin(x / 40) + 3 * Math.cos(z / 30), rand: rng.range(0, 1), chunk: Math.floor(z / CHUNK) * SIDE + Math.floor(x / CHUNK) });
  }
  return out;
}

const boxDistance = (cx: number, cz: number, chunk: number): number => {
  const x0 = (chunk % SIDE) * CHUNK, z0 = Math.floor(chunk / SIDE) * CHUNK;
  return Math.hypot(Math.max(x0 - cx, 0, cx - x0 - CHUNK), Math.max(z0 - cz, 0, cz - z0 - CHUNK));
};

type Policy = {
  refill: (from: { x: number; z: number }, to: { x: number; z: number }) => boolean;
  holds: (distance: number, ranges: Ranges, copy: 'full' | 'low') => boolean;
};

/** The current rule: refill after a short move, with that move as margin. */
const current: Policy = {
  refill: (a, b) => Math.hypot(a.x - b.x, a.z - b.z) > REFILL_MOVE,
  holds: needsCopy,
};
/** The old rule: refill on entering another chunk, with a 12 % margin. */
const old: Policy = {
  refill: (a, b) => Math.floor(a.x / CHUNK) !== Math.floor(b.x / CHUNK) || Math.floor(a.z / CHUNK) !== Math.floor(b.z / CHUNK),
  holds: (d, r, copy) => (copy === 'full' ? d <= r.full * 1.12 : r.low !== undefined && d <= r.low * 1.12),
};

/** Drives a camera along a winding path and counts plants the shader wants drawn by a copy that lacks them. */
function missing(policy: Policy, ranges: Ranges, all: Plant[]): number {
  let last = { x: Infinity, z: Infinity };
  const filled = new Set<string>();
  let misses = 0;
  for (let s = 0; s < 1400; s += 1) {
    const t = s / 1400;
    const cam = { x: 100 + 560 * t + 60 * Math.sin(t * 17), y: 3 + 20 * Math.max(0, Math.sin(t * 9)), z: 380 + 250 * Math.sin(t * 5) };
    if (last.x === Infinity || policy.refill(last, cam)) {
      last = { x: cam.x, z: cam.z };
      filled.clear();
      for (let c = 0; c < SIDE * SIDE; c++) {
        const d = boxDistance(cam.x, cam.z, c);
        for (const copy of ['full', 'low'] as const) if (policy.holds(d, ranges, copy)) filled.add(`${c}|${copy}`);
      }
    }
    for (const p of all) {
      const copy = shownBy(Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z), p.rand, ranges);
      if ((copy === 'full' || copy === 'low') && !filled.has(`${p.chunk}|${copy}`)) misses++;
    }
  }
  return misses;
}

// Ranges as the medium preset makes them for trees, rocks and ground cover.
const trees: Ranges = { full: 44, low: 176, impostor: 1875 };
const rocks: Ranges = { full: 48, low: 176 };
const ground: Ranges = { full: 36 };

describe('vegetation copies', () => {
  const all = plants(7);

  it('always hold every plant the shader draws with them, along a winding drive', () => {
    for (const ranges of [trees, rocks, ground]) expect(missing(current, ranges, all)).toBe(0);
  });

  it('catches the old refill rule, which lost trees between refills', () => {
    expect(missing(old, trees, all)).toBeGreaterThan(0);
  });

  it('hands each plant from one copy to the next without a gap', () => {
    for (let d = 0; d < 1870; d += 0.5) {
      for (const rand of [0, 0.37, 0.999]) expect(shownBy(d, rand, trees)).not.toBeNull();
    }
    expect(shownBy(0.9 * 36 + 0.01, 0.5, ground)).toBeNull();
  });
});
