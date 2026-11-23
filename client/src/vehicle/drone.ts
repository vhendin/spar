// The scouting drone: launched from the vehicle's roof while it stands still, flown by the
// driver to look at the way ahead, and back home to the roof by itself when sent, at the end
// of its range, or before its battery runs out. Only the terrain stops it; trees do not.

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** The driver's controls for the drone, each −1..1. */
export interface DroneControls {
  /** Forward (+) and back (−). */
  forward: number;
  /** Turning left (+) and right (−). */
  turn: number;
  /** Up (+) and down (−). */
  climb: number;
}

export const DRONE = {
  /** Metres from the vehicle, level, that it may fly. */
  range: 1000,
  /** Seconds of flight on a full battery. */
  battery: 300,
  /** Seconds to charge a flat battery again on the roof. */
  charge: 90,
  /** Seconds of battery needed to launch. */
  launchAt: 30,
  /** Fastest it flies, metres a second. */
  speed: 16,
  /** Climbing and sinking, metres a second. */
  climb: 6,
  /** Turning, radians a second. */
  turn: 1.6,
  /** How quickly it takes up the speed asked for, metres a second per second. */
  accel: 10,
  /** Closest to the ground it comes, and highest above it, metres. */
  floor: 1.5,
  ceiling: 150,
  /** Speed going home, metres a second. */
  homeSpeed: 15,
  /** Height above the roof it flies home at, at least, metres. */
  homeHeight: 20,
  /** Sinking onto the roof at the end, metres a second. */
  landing: 2.5,
  /** Battery kept back on the way home, seconds. */
  reserve: 15,
  /** Warning this far before a limit: metres of range, seconds of battery. */
  warnRange: 150,
  warnBattery: 30,
  /** The vehicle must be slower than this (m/s) to launch. */
  still: 1,
} as const;

export type DroneState = 'docked' | 'flying' | 'home';
/** Why it is flying home. */
export type HomeReason = 'sent' | 'range' | 'battery';

const TAU = Math.PI * 2;
const wrap = (a: number): number => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const approach = (from: number, to: number, step: number): number => from + Math.max(-step, Math.min(step, to - from));

export class Drone {
  state: DroneState = 'docked';
  reason: HomeReason | null = null;
  /** Where it is, metres. */
  readonly p: P3 = { x: 0, y: 0, z: 0 };
  /** Velocity, metres a second. */
  readonly v: P3 = { x: 0, y: 0, z: 0 };
  /** Facing, radians: 0 along +z, positive turning towards +x (left). */
  yaw = 0;
  /** Seconds of flight left. */
  battery: number = DRONE.battery;
  /** Seconds since launch during which it rises clear of the roof by itself. */
  private rising = 0;

  get out(): boolean {
    return this.state !== 'docked';
  }

  /** Level distance to the roof, metres. */
  distance(roof: P3): number {
    return Math.hypot(this.p.x - roof.x, this.p.z - roof.z);
  }

  /** Seconds of battery the trip home from here takes, with the reserve. */
  needed(roof: P3): number {
    return this.distance(roof) / DRONE.homeSpeed + Math.abs(this.p.y - roof.y) / DRONE.climb + DRONE.reserve;
  }

  /** Close to the end of its range or battery: the driver is warned. */
  warning(roof: P3): 'range' | 'battery' | null {
    if (!this.out) return null;
    if (this.battery < this.needed(roof) + DRONE.warnBattery) return 'battery';
    if (this.distance(roof) > DRONE.range - DRONE.warnRange) return 'range';
    return null;
  }

  /** Why it cannot launch now, or null when it can. */
  cannotLaunch(speed: number): string | null {
    if (this.out) return null;
    if (Math.abs(speed) > DRONE.still) return 'Stop the vehicle to launch the drone';
    if (this.battery < DRONE.launchAt) return `The drone is charging: ${Math.round((this.battery / DRONE.battery) * 100)}%`;
    return null;
  }

  /**
   * The drone key: launches it from `roof` facing `yaw`, sends it home, or takes it back from
   * flying home when it was only sent there. A message when nothing happens, else null.
   */
  key(roof: P3, yaw: number, speed: number): string | null {
    if (this.state === 'docked') {
      const why = this.cannotLaunch(speed);
      if (why) return why;
      this.state = 'flying';
      this.reason = null;
      Object.assign(this.p, roof);
      Object.assign(this.v, { x: 0, y: 0, z: 0 });
      this.yaw = yaw;
      this.rising = 0;
      return null;
    }
    if (this.state === 'flying') {
      this.goHome('sent');
      return null;
    }
    if (this.reason === 'sent') {
      this.state = 'flying';
      this.reason = null;
      return null;
    }
    return this.reason === 'battery' ? 'The battery is low: the drone is coming home' : 'Out of range: the drone is coming home';
  }

  /** Put away at once, wherever it is: a new vehicle, a jump to the start. */
  dock(): void {
    this.state = 'docked';
    this.reason = null;
    Object.assign(this.v, { x: 0, y: 0, z: 0 });
  }

  private goHome(reason: HomeReason): void {
    this.state = 'home';
    this.reason = reason;
  }

  /** `roof` where it lands, live; `groundAt` the terrain height or null where unknown. */
  step(dt: number, c: DroneControls, roof: P3, groundAt: (x: number, z: number) => number | null): void {
    if (this.state === 'docked') {
      this.battery = Math.min(DRONE.battery, this.battery + (DRONE.battery / DRONE.charge) * dt);
      Object.assign(this.p, roof);
      return;
    }
    this.battery = Math.max(0, this.battery - dt);
    const ground = groundAt(this.p.x, this.p.z) ?? this.p.y - DRONE.floor;
    let want: P3;
    if (this.state === 'flying') {
      this.rising += dt;
      this.yaw = wrap(this.yaw + c.turn * DRONE.turn * dt);
      const f = Math.max(-1, Math.min(1, c.forward)) * DRONE.speed;
      // Clear of the roof first, whatever the driver asks.
      const climb = this.rising < 1.2 ? Math.max(c.climb, 0.6) : c.climb;
      want = { x: Math.sin(this.yaw) * f, y: Math.max(-1, Math.min(1, climb)) * DRONE.climb, z: Math.cos(this.yaw) * f };
    } else want = this.homeward(roof, ground, dt);
    const k = DRONE.accel * dt;
    this.v.x = approach(this.v.x, want.x, k);
    this.v.y = approach(this.v.y, want.y, k);
    this.v.z = approach(this.v.z, want.z, k);
    this.p.x += this.v.x * dt;
    this.p.y += this.v.y * dt;
    this.p.z += this.v.z * dt;
    // Never into the ground, never out of sight above it.
    const below = groundAt(this.p.x, this.p.z) ?? ground;
    const landing = this.state === 'home' && this.distance(roof) < 1;
    if (!landing && this.p.y < below + DRONE.floor) {
      this.p.y = below + DRONE.floor;
      this.v.y = Math.max(0, this.v.y);
    }
    if (this.p.y > below + DRONE.ceiling) {
      this.p.y = below + DRONE.ceiling;
      this.v.y = Math.min(0, this.v.y);
    }
    if (this.state === 'flying') {
      if (this.distance(roof) > DRONE.range) this.goHome('range');
      else if (this.battery <= this.needed(roof)) this.goHome('battery');
    } else if (landing && Math.abs(this.p.y - roof.y) < 0.08) this.dock();
  }

  /** The velocity flying home wants: up to a safe height, across, then down onto the roof. */
  private homeward(roof: P3, ground: number, dt: number): P3 {
    const dx = roof.x - this.p.x, dz = roof.z - this.p.z;
    const d = Math.hypot(dx, dz);
    // Facing the way it flies, and the vehicle's way once there.
    if (d > 2) this.yaw = approach(this.yaw, this.yaw + wrap(Math.atan2(dx, dz) - this.yaw), DRONE.turn * dt);
    if (d < 1) {
      // Over the roof: straight down, the last bit pulled in sideways.
      return { x: dx * 2, y: Math.max(-DRONE.landing, Math.min(DRONE.landing, (roof.y - this.p.y) * 2)), z: dz * 2 };
    }
    const cruise = Math.max(roof.y + DRONE.homeHeight, ground + DRONE.homeHeight);
    // Far off, up first; nearer, down towards the roof as it closes in.
    const height = d > 40 ? Math.max(this.p.y, cruise) : roof.y + Math.min(DRONE.homeHeight, d * 0.5) + 0.3;
    const up = Math.max(-DRONE.climb, Math.min(DRONE.climb, (height - this.p.y) * 1.5));
    // Slows over the last stretch so it stops above the roof.
    const speed = Math.min(DRONE.homeSpeed, d * 0.8) * (this.p.y < cruise - 5 && d > 40 ? 0.3 : 1);
    return { x: (dx / d) * speed, y: up, z: (dz / d) * speed };
  }
}
