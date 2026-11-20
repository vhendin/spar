// The other drivers: who is connected, and their vehicles drawn where their snapshots say,
// with their name over each. Only those in the same region as us are drawn. Each has its
// spray, exhaust, tracks, mud and sound, worked out here from what its snapshots tell, and a
// solid body in our physics: our vehicle bounces off it, and the push goes to its driver,
// whose browser moves it. A vehicle this browser runs for its driver (joined to ours by a
// cable) is drawn from that simulation instead (`host`). Everyone's winch cable is drawn too.

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { Player, SnapshotWinch, VehicleDef, VehicleSnapshot } from '@spar/shared';
import type { AudioOut } from '../audio/output';
import { VehicleAudio } from '../audio/vehicleAudio';
import { Exhaust } from '../vehicle/exhaust';
import { GROUP_VEHICLE, groups, type WheelTelemetry } from '../vehicle/sim';
import { Spray } from '../vehicle/spray';
import type { VehicleState } from '../vehicle/state';
import { Tracks } from '../vehicle/tracks';
import { aimBeam, HEADLIGHT, newBeam, VehicleView } from '../vehicle/view';
import type { Anchor } from '../vehicle/obstacles';
import { WinchView, type CableView } from '../vehicle/winchView';
import type { PlayerLine } from '../ui/players';
import { snapshotPose, Track, type Pose } from './track';

type Rapier = typeof RAPIER;

/** A vehicle not heard from for this long (ms) is taken away. */
const SILENT = 5000;
/** Name tags are fully clear up to this distance (m) and gone at FADE_TO. */
const FADE_FROM = 120;
const FADE_TO = 600;
/**
 * How many of the others get real headlight beams, the nearest with their lights on. The
 * beams are made once, when the first other vehicle shows, and handed between vehicles after:
 * every light costs all materials on screen, and adding or removing one rebuilds them all.
 */
const BEAM_CARS = 2;
/** Metres between vehicles set down at the same start point. */
const SPACING = 9;
/** Within this distance (m) of the camera another vehicle throws spray and smoke and leaves tracks. */
const EFFECTS = 400;
/** Heard within HEAR metres; its sound is let go beyond FORGET. */
const HEAR = 300;
const FORGET = 380;
/**
 * At most this many others are heard, the nearest: each vehicle's sound is some thirty audio
 * nodes and an engine of its own, running whether loud or not.
 */
const MOST_HEARD = 3;
/** How far (m) the chase camera keeps from the others' bodywork. */
const CAMERA_MARGIN = 0.5;
/** A body further than this (m) from where it should be is put there at once instead of moved. */
const TELEPORT = 5;
/**
 * Pushes up to GENTLE m/s of speed change per message are a steady shove (0.8 g for 50 ms is
 * 0.4) and pass whole; above it only HARD_SHARE of the rest; never more than MOST_PUSH.
 */
const GENTLE = 0.5;
const HARD_SHARE = 0.5;
const MOST_PUSH = 2;

/** Another driver's vehicle as the view and the effects need it, moved along by their snapshots. */
class RemoteVehicle implements VehicleState {
  readonly wheels: WheelTelemetry[];
  readonly drivetrain = { gear: 1, range: 'high' as 'high' | 'low', rpm: 0, shifting: 0 };
  speed = 0;
  pedal = 0;
  drowned = false;
  wading = 0;
  private pose: Pose | null = null;
  /** Suspension length at rest and travel, per wheel, for how hard each is pushed up. */
  private readonly rest: number[] = [];
  private readonly travel: number[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  readonly body = {
    translation: () => {
      const p = this.pose?.p ?? [0, -1e4, 0];
      return { x: p[0], y: p[1], z: p[2] };
    },
    rotation: () => {
      const q = this.pose?.q ?? [0, 0, 0, 1];
      return { x: q[0], y: q[1], z: q[2], w: q[3] };
    },
    linvel: () => {
      const v = this.pose?.v ?? [0, 0, 0];
      return { x: v[0], y: v[1], z: v[2] };
    },
    mass: () => this.def.chassis.mass,
  };

  constructor(readonly def: VehicleDef) {
    const load = (def.chassis.mass * 9.81) / (def.axles.length * 2);
    this.wheels = def.axles.flatMap((axle) =>
      [0, 1].map(() => {
        // As in the simulation: long enough to stretch its full travel below where it rests.
        const rest = axle.suspension.travel + load / axle.suspension.stiffness;
        this.rest.push(rest);
        this.travel.push(axle.suspension.travel);
        return { contact: false, load: 0, ground: 'dirt', grip: 0.6, spin: 0, skid: 0, slide: 0, suspension: rest, bump: 0, steer: 0, rotation: 0, sink: 0, softness: 0, snow: 0, water: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
      }),
    );
  }

  wheelPosition(i: number): { x: number; y: number; z: number } {
    const axle = this.def.axles[i >> 1]!;
    // As in the simulation: the strut's top sits a wheel radius and a full travel above the tyre's bottom at rest.
    const top = this.def.wheels.radius + axle.suspension.travel;
    return { x: ((i & 1 ? -1 : 1) * axle.track) / 2, y: top - this.wheels[i]!.suspension, z: axle.z };
  }

  /** Takes the pose for this frame; the wheels roll on with the ground speed. */
  set(pose: Pose, dt: number): void {
    this.pose = pose;
    this.speed = pose.speed;
    const e = pose.engine;
    Object.assign(this.drivetrain, { gear: e.gear, range: e.low ? 'low' : 'high', rpm: e.rpm, shifting: e.shifting ? 0.1 : 0 });
    this.pedal = e.pedal;
    this.drowned = e.drowned;
    this.wading = pose.wading;
    this.q.set(...pose.q);
    const roll = (pose.speed / this.def.wheels.radius) * dt;
    const r = this.def.wheels.radius;
    const load = (this.def.chassis.mass * 9.81) / this.wheels.length;
    const up = this.v.set(0, 1, 0).applyQuaternion(this.q);
    const normal = { x: up.x, y: up.y, z: up.z };
    this.wheels.forEach((w, i) => {
      const [steer = 0, suspension = w.suspension, sink = 0, spin = 0, skid = 0, slide = 0, water = 0] = pose.wheels[i] ?? [];
      const ground = pose.ground[i] ?? '';
      Object.assign(w, { steer, suspension, sink, spin, skid, slide, water });
      w.rotation = (w.rotation + roll) % (Math.PI * 2);
      w.contact = ground !== '';
      if (w.contact) w.ground = ground;
      w.load = w.contact ? load : 0;
      w.bump = Math.min(1, Math.max(0, (this.rest[i]! - suspension) / this.travel[i]!));
      // Where the tyre meets the surface: its bottom, lifted by what it has sunk into the mud or water.
      const at = this.wheelPosition(i);
      const p = new THREE.Vector3(at.x, at.y - r + sink + water, at.z).applyQuaternion(this.q);
      Object.assign(w.point, { x: p.x + pose.p[0], y: p.y + pose.p[1], z: p.z + pose.p[2] });
      Object.assign(w.normal, normal);
    });
  }
}

/** Another driver's cable, drawn from what their snapshots say. */
class RemoteCable implements CableView {
  readonly choices: Anchor[] = [];
  readonly picked = 0;
  state: CableView['state'] = 'stowed';
  readonly end = { x: 0, y: 0, z: 0 };
  length = 0;
  tension = 0;
  anchor: CableView['anchor'] = null;

  constructor(readonly def: VehicleDef) {}

  set(w: SnapshotWinch): void {
    this.state = w.state;
    Object.assign(this.end, { x: w.end[0], y: w.end[1], z: w.end[2] });
    this.length = w.length;
    this.tension = w.tension;
    const s = w.strap;
    this.anchor = s ? { kind: 'tree', x: s[0]!, y: s[1]!, z: s[2]!, radius: s[3]! } : null;
  }

  origin(): { x: number; y: number; z: number } {
    return this.end;
  }
}

/** A vehicle this browser runs for another driver, as it is now. */
export interface HostedView {
  snapshot(): VehicleSnapshot;
}

/** Something to put on the map: another driver's vehicle. */
export interface Marker {
  x: number;
  z: number;
  /** Degrees, 0 north, 90 east. */
  heading: number;
  name: string;
  color: string;
}

/** A push from our vehicle on another's, to send to its driver. */
export interface Push {
  to: string;
  impulse: [number, number, number];
  at: [number, number, number];
}

/** What the effects need of the world around, each frame. */
export interface Surroundings {
  wetness: number;
  rain: number;
  /** m/s, x east, y south. */
  wind: THREE.Vector2;
  celsius: number;
  heightAt(x: number, z: number): number | null;
}

/** Marker colour for a driver who keeps their vehicle's own paint. */
const PLAIN = '#ecebe6';

interface Effects {
  spray: Spray;
  exhaust: Exhaust;
  tracks: Tracks;
  /** The jump counter the tracks were laid under; a new one breaks them. */
  jump: number;
}

interface Other {
  player: Player;
  track: Track;
  vehicle: RemoteVehicle | null;
  view: VehicleView | null;
  /** What the view was built for, to rebuild it on a change of vehicle or paint. */
  built: string;
  tag: HTMLDivElement;
  away: boolean;
  effects: Effects | null;
  sound: VehicleAudio | null;
  /** Its solid body in our physics, and what it was built for. */
  solid: RAPIER.RigidBody | null;
  solidFor: string;
  /** Pushes from our vehicle gathered since the last send: impulse, and points weighted by it. */
  push: THREE.Vector3;
  pushAt: THREE.Vector3;
  pushWeight: number;
  /** Set while this browser runs the vehicle: drawn from that, not from snapshots. */
  hosted: HostedView | null;
  /** Its winch cable, while out. */
  cable: { view: WinchView; state: RemoteCable } | null;
}

export class Others {
  /** Everyone connected, ourselves included, in the server's order. */
  players: Player[] = [];
  /** Snapshots of our own vehicle, sent by another browser while it runs it for us. */
  readonly selfTrack = new Track();
  /** Our own player id once welcomed. */
  me = '';
  /** The region we drive in; others elsewhere are not drawn. */
  region = '';
  /** Where the others' sounds go; none until set. */
  audio: AudioOut | null = null;
  private readonly others = new Map<string, Other>();
  private readonly tags: HTMLDivElement;
  private readonly at = new THREE.Vector3();
  private readonly lo = new THREE.Vector3();
  private readonly hi = new THREE.Vector3();
  private readonly box = new THREE.Box3();
  private readonly ray = new THREE.Ray();
  private readonly inverse = new THREE.Matrix4();
  /** Pairs of beams lent to the nearest others; made with the first other vehicle. */
  private beams: [THREE.SpotLight, THREE.SpotLight][] = [];
  private physics: { R: Rapier; world: RAPIER.World } | null = null;
  /** Collider handles of the others' bodies, and whose they are. */
  private readonly owners = new Map<number, Other>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly defs: VehicleDef[],
  ) {
    this.tags = document.createElement('div');
    this.tags.id = 'tags';
    document.body.append(this.tags);
  }

  /** The players' list from the server. */
  setPlayers(players: Player[]): void {
    this.players = players;
    for (const p of players) {
      const o = this.others.get(p.id);
      if (o) o.player = p;
    }
    for (const [id, o] of this.others) if (!players.some((p) => p.id === id)) this.remove(id, o);
  }

  /** The physics world our vehicle drives in; the others' bodies are made in it. */
  attach(R: Rapier, world: RAPIER.World): void {
    if (this.physics?.world === world) return;
    // The old world's bodies went with it.
    for (const o of this.others.values()) {
      o.solid = null;
      o.solidFor = '';
    }
    this.owners.clear();
    this.physics = { R, world };
  }

  /**
   * A snapshot of a driver's vehicle, sent by `by`'s browser (theirs, unless another runs it);
   * true when they have just come on the road, or moved region. Our own vehicle's go to
   * `selfTrack`; those of a vehicle we run ourselves are stale and left out.
   */
  receive(id: string, s: VehicleSnapshot, now: number, by = id): boolean {
    if (id === this.me) {
      this.selfTrack.push(s, now, by);
      return false;
    }
    if (this.others.get(id)?.hosted) return false;
    let o = this.others.get(id);
    const news = !o || o.away || o.track.latest?.region !== s.region;
    if (!o) {
      const player = this.players.find((p) => p.id === id) ?? { id, name: '…' };
      const tag = document.createElement('div');
      tag.className = 'tag';
      this.tags.append(tag);
      o = {
        player, track: new Track(), vehicle: null, view: null, built: '', tag, away: false, effects: null, sound: null,
        solid: null, solidFor: '', push: new THREE.Vector3(), pushAt: new THREE.Vector3(), pushWeight: 0, hosted: null, cable: null,
      };
      this.others.set(id, o);
    }
    o.away = false;
    o.track.push(s, now, by);
    return news;
  }

  /**
   * This browser runs another driver's vehicle from now on (`view`), or no longer (null): then
   * it is drawn from snapshots again, starting where it was last run here.
   */
  host(id: string, view: HostedView | null, now: number): void {
    if (id === this.me) return;
    const was = this.others.get(id)?.hosted;
    if (view) {
      if (!this.others.has(id)) this.receive(id, view.snapshot(), now, 'here');
      this.others.get(id)!.hosted = view;
      return;
    }
    const o = this.others.get(id);
    if (!o || !was) return;
    o.hosted = null;
    o.track.push(was.snapshot(), now, 'here');
  }

  /** The newest snapshot of another driver's vehicle. */
  latestOf(id: string): VehicleSnapshot | undefined {
    return this.others.get(id)?.track.latest;
  }

  /** Another driver's vehicle as a cable sees it, or null when it is not on the road here. */
  bodyOf(id: string): { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } } | null {
    const o = this.others.get(id);
    if (!o || o.away || !o.view?.group.visible || !o.vehicle) return null;
    return o.solid ?? o.vehicle.body;
  }

  /** The others' vehicles within `radius` of (x, z) as winch anchors: each tow point is one, picked by aiming at it. */
  vehicleAnchors(x: number, z: number, radius: number): Anchor[] {
    const out: Anchor[] = [];
    for (const [id, o] of this.others) {
      const body = this.bodyOf(id);
      const def = o.vehicle?.def;
      if (!body || !def) continue;
      const p = body.translation(), r = body.rotation();
      const q = this.inverse.makeRotationFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      for (const name of ['front_tow', 'rear_tow']) {
        const at = def.attachments.find((a) => a.name === name)?.position;
        if (!at) continue;
        const w = this.at.set(at[0]!, at[1]!, at[2]!).applyMatrix4(q).add(this.lo.set(p.x, p.y, p.z));
        if (Math.hypot(w.x - x, w.z - z) > radius) continue;
        out.push({ key: `v:${id}:${name}`, kind: 'vehicle', x: w.x, y: w.y, z: w.z, radius: 0, diameter: 0, vehicle: id, local: [at[0]!, at[1]!, at[2]!] });
      }
    }
    return out;
  }

  /** Another driver has gone back to the start screen. */
  away(id: string): void {
    const o = this.others.get(id);
    if (o) o.away = true;
  }

  /** Who is in which region, for the player lists: names, colours, and whether they are with us. */
  list(): PlayerLine[] {
    return this.players.map((p) => {
      const o = this.others.get(p.id);
      const s = o?.track.latest;
      const you = p.id === this.me;
      const region = you ? this.region : (p.region ?? '');
      const driving = !!s && !o!.away && s.region === region;
      return {
        id: p.id,
        name: p.name,
        color: p.color ?? PLAIN,
        here: you || (region === this.region && region !== ''),
        you,
        paused: !!s?.paused,
        region,
        driving: you || driving,
      };
    });
  }

  /** Where another driver's vehicle is now, from what they last sent, or null if not on the road. */
  whereIs(id: string): { region: string; x: number; z: number; heading: number; name: string } | null {
    const o = this.others.get(id);
    const s = o?.track.latest;
    if (!o || !s || o.away) return null;
    const [x, y, z, w] = s.q as [number, number, number, number];
    const heading = 180 - THREE.MathUtils.radToDeg(Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x)));
    return { region: s.region, x: s.p[0]!, z: s.p[2]!, heading: ((heading % 360) + 360) % 360, name: o.player.name };
  }

  /**
   * A place at or behind (x, z) facing `heading` (degrees, 0 north) with no other vehicle
   * within reach, so two drivers setting off from one start point do not end up in each other.
   */
  clearSpot(x: number, z: number, heading: number): { x: number; z: number } {
    const others = this.markers();
    const h = THREE.MathUtils.degToRad(heading);
    // Behind is south for a vehicle facing north; world z grows southwards.
    const bx = -Math.sin(h), bz = Math.cos(h);
    for (let k = 0; k < 8; k++) {
      const px = x + bx * k * SPACING, pz = z + bz * k * SPACING;
      if (others.every((o) => Math.hypot(o.x - px, o.z - pz) > SPACING)) return { x: px, z: pz };
    }
    return { x, z };
  }

  /** The other vehicles in our region, for the map. */
  markers(): Marker[] {
    const out: Marker[] = [];
    for (const o of this.others.values()) {
      if (!o.view?.group.visible || !o.vehicle) continue;
      const p = o.vehicle.body.translation(), r = o.vehicle.body.rotation();
      const heading = 180 - THREE.MathUtils.radToDeg(Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)));
      out.push({ x: p.x, z: p.z, heading, name: o.player.name, color: o.player.color ?? PLAIN });
    }
    return out;
  }

  /**
   * How high a camera looking from `from` to `to` must be to clear the others' vehicles: the
   * roof height plus a margin of the first one the sight line passes through, or null.
   */
  clearance(from: THREE.Vector3, to: THREE.Vector3): number | null {
    let need: number | null = null;
    const length = from.distanceTo(to);
    if (length < 1e-3) return null;
    for (const o of this.others.values()) {
      const view = o.view, def = o.vehicle?.def;
      if (!view?.group.visible || !def) continue;
      const c = def.chassis.box.center, size = def.chassis.box.size;
      const box = this.box.set(
        this.lo.set(c[0]! - size[0]! / 2, 0, c[2]! - size[2]! / 2).subScalar(CAMERA_MARGIN),
        this.hi.set(c[0]! + size[0]! / 2, Math.max(def.body.height, c[1]! + size[1]! / 2), c[2]! + size[2]! / 2).addScalar(CAMERA_MARGIN),
      );
      // The sight line in the vehicle's own frame.
      this.inverse.copy(view.group.matrixWorld).invert();
      const a = this.at.copy(from).applyMatrix4(this.inverse);
      const b = this.lo.copy(to).applyMatrix4(this.inverse);
      this.ray.set(a, b.sub(a).normalize());
      const hit = this.ray.intersectBox(box, this.hi);
      if (!hit || hit.distanceTo(a) > length) continue;
      const roof = view.group.position.y + box.max.y + 0.6;
      need = Math.max(need ?? -Infinity, roof);
    }
    return need;
  }

  /** Whether a collider is one of the others' vehicles. */
  owns(handle: number): boolean {
    return this.owners.has(handle);
  }

  /**
   * Before each physics step: moves each other vehicle's body to where its snapshots put it at
   * `now` (ms, our clock), making the body first if needed.
   */
  step(now: number): void {
    if (!this.physics) return;
    const { R, world } = this.physics;
    for (const o of this.others.values()) {
      const s = o.track.latest;
      const def = s && this.defs.find((d) => d.name === s.vehicle);
      const pose = o.track.pose(now);
      // A vehicle run here is a body of its own in our physics already.
      const solid = !o.hosted && !o.away && !!def && !!pose && s.region === this.region;
      if (!solid) {
        this.dropSolid(o);
        continue;
      }
      if (o.solidFor !== def.name) {
        this.dropSolid(o);
        o.solid = this.makeSolid(R, world, def, o);
        o.solidFor = def.name;
      }
      const body = o.solid!;
      const [x, y, z] = pose.p;
      const [qx, qy, qz, qw] = pose.q;
      const was = body.translation();
      if (Math.hypot(was.x - x, was.y - y, was.z - z) > TELEPORT) {
        // Put somewhere new: there at once, not swept across everything in between.
        body.setTranslation({ x, y, z }, true);
        body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
      }
      body.setNextKinematicTranslation({ x, y, z });
      body.setNextKinematicRotation({ x: qx, y: qy, z: qz, w: qw });
    }
  }

  /**
   * After each physics step: what our vehicle's colliders (`ours`, by handle) pushed on the
   * others, gathered until `takePushes`.
   */
  gather(ours: Set<number>): void {
    if (!this.physics) return;
    for (const o of this.others.values()) if (o.solid) pushOn(this.physics.world, o.solid, ours, o);
  }

  /** The pushes gathered since last time, one per vehicle pushed, and starts afresh. */
  takePushes(): Push[] {
    const out: Push[] = [];
    for (const [id, o] of this.others) {
      if (o.pushWeight > 0 && o.push.lengthSq() > 1) {
        const at = o.pushAt.divideScalar(o.pushWeight);
        const r = (x: number): number => Math.round(x * 100) / 100;
        out.push({ to: id, impulse: [r(o.push.x), r(o.push.y), r(o.push.z)], at: [r(at.x), r(at.y), r(at.z)] });
      }
      o.push.set(0, 0, 0);
      o.pushAt.set(0, 0, 0);
      o.pushWeight = 0;
    }
    return out;
  }

  /** Call every frame, after the camera has moved. `now` in ms; `dt` 0 while paused. */
  /** What the others cost this frame, for the developer read-out. */
  readonly stats = { drawn: 0, heard: 0, effects: 0 };

  update(now: number, dt: number, camera: THREE.Camera, show: boolean, around: Surroundings): void {
    const width = window.innerWidth, height = window.innerHeight;
    // The nearest few may be heard, by where they were drawn last frame.
    const near: [Other, number][] = [];
    for (const o of this.others.values()) if (o.view?.group.visible) near.push([o, o.view.group.position.distanceTo(camera.position)]);
    near.sort((a, b) => a[1] - b[1]);
    const hearable = new Set(near.slice(0, MOST_HEARD).map(([o]) => o));
    this.stats.drawn = this.stats.heard = this.stats.effects = 0;
    /** Others with their lights on, and how far away, for the beams. */
    const lit: { o: Other; distance: number }[] = [];
    for (const [id, o] of this.others) {
      if (!o.hosted && now - o.track.heard > SILENT) {
        this.remove(id, o);
        continue;
      }
      const s = o.track.latest;
      const def = s && this.defs.find((d) => d.name === s.vehicle);
      const pose = o.hosted ? snapshotPose(o.hosted.snapshot()) : o.track.pose(now);
      const visible = show && !o.away && !!def && !!pose && s.region === this.region;
      if (!visible) {
        this.drawCable(o, null, def, camera, around);
        if (o.view) o.view.group.visible = false;
        if (o.effects) o.effects.tracks.break();
        this.quiet(o);
        o.tag.style.display = 'none';
        continue;
      }
      // A new vehicle or new paint: build it again.
      const built = `${def.name} ${o.player.color ?? ''}`;
      if (!o.view || !o.vehicle || o.built !== built) {
        this.release(o);
        o.view?.dispose();
        o.vehicle = new RemoteVehicle(def);
        // Lamps glow, but their beams are left out: each extra light costs every material on screen.
        o.view = new VehicleView(o.vehicle, { color: o.player.color, beams: false });
        o.built = built;
        this.scene.add(o.view.group);
      }
      const vehicle = o.vehicle;
      const view = o.view;
      vehicle.set(pose, dt);
      view.group.visible = true;
      view.snap();
      view.render(1);
      view.setLights(pose.lights, pose.braking);
      this.drawCable(o, pose, def, camera, around);
      const distance = view.group.position.distanceTo(camera.position);
      if (pose.lights) lit.push({ o, distance });
      this.effects(o, vehicle, view, s.jump, now, pose.paused ? 0 : dt, distance, camera, around);
      this.sound(o, vehicle, view, pose.paused ? 0 : dt, hearable.has(o) ? distance : Infinity, around.wetness);
      this.stats.drawn++;
      if (o.sound) this.stats.heard++;
      if (o.effects) this.stats.effects++;

      // The name, over the roof.
      this.at.set(0, def.body.height + 0.7, 0).applyMatrix4(view.group.matrixWorld);
      const far = this.at.distanceTo(camera.position);
      this.at.project(camera);
      const fade = 1 - (far - FADE_FROM) / (FADE_TO - FADE_FROM);
      if (this.at.z > 1 || fade <= 0) {
        o.tag.style.display = 'none';
        continue;
      }
      const text = o.player.name + (pose.paused ? ' · paused' : '');
      if (o.tag.dataset.text !== text || o.tag.dataset.color !== (o.player.color ?? '')) {
        o.tag.dataset.text = text;
        o.tag.dataset.color = o.player.color ?? '';
        o.tag.replaceChildren();
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = o.player.color ?? PLAIN;
        o.tag.append(dot, text);
      }
      o.tag.style.display = 'flex';
      o.tag.style.opacity = String(Math.min(1, fade));
      o.tag.style.transform = `translate(${((this.at.x + 1) / 2) * width}px, ${((1 - this.at.y) / 2) * height}px) translate(-50%, -100%)`;
    }
    this.lendBeams(lit);
  }

  /** Its winch cable, while it is out; `pose` null hides it. */
  private drawCable(o: Other, pose: Pose | null, def: VehicleDef | undefined, camera: THREE.Camera, around: Surroundings): void {
    const w = pose?.winch;
    if (!w || !def || !o.view) {
      if (o.cable) o.cable.view.group.visible = false;
      return;
    }
    if (!o.cable || o.cable.state.def !== def) {
      o.cable?.view.dispose();
      o.cable = { view: new WinchView(), state: new RemoteCable(def) };
      this.scene.add(o.cable.view.group);
    }
    o.cable.state.set(w);
    o.cable.view.group.visible = true;
    // Placed with the vehicle first, so the cable leaves from where it is drawn this frame.
    o.view.group.updateMatrixWorld();
    o.cable.view.update(0, o.cable.state, o.view.group, (x, z) => around.heightAt(x, z), camera.position);
  }

  /** Spray, smoke, tracks and mud, as for our own vehicle; nothing new thrown when far off. */
  private effects(o: Other, vehicle: RemoteVehicle, view: VehicleView, jump: number, now: number, dt: number, distance: number, camera: THREE.Camera, around: Surroundings): void {
    if (!o.effects) {
      if (distance > EFFECTS) return;
      o.effects = { spray: new Spray(), exhaust: new Exhaust(), tracks: new Tracks(), jump };
      this.scene.add(o.effects.spray.group, o.effects.exhaust.group, o.effects.tracks.mesh);
    }
    const e = o.effects;
    if (e.jump !== jump) {
      e.tracks.break();
      e.jump = jump;
    }
    const near = distance <= EFFECTS;
    if (near) e.tracks.update(vehicle, around.wetness, now);
    else e.tracks.break();
    view.grime.update(dt, vehicle, around.wetness, around.rain);
    // Particles already in the air carry on falling; new ones only near.
    e.spray.update(dt, near ? vehicle : still(vehicle), view.group, camera, around.wetness, (x, z) => around.heightAt(x, z));
    e.exhaust.update(dt, vehicle, view.group, camera, near, 0, around.wind, around.celsius);
  }

  /** Its engine, tyres and knocks, heard through the world's sounds. */
  private sound(o: Other, vehicle: RemoteVehicle, view: VehicleView, dt: number, distance: number, wetness: number): void {
    if (!this.audio) return;
    if (!o.sound) {
      if (distance > HEAR) return;
      o.sound = new VehicleAudio(this.audio, this.audio.world);
    } else if (distance > FORGET) {
      this.quiet(o);
      return;
    }
    o.sound.update(dt, vehicle, view.group, vehicle.pedal, wetness, [], [], dt === 0);
  }

  private quiet(o: Other): void {
    o.sound?.dispose();
    o.sound = null;
  }

  private makeSolid(R: Rapier, world: RAPIER.World, def: VehicleDef, o: Other): RAPIER.RigidBody {
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1e4, 0));
    const [w, h, l] = def.chassis.box.size as [number, number, number];
    const c = def.chassis.box.center;
    // The same shapes as the simulation's body: the bodywork, and the frame under it.
    const solid = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
      const collider = world.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.5).setRestitution(0.05).setCollisionGroups(groups(GROUP_VEHICLE, GROUP_VEHICLE)),
        body,
      );
      this.owners.set(collider.handle, o);
    };
    solid(w / 2, h / 2, l / 2, c[0]!, c[1]!, c[2]!);
    const bottom = c[1]! - h / 2;
    const clearance = def.chassis.groundClearance;
    const front = Math.max(...def.axles.map((a) => a.z)) + 0.3;
    const rear = Math.min(...def.axles.map((a) => a.z)) - 0.3;
    if (bottom > clearance) solid(0.5, (bottom - clearance) / 2, (front - rear) / 2, 0, (bottom + clearance) / 2, (front + rear) / 2);
    return body;
  }

  private dropSolid(o: Other): void {
    if (!o.solid || !this.physics) return;
    for (let c = 0; c < o.solid.numColliders(); c++) this.owners.delete(o.solid.collider(c).handle);
    this.physics.world.removeRigidBody(o.solid);
    o.solid = null;
    o.solidFor = '';
  }

  /** The beams go to the nearest others with their lights on; the rest wait, dark. */
  private lendBeams(lit: { o: Other; distance: number }[]): void {
    if (this.beams.length === 0) {
      if (this.others.size === 0) return;
      for (let k = 0; k < BEAM_CARS; k++) {
        const pair: [THREE.SpotLight, THREE.SpotLight] = [newBeam(), newBeam()];
        for (const beam of pair) this.scene.add(beam, beam.target);
        this.beams.push(pair);
      }
    }
    lit.sort((a, b) => a.distance - b.distance);
    this.beams.forEach((pair, k) => {
      const view = lit[k]?.o.view;
      const lamps = lit[k]?.o.vehicle?.def.body.headlights;
      pair.forEach((beam, side) => {
        if (!view || !lamps?.length) {
          beam.intensity = 0;
          return;
        }
        if (beam.parent !== view.group) view.group.add(beam, beam.target);
        aimBeam(beam, side === 0 ? lamps[0]! : lamps.at(-1)!);
        beam.intensity = HEADLIGHT;
      });
    });
  }

  /** Takes back any beams lent to `o`, before its view goes. */
  private release(o: Other): void {
    for (const pair of this.beams) {
      for (const beam of pair) {
        if (o.view && beam.parent === o.view.group) {
          beam.intensity = 0;
          this.scene.add(beam, beam.target);
        }
      }
    }
  }

  private remove(id: string, o: Other): void {
    this.release(o);
    o.view?.dispose();
    if (o.effects) {
      for (const obj of [o.effects.spray.group, o.effects.exhaust.group, o.effects.tracks.mesh]) disposeObject(obj);
    }
    this.quiet(o);
    this.dropSolid(o);
    o.cable?.view.dispose();
    o.tag.remove();
    this.others.delete(id);
  }
}

/** What gathers pushes: the summed impulse, and contact points weighted by impulse. */
export interface Pushed {
  push: THREE.Vector3;
  pushAt: THREE.Vector3;
  pushWeight: number;
}

/** Adds what colliders in `ours` (by handle) pushed on `body` during the last step to `into`. */
export function pushOn(world: RAPIER.World, body: RAPIER.RigidBody, ours: Set<number>, into: Pushed): void {
  const n = new THREE.Vector3();
  const at = new THREE.Vector3();
  for (let c = 0; c < body.numColliders(); c++) {
    const theirs = body.collider(c);
    world.contactPairsWith(theirs, (other) => {
      if (!ours.has(other.handle)) return;
      world.contactPair(other, theirs, (m, flipped) => {
        let impulse = 0;
        for (let i = 0; i < m.numContacts(); i++) impulse += m.contactImpulse(i);
        if (impulse <= 0) return;
        // The normal points from the first collider to the second: ours to theirs unless flipped.
        const nv = m.normal();
        n.set(nv.x, nv.y, nv.z).multiplyScalar(flipped ? -impulse : impulse);
        into.push.add(n);
        const points = m.numSolverContacts();
        for (let i = 0; i < points; i++) {
          const p = m.solverContactPoint(i);
          if (p) into.pushAt.addScaledVector(at.set(p.x, p.y, p.z), impulse / points);
        }
        if (points > 0) into.pushWeight += impulse;
      });
    });
  }
}

/** The vehicle as standing still with nothing spinning, so no new spray is thrown. */
function still(v: RemoteVehicle): VehicleState {
  return { ...v, def: v.def, body: v.body, wheelPosition: (i) => v.wheelPosition(i), speed: 0, wheels: v.wheels.map((w) => ({ ...w, contact: false })) };
}

/** Takes something out of the scene and frees its GPU memory. */
function disposeObject(object: THREE.Object3D): void {
  object.removeFromParent();
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) (m as THREE.Material).dispose();
  });
}

/**
 * Applies a push another driver's vehicle made on ours. Their browser saw ours as a wall, so a
 * hit comes through about twice as hard as between two real vehicles: a steady shove (up to
 * GENTLE m/s of change per message) is passed on whole, anything harder at half, and never
 * more than MOST_PUSH.
 */
export function applyPush(body: RAPIER.RigidBody, impulse: readonly number[], at: readonly number[]): void {
  const k = pushScale(Math.hypot(impulse[0]!, impulse[1]!, impulse[2]!) / body.mass());
  body.applyImpulseAtPoint({ x: impulse[0]! * k, y: impulse[1]! * k, z: impulse[2]! * k }, { x: at[0]!, y: at[1]!, z: at[2]! }, true);
}

/** The share of a push to apply that would change the speed by `dv` m/s. */
export function pushScale(dv: number): number {
  if (dv <= GENTLE) return 1;
  return Math.min(MOST_PUSH, GENTLE + (dv - GENTLE) * HARD_SHARE) / dv;
}
