import { createRng } from '@spar/shared';
import { icosahedron, MeshBuilder, mixRgb, num, scaleRgb, type Generator, type Rgb } from './mesh';

const ICO = icosahedron();
/** Twigs drawn out from where each leaf blob sits, in full detail. */
const TWIGS = 3;

type Point = [number, number, number];

/** A point a fraction t along a polyline. */
function along(points: Point[], t: number): Point {
  const lengths = points.slice(1).map((p, k) => Math.hypot(p[0] - points[k]![0], p[1] - points[k]![1], p[2] - points[k]![2]));
  let left = t * lengths.reduce((a, b) => a + b, 0);
  for (let k = 0; k < lengths.length; k++) {
    if (left <= lengths[k]! || k === lengths.length - 1) {
      const f = lengths[k]! > 0 ? Math.min(1, left / lengths[k]!) : 0;
      const a = points[k]!, b = points[k + 1]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    left -= lengths[k]!;
  }
  return points[points.length - 1]!;
}

/**
 * A branch: a tube through `points`, its radius tapering from r0 to r1 and its colour from c0
 * to c1. Unlike MeshBuilder.tube, each ring is turned square to the branch, and the normals
 * point straight out of it, so the upper side of a level branch faces up and can hold snow.
 */
function limb(mesh: MeshBuilder, points: Point[], r0: number, r1: number, c0: Rgb, c1: Rgb, sides: number, sway: (y: number, j: number) => number): void {
  const start = mesh.vertexCount;
  const n = points.length;
  for (let j = 0; j < n; j++) {
    const a = points[Math.max(0, j - 1)]!, b = points[Math.min(n - 1, j + 1)]!;
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // A side vector level with the ground (or along x for an upright branch), and the third
    // square to both, which points upward wherever the branch is not upright.
    let ux = -dz, uz = dx;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-4) { ux = 1; uz = 0; } else { ux /= ul; uz /= ul; }
    const vx = dy * uz, vy = dz * ux - dx * uz, vz = -dy * ux;
    const t = j / (n - 1);
    const r = r0 + (r1 - r0) * t;
    const color = mixRgb(c0, c1, t);
    const [px, py, pz] = points[j]!;
    for (let k = 0; k < sides; k++) {
      const angle = (k / sides) * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      const nx = ux * c + vx * s, ny = vy * s, nz = uz * c + vz * s;
      mesh.vertex(px + nx * r, py + ny * r, pz + nz * r, color, sway(py, j), nx, ny, nz);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let k = 0; k < sides; k++) {
      const a = start + j * sides + k;
      const b = start + j * sides + ((k + 1) % sides);
      mesh.quad(a, b, b + sides, a + sides);
    }
  }
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Birch, aspen, rowan and other leafy trees: one or more stems that fork into branches,
 * each carrying a blob of leaves. `split` is where the stem forks, `elongate` stretches the
 * blobs upward (a narrow birch) or flattens them (a spreading mountain birch), `droop` hangs
 * the twigs (a weeping birch).
 *
 * Every blob sits at the end of a branch, with a few fine twigs inside it. As the leaves fall
 * the blobs shrink away onto their twigs, so a bare tree in winter shows its
 * branches; in spring they grow back. The vertices stay the same through the year.
 */
export const broadleaf: Generator = (params, colors, seed, detail, picture = false) => {
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
  const droop = num(params, 'droop', 0.2, shape);

  const full = detail === 'full';
  // In a far picture a twig is a fraction of a pixel: thicker, so a bare wood stays a haze.
  const thick = picture ? 3 : 1;
  const mesh = new MeshBuilder();
  const blobRadius = crownWidth * 0.62;
  // Leave room above the highest branch end for its blob, so the tree tops out at 1.
  const crownTop = 1 - blobRadius * elongate * 0.8;
  // Out in the crown, as much as the leaves there; the fork moves with the trunk.
  const sway = (y: number): number => Math.min(1, y * 0.85);
  const fromFork = (y: number, j: number): number => (j === 0 ? y * y * 0.3 : sway(y));
  /** Each branch from a fork: its line, and the radius it starts with. */
  const limbs: { points: Point[]; r: number }[] = [];

  for (let s = 0; s < stems; s++) {
    const turn = shape.range(0, 6.28);
    const tilt = stems > 1 ? lean + shape.range(0, lean) : lean * shape.float();
    const wobble = [shape.range(0, 6.28), shape.range(0.7, 1.5)];
    const stemTop = split * (stems > 1 ? shape.range(0.8, 1.1) : 1);
    const at = (t: number): Point => {
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
      const end: Point = [bx + Math.cos(a) * reach, top, bz + Math.sin(a) * reach];
      const mid: Point = [bx + (end[0] - bx) * 0.6, by + (end[1] - by) * 0.45, bz + (end[2] - bz) * 0.6];
      limbs.push({ points: [[bx, by, bz], mid, end], r: (trunkRadius / Math.sqrt(stems)) * 0.55 + 0.002 });
    }
  }
  const ends = limbs.map((l) => l.points[l.points.length - 1]!);

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
  // When each blob loses its leaves: some go early, some hang on.
  const falls = centres.map(() => shape.range(0, 0.35));
  // Where the side branch to each blob off a main branch leaves it, and the twigs' ways.
  const forks = centres.map(() => shape.range(0.35, 0.75));
  const twigWays = centres.map(() => Array.from({ length: TWIGS }, () => [shape.range(0, 6.28), shape.range(-0.2, 0.9), shape.range(0.7, 1.2)] as const));

  // The main branches, pale at the fork and darker out towards the twigs.
  const twig = colors.twig;
  // In the middle distance they are straight, the side branches and twigs too thin to see.
  for (const l of limbs) {
    const points = full ? l.points : [l.points[0]!, l.points[l.points.length - 1]!];
    limb(mesh, points, l.r * Math.sqrt(thick), l.r * 0.35 * Math.sqrt(thick), colors.barkTop, mixRgb(colors.barkTop, twig, 0.6), full ? 4 : 3, fromFork);
  }

  // A side branch out to each blob not at a main branch's end, off the nearest main branch.
  if (full) {
    centres.forEach((c, k) => {
      if (k < ends.length) return;
      let best = limbs[0]!, bestD = Infinity;
      for (const l of limbs) {
        const e = l.points[l.points.length - 1]!;
        const d = Math.hypot(e[0] - c[0], e[1] - c[1], e[2] - c[2]);
        if (d < bestD) { bestD = d; best = l; }
      }
      const from = along(best.points, forks[k]!);
      const mid: Point = [from[0] + (c[0] - from[0]) * 0.5, from[1] + (c[1] - from[1]) * 0.65, from[2] + (c[2] - from[2]) * 0.5];
      limb(mesh, [from, mid, c], best.r * 0.5 * thick, best.r * 0.2 * thick, mixRgb(colors.barkTop, twig, 0.5), twig, 3, sway);
    });
    // Fine twigs spraying out from where each blob sits, to about its edge, hanging a little.
    centres.forEach((c, k) => {
      const r = blobSize[k]!;
      // Outward from the crown's middle, so the twigs fill the crown's outline.
      const ox = c[0] - cx, oz = c[2] - cz;
      const ol = Math.hypot(ox, oz) || 1;
      for (const [angle, rise, length] of twigWays[k]!) {
        const dx = Math.cos(angle) * 0.6 + (ox / ol) * 0.8, dz = Math.sin(angle) * 0.6 + (oz / ol) * 0.8;
        const dl = Math.hypot(dx, dz) || 1;
        const reach = r * length;
        const tip: Point = [c[0] + (dx / dl) * reach, c[1] + (rise * 0.6 - droop) * reach * elongate, c[2] + (dz / dl) * reach];
        tip[1] = Math.min(1, tip[1]);
        limb(mesh, [c, tip], 0.0035 * thick, 0.0015 * thick, twig, twig, 3, sway);
      }
    });
  }

  // The simplified tree keeps a few blobs, enlarged to fill the same outline: those on its
  // main branches' ends first, so they do not hang in the air as the leaves thin.
  const order = centres.map((_, k) => k).sort((a, b) => Number(b < ends.length) - Number(a < ends.length) || blobSize[b]! - blobSize[a]!);
  const kept = full ? order : order.slice(0, Math.max(2, Math.round(blobCount / 3)));
  for (const k of kept) {
    const [x, y, z] = centres[k]!;
    // Out of leaf the blob shrinks to nothing at its branch end.
    const inLeaf = smoothstep(falls[k]!, falls[k]! + 0.65, colors.leaves);
    const r = blobSize[k]! * (full ? 1 : 1.25) * inLeaf;
    const start = mesh.vertexCount;
    ICO.vertices.forEach(([vx, vy, vz], v) => {
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
    for (const [a, b, c] of ICO.faces) mesh.triangle(start + a, start + b, start + c);
  }
  return mesh.build();
};
