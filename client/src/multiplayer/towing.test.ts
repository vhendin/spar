// Three browsers in one test, each with its own physics world, talking through a stand-in for
// the server that keeps the cables with the server's own rules (server/src/towing.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage, VehicleDef, VehicleSnapshot } from '@spar/shared';
import { Towing as ServerTowing } from '../../../server/src/towing';
import type { Anchor } from '../vehicle/obstacles';
import { GROUP_GROUND, groups, VehicleSim, type VehicleInput } from '../vehicle/sim';
import { Winch, type WinchControls } from '../vehicle/winch';
import type { HostedView } from './others';
import { snapshotPose, takeSnapshot, Track } from './track';
import { Towing, WAIT } from './towing';

const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, `../../../defs/vehicles/${name}.json`), 'utf8')) as VehicleDef;
const DEFS = ['tgb11', 'ltb4', 'lc200'].map(load);
const DT = 1 / 60;
const idle: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

beforeAll(() => RAPIER.init());

/** The others' vehicles as one browser knows them: their snapshots, and those it runs. */
class FakeOthers {
  readonly selfTrack = new Track();
  readonly tracks = new Map<string, Track>();
  readonly hosted = new Map<string, HostedView>();
  constructor(readonly me: string) {}
  receive(id: string, s: VehicleSnapshot, now: number, by: string): void {
    if (id === this.me) return this.selfTrack.push(s, now, by);
    if (this.hosted.has(id)) return;
    if (!this.tracks.has(id)) this.tracks.set(id, new Track());
    this.tracks.get(id)!.push(s, now, by);
  }
  latestOf(id: string): VehicleSnapshot | undefined {
    return this.tracks.get(id)?.latest;
  }
  bodyOf(id: string) {
    const s = this.hosted.get(id)?.snapshot() ?? this.latestOf(id);
    if (!s) return null;
    return { translation: () => ({ x: s.p[0]!, y: s.p[1]!, z: s.p[2]! }), rotation: () => ({ x: s.q[0]!, y: s.q[1]!, z: s.q[2]!, w: s.q[3]! }) };
  }
  vehicleAnchors(): Anchor[] {
    return [];
  }
  host(id: string, view: HostedView | null, now: number): void {
    const was = this.hosted.get(id);
    if (view) this.hosted.set(id, view);
    else if (was) {
      this.hosted.delete(id);
      if (!this.tracks.has(id)) this.tracks.set(id, new Track());
      this.tracks.get(id)!.push(was.snapshot(), now, 'here');
    }
  }
  /** Where a vehicle is drawn: from the simulation run here, or its snapshots. */
  where(id: string, now: number): number[] | undefined {
    const h = this.hosted.get(id);
    return h ? snapshotPose(h.snapshot()).p : this.tracks.get(id)?.pose(now)?.p;
  }
}

interface Browser {
  id: string;
  world: RAPIER.World;
  sim: VehicleSim;
  winch: Winch;
  others: FakeOthers;
  towing: Towing;
  input: VehicleInput;
  winching: WinchControls;
  sentAt: number;
}

/** Browsers driving on a flat field, with a server passing their messages on a frame later. */
function setup(...drivers: { id: string; vehicle: string; z: number }[]) {
  const server = new ServerTowing();
  const acks = new Map<string, number>();
  const queue: { to: string; msg: ServerMessage }[] = [];
  const browsers = new Map<string, Browser>();
  let now = 1000;

  const toAll = (msg: Omit<Extract<ServerMessage, { type: 'towing' }>, 'ack'>): void => {
    for (const id of browsers.keys()) queue.push({ to: id, msg: { ...msg, ack: acks.get(id) ?? 0 } });
  };
  const receive = (from: string, msg: ClientMessage): void => {
    switch (msg.type) {
      case 'state': {
        const of = msg.of ?? from;
        if (server.runnerOf(of) !== from) return;
        for (const id of browsers.keys()) if (id !== from) queue.push({ to: id, msg: { type: 'state', id: of, ...(msg.of && { by: from }), vehicle: msg.vehicle } });
        return;
      }
      case 'cable': {
        acks.set(from, msg.seq);
        if (server.runnerOf(msg.from) === from) {
          if (msg.to) server.hook(msg.from, msg.to);
          else server.unhook(msg.from);
        }
        return toAll({ type: 'towing', ...server.list() });
      }
      case 'free':
        acks.set(from, msg.seq);
        server.free(from);
        return toAll({ type: 'towing', ...server.list() });
      case 'drive': {
        const runner = server.runnerOf(from);
        if (runner !== from) queue.push({ to: runner, msg: { type: 'drive', from, controls: msg.controls } });
        return;
      }
      case 'handover':
        queue.push({ to: msg.to, msg: { type: 'handover', from, vehicle: msg.vehicle, state: msg.state } });
        return;
    }
  };

  for (const d of drivers) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    world.createCollider(RAPIER.ColliderDesc.cuboid(400, 1, 400).setTranslation(0, -1, 0).setCollisionGroups(groups(GROUP_GROUND, 0xffff)));
    const ground = { groundAt: () => 'dirt', wetness: () => 0, softness: () => 0, waterDepth: () => 0, heightAt: () => 0 };
    const sim = new VehicleSim(RAPIER, world, DEFS.find((v) => v.name === d.vehicle)!, ground);
    sim.place(0, 0.05, d.z, 0);
    const others = new FakeOthers(d.id);
    // eslint-disable-next-line prefer-const
    let b: Browser;
    const towing = new Towing({
      R: RAPIER,
      defs: DEFS,
      others,
      send: (msg) => receive(d.id, msg),
      world: () => ({ physics: world, ground, obstacles: null, region: 'field', sim, winch: b.winch, jump: 0, fell: () => {} }),
    });
    towing.me = d.id;
    const winch = new Winch(sim, towing.anchors(null));
    b = { id: d.id, world, sim, winch, others, towing, input: { ...idle }, winching: { pull: false, slack: false }, sentAt: 0 };
    browsers.set(d.id, b);
  }

  /** Runs every browser for a while, frame by frame, as main.ts does. */
  const run = (seconds: number): void => {
    for (let f = 0; f < Math.round(seconds / DT); f++) {
      now += DT * 1000;
      for (const { to, msg } of queue.splice(0)) {
        const b = browsers.get(to)!;
        if (msg.type === 'towing') b.towing.onTowing(msg, now);
        else if (msg.type === 'handover') b.towing.onHandover(msg, now);
        else if (msg.type === 'drive') b.towing.onDrive(msg, now);
        else if (msg.type === 'state') b.others.receive(msg.id, msg.vehicle, now, msg.by ?? msg.id);
      }
      for (const b of browsers.values()) {
        if (b.towing.following) b.towing.follow(now, DT);
        else {
          b.sim.step(b.input, DT);
          b.winch.step(DT, b.winching);
        }
        b.towing.step(DT, now);
        b.world.step();
        b.towing.afterStep();
        b.towing.update(now);
        if (b.towing.following) {
          b.towing.drive({ ...idle, digital: false, ...b.input, ...b.winching, lights: false } as never, now);
        } else if (now - b.sentAt >= 50) {
          b.sentAt = now;
          receive(b.id, { type: 'state', vehicle: takeSnapshot(b.sim, { region: 'field', jump: 0, t: now, paused: false, lights: false, braking: false, winch: b.winch.info() }) });
        }
        b.towing.send(now, false);
      }
    }
  };
  const anchorOn = (id: string, end: 'front_tow' | 'rear_tow'): Anchor => {
    const b = browsers.get(id)!;
    const local = b.sim.def.attachments.find((a) => a.name === end)!.position as [number, number, number];
    const p = b.sim.body.translation();
    return { key: `v:${id}`, kind: 'vehicle', x: p.x, y: p.y + local[1], z: p.z + local[2], radius: 0, diameter: 0, vehicle: id, local };
  };
  return { browsers: (id: string) => browsers.get(id)!, server, run, anchorOn, now: () => now };
}

describe('winching each other', () => {
  it('the puller runs the vehicle it hooks on to; its driver follows it, steers it from afar and gets it back', () => {
    const { browsers, server, run, anchorOn, now } = setup({ id: 'anna', vehicle: 'tgb11', z: 0 }, { id: 'bo', vehicle: 'ltb4', z: -20 });
    const anna = browsers('anna'), bo = browsers('bo');
    anna.input.handbrake = true;
    run(1);
    anna.winch.hookTo(anchorOn('bo', 'rear_tow'));
    run(0.5);
    // Anna's browser now runs Bo's vehicle; Bo's follows it.
    expect(server.runnerOf('bo')).toBe('anna');
    expect(anna.towing.hosted.has('bo')).toBe(true);
    expect(bo.towing.following).toBe(true);
    expect(anna.winch.state).toBe('hooked');

    const start = bo.sim.body.translation().z;
    anna.winching.pull = true;
    run(6);
    // Pulled closer, in Anna's world and, a moment later, in Bo's.
    const hosted = anna.towing.hosted.get('bo')!.sim.body.translation().z;
    expect(hosted - start).toBeGreaterThan(1.5);
    expect(Math.abs(bo.sim.body.translation().z - hosted)).toBeLessThan(0.5);
    expect(bo.winch.state).toBe('stowed');

    // Bo's controls reach Anna's browser: a tap of L changes range there.
    bo.towing.event({ range: true });
    bo.input.steer = 0.5;
    run(0.3);
    const there = anna.towing.hosted.get('bo')!.sim;
    expect(there.drivetrain.range).toBe('low');
    expect(there.wheels[0]!.steer).not.toBe(0);
    expect(bo.sim.drivetrain.range).toBe('low'); // shown from the snapshots

    // Anna lets go: Bo's vehicle is his again, carrying on where her browser left it.
    anna.winching.pull = false;
    bo.input.steer = 0;
    anna.winch.release();
    run(0.3);
    expect(server.runnerOf('bo')).toBe('bo');
    expect(anna.towing.hosted.size).toBe(0);
    expect(bo.towing.following).toBe(false);
    expect(Math.abs(bo.sim.body.translation().z - hosted)).toBeLessThan(1);
    expect(bo.sim.drivetrain.range).toBe('low');
    // And Anna draws it from his snapshots again, where it is.
    run(0.5);
    expect(Math.abs(anna.others.where('bo', now())![2]! - bo.sim.body.translation().z)).toBeLessThan(0.3);
  });

  it('a towed vehicle winching a third: one browser runs the chain', () => {
    const { browsers, server, run, anchorOn } = setup({ id: 'anna', vehicle: 'tgb11', z: 0 }, { id: 'bo', vehicle: 'ltb4', z: -20 }, { id: 'cecilia', vehicle: 'lc200', z: -45 });
    const anna = browsers('anna'), bo = browsers('bo'), cecilia = browsers('cecilia');
    run(1);
    anna.winch.hookTo(anchorOn('bo', 'rear_tow'));
    run(0.5);
    // Bo, followed, picks Cecilia here; the hook goes on in Anna's browser.
    bo.towing.event({ hook: anchorOn('cecilia', 'rear_tow') as never });
    run(1);
    expect(server.list().cables).toEqual(expect.arrayContaining([{ from: 'anna', to: 'bo' }, { from: 'bo', to: 'cecilia' }]));
    expect(server.runnerOf('cecilia')).toBe('anna');
    expect(anna.towing.hosted.has('cecilia')).toBe(true);
    expect(cecilia.towing.following).toBe(true);
    // Bo's own browser shows his cable as Anna's runs it.
    expect(bo.winch.state).toBe('hooked');

    // Anna lets go of Bo: Bo, at the head of what is left, runs Cecilia too.
    anna.winch.release();
    run(0.5);
    expect(server.runnerOf('bo')).toBe('bo');
    expect(server.runnerOf('cecilia')).toBe('bo');
    expect(bo.towing.following).toBe(false);
    expect(bo.winch.state).toBe('hooked');
    expect(bo.towing.hosted.has('cecilia')).toBe(true);
    expect(anna.towing.hosted.size).toBe(0);
    expect(cecilia.towing.following).toBe(true);
  });

  it('a driver moving their vehicle away takes every cable off it at once', () => {
    const { browsers, server, run, anchorOn } = setup({ id: 'anna', vehicle: 'tgb11', z: 0 }, { id: 'bo', vehicle: 'ltb4', z: -20 });
    const anna = browsers('anna'), bo = browsers('bo');
    run(1);
    anna.winch.hookTo(anchorOn('bo', 'rear_tow'));
    run(0.5);
    expect(bo.towing.following).toBe(true);
    // Bo goes back to a start point.
    bo.towing.reclaim();
    bo.sim.place(100, 0.05, 100, 0);
    expect(bo.towing.following).toBe(false);
    run(0.5);
    expect(server.list().cables).toEqual([]);
    expect(anna.winch.towing).toBeNull();
    expect(anna.towing.hosted.size).toBe(0);
    // Anna's late handover did not pull Bo back.
    expect(bo.sim.body.translation().x).toBeCloseTo(100, 0);
  });

  it('carries on from the last snapshot when no handover comes', () => {
    const { browsers, run, anchorOn } = setup({ id: 'anna', vehicle: 'tgb11', z: 0 }, { id: 'bo', vehicle: 'ltb4', z: -20 });
    const anna = browsers('anna'), bo = browsers('bo');
    run(1);
    // Bo's browser gives no handover: as if it were lost on the way.
    const send = (bo.towing as unknown as { game: { send: (m: ClientMessage) => void } }).game;
    const real = send.send;
    send.send = (m) => (m.type === 'handover' ? undefined : real(m));
    anna.winch.hookTo(anchorOn('bo', 'rear_tow'));
    run(0.5);
    expect(anna.towing.hosted.has('bo')).toBe(false);
    run(WAIT / 1000);
    expect(anna.towing.hosted.has('bo')).toBe(true);
    expect(anna.towing.hosted.get('bo')!.sim.body.translation().z).toBeCloseTo(-20, 0);
  });
});
