import * as THREE from 'three/webgpu';
import type { RegionIndex } from '@spar/shared';
import type { GroundShading } from './groundMaterial';
import { fetchBytes, fetchUint16, regionUrl } from './region';

/** How far the wall around the hole hangs down, in metres. */
const RIM_DEPTH = 80;

/**
 * Distant ground around the area: one coarse mesh with a square hole where the detailed
 * terrain is drawn. The importer gives both the same heights along the hole's edge.
 */
export async function loadHorizon(index: RegionIndex, shading: GroundShading): Promise<THREE.Mesh> {
  const { samples: n, spacing, margin, encoding, path, biome } = index.horizon;
  const [grid, cover] = await Promise.all([
    fetchUint16(regionUrl(index.name, path), n * n),
    fetchBytes(regionUrl(index.name, biome.path), biome.samples * biome.samples),
  ]);

  // Land cover as the same kind of texture the detailed terrain uses. There is no canopy
  // or wetness out here, so forest gets a typical tree height to match the area's tone.
  const forest = index.masks.biomes.find((b) => b.name === 'forest')?.id;
  const canopyScale = index.masks.channels.find((c) => c.name === 'canopy')?.scale ?? 0.25;
  const texels = new Uint8Array(cover.length * 4);
  for (let i = 0; i < cover.length; i++) {
    texels[i * 4] = cover[i]!;
    texels[i * 4 + 3] = cover[i] === forest ? Math.round(12 / canopyScale) : 0;
  }
  const mask = new THREE.DataTexture(texels, biome.samples, biome.samples, THREE.RGBAFormat, THREE.UnsignedByteType);
  mask.needsUpdate = true;
  const extent = (n - 1) * spacing;
  const height = (i: number, j: number): number => encoding.offset + grid[j * n + i]! * encoding.scale;

  const first = margin / spacing;
  const last = first + index.size / spacing; // cells first..last-1 lie inside the area
  const rimLength = last - first + 1;
  const total = n * n + 4 * rimLength;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3;
      const y = height(i, j);
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(n - 1, j + 1);
      const dx = (height(i1, j) - height(i0, j)) / ((i1 - i0) * spacing);
      const dz = (height(i, j1) - height(i, j0)) / ((j1 - j0) * spacing);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      positions[o] = i * spacing - margin;
      positions[o + 1] = y;
      positions[o + 2] = j * spacing - margin;
      normals[o] = -dx * inv;
      normals[o + 1] = inv;
      normals[o + 2] = -dz * inv;
      uvs[(j * n + i) * 2] = (i * spacing) / extent;
      uvs[(j * n + i) * 2 + 1] = (j * spacing) / extent;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (i >= first && i < last && j >= first && j < last) continue;
      const a = j * n + i;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }

  // The hole's rim follows the detailed terrain only every `spacing` metres. Where the rim
  // rides higher in between, a wall hanging from it and facing the area closes the gap.
  let v = n * n;
  const wall = (top: (k: number) => number, flip: boolean): void => {
    const base = v;
    for (let k = 0; k < rimLength; k++) {
      const s = top(k) * 3;
      const d = v * 3;
      positions[d] = positions[s]!;
      positions[d + 1] = positions[s + 1]! - RIM_DEPTH;
      positions[d + 2] = positions[s + 2]!;
      for (let c = 0; c < 3; c++) normals[d + c] = normals[s + c]!;
      uvs[v * 2] = uvs[top(k) * 2]!;
      uvs[v * 2 + 1] = uvs[top(k) * 2 + 1]!;
      v++;
    }
    for (let k = 0; k < rimLength - 1; k++) {
      const t0 = top(k);
      const t1 = top(k + 1);
      const b0 = base + k;
      const b1 = base + k + 1;
      if (flip) indices.push(t0, b0, t1, t1, b0, b1);
      else indices.push(t0, t1, b0, t1, b1, b0);
    }
  };
  wall((k) => first * n + first + k, true); // north rim, facing south
  wall((k) => last * n + first + k, false); // south rim, facing north
  wall((k) => (first + k) * n + first, false); // west rim, facing east
  wall((k) => (first + k) * n + last, true); // east rim, facing west

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, shading.material(biome.samples, mask));
  mesh.name = 'horizon';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
