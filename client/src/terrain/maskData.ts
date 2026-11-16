// Cuts a node's mask texture out of a mask file. Pure functions, used from the terrain worker.

export interface NodeMaskRequest {
  /** Samples per side of the file and number of channel planes in it. */
  samples: number;
  channels: number;
  /** Plane numbers of the four channels the shader reads. */
  biome: number;
  surface: number;
  road: number;
  wetness: number;
  canopy: number;
  /** First sample of the node inside the file. */
  i0: number;
  j0: number;
  /** File samples between the samples taken. */
  stride: number;
  /** Samples taken per side, which is also the side of the texture. */
  size: number;
  /** Importance of each surface id; when samples are skipped, the most important nearby wins. */
  surfaceRank: number[];
}

/** Surface id (0..7) and road coverage (0..255) in one byte: id in the top three bits. */
export function packSurface(id: number, coverage: number): number {
  return (id << 5) | Math.round((coverage * 31) / 255);
}

/**
 * RGBA bytes, `size` x `size`, north row first: R biome id, G surface id in the top three
 * bits and road coverage in the lower five, B wetness, A canopy height. Roads narrower
 * than the sampling step are kept by taking the most important surface around each sample.
 */
export function buildNodeMask(file: Uint8Array, r: NodeMaskRequest): Uint8Array {
  const plane = r.samples * r.samples;
  const out = new Uint8Array(r.size * r.size * 4);
  const reach = r.stride >> 1;
  const last = r.samples - 1;
  for (let oy = 0; oy < r.size; oy++) {
    const row = r.j0 + oy * r.stride;
    for (let ox = 0; ox < r.size; ox++) {
      const col = r.i0 + ox * r.stride;
      const at = row * r.samples + col;
      let surface = file[r.surface * plane + at]!;
      let road = file[r.road * plane + at]!;
      if (reach > 0) {
        let best = r.surfaceRank[surface] ?? 0;
        for (let y = Math.max(0, row - reach); y <= Math.min(last, row + reach); y++) {
          for (let x = Math.max(0, col - reach); x <= Math.min(last, col + reach); x++) {
            const s = file[r.surface * plane + y * r.samples + x]!;
            const rank = r.surfaceRank[s] ?? 0;
            if (rank > best) {
              best = rank;
              surface = s;
              road = 0;
            }
            if (s === surface) road = Math.max(road, file[r.road * plane + y * r.samples + x]!);
          }
        }
      }
      const o = (oy * r.size + ox) * 4;
      out[o] = file[r.biome * plane + at]!;
      out[o + 1] = packSurface(surface, road);
      out[o + 2] = file[r.wetness * plane + at]!;
      out[o + 3] = file[r.canopy * plane + at]!;
    }
  }
  return out;
}
