// Shared pieces for the man-made object generators. Unlike plants, which are built once
// at unit size and instanced, every building and fence is different, so generators write
// straight into one mesh per tile in world coordinates.

import { createRng, type ObjectDef, type Rng } from '@spar/shared';
import { hexColor, type Rgb } from '../vegetation/generators/mesh';

export type { Rgb };
export type Vec3 = [number, number, number];

/**
 * A box vehicles can hit: centre, half sizes along its own axes, and its turn about the
 * vertical (three.js convention: the box's x axis points along (cos yaw, 0, -sin yaw)).
 */
export interface Solid {
  /** Permanent name, usable as a winch anchor later. */
  key: string;
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}

/** Ground height in metres at a local position. */
export type GroundFn = (x: number, z: number) => number;

/** Everything one tile's objects add up to. */
export class FeatureMesh {
  private p: number[] = [];
  private n: number[] = [];
  private c: number[] = [];
  private i: number[] = [];
  /** Wires: pairs of points drawn as thin lines. */
  readonly lines: number[] = [];
  readonly solids: Solid[] = [];

  get vertexCount(): number {
    return this.p.length / 3;
  }

  get triangleCount(): number {
    return this.i.length / 3;
  }

  vertex(x: number, y: number, z: number, color: Rgb, nx: number, ny: number, nz: number): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(color[0], color[1], color[2]);
    return this.p.length / 3 - 1;
  }

  /** A flat polygon (3 or more corners, counter-clockwise seen from the front), shaded as one face. */
  face(corners: Vec3[], color: Rgb): void {
    const [a, b, c] = corners as [Vec3, Vec3, Vec3];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const first = this.vertexCount;
    for (const p of corners) this.vertex(p[0], p[1], p[2], color, nx, ny, nz);
    for (let k = 1; k < corners.length - 1; k++) this.i.push(first, first + k, first + k + 1);
  }

  /**
   * A box on its own axes: `centre`, half sizes, turned by `yaw` about the vertical. Its
   * bottom face is left out unless `bottom` is set, since most boxes stand on the ground.
   */
  box(centre: Vec3, hx: number, hy: number, hz: number, yaw: number, color: Rgb, bottom = false, top: Rgb = color): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (x: number, y: number, z: number): Vec3 => [centre[0] + x * c + z * s, centre[1] + y, centre[2] - x * s + z * c];
    const p = [
      at(-hx, -hy, -hz), at(hx, -hy, -hz), at(hx, -hy, hz), at(-hx, -hy, hz),
      at(-hx, hy, -hz), at(hx, hy, -hz), at(hx, hy, hz), at(-hx, hy, hz),
    ] as const;
    this.face([p[4], p[7], p[6], p[5]], top);
    this.face([p[0], p[4], p[5], p[1]], color);
    this.face([p[1], p[5], p[6], p[2]], color);
    this.face([p[2], p[6], p[7], p[3]], color);
    this.face([p[3], p[7], p[4], p[0]], color);
    if (bottom) this.face([p[0], p[1], p[2], p[3]], color);
  }

  /** A round rod from a to b with `sides` faces, smooth-shaded, and optionally capped ends. */
  rod(a: Vec3, b: Vec3, radius: number, sides: number, color: Rgb, caps: Rgb | null = null): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const d: Vec3 = [dx / len, dy / len, dz / len];
    // Two directions across the rod.
    const helper: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u: Vec3 = [d[1] * helper[2] - d[2] * helper[1], d[2] * helper[0] - d[0] * helper[2], d[0] * helper[1] - d[1] * helper[0]];
    const ul = Math.hypot(...u);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const first = this.vertexCount;
    for (const end of [a, b]) {
      for (let k = 0; k < sides; k++) {
        const t = (k / sides) * Math.PI * 2;
        const cx = Math.cos(t), sx = Math.sin(t);
        const nx = u[0] * cx + v[0] * sx, ny = u[1] * cx + v[1] * sx, nz = u[2] * cx + v[2] * sx;
        this.vertex(end[0] + nx * radius, end[1] + ny * radius, end[2] + nz * radius, color, nx, ny, nz);
      }
    }
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      this.i.push(first + k, first + k1, first + sides + k1, first + k, first + sides + k1, first + sides + k);
    }
    if (caps) {
      for (const [end, sign] of [[a, -1], [b, 1]] as const) {
        const ring: Vec3[] = [];
        for (let k = 0; k < sides; k++) {
          const t = ((sign > 0 ? k : sides - k) / sides) * Math.PI * 2;
          const cx = Math.cos(t), sx = Math.sin(t);
          ring.push([end[0] + (u[0] * cx + v[0] * sx) * radius, end[1] + (u[1] * cx + v[1] * sx) * radius, end[2] + (u[2] * cx + v[2] * sx) * radius]);
        }
        this.face(ring, caps);
      }
    }
  }

  line(a: Vec3, b: Vec3): void {
    this.lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }

  build(): { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array; lines: Float32Array } {
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      colors: new Float32Array(this.c),
      indices: new Uint32Array(this.i),
      lines: new Float32Array(this.lines),
    };
  }
}

/** Repeatable random numbers for one object, from its permanent id. */
export function objectRng(id: string, seed: number): Rng {
  let h = 2166136261 ^ seed;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return createRng(h >>> 0);
}

/** A number parameter; a [min, max] pair is drawn from the object's random stream. */
export function param(def: ObjectDef, key: string, fallback: number, rng: Rng): number {
  const v = def.params[key];
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length === 2) return rng.range(v[0]!, v[1]!);
  return fallback;
}

/** One colour from a named palette, as linear RGB. */
export function pick(def: ObjectDef, palette: string, rng: Rng): Rgb {
  const list = def.colors[palette];
  if (!list || list.length === 0) return [1, 0, 1];
  return hexColor(list[Math.min(list.length - 1, Math.floor(rng.float() * list.length))]!);
}

export const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
