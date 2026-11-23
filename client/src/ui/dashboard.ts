// The driver's instruments: rev counter (a power meter for electric motors) with the gear or
// the direction in the middle, speedometer, a row of
// lamps for the range, the differential locks, the headlights and the parking brake, and while
// the winch is hooked on, its pull and the cable out.
// Drawn once as SVG; each frame only turns the needles and switches lamps.

import { engineTorque, isElectric, peakPower, type VehicleDef } from '@spar/shared';
import type { VehicleSim } from '../vehicle/sim';

const NS = 'http://www.w3.org/2000/svg';
/** Needles sweep from 225° (lower left) clockwise through 270°. */
const START = -225;
const SWEEP = 270;
const R = 70;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const polar = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
};

/** An arc path along the dial from fraction `a` to `b` of the sweep. */
function arc(a: number, b: number, r: number): string {
  const [x0, y0] = polar(START + a * SWEEP, r);
  const [x1, y1] = polar(START + b * SWEEP, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${(b - a) * SWEEP > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** A dial face with ticks and numbers; returns the needle to turn. */
function dial(svg: SVGSVGElement, cx: number, max: number, step: number, minor: number, label: (v: number) => string, red?: number): SVGGElement {
  const g = el('g', { transform: `translate(${cx} 90)` }, svg);
  el('circle', { r: R + 10, class: 'face' }, g);
  if (red !== undefined) el('path', { d: arc(red / max, 1, R - 3), class: 'redline' }, g);
  for (let v = 0; v <= max + 1e-6; v += minor) {
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const deg = START + (v / max) * SWEEP;
    const [x0, y0] = polar(deg, R);
    const [x1, y1] = polar(deg, R - (major ? 11 : 6));
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: major ? 'tick major' : 'tick' }, g);
    if (major) {
      const [tx, ty] = polar(deg, R - 22);
      el('text', { x: tx, y: ty, class: 'num' }, g).textContent = label(v);
    }
  }
  const needle = el('g', {}, g);
  el('path', { d: `M -3 6 L 0 ${-(R - 4)} L 3 6 Z`, class: 'needle' }, needle);
  el('circle', { r: 6, class: 'hub' }, g);
  return needle;
}

/** The fastest the gearing allows at the redline, rounded up to a tidy dial in km/h. */
function dialTop(def: VehicleDef): number {
  const d = def.drivetrain;
  const ratio = d.gears[d.gears.length - 1]! * d.finalDrive * Math.min(...Object.values(d.ranges));
  const kmh = (d.redline / ratio) * 2 * Math.PI * def.wheels.radius * 0.06;
  return Math.min(240, Math.max(60, Math.ceil(kmh / 20) * 20));
}

export interface Lamps {
  /** Headlights lit. */
  lights: boolean;
  /** Lights follow the daylight by themselves. */
  autoLights: boolean;
  /** Parking brake held, by the driver or because the vehicle stands still. */
  parked: boolean;
}

/** The winch while hooked on, for its gauge. */
export interface WinchGauge {
  /** Pull as a share of what the winch can manage. */
  load: number;
  /** Newtons, and metres of cable out. */
  tension: number;
  length: number;
}

export class Dashboard {
  readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private tach!: SVGGElement;
  private speedo!: SVGGElement;
  private gear!: SVGTextElement;
  private range!: SVGTextElement;
  private speed!: SVGTextElement;
  private lamps: { range: HTMLSpanElement; crawl: HTMLSpanElement; ride: HTMLSpanElement; locks: HTMLSpanElement[]; lights: HTMLSpanElement; parked: HTMLSpanElement } | null = null;
  private def: VehicleDef | null = null;
  private tachMax = 5000;
  /** Electric: the left dial shows the power drawn, kW, up to this. */
  private powerMax = 0;
  private speedMax = 100;
  /** Eased needle positions, as fractions of the sweep. */
  private rpmShown = 0;
  private speedShown = 0;
  private loadShown = 0;
  private readonly winch: { root: HTMLDivElement; fill: HTMLDivElement; text: HTMLSpanElement };

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'dash';
    this.svg = el('svg', { viewBox: '0 0 360 180', class: 'dials' });
    this.root.append(this.svg);
    const winch = document.createElement('div');
    winch.className = 'winch';
    winch.innerHTML = '<span class="label">WINCH</span><div class="bar"><div class="fill"></div></div><span class="value"></span>';
    winch.style.display = 'none';
    this.winch = { root: winch, fill: winch.querySelector('.fill')!, text: winch.querySelector('.value')! };
    this.root.append(winch);
    parent.append(this.root);
  }

  /** Draws the faces for a vehicle; again whenever the vehicle changes. */
  private build(def: VehicleDef): void {
    this.def = def;
    this.svg.replaceChildren();
    const d = def.drivetrain;
    this.tachMax = Math.ceil((d.redline + 200) / 1000) * 1000;
    this.speedMax = dialTop(def);

    this.powerMax = isElectric(def) ? Math.ceil(peakPower(d.torqueCurve) / 100_000) * 100 : 0;
    if (this.powerMax > 0) {
      this.tach = dial(this.svg, 90, this.powerMax, 100, 50, (v) => String(v));
      el('text', { x: 90, y: 136, class: 'unit' }, this.svg).textContent = 'kW';
    } else {
      this.tach = dial(this.svg, 90, this.tachMax, 1000, 250, (v) => String(v / 1000), d.redline);
      el('text', { x: 90, y: 136, class: 'unit' }, this.svg).textContent = '×1000 rpm';
    }
    this.gear = el('text', { x: 90, y: 104, class: 'gear' }, this.svg);
    this.range = el('text', { x: 90, y: 62, class: 'range' }, this.svg);

    const step = this.speedMax > 100 ? 20 : 10;
    this.speedo = dial(this.svg, 270, this.speedMax, step, step / 2, (v) => String(v));
    this.speed = el('text', { x: 270, y: 132, class: 'digits' }, this.svg);
    el('text', { x: 270, y: 148, class: 'unit' }, this.svg).textContent = 'km/h';
    // The hub sits over the needle's foot; the digits sit under the hub, out of its way.

    this.lamps?.range.parentElement?.remove();
    const row = document.createElement('div');
    row.className = 'lamps';
    const lamp = (text: string, title: string): HTMLSpanElement => {
      const s = document.createElement('span');
      s.textContent = text;
      s.title = title;
      row.append(s);
      return s;
    };
    const range = lamp('LOW', 'Low range (L)');
    if (d.ranges.low === undefined) range.style.display = 'none';
    const crawl = lamp('CRAWL', 'Crawl control in low range (X; Shift+X off)');
    if (!d.crawl) crawl.style.display = 'none';
    const ride = lamp('AIR', 'Air suspension height (Z higher; Shift+Z lower)');
    if (!def.chassis.airSuspension) ride.style.display = 'none';
    const locks = def.axles.map((axle, a) => (axle.differential === 'lockable' ? lamp(`DIFF ${a + 1}`, `Differential lock, axle ${a + 1} (${a + 1})`) : null)).filter((s): s is HTMLSpanElement => s !== null);
    const lights = lamp('LIGHTS', 'Headlights (H)');
    const parked = lamp('P', 'Parking brake');
    parked.classList.add('brake');
    this.lamps = { range, crawl, ride, locks, lights, parked };
    this.winch.root.before(row);
  }

  update(dt: number, sim: VehicleSim, lamps: Lamps, winch: WinchGauge | null = null): void {
    if (this.def !== sim.def) this.build(sim.def);
    const d = sim.drivetrain;
    const kmh = Math.abs(sim.speed) * 3.6;
    // A light ease, so the needles move like needles rather than jitter with every bump.
    const k = 1 - Math.exp(-dt * 14);
    // Power drawn: full-throttle torque at this speed, times the pedal.
    const kw = this.powerMax > 0 && d.shifting <= 0 && !sim.drowned ? (engineTorque(sim.def.drivetrain.torqueCurve, d.rpm) * sim.pedal * d.rpm) / 9549 : 0;
    const needle = this.powerMax > 0 ? kw / this.powerMax : d.rpm / this.tachMax;
    this.rpmShown += (Math.min(1, needle) - this.rpmShown) * k;
    this.speedShown += (Math.min(1, kmh / this.speedMax) - this.speedShown) * k;
    this.tach.setAttribute('transform', `rotate(${(START + 90 + this.rpmShown * SWEEP).toFixed(2)})`);
    this.speedo.setAttribute('transform', `rotate(${(START + 90 + this.speedShown * SWEEP).toFixed(2)})`);

    const gear = d.gear < 0 ? 'R' : this.powerMax > 0 ? 'D' : String(d.gear);
    if (this.gear.textContent !== gear) this.gear.textContent = gear;
    this.gear.classList.toggle('shifting', d.shifting > 0);
    this.range.textContent = d.range === 'low' ? 'LOW' : '';
    const digits = kmh.toFixed(0);
    if (this.speed.textContent !== digits) this.speed.textContent = digits;

    const l = this.lamps!;
    l.range.classList.toggle('on', d.range === 'low');
    const speeds = sim.def.drivetrain.crawl;
    const crawl = sim.crawl > 0 && speeds ? `CRAWL ${speeds[sim.crawl - 1]} km/h` : 'CRAWL';
    if (l.crawl.textContent !== crawl) l.crawl.textContent = crawl;
    l.crawl.classList.toggle('on', sim.crawl > 0);
    const air = sim.def.chassis.airSuspension;
    if (air) {
      // The level's name, with an arrow while the body is still on its way there.
      const level = air.levels[sim.ride]!;
      const off = level.clearance - sim.def.chassis.groundClearance - sim.lift;
      const ride = `AIR ${level.name.toUpperCase()}${off > 0.005 ? ' ▲' : off < -0.005 ? ' ▼' : ''}`;
      if (l.ride.textContent !== ride) l.ride.textContent = ride;
      l.ride.classList.toggle('on', sim.ride !== air.normal);
    }
    let i = 0;
    sim.def.axles.forEach((axle, a) => {
      if (axle.differential === 'lockable') l.locks[i++]!.classList.toggle('on', sim.locks[a]!);
    });
    l.lights.classList.toggle('on', lamps.lights);
    l.lights.textContent = lamps.autoLights ? 'LIGHTS A' : 'LIGHTS';
    l.parked.classList.toggle('on', lamps.parked);

    const g = this.winch;
    g.root.style.display = winch ? '' : 'none';
    if (winch) {
      this.loadShown += (Math.min(1.1, winch.load) - this.loadShown) * (1 - Math.exp(-dt * 8));
      g.fill.style.width = `${(Math.min(1, this.loadShown) * 100).toFixed(1)}%`;
      g.root.classList.toggle('stall', this.loadShown > 0.92);
      const text = `${(winch.tension / 9810).toFixed(1)} t · ${winch.length.toFixed(0)} m`;
      if (g.text.textContent !== text) g.text.textContent = text;
    } else this.loadShown = 0;
  }

  set visible(on: boolean) {
    this.root.style.display = on ? '' : 'none';
  }
}
