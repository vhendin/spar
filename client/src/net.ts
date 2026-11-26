import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type Welcome } from '@spar/shared';

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

export type ConnectionState =
  | { status: 'connecting' }
  | { status: 'online'; welcome: Welcome }
  | { status: 'offline'; reason: string };

/** What to do with what the server sends; any may be left out. */
export interface ConnectionHandlers {
  change(state: ConnectionState): void;
  world?(update: Of<'world'>): void;
  players?(msg: Of<'players'>): void;
  state?(msg: Of<'state'>): void;
  away?(msg: Of<'away'>): void;
  chat?(msg: Of<'chat'>): void;
  push?(msg: Of<'push'>): void;
  room?(msg: Of<'room'>): void;
  felled?(msg: Of<'felled'>): void;
  iceHole?(msg: Of<'ice_hole'>): void;
  towing?(msg: Of<'towing'>): void;
  drive?(msg: Of<'drive'>): void;
  handover?(msg: Of<'handover'>): void;
  share?(msg: Of<'share'>): void;
  arrived?(msg: Of<'arrived'>): void;
  camp?(msg: Of<'camp'>): void;
}

/** The driver as others see them, sent on joining and whenever it changes. */
export interface Profile {
  name: string;
  color?: string;
}

const TOKEN_KEY = 'spar.token';

/**
 * This tab's token, so a reload or a dropped network comes back as the same player. Kept for
 * the tab only (a second tab is a second player); random bytes, since plain http on a home
 * network has no crypto.randomUUID.
 */
function tabToken(): string | undefined {
  try {
    let token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    return undefined;
  }
}

/** Keeps one WebSocket to the game server open, reconnecting when it drops. */
export class Connection {
  state: ConnectionState = { status: 'connecting' };
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private stopped = false;

  constructor(
    private readonly on: ConnectionHandlers,
    private profile: Profile,
  ) {
    this.open();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** A new name or colour; sent now if online, and with the hello after a reconnect. */
  setProfile(profile: Profile): void {
    if (profile.name === this.profile.name && profile.color === this.profile.color) return;
    this.profile = profile;
    if (this.state.status === 'online') this.send({ type: 'profile', ...profile });
  }

  private set(state: ConnectionState): void {
    this.state = state;
    this.on.change(state);
  }

  private open(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;
    const token = tabToken();
    ws.onopen = () => this.send({ type: 'hello', protocol: PROTOCOL_VERSION, ...this.profile, ...(token && { token }) });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      switch (msg.type) {
        case 'welcome':
          this.retryMs = 500;
          this.set({ status: 'online', welcome: msg });
          break;
        case 'world':
          this.on.world?.(msg);
          break;
        case 'players':
          this.on.players?.(msg);
          break;
        case 'state':
          this.on.state?.(msg);
          break;
        case 'away':
          this.on.away?.(msg);
          break;
        case 'chat':
          this.on.chat?.(msg);
          break;
        case 'push':
          this.on.push?.(msg);
          break;
        case 'room':
          this.on.room?.(msg);
          break;
        case 'felled':
          this.on.felled?.(msg);
          break;
        case 'ice_hole':
          this.on.iceHole?.(msg);
          break;
        case 'towing':
          this.on.towing?.(msg);
          break;
        case 'drive':
          this.on.drive?.(msg);
          break;
        case 'handover':
          this.on.handover?.(msg);
          break;
        case 'share':
          this.on.share?.(msg);
          break;
        case 'arrived':
          this.on.arrived?.(msg);
          break;
        case 'camp':
          this.on.camp?.(msg);
          break;
        case 'error':
          // A version mismatch will not fix itself by retrying; a refused message is only that one.
          if (msg.code === 'protocol_mismatch') {
            this.stopped = true;
            this.set({ status: 'offline', reason: msg.message });
          } else console.warn(`Server refused a message: ${msg.message}`);
          break;
      }
    };
    ws.onclose = () => {
      if (this.state.status !== 'offline') this.set({ status: 'offline', reason: 'No connection to the server.' });
      if (this.stopped) return;
      setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
  }
}
