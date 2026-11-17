// Trees, boulders, buildings, poles and fences near the vehicle as physics colliders. They
// come and go as the vehicle moves; each keeps the permanent name it was placed with.

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Features } from '../features/features';
import type { Vegetation } from '../vegetation/vegetation';
import { GROUP_OBSTACLE, GROUP_VEHICLE, groups } from './sim';

const RADIUS = 28;
/** Rocks smaller than this pass under the vehicle and are left out. */
const MIN_ROCK = 0.7;

export class Obstacles {
  private readonly colliders = new Map<string, { collider: RAPIER.Collider; seen: number }>();
  private pass = 0;
  private next = 0;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    private readonly vegetation: Vegetation | null,
    private readonly features: Features | null,
  ) {}

  get count(): number {
    return this.colliders.size;
  }

  /** Call every frame; does its work a few times a second. `now` in seconds. */
  update(now: number, x: number, z: number): void {
    if (now < this.next) return;
    this.next = now + 0.2;
    this.pass++;
    const solid = this.R.ColliderDesc;
    this.features?.forEachSolid(x, z, RADIUS, (s) => {
      const known = this.colliders.get(s.key);
      if (known) {
        known.seen = this.pass;
        return;
      }
      const desc = solid
        .cuboid(s.hx, s.hy, s.hz)
        .setTranslation(s.x, s.y, s.z)
        .setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) });
      const collider = this.world.createCollider(desc.setFriction(0.6).setCollisionGroups(groups(GROUP_OBSTACLE, GROUP_VEHICLE)));
      this.colliders.set(s.key, { collider, seen: this.pass });
    });
    this.vegetation?.forEachSolid(x, z, RADIUS, (key, shape, px, py, pz, size, radiusPerHeight) => {
      const known = this.colliders.get(key);
      if (known) {
        known.seen = this.pass;
        return;
      }
      let desc: RAPIER.ColliderDesc;
      if (shape === 'trunk') {
        const half = Math.min(size, 6) / 2 + 0.2;
        desc = this.R.ColliderDesc.cylinder(half, Math.max(0.07, radiusPerHeight * size)).setTranslation(px, py + half - 0.4, pz);
      } else {
        if (size < MIN_ROCK) return;
        desc = this.R.ColliderDesc.ball(radiusPerHeight * size).setTranslation(px, py + 0.25 * size, pz);
      }
      const collider = this.world.createCollider(desc.setFriction(0.6).setCollisionGroups(groups(GROUP_OBSTACLE, GROUP_VEHICLE)));
      this.colliders.set(key, { collider, seen: this.pass });
    });
    for (const [key, entry] of this.colliders) {
      if (entry.seen !== this.pass) {
        this.world.removeCollider(entry.collider, false);
        this.colliders.delete(key);
      }
    }
  }
}
