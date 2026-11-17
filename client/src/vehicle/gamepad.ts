// The gamepad: which button does what, changeable on the Controls page and remembered on
// this computer. Read once a frame; actions are asked for as held, as a value (triggers),
// or as tapped this frame. The sticks are fixed: left steers, right looks around.

export const PAD_ACTIONS = [
  { id: 'throttle', label: 'Drive' },
  { id: 'brake', label: 'Brake and reverse' },
  { id: 'handbrake', label: 'Handbrake' },
  { id: 'right', label: 'Back on the wheels' },
  { id: 'camera', label: 'Camera: chase, orbit, cab' },
  { id: 'lights', label: 'Headlights' },
  { id: 'range', label: 'Low and high range' },
  { id: 'locks', label: 'Differential locks, all axles' },
  { id: 'map', label: 'Map' },
  { id: 'minimap', label: 'Minimap' },
  { id: 'toStart', label: 'Back to the start' },
  { id: 'menu', label: 'Menu and pause' },
] as const;

export type PadAction = (typeof PAD_ACTIONS)[number]['id'];

/** Names of the buttons of a standard-layout pad, by index. */
export const BUTTON_NAMES = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'Left stick', 'Right stick',
  'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home',
];
export const buttonName = (i: number): string => (i < 0 ? '–' : (BUTTON_NAMES[i] ?? `Button ${i}`));

const DEFAULTS: Record<PadAction, number> = {
  throttle: 7, brake: 6, handbrake: 0, right: 3, camera: 2, lights: 1, range: 4, locks: 5,
  map: 8, minimap: 12, toStart: -1, menu: 9,
};

const KEY = 'spar.gamepad';

export class PadControls {
  readonly bindings: Record<PadAction, number> = { ...DEFAULTS };
  /** The pad being read, if one is connected. */
  pad: Gamepad | null = null;
  private was: boolean[] = [];
  private tappedNow = new Set<number>();
  private listener: ((button: number) => void) | null = null;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<PadAction, number>>;
      for (const { id } of PAD_ACTIONS) if (Number.isInteger(saved[id])) this.bindings[id] = saved[id]!;
    } catch {
      // The defaults, then.
    }
  }

  /** Call once a frame, before anything asks. */
  poll(): void {
    this.pad = navigator.getGamepads?.().find((p) => p?.connected && p.mapping === 'standard') ?? null;
    const now = this.pad?.buttons.map((b) => b.pressed) ?? [];
    this.tappedNow.clear();
    now.forEach((down, i) => {
      if (down && !this.was[i]) this.tappedNow.add(i);
    });
    this.was = now;
    // Waiting for a button to bind: the press goes there, not to the game.
    if (this.listener && this.tappedNow.size) {
      const button = [...this.tappedNow][0]!;
      const listener = this.listener;
      this.listener = null;
      this.tappedNow.clear();
      // Its release must not count as anything either.
      listener(button);
    }
  }

  get listening(): boolean {
    return this.listener !== null;
  }

  /** The next button pressed goes to `done` instead of the game; null stops waiting. */
  listen(done: ((button: number) => void) | null): void {
    this.listener = done;
  }

  tapped(action: PadAction): boolean {
    const b = this.bindings[action];
    return b >= 0 && this.tappedNow.has(b);
  }

  held(action: PadAction): boolean {
    const b = this.bindings[action];
    return b >= 0 && !this.listener && (this.pad?.buttons[b]?.pressed ?? false);
  }

  /** 0..1: how far a trigger is pulled, or 1 for a pressed button. */
  value(action: PadAction): number {
    const b = this.bindings[action];
    if (b < 0 || this.listener) return 0;
    const button = this.pad?.buttons[b];
    return button ? Math.max(button.value, button.pressed ? 1 : 0) : 0;
  }

  /** Binds a button to an action; whatever had it before takes this action's old button. */
  bind(action: PadAction, button: number): void {
    const old = this.bindings[action];
    for (const { id } of PAD_ACTIONS) if (id !== action && this.bindings[id] === button) this.bindings[id] = old;
    this.bindings[action] = button;
    this.save();
  }

  reset(): void {
    Object.assign(this.bindings, DEFAULTS);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.bindings));
    } catch {
      // Applies this time only.
    }
  }
}
