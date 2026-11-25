// The map's picture of the ground: each kind of land in its own colour, wetland striped,
// hills shaded as if lit from the north-west, and contour lines every 20 metres with every
// fifth one darker. Pure arithmetic on the region's rasters, so it is tested on its own.

export interface MapRasters {
  /** Samples per side, and metres between samples. */
  n: number;
  spacing: number;
  /** Metres above sea level, row by row from the north-west corner. */
  heights: Float32Array;
  /** Biome and surface class ids from the masks, same layout. */
  biome: Uint8Array;
  surface: Uint8Array;
  /** Height of the trees from the canopy mask, in units of `canopyScale` metres (0 if none). */
  canopy: Uint8Array;
  canopyScale: number;
}

/** Biome ids in the region index, by name. */
export type BiomeIds = Record<string, number>;

type Rgb = [number, number, number];

const LAND: Record<string, Rgb> = {
  unknown: [233, 230, 218],
  forest: [190, 214, 160],
  wetland: [222, 232, 214],
  bare_rock: [222, 216, 206],
  scree: [214, 207, 196],
  heath: [234, 228, 196],
  grassland: [232, 239, 202],
  farmland: [243, 230, 170],
  water: [150, 196, 230],
  scrub: [212, 226, 178],
  built_up: [230, 214, 202],
  sand: [240, 226, 186],
  clearcut: [226, 234, 194],
  regrowth: [206, 226, 170],
};
const WETLAND_STRIPE: Rgb = [110, 160, 205];
const CONTOUR: Rgb = [160, 112, 70];
/** Metres between contour lines; every fifth is drawn darker. */
export const CONTOUR_STEP = 20;

/** Paints the ground into RGBA pixels, one per sample. */
export function paintGround(r: MapRasters, ids: BiomeIds): Uint8ClampedArray<ArrayBuffer> {
  const { n, spacing, heights, biome, surface } = r;
  const colours: Rgb[] = [];
  for (const [name, id] of Object.entries(ids)) colours[id] = LAND[name] ?? LAND.unknown!;
  const water = ids.water ?? -1;
  const wetland = ids.wetland ?? -1;
  const out = new Uint8ClampedArray(n * n * 4);
  const h = (x: number, y: number): number => heights[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))]!;
  // Light from the north-west, fairly low, as maps have always been shaded.
  const lx = -0.5, ly = -0.5, lz = 0.707;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const b = biome[i]!;
      // Pools and streams in the surface mask are water too.
      const s = surface[i]!;
      const wet = b === water || s === 6 || s === 7;
      let c = wet ? LAND.water! : (colours[b] ?? LAND.unknown!);
      if (!wet && b === wetland && y % 4 === 0 && x % 7 < 4) c = WETLAND_STRIPE;
      let [red, green, blue] = c;
      if (!wet) {
        // Exaggerated a little, so gentle slopes still read.
        const dx = ((h(x + 1, y) - h(x - 1, y)) / (2 * spacing)) * 1.6;
        const dy = ((h(x, y + 1) - h(x, y - 1)) / (2 * spacing)) * 1.6;
        const len = Math.hypot(dx, dy, 1);
        const lit = (-dx * lx - dy * ly + lz) / len;
        const shade = 0.72 + 0.4 * (lit - 0.707);
        red *= shade;
        green *= shade;
        blue *= shade;
        // A contour where this sample and the next one over sit in different bands.
        const here = Math.floor(h(x, y) / CONTOUR_STEP);
        const right = Math.floor(h(x + 1, y) / CONTOUR_STEP);
        const below = Math.floor(h(x, y + 1) / CONTOUR_STEP);
        if (here !== right || here !== below) {
          const band = Math.max(here, right, below);
          const k = band % 5 === 0 ? 0.75 : 0.4;
          red += (CONTOUR[0] - red) * k;
          green += (CONTOUR[1] - green) * k;
          blue += (CONTOUR[2] - blue) * k;
        }
      }
      out[i * 4] = red;
      out[i * 4 + 1] = green;
      out[i * 4 + 2] = blue;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

export interface Summit {
  x: number;
  y: number;
  height: number;
}

/**
 * Tops worth a spot height: the highest sample within `radius` samples all round, standing
 * at least `rise` metres above the lowest point of that circle's rim. Highest first.
 */
export function summits(r: MapRasters, radius: number, rise: number): Summit[] {
  const { n, heights } = r;
  const found: Summit[] = [];
  const step = Math.max(1, Math.floor(radius / 4));
  for (let y = radius; y < n - radius; y += 2) {
    for (let x = radius; x < n - radius; x += 2) {
      const top = heights[y * n + x]!;
      let highest = true;
      for (let dy = -radius; dy <= radius && highest; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          if (dx * dx + dy * dy > radius * radius) continue;
          if (heights[(y + dy) * n + x + dx]! > top) {
            highest = false;
            break;
          }
        }
      }
      if (!highest) continue;
      let rim = Infinity;
      for (let a = 0; a < 16; a++) {
        const ax = Math.round(x + Math.cos((a / 16) * Math.PI * 2) * radius);
        const ay = Math.round(y + Math.sin((a / 16) * Math.PI * 2) * radius);
        rim = Math.min(rim, heights[ay * n + ax]!);
      }
      if (top - rim >= rise && !found.some((f) => Math.hypot(f.x - x, f.y - y) < radius)) found.push({ x, y, height: top });
      x += step;
    }
  }
  return found.sort((a, b) => b.height - a.height);
}
