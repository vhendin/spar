import { createRng } from '@spar/shared';
import { MeshBuilder, mixRgb, num, scaleRgb, type Generator } from './mesh';

/**
 * A tree stump left by felling: a short trunk flaring into roots at the foot, with a pale
 * saw cut on top, sometimes slanted. `radius` is the trunk radius as a share of the height.
 */
export const stump: Generator = (params, colors, seed, detail) => {
  const rng = createRng(seed);
  const radius = num(params, 'radius', 0.55, rng);
  const flare = num(params, 'flare', 1.5, rng);
  const slant = num(params, 'slant', 0.15, rng);
  const sides = detail === 'full' ? 9 : 5;
  const mesh = new MeshBuilder();
  const bark = colors.bark;
  const cut = colors.accent;
  const tilt = rng.range(-slant, slant);
  const tiltAngle = rng.range(0, Math.PI * 2);
  // Rings from the ground up: flared root collar, then the trunk.
  const rings = detail === 'full' ? [{ y: -0.15, r: flare }, { y: 0.05, r: 1.25 }, { y: 0.3, r: 1.03 }, { y: 1, r: 1 }] : [{ y: -0.1, r: flare }, { y: 1, r: 1 }];
  const lumps = Array.from({ length: sides }, () => rng.range(0.88, 1.12));
  const start = mesh.vertexCount;
  for (const ring of rings) {
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const r = radius * ring.r * lumps[k]!;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // The saw cut is a tilted plane: lift the top ring by its position along the tilt.
      const lift = ring.y === 1 ? tilt * (x * Math.cos(tiltAngle) + z * Math.sin(tiltAngle)) : 0;
      mesh.vertex(x, ring.y + lift, z, scaleRgb(bark, rng.range(0.85, 1.1) * (ring.y < 0.1 ? 0.75 : 1)), 0);
    }
  }
  for (let j = 0; j + 1 < rings.length; j++) {
    for (let k = 0; k < sides; k++) {
      const a = start + j * sides + k, b = start + j * sides + ((k + 1) % sides);
      mesh.quad(a, a + sides, b + sides, b);
    }
  }
  mesh.smoothNormals(start, mesh.vertexCount, [0, 0.4, 0]);

  // The cut face: pale wood, darker towards the bark rim.
  const capStart = mesh.vertexCount;
  const centre = mesh.vertex(0, 1, 0, scaleRgb(cut, 1.05), 0, 0, 1, 0);
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    const r = radius * lumps[k]! * 0.97;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const lift = tilt * (x * Math.cos(tiltAngle) + z * Math.sin(tiltAngle));
    mesh.vertex(x, 1 + lift, z, mixRgb(cut, bark, 0.35), 0, 0, 1, 0);
  }
  for (let k = 0; k < sides; k++) mesh.triangle(centre, capStart + 1 + ((k + 1) % sides), capStart + 1 + k);
  return mesh.build();
};
