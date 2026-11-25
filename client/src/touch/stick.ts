// The arithmetic of the touch controls, kept apart from the page so it can be tested.

/** How far the thumb stick's knob goes from its middle, CSS pixels. */
export const STICK_RADIUS = 56;
/** The middle of the stick that does nothing, as a part of the radius. */
export const STICK_DEAD = 0.08;

/**
 * One axis of the thumb stick: the thumb's offset from where it landed, pixels, as −1..1. A
 * dead zone in the middle, then the same curve as the gamepad's stick (gentle near the middle
 * for small corrections, full at the edge).
 */
export function stickAxis(px: number, radius = STICK_RADIUS, dead = STICK_DEAD, curve = 1.5): number {
  const a = Math.min(1, Math.abs(px) / radius);
  if (a <= dead) return 0;
  return Math.sign(px) * ((a - dead) / (1 - dead)) ** curve;
}

/** Where the knob is drawn: the thumb's offset, held within the stick's ring. */
export function knob(dx: number, dy: number, radius = STICK_RADIUS): [number, number] {
  const d = Math.hypot(dx, dy);
  return d <= radius ? [dx, dy] : [(dx / d) * radius, (dy / d) * radius];
}

/** Lightest press of a pedal: a finger at its foot. */
export const PEDAL_MIN = 0.3;

/**
 * A pedal pressed by a finger `fromBottom` pixels up a pedal `height` pixels tall: the higher
 * the finger, the more pedal, full from about three quarters of the way up.
 */
export function pedalValue(fromBottom: number, height: number): number {
  const f = height > 0 ? Math.max(0, Math.min(1, fromBottom / height)) : 1;
  return Math.min(1, PEDAL_MIN + f * 0.95);
}
