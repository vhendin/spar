import type { RegionIndex } from '@spar/shared';

export class RegionMissingError extends Error {
  constructor(readonly region: string) {
    super(`Region "${region}" has not been imported on the host yet.`);
  }
}

export const regionUrl = (region: string, path: string): string => `/regions/${region}/${path}`;

export async function loadRegionIndex(region: string): Promise<RegionIndex> {
  const res = await fetch(regionUrl(region, 'index.json'));
  if (res.status === 404) throw new RegionMissingError(region);
  if (!res.ok) throw new Error(`Could not load region "${region}" (HTTP ${res.status}).`);
  const index = (await res.json()) as RegionIndex;
  if (index.formatVersion !== 1) {
    throw new Error(`Region "${region}" uses format ${String(index.formatVersion)}; this client reads format 1. Run the importer again.`);
  }
  return index;
}

export function heightFileUrl(index: RegionIndex, level: number, x: number, y: number): string {
  const path = index.heights.path
    .replace('{level}', String(level))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  return regionUrl(index.name, path);
}

/** Fetches a raster of unsigned 16-bit little-endian values. */
export async function fetchUint16(url: string, expectedLength: number): Promise<Uint16Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength !== expectedLength * 2) {
    throw new Error(`${url} holds ${buffer.byteLength} bytes, expected ${expectedLength * 2}`);
  }
  // Every platform a browser runs on today is little-endian, like the files.
  return new Uint16Array(buffer);
}
