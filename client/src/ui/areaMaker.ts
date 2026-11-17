// Making a new area: a map of Sweden with a square in the middle; move the map to place it,
// pick a size and a name, and the host's importer builds it while this shows how it goes.
// The map tiles come from OpenStreetMap, so this screen needs the internet; the game does not.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fromSweref, toSweref } from '@spar/shared';
import type { RegionListing } from '../terrain/region';

interface AreasInfo {
  enabled: boolean;
  sizes: number[];
  job: { name: string; title: string; state: 'running' | 'done' | 'failed'; lines: string[] } | null;
}

/** Whether this computer may make areas, and with which sizes. */
export async function areasInfo(): Promise<AreasInfo | null> {
  try {
    const res = await fetch('/api/areas');
    return res.ok ? ((await res.json()) as AreasInfo) : null;
  } catch {
    return null;
  }
}

/** Removes an area on the host; resolves with an error message, or null when it went. */
export async function removeArea(name: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/areas/${name}`, { method: 'DELETE' });
    return res.ok ? null : ((await res.json()) as { error: string }).error;
  } catch (err) {
    return String(err);
  }
}

/** The four corners of a SWEREF square as latitude and longitude. */
function corners(west: number, north: number, size: number): L.LatLngTuple[] {
  return [
    [west, north],
    [west + size, north],
    [west + size, north - size],
    [west, north - size],
  ].map(([e, n]) => {
    const p = fromSweref(e!, n!);
    return [p.lat, p.lon] as L.LatLngTuple;
  });
}

export class AreaMaker {
  private readonly box: HTMLDivElement;
  private map: L.Map | null = null;
  private square: L.Polygon | null = null;
  private size = 4096;
  private sizes: number[] = [2048, 4096, 6144, 10240];
  private polling = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly regions: RegionListing[],
    /** Where to look first: the area being played. */
    private readonly near: { easting: number; northing: number; size: number } | null,
    private readonly done: (name: string) => void,
    private readonly close: () => void,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'box';
    root.replaceChildren(this.box);
  }

  get open(): boolean {
    return this.root.style.display === 'flex';
  }

  async show(): Promise<void> {
    this.root.style.display = 'flex';
    const info = await areasInfo();
    if (info) this.sizes = info.sizes;
    if (!this.sizes.includes(this.size)) this.size = this.sizes[0]!;
    this.render();
    // A build may already be under way, from before the page was loaded again.
    if (info?.job?.state === 'running') this.follow();
  }

  hide(): void {
    window.clearTimeout(this.polling);
    this.map?.remove();
    this.map = null;
    this.root.style.display = 'none';
  }

  private render(): void {
    const box = this.box;
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

    add('h2', 'New area');
    const body = add('div', '', box, 'body');
    const mapEl = add('div', '', body, 'map');
    const side = add('div', '', body, 'side');
    add('p', 'Move the map so the square covers the area you want. Anywhere in Sweden.', side, 'hint');

    add('div', 'Size', side, 'label');
    const sizes = add('div', '', side, 'list');
    for (const s of this.sizes) {
      button(`${s / 1024 >= 10 ? 10 : Math.round(s / 1024)} km`, () => {
        this.size = s;
        for (const b of sizes.children) b.classList.toggle('on', b === sizeButtons.get(s));
        this.place();
      }, sizes, s === this.size ? 'on' : '');
    }
    const sizeButtons = new Map(this.sizes.map((s, i) => [s, sizes.children[i]!]));

    add('div', 'Name', side, 'label');
    const name = add('input', '', side, 'name');
    name.type = 'text';
    name.maxLength = 40;
    name.placeholder = 'For example: Sommarstugan';
    name.addEventListener('keydown', (e) => e.stopPropagation());

    const note = add('p', '', side, 'note');
    const progress = add('pre', '', side, 'progress');
    progress.style.display = 'none';
    const foot = add('div', '', side, 'foot');
    const build = button('Build', () => void this.build(name.value.trim(), note), foot, 'primary');
    button('Cancel', () => {
      this.hide();
      this.close();
    }, foot);
    this.progress = progress;
    this.buildButton = build;
    this.note = note;

    // The map: OpenStreetMap's own tiles, with the areas already made outlined.
    this.map?.remove();
    const map = L.map(mapEl, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    for (const r of this.regions) {
      if (!r.origin) continue;
      L.polygon(corners(r.origin.easting, r.origin.northing, r.size), { color: '#2f6f4f', weight: 1.5, fillOpacity: 0.12 })
        .bindTooltip(r.title)
        .addTo(map);
    }
    if (this.near) {
      const c = fromSweref(this.near.easting + this.near.size / 2, this.near.northing - this.near.size / 2);
      map.setView([c.lat, c.lon], 10);
    } else map.setView([62.5, 16], 5);
    this.square = L.polygon([], { color: '#d63c28', weight: 2, fillOpacity: 0.1, interactive: false }).addTo(map);
    map.on('move', () => this.place());
    this.map = map;
    this.place();
    // The box has only just been laid out.
    window.setTimeout(() => map.invalidateSize(), 0);
  }

  private progress: HTMLPreElement | null = null;
  private buildButton: HTMLButtonElement | null = null;
  private note: HTMLParagraphElement | null = null;

  /** The square's north-west corner in SWEREF 99 TM, centred on the map. */
  private origin(): { west: number; north: number } | null {
    if (!this.map) return null;
    const c = this.map.getCenter();
    const p = toSweref(c.lat, c.lng);
    return { west: Math.round(p.easting - this.size / 2), north: Math.round(p.northing + this.size / 2) };
  }

  private place(): void {
    const o = this.origin();
    if (o && this.square) this.square.setLatLngs(corners(o.west, o.north, this.size));
  }

  private async build(title: string, note: HTMLElement): Promise<void> {
    const o = this.origin();
    if (!o) return;
    if (!title) {
      note.textContent = 'Give the area a name first.';
      return;
    }
    note.textContent = 'Starting…';
    try {
      const res = await fetch('/api/areas', { method: 'POST', body: JSON.stringify({ title, west: o.west, north: o.north, size: this.size }) });
      const answer = (await res.json()) as { name?: string; error?: string };
      if (!res.ok) {
        note.textContent = answer.error ?? `Could not start (HTTP ${res.status}).`;
        return;
      }
    } catch (err) {
      note.textContent = `Could not reach the server: ${String(err)}`;
      return;
    }
    this.follow();
  }

  /** Shows the importer's progress until the build ends. */
  private follow(): void {
    const tick = async (): Promise<void> => {
      const info = await areasInfo();
      const job = info?.job;
      if (!job || !this.open) return;
      if (this.progress) {
        this.progress.style.display = 'block';
        this.progress.textContent = job.lines.slice(-8).join('\n');
        this.progress.scrollTop = this.progress.scrollHeight;
      }
      if (this.buildButton) this.buildButton.disabled = job.state === 'running';
      if (job.state === 'running') {
        if (this.note) this.note.textContent = `Building ${job.title}. Downloads come first; a 2 km area takes a minute or two, 10 km longer.`;
        this.polling = window.setTimeout(() => void tick(), 1000);
      } else if (job.state === 'done') {
        if (this.note) this.note.textContent = `${job.title} is ready.`;
        if (this.buildButton) {
          const go = document.createElement('button');
          go.className = 'primary';
          go.textContent = `Drive in ${job.title}`;
          go.addEventListener('click', (e) => {
            e.stopPropagation();
            this.done(job.name);
          });
          this.buildButton.replaceWith(go);
          this.buildButton = null;
        }
      } else if (this.note) this.note.textContent = `Building ${job.title} failed; the last lines above say why.`;
    };
    void tick();
  }
}
