import { describe, expect, it } from 'vitest';
import type { RegionIndex } from '@spar/shared';
import { distanceToBox, NODE_QUADS, nodeSize, nodeSource, terrainLayout } from './layout';

function index(finest: number): RegionIndex {
  const levels = [];
  for (let level = finest; level <= 3; level++) {
    const span = 256 * 2 ** level;
    levels.push({ level, spacing: 2 ** level, span, count: 10240 / span });
  }
  return { size: 10240, heights: { samples: 257, apron: 1, levels } } as unknown as RegionIndex;
}

describe('terrain layout', () => {
  it('stops splitting where one quad matches the finest data', () => {
    expect(terrainLayout(index(2))).toMatchObject({ rootSize: 2048, rootsPerSide: 5, maxDepth: 4 });
    expect(terrainLayout(index(0)).maxDepth).toBe(6);
    expect(terrainLayout(index(3)).maxDepth).toBe(3);
    expect(nodeSize(terrainLayout(index(0)), 6)).toBe(NODE_QUADS);
  });

  it('reads coarse nodes from the root files with a stride', () => {
    const layout = terrainLayout(index(0));
    expect(nodeSource(layout, 257, 0, 4, 2)).toEqual({ level: 3, fileX: 4, fileY: 2, i0: 0, j0: 0, stride: 8, fileSpacing: 8 });
    // Depth 2: 512 m nodes, 16 m between vertices, a quarter-wide window into a root file.
    expect(nodeSource(layout, 257, 2, 5, 2)).toEqual({ level: 3, fileX: 1, fileY: 0, i0: 64, j0: 128, stride: 2, fileSpacing: 8 });
    // Depth 3: 256 m nodes at 8 m, every sample of an eighth-wide window.
    expect(nodeSource(layout, 257, 3, 9, 4)).toEqual({ level: 3, fileX: 1, fileY: 0, i0: 32, j0: 128, stride: 1, fileSpacing: 8 });
  });

  it('moves to finer files as nodes shrink', () => {
    const layout = terrainLayout(index(0));
    // Depth 4: 128 m nodes at 4 m, from level 2 files spanning 1024 m.
    expect(nodeSource(layout, 257, 4, 9, 4)).toEqual({ level: 2, fileX: 1, fileY: 0, i0: 32, j0: 128, stride: 1, fileSpacing: 4 });
    // Depth 6: 32 m nodes at 1 m, from level 0 files spanning 256 m.
    expect(nodeSource(layout, 257, 6, 7, 0)).toEqual({ level: 0, fileX: 0, fileY: 0, i0: 224, j0: 0, stride: 1, fileSpacing: 1 });
  });

  it('never asks for a level that was not imported', () => {
    const layout = terrainLayout(index(2));
    for (let depth = 0; depth <= layout.maxDepth; depth++) {
      const src = nodeSource(layout, 257, depth, 0, 0);
      expect(src.level).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(src.stride)).toBe(true);
      expect(src.i0 + NODE_QUADS * src.stride).toBeLessThanOrEqual(256);
    }
  });

  it('measures distance to a box', () => {
    expect(distanceToBox(5, 5, 5, 0, 0, 0, 10, 10, 10)).toBe(0);
    expect(distanceToBox(13, 14, 5, 0, 0, 0, 10, 10, 10)).toBe(5);
  });
});
