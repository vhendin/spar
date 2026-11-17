// The menu (Esc): pauses the game and holds the settings, the controls, the choice of vehicle
// and the way back to the start.

import { CHOICES, NEEDS_RESTART, PERSONAL, PRESET_NAMES, PRESETS, presetOf, type Settings } from '../settings';

export interface MenuActions {
  resume(): void;
  map(): void;
  /** Back to the start screen. */
  mainMenu(): void;
  timeAndWeather(): void;
  resetVehicle(): void;
  toStart(): void;
  credits(): void;
  /** Vehicles to choose from, and the one being driven. */
  vehicles: { name: string; title: string }[];
  vehicle(): string;
  chooseVehicle(name: string): void;
  /** Called after a setting changed; the menu has already updated `settings`. */
  changed(key: keyof Settings): void;
  /** Builds the world again with the settings that need it, keeping the vehicle where it is. */
  restart(): void;
}

const CONTROLS: [string, string][] = [
  ['W / S', 'Drive, brake and reverse'],
  ['A / D', 'Steer'],
  ['Space', 'Handbrake'],
  ['L', 'Low and high range'],
  ['1  2  3', 'Differential locks, per axle'],
  ['H', 'Headlights: automatic, on, off'],
  ['V', 'Camera: chase, orbit, cab'],
  ['Drag, wheel', 'Look around, camera distance'],
  ['R', 'Back on the wheels'],
  ['Shift R', 'Back to the start'],
  ['M', 'Map: choose a destination, or another start point'],
  ['N', 'Minimap: near, far, hidden'],
  ['T', 'Time and weather'],
  ['C', 'Credits'],
  ['Esc', 'Menu and pause'],
  ['Gamepad', 'Sticks steer and look, triggers drive and brake, A handbrake, Y back on the wheels, Start menu, Back map'],
];

export class Menu {
  private page: 'main' | 'settings' | 'controls' = 'main';
  private readonly box: HTMLDivElement;
  /** When a page was opened on its own (from the start screen): where Back goes instead of the main page. */
  private exit: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: MenuActions,
    /** The live settings, changed in place. */
    private readonly settings: Settings,
    /** The settings the world was built with. */
    private readonly built: Settings,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'box';
    root.replaceChildren(this.box);
    // Clicking beside the box resumes, like Esc.
    root.addEventListener('click', (e) => {
      if (e.target === root) this.actions.resume();
    });
  }

  get open(): boolean {
    return this.root.style.display === 'flex';
  }

  /** Opens the settings or the controls by themselves; Back calls `exit`. */
  showPage(page: 'settings' | 'controls', exit: () => void): void {
    this.exit = exit;
    this.page = page;
    this.render();
    this.root.style.display = 'flex';
  }

  /** Leaves a page opened by itself, if that is what is showing. Returns true if it did. */
  private leave(): boolean {
    const exit = this.exit;
    if (!exit) return false;
    this.exit = null;
    this.hide();
    exit();
    return true;
  }

  show(): void {
    this.exit = null;
    this.page = 'main';
    this.render();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** Esc: back out of a sub-page, or close. Returns true when the menu closed. */
  back(): boolean {
    if (this.leave()) return false;
    if (this.page !== 'main') {
      this.page = 'main';
      this.render();
      return false;
    }
    return true;
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
    const button = (text: string, onClick: () => void, parent: HTMLElement = box, cls = ''): HTMLButtonElement => {
      const b = add('button', text, parent, cls);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    const go = (page: typeof this.page): void => {
      if (page === 'main' && this.leave()) return;
      this.page = page;
      this.render();
    };

    if (this.page === 'main') {
      add('h1', 'Spår');
      add('p', 'Paused', box, 'sub');
      const list = add('div', '', box, 'list');
      button('Resume', () => this.actions.resume(), list, 'primary');
      button('Map', () => this.actions.map(), list);
      button('Time and weather', () => this.actions.timeAndWeather(), list);
      button('Settings', () => go('settings'), list);
      button('Controls', () => go('controls'), list);
      if (this.actions.vehicles.length > 1) {
        add('div', 'Vehicle', box, 'label');
        const row = add('div', '', box, 'row');
        for (const v of this.actions.vehicles) {
          button(v.title, () => this.actions.chooseVehicle(v.name), row, v.name === this.actions.vehicle() ? 'on' : '');
        }
      }
      add('div', 'Stuck?', box, 'label');
      const row = add('div', '', box, 'row');
      button('Back on the wheels', () => this.actions.resetVehicle(), row);
      button('Back to the start', () => this.actions.toStart(), row);
      const foot = add('div', '', box, 'foot');
      button('Main menu', () => this.actions.mainMenu(), foot, 'link');
      add('span', ' · ', foot, 'note');
      button('Credits', () => this.actions.credits(), foot, 'link');
      return;
    }

    if (this.page === 'controls') {
      add('h2', 'Controls');
      const table = add('table', '', box, 'keys');
      for (const [key, what] of CONTROLS) {
        const tr = add('tr', '', table);
        add('td', key, tr, 'key');
        add('td', what, tr);
      }
      button('Back', () => go('main'), box, 'back');
      return;
    }

    // Settings.
    add('h2', 'Graphics');
    const s = this.settings;
    add('div', 'Preset', box, 'label');
    const presets = add('div', '', box, 'row');
    const current = presetOf(s);
    for (const name of PRESET_NAMES) {
      button(name[0]!.toUpperCase() + name.slice(1), () => {
        const keep = Object.fromEntries(PERSONAL.map((k) => [k, s[k]]));
        Object.assign(s, PRESETS[name], keep);
        for (const k of Object.keys(s) as (keyof Settings)[]) this.actions.changed(k);
        this.render();
      }, presets, current === name ? 'on' : '');
    }
    if (!current) add('span', 'Custom', presets, 'note');

    for (const key of Object.keys(CHOICES) as (keyof Settings)[]) {
      const choice = CHOICES[key];
      if (key === 'volume') add('h2', 'Sound');
      add('div', choice.label + (NEEDS_RESTART.includes(key) ? ' *' : ''), box, 'label');
      const row = add('div', '', box, 'row');
      // A value set elsewhere (an old preset, say) shows as the nearest choice.
      const nearest = choice.options.reduce((a, b) => (Math.abs(b[1] - s[key]) < Math.abs(a[1] - s[key]) ? b : a));
      for (const [label, value] of choice.options) {
        button(label, () => {
          s[key] = value;
          this.actions.changed(key);
          this.render();
        }, row, nearest[1] === value ? 'on' : '');
      }
    }

    const pending = NEEDS_RESTART.some((k) => s[k] !== this.built[k]);
    add('p', pending ? '* Takes effect when the world is rebuilt. The vehicle stays where it is, but knocked-down trees stand up again.' : '* Takes effect when the world is rebuilt.', box, 'hint');
    const foot = add('div', '', box, 'row');
    button('Back', () => go('main'), foot, 'back');
    if (pending) button('Rebuild now', () => this.actions.restart(), foot, 'primary');
  }
}
