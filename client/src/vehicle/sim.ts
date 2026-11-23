// One vehicle in the physics world: a rigid body on ray-cast wheels, driven by the
// drivetrain and tyre models from the vehicle definition. No rendering and no browser
// APIs in here, so it also runs in tests and could run on a server.

import type RAPIER from '@dimforge/rapier3d-compat';
import {
  newDrivetrainState, selectDirection, splitDrive, stepDrivetrain, tireOnGround,
  type AxleDrive, type DrivetrainState, type VehicleDef, type VehicleHandover,
} from '@spar/shared';

type Rapier = typeof RAPIER;

/** Collision groups: wheels feel only the ground; bodies also hit trees, rocks and each other. */
export const GROUP_GROUND = 0x0001;
export const GROUP_OBSTACLE = 0x0002;
export const GROUP_VEHICLE = 0x0004;
export const groups = (member: number, filter: number): number => ((member << 16) | filter) >>> 0;

const GRAVITY = 9.81;
/**
 * The body glancing off the ground: when it meets the ground (not a tree, rock or building)
 * hard enough to lose more than GLANCE_LOST m/s ahead in one step while going faster than
 * GLANCE_MIN, it is given GLANCE_KEEP of that back. The solver still lifts it out of the
 * edge, so it bumps up and over instead of stopping dead: less real, more fun.
 */
const GLANCE_MIN = 4;
const GLANCE_LOST = 0.8;
const GLANCE_KEEP = 0.65;
/** And this share of the spin the blow gave it is taken back. */
const GLANCE_STEADY = 0.7;
/** Steering lock halves at this speed (m/s), so the vehicle stays steady on the road. */
const STEER_HALF_SPEED = 13;
/** Speed (m/s) by which rear-wheel steering has faded out. */
const REAR_STEER_FADE = 17;
/** How fast the steered wheels turn, radians per second. */
const STEER_RATE = 1.4;

// Soft ground. A tyre settles into it as it rolls, deeper the softer the ground and the more
// weight it carries; spinning digs it further down. Rolling on without spinning climbs back
// out. Every bit of depth adds the drag of pushing through the rut.
/** Deepest a rolling tyre settles in the softest ground, as a share of its radius. */
const SETTLE = 0.36;
/** Deepest a spinning tyre digs itself, as a share of its radius. */
const DIG_LIMIT = 0.55;
/** Metres a second a fully spinning tyre digs into the softest ground. */
const DIG_RATE = 0.14;
/** Metres of travel to settle into new ground, and to climb out of a rut. */
const SETTLE_DISTANCE = 0.8;
const CLIMB_DISTANCE = 2.5;
/** Drag of the rut: this times (depth / radius)² times the load. */
const RUT_DRAG = 0.6;
/**
 * Ground pressure: a tyre's load over its width times its diameter (a stand-in for the
 * contact patch), in pascals. At this pressure a tyre settles by SETTLE; settling goes with
 * the pressure, so light vehicles and wide tyres float and heavy ones go deeper. About the
 * Terrängbil 11 standing on level ground.
 */
const PRESSURE_REF = 24000;
/** The most the pressure deepens settling, as a multiple. */
const PRESSURE_MAX = 1.6;
/**
 * Snow: a tyre packs it down by this share of its depth before it bears, but never deeper
 * than SNOW_SINK of its radius; spinning digs on, at most to SNOW_DIG_LIMIT of the radius.
 * Packed snow gives way under the tyre, so its rut drags less than mud's (SNOW_RUT).
 */
const SNOW_SETTLE = 0.3;
const SNOW_SINK = 0.25;
const SNOW_DIG_LIMIT = 0.38;
const SNOW_RUT = 0.3;
/** How soft snow this deep (metres) and deeper is to dig into, 0..1. */
const SNOW_SOFT_DEPTH = 0.5;
const SNOW_SOFTNESS = 0.7;
/** Drag of pushing through snow, as a share of the wheel's load per metre of depth. */
const SNOW_DRAG = 0.06;
/**
 * Snow deep enough to reach the underside once packed (SNOW_PACK of its depth) is pushed
 * along by the body too: this share of the load per metre it stands above the clearance.
 */
const SNOW_PACK = 0.7;
const SNOW_BELLY = 0.25;
/** How much more slowly a spinning tyre digs into snow than into mud. */
const SNOW_DIG = 0.3;
/** Thinner than this (metres) and the snow is only a dusting: the ground beneath decides. */
const SNOW_DUSTING = 0.03;

/** Kilograms per cubic metre of air near the ground. */
const AIR_DENSITY = 1.2;

// Water. Wheels go down to the bed, the body pushes through and is lifted a little, and too
// deep for the air intake drowns the engine.
const WATER_DENSITY = 1000;
/** Share of the body's volume that floats it; the rest fills with water. */
const FLOAT_SHARE = 0.07;
/** Drag coefficient of the body pushing through water. */
const WATER_DRAG = 0.9;
/** How fast the wheels follow a change in depth, metres a second. */
const DEPTH_RATE = 0.8;
/** Seconds of water over the intake before the engine drowns, and on dry land before it starts again. */
const DROWN_TIME = 0.4;
const DRY_TIME = 3;
/** Wading depth when the definition has none. */
const WADING = 0.6;

export interface VehicleInput {
  /** Pedals, 0..1. In reverse they swap roles: the brake pedal drives backwards. */
  throttle: number;
  brake: number;
  /** -1 full right to 1 full left. */
  steer: number;
  handbrake: boolean;
  /**
   * The pedals are keys, only on or off: the driving pedal is then eased in, slowly where
   * the tyres have little grip and backed off while they spin, as a driver's foot would.
   */
  digital?: boolean;
}

/**
 * Crawl control works throttle and brake as one lever, u > 0 throttle and u < 0 brake, from
 * the speed it misses by (m/s): this much lever per m/s at once, and this much more per m/s
 * for every second it goes on missing, which finds the lever a slope or a rut needs.
 */
const CRAWL_P = 0.4;
const CRAWL_I = 0.6;
/** Seconds the pedal against the way it crawls is held at a standstill before it changes direction. */
const CRAWL_TURN = 1;

/** Seconds a key-pressed pedal takes to come fully in on firm ground, and on the slipperiest. */
const EASE_FIRM = 0.15;
const EASE_SLIPPERY = 1.8;
/** Grip from which the ground counts as firm, and at which as slipperiest. */
const GRIP_FIRM = 0.7;
const GRIP_SLIPPERY = 0.3;
/** Spin above which an eased pedal backs off, how fast (share per second), and how far at most. */
const EASE_SPIN = 0.15;
const EASE_BACK = 1.5;
const EASE_FLOOR = 0.25;

export interface WheelTelemetry {
  contact: boolean;
  /** Newtons pressing the tyre on the ground. */
  load: number;
  /** Kind of ground under the tyre, and its friction coefficient there. */
  ground: string;
  grip: number;
  /** 0 = gripping, up to 1 = drive force at least twice what the tyre can hold. */
  spin: number;
  /** 0 = rolling, up to 1 = the brakes ask far more than the tyre can hold, so it slides. */
  skid: number;
  /** Sideways speed of the tyre over the ground, m/s (positive towards the vehicle's left, +x). */
  slide: number;
  /** Current length of the suspension strut, metres. */
  suspension: number;
  /** How far into its travel the suspension is pushed: 1 is on the bump stops. */
  bump: number;
  /** Steering angle and accumulated roll, radians. */
  steer: number;
  rotation: number;
  /** How far the tyre has sunk into soft ground, metres, and how soft that ground is (0..1). */
  sink: number;
  softness: number;
  /** Depth of snow under the tyre, metres; 0 where there is none. */
  snow: number;
  /** Depth of water over the ground under the tyre, metres. */
  water: number;
  /** Where the tyre touches the ground, and the ground's normal there (world frame); valid while in contact. */
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

/** Tells the vehicle what it is driving on. */
export interface GroundProbe {
  /** A ground name from defs/ground.json at a world position. */
  groundAt(x: number, z: number): string;
  /** 0 dry to 1 soaked. */
  wetness(): number;
  /** How far the ground gives under a tyre: 0 firm to 1 a soft bog. */
  softness(x: number, z: number): number;
  /** Metres of water over the ground at a world position; 0 on land. */
  waterDepth(x: number, z: number): number;
  /** Thickness of ice over that water, metres; 0 or left out where it is open. */
  iceAt?(x: number, z: number): number;
  /** The ice gave way here under a vehicle. */
  breakIce?(x: number, z: number): void;
  /** Depth of lying snow, metres (packed thin on roads); 0 or left out where there is none. */
  snowAt?(x: number, z: number): number;
}

/**
 * Kilograms ice bears per square centimetre of thickness squared (Gold's rule, with a
 * margin): a vehicle of m kg needs sqrt(m / ICE_STRENGTH) cm of ice.
 */
export const ICE_STRENGTH = 7;

/**
 * Where another browser says the vehicle is, while that browser runs it (when it is joined to
 * another driver's vehicle by a cable): as in a snapshot (multiplayer/track.ts).
 */
export interface FollowPose {
  p: readonly number[];
  q: readonly number[];
  /** Per wheel: steer, suspension, sink, spin, skid, slide, water. */
  wheels: readonly (readonly number[])[];
  /** Per wheel, the ground under it; '' off the ground. */
  ground: readonly string[];
  engine: { rpm: number; gear: number; low: boolean; shifting: boolean; pedal: number; drowned: boolean };
  wading: number;
  speed: number;
}

/** Seconds the vehicle takes to roll back onto its wheels. */
const RIGHTING_TIME = 1.2;
/** How high it is lifted on the way, metres. */
const RIGHTING_LIFT = 1.2;

/**
 * A vehicle's ground pressure standing on level ground, in pascals: each tyre's share of the
 * weight over its width times its diameter. More wheels or wider tyres lower it.
 */
export function groundPressure(def: VehicleDef): number {
  const load = (def.chassis.mass * GRAVITY) / (def.axles.length * 2);
  return load / (def.wheels.width * def.wheels.radius * 2);
}

type Quat = { x: number; y: number; z: number; w: number };

/** Spherical blend between two unit quaternions. */
function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = d < 0 ? -1 : 1;
  d = Math.abs(d);
  let ka = 1 - t, kb = t;
  if (d < 0.9995) {
    const angle = Math.acos(d);
    ka = Math.sin((1 - t) * angle) / Math.sin(angle);
    kb = Math.sin(t * angle) / Math.sin(angle);
  }
  const q = { x: a.x * ka + b.x * kb * s, y: a.y * ka + b.y * kb * s, z: a.z * ka + b.z * kb * s, w: a.w * ka + b.w * kb * s };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** Turns a vector by a unit quaternion. */
function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number): [number, number, number] {
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
}

export class VehicleSim {
  readonly body: RAPIER.RigidBody;
  readonly drivetrain: DrivetrainState = newDrivetrainState();
  readonly wheels: WheelTelemetry[] = [];
  /** Differential locks engaged by the driver, per axle. */
  readonly locks: boolean[];
  /** Speed along the heading in m/s; negative when rolling backwards. */
  speed = 0;
  /** The pedal driving the engine this step, 0..1: the throttle, or the brake pedal in reverse. */
  pedal = 0;
  /** True while the vehicle holds itself still with nobody on the pedals, like a parking brake. */
  holding = true;
  /** Set while a winch pulls the vehicle along, so it does not hold itself still against it. */
  pulled = false;
  /** Set by another vehicle's winch pulling this one, for this step only: it lets go of its hold too. */
  towed = false;
  /** True once water has got into the engine; it starts again after a while out of the water. */
  drowned = false;
  /** Deepest water around the vehicle, metres above the bottom of its tyres. */
  wading = 0;
  /** Crawl control: 0 off, otherwise which of the definition's crawl speeds it holds (1 the slowest). */
  crawl = 0;
  /** True this step while crawl control drives (it is on and no pedal is pressed). */
  crawling = false;
  /** Crawl control's lasting share of the lever, what the slope and the ground ask for. */
  private crawlLever = 0;
  /** Seconds the pedal against the direction of travel has been held at a standstill. */
  private againstHeld = 0;

  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly restLength: number[] = [];
  private readonly travel: number[] = [];
  /** Handles of the body's own colliders, to tell its contacts from others'. */
  readonly chassis = new Set<number>();
  private readonly connectionY: number[] = [];
  private readonly colliders: RAPIER.Collider[] = [];
  /** Ice thick enough to carry this vehicle, metres. */
  readonly iceNeeded: number;
  /** Water under each wheel where it touches, once ice is taken into account. */
  private readonly waterUnder: number[] = [];
  /** Whether the body still bumps into the ground; not while it sits deep in a lake. */
  private bodyMeetsGround = true;
  /** Seconds with the intake under water, or the engine drowned and out of it. */
  private drowning = 0;
  private steerAngle = 0;
  /** Velocity just before the world was last stepped. */
  private readonly before = { x: 0, y: 0, z: 0 };
  private readonly spinBefore = { x: 0, y: 0, z: 0 };
  /** Times the body has glanced off the ground, for the read-out. */
  glanced = 0;
  /** How far in an eased (key-pressed) driving pedal is, 0..1. */
  private eased = 0;
  /** True while another browser runs it and this one only follows what it says (`follow`). */
  private followed = false;
  /** While being put back on its wheels: where from, where to, and how far along (0..1). */
  private righting: { from: { p: { x: number; y: number; z: number }; q: Quat }; to: { p: { x: number; y: number; z: number }; q: Quat }; t: number } | null = null;

  constructor(
    private readonly R: Rapier,
    private readonly world: RAPIER.World,
    readonly def: VehicleDef,
    private readonly ground: GroundProbe,
  ) {
    const { mass, centerOfMass: com, box } = def.chassis;
    const [w, h, l] = box.size as [number, number, number];
    this.iceNeeded = Math.sqrt(mass / ICE_STRENGTH) / 100;
    // A box's resistance to turning, eased a little: much of the weight sits low and central.
    const k = (mass / 12) * 0.8;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(
          mass,
          { x: com[0]!, y: com[1]!, z: com[2]! },
          { x: k * (h * h + l * l), y: k * (w * w + l * l), z: k * (w * w + h * h) },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setCanSleep(false)
        .setLinearDamping(0) // air drag is worked out from the speed (pushThroughAir)
        .setAngularDamping(0.25),
    );
    const solid = (points: number[]): void => {
      const collider = world.createCollider(
        (R.ColliderDesc.convexHull(new Float32Array(points)) ?? R.ColliderDesc.ball(0.5))
          .setDensity(0) // the mass is set on the body, above
          // Low, so the body slides over what it scrapes rather than digging in.
          .setFriction(0.3)
          .setRestitution(0.05)
          .setCollisionGroups(groups(GROUP_VEHICLE, GROUP_GROUND | GROUP_OBSTACLE | GROUP_VEHICLE))
          // Hits and scrapes against the body are heard; light touches are not reported.
          .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(mass * GRAVITY * 0.3),
        this.body,
      );
      this.chassis.add(collider.handle);
      this.colliders.push(collider);
    };
    /**
     * A block `halfWidth` either side, from `low` to `high`, `back` to `front`, whose underside
     * slopes up at both ends like a boat's bow: at the front from `bow` (z) on the underside to
     * `rise` up the front face, at the back from `stern` to `lift` up the back. A ledge met at
     * speed pushes the slope up and over instead of stopping a square corner dead.
     */
    const hull = (halfWidth: number, low: number, high: number, back: number, front: number, bow: number, rise: number, stern: number, lift: number): number[] => {
      const points: number[] = [];
      for (const x of [halfWidth, -halfWidth]) {
        points.push(x, high, front, x, high, back);
        points.push(x, low + rise, front, x, low, bow);
        points.push(x, low + lift, back, x, low, stern);
      }
      return points;
    };
    const frontAxle = Math.max(...def.axles.map((a) => a.z));
    const rearAxle = Math.min(...def.axles.map((a) => a.z));
    // Bodywork: sloping from over the front axle to near half its height up the front.
    const cy = box.center[1]!, cz = box.center[2]!;
    const bottom = cy - h / 2, nose = cz + l / 2, tail = cz - l / 2;
    const bow = Math.min(nose - 0.3, Math.max(frontAxle, nose - 1.2));
    const stern = Math.max(tail + 0.3, Math.min(rearAxle, tail + 0.9));
    solid(hull(w / 2, bottom, cy + h / 2, tail, nose, bow, h * 0.45, stern, h * 0.3));
    // Under it the frame between the axles, what grounds out on a crest; a long wedge at each end.
    const clearance = def.chassis.groundClearance;
    if (bottom > clearance) {
      const front = frontAxle + 0.3, rear = rearAxle - 0.3;
      const tall = bottom - clearance;
      solid(hull(0.5, clearance, bottom, rear, front, Math.max((front + rear) / 2, frontAxle - 0.4), tall * 0.9, Math.min((front + rear) / 2, rearAxle + 0.3), tall * 0.9));
    }

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const wheelCount = def.axles.length * 2;
    const staticLoad = (mass * GRAVITY) / wheelCount;
    def.axles.forEach((axle, a) => {
      const s = axle.suspension;
      // Long enough that the strut can stretch its full travel below where it rests.
      const rest = s.travel + staticLoad / s.stiffness;
      for (const side of [1, -1]) {
        const i = this.wheels.length;
        // Chosen so the wheel's lowest point is at y = 0 when the vehicle stands still.
        const y = def.wheels.radius + s.travel;
        this.restLength.push(rest);
        this.travel.push(s.travel);
        this.connectionY.push(y);
        this.controller.addWheel({ x: (side * axle.track) / 2, y, z: axle.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, def.wheels.radius);
        // Rapier multiplies the spring's result by the chassis mass, so it wants rates per kilogram.
        this.controller.setWheelSuspensionStiffness(i, s.stiffness / mass);
        this.controller.setWheelSuspensionCompression(i, s.damping / mass);
        this.controller.setWheelSuspensionRelaxation(i, s.damping / mass);
        this.controller.setWheelMaxSuspensionTravel(i, s.travel);
        this.controller.setWheelMaxSuspensionForce(i, staticLoad * 8);
        this.controller.setWheelSideFrictionStiffness(i, 1);
        this.wheels.push({ contact: false, load: 0, ground: 'dirt', grip: 0.6, spin: 0, skid: 0, slide: 0, suspension: rest, bump: 0, steer: 0, rotation: 0, sink: 0, softness: 0, snow: 0, water: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });
        void a;
      }
    });
    this.locks = def.axles.map((axle) => axle.differential === 'locked');
  }

  /** Puts the vehicle at a world position (its ground point), facing `heading` degrees: 0 north (-z), 90 east (+x). */
  place(x: number, y: number, z: number, heading: number): void {
    // Local +z is forward; turning by (180° - heading) about the vertical points it the right way.
    const half = ((180 - heading) * Math.PI) / 360;
    this.unfollow();
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.drivetrain.gear = 1;
    this.holding = true;
    this.crawl = 0;
    this.crawlLever = 0;
    this.righting = null;
    this.drowned = false;
    this.drowning = 0;
    for (const wheel of this.wheels) wheel.sink = wheel.water = 0;
  }

  /** How upright the vehicle stands: 1 on its wheels, 0 on its side, -1 on its roof. */
  get upright(): number {
    const r = this.body.rotation();
    return 1 - 2 * (r.x * r.x + r.z * r.z);
  }

  /** True while it is being rolled back onto its wheels. */
  get beingRighted(): boolean {
    return this.righting !== null;
  }

  /**
   * Rolls the vehicle back onto its wheels where it lies, keeping the way it was pointing:
   * lifted a little, turned upright and set down on `groundY` over about a second.
   */
  right(groundY: number): void {
    const p = this.body.translation();
    const r = this.body.rotation();
    // Its heading, from the nose; from the roof's direction if it lies nose-down.
    let [fx, , fz] = rotate(r, 0, 0, 1);
    if (Math.hypot(fx, fz) < 0.3) [fx, , fz] = rotate(r, 0, 1, 0);
    const heading = (Math.atan2(fx, -fz) * 180) / Math.PI;
    const half = ((180 - heading) * Math.PI) / 360;
    this.righting = {
      from: { p: { x: p.x, y: p.y, z: p.z }, q: { x: r.x, y: r.y, z: r.z, w: r.w } },
      to: { p: { x: p.x, y: Math.max(groundY + 0.25, p.y - 0.5), z: p.z }, q: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) } },
      t: 0,
    };
    this.drivetrain.gear = 1;
    this.holding = true;
    for (const wheel of this.wheels) wheel.sink = 0;
  }

  /** Moves the righting along; true while it is still going. */
  private stepRighting(dt: number): boolean {
    const r = this.righting;
    if (!r) return false;
    r.t = Math.min(1, r.t + dt / RIGHTING_TIME);
    const k = r.t * r.t * (3 - 2 * r.t);
    const lift = Math.sin(Math.PI * r.t) * RIGHTING_LIFT;
    this.body.setTranslation({
      x: r.from.p.x + (r.to.p.x - r.from.p.x) * k,
      y: r.from.p.y + (r.to.p.y - r.from.p.y) * k + lift,
      z: r.from.p.z + (r.to.p.z - r.from.p.z) * k,
    }, true);
    this.body.setRotation(slerp(r.from.q, r.to.q, k), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (r.t >= 1) this.righting = null;
    return true;
  }

  /** Changes between high and low range, on a vehicle that has a low range. */
  toggleRange(): void {
    if (this.def.drivetrain.ranges.low === undefined) return;
    this.drivetrain.range = this.drivetrain.range === 'high' ? 'low' : 'high';
    if (this.drivetrain.range === 'high') this.crawl = 0;
  }

  /**
   * Crawl control's key, on a vehicle that has it and only in low range: each press steps to
   * the next speed and from the fastest back off; `off` turns it off at once.
   */
  crawlKey(off = false): void {
    const speeds = this.def.drivetrain.crawl;
    if (!speeds || this.drivetrain.range !== 'low') return;
    this.crawl = off || this.crawl >= speeds.length ? 0 : this.crawl + 1;
  }

  /** Locks or frees an axle's differential, if it is a lockable one. */
  toggleLock(axle: number): void {
    if (this.def.axles[axle]?.differential === 'lockable') this.locks[axle] = !this.locks[axle];
  }

  /**
   * Where wheel i's centre is in the vehicle's own frame right now: down in the mud or on the
   * bed of the water, below where the physics rests it on the surface.
   */
  wheelPosition(i: number): { x: number; y: number; z: number } {
    const axle = this.def.axles[i >> 1]!;
    return { x: ((i & 1 ? -1 : 1) * axle.track) / 2, y: this.connectionY[i]! - this.wheels[i]!.suspension, z: axle.z };
  }

  /** Call just before stepping the world (after `step`). */
  beforeWorldStep(): void {
    const v = this.body.linvel(), w = this.body.angvel();
    this.before.x = v.x;
    this.before.y = v.y;
    this.before.z = v.z;
    this.spinBefore.x = w.x;
    this.spinBefore.y = w.y;
    this.spinBefore.z = w.z;
  }

  /** Call just after stepping the world: glances the body off edges of ground it ran into. */
  afterWorldStep(): void {
    if (this.followed || this.righting) return;
    const b = this.before, v = this.body.linvel();
    const speed = Math.hypot(b.x, b.z);
    if (speed < GLANCE_MIN) return;
    const ux = b.x / speed, uz = b.z / speed;
    const lost = speed - (v.x * ux + v.z * uz);
    if (lost < GLANCE_LOST || !this.bodyOnGroundOnly()) return;
    const back = lost * GLANCE_KEEP;
    this.body.setLinvel({ x: v.x + ux * back, y: v.y, z: v.z + uz * back }, true);
    // The blow below the middle would throw the nose up and over backwards; most of that spin is taken back.
    const w = this.body.angvel(), w0 = this.spinBefore;
    this.body.setAngvel({ x: w.x + (w0.x - w.x) * GLANCE_STEADY, y: w.y + (w0.y - w.y) * GLANCE_STEADY, z: w.z + (w0.z - w.z) * GLANCE_STEADY }, true);
    this.glanced++;
  }

  /** Whether the body (not the wheels) touches the ground, and nothing else. */
  private bodyOnGroundOnly(): boolean {
    let ground = false, other = false;
    for (const c of this.colliders) {
      this.world.contactPairsWith(c, (o) => {
        if (this.chassis.has(o.handle)) return;
        let touching = false;
        this.world.contactPair(c, o, (m) => {
          if (m.numContacts() > 0) touching = true;
        });
        if (!touching) return;
        if ((o.collisionGroups() >>> 16) & GROUP_GROUND) ground = true;
        else other = true;
      });
    }
    return ground && !other;
  }

  /** Works out this step's wheel forces from the driver's input. Call before stepping the world. */
  step(input: VehicleInput, dt: number): void {
    // Being put back on its wheels: no driving until it is down.
    if (this.stepRighting(dt)) input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const { def, controller: c } = this;
    const v = this.body.linvel();
    const r = this.body.rotation();
    // The body's forward (+z) axis in the world.
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fy = 2 * (r.y * r.z - r.w * r.x);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    this.speed = v.x * fx + v.y * fy + v.z * fz;

    // Pedals: from a standstill the brake pedal selects reverse and then drives backwards.
    // With crawl control on, that pedal only pauses the crawl, stopping it, and changes the
    // direction once it has been held a while at a standstill.
    const state = this.drivetrain;
    const against = state.gear > 0 ? input.brake > 0.1 && input.throttle < 0.1 : input.throttle > 0.1 && input.brake < 0.1;
    this.againstHeld = against && Math.abs(this.speed) < 0.1 ? this.againstHeld + dt : 0;
    const turn = this.crawl > 0 ? this.againstHeld >= CRAWL_TURN : state.gear > 0 ? this.speed < 0.5 : this.speed > -0.5;
    if (against && turn) {
      selectDirection(state, state.gear > 0);
      this.crawlLever = 0;
    }
    const pedal = this.drowned ? 0 : state.gear > 0 ? input.throttle : input.brake;
    let drive = input.digital ? this.ease(pedal, dt) : pedal;
    let brake = state.gear > 0 ? input.brake : input.throttle;
    // Crawl control holds its speed, in the gear's direction, while no pedal is pressed.
    const speeds = def.drivetrain.crawl;
    this.crawling = this.crawl > 0 && !!speeds && state.range === 'low' && !this.drowned && !this.righting
      && input.throttle < 0.05 && input.brake < 0.05 && !input.handbrake;
    if (this.crawling) {
      const want = speeds![this.crawl - 1]! / 3.6;
      const miss = want - (state.gear < 0 ? -this.speed : this.speed);
      this.crawlLever = Math.max(-1, Math.min(1, this.crawlLever + CRAWL_I * miss * dt));
      const lever = Math.max(-1, Math.min(1, this.crawlLever + CRAWL_P * miss));
      drive = Math.max(0, lever);
      brake = Math.max(0, -lever);
      this.eased = drive;
    }
    this.pedal = drive;

    const wet = this.ground.wetness();
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]!;
      wheel.contact = c.wheelIsInContact(i);
      wheel.load = wheel.contact ? (c.wheelSuspensionForce(i) ?? 0) : 0;
      const point = wheel.contact ? c.wheelContactPoint(i) : null;
      const normal = wheel.contact ? c.wheelContactNormal(i) : null;
      if (point) {
        Object.assign(wheel.point, { x: point.x, y: point.y, z: point.z });
        const under = this.underfoot(point.x, point.z);
        wheel.ground = under.ground;
        wheel.snow = under.snow;
        this.waterUnder[i] = under.water;
      }
      if (normal) Object.assign(wheel.normal, { x: normal.x, y: normal.y, z: normal.z });
      wheel.grip = tireOnGround(def, wheel.ground, wet).grip;
    }
    this.sinkWheels(dt);

    const out = stepDrivetrain(def, state, drive, this.speed, dt);
    if (this.drowned) {
      out.driveForce = 0;
      out.engineBrakeForce = 0;
      state.rpm = 0;
    }
    const driven: AxleDrive[] = [];
    def.axles.forEach((axle, a) => {
      if (!axle.driven) return;
      const left = this.wheels[a * 2]!, right = this.wheels[a * 2 + 1]!;
      driven.push({ locked: this.locks[a]!, braked: axle.differential === 'braked', available: [left.grip * left.load, right.grip * right.load] });
    });
    const split = splitDrive(out.driveForce, driven);

    // With nobody on the pedals, once nearly stopped, hold still instead of creeping
    // downhill; a pedal lets go again.
    const pulled = this.pulled || this.towed;
    this.towed = false;
    if (drive >= 0.02 || brake >= 0.02 || pulled || this.crawling) this.holding = false;
    else if (Math.abs(this.speed) < 0.6) this.holding = true;
    const weight = def.chassis.mass * GRAVITY;
    const handbraked = def.axles.filter((a) => a.handbrake).length * 2 || this.wheels.length;

    const lock = (def.axles.find((a) => a.steer > 0)?.steer ?? 0) * (Math.PI / 180);
    const eased = 1 / (1 + (this.speed / STEER_HALF_SPEED) ** 2);
    const target = Math.max(-1, Math.min(1, input.steer)) * eased;
    const current = lock > 0 ? this.steerAngle / lock : 0;
    this.steerAngle = lock * (current + Math.max(-STEER_RATE * dt / Math.max(lock, 0.01), Math.min(STEER_RATE * dt / Math.max(lock, 0.01), target - current)));

    // Rear-wheel steering turns the other way from the front to tighten the turn at low speed,
    // and lets go towards motorway speeds, where it would only make the vehicle twitchy.
    const rearSteer = Math.max(0, 1 - Math.abs(this.speed) / REAR_STEER_FADE);
    let d = 0;
    def.axles.forEach((axle, a) => {
      for (let side = 0; side < 2; side++) {
        const i = a * 2 + side;
        const wheel = this.wheels[i]!;
        const tire = tireOnGround(def, wheel.ground, wet);
        let hold = (brake * def.brakes.force * axle.brakeShare) / 2 + tire.rollingResistance * wheel.load;
        // Rolling resistance and the rut's drag. Rapier leaves out a wheel's brake while it is
        // driven, so on a driven wheel it comes off the drive force instead: holding it back from
        // a standstill, slowing it once rolling. Off the drive it all goes on the brake.
        // Ruts drag, and so does snow pushed aside.
        const belly = Math.max(0, wheel.snow * SNOW_PACK - def.chassis.groundClearance - wheel.sink);
        const sunk = ((wheel.snow ? SNOW_RUT : RUT_DRAG) * (wheel.sink / def.wheels.radius) ** 2 + SNOW_DRAG * wheel.snow + SNOW_BELLY * belly) * wheel.load;
        let force = axle.driven ? split.forces[d]! : 0;
        if (force !== 0) {
          const drag = tire.rollingResistance * wheel.load + sunk;
          if (Math.abs(this.speed) > 0.3) force -= drag * Math.sign(this.speed);
          else force = Math.sign(force) * Math.max(0, Math.abs(force) - drag);
        }
        if (force === 0) hold += sunk;
        if (axle.driven) hold += out.engineBrakeForce / (driven.length * 2);
        if (input.handbrake && (axle.handbrake || handbraked === this.wheels.length)) hold += (0.7 * weight) / handbraked;
        // How far the brakes outdo the tyre, counted only while really moving.
        const holds = wheel.grip * wheel.load;
        wheel.skid = wheel.contact && holds > 0
          ? Math.min(1, Math.max(0, (hold / holds - 0.8) / 1.2)) * Math.min(1, Math.max(0, (Math.abs(this.speed) - 1) / 3))
          : 0;
        if (this.holding) hold += (0.8 * weight) / this.wheels.length;
        c.setWheelBrake(i, hold * dt); // Rapier takes the brake as an impulse per step
        c.setWheelEngineForce(i, force);
        wheel.spin = axle.driven ? split.spin[d]! : 0;
        if (axle.driven) d++;
        c.setWheelFrictionSlip(i, Math.max(0.05, wheel.grip));
        wheel.steer = axle.steer !== 0 && lock > 0 ? this.steerAngle * (axle.steer / (lock * (180 / Math.PI))) * (axle.steer < 0 ? rearSteer : 1) : 0;
        c.setWheelSteering(i, wheel.steer);
      }
    });

    this.pushThroughWater(dt);
    this.pushThroughAir(dt);
    c.updateVehicle(dt, undefined, groups(0xffff, GROUP_GROUND));
    const w = this.body.angvel();
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]!;
      wheel.suspension = c.wheelSuspensionLength(i) ?? this.restLength[i]!;
      wheel.bump = Math.min(1, Math.max(0, (this.restLength[i]! - wheel.suspension) / this.travel[i]!));
      wheel.rotation = c.wheelRotation(i) ?? 0;
      // Velocity of the contact patch (body velocity plus spin about the centre), along the
      // tyre's own sideways axis.
      const at = this.wheelPosition(i);
      const [ox, oy, oz] = rotate(r, at.x, at.y - def.wheels.radius, at.z);
      const vx = v.x + w.y * oz - w.z * oy, vy = v.y + w.z * ox - w.x * oz, vz = v.z + w.x * oy - w.y * ox;
      const [sx, sy, sz] = rotate(r, Math.cos(wheel.steer), 0, -Math.sin(wheel.steer));
      wheel.slide = wheel.contact ? vx * sx + vy * sy + vz * sz : 0;
    }
  }

  /**
   * Lets each tyre settle into soft ground, dig in while spinning and climb out while rolling,
   * and go down to the bed of any water; the body sits that much lower.
   */
  private sinkWheels(dt: number): void {
    const r = this.def.wheels.radius;
    const staticLoad = (this.def.chassis.mass * GRAVITY) / this.wheels.length;
    // The vehicle's own pressure standing still decides how deep it goes; weight shifting onto
    // a wheel while driving adds a little (its square root), as before.
    const pressure = groundPressure(this.def) / PRESSURE_REF;
    const travelled = Math.abs(this.speed) * dt;
    let wading = 0, wet = false;
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]!;
      if (wheel.contact) {
        const { x, z } = wheel.point;
        const depth = this.waterUnder[i] ?? this.ground.waterDepth(x, z);
        wheel.water += Math.max(-DEPTH_RATE * dt, Math.min(DEPTH_RATE * dt, depth - wheel.water));
        // In snow the frozen ground beneath is firm: the snow decides how far a tyre goes down.
        const snow = wheel.snow;
        wheel.softness = snow ? SNOW_SOFTNESS * Math.min(1, snow / SNOW_SOFT_DEPTH) : this.ground.softness(x, z);
        const soft = wheel.softness;
        const loaded = Math.min(PRESSURE_MAX, pressure * Math.sqrt(Math.min(2, wheel.load / staticLoad)));
        const settle = snow ? Math.min(SNOW_SETTLE * snow, SNOW_SINK * r) * loaded : SETTLE * r * soft * loaded;
        const bottom = snow ? Math.min(snow * 0.85, SNOW_DIG_LIMIT * r) : DIG_LIMIT * r;
        if (wheel.sink < settle) wheel.sink += (settle - wheel.sink) * Math.min(1, travelled / SETTLE_DISTANCE + dt * 0.1);
        else if (wheel.spin < 0.1) wheel.sink -= (wheel.sink - settle) * Math.min(1, travelled / CLIMB_DISTANCE);
        // A spinning tyre polishes snow as much as it digs it.
        wheel.sink = Math.min(Math.max(bottom, settle), wheel.sink + wheel.spin * DIG_RATE * soft * (snow ? SNOW_DIG : 1) * dt);
      } else {
        // Lifted clear: out of the rut, and the water drains towards nothing until it lands again.
        wheel.sink = Math.max(0, wheel.sink - dt);
        wheel.water = Math.max(0, wheel.water - DEPTH_RATE * dt * 0.25);
      }
      if (wheel.water > 0.02) wet = true;
      wading = Math.max(wading, wheel.water + wheel.sink);
      const at = this.wheelPosition(i);
      this.controller.setWheelChassisConnectionPointCs(i, { x: at.x, y: this.connectionY[i]! + wheel.sink + wheel.water, z: at.z });
    }
    this.wading = wet ? wading : 0;

    // Deep in a lake the body sits below the water's surface, which is where the ground's
    // collider is; it bumps the ground again once the water is shallow.
    const deep = this.wheels.some((w) => w.water > this.def.chassis.groundClearance * 0.6);
    const shallow = this.wheels.every((w) => w.water < 0.08);
    if (this.bodyMeetsGround === deep || (!this.bodyMeetsGround && shallow)) {
      this.bodyMeetsGround = !deep;
      const filter = (this.bodyMeetsGround ? GROUP_GROUND : 0) | GROUP_OBSTACLE | GROUP_VEHICLE;
      for (const collider of this.colliders) collider.setCollisionGroups(groups(GROUP_VEHICLE, filter));
    }

    // The engine drowns with water over its intake for a moment, and starts again a while after.
    const limit = this.def.chassis.wading ?? WADING;
    if (!this.drowned) {
      this.drowning = this.wading > limit ? this.drowning + dt : 0;
      if (this.drowning > DROWN_TIME) {
        this.drowned = true;
        this.drowning = 0;
      }
    } else {
      this.drowning = wet ? 0 : this.drowning + dt;
      if (this.drowning > DRY_TIME) {
        this.drowned = false;
        this.drowning = 0;
      }
    }
  }

  /** A key-pressed driving pedal, eased in and feathered by how the driven tyres grip. */
  private ease(pedal: number, dt: number): number {
    if (pedal <= 0) return (this.eased = 0);
    let grip = 0, spin = 0, n = 0;
    this.def.axles.forEach((axle, a) => {
      if (!axle.driven) return;
      for (const wheel of [this.wheels[a * 2]!, this.wheels[a * 2 + 1]!]) {
        if (!wheel.contact) continue;
        grip += wheel.grip;
        spin = Math.max(spin, wheel.spin);
        n++;
      }
    });
    const slippery = n ? Math.min(1, Math.max(0, (GRIP_FIRM - grip / n) / (GRIP_FIRM - GRIP_SLIPPERY))) : 0;
    if (spin > EASE_SPIN && slippery > 0) this.eased = Math.max(Math.min(this.eased, EASE_FLOOR), this.eased - EASE_BACK * slippery * dt);
    else this.eased = Math.min(pedal, this.eased + dt / (EASE_FIRM + (EASE_SLIPPERY - EASE_FIRM) * slippery));
    return this.eased;
  }

  /**
   * The ground and the depth of water at a spot, with ice taken into account: ice thick
   * enough for this vehicle is ground to drive on; thinner ice breaks, into the water below.
   */
  private underfoot(x: number, z: number): { ground: string; water: number; snow: number } {
    const ground = this.ground.groundAt(x, z);
    const water = this.ground.waterDepth(x, z);
    const lying = this.ground.snowAt?.(x, z) ?? 0;
    const snow = lying > SNOW_DUSTING ? lying : 0;
    if (water <= 0) return snow ? { ground: 'snow', water, snow } : { ground, water, snow };
    const ice = this.ground.iceAt?.(x, z) ?? 0;
    // Open water carries no snow.
    if (ice <= 0) return { ground, water, snow: 0 };
    if (ice >= this.iceNeeded) return snow ? { ground: 'snow', water: 0, snow } : { ground: 'ice', water: 0, snow };
    this.ground.breakIce?.(x, z);
    return { ground, water, snow: 0 };
  }

  /** Air drag, at the centre of mass: half the air's density times Cd·A times the speed squared. */
  private pushThroughAir(dt: number): void {
    const area = this.def.chassis.dragArea ?? 0;
    if (area <= 0) return;
    const v = this.body.linvel();
    const k = -0.5 * AIR_DENSITY * area * Math.hypot(v.x, v.y, v.z) * dt;
    this.body.applyImpulse({ x: k * v.x, y: k * v.y, z: k * v.z }, true);
  }

  /** Lift and drag on the body where it is under water, worked out at the corners of its underside. */
  private pushThroughWater(dt: number): void {
    let level = 0, n = 0;
    for (const wheel of this.wheels) {
      if (wheel.contact && wheel.water > 0.02) {
        level += wheel.point.y;
        n++;
      }
    }
    if (!n) return;
    level /= n; // the surface: the ground's collider lies at the water's top
    const { box, groundClearance } = this.def.chassis;
    const [w, h, l] = box.size as [number, number, number];
    const top = box.center[1]! + h / 2;
    const tall = top - groundClearance;
    const p = this.body.translation(), q = this.body.rotation(), v = this.body.linvel(), av = this.body.angvel();
    const area = (w * l) / 4;
    for (const [cx, cz] of [[w / 2, l / 2], [-w / 2, l / 2], [w / 2, -l / 2], [-w / 2, -l / 2]] as const) {
      const [ox, oy, oz] = rotate(q, cx * 0.8, groundClearance, cz * 0.8);
      const x = p.x + ox, y = p.y + oy, z = p.z + oz;
      if (this.underfoot(x, z).water <= 0) continue;
      const under = Math.min(tall, level - y);
      if (under <= 0) continue;
      // Velocity of this corner, then its parts along the body's own axes.
      const vx = v.x + av.y * oz - av.z * oy, vy = v.y + av.z * ox - av.x * oz, vz = v.z + av.x * oy - av.y * ox;
      const [ax, ay, az] = rotate(q, 1, 0, 0);
      const [fx, fy, fz] = rotate(q, 0, 0, 1);
      const side = vx * ax + vy * ay + vz * az, ahead = vx * fx + vy * fy + vz * fz;
      const k = 0.5 * WATER_DENSITY * WATER_DRAG * under;
      // Each corner carries half of a face: the front or back is w wide, a side l long.
      const dragAhead = -k * (w / 2) * ahead * Math.abs(ahead);
      const dragSide = -k * (l / 2) * side * Math.abs(side);
      const lift = WATER_DENSITY * GRAVITY * FLOAT_SHARE * area * under - 0.5 * WATER_DENSITY * area * vy * Math.abs(vy);
      this.body.applyImpulseAtPoint({
        x: (fx * dragAhead + ax * dragSide) * dt,
        y: (fy * dragAhead + ay * dragSide + lift) * dt,
        z: (fz * dragAhead + az * dragSide) * dt,
      }, { x, y, z }, true);
    }
  }

  /** Everything needed to carry on running this vehicle elsewhere (without its winch). */
  save(jump: number): Omit<VehicleHandover, 'winch'> {
    const p = this.body.translation(), q = this.body.rotation(), v = this.body.linvel(), w = this.body.angvel();
    const d = this.drivetrain;
    return {
      vehicle: this.def.name,
      jump,
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
      v: [v.x, v.y, v.z],
      w: [w.x, w.y, w.z],
      wheels: this.wheels.map((wheel) => [wheel.sink, wheel.water, wheel.suspension, wheel.rotation]) as VehicleHandover['wheels'],
      gear: d.gear,
      low: d.range === 'low',
      rpm: d.rpm,
      locks: [...this.locks] as VehicleHandover['locks'],
      holding: this.holding,
      crawl: this.crawl,
      drowned: this.drowned,
      steer: this.steerAngle,
    };
  }

  /** Carries on from what another browser saved (`save`), running the vehicle here again. */
  load(s: Omit<VehicleHandover, 'winch'>): void {
    this.unfollow();
    const [px = 0, py = 0, pz = 0] = s.p, [qx = 0, qy = 0, qz = 0, qw = 1] = s.q;
    this.body.setTranslation({ x: px, y: py, z: pz }, true);
    this.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
    this.body.setLinvel({ x: s.v[0]!, y: s.v[1]!, z: s.v[2]! }, true);
    this.body.setAngvel({ x: s.w[0]!, y: s.w[1]!, z: s.w[2]! }, true);
    this.wheels.forEach((wheel, i) => {
      const [sink = 0, water = 0, suspension = wheel.suspension, rotation = wheel.rotation] = s.wheels[i] ?? [];
      Object.assign(wheel, { sink, water, suspension, rotation });
    });
    const d = this.drivetrain;
    d.gear = s.gear || 1;
    d.range = s.low && this.def.drivetrain.ranges.low !== undefined ? 'low' : 'high';
    d.rpm = s.rpm;
    d.shifting = 0;
    if (s.locks.length === this.locks.length) s.locks.forEach((l, i) => (this.locks[i] = l));
    this.holding = s.holding;
    this.crawl = d.range === 'low' ? Math.min(s.crawl ?? 0, this.def.drivetrain.crawl?.length ?? 0) : 0;
    this.crawlLever = 0;
    this.drowned = s.drowned;
    this.drowning = 0;
    this.steerAngle = s.steer;
    this.eased = 0;
    this.righting = null;
  }

  /** True while another browser runs this vehicle and this one follows it. */
  get following(): boolean {
    return this.followed;
  }

  /**
   * Another browser runs the vehicle: moves it to where that browser says, as a body nothing
   * here can push, and takes the wheels and engine from it too. `pose` null holds it where it is.
   */
  follow(pose: FollowPose | null, dt: number): void {
    if (!this.followed) {
      this.followed = true;
      this.righting = null;
      this.body.setBodyType(this.R.RigidBodyType.KinematicPositionBased, true);
    }
    if (!pose) {
      this.body.setNextKinematicTranslation(this.body.translation());
      this.body.setNextKinematicRotation(this.body.rotation());
      return;
    }
    const [x = 0, y = 0, z = 0] = pose.p, [qx = 0, qy = 0, qz = 0, qw = 1] = pose.q;
    const q = { x: qx, y: qy, z: qz, w: qw };
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setNextKinematicRotation(q);
    this.speed = pose.speed;
    this.pedal = pose.engine.pedal;
    this.drowned = pose.engine.drowned;
    this.wading = pose.wading;
    Object.assign(this.drivetrain, { gear: pose.engine.gear, range: pose.engine.low ? 'low' : 'high', rpm: pose.engine.rpm, shifting: pose.engine.shifting ? 0.1 : 0 });
    const r = this.def.wheels.radius;
    const load = (this.def.chassis.mass * GRAVITY) / this.wheels.length;
    const [ux, uy, uz] = rotate(q, 0, 1, 0);
    this.wheels.forEach((wheel, i) => {
      const [steer = 0, suspension = wheel.suspension, sink = 0, spin = 0, skid = 0, slide = 0, water = 0] = pose.wheels[i] ?? [];
      Object.assign(wheel, { steer, suspension, sink, spin, skid, slide, water });
      wheel.rotation = (wheel.rotation + (pose.speed / r) * dt) % (Math.PI * 2);
      const ground = pose.ground[i] ?? '';
      wheel.contact = ground !== '';
      if (wheel.contact) wheel.ground = ground;
      wheel.load = wheel.contact ? load : 0;
      wheel.bump = Math.min(1, Math.max(0, (this.restLength[i]! - suspension) / this.travel[i]!));
      const at = this.wheelPosition(i);
      const [ox, oy, oz] = rotate(q, at.x, at.y - r + sink + water, at.z);
      Object.assign(wheel.point, { x: x + ox, y: y + oy, z: z + oz });
      Object.assign(wheel.normal, { x: ux, y: uy, z: uz });
    });
  }

  /** Runs the vehicle here again where it stands, still. */
  unfollow(): void {
    if (!this.followed) return;
    this.followed = false;
    this.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body); // takes its colliders with it
  }
}
