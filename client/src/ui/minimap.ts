// The minimap in the corner: the map around the vehicle, turned so ahead is up. N steps
// through near, far and hidden; the choice is remembered on this computer.

import type { MapScreen, MapState } from './map';

/** Metres across at each zoom; 0 hides it. */
const RANGES = [400, 1200, 0];
const KEY = 'spar.minimap';
/** Redrawn this often, seconds: smooth enough, and cheap. */
const EVERY = 1 / 30;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private zoom = 0;
  private since = Infinity;

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

  update(dt: number, map: MapScreen, state: MapState, show: boolean): void {
    const range = RANGES[this.zoom]!;
    const visible = show && range > 0;
    this.canvas.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    this.since += dt;
    if (this.since < EVERY) return;
    this.since = 0;
    const css = this.canvas.clientWidth || 190;
    const size = Math.round(css * Math.min(2, window.devicePixelRatio));
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size;
    this.ctx.setTransform(size / css, 0, 0, size / css, 0, 0);
    map.drawMini(this.ctx, css, state, range);
  }
}
