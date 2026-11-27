// The ground as the physics sees it: height colliders around the vehicle, and what kind
// of ground lies under each wheel.

import type RAPIER from '@dimforge/rapier3d-compat';
import { snowDepthAt, type GroundClasses, type RegionIndex, type SeasonCalendar } from '@spar/shared';
import groundDefs from '../../../defs/ground.json';
import seasonDefs from '../../../defs/seasons.json';
import { fetchBytes, fetchUint16, heightFileUrl, maskFileUrl } from '../terrain/region';
import { GROUP_GROUND, GROUP_OBSTACLE, groups, type GroundProbe } from './sim';

const GROUND = groundDefs as unknown as GroundClasses;
const CALENDAR = seasonDefs as SeasonCalendar;
/** Road coverage from which the snow counts as cleared: the plough takes the verges too. */
const CLEARED = 40;
/** Share of the snow left on roads, by surface: ploughed roads and village tracks; paths are not cleared. */
const PACKED: Record<string, number> = { asphalt: 0.1, gravel: 0.12, dirt: 0.15 };
/** Height files are turned into colliders this far ahead of the vehicle, and dropped this far behind. */
const LOAD_MARGIN = 90;
const KEEP_MARGIN = 260;
/** Road coverage (0..255) from which a wheel counts as being on the road or in the stream. */
const ON_SURFACE = 110;
/** Lakes are searched this many mask samples out for their shore; further in counts as deepest. */
const SHORE_SEARCH = 14;
/** Water depths remembered per mask sample, so the shore search runs once per spot. */
const DEPTH_CACHE = 4096;
/** Holes broken through the ice that are remembered (and drawn); older ones freeze over. */
const MAX_HOLES = 8;
/** Radius of the hole a vehicle breaks, metres. */
const HOLE_RADIUS = 3.5;
/** Ground a stake can be dug into; rock only under this much snow, metres. */
const HOLDS = new Set(['dirt', 'grass', 'gravel', 'sand', 'bog', 'snow']);
const SNOW_HOLD = 0.4;
/** Sand this wet (rain, or ground where water gathers, 0..1) lets a stake plough. */
const WET_SAND = 0.4;

/** How far a spot `distance` metres from the nearest stream is from the ice's full thickness: 0..1. */
export function iceShare(distance: number): number {
  const { mouth, reach } = GROUND.ice;
  const t = Math.min(1, Math.max(0, distance / (2 * reach)));
  return mouth + (1 - mouth) * t * t * (3 - 2 * t);
}

export interface IceHole {
  x: number;
  z: number;
  radius: number;
}

interface HeightTile {
  collider: RAPIER.Collider | null;
  heights: Float32Array | null;
  x: number;
  z: number;
}

export class GroundStore implements GroundProbe {
  /** 0 dry to 1 soaked; the weather sets this in a later step. */
  rain = 0;
  /** Thickness of lake ice away from streams this time of year, metres (see seasonAt). */
  ice = 0;
  /** Depth of lying snow at the season calendar's reference height, metres (see seasonAt). */
  snow = 0;
  /** Where vehicles have broken through the ice, newest last. */
  readonly holes: IceHole[] = [];
  /** Told of every hole our vehicle breaks, to pass on to the others. */
  onBreak: ((x: number, z: number) => void) | null = null;

  private readonly level: RegionIndex['heights']['levels'][number];
  private readonly maskLevel: RegionIndex['masks']['levels'][number];
  private readonly tiles = new Map<string, HeightTile>();
  private readonly masks = new Map<string, Uint8Array | null>();
  private readonly biomeGround: string[] = [];
  private readonly surfaceGround: (string | undefined)[] = [];
  private readonly surfaceName: string[] = [];
  private readonly planes: { biome: number; surface: number; road: number; wetness: number };
  private readonly depths = new Map<number, number>();
  private readonly streamDistances = new Map<number, number>();

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    private readonly index: RegionIndex,
  ) {
    this.level = index.heights.levels[0]!;
    this.maskLevel = index.masks.levels[0]!;
    // Mask files hold ids; the definitions say by name what each class is to drive on.
    for (const c of index.masks.biomes) this.biomeGround[c.id] = GROUND.biomes.find((b) => b.name === c.name)?.ground ?? 'dirt';
    for (const c of index.masks.surfaces) {
      this.surfaceGround[c.id] = GROUND.surfaces.find((s) => s.name === c.name)?.ground;
      this.surfaceName[c.id] = c.name;
    }
    const plane = (name: string): number => index.masks.channels.findIndex((c) => c.name === name);
    this.planes = { biome: plane('biome'), surface: plane('surface'), road: plane('road'), wetness: plane('wetness') };

    // Walls around the area, so nothing drives off the edge of the world.
    const half = index.size / 2;
    const mid = (index.heights.min + index.heights.max) / 2;
    const tall = (index.heights.max - index.heights.min) / 2 + 200;
    for (const [x, z, sx, sz] of [[half, -1, half, 1], [half, index.size + 1, half, 1], [-1, half, 1, half], [index.size + 1, half, 1, half]] as const) {
      world.createCollider(R.ColliderDesc.cuboid(sx, tall, sz).setTranslation(x, mid, z).setCollisionGroups(groups(GROUP_OBSTACLE, 0xffff)));
    }
  }

  wetness(): number {
    return this.rain;
  }

  /**
   * Keeps colliders and mask data loaded around a position, and around `more` (other vehicles
   * this browser runs). Returns true when the ground right under each is solid, so the caller
   * knows it is safe to let physics run.
   */
  update(x: number, z: number, more: readonly { x: number; z: number }[] = []): boolean {
    const points = [{ x, z }, ...more];
    const span = this.level.span;
    const last = this.level.count - 1;
    const range = (v: number): [number, number] => [Math.max(0, Math.floor((v - LOAD_MARGIN) / span)), Math.min(last, Math.floor((v + LOAD_MARGIN) / span))];
    for (const p of points) {
      const [x0, x1] = range(p.x);
      const [z0, z1] = range(p.z);
      for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) if (!this.tiles.has(`${tx},${tz}`)) this.loadHeights(tx, tz);
    }
    for (const [key, tile] of this.tiles) {
      const far = points.every((p) => {
        const dx = Math.max(tile.x * span - p.x, 0, p.x - (tile.x + 1) * span);
        const dz = Math.max(tile.z * span - p.z, 0, p.z - (tile.z + 1) * span);
        return Math.max(dx, dz) > KEEP_MARGIN;
      });
      if (tile.collider && far) {
        this.world.removeCollider(tile.collider, false);
        this.tiles.delete(key);
      }
    }

    const mspan = this.maskLevel.span;
    const mlast = this.maskLevel.count - 1;
    for (const p of points) {
      for (let mz = Math.max(0, Math.floor((p.z - 40) / mspan)); mz <= Math.min(mlast, Math.floor((p.z + 40) / mspan)); mz++) {
        for (let mx = Math.max(0, Math.floor((p.x - 40) / mspan)); mx <= Math.min(mlast, Math.floor((p.x + 40) / mspan)); mx++) {
          if (!this.masks.has(`${mx},${mz}`)) this.loadMask(mx, mz);
        }
      }
    }
    if (this.masks.size > 12 + 4 * more.length) {
      for (const key of this.masks.keys()) {
        const [mx, mz] = key.split(',').map(Number) as [number, number];
        const far = points.every((p) => Math.abs((mx + 0.5) * mspan - p.x) > mspan * 2 || Math.abs((mz + 0.5) * mspan - p.z) > mspan * 2);
        if (far) this.masks.delete(key);
      }
    }

    const solid = (p: { x: number; z: number }): boolean =>
      this.tiles.get(`${Math.min(last, Math.max(0, Math.floor(p.x / span)))},${Math.min(last, Math.max(0, Math.floor(p.z / span)))}`)?.collider != null;
    return points.every(solid);
  }

  /** Ground height in metres from the finest data, or null where it is not loaded. */
  heightAt(x: number, z: number): number | null {
    const { span, spacing, count } = this.level;
    const tx = Math.min(count - 1, Math.max(0, Math.floor(x / span)));
    const tz = Math.min(count - 1, Math.max(0, Math.floor(z / span)));
    const heights = this.tiles.get(`${tx},${tz}`)?.heights;
    if (!heights) return null;
    const n = this.index.heights.samples;
    const u = Math.min(n - 1.001, Math.max(0, (x - tx * span) / spacing));
    const v = Math.min(n - 1.001, Math.max(0, (z - tz * span) / spacing));
    const i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    // Stored column by column: index = column * n + row.
    const a = heights[i * n + j]!, b = heights[(i + 1) * n + j]!, c = heights[i * n + j + 1]!, d = heights[(i + 1) * n + j + 1]!;
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  groundAt(x: number, z: number): string {
    const s = this.sample(x, z);
    if (!s) return 'dirt';
    const { mask, at, plane } = s;
    if (mask[this.planes.road * plane + at]! >= ON_SURFACE) {
      const surface = this.surfaceGround[mask[this.planes.surface * plane + at]!];
      if (surface) return surface;
    }
    return this.biomeGround[mask[this.planes.biome * plane + at]!] ?? 'dirt';
  }

  /**
   * Whether a ground anchor can be dug in here, and how it holds: firm in soil, soft (it ploughs
   * under a hard pull) in bog, wet sand and snow lying on rock; null on rock, asphalt and water.
   */
  holdAt(x: number, z: number): { y: number; soft: boolean } | null {
    const y = this.heightAt(x, z);
    const s = this.sample(x, z);
    if (y === null || !s || this.waterDepth(x, z) > 0) return null;
    const ground = this.groundAt(x, z);
    if (ground === 'rock') return this.snowAt(x, z) >= SNOW_HOLD ? { y, soft: true } : null;
    if (!HOLDS.has(ground)) return null;
    const soaked = this.planes.wetness >= 0 ? s.mask[this.planes.wetness * s.plane + s.at]! / 255 : 0;
    return { y, soft: ground === 'bog' || (ground === 'sand' && Math.max(this.rain, soaked) >= WET_SAND) };
  }

  softness(x: number, z: number): number {
    const ground = this.groundAt(x, z);
    const soft = GROUND.softness[ground];
    if (!soft) return 0;
    const wet = soft.dry + (soft.wet - soft.dry) * Math.min(1, Math.max(0, this.rain));
    // Low ground where water gathers stays soft longer than a dry ridge.
    const s = this.sample(x, z);
    const soaked = s && this.planes.wetness >= 0 ? s.mask[this.planes.wetness * s.plane + s.at]! / 255 : 0;
    return Math.min(1, wet + Math.max(0, soft.wet - wet) * soaked * 0.6);
  }

  waterDepth(x: number, z: number): number {
    const s = this.sample(x, z);
    if (!s) return 0;
    const { mask, at, plane } = s;
    if (mask[this.planes.road * plane + at]! >= ON_SURFACE) {
      const name = this.surfaceName[mask[this.planes.surface * plane + at]!];
      if (name === 'stream') return GROUND.water.stream;
      if (name === 'pool') return GROUND.water.pool;
    }
    if (this.biomeGround[mask[this.planes.biome * plane + at]!] !== 'water') return 0;
    // A lake: deeper the further it is to the shore.
    const spacing = this.maskLevel.spacing;
    const ci = Math.round(x / spacing), cj = Math.round(z / spacing);
    const key = ci * 65536 + cj;
    const known = this.depths.get(key);
    if (known !== undefined) return known;
    let shore = SHORE_SEARCH + 1;
    let unknown = false;
    search: for (let r = 1; r <= SHORE_SEARCH; r++) {
      for (let k = -r; k <= r; k++) {
        for (const [di, dj] of [[k, -r], [k, r], [-r, k], [r, k]] as const) {
          const g = this.biomeGroundAt((ci + di) * spacing, (cj + dj) * spacing);
          if (g === null) unknown = true;
          else if (g !== 'water') {
            shore = Math.min(shore, Math.hypot(di, dj));
            if (shore <= r) break search;
          }
        }
      }
    }
    const { lakeMax, lakeShelf } = GROUND.water;
    const depth = lakeMax * (1 - Math.exp(-(Math.max(0.5, shore - 0.5) * spacing) / lakeShelf));
    // Not kept while part of the search ran off the loaded masks: it may be shallower.
    if (!unknown) {
      if (this.depths.size > DEPTH_CACHE) this.depths.clear();
      this.depths.set(key, depth);
    }
    return depth;
  }

  /**
   * Thickness of the ice over water at a spot, metres: thinner near streams, which keep it
   * moving, and none where it has been broken.
   */
  iceAt(x: number, z: number): number {
    if (this.ice <= 0) return 0;
    for (const h of this.holes) if (Math.hypot(x - h.x, z - h.z) < h.radius) return 0;
    const s = this.sample(x, z);
    if (!s) return this.ice;
    const { mask, at, plane } = s;
    if (mask[this.planes.road * plane + at]! >= ON_SURFACE) {
      const name = this.surfaceName[mask[this.planes.surface * plane + at]!];
      if (name === 'stream') return this.ice * GROUND.ice.stream;
      if (name === 'pool') return this.ice;
    }
    return this.ice * iceShare(this.streamDistance(x, z));
  }

  /** Depth of lying snow at a spot, metres: deeper higher up, packed thin on roads. */
  snowAt(x: number, z: number): number {
    if (this.snow <= 0) return 0;
    const depth = snowDepthAt(CALENDAR, this.snow, this.heightAt(x, z) ?? CALENDAR.snowHeight.reference);
    const s = this.sample(x, z);
    if (!s || s.mask[this.planes.road * s.plane + s.at]! < CLEARED) return depth;
    return depth * (PACKED[this.surfaceName[s.mask[this.planes.surface * s.plane + s.at]!]!] ?? 1);
  }

  /**
   * A vehicle broke through the ice here: it stays open (until the newest holes push it out).
   * Ours is passed on to the others (`onBreak`); `fromAfar` for one another driver broke.
   */
  breakIce(x: number, z: number, fromAfar = false): void {
    if (this.holes.some((h) => Math.hypot(x - h.x, z - h.z) < h.radius)) return;
    this.holes.push({ x, z, radius: HOLE_RADIUS });
    if (this.holes.length > MAX_HOLES) this.holes.shift();
    if (!fromAfar) this.onBreak?.(x, z);
  }

  /** Metres to the nearest stream, searched as far as it matters for the ice. */
  private streamDistance(x: number, z: number): number {
    const spacing = this.maskLevel.spacing;
    const ci = Math.round(x / spacing), cj = Math.round(z / spacing);
    const key = ci * 65536 + cj;
    const known = this.streamDistances.get(key);
    if (known !== undefined) return known;
    const cells = Math.ceil((2 * GROUND.ice.reach) / spacing);
    let nearest = cells + 1;
    let unknown = false;
    search: for (let r = 0; r <= cells; r++) {
      for (let k = -r; k <= r; k++) {
        for (const [di, dj] of r === 0 ? ([[0, 0]] as const) : ([[k, -r], [k, r], [-r, k], [r, k]] as const)) {
          const s = this.sample((ci + di) * spacing, (cj + dj) * spacing);
          if (!s) unknown = true;
          else if (s.mask[this.planes.road * s.plane + s.at]! >= ON_SURFACE && this.surfaceName[s.mask[this.planes.surface * s.plane + s.at]!] === 'stream') {
            nearest = Math.min(nearest, Math.hypot(di, dj));
            if (nearest <= r) break search;
          }
        }
      }
    }
    const distance = nearest * spacing;
    if (!unknown) {
      if (this.streamDistances.size > DEPTH_CACHE) this.streamDistances.clear();
      this.streamDistances.set(key, distance);
    }
    return distance;
  }

  /** The land cover's ground at a spot, or null where its mask is not loaded. */
  private biomeGroundAt(x: number, z: number): string | null {
    const s = this.sample(x, z);
    return s ? (this.biomeGround[s.mask[this.planes.biome * s.plane + s.at]!] ?? 'dirt') : null;
  }

  /** The mask file holding a spot and the spot's index in each of its planes. */
  private sample(x: number, z: number): { mask: Uint8Array; at: number; plane: number } | null {
    const { span, spacing } = this.maskLevel;
    const mx = Math.floor(x / span), mz = Math.floor(z / span);
    const mask = this.masks.get(`${mx},${mz}`);
    if (!mask) return null;
    const n = this.index.masks.samples;
    const i = Math.min(n - 1, Math.max(0, Math.round((x - mx * span) / spacing)));
    const j = Math.min(n - 1, Math.max(0, Math.round((z - mz * span) / spacing)));
    return { mask, at: j * n + i, plane: n * n };
  }

  private loadHeights(tx: number, tz: number): void {
    const key = `${tx},${tz}`;
    const tile: HeightTile = { collider: null, heights: null, x: tx, z: tz };
    this.tiles.set(key, tile);
    const h = this.index.heights;
    const side = h.samples + 2 * h.apron;
    fetchUint16(heightFileUrl(this.index, this.level.level, tx, tz), side * side).then(
      (file) => {
        if (this.tiles.get(key) !== tile) return;
        const n = h.samples;
        const heights = smoothHeights(file, side, h.apron, n, h.encoding.offset, h.encoding.scale);
        const span = this.level.span;
        tile.heights = heights;
        tile.collider = this.world.createCollider(
          this.R.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: span, y: 1, z: span })
            .setTranslation((tx + 0.5) * span, 0, (tz + 0.5) * span)
            .setFriction(0.9)
            .setCollisionGroups(groups(GROUP_GROUND, 0xffff)),
        );
      },
      () => this.tiles.delete(key), // asked for again on a later update
    );
  }

  private loadMask(mx: number, mz: number): void {
    const key = `${mx},${mz}`;
    this.masks.set(key, null);
    const m = this.index.masks;
    fetchBytes(maskFileUrl(this.index, this.maskLevel.level, mx, mz), m.samples * m.samples * m.channels.length).then(
      (file) => {
        if (this.masks.has(key)) this.masks.set(key, file);
      },
      () => this.masks.delete(key),
    );
  }
}

/**
 * A height file as Rapier wants it, column by column (x), each column running along z, and
 * smoothed over a tyre's footprint: each sample a [1 2 1] x [1 2 1] blend of the nine around
 * it. Ray-cast wheels touch the ground at a single point, so the raw 1 m grid's creases and
 * small lumps, which a real tyre rolls over, each gave them a kick; ditches, banks and humps
 * of a few metres and more stay. The apron gives the edge samples their neighbours, so the
 * shared edges of neighbouring tiles match.
 */
export function smoothHeights(file: Uint16Array, side: number, apron: number, n: number, offset: number, scale: number): Float32Array {
  const raw = (i: number, j: number): number =>
    file[Math.min(side - 1, Math.max(0, j + apron)) * side + Math.min(side - 1, Math.max(0, i + apron))]!;
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const sum =
        raw(i - 1, j - 1) + 2 * raw(i, j - 1) + raw(i + 1, j - 1)
        + 2 * raw(i - 1, j) + 4 * raw(i, j) + 2 * raw(i + 1, j)
        + raw(i - 1, j + 1) + 2 * raw(i, j + 1) + raw(i + 1, j + 1);
      heights[i * n + j] = offset + (sum / 16) * scale;
    }
  }
  return heights;
}
