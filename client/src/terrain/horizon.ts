import * as THREE from 'three/webgpu';
import type { RegionIndex } from '@spar/shared';
import { fetchUint16, regionUrl } from './region';
import { terrainColor } from './shade';

/** How far the wall around the hole hangs down, in metres. */
const RIM_DEPTH = 80;

/**
 * Distant ground around the area: one coarse mesh with a square hole where the detailed
 * terrain is drawn. The importer gives both the same heights along the hole's edge.
 */
export async function loadHorizon(index: RegionIndex): Promise<THREE.Mesh> {
  const { samples: n, spacing, margin, encoding, path } = index.horizon;
  const grid = await fetchUint16(regionUrl(index.name, path), n * n);
  const height = (i: number, j: number): number => encoding.offset + grid[j * n + i]! * encoding.scale;

  const first = margin / spacing;
  const last = first + index.size / spacing; // cells first..last-1 lie inside the area
  const rimLength = last - first + 1;
  const total = n * n + 4 * rimLength;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
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
      terrainColor(y, inv, colors, o);
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
      for (let c = 0; c < 3; c++) {
        normals[d + c] = normals[s + c]!;
        colors[d + c] = colors[s + c]!;
      }
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
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.name = 'horizon';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
