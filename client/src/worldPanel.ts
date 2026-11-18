// The panel for the time of day, the speed of the clock and the weather (T). The server owns
// all three, so the panel only asks; what everyone sees changes when the server answers.

import type { ClientMessage } from '@spar/shared';
import type { Environment } from './sky/environment';

type SetWorld = Extract<ClientMessage, { type: 'set_world' }>;

const SPEEDS: [label: string, dayMinutes: number][] = [
  ['Stopped', 0],
  ['Day in 10 min', 10],
  ['Day in 30 min', 30],
  ['Day in 2 h', 120],
  ['Real time', 1440],
];
const WEATHERS: [label: string, value: NonNullable<SetWorld['weather']>][] = [
  ['Changing', 'auto'],
  ['Clear', 'clear'],
  ['Overcast', 'overcast'],
  ['Rain', 'rain'],
];

/** Quick jumps to the middle of each season in these fells; the year itself is unchanged. */
const SEASONS: [label: string, day: number][] = [
  ['Winter', 46],
  ['Spring', 158],
  ['Summer', 196],
  ['Autumn', 258],
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "15 Sep" for a day of the year (1 is 1 January, in a year that is not a leap year). */
const dateText = (day: number): string => {
  const d = new Date(Date.UTC(2025, 0, Math.floor(day)));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

const clockText = (hour: number): string => {
  const minutes = Math.round(hour * 60) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

export class WorldPanel {
  private readonly slider: HTMLInputElement;
  private readonly hourLabel: HTMLSpanElement;
  private readonly daySlider: HTMLInputElement;
  private readonly dayLabel: HTMLSpanElement;
  private dragging = false;
  private readonly note: HTMLParagraphElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly weatherButtons: HTMLButtonElement[] = [];
  /** The weather last asked for here; the server does not say whether it is held. */
  private weather: SetWorld['weather'] = 'auto';
  private sliding = false;
  private sentAt = 0;
  private queued: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly send: (msg: SetWorld) => void,
  ) {
    root.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = 'Time and weather';
    const row = (name: string): HTMLDivElement => {
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = name;
      const div = document.createElement('div');
      div.className = 'row';
      root.append(label, div);
      return div;
    };
    root.append(title);

    const time = row('Time of day');
    this.slider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '24', step: '0.25' });
    this.hourLabel = document.createElement('span');
    this.hourLabel.className = 'value';
    time.append(this.slider, this.hourLabel);
    this.slider.addEventListener('pointerdown', () => (this.sliding = true));
    this.slider.addEventListener('input', () => {
      this.hourLabel.textContent = clockText(Number(this.slider.value));
      this.askHour(Number(this.slider.value));
    });
    this.slider.addEventListener('change', () => {
      this.sliding = false;
      this.askHour(Number(this.slider.value), true);
      this.slider.blur();
    });

    const date = row('Time of year');
    this.daySlider = Object.assign(document.createElement('input'), { type: 'range', min: '1', max: '365', step: '1' });
    this.dayLabel = document.createElement('span');
    this.dayLabel.className = 'value';
    date.append(this.daySlider, this.dayLabel);
    this.daySlider.addEventListener('pointerdown', () => (this.dragging = true));
    this.daySlider.addEventListener('input', () => (this.dayLabel.textContent = dateText(Number(this.daySlider.value))));
    // Sent on letting go: every new day recolours the plants.
    this.daySlider.addEventListener('change', () => {
      this.dragging = false;
      this.send({ type: 'set_world', day: Number(this.daySlider.value) });
      this.daySlider.blur();
    });
    const seasons = row('');
    for (const [label, day] of SEASONS) seasons.append(this.button(label, () => this.send({ type: 'set_world', day })));

    const speed = row('Clock');
    for (const [label, dayMinutes] of SPEEDS) {
      const b = this.button(label, () => this.send({ type: 'set_world', dayMinutes }));
      b.dataset.minutes = String(dayMinutes);
      this.speedButtons.push(b);
      speed.append(b);
    }

    const weather = row('Weather');
    for (const [label, value] of WEATHERS) {
      const b = this.button(label, () => {
        this.weather = value;
        this.send({ type: 'set_world', weather: value });
      });
      b.dataset.weather = value;
      this.weatherButtons.push(b);
      weather.append(b);
    }

    this.note = document.createElement('p');
    this.note.className = 'hint';
    root.append(this.note);
    // Keys typed in the panel must not drive the vehicle; T and Escape still close it.
    root.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyT' && e.code !== 'Escape') e.stopPropagation();
    });
  }

  get open(): boolean {
    return this.root.style.display === 'block';
  }

  toggle(): void {
    this.root.style.display = this.open ? 'none' : 'block';
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** Moves the clock by whole hours, for the [ and ] keys. */
  nudge(env: Environment, hours: number): void {
    this.send({ type: 'set_world', hour: (((env.localHour() + hours) % 24) + 24) % 24 });
  }

  /** Call now and then (a few times a second) to show what the server says. */
  refresh(env: Environment): void {
    if (!this.open) return;
    const hour = env.localHour();
    if (!this.sliding) {
      this.slider.value = String(hour);
      this.hourLabel.textContent = clockText(hour);
    }
    if (!this.dragging) {
      const day = Math.floor(env.dayOfYear());
      this.daySlider.value = String(day);
      this.dayLabel.textContent = dateText(day);
    }
    const dayMinutes = env.rate > 0 ? 1440 / env.rate : 0;
    for (const b of this.speedButtons) b.classList.toggle('on', Math.abs(Number(b.dataset.minutes) - dayMinutes) < 0.5);
    for (const b of this.weatherButtons) {
      const value = b.dataset.weather;
      b.classList.toggle('on', value === this.weather || (this.weather === 'auto' && value === env.weather.state));
      b.classList.toggle('dim', this.weather === 'auto' && value !== 'auto');
    }
    this.note.textContent = env.frozen
      ? 'The URL (?time= or ?weather=) holds this view still, so changes here do not show on this screen.'
      : 'Changes reach every player. T or Esc closes, [ and ] move the clock an hour.';
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      onClick();
      // Otherwise Space, the handbrake, would press the button again.
      b.blur();
    });
    return b;
  }

  /** Sends the slider's hour, at most every tenth of a second while it is being dragged. */
  private askHour(hour: number, now = false): void {
    const t = performance.now();
    if (!now && t - this.sentAt < 100) {
      if (this.queued === null) setTimeout(() => this.queued !== null && this.askHour(this.queued, true), 100);
      this.queued = hour;
      return;
    }
    this.queued = null;
    this.sentAt = t;
    this.send({ type: 'set_world', hour: hour % 24 });
  }
}
