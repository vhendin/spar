import type { PadControls } from './gamepad';
import type { VehicleInput } from './sim';
import type { WinchControls } from './winch';
import type { DroneControls } from './drone';

/** What the touch controls give the driving (client/src/touch/touchControls.ts). */
export interface TouchDrive {
  /** On screen now. */
  shown: boolean;
  /** −1..1 (left positive) while a thumb is on the stick, else null. */
  steer: number | null;
  throttle: number;
  brake: number;
  handbrake: boolean;
  /** The stick up (+) and down (−), −1..1, 0 with no thumb on it: the drone flies forward with it. */
  lift: number;
  /** Handbrake presses since the last call, as event times (ms). */
  takeHandbrakePresses(): number[];
  /** Whether a hold button is down: winding the winch in or out. */
  held(action: 'winchIn' | 'winchOut'): boolean;
}

const held = (down: Set<string>, ...codes: string[]): boolean => codes.some((c) => down.has(c));

/** Two handbrake presses within this many milliseconds put the vehicle in park. */
export const DOUBLE_TAP_MS = 350;
/** Park takes only below this speed, m/s; faster, a double tap is just two pulls of the handbrake. */
export const PARK_BELOW = 3;

/**
 * The parking latch: a double tap of the handbrake sets it, and it holds the handbrake on until
 * the next tap or a pedal (driving away lets it go, as an electric parking brake does).
 */
export class ParkLatch {
  parked = false;
  private last = -Infinity;

  /** A press of the handbrake, at `now` milliseconds, at `speed` m/s. */
  tap(now: number, speed: number): void {
    if (this.parked) {
      this.parked = false;
      this.last = -Infinity;
      return;
    }
    if (now - this.last < DOUBLE_TAP_MS && Math.abs(speed) < PARK_BELOW) {
      this.parked = true;
      this.last = -Infinity;
    } else this.last = now;
  }

  /** The pedals this frame: either one pressed lets the latch go. */
  pedals(throttle: number, brake: number): void {
    if (throttle > 0.1 || brake > 0.1) this.parked = false;
  }
}

/** Reads the driver's controls from the keyboard and, when one is plugged in, a gamepad, and from
 * the touch controls when they show. */
export class DriveInput {
  private readonly down = new Set<string>();
  private steer = 0;
  readonly park = new ParkLatch();
  /** Handbrake key presses since the last read (a quick tap can start and end between frames). */
  private taps: number[] = [];
  private padHeld = false;

  constructor(
    private readonly gamepad: PadControls,
    private readonly touch: TouchDrive | null = null,
  ) {
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.taps.push(e.timeStamp);
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /**
   * `dt` in seconds since the last read; keys ramp the steering instead of slamming it. `speed`,
   * m/s, decides whether a double tap of the handbrake parks.
   */
  read(dt: number, speed = 0): VehicleInput {
    const keys = this.down;
    let throttle = held(keys, 'KeyW', 'ArrowUp') ? 1 : 0;
    let brake = held(keys, 'KeyS', 'ArrowDown') ? 1 : 0;
    let digital = true;
    let handbrake = keys.has('Space');
    const wanted = (held(keys, 'KeyA', 'ArrowLeft') ? 1 : 0) - (held(keys, 'KeyD', 'ArrowRight') ? 1 : 0);
    const rate = (wanted === 0 ? 5 : 3) * dt;
    this.steer += Math.max(-rate, Math.min(rate, wanted - this.steer));
    let steer = this.steer;

    const g = this.gamepad;
    if (g.pad) {
      const stick = g.pad.axes[0] ?? 0;
      if (Math.abs(stick) > 0.08) steer = -Math.sign(stick) * ((Math.abs(stick) - 0.08) / 0.92) ** 1.5;
      // The triggers are pedals the driver feathers; keys are only on or off.
      const pad = Math.max(g.value('throttle'), g.value('brake'));
      if (pad > 0.05) digital = false;
      throttle = Math.max(throttle, g.value('throttle'));
      brake = Math.max(brake, g.value('brake'));
      const pulled = g.held('handbrake');
      if (pulled && !this.padHeld) this.taps.push(performance.now());
      this.padHeld = pulled;
      handbrake ||= pulled;
    }
    const tc = this.touch;
    if (tc?.shown) {
      if (tc.steer !== null) steer = tc.steer;
      // The pedals are pressed harder higher up: felt, like the triggers.
      if (tc.throttle > 0 || tc.brake > 0) digital = false;
      throttle = Math.max(throttle, tc.throttle);
      brake = Math.max(brake, tc.brake);
      this.taps.push(...tc.takeHandbrakePresses());
      handbrake ||= tc.handbrake;
    }
    for (const t of this.taps) this.park.tap(t, speed);
    this.taps = [];
    this.park.pedals(throttle, brake);
    return { throttle, brake, steer, handbrake: handbrake || this.park.parked, digital };
  }

  /**
   * The drone's controls: the driving keys fly it (W and S forward and back, A and D turn),
   * Space climbs and Shift sinks. On the pad the triggers go forward and back and the left
   * stick turns and climbs.
   */
  drone(): DroneControls {
    const keys = this.down;
    let forward = (held(keys, 'KeyW', 'ArrowUp') ? 1 : 0) - (held(keys, 'KeyS', 'ArrowDown') ? 1 : 0);
    // A and D slide sideways (the mouse turns it); the arrows still turn.
    let strafe = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
    let turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    let climb = (keys.has('Space') ? 1 : 0) - (held(keys, 'ShiftLeft', 'ShiftRight') ? 1 : 0);
    const g = this.gamepad;
    if (g.pad) {
      const dead = (x: number): number => (Math.abs(x) < 0.12 ? 0 : Math.sign(x) * ((Math.abs(x) - 0.12) / 0.88));
      forward += g.value('throttle') - g.value('brake');
      // Left stick slides and climbs, right stick looks (turns and tilts), as the mouse does.
      strafe -= dead(g.pad.axes[0] ?? 0);
      climb -= dead(g.pad.axes[1] ?? 0);
      turn -= dead(g.pad.axes[2] ?? 0);
    }
    // On a touch screen the stick flies it forward, back and sideways, the pedals are Up and
    // Down, and a swipe on the picture turns (main.ts).
    const tc = this.touch;
    if (tc?.shown) {
      forward += tc.lift;
      strafe += tc.steer ?? 0;
      climb += tc.throttle - tc.brake;
    }
    const unit = (x: number): number => Math.max(-1, Math.min(1, x));
    return { forward: unit(forward), turn: unit(turn), strafe: unit(strafe), climb: unit(climb) };
  }

  /** The gamepad's right stick up and down, −1..1 (up negative), for tilting the drone's camera. */
  tilt(): number {
    const y = this.gamepad.pad?.axes[3] ?? 0;
    return Math.abs(y) < 0.12 ? 0 : y;
  }

  /** The winch's hold-down controls: I winds in, K pays out (or the touch buttons In and Out). */
  winch(): WinchControls {
    const g = this.gamepad;
    const tc = this.touch?.shown ? this.touch : null;
    return {
      pull: this.down.has('KeyI') || (g.pad !== null && g.held('winchIn')) || !!tc?.held('winchIn'),
      slack: this.down.has('KeyK') || (g.pad !== null && g.held('winchOut')) || !!tc?.held('winchOut'),
    };
  }
}
