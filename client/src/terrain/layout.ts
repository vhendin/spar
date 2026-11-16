// Where terrain nodes sit and which height file each one reads.
//
// The area is covered by root nodes as large as one coarsest-level file. A node can be
// replaced by four children of half the size, down to the depth where one quad matches
// the finest imported spacing. Every node is drawn with the same number of quads.

import type { RegionIndex } from '@spar/shared';

/** Quads per node side. */
export const NODE_QUADS = 32;

export interface NodeSource {
  level: number;
  /** File column (east) and row (south). */
  fileX: number;
  fileY: number;
  /** First sample of the node inside the file, apron not counted. */
  i0: number;
  j0: number;
  /** File samples between neighbouring vertices. */
  stride: number;
  /** Metres between file samples. */
  fileSpacing: number;
}

export interface TerrainLayout {
  rootSize: number;
  rootsPerSide: number;
  /** Deepest allowed node depth; depth 0 is a root. */
  maxDepth: number;
  rootLevel: number;
  finestLevel: number;
}

export function terrainLayout(index: RegionIndex): TerrainLayout {
  const levels = index.heights.levels;
  const finest = levels[0]!;
  const root = levels[levels.length - 1]!;
  const finestNode = NODE_QUADS * finest.spacing;
  return {
    rootSize: root.span,
    rootsPerSide: root.count,
    maxDepth: Math.max(0, Math.round(Math.log2(root.span / finestNode))),
    rootLevel: root.level,
    finestLevel: finest.level,
  };
}

/** Side of a node at `depth`, in metres. */
export function nodeSize(layout: TerrainLayout, depth: number): number {
  return layout.rootSize / 2 ** depth;
}

/**
 * The file a node reads: the coarsest level whose spacing is no wider than the node's
 * vertex spacing.
 */
export function nodeSource(layout: TerrainLayout, samples: number, depth: number, ix: number, iz: number): NodeSource {
  const size = nodeSize(layout, depth);
  const vertexSpacing = size / NODE_QUADS;
  const level = Math.min(layout.rootLevel, Math.max(layout.finestLevel, Math.floor(Math.log2(vertexSpacing))));
  const fileSpacing = 2 ** level;
  const span = (samples - 1) * fileSpacing;
  const x0 = ix * size;
  const z0 = iz * size;
  const fileX = Math.floor(x0 / span);
  const fileY = Math.floor(z0 / span);
  return {
    level,
    fileX,
    fileY,
    i0: (x0 - fileX * span) / fileSpacing,
    j0: (z0 - fileY * span) / fileSpacing,
    stride: vertexSpacing / fileSpacing,
    fileSpacing,
  };
}

/** Every node's mask texture is MASK_TEXELS + 1 samples wide. */
export const MASK_TEXELS = 128;

export interface MaskSource {
  level: number;
  fileX: number;
  fileY: number;
  /** First sample of the window inside the file. */
  i0: number;
  j0: number;
  /** File samples between the samples taken; MASK_TEXELS + 1 are taken per side. */
  stride: number;
  /** Where the node sits in its window: uv = offset + position across the node * scale. */
  uvOffsetX: number;
  uvOffsetY: number;
  uvScale: number;
}

/**
 * The part of a mask file a node's texture is cut from: the coarsest level that still
 * gives MASK_TEXELS samples across the node. A node too small for that many samples at the
 * finest level takes the larger window around it and uses a corner of the texture, so
 * texels always stand for real samples.
 */
export function maskSource(index: RegionIndex, size: number, x0: number, z0: number): MaskSource {
  const { levels, samples } = index.masks;
  const finest = levels[0]!;
  const coarsest = levels[levels.length - 1]!.level;
  const window = Math.max(size, MASK_TEXELS * finest.spacing);
  const wx = Math.floor(x0 / window) * window;
  const wz = Math.floor(z0 / window) * window;
  const wanted = window / MASK_TEXELS;
  const level = Math.min(coarsest, Math.max(finest.level, Math.floor(Math.log2(wanted))));
  const spacing = 2 ** level;
  const span = (samples - 1) * spacing;
  const fileX = Math.floor(wx / span);
  const fileY = Math.floor(wz / span);
  return {
    level,
    fileX,
    fileY,
    i0: (wx - fileX * span) / spacing,
    j0: (wz - fileY * span) / spacing,
    stride: wanted / spacing,
    uvOffsetX: (x0 - wx) / window,
    uvOffsetY: (z0 - wz) / window,
    uvScale: size / window,
  };
}

/** Distance from a point to an axis-aligned box. */
export function distanceToBox(
  px: number, py: number, pz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dy = Math.max(minY - py, 0, py - maxY);
  const dz = Math.max(minZ - pz, 0, pz - maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
