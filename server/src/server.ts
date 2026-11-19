import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, type Player, type ServerMessage } from '@spar/shared';
import { isClientMessage } from '@spar/shared/validate';
import type { ServerConfig } from './config';
import { AREA_SIZES, AreaMaker, checkRequest, cleanStarts, fromHost, readStarts, writeStarts, type AreaRequest } from './areas';
import { cleanName, describeWorldChange, playerList } from './players';
import { listRegions } from './regions';
import { serveFile } from './static';
import { WorldState } from './world';

/** Seconds between world updates sent to every client. */
const WORLD_INTERVAL = 2;

export interface GameServer {
  http: Server;
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

/** Builds the HTTP and WebSocket server without starting to listen. */
/** Answers with JSON. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Reads a small JSON request body. */
function readBody(req: IncomingMessage, limit = 4096): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk: Buffer) => {
      text += chunk.toString();
      if (text.length > limit) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', reject);
  });
}

/** /api/areas: what can be made, making one, how it is going, and removing one. */
async function handleAreas(req: IncomingMessage, res: ServerResponse, path: string, maker: AreaMaker, config: ServerConfig): Promise<void> {
  const host = fromHost(req);
  if (path === '/api/areas' && req.method === 'GET') {
    json(res, 200, { enabled: maker.enabled && host, sizes: AREA_SIZES, job: maker.job });
    return;
  }
  if (!host) return json(res, 403, { error: 'Areas can only be made and removed on the computer running the server.' });
  if (!maker.enabled) return json(res, 403, { error: 'Making areas is off on this server (no importer).' });
  if (path === '/api/areas' && req.method === 'POST') {
    let body: Partial<AreaRequest>;
    try {
      body = (await readBody(req)) as Partial<AreaRequest>;
    } catch {
      return json(res, 400, { error: 'Bad request.' });
    }
    const problem = checkRequest(body);
    if (problem) return json(res, 400, { error: problem });
    try {
      const name = await maker.create(body as AreaRequest);
      return json(res, 202, { name });
    } catch (err) {
      return json(res, 409, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  const remove = /^\/api\/areas\/([a-z0-9_-]+)$/.exec(path);
  if (remove && req.method === 'DELETE') {
    try {
      await maker.remove(remove[1]!, config.region);
      return json(res, 200, { removed: remove[1] });
    } catch (err) {
      return json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  json(res, 404, { error: 'Not found.' });
}

/** /api/starts/<region>: start points placed by hand; anyone may read them, only the host change them. */
async function handleStarts(req: IncomingMessage, res: ServerResponse, region: string, config: ServerConfig): Promise<void> {
  if (req.method === 'GET') return json(res, 200, await readStarts(config.startsDir, region));
  if (req.method !== 'PUT') return json(res, 405, { error: 'GET or PUT.' });
  if (!fromHost(req)) return json(res, 403, { error: 'Start points can only be changed on the computer running the server.' });
  if ((await listRegions(config.regionsDir)).every((r) => r.name !== region)) return json(res, 404, { error: 'No such area.' });
  let starts;
  try {
    starts = cleanStarts(await readBody(req, 16384));
  } catch {
    starts = null;
  }
  if (!starts) return json(res, 400, { error: 'Bad list of start points.' });
  await writeStarts(config.startsDir, region, starts);
  json(res, 200, starts);
}

export function createGameServer(config: ServerConfig): GameServer {
  const maker = new AreaMaker({
    defsDir: config.defsDir,
    startsDir: config.startsDir,
    regionsDir: config.regionsDir,
    rawDir: config.rawDir,
    importer: config.importer,
    cwd: config.importerCwd,
  });
  const http = createServer((req, res) => {
    const apiPath = (req.url ?? '/').split('?')[0] ?? '/';
    const starts = /^\/api\/starts\/([a-z0-9_-]+)$/.exec(apiPath);
    if (starts) {
      handleStarts(req, res, starts[1]!, config).catch((err: unknown) => {
        console.error('request failed', apiPath, err);
        if (!res.headersSent) json(res, 500, { error: 'Server error.' });
      });
      return;
    }
    if (apiPath.startsWith('/api/areas')) {
      handleAreas(req, res, apiPath, maker, config).catch((err: unknown) => {
        console.error('request failed', apiPath, err);
        if (!res.headersSent) json(res, 500, { error: 'Server error.' });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    // Region names are letters, digits, - and _, so this never shadows a region's folder.
    if (path === '/regions/list.json') {
      listRegions(config.regionsDir)
        .then((regions) => {
          const body = JSON.stringify({ default: config.region, regions });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end(req.method === 'HEAD' ? undefined : body);
        })
        .catch(() => res.writeHead(500).end());
      return;
    }
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
  const world = new WorldState(config);
  /** Everyone who has said hello, by their socket. */
  const joined = new Map<WebSocket, Player>();
  let ticks = 0;
  const timer = setInterval(() => {
    world.step();
    if (++ticks % WORLD_INTERVAL !== 0 || joined.size === 0) return;
    const update = JSON.stringify(world.message());
    for (const ws of joined.keys()) ws.send(update);
  }, 1000);

  const send = (ws: WebSocket, msg: ServerMessage): void => ws.send(JSON.stringify(msg));
  /** To everyone who has joined, or everyone but `except`. */
  const broadcast = (msg: ServerMessage, except?: WebSocket): void => {
    const text = JSON.stringify(msg);
    for (const ws of joined.keys()) if (ws !== except && ws.readyState === ws.OPEN) ws.send(text);
  };
  const announcePlayers = (): void => broadcast({ type: 'players', players: playerList(joined.values()) });
  const say = (text: string): void => broadcast({ type: 'chat', text });

  wss.on('connection', (ws) => {
    const number = nextPlayer++;
    const playerId = `p${number}`;
    ws.on('error', (err) => console.error(`socket error ${playerId}`, err));
    ws.on('close', () => {
      const player = joined.get(ws);
      if (!player) return;
      joined.delete(ws);
      broadcast({ type: 'away', id: player.id });
      announcePlayers();
      say(`${player.name} left`);
    });
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
      if (msg.type === 'hello') {
        if (msg.protocol !== PROTOCOL_VERSION) {
          send(ws, {
            type: 'error',
            code: 'protocol_mismatch',
            message: `Server speaks protocol ${PROTOCOL_VERSION}, client sent ${msg.protocol}. Reload the page.`,
          });
          ws.close(1002, 'protocol mismatch');
          return;
        }
        if (joined.has(ws)) return;
        send(ws, { type: 'welcome', protocol: PROTOCOL_VERSION, playerId, region: config.region, seed: config.seed });
        send(ws, world.message());
        const player: Player = { id: playerId, name: cleanName(msg.name, `Driver ${number}`) };
        if (msg.color) player.color = msg.color;
        joined.set(ws, player);
        announcePlayers();
        say(`${player.name} joined`);
        return;
      }
      // Everything else needs a hello first.
      const player = joined.get(ws);
      if (!player) return;
      switch (msg.type) {
        case 'profile': {
          const name = cleanName(msg.name, player.name);
          if (name !== player.name) say(`${player.name} is now called ${name}`);
          player.name = name;
          if (msg.color) player.color = msg.color;
          else delete player.color;
          announcePlayers();
          break;
        }
        case 'state':
          // Passed on as it came; each browser draws the others' vehicles from it.
          broadcast({ type: 'state', id: player.id, vehicle: msg.vehicle }, ws);
          break;
        case 'away':
          broadcast({ type: 'away', id: player.id }, ws);
          break;
        case 'chat': {
          const text = msg.text.trim();
          if (text) broadcast({ type: 'chat', from: player.id, name: player.name, text });
          break;
        }
        case 'set_world': {
          // Anyone who has joined may change the clock and weather; everyone sees it at once.
          world.set(msg);
          broadcast(world.message());
          const change = describeWorldChange(msg);
          if (change) say(`${player.name} ${change}`);
          break;
        }
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
        clearInterval(timer);
        for (const ws of wss.clients) ws.terminate();
        joined.clear();
        wss.close();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
