// Trips: from choosing a destination to arriving there, the time spent driving and the
// distance covered; and the logbook of every arrival, kept in this browser.

import type { SeasonState } from '@spar/shared';
import type { Destination } from './ui/map';

export interface LogEntry {
  region: string;
  destination: string;
  /** What kind of place: peak, hut, shelter, viewpoint, lodge, camp, sight; absent for places and marked spots. */
  kind?: string;
  /** The vehicle's title, as the player saw it. */
  vehicle: string;
  /** In-game date ("14 Mar") and season ("winter") on arrival. */
  date: string;
  season: string;
  /** Driving time (paused time left out), seconds; and distance covered, metres. */
  seconds: number;
  metres: number;
  /** Real time of arrival, milliseconds since 1970. */
  at: number;
  /** Other drivers who arrived at the same place within a minute of this arrival. */
  with?: string[];
}

/** Arrivals at the same place this close in time count as arriving together. */
export const TOGETHER_MS = 60_000;

interface Trip {
  name: string;
  kind?: string;
  x: number;
  z: number;
  seconds: number;
  metres: number;
  /** Moved by a jump (start point, back to the start): it still guides, but is not logged. */
  jumped: boolean;
}

const LOG_KEY = 'spar.logbook';
const TRIP_KEY = 'spar.trip';
/** Most entries kept; the oldest go first. */
const LOG_MAX = 500;

/** Storage that may be missing or refuse (private windows, blocked site data). */
function load<T>(storage: () => Storage, key: string): T | null {
  try {
    const text = storage().getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function save(storage: () => Storage, key: string, value: unknown): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // Not kept: the game goes on without it.
  }
}

export class Trips {
  readonly entries: LogEntry[];
  private trip: Trip | null;
  private savedAt = 0;

  constructor() {
    this.entries = load<LogEntry[]>(() => localStorage, LOG_KEY) ?? [];
    // A trip under way survives a rebuild of the world, as the destination does.
    this.trip = load<Trip>(() => sessionStorage, TRIP_KEY);
  }

  /** A new destination (or none): the clock starts again. */
  begin(d: Destination | null): void {
    this.trip = d ? { name: d.name, ...(d.kind ? { kind: d.kind } : {}), x: d.x, z: d.z, seconds: 0, metres: 0, jumped: false } : null;
    save(() => sessionStorage, TRIP_KEY, this.trip);
  }

  /** The vehicle was put down somewhere else: this trip no longer counts. */
  jumped(): void {
    if (!this.trip || this.trip.jumped) return;
    this.trip.jumped = true;
    save(() => sessionStorage, TRIP_KEY, this.trip);
  }

  /** Driving time and distance; call while the vehicle is being driven. `now` in milliseconds. */
  tick(dt: number, metres: number, now: number): void {
    if (!this.trip) return;
    this.trip.seconds += dt;
    this.trip.metres += metres;
    if (now - this.savedAt > 5000) {
      this.savedAt = now;
      save(() => sessionStorage, TRIP_KEY, this.trip);
    }
  }

  /** Seconds and metres of the trip under way. */
  get current(): { seconds: number; metres: number; counts: boolean } | null {
    return this.trip ? { seconds: this.trip.seconds, metres: this.trip.metres, counts: !this.trip.jumped } : null;
  }

  /**
   * Arrived at the destination: the logbook entry, or null when the trip does not count
   * (the vehicle jumped on the way, or there was no trip).
   */
  arrive(info: Pick<LogEntry, 'region' | 'vehicle' | 'date' | 'season' | 'with'>, now = Date.now()): LogEntry | null {
    const trip = this.trip;
    this.begin(null);
    if (!trip || trip.jumped) return null;
    const { with: others, ...rest } = info;
    const entry: LogEntry = {
      ...rest,
      ...(others?.length ? { with: [...others] } : {}),
      destination: trip.name,
      ...(trip.kind ? { kind: trip.kind } : {}),
      seconds: Math.round(trip.seconds),
      metres: Math.round(trip.metres),
      at: now,
    };
    this.entries.push(entry);
    if (this.entries.length > LOG_MAX) this.entries.splice(0, this.entries.length - LOG_MAX);
    save(() => localStorage, LOG_KEY, this.entries);
    return entry;
  }

  /**
   * Another driver arrived at a place: if this browser's last arrival was there within the
   * minute, they arrived together, and the entry says so. True when the logbook changed.
   */
  together(region: string, destination: string, name: string, now = Date.now()): boolean {
    const last = this.entries[this.entries.length - 1];
    if (!last || last.region !== region || last.destination !== destination || now - last.at > TOGETHER_MS) return false;
    if (last.with?.includes(name)) return false;
    last.with = [...(last.with ?? []), name];
    save(() => localStorage, LOG_KEY, this.entries);
    return true;
  }

  /** The names of the places reached in a region. */
  reached(region: string): Set<string> {
    return new Set(this.entries.filter((e) => e.region === region).map((e) => e.destination));
  }

  /** The quickest arrival at a place, if any. */
  best(region: string, destination: string): LogEntry | null {
    let best: LogEntry | null = null;
    for (const e of this.entries) if (e.region === region && e.destination === destination && (!best || e.seconds < best.seconds)) best = e;
    return best;
  }
}

/** "38 min", "1 h 05 min", "45 s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Mar" for a day of the year (1 is 1 January; fractions allowed), in a year that is not a leap year. */
export function dateOfYear(day: number): string {
  const d = new Date(Date.UTC(2025, 0, Math.floor(day)));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The season in words, as the land shows it: winter while snow lies, else by the leaves. */
export function seasonName(s: SeasonState, day: number): string {
  if (s.snow > 0.05) return 'winter';
  const [main] = (Object.entries(s.foliage) as [string, number][]).sort((a, b) => b[1] - a[1])[0]!;
  // Bare trees without snow: the end of autumn, or the snow just gone in spring.
  if (main === 'winter') return day > 182 ? 'late autumn' : 'early spring';
  return main;
}
