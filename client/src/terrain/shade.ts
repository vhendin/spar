// Placeholder ground colours from elevation and slope alone. Step 3 replaces this with
// shading from the imported masks.

type Rgb = readonly [number, number, number];

/** sRGB hex colour to linear RGB, which is what vertex colours must hold. */
function linear(hex: number): Rgb {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)];
}

const FOREST = linear(0x3d5633);
const HEATH = linear(0x84825a);
const ALPINE = linear(0x9c9a8e);
const ROCK = linear(0x6f6f6c);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Writes a linear RGB colour for ground at `height` metres whose unit normal has the
 * vertical component `ny` (1 = flat).
 */
export function terrainColor(height: number, ny: number, out: Float32Array, at: number): void {
  const heath = smoothstep(820, 980, height); // around the treeline in Jämtland
  const alpine = smoothstep(1150, 1400, height);
  const rock = smoothstep(0.93, 0.8, ny);
  for (let c = 0; c < 3; c++) {
    let v = FOREST[c]! + (HEATH[c]! - FOREST[c]!) * heath;
    v += (ALPINE[c]! - v) * alpine;
    v += (ROCK[c]! - v) * rock;
    out[at + c] = v;
  }
}
