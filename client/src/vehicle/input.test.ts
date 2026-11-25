import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_TAP_MS, DriveInput, type TouchDrive } from './input';
import { PadControls } from './gamepad';

function fakeTouch(): TouchDrive & { pressAt(ms: number): void } {
  const presses: number[] = [];
  return {
    shown: true, steer: null, throttle: 0, brake: 0, handbrake: false,
    takeHandbrakePresses: () => presses.splice(0),
    pressAt: (ms) => void presses.push(ms),
  };
}

describe('driving from the touch controls', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => undefined });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal('navigator', { getGamepads: () => [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('takes the stick and the pedals, felt rather than on or off', () => {
    const touch = fakeTouch();
    const input = new DriveInput(new PadControls(), touch);
    Object.assign(touch, { steer: 0.4, throttle: 0.6 });
    const c = input.read(1 / 60);
    expect(c.steer).toBeCloseTo(0.4);
    expect(c.throttle).toBeCloseTo(0.6);
    expect(c.digital).toBe(false);
  });

  it('ignores them while they are hidden', () => {
    const touch = fakeTouch();
    const input = new DriveInput(new PadControls(), touch);
    Object.assign(touch, { shown: false, steer: 1, throttle: 1, handbrake: true });
    const c = input.read(1 / 60);
    expect(c.steer).toBe(0);
    expect(c.throttle).toBe(0);
    expect(c.handbrake).toBe(false);
  });

  it('parks on a double tap of the handbrake when stopped, and a pedal lets go', () => {
    const touch = fakeTouch();
    const input = new DriveInput(new PadControls(), touch);
    touch.pressAt(1000);
    touch.pressAt(1000 + DOUBLE_TAP_MS / 2);
    expect(input.read(1 / 60, 0).handbrake).toBe(true);
    expect(input.park.parked).toBe(true);
    touch.throttle = 0.5;
    input.read(1 / 60, 0);
    expect(input.park.parked).toBe(false);
  });
});
