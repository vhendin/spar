// Young trees give way. A trunk the vehicle hits snaps or is flattened when the vehicle
// brings enough energy for a trunk that thick, or pushes on it hard enough for long enough;
// the vehicle then carries on, slowed by what breaking it took. Grown trees stay put: a
// vehicle hitting one stops, as it would in a forest.
// Stretches of wooden fence go the same way, with what it takes to break them given.
// No rendering in here, so it runs in tests.

import type RAPIER from '@dimforge/rapier3d-compat';

/** Trunks thicker than this (metres across, a spruce some 7 m tall) never give way. */
export const MAX_BREAKABLE = 0.2;
/**
 * Energy in joules to break a trunk `d` metres across. In a 2.4 t vehicle: a 6 cm sapling at
 * walking pace, 10 cm at about 13 km/h, 15 cm at 33 km/h and 20 cm at 63 km/h, each taking
 * most of the speed it needed.
 */
export const breakEnergy = (d: number): number => 5.2e8 * d ** 4.5;
/**
 * Steady force in newtons that pushes a trunk over: 15 cm takes low range, 10 cm does not.
 * Measured as an average over about PUSH_TIME seconds, so a single jolt does not count.
 */
export const pushForce = (d: number): number => 1.6e6 * d ** 2.5;
const PUSH_TIME = 0.4;
/** Only a vehicle closing slower than this (m/s) is pushing; faster, it is a hit, judged on energy. */
const PUSH_SPEED = 1.5;
/** Contacts weaker than this are not reported at all. */
const LISTEN = 200;

export interface Tree {
  key: string;
  /** Trunk diameter in metres. */
  diameter: number;
  /** What breaking it takes, when not worked out from the diameter: joules, and newtons of push. */
  energy?: number;
  push?: number;
}

/** A tree that has given way, and the way it fell (a unit vector on the ground). */
export interface Felled {
  key: string;
  collider: RAPIER.Collider;
  dx: number;
  dz: number;
  /** Trunk diameter, metres. */
  diameter: number;
}

/** A push between two colliders in one physics step, for the sound of it. */
export interface Contact {
  a: number;
  b: number;
  /** Newtons. */
  force: number;
}

export class Felling {
  readonly events: RAPIER.EventQueue;
  /** Every reported contact since the list was last emptied (by whoever plays them). */
  readonly contacts: Contact[] = [];
  /** Trunks being watched, with the average force on each lately (newtons). */
  private readonly trees = new Map<number, Tree & { collider: RAPIER.Collider; pushed: number }>();
  private readonly v = { x: 0, y: 0, z: 0 };
  private readonly w = { x: 0, y: 0, z: 0 };

  constructor(
    R: typeof RAPIER,
    /** The vehicle's body; replaced when the vehicle is. */
    public body: RAPIER.RigidBody,
  ) {
    this.events = new R.EventQueue(true);
  }

  static breakable(diameter: number): boolean {
    return diameter <= MAX_BREAKABLE;
  }

  /** Makes a trunk's collider report its contacts; call before creating it. */
  listen(desc: RAPIER.ColliderDesc, R: typeof RAPIER): RAPIER.ColliderDesc {
    return desc.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(LISTEN);
  }

  track(collider: RAPIER.Collider, tree: Tree): void {
    this.trees.set(collider.handle, { ...tree, collider, pushed: 0 });
  }

  untrack(collider: RAPIER.Collider): void {
    this.trees.delete(collider.handle);
  }

  /** Call just before stepping the world. */
  before(): void {
    const v = this.body.linvel(), w = this.body.angvel();
    this.v.x = v.x; this.v.y = v.y; this.v.z = v.z;
    this.w.x = w.x; this.w.y = w.y; this.w.z = w.z;
  }

  /** Call just after stepping the world with `events`; returns the trees that gave way. */
  after(dt: number): Felled[] {
    const felled: Felled[] = [];
    const mass = this.body.mass();
    const touched = new Set<number>();
    let restore = false;
    const v = { ...this.v };
    this.events.drainContactForceEvents((e) => {
      if (this.contacts.length < 64) this.contacts.push({ a: e.collider1(), b: e.collider2(), force: e.totalForceMagnitude() });
      const tree = this.trees.get(e.collider1()) ?? this.trees.get(e.collider2());
      if (!tree || touched.has(tree.collider.handle)) return;
      touched.add(tree.collider.handle);
      const d = e.maxForceDirection();
      const flat = Math.hypot(d.x, d.z) || 1;
      const nx = d.x / flat, nz = d.z / flat;
      // Speed towards the trunk just before the hit.
      const closing = Math.abs(v.x * nx + v.z * nz);
      const energy = 0.5 * mass * closing * closing;
      const needed = tree.energy ?? breakEnergy(tree.diameter);
      const push = closing < PUSH_SPEED ? e.totalForceMagnitude() : 0;
      tree.pushed += (push - tree.pushed) * Math.min(1, dt / PUSH_TIME);
      if (energy <= needed && tree.pushed < (tree.push ?? pushForce(tree.diameter))) return;
      // It goes. The vehicle keeps its speed less what the breaking took.
      if (energy > needed) {
        const left = Math.sqrt(Math.max(0, closing * closing - (2 * needed) / mass));
        const along = v.x * nx + v.z * nz;
        const keep = Math.sign(along) * left - along;
        v.x += nx * keep;
        v.z += nz * keep;
        restore = true;
      }
      // It falls the way the vehicle is going, or away from it when pushed from a standstill.
      const speed = Math.hypot(v.x, v.z);
      const [fx, fz] = speed > 0.5 ? [v.x / speed, v.z / speed] : [nx * Math.sign(this.v.x * nx + this.v.z * nz || 1), nz * Math.sign(this.v.x * nx + this.v.z * nz || 1)];
      felled.push({ key: tree.key, collider: tree.collider, dx: fx, dz: fz, diameter: tree.diameter });
      this.trees.delete(tree.collider.handle);
    });
    // Contacts that stopped reporting are no longer pushing.
    for (const [handle, tree] of this.trees) if (!touched.has(handle)) tree.pushed *= 1 - Math.min(1, dt / PUSH_TIME);
    if (restore) {
      // Undo the stop the solver applied against the trunk that was not going to hold.
      this.body.setLinvel(v, true);
      this.body.setAngvel(this.w, true);
    }
    return felled;
  }
}
