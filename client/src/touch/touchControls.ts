// Touch controls for phones and tablets, over the driving: a thumb stick that appears wherever
// the left thumb lands (it steers), two small pedals at the right edge (the higher the finger,
// the more pedal), a handbrake lever over the brake (a double tap when stopped parks, as with the key) and a
// pause button. Along the top right: camera view, back on the wheels, winch and drone. Over the
// pedals, while the winch is in use: hook on, next and cancel while choosing; In and Out (held)
// and unhook while hooked. Dragging anywhere else on the picture looks round, and two fingers
// pinch the camera nearer or further (ChaseCamera). The lamps on the dash and the minimap are
// buttons too (main.ts).
//
// Steering can instead be tilting the phone (Settings, Steering: Tilt; touch/tilt.ts): then the
// stick's corner is free, and a drag there looks round like anywhere else.
//
// With the drone out the stick slides it and climbs, the pedals fly it forward and back, and
// the buttons that belong to the vehicle go away.
//
// Shown when the screen is touched, hidden again when a key or the gamepad is used, unless the
// setting says always or never. One-shot buttons are asked for like the gamepad's, as tapped
// this frame, under the same action names.

import type { PadAction } from '../vehicle/gamepad';
import type { TouchDrive } from '../vehicle/input';
import { knob, pedalValue, stickAxis } from './stick';
import { Tilt } from './tilt';

/** The setting: 0 automatic (shown after a touch, hidden after a key), 1 always, −1 never. */
export type TouchSetting = number;

/** The one-shot buttons: the gamepad's actions, and Next while choosing an anchor. */
export type TouchAction = PadAction | 'winchNext';

/** What is going on, for which buttons show. */
export interface TouchScene {
  /** The drone is being flown. */
  drone: boolean;
  winch: 'idle' | 'choosing' | 'hooked';
}

const ICONS = {
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  right: '<path d="M18.5 9A7.5 7.5 0 1 0 19.5 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19.5 4v5.5H14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  winch: '<path d="M12 3v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 11c-3.5 0-4.5 2.5-4.5 4.5a4.5 4.5 0 0 0 9 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16.5 15.5l1.6-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  drone: '<rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor"/><path d="M10 10 6.5 6.5M14 10l3.5-3.5M10 14l-3.5 3.5M14 14l3.5 3.5" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  handbrake: '<path d="M7 19.5 16.5 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="7" cy="19.5" r="2" fill="currentColor"/><path d="M14.8 8.8 18.2 4" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
};

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

  /** The stick sideways, −1..1 (left positive), null with no thumb on it. */
  private stickSteer: number | null = null;
  private readonly tilt = new Tilt();
  private drone = false;
  throttle = 0;
  brake = 0;
  handbrake = false;
  lift = 0;
  private presses: number[] = [];
  private taps = new Set<TouchAction>();
  private tappedNow = new Set<TouchAction>();
  private readonly holding = new Set<'winchIn' | 'winchOut'>();
  private scene = '';
  /** Every finger on a control, so all can be let go when the controls hide. */
  private readonly releases = new Map<number, () => void>();

  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly brakeLabel: HTMLDivElement;
  private readonly throttleLabel: HTMLDivElement;

  constructor(
    private readonly setting: () => TouchSetting,
    /** 0 the stick steers, 1 tilting the phone. */
    private readonly steering: () => number = () => 0,
  ) {
    this.touching = matchMedia('(pointer: coarse)').matches;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    document.body.append(root);

    // A touch anywhere means touch is in use; a key or the pad (TouchControls.keysUsed) means not.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.touching = true;
    }, { capture: true });
    window.addEventListener('keydown', () => this.keysUsed());
    // Tilt chosen on an earlier visit: the sensor is asked for again at the first tap, since an
    // iPhone only answers that from a tap.
    let tries = 0;
    const retry = (): void => {
      if (this.steering() === 1 && !this.tilt.enabled && tries++ < 2) void this.tilt.enable();
    };
    window.addEventListener('pointerup', retry, { capture: true });
    if (this.steering() === 1) retry();

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
        this.stickSteer = null;
        this.lift = 0;
      },
    });

    // The pedals and the handbrake, at the right edge.
    const pedals = this.el('div', 'pedals');
    const hand = this.el('div', 'handbrake', pedals);
    hand.setAttribute('aria-label', 'Handbrake');
    hand.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22">${ICONS.handbrake}</svg>`;
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
    this.brakeLabel = this.el('div', 'pedal brake', pedals, 'Brake');
    this.throttleLabel = this.el('div', 'pedal throttle', pedals, 'Drive');
    this.pedal(this.brakeLabel, (v) => (this.brake = v));
    this.pedal(this.throttleLabel, (v) => (this.throttle = v));

    // The winch's buttons over the pedals, while choosing an anchor or hooked on.
    const winch = this.el('div', 'winch-row');
    this.button(this.el('button', 'choosing', winch, 'Hook on'), 'winch');
    this.button(this.el('button', 'choosing', winch, 'Next'), 'winchNext');
    this.button(this.el('button', 'choosing', winch, 'Cancel'), 'winchOut');
    this.hold(this.el('button', 'hooked hold', winch, 'In'), 'winchIn');
    this.hold(this.el('button', 'hooked hold', winch, 'Out'), 'winchOut');
    this.button(this.el('button', 'hooked', winch, 'Unhook'), 'winch');

    // Pause in the top left corner; the views, back on the wheels, winch and drone top right.
    this.button(this.icon(root, 'round pause', 'pause', 'Menu and pause'), 'menu');
    const row = this.el('div', 'actions');
    this.button(this.icon(row, 'round vehicle', 'camera', 'Camera: chase, orbit, cab'), 'camera');
    this.button(this.icon(row, 'round vehicle', 'right', 'Back on the wheels'), 'right');
    this.button(this.icon(row, 'round vehicle', 'winch', 'Winch: choose an anchor'), 'winch');
    this.button(this.icon(row, 'round', 'drone', 'Drone: launch, back to driving'), 'drone');

    root.style.display = 'none';
  }

  /** −1..1 (left positive), or null to leave the steering to the keys or the pad. */
  get steer(): number | null {
    return this.tilting && !this.drone ? this.tilt.steer : this.stickSteer;
  }

  /** Steering by tilting the phone now (chosen, and the sensor answered). */
  private get tilting(): boolean {
    return this.steering() === 1 && this.tilt.enabled;
  }

  /**
   * The steering setting was changed (from a tap in Settings, which an iPhone needs before it
   * hands out the sensor): resolves false when tilt was chosen but the sensor was refused.
   */
  steeringChanged(): Promise<boolean> {
    if (this.steering() !== 1) {
      this.tilt.disable();
      return Promise.resolve(true);
    }
    return this.tilt.enable();
  }

  /** A key was pressed or the gamepad used: in automatic mode the touch controls go away. */
  keysUsed(): void {
    this.touching = false;
  }

  /**
   * Once a frame: whether the driving is on screen, and what is going on (which buttons
   * show); collects the taps since the last frame.
   */
  poll(wanted: boolean, scene: TouchScene = { drone: false, winch: 'idle' }): void {
    const s = this.setting();
    this.show(wanted && (s > 0 || (s === 0 && this.touching)));
    this.drone = scene.drone;
    this.root.dataset.steering = this.tilting ? 'tilt' : 'stick';
    const key = `${scene.drone ? 'drone' : 'drive'} ${scene.winch}`;
    if (key !== this.scene) {
      this.scene = key;
      this.root.dataset.mode = scene.drone ? 'drone' : 'drive';
      this.root.dataset.winch = scene.drone ? 'idle' : scene.winch;
      this.throttleLabel.textContent = scene.drone ? 'Forward' : 'Drive';
      this.brakeLabel.textContent = scene.drone ? 'Back' : 'Brake';
      // A hold button that went away is let go of.
      if (scene.winch !== 'hooked') this.holding.clear();
    }
    this.tappedNow = this.taps;
    this.taps = new Set();
  }

  tapped(action: TouchAction): boolean {
    return this.tappedNow.has(action);
  }

  held(action: 'winchIn' | 'winchOut'): boolean {
    return this.holding.has(action);
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
    // Thumb to the left steers left, which is positive; up climbs (the drone).
    this.stickSteer = -stickAxis(dx);
    this.lift = -stickAxis(dy);
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

  /** A button that does something for as long as it is held. */
  private hold(el: HTMLElement, action: 'winchIn' | 'winchOut'): void {
    this.track(el, {
      down: () => {
        this.holding.add(action);
        el.classList.add('on');
      },
      up: () => {
        this.holding.delete(action);
        el.classList.remove('on');
      },
    });
  }

  private icon(parent: HTMLElement, cls: string, icon: keyof typeof ICONS, label: string): HTMLButtonElement {
    const b = this.el('button', cls, parent);
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22">${ICONS[icon]}</svg>`;
    return b;
  }

  private button(el: HTMLElement, action: TouchAction): void {
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
