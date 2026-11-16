import type { VehicleInput } from './sim';

const held = (down: Set<string>, ...codes: string[]): boolean => codes.some((c) => down.has(c));

/** Reads the driver's controls from the keyboard and, when one is plugged in, a gamepad. */
export class DriveInput {
  private readonly down = new Set<string>();
  private steer = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** `dt` in seconds since the last read; keys ramp the steering instead of slamming it. */
  read(dt: number): VehicleInput {
    const keys = this.down;
    let throttle = held(keys, 'KeyW', 'ArrowUp') ? 1 : 0;
    let brake = held(keys, 'KeyS', 'ArrowDown') ? 1 : 0;
    let handbrake = keys.has('Space');
    const wanted = (held(keys, 'KeyA', 'ArrowLeft') ? 1 : 0) - (held(keys, 'KeyD', 'ArrowRight') ? 1 : 0);
    const rate = (wanted === 0 ? 5 : 3) * dt;
    this.steer += Math.max(-rate, Math.min(rate, wanted - this.steer));
    let steer = this.steer;

    const pad = navigator.getGamepads?.().find((p) => p?.connected && p.mapping === 'standard');
    if (pad) {
      const stick = pad.axes[0] ?? 0;
      if (Math.abs(stick) > 0.08) steer = -Math.sign(stick) * ((Math.abs(stick) - 0.08) / 0.92) ** 1.5;
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      handbrake ||= pad.buttons[0]?.pressed ?? false;
    }
    return { throttle, brake, steer, handbrake };
  }
}
