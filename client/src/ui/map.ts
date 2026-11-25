// The map (M): the whole region from above, drawn from the same heights, masks and OpenStreetMap
// lines the world is built from. It shows where the vehicle is and where it has been, and
// is where a destination is chosen: click anywhere, or pick a place, a summit or a start
// point from the list. Start points can also be jumped to.
//
// It fills in as the region is seen (`seen.ts`): ground not yet seen is pale, and the lines and
// places on it are left out, unless the whole map is asked for.

import type { RegionIndex, RegionVectors } from '@spar/shared';
import { fetchBytes, fetchUint16, heightFileUrl, maskFileUrl } from '../terrain/region';
import { paintGround, summits, type MapRasters, type Summit } from './mapImage';
import { SeenGrid } from './seen';
import { headingAt, type StartStore } from './starts';
import { builder, closeButton, coarsePointer } from './dom';

export interface Destination {
  name: string;
  x: number;
  z: number;
  /** For a destination from the map data: peak, hut, shelter, viewpoint, lodge, camp, sight or lift. */
  kind?: string;
}

/** The pins: the driver's own destination, and the shared one (as its guide's blue). */
const PIN = { own: { fill: '#8e3b2d', line: 'rgba(142,59,45,0.85)' }, shared: { fill: '#2c6fb0', line: 'rgba(44,111,176,0.85)' } };

/** Colours of the destination markers by kind. */
const DESTINATION_COLORS: Record<string, string> = {
  peak: '#5a3c26', hut: '#b0472c', shelter: '#8a5a2b', viewpoint: '#2c6fb0', lodge: '#7a3d8f', camp: '#2f6f4f', sight: '#c28a12', lift: '#3a3f47',
};
/** Kinds of destination always on the map, seen or not: the huts and lodges people walk to. */
const LANDMARKS = new Set(['hut', 'lodge']);
/** The pale over ground not yet seen: birch, most of the way. */
const FOG = { r: 236, g: 235, b: 230, a: 190 };

const DESTINATION_GROUPS: [string, string[]][] = [
  ['Summits', ['peak']],
  ['Huts, lodges and camp sites', ['hut', 'lodge', 'camp']],
  ['Viewpoints and sights', ['viewpoint', 'sight']],
  ['Shelters', ['shelter']],
  ['Lift tops', ['lift']],
];

type Spawn = RegionVectors['spawns'][number];

export interface MapActions {
  setDestination(d: Destination | null): void;
  /** Names of the places already reached here, from the logbook. */
  reached(): Set<string>;
  /**
   * Sharing the destination with the other drivers in the region; left out when playing alone.
   * `shared` is what is shared now, with who shared it (null for this driver).
   */
  sharing?: {
    /** Whether anyone else is on the server to share with. */
    available(): boolean;
    shared(): { destination: Destination; by: string | null } | null;
    share(d: Destination | null): void;
  };
  /** Puts the vehicle down at a start point. */
  travel(spawn: Pick<Spawn, 'name' | 'x' | 'z' | 'heading'>): void;
  close(): void;
}

export interface MapState {
  /** The vehicle, or the camera when flying: position and heading in degrees (0 north, 90 east). */
  x: number;
  z: number;
  heading: number;
  destination: Destination | null;
  /** The destination shared with everyone in the region, drawn in blue. */
  shared?: Destination | null;
  /** Other drivers' vehicles in this region. */
  others?: OtherMarker[];
}

/** Another driver's vehicle on the map. */
export interface OtherMarker {
  x: number;
  z: number;
  heading: number;
  name: string;
  color: string;
}

/** A vehicle's arrow, pointing up, centred on the origin; `size` 1 is the map's own arrow. */
function arrow(c: CanvasRenderingContext2D, fill: string, size = 1): void {
  c.fillStyle = fill;
  c.strokeStyle = '#2f3b33';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, -11 * size);
  c.lineTo(7 * size, 8 * size);
  c.lineTo(0, 4 * size);
  c.lineTo(-7 * size, 8 * size);
  c.closePath();
  c.fill();
  c.stroke();
}

/** Most pixels per metre when zoomed right in. */
const MAX_ZOOM = 3;
/** Metres the vehicle must move before the trail gets another point. */
const TRAIL_STEP = 15;
const TRAIL_MAX = 6000;

/** min x, min z, max x, max z. */
type Box = [number, number, number, number];

interface MapPick {
  name: string;
  x: number;
  z: number;
  kind: 'place' | 'summit' | 'spawn' | 'destination';
  /** For a destination: what kind of place. */
  sort?: string;
}

export class MapScreen {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly side: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private rasters: MapRasters | null = null;
  private image: HTMLCanvasElement | null = null;
  private tops: Summit[] = [];
  private loading: Promise<void> | null = null;
  private readonly trail: number[] = [];
  /** View: the point in the middle, and pixels per metre. 0 until first opened. */
  private cx = 0;
  private cz = 0;
  private scale = 0;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private hover: { x: number; z: number } | null = null;
  private state: MapState = { x: 0, z: 0, heading: 0, destination: null };
  private sideAt = 0;
  /** Waiting for a click on the map to place a new start point. */
  private placing = false;
  /** What the driver has seen of the region; only that is drawn, unless `whole`. */
  readonly seen: SeenGrid;
  /** Draws the whole region, seen or not (the Map setting). */
  whole = false;
  /** One pixel per seen cell: opaque where seen (to cut the lines to), and the pale where not. */
  private seenMask: HTMLCanvasElement | null = null;
  private fog: HTMLCanvasElement | null = null;
  private maskPixels: ImageData | null = null;
  private fogPixels: ImageData | null = null;
  /** Scratch canvases the lines are drawn into before being cut to what is seen. */
  private readonly layers = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

  constructor(
    parent: HTMLElement,
    private readonly index: RegionIndex,
    private readonly vectors: RegionVectors,
    private readonly actions: MapActions,
    private readonly starts: StartStore,
  ) {
    this.seen = new SeenGrid(index.size);
    this.root = document.createElement('div');
    this.root.id = 'map';
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.side = document.createElement('div');
    this.side.className = 'side';
    this.readout = document.createElement('div');
    this.readout.className = 'readout';
    this.root.append(this.canvas, this.readout, this.side);
    parent.append(this.root);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });
    // One finger (or the mouse) drags, a tap or click without moving picks a spot; two fingers
    // pinch to zoom round the point between them.
    const fingers = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const pair = (): { x: number; y: number; d: number } | null => {
      const [a, b] = [...fingers.values()];
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) } : null;
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      fingers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (fingers.size === 1) this.drag = { x: e.offsetX, y: e.offsetY, cx: this.cx, cz: this.cz, moved: false };
      else {
        // A pinch is not a tap, and the drag starts again when one finger is left.
        this.drag = null;
        spread = pair()?.d ?? 0;
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const finger = fingers.get(e.pointerId);
      if (finger) {
        finger.x = e.offsetX;
        finger.y = e.offsetY;
      }
      if (fingers.size >= 2) {
        const p = pair();
        if (p && spread > 0 && p.d > 0) this.zoomAt(p.x, p.y, p.d / spread);
        spread = p?.d ?? 0;
        return;
      }
      const [x, z] = this.toWorld(e.offsetX, e.offsetY);
      if (e.pointerType === 'mouse') this.hover = { x, z };
      const d = this.drag;
      if (!d) return;
      if (Math.hypot(e.offsetX - d.x, e.offsetY - d.y) > (e.pointerType === 'touch' ? 10 : 4)) d.moved = true;
      if (d.moved) {
        this.cx = d.cx - (e.offsetX - d.x) / this.scale;
        this.cz = d.cz - (e.offsetY - d.y) / this.scale;
      }
    });
    this.canvas.addEventListener('pointerleave', () => (this.hover = null));
    const up = (e: PointerEvent): void => {
      const was = fingers.size;
      fingers.delete(e.pointerId);
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && was === 1 && e.type === 'pointerup') this.click(e.offsetX, e.offsetY);
      // The finger left after a pinch drags on from where it is.
      const [rest] = [...fingers.values()];
      if (rest && fingers.size === 1) this.drag = { x: rest.x, y: rest.y, cx: this.cx, cz: this.cz, moved: true };
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** Zooms by `factor`, keeping the point under (px, py) where it is. */
  private zoomAt(px: number, py: number, factor: number): void {
    const [x, z] = this.toWorld(px, py);
    this.scale = Math.min(MAX_ZOOM, Math.max(this.fit() * 0.8, this.scale * factor));
    const [x2, z2] = this.toWorld(px, py);
    this.cx += x - x2;
    this.cz += z - z2;
  }

  get open(): boolean {
    return this.root.style.display === 'block';
  }

  toggle(state: MapState): void {
    if (this.open) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = 'block';
    this.state = state;
    // The whole region at first; zoomed in, the view follows the vehicle.
    if (this.scale === 0) this.scale = this.fit();
    if (this.scale <= this.fit() * 1.05) this.cx = this.cz = this.index.size / 2;
    else this.centre();
    void this.load();
    this.renderSide();
  }

  /** Draws the side panel again, as when the shared destination changed. */
  refresh(): void {
    if (this.open) this.renderSide();
  }

  /** Height of the ground anywhere in the region, once the map has loaded; else null. */
  heightAt(x: number, z: number): number | null {
    const r = this.rasters;
    if (!r) return null;
    const i = Math.round(x / r.spacing), j = Math.round(z / r.spacing);
    if (i < 0 || j < 0 || i >= r.n || j >= r.n) return null;
    return r.heights[j * r.n + i]!;
  }

  /** Whether the map shows what is at a point: it has been seen, or the whole map is shown. */
  shows(x: number, z: number): boolean {
    return this.whole || this.seen.has(x, z);
  }

  private showsDestination(p: { x: number; z: number; kind: string }): boolean {
    return LANDMARKS.has(p.kind) || this.shows(p.x, p.z);
  }

  /**
   * Looks round from an eye at height `eye` over (x, z), `range` metres out (rays `from` up to
   * `to`, for a look done in parts), and marks what is in sight as seen. Returns the cells
   * newly seen; 0 until the map's rasters have loaded.
   */
  look(x: number, z: number, eye: number, range: number, from?: number, to?: number): number {
    return this.rasters ? this.seen.look(this.rasters, x, z, eye, range, from, to) : 0;
  }

  /** Whether the heights for looking round have loaded. */
  get ready(): boolean {
    return this.rasters !== null;
  }

  /** Brings the pictures of what is seen up to date with the grid. */
  private syncSeen(): void {
    const g = this.seen;
    let rect = g.takeChanged();
    if (!this.seenMask || !this.fog) {
      const make = (): HTMLCanvasElement => {
        const c = document.createElement('canvas');
        c.width = c.height = g.n;
        return c;
      };
      this.seenMask = make();
      this.fog = make();
      this.maskPixels = new ImageData(g.n, g.n);
      this.fogPixels = new ImageData(g.n, g.n);
      rect = [0, 0, g.n - 1, g.n - 1];
    }
    if (!rect) return;
    const mask = this.maskPixels!.data, fog = this.fogPixels!.data;
    for (let j = rect[1]; j <= rect[3]; j++) {
      for (let i = rect[0]; i <= rect[2]; i++) {
        const k = j * g.n + i, o = k * 4;
        const on = g.cells[k] === 1;
        mask[o] = mask[o + 1] = mask[o + 2] = 255;
        mask[o + 3] = on ? 255 : 0;
        fog[o] = FOG.r;
        fog[o + 1] = FOG.g;
        fog[o + 2] = FOG.b;
        fog[o + 3] = on ? 0 : FOG.a;
      }
    }
    const w = rect[2] - rect[0] + 1, h = rect[3] - rect[1] + 1;
    this.seenMask.getContext('2d')!.putImageData(this.maskPixels!, 0, 0, rect[0], rect[1], w, h);
    this.fog.getContext('2d')!.putImageData(this.fogPixels!, 0, 0, rect[0], rect[1], w, h);
  }

  /** The pale over what is not yet seen, drawn in world units under `c`'s transform. */
  private drawFog(c: CanvasRenderingContext2D): void {
    if (this.whole || !this.fog) return;
    const span = this.seen.n * this.seen.cell;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.fog, 0, 0, span, span);
  }

  /**
   * Draws lines into `c` cut to what has been seen, with soft edges: `draw` paints into a
   * scratch canvas under `c`'s transform, the seen cells (placed in world units by `world`)
   * cut it, and the rest goes onto `c`.
   */
  private masked(c: CanvasRenderingContext2D, world: DOMMatrix, draw: (c: CanvasRenderingContext2D) => void): void {
    const mask = this.seenMask;
    if (this.whole || !mask) {
      draw(c);
      return;
    }
    const target = c.canvas as HTMLCanvasElement;
    let l = this.layers.get(target);
    if (!l) {
      l = document.createElement('canvas').getContext('2d')!;
      this.layers.set(target, l);
    }
    if (l.canvas.width !== target.width || l.canvas.height !== target.height) {
      l.canvas.width = target.width;
      l.canvas.height = target.height;
    }
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, l.canvas.width, l.canvas.height);
    l.setTransform(c.getTransform());
    l.lineCap = l.lineJoin = 'round';
    draw(l);
    l.setLineDash([]);
    l.setTransform(world);
    l.globalCompositeOperation = 'destination-in';
    l.imageSmoothingEnabled = true;
    const span = this.seen.n * this.seen.cell;
    l.drawImage(mask, 0, 0, span, span);
    l.globalCompositeOperation = 'source-over';
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(l.canvas, 0, 0);
    c.restore();
  }

  /** Call every frame with where the vehicle is, so the trail follows it. */
  record(x: number, z: number): void {
    const t = this.trail;
    const n = t.length;
    if (n >= 2 && Math.hypot(x - t[n - 2]!, z - t[n - 1]!) < TRAIL_STEP) return;
    // A jump (back to the start, a new start point) breaks the line.
    if (n >= 2 && Math.hypot(x - t[n - 2]!, z - t[n - 1]!) > 200) t.push(NaN, NaN);
    t.push(x, z);
    if (t.length > TRAIL_MAX * 2) t.splice(0, t.length - TRAIL_MAX * 2);
  }

  /** Call every frame while open. */
  update(state: MapState, now: number): void {
    this.state = state;
    if (!this.open) return;
    const dpr = Math.min(2, window.devicePixelRatio);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(w, h);
    if (now - this.sideAt > 500) {
      this.sideAt = now;
      this.updateDistance();
    }
    const hv = this.hover;
    const ground = hv ? this.heightAt(hv.x, hv.z) : null;
    this.readout.textContent = hv && ground !== null
      ? `${ground.toFixed(0)} m · E ${(this.index.origin.easting + hv.x).toFixed(0)} N ${(this.index.origin.northing - hv.z).toFixed(0)}`
      : '';
  }

  /** The map's picture of the ground, once drawn: one pixel per height sample. */
  get picture(): HTMLCanvasElement | null {
    return this.image;
  }

  /** Starts drawing the map's picture of the ground, for the minimap and the map. */
  prepare(): void {
    void this.load();
  }

  /**
   * The minimap: a round window `range` metres across around `state`, turned so the way the
   * vehicle faces is up. Drawn into `c`, `size` pixels across.
   */
  drawMini(c: CanvasRenderingContext2D, size: number, state: MapState, range: number): void {
    const s = size / range;
    const half = size / 2;
    const reach = (range / 2) * 1.5;
    const turn = (-state.heading * Math.PI) / 180;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    /** World to minimap pixels. */
    const at = (x: number, z: number): [number, number] => {
      const dx = (x - state.x) * s, dz = (z - state.z) * s;
      return [half + dx * cos - dz * sin, half + dx * sin + dz * cos];
    };
    const near = (b: Box): boolean => b[0] < state.x + reach && b[2] > state.x - reach && b[1] < state.z + reach && b[3] > state.z - reach;

    c.save();
    c.clearRect(0, 0, size, size);
    c.beginPath();
    c.arc(half, half, half - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#e9e6da';
    c.fillRect(0, 0, size, size);
    // The ground picture and the lines, in world units under one transform.
    c.save();
    c.translate(half, half);
    c.rotate(turn);
    c.scale(s, s);
    c.translate(-state.x, -state.z);
    if (this.image && this.rasters) {
      c.imageSmoothingEnabled = true;
      c.drawImage(this.image, 0, 0, this.index.size + this.rasters.spacing, this.index.size + this.rasters.spacing);
    }
    this.syncSeen();
    this.drawFog(c);
    c.lineCap = c.lineJoin = 'round';
    const boxes = this.boxes();
    this.masked(c, c.getTransform(), (c) => {
      const line = (points: number[][], close = false): void => {
        c.beginPath();
        points.forEach(([x, z], i) => (i === 0 ? c.moveTo(x!, z!) : c.lineTo(x!, z!)));
        if (close) c.closePath();
      };
      c.strokeStyle = '#3f86c2';
      this.vectors.waterways.forEach((w, i) => {
        if (!near(boxes.water[i]!)) return;
        c.lineWidth = w.kind === 'river' ? 10 : 3 / s;
        line(w.points);
        c.stroke();
    });
    c.fillStyle = '#5b4e45';
    this.vectors.buildings.forEach((b, i) => {
      if (!near(boxes.buildings[i]!)) return;
      line(b.outline, true);
      c.fill();
    });
    c.setLineDash([4 / s, 3 / s]);
    c.strokeStyle = '#6b4a33';
    c.lineWidth = 1.2 / s;
    this.vectors.roads.forEach((r, i) => {
      if ((r.drivable && r.kind !== 'track') || !near(boxes.roads[i]!)) return;
      line(r.points);
      c.stroke();
    });
    c.setLineDash([]);
    for (const pass of [0, 1]) {
      this.vectors.roads.forEach((r, i) => {
        if (!r.drivable || !near(boxes.roads[i]!)) return;
        const w = Math.max(r.surface === 'asphalt' ? 4 : 3, (r.width ?? 4) * s) / s;
        c.strokeStyle = pass === 0 ? (r.surface === 'asphalt' ? '#7a3b1e' : '#5d4c3d') : r.surface === 'asphalt' ? '#ee8d3e' : '#fffaf0';
        c.lineWidth = pass === 0 ? w + 2 / s : w;
        line(r.points);
        c.stroke();
      });
    }
    });
    // Where the vehicle has been.
    const t = this.trail;
    if (t.length >= 4) {
      c.strokeStyle = 'rgba(200,40,90,0.75)';
      c.lineWidth = 2.5 / s;
      c.beginPath();
      let pen = false;
      for (let i = 0; i < t.length; i += 2) {
        if (Number.isNaN(t[i]!) || Math.abs(t[i]! - state.x) > reach || Math.abs(t[i + 1]! - state.z) > reach) {
          pen = false;
          continue;
        }
        if (pen) c.lineTo(t[i]!, t[i + 1]!);
        else c.moveTo(t[i]!, t[i + 1]!);
        pen = true;
      }
      c.stroke();
    }
    c.restore();

    // Names stay upright.
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const p of this.vectors.places) {
      if (Math.hypot(p.x - state.x, p.z - state.z) > range / 2 || !this.shows(p.x, p.z)) continue;
      const [px, py] = at(p.x, p.z);
      c.font = '600 11px Inter, system-ui, sans-serif';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.strokeText(p.name, px, py);
      c.fillStyle = '#222';
      c.fillText(p.name, px, py);
    }

    // The destinations: a pin when in view, otherwise an arrow on the rim pointing there.
    for (const [d, pin] of [[state.shared, PIN.shared], [state.destination, PIN.own]] as const) {
      if (!d) continue;
      const [px, py] = at(d.x, d.z);
      const dx = px - half, dy = py - half;
      const out = Math.hypot(dx, dy);
      c.fillStyle = pin.fill;
      c.strokeStyle = '#fff';
      c.lineWidth = 1.5;
      if (out < half - 10) {
        c.beginPath();
        c.arc(px, py - 9, 5, Math.PI * 0.85, Math.PI * 2.15);
        c.lineTo(px, py);
        c.closePath();
        c.fill();
        c.stroke();
      } else {
        c.save();
        c.translate(half + (dx / out) * (half - 10), half + (dy / out) * (half - 10));
        c.rotate(Math.atan2(dy, dx) + Math.PI / 2);
        c.beginPath();
        c.moveTo(0, -7);
        c.lineTo(6, 5);
        c.lineTo(-6, 5);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }
    }

    // The other drivers within the window, turned like the map, with their names.
    for (const o of state.others ?? []) {
      const [ox, oy] = at(o.x, o.z);
      if (Math.hypot(ox - half, oy - half) > half - 8) continue;
      c.save();
      c.translate(ox, oy);
      c.rotate(((o.heading - state.heading) * Math.PI) / 180);
      arrow(c, o.color, 0.7);
      c.restore();
      c.font = '15px "Instrument Serif", Georgia, serif';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.strokeText(o.name, ox, oy - 15);
      c.fillStyle = '#222';
      c.fillText(o.name, ox, oy - 15);
    }

    // The vehicle in the middle, always facing up.
    c.fillStyle = '#c9a44a';
    c.strokeStyle = '#2f3b33';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(half, half - 9);
    c.lineTo(half + 6, half + 7);
    c.lineTo(half, half + 3);
    c.lineTo(half - 6, half + 7);
    c.closePath();
    c.fill();
    c.stroke();

    // North on the rim.
    const nx = half + sin * (half - 11), ny = half - cos * (half - 11);
    c.fillStyle = 'rgba(47,59,51,0.9)';
    c.beginPath();
    c.arc(nx, ny, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ecebe6';
    c.font = '600 10px Inter, system-ui, sans-serif';
    c.fillText('N', nx, ny + 0.5);
    c.restore();

    c.strokeStyle = 'rgba(47,59,51,0.85)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(half, half, half - 1, 0, Math.PI * 2);
    c.stroke();
  }

  private boxCache: { roads: Box[]; buildings: Box[]; water: Box[] } | null = null;

  /** Bounding boxes of the lines, so the minimap skips what is far away. */
  private boxes(): { roads: Box[]; buildings: Box[]; water: Box[] } {
    const box = (points: number[][]): Box => {
      const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, z] of points) {
        b[0] = Math.min(b[0], x!);
        b[1] = Math.min(b[1], z!);
        b[2] = Math.max(b[2], x!);
        b[3] = Math.max(b[3], z!);
      }
      return b;
    };
    this.boxCache ??= {
      roads: this.vectors.roads.map((r) => box(r.points)),
      buildings: this.vectors.buildings.map((b) => box(b.outline)),
      water: this.vectors.waterways.map((w) => box(w.points)),
    };
    return this.boxCache;
  }

  private async load(): Promise<void> {
    this.loading ??= (async () => {
      const r = await loadRasters(this.index);
      this.rasters = r;
      const ids = Object.fromEntries(this.index.masks.biomes.map((b) => [b.name, b.id]));
      const pixels = paintGround(r, ids);
      const image = document.createElement('canvas');
      image.width = image.height = r.n;
      image.getContext('2d')!.putImageData(new ImageData(pixels, r.n, r.n), 0, 0);
      this.image = image;
      // Tops standing out over 500 m around.
      this.tops = summits(r, Math.round(500 / r.spacing), 40).slice(0, 14);
      this.renderSide();
    })().catch((err: unknown) => {
      console.error(err);
      this.loading = null;
    });
    return this.loading;
  }

  private fit(): number {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    return (Math.min(w - 340, h) * 0.94) / this.index.size;
  }

  /** Brings the vehicle into the middle. */
  centre(): void {
    this.cx = this.state.x;
    this.cz = this.state.z;
  }

  private toScreen(x: number, z: number): [number, number] {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    // The side panel covers the right; the middle of the map is the middle of what is left.
    return [(x - this.cx) * this.scale + (w - 320) / 2, (z - this.cz) * this.scale + h / 2];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [(sx - (w - 320) / 2) / this.scale + this.cx, (sy - h / 2) / this.scale + this.cz];
  }

  private picks(): MapPick[] {
    const r = this.rasters;
    return [
      ...(this.vectors.destinations ?? []).filter((p) => this.showsDestination(p)).map((p): MapPick => ({ name: p.name, x: p.x, z: p.z, kind: 'destination', sort: p.kind })),
      ...this.vectors.places.filter((p) => this.shows(p.x, p.z)).map((p): MapPick => ({ name: p.name, x: p.x, z: p.z, kind: 'place' })),
      ...this.tops.map((t): MapPick => ({ name: `Summit ${t.height.toFixed(0)} m`, x: t.x * (r?.spacing ?? 1), z: t.y * (r?.spacing ?? 1), kind: 'summit' })),
      ...this.starts.list.map((s): MapPick => ({ name: s.name, x: s.x, z: s.z, kind: 'spawn' })),
      ...this.vectors.spawns.map((s): MapPick => ({ name: s.name, x: s.x, z: s.z, kind: 'spawn' })),
    ];
  }

  private click(sx: number, sy: number): void {
    if (this.placing) {
      const [x, z] = this.toWorld(sx, sy);
      if (x < 0 || z < 0 || x > this.index.size || z > this.index.size) return;
      if (this.isWater(x, z)) {
        window.alert('That is water. Pick a spot on land.');
        return;
      }
      this.placing = false;
      let n = this.starts.list.length + 1;
      while (this.starts.list.some((s) => s.name === `Start ${n}`)) n++;
      this.starts.list.push({ name: `Start ${n}`, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, heading: headingAt(this.vectors, x, z) });
      void this.saveStarts();
      this.renderSide();
      // Ready to be named.
      const inputs = this.side.querySelectorAll<HTMLInputElement>('input.start-name');
      const last = inputs[inputs.length - 1];
      last?.focus();
      last?.select();
      return;
    }
    const d = this.state.destination;
    if (d) {
      const [dx, dy] = this.toScreen(d.x, d.z);
      if (Math.hypot(dx - sx, dy - sy) < 14) {
        this.choose(null);
        return;
      }
    }
    let best: MapPick | null = null;
    let bestD = 14;
    for (const p of this.picks()) {
      const [px, py] = this.toScreen(p.x, p.z);
      const dist = Math.hypot(px - sx, py - sy);
      if (dist < bestD) {
        best = p;
        bestD = dist;
      }
    }
    const [x, z] = this.toWorld(sx, sy);
    if (x < 0 || z < 0 || x > this.index.size || z > this.index.size) return;
    this.choose(best ? { name: best.name, x: best.x, z: best.z, ...(best.sort ? { kind: best.sort } : {}) } : { name: 'Marked spot', x, z });
  }

  private choose(d: Destination | null): void {
    this.state.destination = d;
    this.actions.setDestination(d);
    this.renderSide();
  }

  private renderSide(): void {
    const box = this.side;
    box.replaceChildren();
    const { add, button } = builder(box);
    closeButton(box, () => this.actions.close());
    add('h2', this.index.title);
    add('div', 'Destination', box, 'label');
    const d = this.state.destination;
    const row = add('div', '', box, 'dest');
    add('span', d ? d.name : 'None. Click the map, or pick one below.', row, d ? 'name' : 'none');
    add('span', '', row, 'distance');
    if (d) button('Clear', () => this.choose(null), row);
    this.updateDistance();
    // Going there together: a destination shared with everyone in the region shows beside
    // each driver's own, in blue. Sharing another replaces it; nobody's own is touched.
    const sharing = this.actions.sharing;
    const shared = sharing?.shared() ?? null;
    const same = (a: Destination, b: Destination): boolean => a.name === b.name && Math.hypot(a.x - b.x, a.z - b.z) < 1;
    if (sharing?.available() && d && !(shared && same(shared.destination, d))) {
      button(shared ? 'Share this instead' : 'Share with everyone', () => sharing.share(d), add('div', '', box, 'shared'), 'link');
    }
    if (sharing && shared) {
      add('div', 'Shared destination', box, 'label');
      const row = add('div', '', box, 'dest shared-dest');
      add('span', shared.destination.name, row, 'name');
      add('span', shared.by ? `by ${shared.by}` : 'by you', row, 'note');
      button('Stop sharing', () => sharing.share(null), row, 'link');
    }

    // Places from the map data worth a trip, ticked off once reached.
    const reached = this.actions.reached();
    const all = this.vectors.destinations ?? [];
    if (all.length) {
      const found = this.whole ? '' : ` · ${all.filter((p) => this.showsDestination(p)).length} found`;
      add('div', `Trips · ${all.filter((p) => reached.has(p.name)).length} of ${all.length} reached${found}`, box, 'label');
      for (const [title, kinds] of DESTINATION_GROUPS) {
        const group = all.filter((p) => kinds.includes(p.kind) && this.showsDestination(p));
        if (!group.length) continue;
        add('div', title, box, 'sublabel');
        const list = add('div', '', box, 'list');
        for (const p of group) {
          const text = `${reached.has(p.name) ? '✓ ' : ''}${p.name}${p.ele !== undefined && !p.name.includes(' m') ? ` · ${p.ele} m` : ''}`;
          button(text, () => this.choose({ name: p.name, x: p.x, z: p.z, kind: p.kind }), list, d?.name === p.name ? 'on' : '');
        }
      }
    }

    const known = this.vectors.places.filter((p) => this.shows(p.x, p.z));
    if (known.length) add('div', 'Places', box, 'label');
    const places = add('div', '', box, 'list');
    for (const p of known.sort((a, b) => a.name.localeCompare(b.name, 'sv'))) {
      button(p.name, () => this.choose({ name: p.name, x: p.x, z: p.z }), places, d?.name === p.name ? 'on' : '');
    }
    if (this.tops.length) {
      add('div', 'Summits', box, 'label');
      const tops = add('div', '', box, 'list');
      const s = this.rasters!.spacing;
      for (const t of this.tops.slice(0, 8)) {
        const name = `Summit ${t.height.toFixed(0)} m`;
        button(name, () => this.choose({ name, x: t.x * s, z: t.y * s }), tops, d?.name === name ? 'on' : '');
      }
    }
    if (this.starts.list.length || this.starts.editable) {
      add('div', 'Your start points', box, 'label');
      const mine = add('div', '', box, 'list');
      for (const s of this.starts.list) {
        const line = add('div', '', mine, 'spawn');
        if (this.starts.editable) {
          const name = add('input', '', line, 'start-name');
          name.value = s.name;
          name.maxLength = 40;
          // Typing a name must not drive or close the map.
          name.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') name.blur();
          });
          name.addEventListener('change', () => {
            s.name = name.value.trim() || s.name;
            name.value = s.name;
            void this.saveStarts();
          });
        } else add('span', s.name, line);
        button('Drive from here', () => this.actions.travel(s), line);
        if (this.starts.editable) {
          button('Remove', () => {
            this.starts.list.splice(this.starts.list.indexOf(s), 1);
            void this.saveStarts();
            this.renderSide();
          }, line, 'link');
        }
      }
      if (this.starts.editable) {
        button(this.placing ? 'Click the map where you want to start…' : 'Add a start point', () => {
          this.placing = !this.placing;
          this.renderSide();
        }, mine, this.placing ? 'on' : '');
      }
    }
    add('div', 'Start points', box, 'label');
    const spawns = add('div', '', box, 'list');
    for (const s of this.vectors.spawns) {
      const line = add('div', '', spawns, 'spawn');
      add('span', s.name, line);
      button('Drive from here', () => this.actions.travel(s), line);
    }
    const foot = add('div', '', box, 'foot');
    button('Centre on vehicle', () => this.centre(), foot);
    add('p', coarsePointer()
      ? 'Drag to move, pinch to zoom. Tap a spot to drive there; tap the pin again to clear it.'
      : 'Drag to move, wheel to zoom. Click a spot to drive there; click the pin again to clear it. M or Esc closes.', box, 'hint');
  }

  /** Whether open water covers a spot, by the map's land cover. */
  private isWater(x: number, z: number): boolean {
    const r = this.rasters;
    const water = this.index.masks.biomes.find((b) => b.name === 'water')?.id;
    if (!r || water === undefined) return false;
    const i = Math.round(z / r.spacing) * r.n + Math.round(x / r.spacing);
    return r.biome[i] === water;
  }

  private async saveStarts(): Promise<void> {
    const error = await this.starts.save();
    if (error) window.alert(`The start points were not saved: ${error}`);
  }

  private updateDistance(): void {
    const el = this.side.querySelector('.distance');
    const d = this.state.destination;
    if (el) el.textContent = d ? formatDistance(Math.hypot(d.x - this.state.x, d.z - this.state.z)) : '';
  }

  private draw(w: number, h: number): void {
    const c = this.ctx;
    const s = this.scale;
    c.fillStyle = '#1c2230';
    c.fillRect(0, 0, w, h);
    const [x0, y0] = this.toScreen(0, 0);
    const size = this.index.size * s;
    if (this.image && this.rasters) {
      c.imageSmoothingEnabled = s < 1 / this.rasters.spacing;
      c.drawImage(this.image, x0, y0, size, size);
    } else {
      c.fillStyle = '#e9e6da';
      c.fillRect(x0, y0, size, size);
      c.fillStyle = '#555';
      c.font = '15px Inter, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('Drawing the map…', x0 + size / 2, y0 + size / 2);
    }
    // The pale over what is not yet seen, placed in world units.
    this.syncSeen();
    const dpr = c.getTransform().a;
    const world = new DOMMatrix([dpr * s, 0, 0, dpr * s, dpr * x0, dpr * y0]);
    c.save();
    c.setTransform(world);
    this.drawFog(c);
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    c.strokeRect(x0, y0, size, size);

    c.lineCap = c.lineJoin = 'round';
    this.masked(c, world, (c) => {
      const line = (points: number[][], close = false): void => {
        c.beginPath();
        points.forEach(([x, z], i) => {
          const [sx, sy] = this.toScreen(x!, z!);
          if (i === 0) c.moveTo(sx, sy);
          else c.lineTo(sx, sy);
        });
        if (close) c.closePath();
      };
      c.lineCap = c.lineJoin = 'round';

      // Water.
      c.strokeStyle = '#3f86c2';
      for (const w2 of this.vectors.waterways) {
        c.lineWidth = w2.kind === 'river' ? Math.max(2, 12 * s) : Math.max(1, 3 * s);
        line(w2.points);
        c.stroke();
      }
      // Buildings, when there is room for them.
      if (s > 0.12) {
        c.fillStyle = '#5b4e45';
        for (const b of this.vectors.buildings) {
          line(b.outline, true);
          c.fill();
        }
      }
      if (s > 0.25) {
        c.strokeStyle = 'rgba(60,60,60,0.7)';
        c.lineWidth = 1;
        for (const p of this.vectors.powerLines) {
          line(p.points);
          c.stroke();
        }
      }
      // Lifts: a dark line from station to station, a dot at each end.
      if (s > 0.06 && this.vectors.lifts?.length) {
        c.strokeStyle = c.fillStyle = '#26221f';
        for (const l of this.vectors.lifts) {
          c.lineWidth = l.kind === 'magic_carpet' ? 1 : 1.6;
          line(l.points);
          c.stroke();
          for (const end of [l.points[0]!, l.points[l.points.length - 1]!]) {
            const [x, y] = this.toScreen(end[0]!, end[1]!);
            c.beginPath();
            c.arc(x, y, 2.4, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
      // Paths and trails dashed, then the roads cased and filled: asphalt orange, gravel white.
      c.setLineDash([4, 3]);
      c.strokeStyle = '#6b4a33';
      c.lineWidth = 1.2;
      for (const r of this.vectors.roads) {
        if (r.drivable && r.kind !== 'track') continue;
        line(r.points);
        c.stroke();
      }
      c.setLineDash([]);
      const roads = this.vectors.roads.filter((r) => r.drivable);
      const width = (r: (typeof roads)[number]): number => Math.max(r.surface === 'asphalt' ? 3 : r.kind === 'track' ? 1.6 : 2.2, (r.width ?? 4) * s);
      for (const pass of [0, 1]) {
        for (const r of roads) {
          const track = r.kind === 'track';
          if (pass === 0) {
            c.strokeStyle = r.surface === 'asphalt' ? '#7a3b1e' : '#5d4c3d';
            c.lineWidth = width(r) + (track ? 1.2 : 2);
          } else {
            c.strokeStyle = r.surface === 'asphalt' ? '#ee8d3e' : track ? '#e9dcc0' : '#fffaf0';
            c.lineWidth = width(r);
          }
          line(r.points);
          c.stroke();
        }
      }
    });

    // Where the vehicle has been.
    const t = this.trail;
    if (t.length >= 4) {
      c.strokeStyle = 'rgba(200,40,90,0.75)';
      c.lineWidth = 2;
      c.beginPath();
      let pen = false;
      for (let i = 0; i < t.length; i += 2) {
        if (Number.isNaN(t[i]!)) {
          pen = false;
          continue;
        }
        const [sx, sy] = this.toScreen(t[i]!, t[i + 1]!);
        if (pen) c.lineTo(sx, sy);
        else c.moveTo(sx, sy);
        pen = true;
      }
      c.stroke();
    }

    // Names and spot heights.
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const label = (text: string, sx: number, sy: number, font: string): void => {
      c.font = font;
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.strokeText(text, sx, sy);
      c.fillStyle = '#222';
      c.fillText(text, sx, sy);
    };
    const r = this.rasters;
    for (const top of this.tops) {
      const [sx, sy] = this.toScreen(top.x * r!.spacing, top.y * r!.spacing);
      c.fillStyle = '#5a3c26';
      c.beginPath();
      c.moveTo(sx, sy - 5);
      c.lineTo(sx + 5, sy + 4);
      c.lineTo(sx - 5, sy + 4);
      c.closePath();
      c.fill();
      label(top.height.toFixed(0), sx, sy + 13, '11px Inter, system-ui, sans-serif');
    }
    // Destinations: a dot in the colour of their kind, ringed once reached; named when zoomed in.
    const reached = this.actions.reached();
    for (const p of this.vectors.destinations ?? []) {
      if (!this.showsDestination(p)) continue;
      const [sx, sy] = this.toScreen(p.x, p.z);
      c.fillStyle = DESTINATION_COLORS[p.kind] ?? '#444';
      c.strokeStyle = '#fff';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(sx, sy, 4.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      if (reached.has(p.name)) {
        c.strokeStyle = '#1f7a3a';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(sx, sy, 8, 0, Math.PI * 2);
        c.stroke();
      }
      if (s >= 0.25 || (s >= 0.08 && !/ (of|at) /.test(p.name))) label(p.name, sx, sy + 13, '11px Inter, system-ui, sans-serif');
    }
    for (const p of this.vectors.places) {
      if (!this.shows(p.x, p.z)) continue;
      const [sx, sy] = this.toScreen(p.x, p.z);
      const big = p.kind === 'village' || p.kind === 'town';
      if (p.kind === 'locality' && s < 0.12) continue;
      label(p.name, sx, sy - 12, `${big ? '600 15px' : p.kind === 'locality' ? 'italic 12px' : '600 13px'} Inter, system-ui, sans-serif`);
    }
    for (const sp of [...this.vectors.spawns, ...this.starts.list]) {
      const [sx, sy] = this.toScreen(sp.x, sp.z);
      c.fillStyle = this.starts.list.includes(sp as never) ? '#4e6573' : '#2f3b33';
      c.strokeStyle = '#fff';
      c.lineWidth = 1.5;
      c.fillRect(sx - 4, sy - 4, 8, 8);
      c.strokeRect(sx - 4, sy - 4, 8, 8);
    }

    // The destinations: a pin, and a line to it from the vehicle.
    const st = this.state;
    const [vx, vy] = this.toScreen(st.x, st.z);
    for (const [d, pin] of [[st.shared, PIN.shared], [st.destination, PIN.own]] as const) {
      if (!d) continue;
      const [dx, dy] = this.toScreen(d.x, d.z);
      c.setLineDash([6, 5]);
      c.strokeStyle = pin.line;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(vx, vy);
      c.lineTo(dx, dy);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = pin.fill;
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(dx, dy - 16, 7, Math.PI * 0.85, Math.PI * 2.15);
      c.lineTo(dx, dy);
      c.closePath();
      c.fill();
      c.stroke();
      if (d.name !== 'Marked spot') label(d.name, dx, dy - 32, '600 13px Inter, system-ui, sans-serif');
    }

    // The other drivers, in their paint, with their names.
    for (const o of st.others ?? []) {
      const [ox, oy] = this.toScreen(o.x, o.z);
      c.save();
      c.translate(ox, oy);
      c.rotate((o.heading * Math.PI) / 180);
      arrow(c, o.color, 0.85);
      c.restore();
      label(o.name, ox, oy - 20, '17px "Instrument Serif", Georgia, serif');
    }

    // The vehicle: an arrow the way it faces.
    c.save();
    c.translate(vx, vy);
    c.rotate((st.heading * Math.PI) / 180);
    arrow(c, '#c9a44a');
    c.restore();

    this.scaleBar(h);
  }

  private scaleBar(h: number): void {
    const c = this.ctx;
    const target = 120 / this.scale;
    const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const px = nice * this.scale;
    const x = 20, y = h - 24;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(x - 6, y - 18, px + 12, 28);
    c.strokeStyle = '#222';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, y - 4);
    c.lineTo(x, y);
    c.lineTo(x + px, y);
    c.lineTo(x + px, y - 4);
    c.stroke();
    c.fillStyle = '#222';
    c.font = '11px Inter, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + px / 2, y - 6);
    c.textAlign = 'left';
    c.fillText('N ↑', x + px + 14, y);
  }
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${(Math.round(m / 10) * 10).toFixed(0)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Puts the coarsest height and mask tiles together into one raster over the whole region. */
async function loadRasters(index: RegionIndex): Promise<MapRasters> {
  const hl = index.heights.levels[index.heights.levels.length - 1]!;
  const ml = index.masks.levels.find((l) => l.spacing === hl.spacing) ?? index.masks.levels[index.masks.levels.length - 1]!;
  const spacing = hl.spacing;
  const n = Math.round(index.size / spacing) + 1;
  const heights = new Float32Array(n * n);
  const biome = new Uint8Array(n * n);
  const surface = new Uint8Array(n * n);
  const canopy = new Uint8Array(n * n);
  const hs = index.heights.samples, apron = index.heights.apron, side = hs + 2 * apron;
  const enc = index.heights.encoding;
  const ms = index.masks.samples;
  const plane = ms * ms;
  const channel = (name: string): number => index.masks.channels.findIndex((c) => c.name === name);
  const bc = channel('biome'), sc = channel('surface'), cc = channel('canopy');
  const canopyScale = cc >= 0 ? (index.masks.channels[cc]!.scale ?? 0.25) : 0;
  const mstep = ml.spacing / spacing;
  const jobs: Promise<void>[] = [];
  for (let ty = 0; ty < hl.count; ty++) {
    for (let tx = 0; tx < hl.count; tx++) {
      jobs.push(fetchUint16(heightFileUrl(index, hl.level, tx, ty), side * side).then((data) => {
        for (let j = 0; j < hs; j++) {
          for (let i = 0; i < hs; i++) {
            const gx = tx * (hs - 1) + i, gy = ty * (hs - 1) + j;
            if (gx < n && gy < n) heights[gy * n + gx] = enc.offset + data[(j + apron) * side + i + apron]! * enc.scale;
          }
        }
      }));
    }
  }
  const mcount = Math.round(index.size / ml.span);
  for (let ty = 0; ty < mcount; ty++) {
    for (let tx = 0; tx < mcount; tx++) {
      jobs.push(fetchBytes(maskFileUrl(index, ml.level, tx, ty), plane * index.masks.channels.length).then((data) => {
        const per = (ms - 1) * mstep;
        for (let j = 0; j < ms; j++) {
          for (let i = 0; i < ms; i++) {
            const at = j * ms + i;
            // A finer mask than the heights is sampled down; coarser ones fill whole blocks.
            for (let b = 0; b < Math.max(1, mstep); b++) {
              for (let a = 0; a < Math.max(1, mstep); a++) {
                const gx = Math.floor(tx * per + i * mstep) + a, gy = Math.floor(ty * per + j * mstep) + b;
                if (gx < n && gy < n) {
                  biome[gy * n + gx] = data[bc * plane + at]!;
                  surface[gy * n + gx] = data[sc * plane + at]!;
                  if (cc >= 0) canopy[gy * n + gx] = data[cc * plane + at]!;
                }
              }
            }
          }
        }
      }));
    }
  }
  await Promise.all(jobs);
  return { n, spacing, heights, biome, surface, canopy, canopyScale };
}
