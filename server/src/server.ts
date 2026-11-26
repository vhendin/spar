import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lanAddresses } from './lan';
import { WebSocketServer, type WebSocket } from 'ws';
import { dayOfYear, PROTOCOL_VERSION, seasonAt, type Player, type SeasonCalendar, type ServerMessage } from '@spar/shared';
import seasonDefs from '../../defs/seasons.json';
import { isClientMessage } from '@spar/shared/validate';
import type { ServerConfig } from './config';
import { AccessVerifier } from './access';
import { AccountStore, cleanChanges } from './accounts';
import { Camps, NIGHT_MS, type CampChange, type Where } from './camps';
import { AREA_SIZES, AreaMaker, checkRequest, cleanStarts, fromHost, readStarts, writeStarts, type AreaRequest } from './areas';
import { cleanName, describeWorldChange, playerList } from './players';
import { listRegions } from './regions';
import { Rooms } from './rooms';
import { Towing } from './towing';
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

/**
 * /api/me: who is logged in (through Cloudflare Access) and what is kept for them; PUT keeps
 * changes. Guests get an empty answer and cannot keep anything.
 */
async function handleMe(req: IncomingMessage, res: ServerResponse, access: AccessVerifier | null, accounts: AccountStore): Promise<void> {
  const email = access ? await access.email(req) : null;
  if (req.method === 'GET') return json(res, 200, email ? { email, values: await accounts.get(email) } : {});
  if (req.method !== 'PUT') return json(res, 405, { error: 'GET or PUT.' });
  if (!email) return json(res, 403, { error: 'Not logged in.' });
  // Only the game's own page: a form on another site cannot send JSON with this header.
  const site = req.headers['sec-fetch-site'];
  if (req.headers['x-spar'] !== '1' || (site !== undefined && site !== 'same-origin')) return json(res, 403, { error: 'Not from the game.' });
  let changes;
  try {
    changes = cleanChanges(await readBody(req, 1 << 20));
  } catch {
    changes = null;
  }
  if (!changes) return json(res, 400, { error: 'Bad request.' });
  json(res, 200, { values: await accounts.update(email, changes) });
}

/** Largest performance recording taken: 15 minutes at 120 frames a second is about 25 MB. */
const PERF_LIMIT = 64 << 20;

/**
 * /api/perf: a performance recording from the game (F9), kept in perfDir for reading
 * afterwards. Only from the computer running the server, or a logged-in driver.
 */
async function handlePerf(req: IncomingMessage, res: ServerResponse, access: AccessVerifier | null, config: ServerConfig): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST.' });
  if (!config.perfDir) return json(res, 403, { error: 'Recordings are not kept on this server.' });
  const site = req.headers['sec-fetch-site'];
  if (req.headers['x-spar'] !== '1' || (site !== undefined && site !== 'same-origin')) return json(res, 403, { error: 'Not from the game.' });
  if (!fromHost(req) && !(access && (await access.email(req)))) return json(res, 403, { error: 'Only from this computer, or logged in.' });
  let body: { version?: unknown; columns?: unknown; rows?: unknown; meta?: Record<string, unknown> };
  try {
    body = (await readBody(req, PERF_LIMIT)) as typeof body;
  } catch {
    return json(res, 400, { error: 'Bad or too large a recording.' });
  }
  if (body?.version !== 1 || !Array.isArray(body.columns) || !Array.isArray(body.rows)) return json(res, 400, { error: 'Not a recording.' });
  const word = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) : '');
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const name = [stamp, word(body.meta?.region), word(body.meta?.label)].filter(Boolean).join('-') + '.json';
  await mkdir(config.perfDir, { recursive: true });
  await writeFile(join(config.perfDir, name), JSON.stringify(body));
  json(res, 201, { name });
}

/** Largest batch of browser errors taken at once. */
const LOG_LIMIT = 256 << 10;

/**
 * /api/log: errors and warnings from the game's browser, appended to client-errors.log in
 * perfDir, so problems on screen can be read without the browser's console. Only from the
 * computer running the server, or a logged-in driver.
 */
async function handleLog(req: IncomingMessage, res: ServerResponse, access: AccessVerifier | null, config: ServerConfig): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST.' });
  if (!config.perfDir) return json(res, 403, { error: 'Logs are not kept on this server.' });
  const site = req.headers['sec-fetch-site'];
  if (req.headers['x-spar'] !== '1' || (site !== undefined && site !== 'same-origin')) return json(res, 403, { error: 'Not from the game.' });
  if (!fromHost(req) && !(access && (await access.email(req)))) return json(res, 403, { error: 'Only from this computer, or logged in.' });
  let body: { lines?: unknown };
  try {
    body = (await readBody(req, LOG_LIMIT)) as typeof body;
  } catch {
    return json(res, 400, { error: 'Bad or too large.' });
  }
  if (!Array.isArray(body?.lines)) return json(res, 400, { error: 'No lines.' });
  const lines = body.lines.filter((l): l is string => typeof l === 'string').map((l) => l.slice(0, 8000));
  await mkdir(config.perfDir, { recursive: true });
  await appendFile(join(config.perfDir, 'client-errors.log'), lines.map((l) => `${new Date().toISOString()} ${l}\n`).join(''));
  json(res, 200, { ok: true });
}

export function createGameServer(config: ServerConfig, deps: { access?: AccessVerifier } = {}): GameServer {
  const access = deps.access ?? (config.access ? new AccessVerifier(config.access) : null);
  const accounts = new AccountStore(config.accountsDir);
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
    if (apiPath === '/api/me') {
      handleMe(req, res, access, accounts).catch((err: unknown) => {
        console.error('request failed', apiPath, err);
        if (!res.headersSent) json(res, 500, { error: 'Server error.' });
      });
      return;
    }
    if (apiPath === '/api/log') {
      handleLog(req, res, access, config).catch((err: unknown) => {
        console.error('request failed', apiPath, err);
        if (!res.headersSent) json(res, 500, { error: 'Server error.' });
      });
      return;
    }
    if (apiPath === '/api/perf') {
      handlePerf(req, res, access, config).catch((err: unknown) => {
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
  /** Trees knocked down and holes in the ice, per region. */
  const rooms = new Rooms();
  /** Cables between drivers' vehicles, and which browser runs which vehicle. */
  const towing = new Towing();
  /** The last `cable` message seen from each socket, told back in `towing`. */
  const acks = new Map<WebSocket, number>();
  /** Drivers whose vehicle is on the road (sending state, not away): only those can be hooked on to. */
  const onRoad = new Set<string>();
  /** Everyone who has said hello, by their socket. */
  const joined = new Map<WebSocket, Player>();
  /** Where each driver's vehicle was last, from its snapshots: for who is near a camp. */
  const where = new Map<string, Where>();
  const camps = new Camps((id) => where.get(id), () => [...joined.values()].map((p) => p.id));
  let nightTimer: NodeJS.Timeout | null = null;
  /**
   * Players whose connection dropped, by the token their browser chose: coming back with it
   * before the timer runs out, they are the same player again, and nobody is told they left.
   */
  const dropped = new Map<string, { player: Player; timer: NodeJS.Timeout }>();
  /** The token each socket joined with. */
  const tokens = new Map<WebSocket, string>();
  const rejoinMs = (config.rejoinSeconds ?? 60) * 1000;
  /** Where others on the network can open the game, shown in the start menu; known once listening. */
  let addresses: string[] = [];
  let ticks = 0;
  const timer = setInterval(() => {
    world.step();
    campChanged(camps.check());
    // Once the lakes are open the holes in the ice are gone with it.
    if (seasonAt(seasonDefs as SeasonCalendar, dayOfYear(world.utc(), config.utcOffset)).ice <= 0) rooms.thaw();
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
  /** To everyone else in a region. */
  const toRoom = (region: string, msg: ServerMessage, except?: WebSocket): void => {
    const text = JSON.stringify(msg);
    for (const [ws, p] of joined) if (ws !== except && p.region === region && ws.readyState === ws.OPEN) ws.send(text);
  };
  const announcePlayers = (): void => broadcast({ type: 'players', players: playerList(joined.values()) });
  /** The cables and who runs what, to one socket or everyone, each with their own `ack`. */
  const towingTo = (ws: WebSocket): void => send(ws, { type: 'towing', ...towing.list(), ack: acks.get(ws) ?? 0 });
  const announceTowing = (): void => {
    for (const ws of joined.keys()) if (ws.readyState === ws.OPEN) towingTo(ws);
  };
  const socketOf = (id: string): WebSocket | undefined => {
    for (const [ws, p] of joined) if (p.id === id && ws.readyState === ws.OPEN) return ws;
    return undefined;
  };
  const say = (text: string): void => broadcast({ type: 'chat', text });
  /** Once everyone in a region has reached its shared destination, they are all told. */
  const checkArrivals = (region: string | undefined): void => {
    if (!region) return;
    const here = [...joined.values()].filter((p) => p.region === region).map((p) => p.id);
    const done = rooms.everyoneArrived(region, here);
    if (done) toRoom(region, { type: 'chat', text: `Everyone has arrived at ${done.name}` });
  };
  /** Tells the region how its camp stands; at the start of a night, runs the clock to dawn. */
  const campChanged = (change: CampChange | null): void => {
    if (!change) return;
    const { state } = change;
    const msg: ServerMessage = state;
    const text = JSON.stringify(msg);
    for (const [ws, p] of joined) if (p.region === state.region && ws.readyState === ws.OPEN) ws.send(text);
    if (change.start && state.until !== undefined) {
      world.passNight(state.until, NIGHT_MS);
      broadcast(world.message());
      const names = state.ready.map((id) => [...joined.values()].find((p) => p.id === id)?.name).filter((n): n is string => !!n);
      if (names.length) say(`${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`} camped at ${state.place.name}`);
      if (nightTimer) clearTimeout(nightTimer);
      nightTimer = setTimeout(morning, NIGHT_MS + 20);
    }
  };
  const morning = (): void => {
    if (nightTimer) clearTimeout(nightTimer);
    nightTimer = null;
    world.wake();
    broadcast(world.message());
    campChanged(camps.morning());
  };
  const gone = (player: Player): void => {
    broadcast({ type: 'away', id: player.id });
    announcePlayers();
    say(`${player.name} left`);
  };

  wss.on('connection', (ws) => {
    const number = nextPlayer++;
    const playerId = `p${number}`;
    ws.on('error', (err) => console.error(`socket error ${playerId}`, err));
    ws.on('close', () => {
      const player = joined.get(ws);
      if (!player) return;
      joined.delete(ws);
      acks.delete(ws);
      checkArrivals(player.region);
      onRoad.delete(player.id);
      where.delete(player.id);
      campChanged(camps.check());
      // Its cables come off at once, and the vehicles its browser ran go back to their drivers.
      if (towing.leave(player.id)) announceTowing();
      const token = tokens.get(ws);
      tokens.delete(ws);
      if (!token || rejoinMs <= 0) return gone(player);
      // Kept for a while: a reload or a dropped network comes back as the same player.
      const timer = setTimeout(() => {
        dropped.delete(token);
        gone(player);
      }, rejoinMs);
      dropped.set(token, { player, timer });
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
        // Back within the minute, and not already connected from elsewhere: the same player again.
        const back = msg.token ? dropped.get(msg.token) : undefined;
        const taken = msg.token !== undefined && [...tokens.values()].includes(msg.token);
        if (back) {
          clearTimeout(back.timer);
          dropped.delete(msg.token!);
        }
        const player: Player = back?.player ?? { id: playerId, name: cleanName(msg.name, `Driver ${number}`) };
        if (back) {
          player.name = cleanName(msg.name, player.name);
          if (msg.color) player.color = msg.color;
          else delete player.color;
        } else if (msg.color) player.color = msg.color;
        send(ws, { type: 'welcome', protocol: PROTOCOL_VERSION, playerId: player.id, region: config.region, seed: config.seed, ...(addresses.length ? { addresses } : {}) });
        send(ws, world.message());
        joined.set(ws, player);
        if (msg.token && !taken) tokens.set(ws, msg.token);
        announcePlayers();
        towingTo(ws);
        if (!back) say(`${player.name} joined`);
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
        case 'state': {
          // Passed on as it came; each browser draws the others' vehicles from it. Only the
          // browser that runs a vehicle speaks for it: a late word from the one before is dropped.
          const of = msg.of ?? player.id;
          if (towing.runnerOf(of) !== player.id) break;
          onRoad.add(of);
          where.set(of, { region: msg.vehicle.region, x: msg.vehicle.p[0]!, z: msg.vehicle.p[2]! });
          broadcast(msg.of === undefined ? { type: 'state', id: player.id, vehicle: msg.vehicle } : { type: 'state', id: of, by: player.id, vehicle: msg.vehicle }, ws);
          break;
        }
        case 'away':
          onRoad.delete(player.id);
          where.delete(player.id);
          if (towing.free(player.id)) announceTowing();
          broadcast({ type: 'away', id: player.id }, ws);
          break;
        case 'room':
          // Entering a region: what has changed there so far.
          if (player.region !== msg.region) {
            const left = player.region;
            player.region = msg.region;
            checkArrivals(left);
            announcePlayers();
            if (towing.free(player.id)) announceTowing();
          }
          send(ws, { type: 'room', region: msg.region, ...rooms.state(msg.region) });
          break;
        case 'felled':
          if (rooms.fell(msg.region, msg.tree)) toRoom(msg.region, { type: 'felled', region: msg.region, tree: msg.tree }, ws);
          break;
        case 'ice_hole':
          if (rooms.breakIce(msg.region, msg.hole)) toRoom(msg.region, { type: 'ice_hole', region: msg.region, hole: msg.hole }, ws);
          break;
        case 'share':
          // Everyone in the region gets it as their destination too; a late arrival gets it with the room.
          if (rooms.share(msg.region, msg.destination, player.id)) {
            toRoom(msg.region, { type: 'share', region: msg.region, destination: msg.destination, by: player.id }, ws);
          }
          break;
        case 'arrived':
          toRoom(msg.region, { type: 'arrived', region: msg.region, destination: msg.destination, id: player.id }, ws);
          if (rooms.arrive(msg.region, msg.destination, player.id)) checkArrivals(msg.region);
          break;
        case 'push': {
          // Only to the browser that runs the vehicle pushed: it alone moves it.
          const to = socketOf(towing.runnerOf(msg.to));
          if (to && to !== ws) send(to, { type: 'push', from: player.id, to: msg.to, impulse: msg.impulse, at: msg.at });
          break;
        }
        case 'cable': {
          acks.set(ws, msg.seq);
          // Only the browser that runs the winch's vehicle may hook it; only on to a vehicle
          // on the road in the same region.
          const from = [...joined.values()].find((p) => p.id === msg.from);
          const to = msg.to === undefined ? undefined : [...joined.values()].find((p) => p.id === msg.to);
          const allowed = towing.runnerOf(msg.from) === player.id && !!from
            && (msg.to === undefined || (!!to && to.region === from.region && onRoad.has(to.id) && onRoad.has(from.id)));
          const changed = allowed && (msg.to === undefined ? towing.unhook(msg.from) : towing.hook(msg.from, msg.to));
          if (changed) announceTowing();
          else towingTo(ws);
          break;
        }
        case 'free':
          acks.set(ws, msg.seq);
          if (towing.free(player.id)) announceTowing();
          else towingTo(ws);
          break;
        case 'pause':
          if (towing.pause(player.id, msg.paused)) announceTowing();
          break;
        case 'drive': {
          // To the browser running this driver's vehicle, if not their own.
          const runner = towing.runnerOf(player.id);
          const to = runner === player.id ? undefined : socketOf(runner);
          if (to) send(to, { type: 'drive', from: player.id, controls: msg.controls });
          break;
        }
        case 'handover': {
          const to = socketOf(msg.to);
          if (to && to !== ws) send(to, { type: 'handover', from: player.id, vehicle: msg.vehicle, state: msg.state });
          break;
        }
        case 'chat': {
          const text = msg.text.trim();
          if (text) broadcast({ type: 'chat', from: player.id, name: player.name, text });
          break;
        }
        case 'camp': {
          if (player.region !== msg.region) break;
          if (msg.action === 'wake' && camps.current?.night && camps.current.ready.has(player.id)) morning();
          else campChanged(camps.message(player.id, msg));
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
          const addr = http.address() as AddressInfo;
          addresses = config.addresses ?? lanAddresses().slice(0, 8).map((ip) => `http://${ip}:${addr.port}`);
          resolve(addr);
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(timer);
        if (nightTimer) clearTimeout(nightTimer);
        for (const ws of wss.clients) ws.terminate();
        joined.clear();
        for (const d of dropped.values()) clearTimeout(d.timer);
        dropped.clear();
        wss.close();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
