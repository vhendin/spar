// The start screen: which world (chosen by the host), where to start, which vehicle, and the
// driver's name for when others join. The world loads and slowly turns behind it.

import { isElectric, peakPower, type RegionIndex, type RegionVectors, type VehicleDef } from '@spar/shared';
import type { RegionListing } from '../terrain/region';
import type { StartStore } from './starts';
import { fillPlayers, PAINTS, paintSwatches, type PlayerLine } from './players';

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
  /** Paint for the vehicle, #rrggbb, or '' for its own colours. */
  color: string;
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
  /** Set off just behind another driver, wherever they are. */
  join(id: string): void;
  /** Opens the vehicle menu on `current`, painted `color`; `choose` gets the one picked there. */
  garage(current: string, color: string, choose: (name: string) => void): void;
}

const NAME_KEY = 'spar.name';
const COLOR_KEY = 'spar.color';
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

/** The driver's name and paint remembered on this computer, for joining before the start screen shows. */
export function storedProfile(): { name: string; color?: string } {
  const color = read(COLOR_KEY) ?? '';
  return PAINTS.some((p) => p.color === color) && color ? { name: read(NAME_KEY) ?? '', color } : { name: read(NAME_KEY) ?? '' };
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
  private color: string;
  /** Who else is connected, kept up to date in place so typing a name is not interrupted. */
  private readonly players = document.createElement('div');
  /** The players as last listed, and each region card's detail line, for the counts. */
  private lines: PlayerLine[] = [];
  private regionCards: Map<string, { detail: HTMLElement; base: string }>;
  private playersLabel = document.createElement('div');
  /** Where friends on the same network open the game, once the server has said. */
  private readonly invite = document.createElement('p');
  /** Who is logged in, when the game is reached through the login. */
  private readonly account = document.createElement('p');
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
    const color = read(COLOR_KEY) ?? '';
    this.color = PAINTS.some((p) => p.color === color) ? color : '';
    this.playersLabel.className = 'label';
    this.regionCards = new Map();
    this.playersLabel.textContent = 'On the road';
    this.invite.className = 'invite';
    this.invite.style.display = 'none';
    this.account.className = 'invite';
    this.account.style.display = 'none';
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
    this.regionCards.clear();
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
    add('p', 'A quiet off-road game about Swedish backroads, weather and slow light.', box, 'sub');
    box.append(this.invite, this.account);

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
      const detail = add('div', '', c, 'detail');
      this.regionCards.set(r.name, { detail, base: here ? `${km} × ${km} km` : `${km} × ${km} km · loads the map` });
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
    this.countDrivers();
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
    button('Look at them all…', () => this.actions.garage(this.vehicle, this.color, (name) => {
      this.vehicle = name;
      this.render();
    }), vehicles, 'link-button');

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
    paintSwatches(right, this.color, (c) => {
      this.color = c;
      write(COLOR_KEY, c);
      this.render();
    });
    right.append(this.playersLabel, this.players);

    const foot = add('div', '', box, 'foot');
    button('Drive', () => this.drive(), foot, 'primary');
    button('Settings', () => this.actions.settings(), foot);
    button('Controls', () => this.actions.controls(), foot);
    button('Credits', () => this.actions.credits(), foot, 'link');
    add('div', '', box, 'motto').innerHTML = 'Ingen klocka. Ingen poäng. <em>Bara vägen.</em>';
  }

  /** Drives off from a point picked elsewhere (the big map), with the vehicle chosen here. */
  driveFrom(start: StartPoint): void {
    this.actions.drive({ start: { name: start.name, x: start.x, z: start.z, heading: start.heading }, vehicle: this.vehicle, name: this.name, color: this.color });
  }

  /** The driver's name and paint as chosen so far, for joining the server before driving off. */
  get profile(): { name: string; color: string } {
    return { name: this.name, color: this.color };
  }

  /** Who is connected; the list shows only when someone else is. */
  setPlayers(players: PlayerLine[]): void {
    this.lines = players;
    fillPlayers(this.players, players, this.index.title, {
      titleOf: (name) => this.regions.find((r) => r.name === name)?.title ?? name,
      join: (id) => this.actions.join(id),
    });
    const show = players.length > 1;
    this.players.style.display = this.playersLabel.style.display = show ? '' : 'none';
    this.countDrivers();
  }

  /** The server's addresses on the network: friends there open one of them to join. */
  setAddresses(addresses: string[]): void {
    this.invite.replaceChildren();
    this.invite.style.display = addresses.length ? '' : 'none';
    if (!addresses.length) return;
    this.invite.append('Friends join at ');
    addresses.forEach((a, i) => {
      if (i) this.invite.append(i === addresses.length - 1 ? ' or ' : ', ');
      const code = document.createElement('code');
      code.textContent = a;
      this.invite.append(code);
    });
  }

  /** The logged-in driver, whose name, logbook, place and settings are kept on the server; null for a guest. */
  setAccount(email: string | null): void {
    this.account.style.display = email ? '' : 'none';
    this.account.textContent = email ? `Signed in as ${email}: your name, logbook, settings and where you left off are kept for you` : '';
  }

  /** How many others drive in each region, on its card. */
  private countDrivers(): void {
    for (const [name, card] of this.regionCards) {
      const n = this.lines.filter((p) => !p.you && p.region === name).length;
      card.detail.textContent = n ? `${card.base} · ${n} ${n === 1 ? 'driver' : 'drivers'} there` : card.base;
    }
  }

  /** Drives off with what is chosen (the Drive button, Enter, or Start on a gamepad). */
  drive(): void {
    const start = this.starts[this.start]!;
    write(START_KEY, start.name);
    this.actions.drive({ start, vehicle: this.vehicle, name: this.name, color: this.color });
  }

  /** The region's map, with the start points marked and the chosen one highlighted. */
  private drawPreview(): void {
    const c = this.preview.getContext('2d')!;
    const css = 240;
    const dpr = Math.min(2, window.devicePixelRatio);
    this.preview.width = this.preview.height = Math.round(css * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#bfc2b6';
    c.fillRect(0, 0, css, css);
    const k = css / this.index.size;
    if (this.picture) c.drawImage(this.picture, 0, 0, css, css);
    else {
      c.fillStyle = '#2f3b33';
      c.font = '18px "Instrument Serif", Georgia, serif';
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
      c.fillStyle = on ? '#c9a44a' : mine ? '#4e6573' : '#2f3b33';
      c.strokeStyle = '#ecebe6';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(s.x * k, s.z * k, on ? 6 : 4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });
  }
}
