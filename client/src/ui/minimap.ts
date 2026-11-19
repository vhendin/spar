// The minimap in the corner: the map around the vehicle, turned so ahead is up. N steps
// through near, far and hidden; the choice is remembered on this computer. Held open (Tab),
// it grows to a large map at the same scale, so it shows more around the vehicle rather
// than the same in bigger print; hidden, it opens at the near scale.

import type { MapScreen, MapState } from './map';

/** Metres across at each zoom; 0 hides it. */
const RANGES = [400, 1200, 0];
const KEY = 'spar.minimap';
/** Redrawn this often, seconds: smooth enough, and cheap. */
const EVERY = 1 / 30;
/** Width in the corner, CSS pixels (or 30 % of the window, if less; see #minimap). */
const SMALL = 190;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private zoom = 0;
  private since = Infinity;
  private big = false;
  /** The size it was last drawn at. */
  private drawn = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;
    parent.append(this.canvas);
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (Number.isInteger(saved) && saved >= 0 && saved < RANGES.length) this.zoom = saved;
    } catch {
      // Starts near.
    }
  }

  /** Near, far, hidden. */
  cycle(): void {
    this.zoom = (this.zoom + 1) % RANGES.length;
    this.since = Infinity;
    try {
      localStorage.setItem(KEY, String(this.zoom));
    } catch {
      // Not remembered.
    }
  }

  /** Large while held. */
  expand(on: boolean): void {
    if (on === this.big) return;
    this.big = on;
    this.canvas.classList.toggle('big', on);
    this.since = Infinity;
  }

  update(dt: number, map: MapScreen, state: MapState, show: boolean): void {
    const chosen = RANGES[this.zoom]!;
    const visible = show && (chosen > 0 || this.big);
    this.canvas.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const css = this.canvas.clientWidth || SMALL;
    const resized = Math.abs(css - this.drawn) > 0.5;
    this.since += dt;
    if (this.since < EVERY && !resized) return;
    this.since = 0;
    this.drawn = css;
    // Metres per pixel as in the corner, whatever the size it has grown to.
    const small = Math.min(SMALL, window.innerWidth * 0.3);
    const range = (chosen || RANGES[0]!) * (css / small);
    const size = Math.round(css * Math.min(2, window.devicePixelRatio));
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size;
    this.ctx.setTransform(size / css, 0, 0, size / css, 0, 0);
    map.drawMini(this.ctx, css, state, range);
  }
}
