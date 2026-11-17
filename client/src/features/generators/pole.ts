import type { ObjectDef, PowerLine } from '@spar/shared';
import { objectRng, param, pick, type FeatureMesh, type GroundFn, type Vec3 } from '../mesh';

interface Pole {
  x: number;
  y: number;
  z: number;
  height: number;
  /** Unit direction across the line, in x and z. */
  ax: number;
  az: number;
  /** Where the wires hang from. */
  attach: Vec3[];
}

/** One pole of a line: where it stands, how tall it is and where its wires hang. Same answer for every tile asking. */
function poleAt(line: PowerLine, k: number, def: ObjectDef, seed: number, ground: GroundFn): Pole {
  const pts = line.points;
  const p = pts[k]!;
  const prev = pts[Math.max(0, k - 1)]!, next = pts[Math.min(pts.length - 1, k + 1)]!;
  let dx = next[0] - prev[0], dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  const rng = objectRng(`${line.id}:${k}`, seed);
  const height = param(def, 'height', 10, rng);
  const arm = param(def, 'arm', 2.2, rng);
  const wires = Math.round(param(def, 'wires', 3, rng));
  const y = ground(p[0], p[1]);
  const ax = -dz, az = dx;
  const attach: Vec3[] = [];
  for (let w = 0; w < wires; w++) {
    const off = wires === 1 ? 0 : (w / (wires - 1) - 0.5) * arm * 0.85;
    attach.push([p[0] + ax * off, y + height - 0.1, p[1] + az * off]);
  }
  return { x: p[0], y, z: p[1], height, ax, az, attach };
}

/**
 * The poles of a power line that `own` says belong to this tile, each with its cross-arm,
 * insulators and the wires to the next pole, sagging between them.
 */
export function powerLine(line: PowerLine, def: ObjectDef, seed: number, ground: GroundFn, own: (k: number) => boolean, out: FeatureMesh): void {
  const radius = param(def, 'radius', 0.13, objectRng(line.id, seed));
  const sag = param(def, 'sag', 0.00045, objectRng(line.id, seed));
  for (let k = 0; k < line.points.length; k++) {
    if (!own(k)) continue;
    const pole = poleAt(line, k, def, seed, ground);
    const rng = objectRng(`${line.id}:${k}:look`, seed);
    const wood = pick(def, 'wood', rng);
    out.rod([pole.x, pole.y - 0.6, pole.z], [pole.x, pole.y + pole.height, pole.z], radius, 6, wood, wood);
    const armY = pole.height - 0.35 + pole.y;
    const half = Math.hypot(pole.attach[0]![0] - pole.x, pole.attach[0]![2] - pole.z) + 0.25;
    out.box([pole.x, armY, pole.z], 0.06, 0.05, half, Math.atan2(pole.ax, pole.az), pick(def, 'steel', rng), true);
    const insulator = pick(def, 'insulator', rng);
    for (const a of pole.attach) out.rod([a[0], armY + 0.05, a[2]], [a[0], a[1] + 0.05, a[2]], 0.045, 5, insulator, insulator);
    out.solids.push({ key: `p${line.id}:${k}`, x: pole.x, y: pole.y + pole.height / 2, z: pole.z, hx: 0.2, hy: pole.height / 2, hz: 0.2, yaw: 0 });

    if (k + 1 >= line.points.length) continue;
    const to = poleAt(line, k + 1, def, seed, ground);
    for (let w = 0; w < pole.attach.length && w < to.attach.length; w++) {
      const a = pole.attach[w]!, b = to.attach[w]!;
      const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const drop = Math.min(3, span * span * sag);
      const pieces = Math.max(2, Math.min(12, Math.round(span / 6)));
      let last: Vec3 = a;
      for (let n = 1; n <= pieces; n++) {
        const t = n / pieces;
        const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * drop * t * (1 - t), a[2] + (b[2] - a[2]) * t];
        out.line(last, p);
        last = p;
      }
    }
  }
}
