// The other drivers: who is connected, and their vehicles drawn where their snapshots say,
// with their name over each. Only those in the same region as us are drawn. They are only
// pictures for now: nothing here touches the physics, so vehicles pass through each other.

import * as THREE from 'three/webgpu';
import type { Player, VehicleDef, VehicleSnapshot } from '@spar/shared';
import { VehicleView, type VehicleShape } from '../vehicle/view';
import { Track, type Pose } from './track';

/** A vehicle not heard from for this long (ms) is taken away. */
const SILENT = 5000;
/** Name tags are fully clear up to this distance (m) and gone at FADE_TO. */
const FADE_FROM = 120;
const FADE_TO = 600;

/** Another driver's vehicle as the view needs it, moved along by their snapshots. */
class RemoteVehicle implements VehicleShape {
  readonly wheels: { steer: number; rotation: number; suspension: number }[];
  private pose: Pose | null = null;
  readonly body = {
    translation: () => {
      const p = this.pose?.p ?? [0, -1e4, 0];
      return { x: p[0], y: p[1], z: p[2] };
    },
    rotation: () => {
      const q = this.pose?.q ?? [0, 0, 0, 1];
      return { x: q[0], y: q[1], z: q[2], w: q[3] };
    },
  };

  constructor(readonly def: VehicleDef) {
    this.wheels = def.axles.flatMap(() => [0, 1]).map(() => ({ steer: 0, rotation: 0, suspension: 0 }));
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
    const roll = (pose.speed / this.def.wheels.radius) * dt;
    this.wheels.forEach((w, i) => {
      const [steer, suspension] = pose.wheels[i] ?? [0, w.suspension];
      w.steer = steer;
      w.suspension = suspension;
      w.rotation = (w.rotation + roll) % (Math.PI * 2);
    });
  }
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

/** Marker colour for a driver who keeps their vehicle's own paint. */
const PLAIN = '#ecebe6';

interface Other {
  player: Player;
  track: Track;
  vehicle: RemoteVehicle | null;
  view: VehicleView | null;
  /** What the view was built for, to rebuild it on a change of vehicle or paint. */
  built: string;
  tag: HTMLDivElement;
  away: boolean;
}

export class Others {
  /** Everyone connected, ourselves included, in the server's order. */
  players: Player[] = [];
  /** Our own player id once welcomed. */
  me = '';
  /** The region we drive in; others elsewhere are not drawn. */
  region = '';
  private readonly others = new Map<string, Other>();
  private readonly tags: HTMLDivElement;
  private readonly at = new THREE.Vector3();

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

  /** A snapshot of another driver's vehicle. */
  receive(id: string, s: VehicleSnapshot, now: number): void {
    if (id === this.me) return;
    let o = this.others.get(id);
    if (!o) {
      const player = this.players.find((p) => p.id === id) ?? { id, name: '…' };
      const tag = document.createElement('div');
      tag.className = 'tag';
      this.tags.append(tag);
      o = { player, track: new Track(), vehicle: null, view: null, built: '', tag, away: false };
      this.others.set(id, o);
    }
    o.away = false;
    o.track.push(s, now);
  }

  /** Another driver has gone back to the start screen. */
  away(id: string): void {
    const o = this.others.get(id);
    if (o) o.away = true;
  }

  /** Who is in which region, for the player lists: names, colours, and whether they are with us. */
  list(): { name: string; color: string; here: boolean; you: boolean; paused: boolean }[] {
    return this.players.map((p) => {
      const o = this.others.get(p.id);
      const s = o?.track.latest;
      const you = p.id === this.me;
      return {
        name: p.name,
        color: p.color ?? PLAIN,
        here: you || (!!s && !o!.away && s.region === this.region),
        you,
        paused: !!s?.paused,
      };
    });
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

  /** Call every frame, after the camera has moved. `now` in ms. */
  update(now: number, dt: number, camera: THREE.Camera, show: boolean): void {
    const width = window.innerWidth, height = window.innerHeight;
    for (const [id, o] of this.others) {
      if (now - o.track.heard > SILENT) {
        this.remove(id, o);
        continue;
      }
      const s = o.track.latest;
      const def = s && this.defs.find((d) => d.name === s.vehicle);
      const pose = o.track.pose(now);
      const visible = show && !o.away && !!def && !!pose && s.region === this.region;
      if (!visible) {
        if (o.view) o.view.group.visible = false;
        o.tag.style.display = 'none';
        continue;
      }
      // A new vehicle or new paint: build it again.
      const built = `${def.name} ${o.player.color ?? ''}`;
      if (!o.view || !o.vehicle || o.built !== built) {
        o.view?.dispose();
        o.vehicle = new RemoteVehicle(def);
        // Lamps glow, but their beams are left out: each extra light costs every material on screen.
        o.view = new VehicleView(o.vehicle, { color: o.player.color, beams: false });
        o.built = built;
        this.scene.add(o.view.group);
      }
      o.vehicle.set(pose, dt);
      o.view.group.visible = true;
      o.view.snap();
      o.view.render(1);
      o.view.setLights(pose.lights, pose.braking);

      // The name, over the roof.
      this.at.set(0, def.body.height + 0.7, 0).applyMatrix4(o.view.group.matrixWorld);
      const distance = this.at.distanceTo(camera.position);
      this.at.project(camera);
      const fade = 1 - (distance - FADE_FROM) / (FADE_TO - FADE_FROM);
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
  }

  private remove(id: string, o: Other): void {
    o.view?.dispose();
    o.tag.remove();
    this.others.delete(id);
  }
}
