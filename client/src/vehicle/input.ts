import type { PadControls } from './gamepad';
import type { VehicleInput } from './sim';
import type { WinchControls } from './winch';

const held = (down: Set<string>, ...codes: string[]): boolean => codes.some((c) => down.has(c));

/** Reads the driver's controls from the keyboard and, when one is plugged in, a gamepad. */
export class DriveInput {
  private readonly down = new Set<string>();
  private steer = 0;

  constructor(private readonly gamepad: PadControls) {
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** `dt` in seconds since the last read; keys ramp the steering instead of slamming it. */
  read(dt: number): VehicleInput {
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
      handbrake ||= g.held('handbrake');
    }
    return { throttle, brake, steer, handbrake, digital };
  }

  /** The winch's hold-down controls: I winds in, K pays out. */
  winch(): WinchControls {
    const g = this.gamepad;
    return {
      pull: this.down.has('KeyI') || (g.pad !== null && g.held('winchIn')),
      slack: this.down.has('KeyK') || (g.pad !== null && g.held('winchOut')),
    };
  }
}
