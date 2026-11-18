import * as THREE from 'three/webgpu';

const UP = new THREE.Vector3(0, 1, 0);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/**
 * How the camera follows the vehicle:
 * - chase: behind and above, turning with the vehicle;
 * - orbit: circles the vehicle where it is put, ignoring which way the vehicle turns;
 * - cab: from the driver's seat.
 */
export type CameraMode = 'chase' | 'orbit' | 'cab';
const MODES: CameraMode[] = ['chase', 'orbit', 'cab'];

/** Radians turned per pixel dragged. */
const DRAG = 0.006;
/** Once the vehicle moves faster than this (m/s), a turned chase or cab view swings back. */
const RECENTRE_SPEED = 3;

/**
 * The camera while driving. Dragging with the mouse (either button) or the gamepad's right
 * stick turns it round the vehicle, or looks round the cab; the wheel sets the distance.
 * While aiming the winch, moving the mouse alone turns it.
 */
export class ChaseCamera {
  mode: CameraMode = 'chase';
  /** Metres from the vehicle; the mouse wheel changes it. */
  distance = 9;
  /** The point the camera keeps in view: the middle of the vehicle. */
  readonly target = new THREE.Vector3();

  /** Chase and cab: turned away from straight on. Orbit: the angles in the world. */
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  /** While set, moving the mouse turns the view without a button held: for aiming the winch. */
  freeLook = false;
  private lookedAt = -Infinity;
  private seedOrbit = false;
  private settled = false;
  private speed = 0;
  private readonly lastPosition = new THREE.Vector3();
  /** The driver's eyes in the vehicle's frame; set with the vehicle. */
  readonly eye = new THREE.Vector3(0.4, 1.7, 1.4);
  private readonly forward = new THREE.Vector3();
  private readonly wanted = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    element: HTMLElement,
    private readonly active: () => boolean,
  ) {
    element.addEventListener(
      'wheel',
      (e) => {
        if (this.active() && this.mode !== 'cab') this.distance = Math.max(4, Math.min(40, this.distance * (e.deltaY < 0 ? 0.9 : 1.1)));
      },
      { passive: true },
    );
    element.addEventListener('pointerdown', (e) => {
      if (!this.active() || (e.button !== 0 && e.button !== 2)) return;
      this.dragging = true;
      element.setPointerCapture(e.pointerId);
    });
    element.addEventListener('pointermove', (e) => {
      if (!this.dragging && !(this.freeLook && this.active() && e.pointerType === 'mouse')) return;
      this.look(-e.movementX * DRAG, (this.mode === 'cab' ? -1 : 1) * e.movementY * DRAG);
    });
    const release = (e: PointerEvent): void => {
      this.dragging = false;
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Steps to the next view and returns it. */
  cycle(): CameraMode {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]!);
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.yaw = this.pitch = 0;
    this.seedOrbit = mode === 'orbit';
    this.settled = false;
    // The cab's pillars are an arm's length away.
    this.camera.near = mode === 'cab' ? 0.08 : 0.5;
    this.camera.updateProjectionMatrix();
  }

  /** Forget the eased position, e.g. after the vehicle was moved somewhere else. */
  reset(): void {
    this.settled = false;
    if (this.mode !== 'orbit') this.yaw = this.pitch = 0;
  }

  /** `groundAt` gives the terrain height under a point, to keep the camera out of hillsides. */
  update(dt: number, vehicle: THREE.Object3D, groundAt: (x: number, z: number) => number | null): void {
    if (dt > 0 && this.settled) this.speed = vehicle.position.distanceTo(this.lastPosition) / dt;
    this.lastPosition.copy(vehicle.position);

    // The right stick looks round like the mouse does.
    const pad = navigator.getGamepads?.().find((p) => p?.connected && p.mapping === 'standard');
    const sx = pad?.axes[2] ?? 0, sy = pad?.axes[3] ?? 0;
    if (Math.abs(sx) > 0.15 || Math.abs(sy) > 0.15) this.look(-sx * 2.6 * dt, (this.mode === 'cab' ? -1 : 1) * sy * 1.6 * dt);

    // Once under way again, a turned view swings back to straight on.
    const now = performance.now();
    if (this.mode !== 'orbit' && !this.dragging && !this.freeLook && now - this.lookedAt > 600 && this.speed > RECENTRE_SPEED) {
      const k = Math.exp(-dt * 2.5);
      this.yaw *= k;
      this.pitch *= k;
    }
    const turning = this.dragging || this.freeLook || now - this.lookedAt < 300;

    this.forward.set(0, 0, 1).applyQuaternion(vehicle.quaternion).setY(0);
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, 1);
    this.forward.normalize();
    this.target.copy(vehicle.position).addScaledVector(UP, 1.3);

    if (this.mode === 'cab') {
      this.yaw = THREE.MathUtils.clamp(this.yaw, -2.7, 2.7);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.1, 0.9);
      this.camera.position.copy(this.eye).applyQuaternion(vehicle.quaternion).add(vehicle.position);
      // The camera looks down its -z; the vehicle's front is its +z.
      this.turn.setFromAxisAngle(Y, Math.PI + this.yaw);
      this.tilt.setFromAxisAngle(X, this.pitch);
      this.camera.quaternion.copy(vehicle.quaternion).multiply(this.turn).multiply(this.tilt);
      this.settled = false;
      return;
    }

    const pivot = this.aim.copy(vehicle.position).addScaledVector(UP, 1.5);
    const rise = 0.1 + this.distance * 0.28;
    const reach = Math.hypot(this.distance, rise);
    if (this.seedOrbit) {
      // Start the orbit from wherever the camera is now.
      const from = this.wanted.copy(this.camera.position).sub(pivot);
      this.yaw = Math.atan2(from.x, from.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(from.y / (from.length() || 1), -1, 1));
      this.seedOrbit = false;
    }
    let angle: number, elevation: number;
    if (this.mode === 'orbit') {
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.2, 1.45);
      angle = this.yaw;
      elevation = this.pitch;
    } else {
      const base = Math.atan2(rise, this.distance);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.2 - base, 1.45 - base);
      angle = Math.atan2(-this.forward.x, -this.forward.z) + this.yaw;
      elevation = base + this.pitch;
    }
    this.wanted.set(Math.sin(angle) * Math.cos(elevation), Math.sin(elevation), Math.cos(angle) * Math.cos(elevation)).multiplyScalar(reach).add(pivot);
    const floor = groundAt(this.wanted.x, this.wanted.z);
    if (floor !== null && this.wanted.y < floor + 1.2) this.wanted.y = floor + 1.2;

    // Chase lags a little behind the vehicle; a view the player is turning follows the hand.
    const rate = this.mode === 'orbit' || turning ? 18 : 5;
    if (this.settled) this.camera.position.lerp(this.wanted, 1 - Math.exp(-dt * rate));
    else this.camera.position.copy(this.wanted);
    this.settled = true;
    // Straight behind, look a little ahead of the vehicle; from any other side, at it.
    const ahead = this.mode === 'chase' ? 2.5 * Math.max(0, Math.cos(this.yaw)) : 0;
    this.camera.lookAt(pivot.addScaledVector(this.forward, ahead));
  }

  private look(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch += pitch;
    this.lookedAt = performance.now();
  }
}
