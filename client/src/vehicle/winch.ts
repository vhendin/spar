// The winch: a cable from the front of the vehicle hooked round a tree, rock or building, on
// to another driver's vehicle, or to a ground anchor dug in ahead where the ground takes one. Choosing shows what is in reach; hooking on carries the
// cable there; winching in shortens it, pulling as hard as the winch can until it stalls. A
// thin tree pulled too hard gives way. Hooked to another vehicle, the cable pulls both ends,
// once this browser runs that vehicle too (multiplayer/towing.ts).
// No rendering in here, so it runs in tests.

import type { AnchorData, SnapshotWinch, VehicleDef, WinchHandover } from '@spar/shared';
import { Felling, pushForce } from './felling';
import type { Anchor } from './obstacles';
import type { VehicleSim } from './sim';

export type WinchState =
  /** Cable on the drum. */
  | 'stowed'
  /** Showing what can be hooked to. */
  | 'choosing'
  /** The hook on its way out to the anchor. */
  | 'carrying'
  | 'hooked'
  /** Unhooked, the cable winding back in. */
  | 'reeling';

export interface WinchControls {
  /** Winch in. */
  pull: boolean;
  /** Pay cable out. */
  slack: boolean;
}

type V3 = { x: number; y: number; z: number };
type Q = { x: number; y: number; z: number; w: number };

/** Another driver's vehicle, as a cable hooked to it sees it. */
export interface TowedBody {
  translation(): V3;
  rotation(): Q;
  /** Present while this browser runs that vehicle: the cable then pulls on it too. */
  dynamic?: {
    linvel(): V3;
    angvel(): V3;
    worldCom(): V3;
    applyImpulseAtPoint(impulse: V3, point: V3, wakeUp: boolean): void;
  };
  /** Being winched in: it lets go of its parking hold, for this step. */
  towed?(): void;
}

/** What the winch needs from the world. */
export interface AnchorSource {
  anchorsNear(x: number, z: number, radius: number): Anchor[];
  /** False once a tree has been knocked down. */
  standing(key: string): boolean;
  /** Another driver's vehicle by player id, or null when it is not on the road here. */
  vehicle?(id: string): TowedBody | null;
  /** Whether a ground anchor can be dug in here: the ground's height, and soft where it ploughs. */
  holdAt?(x: number, z: number): { y: number; soft: boolean } | null;
}

/** The ground anchor's name: there is one, carried along and got back when unhooked. */
export const STAKE = 'stake';
/** Where the ground anchor is offered: this share of the cable ahead, or nearer, or a little to the side. */
const STAKE_REACH = [1, 0.8, 0.6, 0.4].map((k) => k * 0.6);
const STAKE_TURN = [0, -15, 15, -30, 30].map((d) => (d * Math.PI) / 180);
/** The cable meets it this high over the ground. */
const STAKE_TOP = 0.25;
/** In soft ground it holds this share of the winch's pull, and beyond it ploughs towards the vehicle. */
const SOFT_HOLD = 0.5;
/** How fast it ploughs at most, metres a second (pulled half as hard again as it holds). */
const PLOUGH_SPEED = 0.25;

/** The cable as a spring: newtons per metre stretched, and per metre a second of stretching. */
const STIFFNESS = 250_000;
const DAMPING = 25_000;
/** Beyond this the cable pulls no harder, so nothing flies off. */
const MAX_TENSION = 250_000;
/** How fast the hook is carried out and wound back, metres a second. */
const CARRY_SPEED = 45;
const REEL_SPEED = 40;
/** Winding in slack cable, and paying out, metres a second. */
const SLACK_SPEED = 3;
const PAY_OUT_SPEED = 2.5;
/** Never shorter than this: the hook is at the anchor. */
const MIN_LENGTH = 1.2;
/** Anchors closer than this are too close to bother with. */
const MIN_REACH = 2;
/** Anchors must lie within this of straight ahead (cosine of the angle). */
const AHEAD = Math.cos((80 * Math.PI) / 180);
/** At most this many anchors are offered at once, nearest first. */
const MAX_CHOICES = 24;
/** A tree's strain is the cable's pull averaged over about this many seconds. */
const STRAIN_TIME = 0.5;

/** Turns a vector by a unit quaternion. */
function rotate(q: Q, v: V3): V3 {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
}

/** Where on an anchor the cable goes round, seen from `from`: the near side of its surface. */
export function hookPoint(a: Anchor, from: V3): V3 {
  if (a.box) {
    // Into the box's own frame, onto its outline, and back.
    const c = Math.cos(a.box.yaw), s = Math.sin(a.box.yaw);
    const dx = from.x - a.x, dz = from.z - a.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const px = Math.max(-a.box.hx, Math.min(a.box.hx, lx)), pz = Math.max(-a.box.hz, Math.min(a.box.hz, lz));
    return { x: a.x + c * px + s * pz, y: a.y, z: a.z - s * px + c * pz };
  }
  const dx = from.x - a.x, dz = from.z - a.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: a.x + (dx / d) * a.radius, y: a.y, z: a.z + (dz / d) * a.radius };
}

export class Winch {
  state: WinchState = 'stowed';
  /** While choosing: what is in reach, left to right, and which one is picked. */
  choices: Anchor[] = [];
  picked = 0;
  /** What it is hooked to (or being carried to), and the point on it the cable goes round. */
  anchor: Anchor | null = null;
  readonly point: V3 = { x: 0, y: 0, z: 0 };
  /** Cable out, metres. */
  length = 0;
  /** Newtons the cable pulls with now. */
  tension = 0;
  /** The drum's turning: metres a second of cable, positive winding in. */
  drum = 0;
  /** The cable's free end while it is carried out or wound back (world). */
  readonly end: V3 = { x: 0, y: 0, z: 0 };
  /** One-off happenings since the sound last took them. */
  readonly events: ('hooked' | 'unhooked' | 'gaveWay')[] = [];
  /** Set when a tree gives way: called to knock it down, falling towards (dx, dz). */
  onGiveWay: ((anchor: Anchor, dx: number, dz: number) => void) | null = null;

  /** The anchor the aim pointed at last, so a turn of the camera picks again but Tab is not undone. */
  private aimed: string | null = null;
  private nextLook = 0;
  private strain = 0;
  /** How far the hook has gone, 0..1, while carried or wound back; and from how far. */
  private carried = 0;
  private reelFrom = 0;
  private readonly reelStart: V3 = { x: 0, y: 0, z: 0 };

  constructor(
    /** The vehicle; replaced when the vehicle is. */
    public sim: VehicleSim,
    private readonly world: AnchorSource | null,
  ) {}

  /** The vehicle's definition. */
  get def(): VehicleDef {
    return this.sim.def;
  }

  /** The other driver's vehicle the cable is hooked to, or on its way to: their player id. */
  get towing(): string | null {
    return (this.state === 'carrying' || this.state === 'hooked') && this.anchor?.kind === 'vehicle' ? (this.anchor.vehicle ?? null) : null;
  }

  /** Whether this vehicle has a winch at all. */
  get fitted(): boolean {
    return this.spec !== null;
  }

  private get spec(): { pull: number; speed: number; cable: number; at: V3 } | null {
    const w = this.sim.def.winch;
    const at = w && this.sim.def.attachments.find((a) => a.name === w.attachment)?.position;
    return w && at ? { pull: w.pull, speed: w.speed, cable: w.cable, at: { x: at[0]!, y: at[1]!, z: at[2]! } } : null;
  }

  /** Where the cable leaves the vehicle, in the world. */
  origin(): V3 {
    const at = this.spec?.at ?? { x: 0, y: 0.6, z: 2 };
    const p = this.sim.body.translation();
    const o = rotate(this.sim.body.rotation(), at);
    return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z };
  }

  /** The winch's own key: choose, then hook on; when hooked, unhook. */
  toggle(): void {
    if (this.state === 'stowed' || this.state === 'reeling') this.choose();
    else if (this.state === 'choosing') this.hookOn();
    else this.release();
  }

  /** Starts choosing: lists what is in reach. Nothing in reach, nothing to choose. */
  choose(): void {
    if (!this.spec) return;
    this.state = 'choosing';
    this.aimed = null;
    this.picked = 0;
    this.look();
  }

  /** Looks again for anchors in reach, keeping the picked one if it still is. */
  private look(): void {
    const spec = this.spec;
    if (!spec || !this.world) {
      this.choices = [];
      return;
    }
    const o = this.origin();
    const q = this.sim.body.rotation();
    const f = rotate(q, { x: 0, y: 0, z: 1 });
    const fl = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / fl, fz = f.z / fl;
    const keep = this.choices[this.picked]?.key;
    let near = this.world.anchorsNear(o.x, o.z, spec.cable).map((a) => {
      const p = hookPoint(a, o);
      const dx = p.x - o.x, dz = p.z - o.z;
      const d = Math.hypot(dx, dz, p.y - o.y);
      const flat = Math.hypot(dx, dz) || 1;
      // Bearing from straight ahead: negative to the left.
      const side = fx * (dz / flat) - fz * (dx / flat);
      return { a, d, ahead: (dx * fx + dz * fz) / flat, side };
    });
    const stake = this.stakeSpot(o, fx, fz, spec.cable);
    if (stake) {
      const dx = stake.x - o.x, dz = stake.z - o.z;
      const flat = Math.hypot(dx, dz) || 1;
      near.push({ a: stake, d: Math.hypot(dx, dz, stake.y - o.y), ahead: (dx * fx + dz * fz) / flat, side: fx * (dz / flat) - fz * (dx / flat) });
    }
    near = near.filter((c) => c.d >= MIN_REACH && c.d <= spec.cable - 0.5 && c.ahead >= AHEAD);
    // Nearest first, but the ground anchor always stays among them.
    near.sort((a, b) => (a.a.kind === 'stake' ? -1 : b.a.kind === 'stake' ? 1 : a.d - b.d));
    this.choices = near.slice(0, MAX_CHOICES).sort((a, b) => a.side - b.side).map((c) => c.a);
    const i = this.choices.findIndex((a) => a.key === keep);
    this.picked = i >= 0 ? i : 0;
  }

  /** Where the ground anchor could go: straight ahead if the ground takes it there, else nearer or to the side. */
  private stakeSpot(o: V3, fx: number, fz: number, cable: number): Anchor | null {
    const holdAt = this.world?.holdAt;
    if (!holdAt) return null;
    for (const k of STAKE_REACH) {
      for (const turn of STAKE_TURN) {
        const c = Math.cos(turn), s = Math.sin(turn);
        const x = o.x + (fx * c - fz * s) * k * cable, z = o.z + (fz * c + fx * s) * k * cable;
        const hold = holdAt.call(this.world, x, z);
        if (hold) return { key: STAKE, kind: 'stake', x, y: hold.y + STAKE_TOP, z, radius: 0, diameter: 0, ...(hold.soft && { soft: true }) };
      }
    }
    return null;
  }

  /**
   * Call every frame while choosing: `aim` is the way the camera looks (world). Turning it
   * towards another anchor picks that one.
   */
  aim(now: number, aim: V3): void {
    if (this.state !== 'choosing') return;
    if (now >= this.nextLook) {
      this.nextLook = now + 0.3;
      this.look();
    }
    const o = this.origin();
    const al = Math.hypot(aim.x, aim.z) || 1;
    let best = -1, bestDot = -2;
    this.choices.forEach((a, i) => {
      const dx = a.x - o.x, dz = a.z - o.z;
      const dot = (dx * aim.x + dz * aim.z) / ((Math.hypot(dx, dz) || 1) * al);
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    });
    const key = this.choices[best]?.key ?? null;
    if (key !== this.aimed) {
      this.aimed = key;
      if (best >= 0) this.picked = best;
    }
  }

  /** The next anchor to the right, round to the leftmost. */
  next(): void {
    if (this.choices.length) this.picked = (this.picked + 1) % this.choices.length;
  }

  get pickedAnchor(): Anchor | null {
    return this.state === 'choosing' ? (this.choices[this.picked] ?? null) : null;
  }

  /** Hooks on to the picked anchor: the cable is carried out to it. */
  hookOn(): void {
    const a = this.pickedAnchor;
    if (!a) {
      this.cancel();
      return;
    }
    this.hookTo(a);
  }

  /** Hooks on to `a` (picked here, or in the browser of the driver whose winch it is). */
  hookTo(a: Anchor): void {
    if (!this.spec) return;
    this.anchor = a;
    Object.assign(this.point, hookPoint(a, this.origin()));
    Object.assign(this.end, this.origin());
    this.state = 'carrying';
    this.carried = 0;
    this.choices = [];
    this.strain = 0;
    this.tension = 0;
  }

  /** Stops choosing. */
  cancel(): void {
    if (this.state === 'choosing') this.state = 'stowed';
    this.choices = [];
  }

  /** Unhooks: the cable winds back in. */
  release(): void {
    if (this.state === 'choosing') return this.cancel();
    if (this.state !== 'hooked' && this.state !== 'carrying') return;
    const o = this.origin();
    this.reelFrom = Math.max(1, Math.hypot(this.end.x - o.x, this.end.y - o.y, this.end.z - o.z));
    Object.assign(this.reelStart, this.end);
    this.carried = 1;
    this.anchor = null;
    this.tension = 0;
    this.drum = 0;
    this.state = 'reeling';
    this.events.push('unhooked');
  }

  /** Everything back on the drum at once: when the vehicle is moved or swapped. */
  stow(): void {
    this.state = 'stowed';
    this.anchor = null;
    this.choices = [];
    this.tension = 0;
    this.drum = 0;
  }

  /** Call every physics step, after the vehicle's own step and before the world's. */
  step(dt: number, controls: WinchControls): void {
    const spec = this.spec;
    this.sim.pulled = false;
    if (!spec) {
      if (this.state !== 'stowed') this.stow();
      return;
    }
    const o = this.origin();
    // Hooked to another vehicle, the hook moves with it.
    const towed = this.anchor?.kind === 'vehicle' && (this.state === 'carrying' || this.state === 'hooked') ? this.towedBody() : undefined;
    if (towed === null) {
      // Gone from the road: the cable comes free.
      this.release();
      return;
    }
    if (this.state === 'carrying') {
      const d = Math.max(1, Math.hypot(this.point.x - o.x, this.point.y - o.y, this.point.z - o.z));
      this.carried = Math.min(1, this.carried + (dt * CARRY_SPEED) / d);
      const k = this.carried;
      this.end.x = o.x + (this.point.x - o.x) * k;
      this.end.y = o.y + (this.point.y - o.y) * k;
      this.end.z = o.z + (this.point.z - o.z) * k;
      if (this.carried >= 1) {
        this.state = 'hooked';
        // A little slack, as it would be laid out by hand.
        this.length = Math.min(spec.cable, d + 0.4);
        this.events.push('hooked');
      }
      return;
    }
    if (this.state === 'reeling') {
      this.carried = Math.max(0, this.carried - (dt * REEL_SPEED) / this.reelFrom);
      const k = this.carried;
      this.end.x = o.x + (this.reelStart.x - o.x) * k;
      this.end.y = o.y + (this.reelStart.y - o.y) * k;
      this.end.z = o.z + (this.reelStart.z - o.z) * k;
      if (this.carried <= 0) this.state = 'stowed';
      return;
    }
    if (this.state !== 'hooked' || !this.anchor) return;
    // Knocked down by other means (driven into): the cable comes free.
    if (!towed && this.anchor.kind !== 'stake' && this.world && !this.world.standing(this.anchor.key)) {
      this.release();
      return;
    }
    Object.assign(this.end, this.point);

    const dx = this.point.x - o.x, dy = this.point.y - o.y, dz = this.point.z - o.z;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    if (towed && !towed.dynamic) {
      // Hooked to a vehicle another browser still runs, for the moment it takes to hand it
      // over: the cable pays out freely rather than pull on one end only.
      this.length = Math.max(this.length, Math.min(spec.cable, d));
      this.tension = 0;
      this.drum = 0;
      return;
    }
    // How fast the cable's end on the vehicle moves away from the anchor (and the anchor, if it moves, away from it).
    const v = this.sim.body.linvel(), w = this.sim.body.angvel(), c = this.sim.body.worldCom();
    const [vx, vy, vz] = pointVelocity(v, w, c, o);
    let away = -(vx * nx + vy * ny + vz * nz);
    if (towed?.dynamic) {
      const [ax, ay, az] = pointVelocity(towed.dynamic.linvel(), towed.dynamic.angvel(), towed.dynamic.worldCom(), this.point);
      away += ax * nx + ay * ny + az * nz;
    }
    const stretch = d - this.length;
    this.tension = stretch > 0 ? Math.min(MAX_TENSION, Math.max(0, STIFFNESS * stretch + DAMPING * away)) : 0;

    // The drum: winding in slows as the pull rises and stops at what the winch can manage.
    if (controls.pull && !controls.slack) {
      // Like a motor's power, the speed holds up under load and falls off only near the stall.
      const load = Math.min(1, this.tension / spec.pull);
      this.drum = stretch < -0.05 ? SLACK_SPEED : spec.speed * (1 - load * load);
      // Its brakes off while it is winched, so it rolls.
      this.sim.pulled = true;
    } else if (controls.slack && !controls.pull) this.drum = -PAY_OUT_SPEED;
    else this.drum = 0;
    const was = this.length;
    this.length = Math.max(MIN_LENGTH, Math.min(spec.cable, this.length - this.drum * dt));
    if (this.length === was) this.drum = 0;

    if (this.tension > 0) {
      const j = this.tension * dt;
      this.sim.body.applyImpulseAtPoint({ x: nx * j, y: ny * j, z: nz * j }, o, true);
      // The other end: the same pull the other way.
      towed?.dynamic?.applyImpulseAtPoint({ x: -nx * j, y: -ny * j, z: -nz * j }, { ...this.point }, true);
    }
    if (towed && controls.pull) towed.towed?.();
    if (this.anchor.soft) this.plough(dt, spec.pull, nx, nz);

    // A thin tree bends over and goes when pulled on harder than it can take for a moment.
    const a = this.anchor;
    if (a.kind === 'tree' && Felling.breakable(a.diameter)) {
      this.strain += (this.tension - this.strain) * Math.min(1, dt / STRAIN_TIME);
      if (this.strain > pushForce(a.diameter)) {
        const fl = Math.hypot(nx, nz) || 1;
        this.onGiveWay?.(a, -nx / fl, -nz / fl);
        this.events.push('gaveWay');
        this.release();
      }
    }
  }

  /** A ground anchor in soft ground pulled harder than it holds drags through it towards the vehicle. */
  private plough(dt: number, pull: number, nx: number, nz: number): void {
    const a = this.anchor!;
    const hold = SOFT_HOLD * pull;
    if (this.tension <= hold) return;
    const fl = Math.hypot(nx, nz) || 1;
    const step = PLOUGH_SPEED * Math.min(1, (this.tension - hold) / (0.5 * hold)) * dt;
    const dx = (-nx / fl) * step, dz = (-nz / fl) * step;
    a.x += dx;
    a.z += dz;
    const ground = this.world?.holdAt?.(a.x, a.z);
    if (ground) a.y = ground.y + STAKE_TOP;
    Object.assign(this.point, { x: a.x, y: a.y, z: a.z });
  }

  /**
   * The vehicle the cable is hooked to, with the hook point moved to where it is on it now;
   * null when that vehicle is gone, undefined when the anchor is no vehicle.
   */
  private towedBody(): TowedBody | null | undefined {
    const a = this.anchor;
    if (a?.kind !== 'vehicle' || !a.vehicle || !a.local) return undefined;
    const body = this.world?.vehicle?.(a.vehicle) ?? null;
    if (!body) return null;
    const p = body.translation();
    const at = rotate(body.rotation(), { x: a.local[0], y: a.local[1], z: a.local[2] });
    Object.assign(this.point, { x: p.x + at.x, y: p.y + at.y, z: p.z + at.z });
    return body;
  }

  /** Everything needed to carry on running the winch in another browser. */
  save(): WinchHandover {
    const v = (p: V3): [number, number, number] => [p.x, p.y, p.z];
    const state = this.state === 'choosing' ? 'stowed' : this.state;
    return {
      state,
      ...(this.anchor && state !== 'stowed' && state !== 'reeling' && { anchor: { ...this.anchor } as AnchorData }),
      point: v(this.point),
      end: v(this.end),
      length: this.length,
      carried: this.carried,
      reelFrom: this.reelFrom,
      reelStart: v(this.reelStart),
    };
  }

  /** Carries on from what another browser saved; nothing saved, the cable is on the drum. */
  restore(s: WinchHandover | undefined): void {
    this.stow();
    if (!s || !this.spec) return;
    const p = (a: readonly number[]): V3 => ({ x: a[0]!, y: a[1]!, z: a[2]! });
    this.state = s.state;
    this.anchor = s.anchor ? (s.anchor as Anchor) : null;
    if ((this.state === 'carrying' || this.state === 'hooked') && !this.anchor) this.state = 'stowed';
    Object.assign(this.point, p(s.point));
    Object.assign(this.end, p(s.end));
    Object.assign(this.reelStart, p(s.reelStart));
    this.length = s.length;
    this.carried = s.carried;
    this.reelFrom = s.reelFrom;
    this.strain = 0;
  }

  /** The cable as others need it to draw it, or undefined while it is on the drum. */
  info(): SnapshotWinch | undefined {
    if (this.state === 'stowed' || this.state === 'choosing') return undefined;
    const r = (x: number, k = 100): number => Math.round(x * k) / k;
    const a = this.anchor;
    return {
      state: this.state,
      end: [r(this.end.x), r(this.end.y), r(this.end.z)],
      length: r(Math.max(0, this.length)),
      tension: Math.round(this.tension),
      drum: r(this.drum),
      ...(a && !a.box && a.kind !== 'vehicle' && a.kind !== 'stake' && this.state === 'hooked' && { strap: [r(a.x), r(a.y), r(a.z), r(a.radius)] }),
      ...(a?.kind === 'stake' && this.state === 'hooked' && { stake: [r(a.x), r(a.y), r(a.z)] }),
    };
  }

  /**
   * While another browser runs the vehicle: the cable as it says. Choosing stays this
   * browser's own, since what to hook on to is picked here and sent there.
   */
  mirror(w: SnapshotWinch | undefined): void {
    const state = w?.state ?? 'stowed';
    if (!(this.state === 'choosing' && (state === 'stowed' || state === 'reeling'))) {
      if (state === 'hooked' && this.state !== 'hooked') this.events.push('hooked');
      if (state === 'reeling' && (this.state === 'hooked' || this.state === 'carrying')) this.events.push('unhooked');
      this.state = state;
    }
    if (!w) {
      this.tension = this.drum = 0;
      this.anchor = null;
      return;
    }
    Object.assign(this.end, { x: w.end[0], y: w.end[1], z: w.end[2] });
    this.length = w.length;
    this.tension = w.tension;
    this.drum = w.drum;
    const s = w.strap, k = w.stake;
    this.anchor = s
      ? { key: '', kind: 'tree', x: s[0]!, y: s[1]!, z: s[2]!, radius: s[3]!, diameter: 0 }
      : k ? { key: STAKE, kind: 'stake', x: k[0]!, y: k[1]!, z: k[2]!, radius: 0, diameter: 0 } : null;
  }

  /** The winch's pull as a share of what it can manage, for the gauge. */
  get load(): number {
    const spec = this.spec;
    return spec ? this.tension / spec.pull : 0;
  }
}

/** Velocity of a point on a body moving at `v` and turning at `w` about `c`. */
function pointVelocity(v: V3, w: V3, c: V3, p: V3): [number, number, number] {
  const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
  return [v.x + w.y * rz - w.z * ry, v.y + w.z * rx - w.x * rz, v.z + w.x * ry - w.y * rx];
}
