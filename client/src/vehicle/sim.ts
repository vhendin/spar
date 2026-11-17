// One vehicle in the physics world: a rigid body on ray-cast wheels, driven by the
// drivetrain and tyre models from the vehicle definition. No rendering and no browser
// APIs in here, so it also runs in tests and could run on a server.

import type RAPIER from '@dimforge/rapier3d-compat';
import {
  newDrivetrainState, selectDirection, splitDrive, stepDrivetrain, tireOnGround,
  type AxleDrive, type DrivetrainState, type VehicleDef,
} from '@spar/shared';

type Rapier = typeof RAPIER;

/** Collision groups: wheels feel only the ground; bodies also hit trees, rocks and each other. */
export const GROUP_GROUND = 0x0001;
export const GROUP_OBSTACLE = 0x0002;
export const GROUP_VEHICLE = 0x0004;
export const groups = (member: number, filter: number): number => ((member << 16) | filter) >>> 0;

const GRAVITY = 9.81;
/** Steering lock halves at this speed (m/s), so the vehicle stays steady on the road. */
const STEER_HALF_SPEED = 13;
/** How fast the steered wheels turn, radians per second. */
const STEER_RATE = 1.4;

export interface VehicleInput {
  /** Pedals, 0..1. In reverse they swap roles: the brake pedal drives backwards. */
  throttle: number;
  brake: number;
  /** -1 full right to 1 full left. */
  steer: number;
  handbrake: boolean;
}

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
  /** Steering angle and accumulated roll, radians. */
  steer: number;
  rotation: number;
}

/** Tells the vehicle what it is driving on. */
export interface GroundProbe {
  /** A ground name from defs/ground.json at a world position. */
  groundAt(x: number, z: number): string;
  /** 0 dry to 1 soaked. */
  wetness(): number;
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
  /** True while the vehicle holds itself still with nobody on the pedals, like a parking brake. */
  holding = true;

  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly restLength: number[] = [];
  private readonly connectionY: number[] = [];
  private steerAngle = 0;

  constructor(
    private readonly R: Rapier,
    private readonly world: RAPIER.World,
    readonly def: VehicleDef,
    private readonly ground: GroundProbe,
  ) {
    const { mass, centerOfMass: com, box } = def.chassis;
    const [w, h, l] = box.size as [number, number, number];
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
        .setLinearDamping(0.02)
        .setAngularDamping(0.25),
    );
    const solid = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
      world.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(x, y, z)
          .setDensity(0) // the mass is set on the body, above
          .setFriction(0.5)
          .setRestitution(0.05)
          .setCollisionGroups(groups(GROUP_VEHICLE, GROUP_GROUND | GROUP_OBSTACLE | GROUP_VEHICLE)),
        this.body,
      );
    };
    // Bodywork, and under it the frame between the axles: what grounds out on a crest.
    solid(w / 2, h / 2, l / 2, box.center[0]!, box.center[1]!, box.center[2]!);
    const bottom = box.center[1]! - h / 2;
    const clearance = def.chassis.groundClearance;
    const front = Math.max(...def.axles.map((a) => a.z)) + 0.3;
    const rear = Math.min(...def.axles.map((a) => a.z)) - 0.3;
    if (bottom > clearance) solid(0.5, (bottom - clearance) / 2, (front - rear) / 2, 0, (bottom + clearance) / 2, (front + rear) / 2);

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
        this.connectionY.push(y);
        this.controller.addWheel({ x: (side * axle.track) / 2, y, z: axle.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, def.wheels.radius);
        // Rapier multiplies the spring's result by the chassis mass, so it wants rates per kilogram.
        this.controller.setWheelSuspensionStiffness(i, s.stiffness / mass);
        this.controller.setWheelSuspensionCompression(i, s.damping / mass);
        this.controller.setWheelSuspensionRelaxation(i, s.damping / mass);
        this.controller.setWheelMaxSuspensionTravel(i, s.travel);
        this.controller.setWheelMaxSuspensionForce(i, staticLoad * 8);
        this.controller.setWheelSideFrictionStiffness(i, 1);
        this.wheels.push({ contact: false, load: 0, ground: 'dirt', grip: 0.6, spin: 0, skid: 0, slide: 0, suspension: rest, steer: 0, rotation: 0 });
        void a;
      }
    });
    this.locks = def.axles.map((axle) => axle.differential === 'locked');
  }

  /** Puts the vehicle at a world position (its ground point), facing `heading` degrees: 0 north (-z), 90 east (+x). */
  place(x: number, y: number, z: number, heading: number): void {
    // Local +z is forward; turning by (180° - heading) about the vertical points it the right way.
    const half = ((180 - heading) * Math.PI) / 360;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.drivetrain.gear = 1;
    this.holding = true;
  }

  toggleRange(): void {
    this.drivetrain.range = this.drivetrain.range === 'high' ? 'low' : 'high';
  }

  /** Locks or frees an axle's differential, if it is a lockable one. */
  toggleLock(axle: number): void {
    if (this.def.axles[axle]?.differential === 'lockable') this.locks[axle] = !this.locks[axle];
  }

  /** Where wheel i's centre is in the vehicle's own frame right now. */
  wheelPosition(i: number): { x: number; y: number; z: number } {
    const axle = this.def.axles[i >> 1]!;
    return { x: ((i & 1 ? -1 : 1) * axle.track) / 2, y: this.connectionY[i]! - this.wheels[i]!.suspension, z: axle.z };
  }

  /** Works out this step's wheel forces from the driver's input. Call before stepping the world. */
  step(input: VehicleInput, dt: number): void {
    const { def, controller: c } = this;
    const v = this.body.linvel();
    const r = this.body.rotation();
    // The body's forward (+z) axis in the world.
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fy = 2 * (r.y * r.z - r.w * r.x);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    this.speed = v.x * fx + v.y * fy + v.z * fz;

    // Pedals: from a standstill the brake pedal selects reverse and then drives backwards.
    const state = this.drivetrain;
    if (state.gear > 0 && input.brake > 0.1 && input.throttle < 0.1 && this.speed < 0.5) selectDirection(state, true);
    else if (state.gear < 0 && input.throttle > 0.1 && input.brake < 0.1 && this.speed > -0.5) selectDirection(state, false);
    const drive = state.gear > 0 ? input.throttle : input.brake;
    const brake = state.gear > 0 ? input.brake : input.throttle;

    const wet = this.ground.wetness();
    const point = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]!;
      wheel.contact = c.wheelIsInContact(i);
      wheel.load = wheel.contact ? (c.wheelSuspensionForce(i) ?? 0) : 0;
      if (wheel.contact && c.wheelContactPoint(i, point)) wheel.ground = this.ground.groundAt(point.x, point.z);
      wheel.grip = tireOnGround(def, wheel.ground, wet).grip;
    }

    const out = stepDrivetrain(def, state, drive, this.speed, dt);
    const driven: AxleDrive[] = [];
    def.axles.forEach((axle, a) => {
      if (!axle.driven) return;
      const left = this.wheels[a * 2]!, right = this.wheels[a * 2 + 1]!;
      driven.push({ locked: this.locks[a]!, available: [left.grip * left.load, right.grip * right.load] });
    });
    const split = splitDrive(out.driveForce, driven);

    // With nobody on the pedals, once nearly stopped, hold still instead of creeping
    // downhill; a pedal lets go again.
    if (drive >= 0.02 || brake >= 0.02) this.holding = false;
    else if (Math.abs(this.speed) < 0.6) this.holding = true;
    const weight = def.chassis.mass * GRAVITY;
    const handbraked = def.axles.filter((a) => a.handbrake).length * 2 || this.wheels.length;

    const lock = (def.axles.find((a) => a.steer > 0)?.steer ?? 0) * (Math.PI / 180);
    const eased = 1 / (1 + (this.speed / STEER_HALF_SPEED) ** 2);
    const target = Math.max(-1, Math.min(1, input.steer)) * eased;
    const current = lock > 0 ? this.steerAngle / lock : 0;
    this.steerAngle = lock * (current + Math.max(-STEER_RATE * dt / Math.max(lock, 0.01), Math.min(STEER_RATE * dt / Math.max(lock, 0.01), target - current)));

    let d = 0;
    def.axles.forEach((axle, a) => {
      for (let side = 0; side < 2; side++) {
        const i = a * 2 + side;
        const wheel = this.wheels[i]!;
        const tire = tireOnGround(def, wheel.ground, wet);
        let hold = (brake * def.brakes.force * axle.brakeShare) / 2 + tire.rollingResistance * wheel.load;
        if (axle.driven) hold += out.engineBrakeForce / (driven.length * 2);
        if (input.handbrake && (axle.handbrake || handbraked === this.wheels.length)) hold += (0.7 * weight) / handbraked;
        // How far the brakes outdo the tyre, counted only while really moving.
        const holds = wheel.grip * wheel.load;
        wheel.skid = wheel.contact && holds > 0
          ? Math.min(1, Math.max(0, (hold / holds - 0.8) / 1.2)) * Math.min(1, Math.max(0, (Math.abs(this.speed) - 1) / 3))
          : 0;
        if (this.holding) hold += (0.8 * weight) / this.wheels.length;
        c.setWheelBrake(i, hold * dt); // Rapier takes the brake as an impulse per step
        c.setWheelEngineForce(i, axle.driven ? split.forces[d]! : 0);
        wheel.spin = axle.driven ? split.spin[d]! : 0;
        if (axle.driven) d++;
        c.setWheelFrictionSlip(i, Math.max(0.05, wheel.grip));
        wheel.steer = axle.steer > 0 ? this.steerAngle * (axle.steer / (lock * (180 / Math.PI) || 1)) : 0;
        c.setWheelSteering(i, wheel.steer);
      }
    });

    c.updateVehicle(dt, undefined, groups(0xffff, GROUP_GROUND));
    const w = this.body.angvel();
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]!;
      wheel.suspension = c.wheelSuspensionLength(i) ?? this.restLength[i]!;
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

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body); // takes its colliders with it
  }
}
