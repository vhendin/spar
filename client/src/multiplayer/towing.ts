// Winching each other, in this browser. A cable between two vehicles is a stiff spring, so
// both ends must be simulated in one browser: the server keeps the cables and says which
// browser runs each vehicle (`towing`). This class does what that means here:
//
// - our own vehicle run elsewhere: it hands over everything about it, then follows the
//   snapshots that browser sends of it, and sends our controls there instead;
// - another driver's vehicle run here: it waits for its handover (or carries on from its last
//   snapshot), then simulates it next to ours with that driver's controls, and sends its
//   snapshots for them;
// - each winch run here hooked to another vehicle is told to the server (`cable`), and a
//   cable the server does not know comes off.

import type RAPIER from '@dimforge/rapier3d-compat';
import type { AnchorData, ClientMessage, DriveControls, ServerMessage, VehicleDef, VehicleHandover, VehicleSnapshot } from '@spar/shared';
import type { Anchor } from '../vehicle/obstacles';
import { VehicleSim, type GroundProbe, type VehicleInput } from '../vehicle/sim';
import { Winch, type AnchorSource, type TowedBody } from '../vehicle/winch';
import { applyPush, type Others } from './others';
import { takeSnapshot } from './track';

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/** Milliseconds to wait for a handover before carrying on from the last snapshot. */
export const WAIT = 1000;
/** Controls older than this (ms) count as let go: the driver's tab has gone quiet. */
const STALE = 500;
/** Milliseconds between snapshots and between controls sent. */
const SEND_EVERY = 50;

export const NO_CONTROLS: DriveControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, digital: false, pull: false, slack: false, lights: false };

/** The once-only parts of the controls: a key pressed. */
export type DriveEvent = Pick<DriveControls, 'range' | 'crawl' | 'ride' | 'lock' | 'right' | 'hook' | 'release'>;

/** Another driver's vehicle simulated here. */
interface Hosted {
  sim: VehicleSim;
  winch: Winch;
  controls: DriveControls;
  /** When their controls last came (ms). */
  heard: number;
  /** Their jump counter, carried on in the snapshots sent for them. */
  jump: number;
}

/** What the world around offers, once loaded. */
export interface TowingWorld {
  physics: RAPIER.World;
  ground: GroundProbe & { heightAt(x: number, z: number): number | null };
  /** Trees, rocks and buildings to hook on to. */
  obstacles: AnchorSource | null;
  region: string;
  sim: VehicleSim;
  winch: Winch;
  /** Our jump counter. */
  jump: number;
  /** A tree pulled over by a winch run here. */
  fell(anchor: Anchor, dx: number, dz: number): void;
}

export interface TowingGame {
  R: typeof RAPIER;
  defs: readonly VehicleDef[];
  others: Pick<Others, 'selfTrack' | 'latestOf' | 'bodyOf' | 'vehicleAnchors' | 'host'>;
  send(msg: ClientMessage): void;
  world(): TowingWorld | null;
}

/** A vehicle as its last snapshot shows it, for carrying on when no handover comes. */
export function fromSnapshot(s: VehicleSnapshot): VehicleHandover {
  return {
    vehicle: s.vehicle,
    jump: s.jump,
    p: s.p,
    q: s.q,
    v: s.paused ? [0, 0, 0] : s.v,
    w: [0, 0, 0],
    wheels: s.wheels.map((w) => [w[2]!, w[6]!, w[1]!, 0]) as VehicleHandover['wheels'],
    gear: s.engine.gear,
    low: s.engine.low,
    rpm: s.engine.rpm,
    locks: [],
    holding: false,
    drowned: s.engine.drowned,
    steer: s.wheels[0]?.[0] ?? 0,
  };
}

/** Everything about a vehicle and its winch, to hand over. */
function handover(sim: VehicleSim, winch: Winch, jump: number): VehicleHandover {
  const w = winch.save();
  return { ...sim.save(jump), ...(w.state !== 'stowed' && { winch: w }) };
}

export class Towing {
  /** Our player id. */
  me = '';
  /** Vehicles run here for their drivers. */
  readonly hosted = new Map<string, Hosted>();
  private cables: { from: string; to: string }[] = [];
  private runs = new Map<string, string>();
  /** The last `cable` or `free` the server has seen from us, and the last we sent. */
  private ack = 0;
  private seq = 0;
  /** Our last `free`: until the server has seen it, its older word on our vehicle is out of date. */
  private freeSeq = 0;
  /** Our own vehicle: run here, run elsewhere and followed, or coming back and held still. */
  private own: 'running' | 'followed' | 'waiting' = 'running';
  /** Vehicles (ours included) now ours to run, waiting for their handover until a time (ms). */
  private readonly waiting = new Map<string, number>();
  /** Per winch run here: the vehicle it was last told to the server to hold, and in which message. */
  private readonly sent = new Map<string, { to: string | null; seq: number }>();
  private sentAt = 0;
  private driveAt = 0;
  private controls: DriveControls = NO_CONTROLS;

  constructor(private readonly game: TowingGame) {}

  /** True while another browser runs our vehicle, or we wait to get it back. */
  get following(): boolean {
    return this.own !== 'running';
  }

  /** The player whose browser runs a vehicle. */
  runnerOf(id: string): string {
    return this.runs.get(id) ?? id;
  }

  /** The vehicle `from`'s winch holds, as the server has it. */
  hookedTo(from: string): string | null {
    return this.cables.find((c) => c.from === from)?.to ?? null;
  }

  /** The cables between vehicles. */
  get lines(): readonly { from: string; to: string }[] {
    return this.cables;
  }

  /** What hooks can go on to: trees, rocks and buildings, and the others' vehicles. */
  anchors(base: AnchorSource | null): AnchorSource {
    return {
      anchorsNear: (x, z, r) => [...(base?.anchorsNear(x, z, r) ?? []), ...this.game.others.vehicleAnchors(x, z, r)],
      standing: (key) => base?.standing(key) ?? true,
      vehicle: (id) => this.vehicle(id),
    };
  }

  /** A vehicle as a cable sees it: one run here can be pulled on. */
  vehicle(id: string): TowedBody | null {
    const w = this.game.world();
    const run = (sim: VehicleSim): TowedBody => ({
      translation: () => sim.body.translation(),
      rotation: () => sim.body.rotation(),
      dynamic: sim.body,
      towed: () => (sim.towed = true),
    });
    if (id === this.me) {
      if (!w) return null;
      return this.following ? { translation: () => w.sim.body.translation(), rotation: () => w.sim.body.rotation() } : run(w.sim);
    }
    const h = this.hosted.get(id);
    return h ? run(h.sim) : this.game.others.bodyOf(id);
  }

  /** The server's word on the cables and who runs what. */
  onTowing(msg: Of<'towing'>, now: number): void {
    this.cables = msg.cables;
    this.runs = new Map(msg.runs.map((r) => [r.vehicle, r.by]));
    this.ack = msg.ack;
    const w = this.game.world();
    if (!w || !this.me) return;
    // Until the server has seen our last `free`, what it says about our vehicle is older.
    const settled = this.ack >= this.freeSeq;
    const runner = this.runnerOf(this.me);
    if (settled) {
      if (this.own === 'running' && runner !== this.me) {
        this.game.send({ type: 'handover', vehicle: this.me, to: runner, state: handover(w.sim, w.winch, w.jump) });
        this.own = 'followed';
        this.game.others.selfTrack.reset();
        w.sim.follow(null, 0);
        this.sent.delete(this.me);
      } else if (this.own === 'followed' && runner === this.me) {
        this.own = 'waiting';
        this.waiting.set(this.me, now + WAIT);
      } else if (this.own === 'waiting' && runner !== this.me) {
        this.own = 'followed';
        this.waiting.delete(this.me);
      }
    }
    for (const [id] of this.hosted) {
      const r = this.runnerOf(id);
      if (r !== this.me) this.give(id, r, now);
    }
    for (const id of [...this.waiting.keys()]) if (id !== this.me && this.runnerOf(id) !== this.me) this.waiting.delete(id);
    for (const [id, by] of this.runs) if (by === this.me && !this.hosted.has(id) && !this.waiting.has(id)) this.waiting.set(id, now + WAIT);
    this.reconcile();
  }

  /** A vehicle's state from the browser that ran it before us. */
  onHandover(msg: Of<'handover'>, now: number): void {
    const w = this.game.world();
    if (!w || !this.waiting.has(msg.vehicle) || this.runnerOf(msg.vehicle) !== this.me) return;
    if (msg.vehicle === this.me) this.resume(w, msg.state);
    else this.take(w, msg.vehicle, msg.state, now);
  }

  /** The controls of a driver whose vehicle we run; keys pressed act at once. */
  onDrive(msg: Of<'drive'>, now: number): void {
    const h = this.hosted.get(msg.from);
    const w = this.game.world();
    if (!h || !w) return;
    const c = msg.controls;
    h.controls = c;
    h.heard = now;
    if (c.range) h.sim.toggleRange();
    if (c.crawl) h.sim.crawlKey(c.crawl === 'off');
    if (c.ride) h.sim.rideKey(c.ride === 'down');
    if (c.lock !== undefined) h.sim.toggleLock(c.lock);
    if (c.right && !h.sim.beingRighted) {
      h.winch.stow();
      const p = h.sim.body.translation();
      h.sim.right(w.ground.heightAt(p.x, p.z) ?? p.y - 1);
    }
    if (c.hook && c.hook.vehicle !== msg.from) h.winch.hookTo(c.hook as Anchor);
    if (c.release) h.winch.release();
  }

  /** A push from another vehicle on one run here; true if it was ours. */
  push(to: string, impulse: readonly number[], at: readonly number[]): boolean {
    const w = this.game.world();
    if (to === this.me) {
      if (!w || this.following) return false;
      applyPush(w.sim.body, impulse, at);
      return true;
    }
    const h = this.hosted.get(to);
    if (h) applyPush(h.sim.body, impulse, at);
    return false;
  }

  /** The connection came back: the server starts afresh, so does what it has seen of us. */
  reconnected(): void {
    this.ack = 0;
    this.freeSeq = 0;
    for (const s of this.sent.values()) s.seq = 0;
  }

  /**
   * Our vehicle is being moved somewhere new (a start point, another vehicle, the start
   * screen): every cable on it comes off, and it is ours to run again at once.
   */
  reclaim(): void {
    const w = this.game.world();
    if (!w) return;
    const involved = this.own !== 'running' || this.cables.some((c) => c.from === this.me || c.to === this.me);
    if (!involved) return;
    this.freeSeq = ++this.seq;
    this.game.send({ type: 'free', seq: this.freeSeq });
    if (this.own !== 'running') {
      w.sim.unfollow();
      this.own = 'running';
      this.waiting.delete(this.me);
    }
    w.winch.stow();
    this.sent.set(this.me, { to: null, seq: this.freeSeq });
  }

  /** Call every frame: handovers that never came are carried on from the last snapshot. */
  update(now: number): void {
    const w = this.game.world();
    if (!w) return;
    for (const [id, until] of this.waiting) {
      if (now < until) continue;
      if (id === this.me) {
        const s = this.game.others.selfTrack.latest;
        if (s) this.resume(w, fromSnapshot(s));
        else {
          // Nothing heard of it at all: it carries on where it stands.
          w.sim.unfollow();
          this.own = 'running';
          this.waiting.delete(id);
        }
        continue;
      }
      const s = this.game.others.latestOf(id);
      if (s) this.take(w, id, fromSnapshot(s), now);
      else this.waiting.set(id, now + WAIT);
    }
  }

  /**
   * Before each physics step, when our vehicle is run elsewhere: it is moved to where that
   * browser says (`now` in ms), and its winch shows what that one does.
   */
  follow(now: number, dt: number): void {
    const w = this.game.world();
    if (!w) return;
    const pose = this.own === 'followed' ? this.game.others.selfTrack.pose(now) : null;
    w.sim.follow(pose, dt);
    if (pose) w.winch.mirror(pose.winch);
  }

  /** Before each physics step: the vehicles run here for others, with their controls. */
  step(dt: number, now: number): void {
    for (const h of this.hosted.values()) {
      const c = now - h.heard > STALE ? NO_CONTROLS : h.controls;
      const input: VehicleInput = { throttle: c.throttle, brake: c.brake, steer: c.steer, handbrake: c.handbrake, digital: c.digital };
      h.sim.step(input, dt);
      h.winch.step(dt, { pull: c.pull, slack: c.slack });
    }
  }

  /** After each physics step: tells the server of any winch run here hooking on to a vehicle or letting go. */
  afterStep(): void {
    for (const [id, winch] of this.winches()) {
      const to = winch.towing;
      if ((this.sent.get(id)?.to ?? null) === to) continue;
      const seq = ++this.seq;
      this.game.send({ type: 'cable', from: id, ...(to && { to }), seq });
      this.sent.set(id, { to, seq });
    }
  }

  /** The colliders of every vehicle run here, ours first, by handle. */
  chassis(): Set<number> {
    const w = this.game.world();
    const out = new Set<number>(w && !this.following ? w.sim.chassis : []);
    for (const h of this.hosted.values()) for (const c of h.sim.chassis) out.add(c);
    return out;
  }

  /** Where the vehicles run here for others are, to keep the ground and trees there solid. */
  places(): { x: number; z: number }[] {
    return [...this.hosted.values()].map((h) => {
      const p = h.sim.body.translation();
      return { x: p.x, z: p.z };
    });
  }

  /** Call every frame: snapshots of the vehicles run here for others. `paused` while we are. */
  send(now: number, paused: boolean): void {
    if (this.hosted.size === 0 || now - this.sentAt < SEND_EVERY) return;
    this.sentAt = now;
    for (const [id, h] of this.hosted) this.game.send({ type: 'state', of: id, vehicle: this.snapshot(h, now, paused) });
  }

  /** Call every frame while our vehicle is run elsewhere: our controls, sent there. */
  drive(controls: DriveControls, now: number): void {
    this.controls = controls;
    if (now - this.driveAt < SEND_EVERY) return;
    this.driveAt = now;
    this.game.send({ type: 'drive', controls });
  }

  /** A key pressed while our vehicle is run elsewhere: sent there at once. */
  event(e: DriveEvent): void {
    this.game.send({ type: 'drive', controls: { ...this.controls, ...e } });
  }

  /**
   * The winch key while our vehicle is run elsewhere: choosing happens here, hooking on and
   * letting go there.
   */
  winchKey(winch: Winch): void {
    if (winch.state === 'choosing') {
      const a = winch.pickedAnchor;
      winch.cancel();
      if (a) this.event({ hook: a as AnchorData });
    } else if (winch.state === 'hooked' || winch.state === 'carrying') this.event({ release: true });
    else winch.choose();
  }

  /** Our winch and those of the vehicles run here, by player. */
  private winches(): [string, Winch][] {
    const w = this.game.world();
    const out: [string, Winch][] = w && !this.following ? [[this.me, w.winch]] : [];
    for (const [id, h] of this.hosted) out.push([id, h.winch]);
    return out;
  }

  /**
   * After the server's word: a winch here holding a vehicle the server has no cable to lets
   * go; one the server thinks holds a vehicle when it does not is told to the server again.
   * Only once the server has seen the last we sent about that winch.
   */
  private reconcile(): void {
    for (const [id, winch] of this.winches()) {
      const last = this.sent.get(id);
      if (last && last.seq > this.ack) continue;
      const server = this.hookedTo(id);
      const to = winch.towing;
      if (to === server) continue;
      if (to) winch.release();
      this.sent.set(id, { to: server, seq: last?.seq ?? 0 });
    }
  }

  /** Our own vehicle back, as the browser that ran it left it. */
  private resume(w: TowingWorld, state: VehicleHandover): void {
    w.sim.load(state);
    w.winch.restore(state.winch);
    this.own = 'running';
    this.waiting.delete(this.me);
    this.sent.set(this.me, { to: this.hookedTo(this.me), seq: 0 });
  }

  /** Another driver's vehicle, simulated here from now on. */
  private take(w: TowingWorld, id: string, state: VehicleHandover, now: number): void {
    this.waiting.delete(id);
    const def = this.game.defs.find((d) => d.name === state.vehicle);
    if (!def || this.hosted.has(id)) return;
    const sim = new VehicleSim(this.game.R, w.physics, def, w.ground);
    sim.load(state);
    const winch = new Winch(sim, this.anchors(w.obstacles));
    winch.restore(state.winch);
    winch.onGiveWay = (a, dx, dz) => w.fell(a, dx, dz);
    const h: Hosted = { sim, winch, controls: NO_CONTROLS, heard: now, jump: state.jump };
    this.hosted.set(id, h);
    this.sent.set(id, { to: this.hookedTo(id), seq: 0 });
    this.game.others.host(id, { snapshot: () => this.snapshot(h, now, false) }, now);
  }

  /** A vehicle run here goes to another browser, with everything about it. */
  private give(id: string, to: string, now: number): void {
    const h = this.hosted.get(id);
    if (!h) return;
    this.game.send({ type: 'handover', vehicle: id, to, state: handover(h.sim, h.winch, h.jump) });
    this.game.others.host(id, null, now);
    this.hosted.delete(id);
    this.sent.delete(id);
    h.sim.dispose();
  }

  private snapshot(h: Hosted, t: number, paused: boolean): VehicleSnapshot {
    const c = h.controls;
    const w = this.game.world();
    return takeSnapshot(h.sim, {
      region: w?.region ?? '',
      jump: h.jump,
      t,
      paused,
      lights: c.lights,
      braking: h.sim.drivetrain.gear > 0 ? c.brake > 0.05 : c.throttle > 0.05,
      winch: h.winch.info(),
    });
  }
}
