// Which copy of a plant is drawn where, and which copies must hold it.
//
// Every plant can sit in up to three copies: the full mesh, the simplified mesh and the flat
// far picture. The shader picks the copy to draw per plant and per frame from the distance
// to the camera (materials.ts). The CPU only refills the mesh copies now and then, so each
// refill must take in every plant that could come into a copy's range before the next
// one. Otherwise a plant goes missing: the copy that would draw it does not hold it, and
// the copies that do hold it have handed it over. That is how trees went invisible while
// their colliders stayed.

/** The mesh copies are refilled once the camera has moved this far, in metres, sideways. */
export const REFILL_MOVE = 12;

/** Each plant switches copy at its own share of the nominal distance: 0.9 to 1.1. */
export const JITTER_MIN = 0.9;
export const JITTER_SPAN = 0.2;
/** A last copy shrinks plants away between these shares of its distance. */
export const FADE_START = 0.7;
export const FADE_END = 0.9;

export type Copy = 'full' | 'low' | 'impostor';

export interface Ranges {
  full: number;
  low?: number;
  impostor?: number;
}

export function jitter(rand: number): number {
  return JITTER_MIN + rand * JITTER_SPAN;
}

/** The farthest any plant can be drawn by a mesh copy, measured from the camera. */
export function copyReach(ranges: Ranges, copy: 'full' | 'low'): number {
  const far = copy === 'full' ? ranges.full : ranges.low!;
  const last = copy === 'full' ? ranges.low === undefined : ranges.impostor === undefined;
  return last ? FADE_END * far : (JITTER_MIN + JITTER_SPAN) * far;
}

/**
 * Whether a refill must put a group of plants, `distance` metres sideways from the camera
 * at its nearest, in a mesh copy. The camera can come REFILL_MOVE closer before the next
 * refill. The shader measures in 3D, which is never shorter than sideways.
 */
export function needsCopy(distance: number, ranges: Ranges, copy: 'full' | 'low'): boolean {
  if (copy === 'low' && ranges.low === undefined) return false;
  return distance <= copyReach(ranges, copy) + REFILL_MOVE;
}

/** The copy the shader draws a plant with at `distance` metres (3D), or null if none. */
export function shownBy(distance: number, rand: number, ranges: Ranges): Copy | null {
  const j = jitter(rand);
  if (distance < j * ranges.full) return ranges.low === undefined && distance >= FADE_END * ranges.full ? null : 'full';
  if (ranges.low !== undefined && distance < j * ranges.low) return ranges.impostor === undefined && distance >= FADE_END * ranges.low ? null : 'low';
  if (ranges.impostor !== undefined && distance < ranges.impostor) return 'impostor';
  return null;
}
