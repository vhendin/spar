import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type Welcome } from '@spar/shared';

export type ConnectionState =
  | { status: 'connecting' }
  | { status: 'online'; welcome: Welcome }
  | { status: 'offline'; reason: string };

/** Keeps one WebSocket to the game server open, reconnecting when it drops. */
export class Connection {
  state: ConnectionState = { status: 'connecting' };
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private stopped = false;

  constructor(private readonly onChange: (state: ConnectionState) => void) {
    this.open();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private set(state: ConnectionState): void {
    this.state = state;
    this.onChange(state);
  }

  private open(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => this.send({ type: 'hello', protocol: PROTOCOL_VERSION });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      switch (msg.type) {
        case 'welcome':
          this.retryMs = 500;
          this.set({ status: 'online', welcome: msg });
          break;
        case 'error':
          // A version mismatch will not fix itself by retrying.
          if (msg.code === 'protocol_mismatch') this.stopped = true;
          this.set({ status: 'offline', reason: msg.message });
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
