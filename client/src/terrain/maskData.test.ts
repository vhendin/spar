import { describe, expect, it } from 'vitest';
import type { RegionIndex } from '@spar/shared';
import { maskSource } from './layout';
import { buildNodeMask, packSurface, type NodeMaskRequest } from './maskData';

const SAMPLES = 257;
const PLANE = SAMPLES * SAMPLES;
// Planes in file order: biome, surface, road, wetness, canopy, slope.
const base: NodeMaskRequest = {
  samples: SAMPLES, channels: 6, biome: 0, surface: 1, road: 2, wetness: 3, canopy: 4,
  i0: 0, j0: 0, stride: 1, size: 129, surfaceRank: [0, 5, 4, 3, 1, 2],
};

function file(): Uint8Array {
  const f = new Uint8Array(PLANE * 6);
  for (let row = 0; row < SAMPLES; row++)
    for (let col = 0; col < SAMPLES; col++) {
      const at = row * SAMPLES + col;
      f[at] = col < 100 ? 1 : 8; // forest in the west, water in the east
      f[3 * PLANE + at] = row; // wetness grows southward
      f[4 * PLANE + at] = col; // canopy grows eastward
    }
  // A gravel road one sample wide along column 51, and a footpath along row 31.
  for (let row = 0; row < SAMPLES; row++) {
    f[PLANE + row * SAMPLES + 51] = 2;
    f[2 * PLANE + row * SAMPLES + 51] = 255;
  }
  for (let col = 0; col < SAMPLES; col++) {
    if (col === 51) continue;
    f[PLANE + 31 * SAMPLES + col] = 4;
    f[2 * PLANE + 31 * SAMPLES + col] = 128;
  }
  return f;
}

const texel = (m: Uint8Array, size: number, x: number, y: number): number[] => [...m.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

describe('buildNodeMask', () => {
  it('copies a window of the file sample for sample', () => {
    const m = buildNodeMask(file(), { ...base, i0: 64, j0: 128 });
    expect(m.length).toBe(129 * 129 * 4);
    expect(texel(m, 129, 0, 0)).toEqual([1, 0, 128, 64]);
    expect(texel(m, 129, 40, 5)).toEqual([8, 0, 133, 104]);
  });

  it('packs surface id and road coverage into one byte', () => {
    const m = buildNodeMask(file(), base);
    expect(texel(m, 129, 51, 10)[1]).toBe(packSurface(2, 255));
    expect(packSurface(2, 255)).toBe((2 << 5) | 31);
    expect(texel(m, 129, 20, 31)[1]).toBe((4 << 5) | 16);
    expect(texel(m, 129, 20, 30)[1]).toBe(0);
  });

  it('keeps a thin road when samples are skipped, and prefers it to a footpath', () => {
    // Stride 4 takes columns 0, 4, 8…: column 51 is never sampled, but 52 sees it next door.
    const m = buildNodeMask(file(), { ...base, stride: 4, size: 65 });
    expect(texel(m, 65, 13, 3)[1]).toBe(packSurface(2, 255));
    expect(texel(m, 65, 13, 8)[1]).toBe(packSurface(2, 255)); // row 32, beside the footpath: road wins
    expect(texel(m, 65, 5, 8)[1]).toBe(packSurface(4, 128)); // footpath alone is kept too
    expect(texel(m, 65, 5, 3)[1]).toBe(0);
  });
});

describe('maskSource', () => {
  const index = {
    masks: { samples: 257, levels: [1, 2, 3].map((level) => ({ level, spacing: 2 ** level, span: 256 * 2 ** level, count: 10240 / (256 * 2 ** level) })) },
  } as unknown as RegionIndex;

  const whole = { uvOffsetX: 0, uvOffsetY: 0, uvScale: 1 };

  it('matches texels to node size where the data allows', () => {
    expect(maskSource(index, 256, 768, 1280)).toEqual({ level: 1, fileX: 1, fileY: 2, i0: 128, j0: 128, stride: 1, ...whole });
    expect(maskSource(index, 512, 1536, 0)).toEqual({ level: 2, fileX: 1, fileY: 0, i0: 128, j0: 0, stride: 1, ...whole });
    expect(maskSource(index, 1024, 3072, 1024)).toEqual({ level: 3, fileX: 1, fileY: 0, i0: 128, j0: 128, stride: 1, ...whole });
  });

  it('skips samples for the largest nodes', () => {
    expect(maskSource(index, 2048, 4096, 2048)).toEqual({ level: 3, fileX: 2, fileY: 1, i0: 0, j0: 0, stride: 2, ...whole });
  });

  it('gives a small node a corner of the finest window around it', () => {
    // A 32 m node at x 480, z 64 lies in the 256 m window starting at x 256, z 0.
    expect(maskSource(index, 32, 480, 64)).toEqual({
      level: 1, fileX: 0, fileY: 0, i0: 128, j0: 0, stride: 1, uvOffsetX: 0.875, uvOffsetY: 0.25, uvScale: 0.125,
    });
  });
});
