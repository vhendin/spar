// The compass along the top of the screen: a strip of the directions round the way the camera
// looks, turning as it turns, with the destinations marked on it (gold for the driver's own,
// blue for the shared one), pinned to the edge when they are behind.

/** Degrees of the horizon the strip shows across its width. */
const SPAN = 150;
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export interface CompassMark {
  x: number;
  z: number;
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
  private readonly marks: HTMLSpanElement[] = [];
  private width = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'compass';
    this.tape = document.createElement('div');
    this.tape.className = 'tape';
    const pointer = document.createElement('div');
    pointer.className = 'pointer';
    this.el.append(this.tape, pointer);
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
      const m = document.createElement('span');
      m.className = 'mark';
      this.el.append(m);
      this.marks.push(m);
    }
    this.marks.forEach((m, i) => {
      const mark = marks[i];
      m.style.display = mark ? '' : 'none';
      if (!mark) return;
      const off = offset(bearing(from.x, from.z, mark.x, mark.z), heading);
      const edge = Math.abs(off) > SPAN / 2 - 4;
      const at = Math.max(-SPAN / 2 + 4, Math.min(SPAN / 2 - 4, off));
      m.style.left = `${(width / 2 + at * perDeg).toFixed(1)}px`;
      m.style.background = mark.color;
      m.classList.toggle('edge', edge);
    });
  }

  private layout(width: number): void {
    this.width = width;
    const perDeg = width / SPAN;
    for (const tick of this.tape.children as HTMLCollectionOf<HTMLSpanElement>) tick.style.left = `${(Number(tick.dataset.deg) * perDeg).toFixed(1)}px`;
  }
}
