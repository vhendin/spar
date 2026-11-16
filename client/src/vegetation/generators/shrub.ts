import { createRng } from '@spar/shared';
import { MeshBuilder, mixRgb, num, scaleRgb, type Generator } from './mesh';

/**
 * Bushes and dwarf shrubs. form "column" stands upright as a few spindles (juniper);
 * form "mound" hugs the ground as a bumpy dome (blueberry, heather). `spread` is the
 * width as a multiple of the height.
 */
export const shrub: Generator = (params, colors, seed) => {
  const rng = createRng(seed);
  const lobes = Math.round(num(params, 'lobes', 5, rng));
  const spread = num(params, 'spread', 1, rng);
  const lean = num(params, 'lean', 0, rng);
  const mesh = new MeshBuilder();

  if (params.form === 'column') {
    for (let l = 0; l < lobes; l++) {
      const a = (l / lobes) * Math.PI * 2 + rng.range(0, 0.8);
      const off = l === 0 ? 0 : spread * rng.range(0.15, 0.4);
      const height = l === 0 ? 1 : rng.range(0.5, 0.9);
      const width = spread * rng.range(0.16, 0.26) * (l === 0 ? 1.2 : 1);
      const bx = Math.cos(a) * off, bz = Math.sin(a) * off;
      const tx = bx + Math.cos(a) * lean * height, tz = bz + Math.sin(a) * lean * height;
      const shade = rng.range(0.85, 1.12);
      const start = mesh.vertexCount;
      const sides = 5;
      mesh.vertex(bx, 0, bz, scaleRgb(colors.foliage, 0.6 * shade), 0);
      for (let k = 0; k < sides; k++) {
        const b = (k / sides) * Math.PI * 2;
        const r = width * rng.range(0.85, 1.15);
        mesh.vertex(bx + (tx - bx) * 0.4 + Math.cos(b) * r, height * 0.4, bz + (tz - bz) * 0.4 + Math.sin(b) * r, scaleRgb(colors.foliage, shade), 0.3);
      }
      mesh.vertex(tx, height, tz, scaleRgb(mixRgb(colors.foliage, colors.accent, 0.6), shade), 0.8);
      for (let k = 0; k < sides; k++) {
        const p = start + 1 + k, q = start + 1 + ((k + 1) % sides);
        mesh.triangle(start, p, q);
        mesh.triangle(p, start + sides + 1, q);
      }
      mesh.smoothNormals(start, mesh.vertexCount, [bx, height * 0.4, bz]);
    }
    return mesh.build();
  }

  // Mound: a crown vertex, a shoulder ring and a rim touching the ground.
  const radius = spread / 2;
  const top = mesh.vertex(rng.range(-0.1, 0.1) * radius, 1, rng.range(-0.1, 0.1) * radius, mixRgb(colors.foliage, colors.accent, 0.45), 0.6);
  const inner = lobes, outer = lobes + 2;
  for (let k = 0; k < inner; k++) {
    const a = (k / inner) * Math.PI * 2;
    const r = radius * rng.range(0.4, 0.62);
    mesh.vertex(Math.cos(a) * r, rng.range(0.55, 0.95), Math.sin(a) * r, mixRgb(colors.foliage, colors.accent, rng.range(0.05, 0.4)), 0.5);
  }
  for (let k = 0; k < outer; k++) {
    const a = (k / outer) * Math.PI * 2 + 0.3;
    const r = radius * rng.range(0.8, 1.15);
    mesh.vertex(Math.cos(a) * r, 0.02, Math.sin(a) * r, scaleRgb(colors.foliage, rng.range(0.6, 0.8)), 0.1);
  }
  for (let k = 0; k < inner; k++) mesh.triangle(top, top + 1 + ((k + 1) % inner), top + 1 + k);
  // Stitch the two rings, which have different vertex counts, by walking both at once.
  let i = 0, o = 0;
  const ring1 = top + 1, ring2 = top + 1 + inner;
  while (i < inner || o < outer) {
    const takeOuter = i >= inner || (o < outer && (o + 0.5) / outer < (i + 0.5) / inner);
    if (takeOuter) {
      mesh.triangle(ring1 + (i % inner), ring2 + ((o + 1) % outer), ring2 + (o % outer));
      o++;
    } else {
      mesh.triangle(ring1 + (i % inner), ring1 + ((i + 1) % inner), ring2 + (o % outer));
      i++;
    }
  }
  mesh.smoothNormals(0, mesh.vertexCount, [0, -0.5, 0]);
  return mesh.build();
};
