import type { ObjectDef, PlacedObject } from '@spar/shared';
import { objectRng, param, pick, shade, type FeatureMesh, type GroundFn } from '../mesh';

/**
 * Timber stacked at the roadside, waiting for the truck: sections of logs laid along the
 * road, each a triangular-ish stack, with pale cut ends towards the passer-by.
 */
export function logPile(o: PlacedObject, def: ObjectDef, seed: number, ground: GroundFn, out: FeatureMesh): void {
  const rng = objectRng(o.id, seed);
  const heading = (o.heading * Math.PI) / 180;
  // Heading 0 is north (-z), 90 east (+x).
  const dx = Math.sin(heading), dz = -Math.cos(heading);
  const ax = -dz, az = dx;
  const sections = Math.round(param(def, 'sections', 4, rng));
  const logLength = param(def, 'logLength', 4.8, rng);
  const rows = Math.round(param(def, 'rows', 6, rng));
  const radius = param(def, 'radius', 0.14, rng);
  const pitch = logLength + 0.4;
  let low = Infinity;
  for (let s = 0; s < sections; s++) {
    for (const end of [-0.5, 0.5]) {
      const along = (s - (sections - 1) / 2) * pitch + end * logLength;
      low = Math.min(low, ground(o.x + dx * along, o.z + dz * along));
    }
  }
  const base = low - 0.05;
  let tallest = 0;
  for (let s = 0; s < sections; s++) {
    const centre = (s - (sections - 1) / 2) * pitch;
    const sectionRows = Math.max(2, rows - Math.floor(rng.float() * 2));
    for (let r = 0; r < sectionRows; r++) {
      const count = sectionRows + 2 - r;
      for (let i = 0; i < count; i++) {
        const rr = radius * rng.range(0.75, 1.2);
        const across = (i - (count - 1) / 2) * radius * 2.05 + (rng.float() - 0.5) * 0.04;
        const y = base + radius + r * radius * 1.78;
        tallest = Math.max(tallest, y + rr - base);
        const shift = (rng.float() - 0.5) * 0.35;
        const half = (logLength / 2) * rng.range(0.94, 1.02);
        const bark = shade(pick(def, 'bark', rng), rng.range(0.85, 1.1));
        const cut = pick(def, 'cut', rng);
        out.rod(
          [o.x + dx * (centre + shift - half) + ax * across, y, o.z + dz * (centre + shift - half) + az * across],
          [o.x + dx * (centre + shift + half) + ax * across, y, o.z + dz * (centre + shift + half) + az * across],
          rr,
          7,
          bark,
          cut,
        );
      }
    }
  }
  const width = (rows + 2) * radius * 2.05;
  out.solids.push({
    key: `o${o.id}`,
    x: o.x,
    y: base + tallest / 2,
    z: o.z,
    hx: (sections * pitch) / 2,
    hy: tallest / 2,
    hz: width / 2,
    yaw: Math.PI / 2 - heading,
  });
}
