import { createRng, hash32 } from '@spar/shared';
import { MeshBuilder, mixRgb, num, scaleRgb, type Generator } from './mesh';

/**
 * Spruce, pine and their kin: a straight or crooked trunk carrying whorls of branches,
 * drawn as stacked skirts. `dome` 0 gives a spire widest at the bottom, 1 a rounded crown
 * widest in the middle; `droop` hangs the skirt rims down; `crownBase` is the bare trunk.
 */
export const conifer: Generator = (params, colors, seed, detail) => {
  // Shape first, from one stream, so both detail levels describe the same tree.
  const shape = createRng(seed);
  const crownBase = num(params, 'crownBase', 0.15, shape);
  const crownWidth = num(params, 'crownWidth', 0.18, shape);
  const tiers = Math.round(num(params, 'tiers', 10, shape));
  const droop = num(params, 'droop', 0.4, shape);
  const dome = num(params, 'dome', 0, shape);
  const irregular = num(params, 'irregular', 0.2, shape);
  const trunkRadius = num(params, 'trunkRadius', 0.016, shape);
  const crook = num(params, 'crook', 0, shape);
  const phase = [shape.range(0, 6.28), shape.range(0, 6.28), shape.range(0.8, 1.6), shape.range(0.8, 1.6)];
  const tierScale: number[] = [];
  const tierTurn: number[] = [];
  for (let i = 0; i < tiers; i++) {
    tierScale.push(1 + irregular * (shape.float() - 0.5) * 2);
    tierTurn.push(shape.range(0, 6.28));
  }

  /** Trunk centre at height t (0..1): a crooked trunk wanders more the higher it gets. */
  const centre = (t: number): [number, number] => [
    crook * t * Math.sin(phase[0]! + t * Math.PI * 2 * phase[2]!),
    crook * t * Math.sin(phase[1]! + t * Math.PI * 2 * phase[3]!),
  ];
  /** Crown radius at u (0 bottom of crown, 1 top). */
  const radiusAt = (u: number): number => {
    const spire = 0.06 + 0.94 * (1 - u);
    const round = 0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.88));
    return crownWidth * (spire + (round - spire) * dome);
  };

  const mesh = new MeshBuilder();
  const full = detail === 'full';

  const trunkRings = full ? 6 : 2;
  const rings = [];
  for (let j = 0; j < trunkRings; j++) {
    const t = (j / (trunkRings - 1)) * 0.97;
    const [x, z] = centre(t);
    rings.push({ x, y: t, z, r: trunkRadius * (1 - 0.88 * t) + 0.002, color: mixRgb(colors.bark, colors.barkTop, Math.min(1, t / Math.max(0.2, crownBase))), sway: t * t * 0.35 });
  }
  mesh.tube(rings, full ? 6 : 3, true);

  // Skirts. The simplified tree merges neighbouring whorls into fewer, deeper skirts.
  const detailRng = createRng(hash32(seed, full ? 1 : 2));
  const step = full ? 1 : Math.max(2, Math.round(tiers / 4));
  const segments = full ? 9 : 5;
  const spacing = (1 - crownBase) / tiers;
  for (let i = 0; i < tiers; i += step) {
    const u = (i + (step - 1) / 2) / Math.max(1, tiers - 1);
    const y = crownBase + (1 - crownBase) * 0.96 * Math.min(1, u);
    // A merged skirt is as wide as the widest whorl it replaces.
    let radius = 0;
    for (let m = i; m < Math.min(tiers, i + step); m++) radius = Math.max(radius, radiusAt(m / Math.max(1, tiers - 1)) * tierScale[m]!);
    const depth = spacing * step * 1.5;
    const [cx, cz] = centre(Math.min(0.97, y));
    const shade = 0.72 + 0.3 * u;
    const inner = scaleRgb(colors.foliage, shade * 0.8);
    const outer = scaleRgb(mixRgb(colors.foliage, colors.accent, 0.35), shade);
    const start = mesh.vertexCount;

    const apex = mesh.vertex(cx, y + depth * 0.6, cz, inner, y * 0.5, 0, 1, 0);
    const ringCount = full ? 2 : 1;
    for (let ring = 1; ring <= ringCount; ring++) {
      const f = ring / ringCount;
      for (let k = 0; k < segments; k++) {
        const a = tierTurn[i]! + (k / segments) * Math.PI * 2;
        const r = radius * f * (ring === ringCount ? 0.78 + 0.44 * detailRng.float() : 1);
        // The rim hangs below the branch's root; the middle sags half as much.
        const sag = droop * radius * f * f + (ring === ringCount ? depth * 0.25 * detailRng.float() : 0);
        mesh.vertex(cx + Math.cos(a) * r, y + depth * 0.6 * (1 - f) - sag, cz + Math.sin(a) * r, f < 1 ? mixRgb(inner, outer, f) : outer, y * (0.5 + 0.5 * f));
      }
    }
    for (let k = 0; k < segments; k++) {
      const a = start + 1 + k;
      const b = start + 1 + ((k + 1) % segments);
      mesh.triangle(apex, b, a);
      if (full) mesh.quad(a, b, b + segments, a + segments);
    }
    // Lit from above and outside whatever the skirt's exact folds, like needle mass.
    mesh.smoothNormals(start, mesh.vertexCount, [cx, y - radius, cz]);
  }
  return mesh.build();
};
