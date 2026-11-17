// The map (M): the whole region from above, drawn from the same heights, masks and OpenStreetMap
// lines the world is built from. It shows where the vehicle is and where it has been, and
// is where a destination is chosen: click anywhere, or pick a place, a summit or a start
// point from the list. Start points can also be jumped to.

import type { RegionIndex, RegionVectors } from '@spar/shared';
import { fetchBytes, fetchUint16, heightFileUrl, maskFileUrl } from '../terrain/region';
import { paintGround, summits, type MapRasters, type Summit } from './mapImage';

export interface Destination {
  name: string;
  x: number;
  z: number;
}

type Spawn = RegionVectors['spawns'][number];

export interface MapActions {
  setDestination(d: Destination | null): void;
  /** Puts the vehicle down at a start point. */
  travel(spawn: Spawn): void;
  close(): void;
}

export interface MapState {
  /** The vehicle, or the camera when flying: position and heading in degrees (0 north, 90 east). */
  x: number;
  z: number;
  heading: number;
  destination: Destination | null;
}

/** Most pixels per metre when zoomed right in. */
const MAX_ZOOM = 3;
/** Metres the vehicle must move before the trail gets another point. */
const TRAIL_STEP = 15;
const TRAIL_MAX = 6000;

interface Pick {
  name: string;
  x: number;
  z: number;
  kind: 'place' | 'summit' | 'spawn';
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

  constructor(
    parent: HTMLElement,
    private readonly index: RegionIndex,
    private readonly vectors: RegionVectors,
    private readonly actions: MapActions,
  ) {
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
      const [x, z] = this.toWorld(e.offsetX, e.offsetY);
      this.scale = Math.min(MAX_ZOOM, Math.max(this.fit() * 0.8, this.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      // Keep the point under the cursor where it is.
      const [x2, z2] = this.toWorld(e.offsetX, e.offsetY);
      this.cx += x - x2;
      this.cz += z - z2;
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.offsetX, y: e.offsetY, cx: this.cx, cz: this.cz, moved: false };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const [x, z] = this.toWorld(e.offsetX, e.offsetY);
      this.hover = { x, z };
      const d = this.drag;
      if (!d) return;
      if (Math.hypot(e.offsetX - d.x, e.offsetY - d.y) > 4) d.moved = true;
      if (d.moved) {
        this.cx = d.cx - (e.offsetX - d.x) / this.scale;
        this.cz = d.cz - (e.offsetY - d.y) / this.scale;
      }
    });
    this.canvas.addEventListener('pointerleave', () => (this.hover = null));
    this.canvas.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved) this.click(e.offsetX, e.offsetY);
    });
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

  /** Height of the ground anywhere in the region, once the map has loaded; else null. */
  heightAt(x: number, z: number): number | null {
    const r = this.rasters;
    if (!r) return null;
    const i = Math.round(x / r.spacing), j = Math.round(z / r.spacing);
    if (i < 0 || j < 0 || i >= r.n || j >= r.n) return null;
    return r.heights[j * r.n + i]!;
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

  private picks(): Pick[] {
    const r = this.rasters;
    return [
      ...this.vectors.places.map((p): Pick => ({ name: p.name, x: p.x, z: p.z, kind: 'place' })),
      ...this.tops.map((t): Pick => ({ name: `Summit ${t.height.toFixed(0)} m`, x: t.x * (r?.spacing ?? 1), z: t.y * (r?.spacing ?? 1), kind: 'summit' })),
      ...this.vectors.spawns.map((s): Pick => ({ name: s.name, x: s.x, z: s.z, kind: 'spawn' })),
    ];
  }

  private click(sx: number, sy: number): void {
    const d = this.state.destination;
    if (d) {
      const [dx, dy] = this.toScreen(d.x, d.z);
      if (Math.hypot(dx - sx, dy - sy) < 14) {
        this.choose(null);
        return;
      }
    }
    let best: Pick | null = null;
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
    this.choose(best ? { name: best.name, x: best.x, z: best.z } : { name: 'Marked spot', x, z });
  }

  private choose(d: Destination | null): void {
    this.state.destination = d;
    this.actions.setDestination(d);
    this.renderSide();
  }

  private renderSide(): void {
    const box = this.side;
    box.replaceChildren();
    const add = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = box, cls = ''): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      if (text) e.textContent = text;
      if (cls) e.className = cls;
      parent.append(e);
      return e;
    };
    const button = (text: string, onClick: () => void, parent: HTMLElement, cls = ''): HTMLButtonElement => {
      const b = add('button', text, parent, cls);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    add('h2', this.index.title);
    add('div', 'Destination', box, 'label');
    const d = this.state.destination;
    const row = add('div', '', box, 'dest');
    add('span', d ? d.name : 'None. Click the map, or pick one below.', row, d ? 'name' : 'none');
    add('span', '', row, 'distance');
    if (d) button('Clear', () => this.choose(null), row);
    this.updateDistance();

    add('div', 'Places', box, 'label');
    const places = add('div', '', box, 'list');
    for (const p of [...this.vectors.places].sort((a, b) => a.name.localeCompare(b.name, 'sv'))) {
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
    add('div', 'Start points', box, 'label');
    const spawns = add('div', '', box, 'list');
    for (const s of this.vectors.spawns) {
      const line = add('div', '', spawns, 'spawn');
      add('span', s.name, line);
      button('Drive from here', () => this.actions.travel(s), line);
    }
    const foot = add('div', '', box, 'foot');
    button('Centre on vehicle', () => this.centre(), foot);
    button('Close', () => this.actions.close(), foot);
    add('p', 'Drag to move, wheel to zoom. Click a spot to drive there; click the pin again to clear it. M or Esc closes.', box, 'hint');
  }

  private updateDistance(): void {
    const el = this.side.querySelector('.distance');
    const d = this.state.destination;
    if (el) el.textContent = d ? formatDistance(Math.hypot(d.x - this.state.x, d.z - this.state.z)) : '';
  }

  private draw(w: number, h: number): void {
    const c = this.ctx;
    const s = this.scale;
    c.fillStyle = '#20282c';
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
      c.font = '15px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('Drawing the map…', x0 + size / 2, y0 + size / 2);
    }
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    c.strokeRect(x0, y0, size, size);

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
      label(top.height.toFixed(0), sx, sy + 13, '11px system-ui, sans-serif');
    }
    for (const p of this.vectors.places) {
      const [sx, sy] = this.toScreen(p.x, p.z);
      const big = p.kind === 'village' || p.kind === 'town';
      if (p.kind === 'locality' && s < 0.12) continue;
      label(p.name, sx, sy - 12, `${big ? '600 15px' : p.kind === 'locality' ? 'italic 12px' : '600 13px'} system-ui, sans-serif`);
    }
    for (const sp of this.vectors.spawns) {
      const [sx, sy] = this.toScreen(sp.x, sp.z);
      c.fillStyle = '#2f6f4f';
      c.strokeStyle = '#fff';
      c.lineWidth = 1.5;
      c.fillRect(sx - 4, sy - 4, 8, 8);
      c.strokeRect(sx - 4, sy - 4, 8, 8);
    }

    // The destination: a pin, and a line to it from the vehicle.
    const st = this.state;
    const [vx, vy] = this.toScreen(st.x, st.z);
    const d = st.destination;
    if (d) {
      const [dx, dy] = this.toScreen(d.x, d.z);
      c.setLineDash([6, 5]);
      c.strokeStyle = 'rgba(214,60,40,0.8)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(vx, vy);
      c.lineTo(dx, dy);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#d63c28';
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(dx, dy - 16, 7, Math.PI * 0.85, Math.PI * 2.15);
      c.lineTo(dx, dy);
      c.closePath();
      c.fill();
      c.stroke();
      if (d.name !== 'Marked spot') label(d.name, dx, dy - 32, '600 13px system-ui, sans-serif');
    }

    // The vehicle: an arrow the way it faces.
    c.save();
    c.translate(vx, vy);
    c.rotate((st.heading * Math.PI) / 180);
    c.fillStyle = '#f08a24';
    c.strokeStyle = '#111';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(7, 8);
    c.lineTo(0, 4);
    c.lineTo(-7, 8);
    c.closePath();
    c.fill();
    c.stroke();
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
    c.font = '11px system-ui, sans-serif';
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
  const hs = index.heights.samples, apron = index.heights.apron, side = hs + 2 * apron;
  const enc = index.heights.encoding;
  const ms = index.masks.samples;
  const plane = ms * ms;
  const channel = (name: string): number => index.masks.channels.findIndex((c) => c.name === name);
  const bc = channel('biome'), sc = channel('surface');
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
                }
              }
            }
          }
        }
      }));
    }
  }
  await Promise.all(jobs);
  return { n, spacing, heights, biome, surface };
}
