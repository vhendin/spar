// Shared pieces for the procedural generators: a mesh builder, parameter reading and colours.

import type { Rng } from '@spar/shared';

export type Rgb = [number, number, number];
export type ParamValue = number | boolean | string | number[];
export type Params = Record<string, ParamValue>;
/** full = seen close up; low = a few dozen triangles for the middle distance. */
export type Detail = 'full' | 'low';

export interface GeneratorColors {
  bark: Rgb;
  barkTop: Rgb;
  foliage: Rgb;
  accent: Rgb;
}

/** A unit-sized mesh: the base sits at y = 0 and the top near y = 1. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB per vertex. */
  colors: Float32Array;
  /** How much each vertex moves in the wind, 0 to 1. */
  sway: Float32Array;
  indices: Uint16Array;
}

/**
 * A generator builds one individual. The same seed must give the same individual at both
 * detail levels, so the simplified mesh stands in for the full one without a visible jump.
 */
export type Generator = (params: Params, colors: GeneratorColors, seed: number, detail: Detail) => MeshData;

/** sRGB "#rrggbb" to linear RGB. */
export function hexColor(hex: string): Rgb {
  const channel = (at: number): number => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

/** A number parameter; a [min, max] pair is drawn from the random stream. */
export function num(params: Params, key: string, fallback: number, rng: Rng): number {
  const v = params[key];
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length === 2) return rng.range(v[0]!, v[1]!);
  return fallback;
}

export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleRgb = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

export class MeshBuilder {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly c: number[] = [];
  private readonly s: number[] = [];
  private readonly i: number[] = [];

  get vertexCount(): number {
    return this.s.length;
  }

  /** Adds a vertex and returns its number. The normal may be left zero and filled in by smoothNormals. */
  vertex(x: number, y: number, z: number, color: Rgb, sway: number, nx = 0, ny = 0, nz = 0): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(color[0], color[1], color[2]);
    this.s.push(sway);
    return this.s.length - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.i.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.i.push(a, b, c, a, c, d);
  }

  /**
   * Gives vertices from..to normals averaged from the triangles that use them. `outward`
   * flips any normal pointing towards that centre, for shapes whose winding is not uniform.
   */
  smoothNormals(from: number, to = this.vertexCount, outward?: [number, number, number]): void {
    const { p, n, i } = this;
    for (let v = from; v < to; v++) n[v * 3] = n[v * 3 + 1] = n[v * 3 + 2] = 0;
    for (let t = 0; t < i.length; t += 3) {
      const a = i[t]!, b = i[t + 1]!, c = i[t + 2]!;
      if (a < from || a >= to) continue;
      const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        n[v * 3]! += fx;
        n[v * 3 + 1]! += fy;
        n[v * 3 + 2]! += fz;
      }
    }
    for (let v = from; v < to; v++) {
      let x = n[v * 3]!, y = n[v * 3 + 1]!, z = n[v * 3 + 2]!;
      if (outward) {
        const dot = x * (p[v * 3]! - outward[0]) + y * (p[v * 3 + 1]! - outward[1]) + z * (p[v * 3 + 2]! - outward[2]);
        if (dot < 0) { x = -x; y = -y; z = -z; }
      }
      const len = Math.hypot(x, y, z) || 1;
      n[v * 3] = x / len;
      n[v * 3 + 1] = y / len;
      n[v * 3 + 2] = z / len;
    }
  }

  /**
   * A tube through the given centres with the given radii, `sides` around. Colours and sway
   * are given per ring. Returns nothing; normals point away from the centre line.
   */
  tube(rings: { x: number; y: number; z: number; r: number; color: Rgb; sway: number }[], sides: number, cap: boolean): void {
    const start = this.vertexCount;
    for (const ring of rings) {
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const cx = Math.cos(a), cz = Math.sin(a);
        this.vertex(ring.x + cx * ring.r, ring.y, ring.z + cz * ring.r, ring.color, ring.sway, cx, 0.15, cz);
      }
    }
    for (let j = 0; j < rings.length - 1; j++) {
      for (let k = 0; k < sides; k++) {
        const a = start + j * sides + k;
        const b = start + j * sides + ((k + 1) % sides);
        this.quad(a, a + sides, b + sides, b);
      }
    }
    if (cap) {
      const top = rings[rings.length - 1]!;
      const tip = this.vertex(top.x, top.y, top.z, top.color, top.sway, 0, 1, 0);
      const base = start + (rings.length - 1) * sides;
      for (let k = 0; k < sides; k++) this.triangle(base + k, tip, base + ((k + 1) % sides));
    }
  }

  build(): MeshData {
    if (this.vertexCount > 65535) throw new Error('generated mesh has too many vertices');
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      colors: new Float32Array(this.c),
      sway: new Float32Array(this.s),
      indices: new Uint16Array(this.i),
    };
  }
}

/** The 12 corners and 20 faces of an icosahedron on the unit sphere. */
export function icosahedron(): { vertices: [number, number, number][]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const len = Math.hypot(1, t);
  return {
    vertices: raw.map(([x, y, z]) => [x / len, y / len, z / len]),
    faces: [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ],
  };
}
