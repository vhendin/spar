import { createRng } from '@spar/shared';
import { icosahedron, MeshBuilder, mixRgb, num, scaleRgb, type Generator, type Rgb } from './mesh';

const ICO = icosahedron();
/**
 * Birch, aspen, rowan and other leafy trees: one or more stems that fork into branches,
 * each carrying a blob of leaves. `split` is where the stem forks, `elongate` stretches the
 * blobs upward (a narrow birch) or flattens them (a spreading mountain birch).
 */
export const broadleaf: Generator = (params, colors, seed, detail) => {
  const shape = createRng(seed);
  const stems = Math.round(num(params, 'stems', 1, shape));
  const split = num(params, 'split', 0.5, shape);
  const branches = Math.round(num(params, 'branches', 4, shape));
  const crownWidth = num(params, 'crownWidth', 0.3, shape);
  const elongate = num(params, 'elongate', 1.2, shape);
  const blobCount = Math.round(num(params, 'blobs', 7, shape));
  const trunkRadius = num(params, 'trunkRadius', 0.018, shape);
  const crook = num(params, 'crook', 0.02, shape);
  const lean = num(params, 'lean', 0.05, shape);
  const barkMarks = num(params, 'barkMarks', 0, shape);

  const full = detail === 'full';
  const mesh = new MeshBuilder();
  const blobRadius = crownWidth * 0.62;
  // Leave room above the highest branch end for its blob, so the tree tops out at 1.
  const crownTop = 1 - blobRadius * elongate * 0.8;
  const ends: [number, number, number][] = [];

  for (let s = 0; s < stems; s++) {
    const turn = shape.range(0, 6.28);
    const tilt = stems > 1 ? lean + shape.range(0, lean) : lean * shape.float();
    const wobble = [shape.range(0, 6.28), shape.range(0.7, 1.5)];
    const stemTop = split * (stems > 1 ? shape.range(0.8, 1.1) : 1);
    const at = (t: number): [number, number, number] => {
      const out = tilt * t + crook * Math.sin(wobble[0]! + t * 5 * wobble[1]!) * t;
      return [Math.cos(turn) * out, t, Math.sin(turn) * out];
    };

    const ringCount = full ? 5 : 2;
    const rings = [];
    for (let j = 0; j < ringCount; j++) {
      const t = (j / (ringCount - 1)) * stemTop;
      const [x, y, z] = at(t);
      // Old bark at the foot is dark; higher up, pale bark carries scattered dark marks.
      let color: Rgb = mixRgb(colors.bark, colors.barkTop, t / Math.max(0.01, stemTop));
      if (j === 0 || shape.float() < barkMarks * (1 - t)) color = mixRgb(color, colors.accent, j === 0 ? 0.75 : 0.55);
      rings.push({ x, y, z, r: (trunkRadius / Math.sqrt(stems)) * (1 - 0.45 * (t / stemTop)) + 0.003, color, sway: t * t * 0.3 });
    }
    mesh.tube(rings, full ? 5 : 3, false);

    const [bx, by, bz] = at(stemTop);
    const share = Math.max(1, Math.round(branches / stems));
    for (let b = 0; b < share; b++) {
      const a = turn + ((b + shape.float() * 0.6) / share) * Math.PI * 2;
      const reach = crownWidth * shape.range(0.35, 0.8);
      const top = stemTop + (crownTop - stemTop) * shape.range(0.45, 1);
      const end: [number, number, number] = [bx + Math.cos(a) * reach, top, bz + Math.sin(a) * reach];
      ends.push(end);
      if (full) {
        const r0 = (trunkRadius / Math.sqrt(stems)) * 0.5;
        const mid: [number, number, number] = [bx + (end[0] - bx) * 0.6, by + (end[1] - by) * 0.45, bz + (end[2] - bz) * 0.6];
        mesh.tube(
          [
            { x: bx, y: by, z: bz, r: r0, color: colors.barkTop, sway: by * by * 0.3 },
            { x: mid[0], y: mid[1], z: mid[2], r: r0 * 0.6, color: colors.barkTop, sway: mid[1] * 0.6 },
            { x: end[0], y: end[1], z: end[2], r: r0 * 0.25, color: colors.barkTop, sway: end[1] * 0.9 },
          ],
          4,
          false,
        );
      }
    }
  }

  // Leaf blobs: one on each branch end, the rest filling the crown's middle.
  const centres = ends.slice(0, blobCount);
  let cx = 0, cy = 0, cz = 0;
  for (const e of ends) { cx += e[0]; cy += e[1]; cz += e[2]; }
  cx /= ends.length; cy /= ends.length; cz /= ends.length;
  while (centres.length < blobCount) {
    centres.push([cx + shape.range(-0.4, 0.4) * crownWidth, cy + shape.range(-0.3, 0.5) * crownWidth * elongate, cz + shape.range(-0.4, 0.4) * crownWidth]);
  }
  const blobSize = centres.map(() => blobRadius * shape.range(0.75, 1.15));
  const blobShade = centres.map(() => shape.range(0.85, 1.12));
  const bumps = centres.map(() => ICO.vertices.map(() => shape.range(0.82, 1.18)));

  // The simplified tree keeps the largest few blobs, enlarged to fill the same outline.
  const order = centres.map((_, k) => k).sort((a, b) => blobSize[b]! - blobSize[a]!);
  const kept = full ? order : order.slice(0, Math.max(2, Math.round(blobCount / 3)));
  const solid = ICO;
  // Out of leaf the blobs thin to a haze of twigs, in the winter colour; not much smaller, or
  // they come apart into separate lumps.
  const inLeaf = 0.82 + 0.18 * colors.leaves;
  for (const k of kept) {
    const [x, y, z] = centres[k]!;
    const r = blobSize[k]! * (full ? 1 : 1.25) * inLeaf;
    const start = mesh.vertexCount;
    solid.vertices.forEach(([vx, vy, vz], v) => {
      const bump = full ? bumps[k]![v]! : 1;
      const px = x + vx * r * bump, pz = z + vz * r * bump;
      const py = Math.min(1, Math.max(0.03, y + vy * r * elongate * bump));
      // Shade by where the leaf sits in the whole crown, so the tree reads as one mass.
      let nx = vx + (px - cx) * 2, ny = vy + (py - cy) * 2 + 0.4, nz = vz + (pz - cz) * 2;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const light = (0.74 + 0.26 * (vy * 0.5 + 0.5)) * blobShade[k]!;
      mesh.vertex(px, py, pz, scaleRgb(colors.foliage, light), py * (0.7 + 0.3 * Math.abs(vx)), nx, ny, nz);
    });
    for (const [a, b, c] of solid.faces) mesh.triangle(start + a, start + b, start + c);
  }
  return mesh.build();
};
