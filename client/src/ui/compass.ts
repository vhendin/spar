// The compass along the top of the screen: a strip of the directions round the way the camera
// looks, turning as it turns, with the destinations marked on it (gold for the driver's own,
// blue for the shared one) by a dot with the name and distance under it, pinned to the edge
// when they are behind.

import { formatDistance } from './map';

/** Degrees of the horizon the strip shows across its width. */
const SPAN = 150;
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export interface CompassMark {
  x: number;
  z: number;
  name: string;
  /** The guide's colour, as CSS. */
  color: string;
}

/** Degrees from north, clockwise (90 east), of the way from one point to another; z runs south. */
export function bearing(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return ((Math.atan2(toX - fromX, -(toZ - fromZ)) * 180) / Math.PI + 360) % 360;
}

/** `angle` less `heading`, as -180..180: where on the strip it sits, in degrees from the middle. */
export function offset(angle: number, heading: number): number {
  return ((((angle - heading) % 360) + 540) % 360) - 180;
}

export class Compass {
  private readonly el: HTMLDivElement;
  private readonly tape: HTMLDivElement;
  private readonly marks: { dot: HTMLSpanElement; label: HTMLSpanElement }[] = [];
  private width = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'compass';
    // The strip fades out at its ends; the labels hang below it, unfaded.
    const strip = document.createElement('div');
    strip.className = 'strip';
    this.tape = document.createElement('div');
    this.tape.className = 'tape';
    const pointer = document.createElement('div');
    pointer.className = 'pointer';
    strip.append(this.tape, pointer);
    this.el.append(strip);
    parent.append(this.el);
    // Three turns of tape, so any heading has a full strip either side.
    for (let deg = -360; deg < 720; deg += 15) {
      const at = ((deg % 360) + 360) % 360;
      const tick = document.createElement('span');
      const point = at % 45 === 0;
      tick.className = point ? 'tick point' : 'tick';
      tick.dataset.deg = String(deg);
      if (point) {
        const name = POINTS[at / 45]!;
        tick.textContent = name;
        if (name === 'N') tick.classList.add('north');
      }
      this.tape.append(tick);
    }
    this.el.style.display = 'none';
  }

  /** `heading`: degrees the camera looks, 0 north, 90 east. `from`: where the driver is. */
  update(show: boolean, heading: number, from: { x: number; z: number }, marks: CompassMark[]): void {
    this.el.style.display = show ? '' : 'none';
    if (!show) return;
    const width = this.el.clientWidth;
    if (width !== this.width) this.layout(width);
    const perDeg = width / SPAN;
    this.tape.style.transform = `translateX(${(width / 2 - heading * perDeg).toFixed(1)}px)`;
    while (this.marks.length < marks.length) {
      const dot = document.createElement('span');
      dot.className = 'mark';
      const label = document.createElement('span');
      label.className = 'mark-label';
      this.el.append(dot, label);
      this.marks.push({ dot, label });
    }
    const placed: { left: number; right: number; row: number }[] = [];
    this.marks.forEach(({ dot, label }, i) => {
      const mark = marks[i];
      dot.style.display = label.style.display = mark ? '' : 'none';
      if (!mark) return;
      const off = offset(bearing(from.x, from.z, mark.x, mark.z), heading);
      const edge = Math.abs(off) > SPAN / 2 - 4;
      const x = width / 2 + Math.max(-SPAN / 2 + 4, Math.min(SPAN / 2 - 4, off)) * perDeg;
      dot.style.left = `${x.toFixed(1)}px`;
      dot.style.background = mark.color;
      const text = `${mark.name} · ${formatDistance(Math.hypot(mark.x - from.x, mark.z - from.z))}`;
      if (label.textContent !== text) label.textContent = text;
      label.style.borderColor = mark.color;
      // Kept inside the strip's width, and under the one before when they would overlap.
      const w = label.offsetWidth;
      const left = Math.max(0, Math.min(width - w, x - w / 2));
      let row = 0;
      while (placed.some((p) => p.row === row && left < p.right + 6 && left + w > p.left - 6)) row++;
      placed.push({ left, right: left + w, row });
      label.style.left = `${left.toFixed(1)}px`;
      label.style.top = `${40 + row * 24}px`;
      dot.classList.toggle('edge', edge);
      label.classList.toggle('edge', edge);
    });
  }

  private layout(width: number): void {
    this.width = width;
    const perDeg = width / SPAN;
    for (const tick of this.tape.children as HTMLCollectionOf<HTMLSpanElement>) tick.style.left = `${(Number(tick.dataset.deg) * perDeg).toFixed(1)}px`;
  }
}
