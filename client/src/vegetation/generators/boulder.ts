import { createRng } from '@spar/shared';
import { icosahedron, MeshBuilder, mixRgb, num, scaleRgb, type Generator } from './mesh';

const ICO = icosahedron();

/**
 * A glacial boulder: a lumpy ball, flattened, stretched and sunk a little into the ground,
 * with lichen on its upper faces. `rough` is the size of the lumps and `sink` the share of
 * the stone below ground.
 */
export const boulder: Generator = (params, colors, seed, detail) => {
  const rng = createRng(seed);
  const flatten = num(params, 'flatten', 0.75, rng);
  const stretch = num(params, 'stretch', 1, rng);
  const rough = num(params, 'rough', 0.18, rng);
  const sink = num(params, 'sink', 0.25, rng);
  const tone = rng.range(0.85, 1.12);

  // Lump the 12 corners first: the simplified stone is exactly these.
  const lump = (): number => 1 + rough * (rng.float() - 0.5) * 2;
  const corners = ICO.vertices.map(([x, y, z]) => {
    const k = lump();
    return [x * k, y * k, z * k] as [number, number, number];
  });
  let points = corners;
  let faces = ICO.faces;
  if (detail === 'full') {
    // Split every face in four; the new edge midpoints get their own lumps.
    const midpoint = new Map<number, number>();
    points = corners.slice();
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 64 + b : b * 64 + a;
      let at = midpoint.get(key);
      if (at === undefined) {
        const k = lump() / 2;
        // Push the midpoint out towards the sphere the corners sit on, then lump it.
        const m: [number, number, number] = [(corners[a]![0] + corners[b]![0]) * k, (corners[a]![1] + corners[b]![1]) * k, (corners[a]![2] + corners[b]![2]) * k];
        const len = Math.hypot(...m) || 1;
        const want = (Math.hypot(...corners[a]!) + Math.hypot(...corners[b]!)) / 2;
        const grow = 1 + (want / len - 1) * 0.8;
        at = points.push([m[0] * grow, m[1] * grow, m[2] * grow]) - 1;
        midpoint.set(key, at);
      }
      return at;
    };
    faces = ICO.faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as [number, number, number][];
    });
  }

  // Scale to unit height above ground with `sink` of the stone buried.
  let low = Infinity, high = -Infinity;
  for (const p of points) {
    low = Math.min(low, p[1] * flatten);
    high = Math.max(high, p[1] * flatten);
  }
  const k = 1 / ((high - low) * (1 - sink));
  const mesh = new MeshBuilder();
  const lichen = createRng(seed ^ 0x5bd1e995);
  for (const p of points) {
    const y = (p[1] * flatten - low) * k - sink / (1 - sink);
    const up = Math.max(0, p[1]);
    const color = scaleRgb(mixRgb(colors.foliage, colors.accent, up * lichen.range(0, 0.7)), tone * lichen.range(0.88, 1.1) * (0.8 + 0.2 * up));
    mesh.vertex(p[0] * stretch * k * flatten, y, p[2] * k * flatten, color, 0);
  }
  for (const [a, b, c] of faces) mesh.triangle(a, b, c);
  mesh.smoothNormals(0, mesh.vertexCount, [0, 0.3, 0]);
  return mesh.build();
};
