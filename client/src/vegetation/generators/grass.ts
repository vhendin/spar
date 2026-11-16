import { createRng } from '@spar/shared';
import { MeshBuilder, mixRgb, num, scaleRgb, type Generator } from './mesh';

/**
 * Tufts of blades: meadow grass, sedge tussocks and reeds. `splay` is how far the blade
 * tips lean out, as a multiple of the height; `mound` raises a tussock under the blades;
 * `heads` puts a seed head on each blade tip.
 */
export const grass: Generator = (params, colors, seed) => {
  const rng = createRng(seed);
  const blades = Math.round(num(params, 'blades', 9, rng));
  const bladeWidth = num(params, 'bladeWidth', 0.08, rng);
  const splay = num(params, 'splay', 0.7, rng);
  const mound = num(params, 'mound', 0, rng);
  const heads = params.heads === true;
  const mesh = new MeshBuilder();
  const dark = scaleRgb(colors.foliage, 0.8);

  if (mound > 0) {
    // The tussock: a low cone of old growth that the blades stand on.
    const start = mesh.vertexCount;
    const tip = mesh.vertex(0, mound, 0, scaleRgb(mixRgb(colors.foliage, colors.accent, 0.5), 0.7), 0, 0, 1, 0);
    const sides = 6;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      mesh.vertex(Math.cos(a) * mound * 0.9, 0, Math.sin(a) * mound * 0.9, dark, 0, Math.cos(a) * 0.5, 0.85, Math.sin(a) * 0.5);
    }
    for (let k = 0; k < sides; k++) mesh.triangle(tip, start + 1 + ((k + 1) % sides), start + 1 + k);
  }

  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rng.range(0, 0.7);
    const out = [Math.cos(a), Math.sin(a)];
    const side = [-out[1]!, out[0]!];
    const height = rng.range(0.6, 1);
    const reach = splay * height * rng.range(0.4, 1);
    const foot = mound * 0.5 * rng.float();
    const w = bladeWidth * rng.range(0.7, 1.2);
    const tone = rng.range(0.85, 1.15);
    const tipColor = scaleRgb(mixRgb(colors.foliage, colors.accent, heads ? 0.2 : 0.5), tone);
    // Blades are lit as if facing up, so a tuft reads as soft ground cover from any side.
    const v = (along: number, across: number, h: number, color: [number, number, number], sway: number): number =>
      mesh.vertex(out[0]! * (foot + along) + side[0]! * across, mound * 0.7 + h, out[1]! * (foot + along) + side[1]! * across, color, sway, out[0]! * 0.25, 0.95, out[1]! * 0.25);
    const base = mound * 0.7;
    const top = (1 - base) * height;
    const a0 = v(0, -w / 2, 0, scaleRgb(dark, tone), 0);
    const a1 = v(0, w / 2, 0, scaleRgb(dark, tone), 0);
    const m0 = v(reach * 0.35, -w * 0.4, top * 0.55, scaleRgb(colors.foliage, tone), 0.45);
    const m1 = v(reach * 0.35, w * 0.4, top * 0.55, scaleRgb(colors.foliage, tone), 0.45);
    const tip = v(reach, 0, top, tipColor, 1);
    mesh.quad(a0, a1, m1, m0);
    mesh.triangle(m0, m1, tip);
    if (heads) {
      // A seed head: a small diamond standing on the blade's tip.
      const head = scaleRgb(colors.accent, tone);
      const h0 = v(reach, -w * 1.6, top * 0.93, head, 1);
      const h1 = v(reach, w * 1.6, top * 0.93, head, 1);
      const h2 = v(reach * 1.05, 0, top * 1.12, head, 1);
      const h3 = v(reach * 0.95, 0, top * 0.8, head, 1);
      mesh.triangle(h0, h1, h2);
      mesh.triangle(h1, h0, h3);
    }
  }
  return mesh.build();
};
