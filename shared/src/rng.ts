// Deterministic hashing and random numbers. Everything procedural draws from here so
// every client builds the same world from the same seed. Integer math only.

/** Mixes any number of 32-bit integers into one well-scrambled unsigned 32-bit value. */
export function hash32(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h ^= v | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    h = (h + 0x9e3779b9) | 0;
  }
  return h >>> 0;
}

export interface Rng {
  /** Unsigned 32-bit integer. */
  u32(): number;
  /** Float in [0, 1). */
  float(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
}

/** Mulberry32: small, fast, and identical in every JavaScript engine. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const u32 = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const float = (): number => u32() / 4294967296;
  return {
    u32,
    float,
    range: (min, max) => min + float() * (max - min),
    int: (n) => Math.floor(float() * n),
  };
}

/** Random stream for one layer of one tile, e.g. "boulders in tile 12,7". */
export function tileRng(worldSeed: number, tileX: number, tileY: number, layer: number): Rng {
  return createRng(hash32(worldSeed, tileX, tileY, layer));
}
