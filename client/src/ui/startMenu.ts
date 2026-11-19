// The start screen: which world (chosen by the host), where to start, which vehicle, and the
// driver's name for when others join. The world loads and slowly turns behind it.

import { isElectric, peakPower, type RegionIndex, type RegionVectors, type VehicleDef } from '@spar/shared';
import type { RegionListing } from '../terrain/region';
import type { StartStore } from './starts';

export interface StartPoint {
  name: string;
  x: number;
  z: number;
  heading: number;
}

export interface StartChoice {
  start: StartPoint;
  vehicle: string;
  name: string;
}

export interface StartActions {
  /** Switch to another region: the page loads again with it. */
  region(name: string): void;
  /** Open the map to place start points by hand. */
  placeStarts(): void;
  /** Open the screen for making a new area. */
  newArea(): void;
  /** Remove an area for good; resolves with an error message, or null when it is gone. */
  removeArea(name: string): Promise<string | null>;
  drive(choice: StartChoice): void;
  settings(): void;
  controls(): void;
  credits(): void;
}

const NAME_KEY = 'spar.name';
const START_KEY = 'spar.start';
const LAST_KEY = 'spar.last';

/** Where the vehicle was when last driven in a region, saved now and then while driving. */
export interface LastPosition {
  region: string;
  x: number;
  z: number;
  heading: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; fine.
  }
}

export function saveLastPosition(p: LastPosition): void {
  write(LAST_KEY, JSON.stringify(p));
}

function lastPosition(region: string): LastPosition | null {
  try {
    const p = JSON.parse(read(LAST_KEY) ?? 'null') as LastPosition | null;
    return p && p.region === region && Number.isFinite(p.x) && Number.isFinite(p.z) ? p : null;
  } catch {
    return null;
  }
}

/** A line about a vehicle: wheels, weight, power and gears. */
export function describeVehicle(def: VehicleDef): string {
  const wheels = def.axles.length * 2;
  const driven = def.axles.filter((a) => a.driven).length * 2;
  const weight = `${wheels}×${driven} · ${(def.chassis.mass / 1000).toFixed(1)} t`;
  if (isElectric(def)) return `${weight} · ${Math.round(peakPower(def.drivetrain.torqueCurve) / 1000)} kW · electric`;
  const torque = Math.max(...def.drivetrain.torqueCurve.map((p) => p[1]!));
  const low = def.drivetrain.ranges.low !== undefined ? ' + low range' : '';
  return `${weight} · ${torque} Nm · ${def.drivetrain.gears.length} gears${low}`;
}

export class StartMenu {
  private readonly box: HTMLDivElement;
  private readonly preview: HTMLCanvasElement;
  private starts: StartPoint[] = [];
  private start = 0;
  private vehicle: string;
  private name: string;
  private picture: HTMLCanvasElement | null = null;
  /** Whether this computer may make and remove areas (it runs the server). */
  private maker = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly index: RegionIndex,
    private readonly vectors: RegionVectors,
    private readonly custom: StartStore,
    private readonly vehicles: VehicleDef[],
    vehicle: string,
    private readonly regions: RegionListing[],
    private readonly actions: StartActions,
  ) {
    this.vehicle = vehicle;
    this.name = read(NAME_KEY) ?? '';
    this.box = document.createElement('div');
    this.box.className = 'box';
    this.preview = document.createElement('canvas');
    this.preview.className = 'preview';
    // The dots on the map are start points too: click one to start there.
    this.preview.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = this.startAt(e);
      if (i < 0) return;
      this.start = i;
      this.render();
    });
    this.preview.addEventListener('mousemove', (e) => {
      const i = this.startAt(e);
      this.preview.style.cursor = i >= 0 ? 'pointer' : '';
      this.preview.title = i >= 0 ? this.starts[i]!.name : '';
    });
    root.replaceChildren(this.box);
  }

  /** The start point under the pointer on the map, or -1. */
  private startAt(e: MouseEvent): number {
    const r = this.preview.getBoundingClientRect();
    const k = r.width / this.index.size;
    let best = -1;
    let bestDist = 12; // pixels: easy to hit
    this.starts.forEach((s, i) => {
      const d = Math.hypot(r.left + s.x * k - e.clientX, r.top + s.z * k - e.clientY);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  get open(): boolean {
    return this.root.style.display === 'flex';
  }

  show(): void {
    const last = lastPosition(this.index.name);
    this.starts = [
      ...(last ? [{ name: 'Where you left off', x: last.x, z: last.z, heading: last.heading }] : []),
      ...this.custom.list.map((s) => ({ name: s.name, x: s.x, z: s.z, heading: s.heading })),
      ...this.vectors.spawns.map((s) => ({ name: s.name, x: s.x, z: s.z, heading: s.heading })),
    ];
    const saved = read(START_KEY);
    const found = this.starts.findIndex((s) => s.name === saved);
    this.start = found >= 0 ? found : 0;
    this.render();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** Offers making and removing areas, once the server says this computer may. */
  setMaker(enabled: boolean): void {
    if (enabled === this.maker) return;
    this.maker = enabled;
    if (this.open) this.render();
  }

  /** The map's picture of the ground, once drawn, for the preview. */
  setPicture(picture: HTMLCanvasElement | null): void {
    if (!picture || picture === this.picture) return;
    this.picture = picture;
    if (this.open) this.drawPreview();
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

    add('h1', 'Spår');
    add('p', 'Off-road driving through real Swedish landscapes', box, 'sub');

    const columns = add('div', '', box, 'columns');
    const left = add('div', '', columns, 'column');
    const right = add('div', '', columns, 'column');

    add('div', 'Map', left, 'label');
    const maps = add('div', '', left, 'cards');
    const listed = this.regions.some((r) => r.name === this.index.name) ? this.regions : [{ name: this.index.name, title: this.index.title, size: this.index.size }];
    for (const r of listed) {
      const here = r.name === this.index.name;
      const c = add('button', '', maps, `card${here ? ' on' : ''}`);
      add('div', r.title, c, 'title');
      const km = (r.size / 1000).toFixed(0);
      add('div', here ? `${km} × ${km} km` : `${km} × ${km} km · loads the map`, c, 'detail');
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!here) this.actions.region(r.name);
      });
      // Areas you are done with can go, to free the disk; not the one being played.
      if (this.maker && !here) {
        const remove = add('span', 'Remove', c, 'remove');
        remove.title = `Remove ${r.title} from this computer`;
        remove.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!window.confirm(`Remove ${r.title}? Its map files and downloads are deleted; it can be made again later.`)) return;
          void this.actions.removeArea(r.name).then((error) => {
            if (error) window.alert(error);
            else {
              this.regions.splice(this.regions.indexOf(r), 1);
              this.render();
            }
          });
        });
      }
    }
    if (this.maker) button('New area…', () => this.actions.newArea(), left, 'add');
    left.append(this.preview);
    this.drawPreview();

    add('div', 'Start at', right, 'label');
    const starts = add('div', '', right, 'list');
    this.starts.forEach((s, i) => {
      button(s.name, () => {
        this.start = i;
        this.render();
      }, starts, i === this.start ? 'on' : '');
    });
    if (this.custom.editable) button('Place your own…', () => this.actions.placeStarts(), starts, 'link-button');

    add('div', 'Vehicle', right, 'label');
    const vehicles = add('div', '', right, 'cards');
    for (const def of this.vehicles) {
      const c = add('button', '', vehicles, `card${def.name === this.vehicle ? ' on' : ''}`);
      add('div', def.title, c, 'title');
      add('div', describeVehicle(def), c, 'detail');
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        this.vehicle = def.name;
        this.render();
      });
    }

    add('div', 'Driver', right, 'label');
    const name = add('input', '', right, 'name');
    name.type = 'text';
    name.maxLength = 24;
    name.placeholder = 'Your name, for when others join';
    name.value = this.name;
    name.addEventListener('input', () => {
      this.name = name.value.trim();
      write(NAME_KEY, this.name);
    });
    // Typing a name must not steer the vehicle or open panels.
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.drive();
    });

    const foot = add('div', '', box, 'foot');
    button('Drive', () => this.drive(), foot, 'primary');
    button('Settings', () => this.actions.settings(), foot);
    button('Controls', () => this.actions.controls(), foot);
    button('Credits', () => this.actions.credits(), foot, 'link');
  }

  /** Drives off from a point picked elsewhere (the big map), with the vehicle chosen here. */
  driveFrom(start: StartPoint): void {
    this.actions.drive({ start: { name: start.name, x: start.x, z: start.z, heading: start.heading }, vehicle: this.vehicle, name: this.name });
  }

  /** Drives off with what is chosen (the Drive button, Enter, or Start on a gamepad). */
  drive(): void {
    const start = this.starts[this.start]!;
    write(START_KEY, start.name);
    this.actions.drive({ start, vehicle: this.vehicle, name: this.name });
  }

  /** The region's map, with the start points marked and the chosen one highlighted. */
  private drawPreview(): void {
    const c = this.preview.getContext('2d')!;
    const css = 240;
    const dpr = Math.min(2, window.devicePixelRatio);
    this.preview.width = this.preview.height = Math.round(css * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#2a3236';
    c.fillRect(0, 0, css, css);
    const k = css / this.index.size;
    if (this.picture) c.drawImage(this.picture, 0, 0, css, css);
    else {
      c.fillStyle = '#9fb4bc';
      c.font = '13px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('Drawing the map…', css / 2, css / 2);
    }
    c.strokeStyle = '#ee8d3e';
    c.lineWidth = 1.5;
    for (const r of this.vectors.roads) {
      if (!r.drivable || r.surface !== 'asphalt') continue;
      c.beginPath();
      r.points.forEach(([x, z], i) => (i === 0 ? c.moveTo(x! * k, z! * k) : c.lineTo(x! * k, z! * k)));
      c.stroke();
    }
    this.starts.forEach((s, i) => {
      const on = i === this.start;
      const mine = this.custom.list.some((m) => m.x === s.x && m.z === s.z);
      c.fillStyle = on ? '#d63c28' : mine ? '#2c6fb0' : '#2f6f4f';
      c.strokeStyle = '#fff';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(s.x * k, s.z * k, on ? 6 : 4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });
  }
}
