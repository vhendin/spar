// Camping at a shelter, camp site, hut or lodge: stopped by one, the driver is offered a night
// there; everyone else near must agree (the server keeps count); then the night passes for all,
// fast, until dawn. Each night is kept in the browser and with the account (`account.ts`).

import { NIGHTS_KEY, mergeNights, nightKey, readNights, type CampPlace, type DestinationPoint, type Night, type NightsByRegion, type ServerMessage } from '@spar/shared';
import { CAMP_KINDS } from './features/poi';

type CampState = Extract<ServerMessage, { type: 'camp' }>;

/** Stopped within this many metres of a place, a night there is offered. */
export const CAMP_REACH = 30;
/** Slower than this (m/s) counts as stopped. */
const STOPPED = 0.6;
/** Driven this far from the place, a camp waiting for the others is given up. */
const DRIVEN_OFF = 40;

const KIND_WORDS: Record<string, string> = { shelter: 'shelter', camp: 'camp site', hut: 'hut', lodge: 'lodge' };

export interface NightsSummary {
  nights: number;
  places: number;
  list: { name: string; kind: string; date: string; vehicle: string; at: number; ended: Night['ended']; with: string[] }[];
}

/** What the driver sees and can do about camping just now. */
export type CampOffer =
  | { kind: 'none' }
  /** Stopped by a place: C to camp. Others may be waiting there already. */
  | { kind: 'offer'; place: CampPlace; others: string[] }
  /** Ready, waiting for these to agree. */
  | { kind: 'waiting'; place: CampPlace; for: string[] }
  /** The night is passing here. */
  | { kind: 'night'; place: CampPlace; until: number; ended: Night['ended']; with: string[] };

export class Camp {
  /** The places a night can be spent at. */
  readonly places: CampPlace[];
  private all: NightsByRegion;
  /** The region's camp as the server last told it, if any. */
  private told: CampState | null = null;
  /** Ready here, as we asked the server. */
  private readyAt: CampPlace | null = null;
  /** Just rested here: not offered again until driven away. */
  private restedAt: CampPlace | null = null;

  constructor(private readonly region: string, destinations: readonly DestinationPoint[]) {
    this.places = destinations.filter((d) => CAMP_KINDS.has(d.kind)).map((d) => ({ id: d.id, name: d.name, kind: d.kind, x: d.x, z: d.z }));
    this.all = readNights(read(NIGHTS_KEY));
  }

  /** The nearest place within reach of (x, z), if any. */
  nearest(x: number, z: number): CampPlace | null {
    let best: CampPlace | null = null, bestD = CAMP_REACH;
    for (const p of this.places) {
      if (Math.abs(p.x - x) > bestD || Math.abs(p.z - z) > bestD) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** The server's word on the region's camp. */
  heard(msg: CampState): void {
    if (msg.region !== this.region) return;
    this.told = msg.state === 'waiting' || msg.state === 'night' ? msg : null;
    if (msg.state === 'over' || msg.state === 'morning') this.readyAt = null;
  }

  /** We asked to camp here. */
  asked(place: CampPlace): void {
    this.readyAt = place;
  }

  /** The night here is over: not offered again until the driver has been away. */
  rested(place: CampPlace): void {
    this.restedAt = place;
    this.readyAt = null;
  }

  /** We gave up waiting. */
  gaveUp(): void {
    this.readyAt = null;
  }

  /** Whether we are ready at a place (asked, or the server says so). */
  readyHere(me: string): CampPlace | null {
    if (this.readyAt) return this.readyAt;
    return this.told?.ready.includes(me) ? this.told.place : null;
  }

  /** True when driven too far from the place we are waiting at. */
  drivenOff(x: number, z: number): boolean {
    const p = this.readyAt;
    return !!p && Math.hypot(p.x - x, p.z - z) > DRIVEN_OFF;
  }

  /**
   * What to offer or show now, for a driver at (x, z) going `speed` m/s; `me` is our player id
   * and `name` turns ids into names.
   */
  offer(me: string, x: number, z: number, speed: number, name: (id: string) => string): CampOffer {
    const t = this.told;
    if (t?.state === 'night' && t.ready.includes(me)) {
      return { kind: 'night', place: t.place, until: t.until ?? 0, ended: t.ended ?? 'dawn', with: t.ready.filter((id) => id !== me).map(name) };
    }
    const ready = this.readyHere(me);
    if (ready) return { kind: 'waiting', place: ready, for: t && t.place.id === ready.id ? t.waiting.filter((id) => id !== me).map(name) : [] };
    const r = this.restedAt;
    if (r && Math.hypot(r.x - x, r.z - z) > DRIVEN_OFF) this.restedAt = null;
    if (Math.abs(speed) > STOPPED) return { kind: 'none' };
    const place = this.nearest(x, z);
    if (!place || place.id === this.restedAt?.id) return { kind: 'none' };
    const others = t?.state === 'waiting' && t.place.id === place.id ? t.ready.map(name) : [];
    return { kind: 'offer', place, others };
  }

  /** Keeps a night spent at a place. */
  record(n: Omit<Night, 'at'>, at = Date.now()): void {
    const night: Night = { ...n, at };
    const mine = JSON.stringify({ [this.region]: { [nightKey(night)]: night } });
    this.all = readNights(mergeNights(read(NIGHTS_KEY), mine));
    write(NIGHTS_KEY, JSON.stringify(this.all));
  }

  /** The ids of the places camped at in this region. */
  campedAt(): Set<string> {
    return new Set(Object.values(this.all[this.region] ?? {}).map((n) => n.place));
  }

  /** For the logbook: how many nights, at how many places, and each. */
  summary(): NightsSummary {
    const nights = Object.values(this.all[this.region] ?? {}).sort((a, b) => a.at - b.at);
    return {
      nights: nights.length,
      places: new Set(nights.map((n) => n.place)).size,
      list: nights.map((n) => ({ name: n.name, kind: KIND_WORDS[n.kind] ?? n.kind, date: n.date, vehicle: n.vehicle, at: n.at, ended: n.ended, with: n.with ?? [] })),
    };
  }
}

/** "Stensdalen shelter" style word for a kind. */
export const campKindWord = (kind: string): string => KIND_WORDS[kind] ?? kind;

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
    // Not kept.
  }
}
