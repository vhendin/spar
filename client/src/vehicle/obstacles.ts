// Trees, boulders, buildings, poles and fences near the vehicle as physics colliders. They
// come and go as the vehicle moves; each keeps the permanent name it was placed with.
//
// For debugging, `debug` holds a wireframe of every collider (K in the game): green for
// plants, blue for buildings and the like, red for a plant that is solid but not drawn,
// which should never happen. Those are also counted and logged.

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { FelledTree } from '@spar/shared';
import type { Features } from '../features/features';
import type { Vegetation } from '../vegetation/vegetation';
import { Felling } from './felling';
import { GROUP_OBSTACLE, GROUP_VEHICLE, groups } from './sim';

const RADIUS = 28;
/** Rocks smaller than this pass under the vehicle and are left out. */
const MIN_ROCK = 0.7;

/** What a solid is, for the sound of hitting it. */
export type SolidKind = 'tree' | 'rock' | 'object';

/** Trunks thinner than this (metres across) are no use to hook a winch to. */
const MIN_ANCHOR_TRUNK = 0.1;
/** Nor are rocks lower than this. */
const MIN_ANCHOR_ROCK = 0.9;

/** Something a winch cable can be hooked to: a tree, rock or building, or another driver's vehicle. */
export interface Anchor {
  /** The permanent name it was placed with (`v:<player>` for a vehicle). */
  key: string;
  kind: SolidKind | 'vehicle';
  /** Its middle, at the height the cable goes round it. */
  x: number;
  y: number;
  z: number;
  /** Round things (trunks, rocks): how far the surface is from the middle. */
  radius: number;
  /** Trunks: metres across, which decides whether it holds. */
  diameter: number;
  /** Buildings and the like: half the footprint, and its turn about the vertical. */
  box?: { hx: number; hz: number; yaw: number };
  /** Another driver's vehicle: whose, and where on it the hook goes, in its own frame. */
  vehicle?: string;
  local?: [number, number, number];
}

interface Entry {
  collider: RAPIER.Collider;
  seen: number;
  wire: THREE.Mesh;
  drawn: boolean;
  kind: SolidKind;
}

const UNIT_CYLINDER = new THREE.CylinderGeometry(1, 1, 2, 10, 1);
const UNIT_BALL = new THREE.IcosahedronGeometry(1, 1);
const UNIT_BOX = new THREE.BoxGeometry(2, 2, 2);
const wireMaterial = (color: number): THREE.MeshBasicNodeMaterial =>
  new THREE.MeshBasicNodeMaterial({ color, wireframe: true, depthTest: false, transparent: true, opacity: 0.8, fog: false });

export class Obstacles {
  /** Wireframes of the colliders; hidden unless debugging. */
  readonly debug = new THREE.Group();
  /** Plants that are solid but not drawn: now, and different ones since the start. */
  undrawn = 0;
  /** Trees the vehicle has knocked over. */
  felled = 0;
  /** Told of every tree our vehicle or winch knocks down, to pass on to the others. */
  onFelled: ((tree: FelledTree) => void) | null = null;
  /** Trees that gave way since the sound last took them: where, and how thick. */
  readonly cracks: { x: number; y: number; z: number; diameter: number }[] = [];
  readonly undrawnEver = new Set<string>();

  private readonly colliders = new Map<string, Entry>();
  private readonly byHandle = new Map<number, Entry>();
  private readonly materials = { plant: wireMaterial(0x3cff6e), object: wireMaterial(0x4aa8ff), hidden: wireMaterial(0xff2a2a) };
  private pass = 0;
  private next = 0;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    private readonly vegetation: Vegetation | null,
    private readonly features: Features | null,
    /** With this, thin trunks give way when the vehicle hits them hard enough. */
    private readonly felling: Felling | null = null,
  ) {
    this.debug.name = 'colliders';
    this.debug.visible = false;
    this.debug.renderOrder = 10;
  }

  /** What the collider with this handle is, or null when it is none of these (the ground). */
  kindOf(handle: number): SolidKind | null {
    return this.byHandle.get(handle)?.kind ?? null;
  }

  private add(key: string, desc: RAPIER.ColliderDesc, geometry: THREE.BufferGeometry, scale: [number, number, number], drawn: boolean, kind: SolidKind): RAPIER.Collider {
    const plant = kind !== 'object';
    const collider = this.world.createCollider(desc.setFriction(0.6).setCollisionGroups(groups(GROUP_OBSTACLE, GROUP_VEHICLE)));
    const wire = new THREE.Mesh(geometry, plant ? this.materials.plant : this.materials.object);
    const t = desc.translation, r = desc.rotation;
    wire.position.set(t.x, t.y, t.z);
    wire.quaternion.set(r.x, r.y, r.z, r.w);
    wire.scale.set(...scale);
    wire.renderOrder = 10;
    this.debug.add(wire);
    const entry: Entry = { collider, seen: this.pass, wire, drawn: true, kind };
    this.colliders.set(key, entry);
    this.byHandle.set(collider.handle, entry);
    if (plant) this.mark(key, this.colliders.get(key)!, drawn);
    return collider;
  }

  /**
   * Call after each physics step (stepped with `felling.events`): trunks that gave way lose
   * their collider and fall over on screen.
   */
  afterStep(dt: number): void {
    if (!this.felling) return;
    for (const f of this.felling.after(dt)) {
      const entry = this.colliders.get(f.key);
      const p = f.collider.translation();
      this.vegetation?.fell(f.key, p.x, p.z, f.dx, f.dz);
      this.felled++;
      if (this.cracks.length < 8) this.cracks.push({ x: p.x, y: p.y, z: p.z, diameter: f.diameter });
      if (entry) this.drop(f.key, entry);
      this.onFelled?.(tree(f.key, p.x, p.z, f.dx, f.dz, f.diameter));
    }
  }

  /**
   * A tree another driver knocked down: it lies the way it fell for them and is no longer
   * solid. With the ground height `y` there its crack is heard (not for the list sent on
   * entering a region).
   */
  fellFromAfar(t: FelledTree, y: number | null): void {
    if (!this.standing(t.key)) return;
    this.vegetation?.fell(t.key, t.x, t.z, t.dx, t.dz);
    this.felled++;
    if (y !== null && this.cracks.length < 8) this.cracks.push({ x: t.x, y: y + 0.6, z: t.z, diameter: t.diameter });
    const entry = this.colliders.get(t.key);
    if (entry) this.drop(t.key, entry);
  }

  private drop(key: string, entry: Entry): void {
    this.felling?.untrack(entry.collider);
    this.byHandle.delete(entry.collider.handle);
    this.world.removeCollider(entry.collider, false);
    this.debug.remove(entry.wire);
    this.colliders.delete(key);
  }

  /** Records whether a plant's collider has something drawn to go with it. */
  private mark(key: string, entry: Entry, drawn: boolean): void {
    if (entry.drawn === drawn) return;
    entry.drawn = drawn;
    entry.wire.material = drawn ? this.materials.plant : this.materials.hidden;
    if (!drawn && !this.undrawnEver.has(key)) {
      this.undrawnEver.add(key);
      const p = entry.wire.position;
      console.warn(`obstacles: ${key} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} is solid but not drawn`);
    }
  }

  /** Trees, rocks and buildings within `radius` of a point that a winch cable could be hooked to. */
  anchorsNear(x: number, z: number, radius: number): Anchor[] {
    const found: Anchor[] = [];
    this.features?.forEachSolid(x, z, radius, (s) => {
      // Fence posts would never hold.
      if (s.key.startsWith('f')) return;
      if (Math.hypot(s.x - x, s.z - z) > radius + Math.max(s.hx, s.hz)) return;
      found.push({ key: s.key, kind: 'object', x: s.x, y: s.y - s.hy + Math.min(0.8, s.hy), z: s.z, radius: 0, diameter: 0, box: { hx: s.hx, hz: s.hz, yaw: s.yaw } });
    });
    this.vegetation?.forEachSolid(x, z, radius, (key, shape, px, py, pz, size, radiusPerHeight, drawn) => {
      if (!drawn) return;
      if (shape === 'trunk') {
        const r = Math.max(0.07, radiusPerHeight * size);
        if (2 * r >= MIN_ANCHOR_TRUNK) found.push({ key, kind: 'tree', x: px, y: py + 0.6, z: pz, radius: r, diameter: 2 * r });
      } else if (size >= MIN_ANCHOR_ROCK) {
        found.push({ key, kind: 'rock', x: px, y: py + 0.25 * size, z: pz, radius: radiusPerHeight * size, diameter: 0 });
      }
    });
    return found;
  }

  /** False once the tree with this name has been knocked down. */
  standing(key: string): boolean {
    return !this.vegetation?.isFelled(key);
  }

  /** Pulls a tree over (by a winch): it falls the way (dx, dz) and loses its collider. */
  fell(anchor: Anchor, dx: number, dz: number): void {
    if (!this.standing(anchor.key)) return;
    this.vegetation?.fell(anchor.key, anchor.x, anchor.z, dx, dz);
    this.felled++;
    if (this.cracks.length < 8) this.cracks.push({ x: anchor.x, y: anchor.y, z: anchor.z, diameter: anchor.diameter });
    const entry = this.colliders.get(anchor.key);
    if (entry) this.drop(anchor.key, entry);
    this.onFelled?.(tree(anchor.key, anchor.x, anchor.z, dx, dz, anchor.diameter));
  }

  get count(): number {
    return this.colliders.size;
  }

  /**
   * Call every frame; does its work a few times a second. `now` in seconds. Colliders gather
   * round (x, z) and round `more` (other vehicles this browser runs).
   */
  update(now: number, x: number, z: number, more: readonly { x: number; z: number }[] = []): void {
    if (now < this.next) return;
    this.next = now + 0.2;
    this.pass++;
    for (const p of [{ x, z }, ...more]) this.gather(p.x, p.z);
    let undrawn = 0;
    for (const [key, entry] of this.colliders) {
      if (entry.seen !== this.pass) this.drop(key, entry);
      else if (!entry.drawn) undrawn++;
    }
    this.undrawn = undrawn;
  }

  /** Makes colliders for what stands round (x, z), and marks those already there as still wanted. */
  private gather(x: number, z: number): void {
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
      this.add(s.key, desc, UNIT_BOX, [s.hx, s.hy, s.hz], true, 'object');
    });
    this.vegetation?.forEachSolid(x, z, RADIUS, (key, shape, px, py, pz, size, radiusPerHeight, drawn) => {
      const known = this.colliders.get(key);
      if (known) {
        known.seen = this.pass;
        this.mark(key, known, drawn);
        return;
      }
      if (shape === 'trunk') {
        const half = Math.min(size, 6) / 2 + 0.2;
        const radius = Math.max(0.07, radiusPerHeight * size);
        let desc = this.R.ColliderDesc.cylinder(half, radius).setTranslation(px, py + half - 0.4, pz);
        const breakable = this.felling && Felling.breakable(radius * 2);
        if (breakable) desc = this.felling!.listen(desc, this.R);
        const collider = this.add(key, desc, UNIT_CYLINDER, [radius, half, radius], drawn, 'tree');
        if (breakable) this.felling!.track(collider, { key, diameter: radius * 2 });
      } else {
        if (size < MIN_ROCK) return;
        const radius = radiusPerHeight * size;
        const desc = this.R.ColliderDesc.ball(radius).setTranslation(px, py + 0.25 * size, pz);
        this.add(key, desc, UNIT_BALL, [radius, radius, radius], drawn, 'rock');
      }
    });
  }
}

/** A felled tree as sent to the others, rounded. */
function tree(key: string, x: number, z: number, dx: number, dz: number, diameter: number): FelledTree {
  const r = (v: number, k = 100): number => Math.round(v * k) / k;
  return { key, x: r(x), z: r(z), dx: r(dx, 1000), dz: r(dz, 1000), diameter: Math.min(5, Math.max(0, r(diameter))) };
}
