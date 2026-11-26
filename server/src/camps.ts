// Camping at a shelter, camp site, hut or lodge. One player says they are ready to rest there;
// everyone else within CAMP_NEAR of the place must agree too; then the night passes for all,
// since the clock is shared. One camp at a time: the clock is the whole server's.

import type { ClientMessage, ServerMessage } from '@spar/shared';

type CampMessage = Extract<ClientMessage, { type: 'camp' }>;
type CampPlace = NonNullable<CampMessage['place']>;
export type CampState = Extract<ServerMessage, { type: 'camp' }>;

/** Players within this many metres of the place must all agree before the night passes. */
export const CAMP_NEAR = 50;
/** Real milliseconds a night takes to pass. */
export const NIGHT_MS = 18_000;

export interface Where {
  region: string;
  x: number;
  z: number;
}

interface Camp {
  region: string;
  place: CampPlace;
  until: number;
  ended: NonNullable<CampMessage['ended']>;
  ready: Set<string>;
  /** True once the night is passing. */
  night: boolean;
}

/** What to do after a change: tell the region how the camp stands, and start the night. */
export interface CampChange {
  state: CampState;
  /** The night starts now: run the clock to `until`. */
  start?: boolean;
}

export class Camps {
  private camp: Camp | null = null;

  /** Where each player's vehicle was last; set from their snapshots. */
  constructor(private readonly where: (id: string) => Where | undefined, private readonly players: () => string[]) {}

  /** The camp now, if any. */
  get current(): Readonly<Camp> | null {
    return this.camp;
  }

  /** A player's word; returns what changed, or null. */
  message(player: string, msg: CampMessage): CampChange | null {
    const c = this.camp;
    if (msg.action === 'ready') {
      if (!msg.place || msg.until === undefined) return null;
      if (c?.night) return null;
      let changed: CampChange | null = null;
      if (!c || c.place.id !== msg.place.id || c.region !== msg.region) {
        // A new camp; one elsewhere still waiting is given up.
        if (c) changed = { state: this.state(c, 'over') };
        this.told = '';
        this.camp = { region: msg.region, place: msg.place, until: msg.until, ended: msg.ended ?? 'dawn', ready: new Set(), night: false };
      }
      this.camp!.ready.add(player);
      return this.check() ?? changed;
    }
    if (!c || c.region !== msg.region) return null;
    if (msg.action === 'leave') {
      if (c.night || !c.ready.delete(player)) return null;
      return this.check();
    }
    // Awake early: only one who camped.
    if (msg.action === 'wake' && c.night && c.ready.has(player)) return this.morning();
    return null;
  }

  /** Call about once a second and when a player leaves: those gone or driven off no longer count. */
  check(): CampChange | null {
    const c = this.camp;
    if (!c || c.night) return null;
    const online = new Set(this.players());
    const near = this.near(c, online);
    let dropped = false;
    for (const id of c.ready) {
      if (!near.includes(id)) {
        c.ready.delete(id);
        dropped = true;
      }
    }
    if (c.ready.size === 0) {
      this.camp = null;
      this.told = '';
      return { state: this.state(c, 'over') };
    }
    if (near.every((id) => c.ready.has(id))) {
      c.night = true;
      return { state: this.state(c, 'night'), start: true };
    }
    const key = `${[...c.ready].sort().join()}|${near.sort().join()}`;
    if (!dropped && key === this.told) return null;
    this.told = key;
    return { state: this.state(c, 'waiting') };
  }

  /** The night is over (its time is up, or someone woke): morning, and the camp is done. */
  morning(): CampChange | null {
    const c = this.camp;
    if (!c?.night) return null;
    this.camp = null;
    this.told = '';
    return { state: this.state(c, 'morning') };
  }

  private told = '';

  private near(c: Camp, online: Set<string>): string[] {
    const out: string[] = [];
    for (const id of online) {
      const w = this.where(id);
      if (w && w.region === c.region && Math.hypot(w.x - c.place.x, w.z - c.place.z) <= CAMP_NEAR) out.push(id);
    }
    return out;
  }

  private state(c: Camp, state: CampState['state']): CampState {
    const near = this.near(c, new Set(this.players()));
    return {
      type: 'camp',
      region: c.region,
      place: c.place,
      state,
      ready: [...c.ready],
      waiting: near.filter((id) => !c.ready.has(id)),
      until: c.until,
      ended: c.ended,
    };
  }
}
