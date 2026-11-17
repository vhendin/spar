import type { ObjectDef } from '@spar/shared';
import { objectRng, param, pick, shade, type FeatureMesh, type GroundFn, type Vec3 } from '../mesh';

/** Points every `spacing` metres along a line, with the direction of travel there. */
export function alongLine(points: number[][], spacing: number): { x: number; z: number; dx: number; dz: number }[] {
  const out: { x: number; z: number; dx: number; dz: number }[] = [];
  let carry = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!, b = points[k + 1]!;
    const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
    if (len < 1e-6) continue;
    const dx = (b[0]! - a[0]!) / len, dz = (b[1]! - a[1]!) / len;
    let d = carry;
    for (; d <= len; d += spacing) out.push({ x: a[0]! + dx * d, z: a[1]! + dz * d, dx, dz });
    carry = d - len;
  }
  const last = points[points.length - 1]!, before = out[out.length - 1];
  if (before && Math.hypot(last[0]! - before.x, last[1]! - before.z) > spacing * 0.4) out.push({ x: last[0]!, z: last[1]!, dx: before.dx, dz: before.dz });
  return out;
}

/** Colliders along a fence: one box every few posts. */
function fenceSolids(id: string, posts: { x: number; z: number }[], ground: GroundFn, height: number, half: number, out: FeatureMesh): void {
  const every = Math.max(1, Math.round(6 / Math.max(0.5, Math.hypot(posts[1] ? posts[1].x - posts[0]!.x : 1, posts[1] ? posts[1].z - posts[0]!.z : 0))));
  for (let k = 0; k + 1 < posts.length; k += every) {
    const a = posts[k]!, b = posts[Math.min(posts.length - 1, k + every)]!;
    const ya = ground(a.x, a.z), yb = ground(b.x, b.z);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.2) continue;
    out.solids.push({
      key: `f${id}:${k}`,
      x: (a.x + b.x) / 2,
      y: (ya + yb) / 2 + height / 2,
      z: (a.z + b.z) / 2,
      hx: len / 2,
      hy: height / 2 + Math.abs(ya - yb) / 2,
      hz: half,
      yaw: -Math.atan2(b.z - a.z, b.x - a.x),
    });
  }
}

/**
 * A fence or wall along a line. `roundpole` is the Jämtland gärdesgård: pairs of upright
 * stakes with slanting poles laid between them; `wire` is posts with strands of wire;
 * `stone` is a low wall of piled stones.
 */
export function fence(id: string, points: number[][], def: ObjectDef, seed: number, ground: GroundFn, out: FeatureMesh): void {
  const rng = objectRng(id, seed);
  const style = typeof def.params.style === 'string' ? def.params.style : 'wire';
  const spacing = param(def, 'spacing', 2, rng);
  const height = param(def, 'height', 1.2, rng);
  const posts = alongLine(points, spacing);
  if (posts.length < 2) return;

  if (style === 'roundpole') {
    const rails = Math.round(param(def, 'rails', 4, rng));
    const lean = (param(def, 'lean', 32, rng) * Math.PI) / 180;
    const reach = height / Math.tan(lean);
    const band = pick(def, 'band', rng);
    for (const [k, p] of posts.entries()) {
      const y = ground(p.x, p.z);
      const ax = -p.dz, az = p.dx;
      const wood = pick(def, 'wood', rng);
      for (const side of [1, -1]) {
        out.rod([p.x + ax * side * 0.13, y - 0.3, p.z + az * side * 0.13], [p.x + ax * side * 0.09, y + height + 0.25, p.z + az * side * 0.09], 0.04, 4, wood);
      }
      out.box([p.x, y + height * 0.55, p.z], 0.03, 0.04, 0.14, -Math.atan2(p.dz, p.dx), band);
      if (k + 1 >= posts.length) continue;
      // Slanting poles, laid one after another so they overlap like a row of fallen dominoes.
      for (let r = 0; r < rails; r++) {
        const t = (r + rng.float() * 0.3) / rails;
        const sx = p.x + p.dx * spacing * t, sz = p.z + p.dz * spacing * t;
        const ex = sx + p.dx * reach, ez = sz + p.dz * reach;
        const off = (rng.float() - 0.5) * 0.08;
        out.rod(
          [sx + ax * off, ground(sx, sz) + 0.05, sz + az * off],
          [ex + ax * off, ground(ex, ez) + height, ez + az * off],
          0.035,
          4,
          shade(pick(def, 'wood', rng), rng.range(0.85, 1.1)),
        );
      }
    }
    fenceSolids(id, posts, ground, height, 0.2, out);
    return;
  }

  if (style === 'stone') {
    const width = param(def, 'width', 0.9, rng);
    const lichen = pick(def, 'lichen', rng);
    for (let k = 0; k + 1 < posts.length; k++) {
      const a = posts[k]!, b = posts[k + 1]!;
      const ya = ground(a.x, a.z), yb = ground(b.x, b.z);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const h = height * rng.range(0.75, 1.1);
      const stone = shade(pick(def, 'stone', rng), rng.range(0.85, 1.15));
      const bottom = Math.min(ya, yb) - 0.15;
      const topY = (ya + yb) / 2 + h;
      const centre: Vec3 = [(a.x + b.x) / 2 + (rng.float() - 0.5) * 0.1, (bottom + topY) / 2, (a.z + b.z) / 2 + (rng.float() - 0.5) * 0.1];
      out.box(centre, len / 2 + 0.08, (topY - bottom) / 2, (width / 2) * rng.range(0.8, 1.05), -Math.atan2(b.z - a.z, b.x - a.x) + (rng.float() - 0.5) * 0.15, stone, false, lichen);
    }
    fenceSolids(id, posts, ground, height, width / 2, out);
    return;
  }

  // Wire: posts and strands.
  const strands = Math.round(param(def, 'wires', 3, rng));
  let prev: Vec3[] | null = null;
  for (const p of posts) {
    const y = ground(p.x, p.z);
    const wood = pick(def, 'wood', rng);
    const lean = (rng.float() - 0.5) * 0.08;
    out.rod([p.x, y - 0.4, p.z], [p.x - p.dz * lean, y + height, p.z + p.dx * lean], 0.055, 5, wood, wood);
    const here: Vec3[] = [];
    for (let w = 0; w < strands; w++) here.push([p.x, y + height * (0.3 + (0.62 * (w + 1)) / strands), p.z]);
    if (prev) for (let w = 0; w < strands; w++) out.line(prev[w]!, here[w]!);
    prev = here;
  }
  fenceSolids(id, posts, ground, height, 0.1, out);
}
