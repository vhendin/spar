import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@spar/shared';
import { isClientMessage } from '@spar/shared/validate';
import type { ServerConfig } from './config';
import { serveFile } from './static';

export interface GameServer {
  http: Server;
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

/** Builds the HTTP and WebSocket server without starting to listen. */
export function createGameServer(config: ServerConfig): GameServer {
  const http = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const handled = path.startsWith('/regions/')
      ? serveFile(req, res, config.regionsDir, path.slice('/regions/'.length))
      : serveFile(req, res, config.clientDist, path, { immutable: path.startsWith('/assets/') });
    handled.catch((err: unknown) => {
      console.error('request failed', path, err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });
  // ws re-emits the HTTP server's errors (such as a port already in use); listen() reports those.
  wss.on('error', () => {});
  let nextPlayer = 1;

  const send = (ws: WebSocket, msg: ServerMessage): void => ws.send(JSON.stringify(msg));

  wss.on('connection', (ws) => {
    const playerId = `p${nextPlayer++}`;
    ws.on('error', (err) => console.error(`socket error ${playerId}`, err));
    ws.on('message', (data, isBinary) => {
      let msg: unknown;
      try {
        if (isBinary) throw new Error('binary');
        msg = JSON.parse(data.toString());
      } catch {
        send(ws, { type: 'error', code: 'bad_message', message: 'Messages must be JSON text.' });
        return;
      }
      if (!isClientMessage(msg)) {
        send(ws, { type: 'error', code: 'bad_message', message: 'Message does not match the protocol schema.' });
        return;
      }
      switch (msg.type) {
        case 'hello':
          if (msg.protocol !== PROTOCOL_VERSION) {
            send(ws, {
              type: 'error',
              code: 'protocol_mismatch',
              message: `Server speaks protocol ${PROTOCOL_VERSION}, client sent ${msg.protocol}. Reload the page.`,
            });
            ws.close(1002, 'protocol mismatch');
            return;
          }
          send(ws, { type: 'welcome', protocol: PROTOCOL_VERSION, playerId, region: config.region, seed: config.seed });
          break;
      }
    });
  });

  return {
    http,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          http.off('error', reject);
          resolve(http.address() as AddressInfo);
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
