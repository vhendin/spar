// The ground as the physics sees it: height colliders around the vehicle, and what kind
// of ground lies under each wheel.

import type RAPIER from '@dimforge/rapier3d-compat';
import type { GroundClasses, RegionIndex } from '@spar/shared';
import groundDefs from '../../../defs/ground.json';
import { fetchBytes, fetchUint16, heightFileUrl, maskFileUrl } from '../terrain/region';
import { GROUP_GROUND, GROUP_OBSTACLE, groups, type GroundProbe } from './sim';

const GROUND = groundDefs as unknown as GroundClasses;
/** Height files are turned into colliders this far ahead of the vehicle, and dropped this far behind. */
const LOAD_MARGIN = 90;
const KEEP_MARGIN = 260;
/** Road coverage (0..255) from which a wheel counts as being on the road or in the stream. */
const ON_SURFACE = 110;

interface HeightTile {
  collider: RAPIER.Collider | null;
  heights: Float32Array | null;
  x: number;
  z: number;
}

export class GroundStore implements GroundProbe {
  /** 0 dry to 1 soaked; the weather sets this in a later step. */
  rain = 0;

  private readonly level: RegionIndex['heights']['levels'][number];
  private readonly maskLevel: RegionIndex['masks']['levels'][number];
  private readonly tiles = new Map<string, HeightTile>();
  private readonly masks = new Map<string, Uint8Array | null>();
  private readonly biomeGround: string[] = [];
  private readonly surfaceGround: (string | undefined)[] = [];
  private readonly planes: { biome: number; surface: number; road: number };

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    private readonly index: RegionIndex,
  ) {
    this.level = index.heights.levels[0]!;
    this.maskLevel = index.masks.levels[0]!;
    // Mask files hold ids; the definitions say by name what each class is to drive on.
    for (const c of index.masks.biomes) this.biomeGround[c.id] = GROUND.biomes.find((b) => b.name === c.name)?.ground ?? 'dirt';
    for (const c of index.masks.surfaces) this.surfaceGround[c.id] = GROUND.surfaces.find((s) => s.name === c.name)?.ground;
    const plane = (name: string): number => index.masks.channels.findIndex((c) => c.name === name);
    this.planes = { biome: plane('biome'), surface: plane('surface'), road: plane('road') };

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
   * Keeps colliders and mask data loaded around a position. Returns true when the ground
   * right under it is solid, so the caller knows it is safe to let physics run.
   */
  update(x: number, z: number): boolean {
    const span = this.level.span;
    const last = this.level.count - 1;
    const range = (v: number): [number, number] => [Math.max(0, Math.floor((v - LOAD_MARGIN) / span)), Math.min(last, Math.floor((v + LOAD_MARGIN) / span))];
    const [x0, x1] = range(x);
    const [z0, z1] = range(z);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) if (!this.tiles.has(`${tx},${tz}`)) this.loadHeights(tx, tz);
    for (const [key, tile] of this.tiles) {
      const dx = Math.max(tile.x * span - x, 0, x - (tile.x + 1) * span);
      const dz = Math.max(tile.z * span - z, 0, z - (tile.z + 1) * span);
      if (tile.collider && Math.max(dx, dz) > KEEP_MARGIN) {
        this.world.removeCollider(tile.collider, false);
        this.tiles.delete(key);
      }
    }

    const mspan = this.maskLevel.span;
    const mlast = this.maskLevel.count - 1;
    for (let mz = Math.max(0, Math.floor((z - 40) / mspan)); mz <= Math.min(mlast, Math.floor((z + 40) / mspan)); mz++) {
      for (let mx = Math.max(0, Math.floor((x - 40) / mspan)); mx <= Math.min(mlast, Math.floor((x + 40) / mspan)); mx++) {
        if (!this.masks.has(`${mx},${mz}`)) this.loadMask(mx, mz);
      }
    }
    if (this.masks.size > 12) {
      for (const key of this.masks.keys()) {
        const [mx, mz] = key.split(',').map(Number) as [number, number];
        if (Math.abs((mx + 0.5) * mspan - x) > mspan * 2 || Math.abs((mz + 0.5) * mspan - z) > mspan * 2) this.masks.delete(key);
      }
    }

    return this.tiles.get(`${Math.min(last, Math.max(0, Math.floor(x / span)))},${Math.min(last, Math.max(0, Math.floor(z / span)))}`)?.collider != null;
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
    const { span, spacing } = this.maskLevel;
    const mx = Math.floor(x / span), mz = Math.floor(z / span);
    const mask = this.masks.get(`${mx},${mz}`);
    if (!mask) return 'dirt';
    const n = this.index.masks.samples;
    const i = Math.min(n - 1, Math.max(0, Math.round((x - mx * span) / spacing)));
    const j = Math.min(n - 1, Math.max(0, Math.round((z - mz * span) / spacing)));
    const at = j * n + i;
    const plane = n * n;
    if (mask[this.planes.road * plane + at]! >= ON_SURFACE) {
      const surface = this.surfaceGround[mask[this.planes.surface * plane + at]!];
      if (surface) return surface;
    }
    return this.biomeGround[mask[this.planes.biome * plane + at]!] ?? 'dirt';
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
        // Rapier wants the grid column by column (x), each column running along z.
        const heights = new Float32Array(n * n);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) heights[i * n + j] = h.encoding.offset + file[(j + h.apron) * side + i + h.apron]! * h.encoding.scale;
        }
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
