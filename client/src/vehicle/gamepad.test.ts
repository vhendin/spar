import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PadControls } from './gamepad';

/** A standard pad with 17 buttons, `down` pressed (with `values` for triggers). */
function fakePad(down: number[], values: Record<number, number> = {}): void {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: values[i] ?? (down.includes(i) ? 1 : 0) }));
  vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, mapping: 'standard', id: 'Test pad', axes: [0, 0, 0, 0], buttons }] });
}

describe('gamepad controls', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports a press as tapped once, and held while down', () => {
    const pad = new PadControls();
    fakePad([3]);
    pad.poll();
    expect(pad.tapped('right')).toBe(true);
    expect(pad.held('right')).toBe(true);
    pad.poll();
    expect(pad.tapped('right')).toBe(false);
    expect(pad.held('right')).toBe(true);
  });

  it('reads triggers as values', () => {
    const pad = new PadControls();
    fakePad([], { 7: 0.4 });
    pad.poll();
    expect(pad.value('throttle')).toBeCloseTo(0.4);
  });

  it('binds the next button pressed, without the game seeing it, and swaps a clash', () => {
    const pad = new PadControls();
    fakePad([]);
    pad.poll();
    let bound = -1;
    pad.listen((b) => {
      bound = b;
      pad.bind('camera', b);
    });
    fakePad([0]);
    pad.poll();
    expect(bound).toBe(0);
    expect(pad.tapped('handbrake')).toBe(false);
    // A was the handbrake; the handbrake now has X, the camera's old button.
    expect(pad.bindings.camera).toBe(0);
    expect(pad.bindings.handbrake).toBe(2);
    pad.reset();
    expect(pad.bindings.camera).toBe(2);
  });
});
