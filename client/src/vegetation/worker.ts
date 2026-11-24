/// <reference lib="webworker" />
// Vegetation worker: fetches the ground data under a tile or patch and places its objects.

import type { RegionIndex } from '@spar/shared';
import { fetchBytes, fetchUint16, heightFileUrl, maskFileUrl } from '../terrain/region';
import { footprints, type Footprints } from './footprints';
import { groupByChunk, placeLayer, type GroundData, type Placement } from './placement';
import type { CompiledLayer } from './rules';

/** Trees and rocks are grouped by chunks of this size inside a tile, for picking those near the camera. */
export const CHUNK = 64;
/** Side of a patch, the unit near-only layers are placed in. */
export const PATCH = 32;

export type VegetationRequest =
  | { kind: 'init'; index: RegionIndex; layers: CompiledLayer[]; seed: number; buildings: number[][][] }
  | { kind: 'tile'; id: number; x: number; z: number }
  | { kind: 'patch'; id: number; x: number; z: number };

export interface PlacedLayer extends Placement {
  layer: number;
  /** For tile layers: where each chunk's objects start in the arrays, plus the total. */
  chunkStart: Uint32Array | null;
}

export type VegetationResponse = { id: number; ok: true; layers: PlacedLayer[] } | { id: number; ok: false; error: string };

let index: RegionIndex;
let layers: CompiledLayer[] = [];
let seed = 0;
let buildings: Footprints | null = null;

const cache = new Map<string, Promise<Uint8Array | Uint16Array>>();
function cached<T extends Uint8Array | Uint16Array>(url: string, load: () => Promise<T>): Promise<T> {
  let file = cache.get(url) as Promise<T> | undefined;
  if (file) cache.delete(url);
  else {
    file = load();
    file.catch(() => cache.delete(url));
  }
  cache.set(url, file);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return file;
}

/** Loads the mask and height files around a square starting at x, z and wraps them for placement. */
async function groundAt(x: number, z: number): Promise<GroundData> {
  const m = index.masks;
  const h = index.heights;
  const maskLevel = m.levels[0]!;
  // Heights no finer than the masks are plenty for standing objects on the ground.
  const heightLevel = h.levels.find((l) => l.spacing >= maskLevel.spacing) ?? h.levels[h.levels.length - 1]!;
  const mx = Math.floor(x / maskLevel.span);
  const mz = Math.floor(z / maskLevel.span);
  const hx = Math.floor(x / heightLevel.span);
  const hz = Math.floor(z / heightLevel.span);
  const side = h.samples + 2 * h.apron;
  const maskUrl = maskFileUrl(index, maskLevel.level, mx, mz);
  const heightUrl = heightFileUrl(index, heightLevel.level, hx, hz);
  const [mask, heights] = await Promise.all([
    cached(maskUrl, () => fetchBytes(maskUrl, m.samples * m.samples * m.channels.length)),
    cached(heightUrl, () => fetchUint16(heightUrl, side * side)),
  ]);
  const plane = (name: string): number => m.channels.findIndex((c) => c.name === name);
  const scale = (name: string): number => m.channels.find((c) => c.name === name)?.scale ?? 1;
  return {
    mask,
    maskX0: mx * maskLevel.span,
    maskZ0: mz * maskLevel.span,
    maskSpacing: maskLevel.spacing,
    maskSamples: m.samples,
    planes: { biome: plane('biome'), road: plane('road'), wetness: plane('wetness'), canopy: plane('canopy'), slope: plane('slope') },
    wetnessScale: scale('wetness'),
    canopyScale: scale('canopy'),
    slopeScale: scale('slope'),
    heights,
    heightX0: hx * heightLevel.span,
    heightZ0: hz * heightLevel.span,
    heightSpacing: heightLevel.spacing,
    heightSide: side,
    heightApron: h.apron,
    heightOffset: h.encoding.offset,
    heightScale: h.encoding.scale,
    waterId: m.biomes.find((b) => b.name === 'water')?.id ?? -1,
    treeline: m.treeline,
    regionSize: index.size,
    footprints: buildings,
  };
}

async function place(batch: 'tile' | 'patch', x: number, z: number): Promise<PlacedLayer[]> {
  const size = batch === 'tile' ? index.tileSize : PATCH;
  const ground = await groundAt(x, z);
  return layers
    .filter((l) => l.batch === batch)
    .map((l) => {
      const placed = placeLayer(l, seed, x, z, x + size, z + size, ground);
      const chunkStart = batch === 'tile' ? groupByChunk(placed, x, z, CHUNK, size / CHUNK) : null;
      return { ...placed, layer: l.id, chunkStart };
    });
}

self.onmessage = (ev: MessageEvent<VegetationRequest>): void => {
  const req = ev.data;
  if (req.kind === 'init') {
    ({ index, layers, seed } = req);
    buildings = footprints(req.buildings);
    return;
  }
  place(req.kind, req.x, req.z).then(
    (placed) => {
      const transfer = placed.flatMap((p) => [p.data.buffer, p.species.buffer, p.variant.buffer, p.cells.buffer, ...(p.chunkStart ? [p.chunkStart.buffer] : [])]);
      self.postMessage({ id: req.id, ok: true, layers: placed } satisfies VegetationResponse, { transfer });
    },
    (err: unknown) => self.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies VegetationResponse),
  );
};
