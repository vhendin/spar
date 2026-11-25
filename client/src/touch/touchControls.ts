// Touch controls for phones and tablets, over the driving: a thumb stick that appears wherever
// the left thumb lands (it steers), pedals at the right edge (the higher the finger, the more
// pedal), a handbrake beside them (a double tap when stopped parks, as with the key) and a
// pause button. Dragging anywhere else on the picture looks round, and two fingers pinch the
// camera nearer or further (ChaseCamera).
//
// Shown when the screen is touched, hidden again when a key or the gamepad is used, unless the
// setting says always or never. One-shot buttons are asked for like the gamepad's, as tapped
// this frame, under the same action names.

import type { PadAction } from '../vehicle/gamepad';
import type { TouchDrive } from '../vehicle/input';
import { knob, pedalValue, stickAxis } from './stick';

/** The setting: 0 automatic (shown after a touch, hidden after a key), 1 always, −1 never. */
export type TouchSetting = number;

interface Track {
  down(e: PointerEvent): void;
  move?(e: PointerEvent): void;
  up?(): void;
}

export class TouchControls implements TouchDrive {
  readonly root: HTMLDivElement;
  /** Touch is what is driving (automatic mode): set by a touch, cleared by a key or the pad. */
  private touching: boolean;
  /** Whether the game has the driving on screen (not paused, no menu or map). */
  shown = false;

  steer: number | null = null;
  throttle = 0;
  brake = 0;
  handbrake = false;
  private presses: number[] = [];
  private taps = new Set<PadAction>();
  private tappedNow = new Set<PadAction>();
  /** Every finger on a control, so all can be let go when the controls hide. */
  private readonly releases = new Map<number, () => void>();

  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;

  constructor(private readonly setting: () => TouchSetting) {
    this.touching = matchMedia('(pointer: coarse)').matches;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    document.body.append(root);

    // A touch anywhere means touch is in use; a key or the pad (TouchControls.keysUsed) means not.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.touching = true;
    }, { capture: true });
    window.addEventListener('keydown', () => this.keysUsed());

    // The stick: an area over the lower left where the thumb lands.
    const zone = this.el('div', 'stick-zone');
    this.stickBase = this.el('div', 'stick', zone);
    this.stickKnob = this.el('div', 'knob', this.stickBase);
    let x0 = 0, y0 = 0;
    this.track(zone, {
      down: (e) => {
        const r = zone.getBoundingClientRect();
        x0 = e.clientX;
        y0 = e.clientY;
        this.stickBase.style.left = `${x0 - r.left}px`;
        this.stickBase.style.top = `${y0 - r.top}px`;
        this.stickBase.classList.add('on');
        this.stickMoved(0, 0);
      },
      move: (e) => this.stickMoved(e.clientX - x0, e.clientY - y0),
      up: () => {
        this.stickBase.classList.remove('on');
        this.stickKnob.style.transform = '';
        this.steer = null;
      },
    });

    // The pedals and the handbrake, at the right edge.
    const pedals = this.el('div', 'pedals');
    const hand = this.el('div', 'handbrake', pedals, 'Handbrake');
    this.track(hand, {
      down: (e) => {
        this.handbrake = true;
        this.presses.push(e.timeStamp);
        hand.classList.add('on');
      },
      up: () => {
        this.handbrake = false;
        hand.classList.remove('on');
      },
    });
    this.pedal(this.el('div', 'pedal brake', pedals, 'Brake'), (v) => (this.brake = v));
    this.pedal(this.el('div', 'pedal throttle', pedals, 'Drive'), (v) => (this.throttle = v));

    // Pause, in the top left corner.
    const pause = this.el('button', 'round pause', root);
    pause.setAttribute('aria-label', 'Menu and pause');
    pause.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    this.button(pause, 'menu');

    root.style.display = 'none';
  }

  /** A key was pressed or the gamepad used: in automatic mode the touch controls go away. */
  keysUsed(): void {
    this.touching = false;
  }

  /** Once a frame: whether the driving is on screen; collects the taps since the last frame. */
  poll(wanted: boolean): void {
    const s = this.setting();
    this.show(wanted && (s > 0 || (s === 0 && this.touching)));
    this.tappedNow = this.taps;
    this.taps = new Set();
  }

  tapped(action: PadAction): boolean {
    return this.tappedNow.has(action);
  }

  /** Handbrake presses since the last call, as event times (ms), for the double tap that parks. */
  takeHandbrakePresses(): number[] {
    const p = this.presses;
    this.presses = [];
    return p;
  }

  /** Whether the touch controls would show while driving (for the words on screen). */
  get inUse(): boolean {
    const s = this.setting();
    return s > 0 || (s === 0 && this.touching);
  }

  private show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.root.style.display = on ? '' : 'none';
    document.body.classList.toggle('touch', on);
    if (!on) {
      // Fingers still down when the menu or map opens are let go of.
      for (const release of [...this.releases.values()]) release();
      this.releases.clear();
      this.presses = [];
    }
  }

  private stickMoved(dx: number, dy: number): void {
    const [kx, ky] = knob(dx, dy);
    this.stickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    // Thumb to the left steers left, which is positive.
    this.steer = -stickAxis(dx);
  }

  private pedal(el: HTMLElement, set: (v: number) => void): void {
    const press = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      set(pedalValue(r.bottom - e.clientY, r.height));
    };
    this.track(el, {
      down: (e) => {
        el.classList.add('on');
        press(e);
      },
      move: press,
      up: () => {
        el.classList.remove('on');
        set(0);
      },
    });
  }

  private button(el: HTMLElement, action: PadAction): void {
    this.track(el, {
      down: () => {
        this.taps.add(action);
        el.classList.add('on');
      },
      up: () => el.classList.remove('on'),
    });
  }

  /**
   * Follows one finger on a control from down to up. The finger stays with the control even
   * when it slides off, other fingers work other controls at the same time, and none of it
   * reaches the picture underneath (where a drag looks round).
   */
  private track(el: HTMLElement, t: Track): void {
    let id: number | null = null;
    const end = (): void => {
      if (id === null) return;
      this.releases.delete(id);
      id = null;
      t.up?.();
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (id !== null || !this.shown) return;
      id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      this.releases.set(id, end);
      t.down(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) t.move?.(e);
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerId === id) end();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement = this.root, text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    parent.append(e);
    return e;
  }
}
