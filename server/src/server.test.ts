import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@spar/shared';
import { isServerMessage } from '@spar/shared/validate';
import { createGameServer, type GameServer } from './server';

let dir: string;
let server: GameServer;
let port: number;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spar-test-'));
  await mkdir(join(dir, 'client/assets'), { recursive: true });
  await mkdir(join(dir, 'regions/demo'), { recursive: true });
  await writeFile(join(dir, 'client/index.html'), '<h1>spar</h1>');
  await writeFile(join(dir, 'client/assets/app.js'), 'console.log(1)');
  await writeFile(join(dir, 'regions/demo/index.json'), '{"name":"demo"}');
  await writeFile(join(dir, 'secret.txt'), 'nope');
  // Stands in for the importer: says what it does, and `build` writes the area's index.
  await writeFile(
    join(dir, 'importer.mjs'),
    `import { mkdirSync, writeFileSync } from 'node:fs';
const [step, name] = process.argv.slice(2);
console.log(step + ' ' + name);
if (step === 'build') {
  mkdirSync('regions/' + name, { recursive: true });
  writeFileSync('regions/' + name + '/index.json', JSON.stringify({ name, title: 'Made', size: 2048 }));
}`,
  );
  server = createGameServer({
    host: '127.0.0.1',
    port: 0,
    region: 'demo',
    seed: 42,
    clientDist: join(dir, 'client'),
    regionsDir: join(dir, 'regions'),
    startUtc: Date.UTC(2026, 11, 21, 13, 0),
    utcOffset: 1,
    dayLengthMinutes: 30,
    weather: 'rain',
    defsDir: join(dir, 'defs'),
    rawDir: join(dir, 'raw'),
    startsDir: join(dir, 'starts'),
    accountsDir: join(dir, 'accounts'),
    importer: [process.execPath, join(dir, 'importer.mjs')],
    importerCwd: dir,
    rejoinSeconds: 0.6,
  });
  port = (await server.listen()).port;
});

afterAll(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

interface Client {
  ws: WebSocket;
  id: string;
  /** The next message of this type not yet taken. */
  next<T extends ServerMessage['type']>(type: T): Promise<Of<T>>;
  /** The first message of this type, already received or still to come, that passes `test`. */
  waitFor<T extends ServerMessage['type']>(type: T, test: (m: Of<T>) => boolean): Promise<Of<T>>;
  /** Every message of this type received so far. */
  seen<T extends ServerMessage['type']>(type: T): Of<T>[];
  /** Forgets what has been received. */
  clear(): void;
}

/** Joins as a player and collects what the server sends, checking each against the schema. */
function connect(name?: string, color?: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const all: ServerMessage[] = [];
    let taken = new Set<ServerMessage>();
    const waiters: (() => void)[] = [];
    const find = <T extends ServerMessage['type']>(type: T, test: (m: Of<T>) => boolean, take: boolean): Of<T> | undefined => {
      const m = all.find((x) => x.type === type && !(take && taken.has(x)) && test(x as Of<T>)) as Of<T> | undefined;
      if (m && take) taken.add(m);
      return m;
    };
    const wait = <T extends ServerMessage['type']>(type: T, test: (m: Of<T>) => boolean, take: boolean): Promise<Of<T>> =>
      new Promise((done) => {
        const check = (): void => {
          const m = find(type, test, take);
          if (m) done(m);
          else waiters.push(check);
        };
        check();
      });
    const client: Client = {
      ws,
      id: '',
      next: (type) => wait(type, () => true, true),
      waitFor: (type, test) => wait(type, test, false),
      seen: (type) => all.filter((m) => m.type === type) as never,
      clear: () => {
        all.length = 0;
        taken = new Set();
      },
    };
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (!isServerMessage(msg)) reject(new Error(`not a server message: ${data.toString()}`));
      all.push(msg);
      if (msg.type === 'welcome') {
        client.id = msg.playerId;
        resolve(client);
      }
      for (const w of waiters.splice(0)) w();
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, ...(name !== undefined && { name }), ...(color && { color }), ...(token && { token }) })));
    ws.on('error', reject);
  });
}

/** Opens a socket, sends one raw frame and resolves with the first reply. */
function exchange(payload: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => ws.send(payload));
    ws.on('message', (data) => {
      resolve(JSON.parse(data.toString()));
      ws.close();
    });
    ws.on('error', reject);
  });
}

describe('http', () => {
  it('serves the client and marks hashed assets immutable', async () => {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('spar');
    const asset = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
  });

  it('serves region files', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/regions/demo/index.json`);
    expect(await res.json()).toEqual({ name: 'demo' });
  });

  it('lists the imported regions', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/regions/list.json`);
    expect(await res.json()).toEqual({ default: 'demo', regions: [{ name: 'demo', title: 'demo', size: 0 }] });
  });

  it('answers 304 when the browser already has the current file', async () => {
    const url = `http://127.0.0.1:${port}/regions/demo/index.json`;
    const etag = (await fetch(url)).headers.get('etag')!;
    expect(etag).toMatch(/^".+"$/);
    const again = await fetch(url, { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expect((await fetch(url, { headers: { 'If-None-Match': '"stale"' } })).status).toBe(200);
  });

  it('refuses to leave the served folders', async () => {
    for (const path of ['/regions/..%2fsecret.txt', '/regions/%2e%2e/secret.txt', '/..%2f..%2fsecret.txt']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect([403, 404], path).toContain(res.status);
      expect(await res.text()).not.toContain('nope');
    }
  });

  it('answers 404 for missing files and 405 for writes', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/missing.js`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('areas', () => {
  const url = (path: string): string => `http://127.0.0.1:${port}${path}`;

  it('makes an area, reports progress, and removes it again', async () => {
    const res = await fetch(url('/api/areas'), {
      method: 'POST',
      body: JSON.stringify({ title: 'Hammarbybacken Öst', west: 676016, north: 6578463, size: 2048 }),
    });
    expect(res.status).toBe(202);
    const { name } = (await res.json()) as { name: string };
    expect(name).toBe('hammarbybacken-ost');
    type Progress = { state: string; lines: string[] } | null;
    const progress = async (): Promise<Progress> => ((await (await fetch(url('/api/areas'))).json()) as { job: Progress }).job;
    let job = await progress();
    for (let i = 0; i < 50 && job?.state !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = await progress();
    }
    expect(job?.state).toBe('done');
    expect(job?.lines).toEqual(['fetch hammarbybacken-ost', 'build hammarbybacken-ost']);
    const listed = (await (await fetch(url('/regions/list.json'))).json()) as { regions: { name: string }[] };
    expect(listed.regions.map((r) => r.name)).toContain(name);

    expect((await fetch(url(`/api/areas/${name}`), { method: 'DELETE' })).status).toBe(200);
    const after = (await (await fetch(url('/regions/list.json'))).json()) as { regions: { name: string }[] };
    expect(after.regions.map((r) => r.name)).not.toContain(name);
  });

  it('refuses areas outside Sweden, odd sizes, and the running area', async () => {
    const post = (body: object): Promise<Response> => fetch(url('/api/areas'), { method: 'POST', body: JSON.stringify(body) });
    expect((await post({ title: 'Oslo', west: 100000, north: 6650000, size: 2048 })).status).toBe(400);
    expect((await post({ title: 'Odd', west: 676016, north: 6578463, size: 3000 })).status).toBe(400);
    expect((await fetch(url('/api/areas/demo'), { method: 'DELETE' })).status).toBe(400);
  });

  it('keeps start points placed by hand, for the host to change', async () => {
    expect(await (await fetch(url('/api/starts/demo'))).json()).toEqual([]);
    const put = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
      fetch(url('/api/starts/demo'), { method: 'PUT', headers, body: JSON.stringify(body) });
    const mine = [{ name: 'Bryggan', x: 512.34, z: 900, heading: 90 }];
    expect((await put(mine)).status).toBe(200);
    expect(await (await fetch(url('/api/starts/demo'))).json()).toEqual([{ name: 'Bryggan', x: 512.3, z: 900, heading: 90 }]);
    expect((await put([{ name: '', x: 1, z: 1, heading: 0 }])).status).toBe(400);
    expect((await put(mine, { 'X-Forwarded-For': '192.168.1.20' })).status).toBe(403);
    expect((await fetch(url('/api/starts/nowhere'), { method: 'PUT', body: '[]' })).status).toBe(404);
  });

  it('only lets the host make areas', async () => {
    const res = await fetch(url('/api/areas'), {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.168.1.20' },
      body: JSON.stringify({ title: 'Sneaky', west: 676016, north: 6578463, size: 2048 }),
    });
    expect(res.status).toBe(403);
    const info = (await (await fetch(url('/api/areas'), { headers: { 'X-Forwarded-For': '192.168.1.20' } })).json()) as { enabled: boolean };
    expect(info.enabled).toBe(false);
  });
});

describe('websocket', () => {
  it('answers hello with a schema-valid welcome', async () => {
    const msg = await exchange(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION }));
    expect(isServerMessage(msg)).toBe(true);
    expect(msg).toMatchObject({ type: 'welcome', region: 'demo', seed: 42, protocol: PROTOCOL_VERSION });
  });

  it('follows the welcome with the time and the weather, and keeps sending them', async () => {
    const a = await connect();
    const first = await a.next('world');
    const later = await a.next('world');
    expect(first.time.utcOffset).toBe(1);
    expect(first.time.rate).toBe(48); // a day in 30 minutes
    expect(first.time.utc).toBeGreaterThanOrEqual(Date.UTC(2026, 11, 21, 13, 0));
    expect(first.weather.state).toBe('rain'); // pinned by the configuration
    expect(later.time.utc).toBeGreaterThan(first.time.utc + 30000); // well over a real second has passed
    a.ws.close();
  }, 10000);

  it('passes a change to the clock and weather on to every player at once, and says who did it', async () => {
    const a = await connect('Anna');
    const b = await connect('Bo');
    await a.next('world');
    await b.next('world');
    b.clear();
    a.ws.send(JSON.stringify({ type: 'set_world', hour: 6, dayMinutes: 0, weather: 'clear' }));
    const seen = await b.next('world');
    expect(seen.weather.state).toBe('clear');
    expect(seen.time.rate).toBe(0);
    expect(seen.time.utc).toBe(Date.UTC(2026, 11, 21, 5, 0)); // 06:00 local, same day
    expect((await b.next('chat')).text).toBe('Anna set the clock to 06:00, stopped the clock and set the weather to clear');
    a.ws.close();
    b.ws.close();
  });

  it('lists the players, passes vehicles and chat on, and tells when someone leaves', async () => {
    const a = await connect('  Anna  ');
    const b = await connect('', '#8e3b2d');
    const list = await a.waitFor('players', (m) => m.players.length >= 2 && m.players.some((p) => p.id === b.id));
    const named = list.players.find((p) => p.id === b.id)!;
    expect(named.name).toMatch(/^Driver \d+$/);
    expect(named.color).toBe('#8e3b2d');
    expect(list.players.find((p) => p.id === a.id)!.name).toBe('Anna');
    expect((await a.waitFor('chat', (m) => m.text.endsWith('joined') && m.text.startsWith('Driver'))).from).toBeUndefined();

    const vehicle = {
      region: 'demo', vehicle: 'tgb11', jump: 1, t: 1234.5, paused: false,
      p: [1, 2, 3], q: [0, 0, 0, 1], v: [4, 0, 0],
      wheels: [[0.1, 0.3, 0, 0.2, 0, 0.1, 0], [0.1, 0.3, 0, 0.2, 0, 0, 0], [0, 0.3, 0.05, 0, 0, 0, 0], [0, 0.3, 0.05, 0, 0, 0, 0]],
      ground: ['dirt', 'dirt', 'bog', ''],
      engine: { rpm: 1800, gear: 2, low: false, shifting: false, pedal: 0.4, drowned: false },
      wading: 0,
      lights: true, braking: false,
    };
    a.ws.send(JSON.stringify({ type: 'state', vehicle }));
    const relayed = await b.next('state');
    expect(relayed).toEqual({ type: 'state', id: a.id, vehicle });
    expect(isServerMessage(relayed)).toBe(true);

    // A push goes only to the driver pushed, with who pushed.
    a.ws.send(JSON.stringify({ type: 'push', to: b.id, impulse: [500, 0, -20], at: [1, 2, 4] }));
    expect(await b.next('push')).toEqual({ type: 'push', from: a.id, to: b.id, impulse: [500, 0, -20], at: [1, 2, 4] });

    b.ws.send(JSON.stringify({ type: 'chat', text: ' hej! ' }));
    const line = await a.waitFor('chat', (m) => m.from === b.id);
    expect(line).toMatchObject({ name: named.name, text: 'hej!' });
    // The sender hears it too, as a sign it went out.
    expect((await b.waitFor('chat', (m) => m.from === b.id)).text).toBe('hej!');

    a.ws.send(JSON.stringify({ type: 'profile', name: 'Anna V', color: '#c9a44a' }));
    const renamed = await b.waitFor('players', (m) => m.players.some((p) => p.name === 'Anna V'));
    expect(renamed.players.find((p) => p.id === a.id)!.color).toBe('#c9a44a');
    expect((await b.waitFor('chat', (m) => m.text.includes('is now called'))).text).toBe('Anna is now called Anna V');

    a.ws.send(JSON.stringify({ type: 'away' }));
    expect((await b.next('away')).id).toBe(a.id);
    a.ws.close();
    expect((await b.waitFor('chat', (m) => m.text.endsWith('left'))).text).toBe('Anna V left');
    const left = await b.waitFor('players', (m) => !m.players.some((p) => p.id === a.id));
    expect(left.players.some((p) => p.id === b.id)).toBe(true);
    b.ws.close();
  });

  it('keeps a dropped player\'s place for a while, then tells the others they left', async () => {
    const watcher = await connect('Bo');
    const a = await connect('Anna', undefined, 'tab-anna-1');
    a.ws.close();
    await new Promise((r) => setTimeout(r, 150));
    const back = await connect('Anna', undefined, 'tab-anna-1');
    expect(back.id).toBe(a.id);
    // Gone again, and this time not back in time.
    back.ws.close();
    const left = await watcher.waitFor('chat', (m) => m.text === 'Anna left');
    expect(left.from).toBeUndefined();
    expect(watcher.seen('chat').filter((m) => m.text === 'Anna joined')).toHaveLength(1);
    expect(watcher.seen('chat').filter((m) => m.text === 'Anna left')).toHaveLength(1);
    const again = await connect('Anna', undefined, 'tab-anna-1');
    expect(again.id).not.toBe(a.id);
    again.ws.close();
    watcher.ws.close();
  });

  it('keeps felled trees and ice holes per region, for whoever enters it later', async () => {
    const a = await connect('Anna');
    const b = await connect('Bo');
    a.ws.send(JSON.stringify({ type: 'room', region: 'demo' }));
    expect(await a.next('room')).toEqual({ type: 'room', region: 'demo', felled: [], holes: [] });
    b.ws.send(JSON.stringify({ type: 'room', region: 'demo' }));
    await b.next('room');
    const listed = await a.waitFor('players', (m) => m.players.some((p) => p.id === b.id && p.region === 'demo'));
    expect(listed.players.find((p) => p.id === a.id)!.region).toBe('demo');

    const tree = { key: '2:-14:803', x: 120.5, z: 340.25, dx: 0.6, dz: -0.8, diameter: 0.12 };
    a.ws.send(JSON.stringify({ type: 'felled', region: 'demo', tree }));
    expect(await b.next('felled')).toEqual({ type: 'felled', region: 'demo', tree });
    a.ws.send(JSON.stringify({ type: 'ice_hole', region: 'demo', hole: { x: 50, z: 60 } }));
    expect(await b.next('ice_hole')).toEqual({ type: 'ice_hole', region: 'demo', hole: { x: 50, z: 60 } });
    // The same hole again, and a change in another region, are not passed on here.
    a.ws.send(JSON.stringify({ type: 'ice_hole', region: 'demo', hole: { x: 51, z: 60 } }));
    a.ws.send(JSON.stringify({ type: 'felled', region: 'other', tree: { ...tree, key: '2:1:1' } }));

    // Late to the region: it is all there.
    const c = await connect('Cilla');
    c.ws.send(JSON.stringify({ type: 'room', region: 'demo' }));
    expect(await c.next('room')).toEqual({ type: 'room', region: 'demo', felled: [tree], holes: [{ x: 50, z: 60 }] });
    await new Promise((r) => setTimeout(r, 100));
    expect(b.seen('ice_hole')).toHaveLength(1);
    expect(b.seen('felled')).toHaveLength(1);
    expect(a.seen('felled')).toHaveLength(0);
    for (const p of [a, b, c]) p.ws.close();
  });

  it('tells where others can open the game', async () => {
    const a = await connect('Anna');
    const welcome = a.seen('welcome')[0]!;
    // The test server listens on 127.0.0.1 only, but tells the machine's network addresses.
    for (const address of welcome.addresses ?? []) expect(address).toMatch(/^http:\/\/[\d.]+:\d+$/);
    a.ws.close();
  });

  it('shares a destination with everyone in the region, and passes on arrivals', async () => {
    const a = await connect('Anna');
    const b = await connect('Bo');
    const elsewhere = await connect('Cilla');
    a.ws.send(JSON.stringify({ type: 'room', region: 'trip' }));
    b.ws.send(JSON.stringify({ type: 'room', region: 'trip' }));
    elsewhere.ws.send(JSON.stringify({ type: 'room', region: 'demo' }));
    expect((await b.next('room')).shared).toBeUndefined();
    await a.next('room');
    await elsewhere.next('room');

    const hut = { name: 'Blåhammaren', x: 4100.5, z: 2200, kind: 'hut' };
    a.ws.send(JSON.stringify({ type: 'share', region: 'trip', destination: hut }));
    expect(await b.next('share')).toEqual({ type: 'share', region: 'trip', destination: hut, by: a.id });
    a.ws.send(JSON.stringify({ type: 'arrived', region: 'trip', destination: hut }));
    expect(await b.next('arrived')).toEqual({ type: 'arrived', region: 'trip', destination: hut, id: a.id });
    // Bo arrives too: everyone in the region is there, and both are told, once.
    b.ws.send(JSON.stringify({ type: 'arrived', region: 'trip', destination: hut }));
    expect((await a.waitFor('chat', (m) => m.text.startsWith('Everyone'))).text).toBe('Everyone has arrived at Blåhammaren');
    await b.waitFor('chat', (m) => m.text.startsWith('Everyone'));
    expect(elsewhere.seen('chat').filter((m) => m.text.startsWith('Everyone'))).toHaveLength(0);

    // Late to the region: the shared destination comes with the room.
    const d = await connect('Dan');
    d.ws.send(JSON.stringify({ type: 'room', region: 'trip' }));
    expect((await d.next('room')).shared).toEqual({ destination: hut, by: a.id });

    // Stopped sharing: gone for those after, and the others are told.
    b.ws.send(JSON.stringify({ type: 'share', region: 'trip', destination: null }));
    expect(await a.next('share')).toEqual({ type: 'share', region: 'trip', destination: null, by: b.id });
    d.ws.send(JSON.stringify({ type: 'room', region: 'trip' }));
    expect((await d.next('room')).shared).toBeUndefined();

    await new Promise((r) => setTimeout(r, 100));
    expect(a.seen('chat').filter((m) => m.text.startsWith('Everyone'))).toHaveLength(1);
    expect(elsewhere.seen('share')).toHaveLength(0);
    expect(elsewhere.seen('arrived')).toHaveLength(0);
    // Only Bo's arrival, not her own.
    expect(a.seen('arrived').map((m) => m.id)).toEqual([b.id]);
    for (const p of [a, b, elsewhere, d]) p.ws.close();
  });

  it('winching each other: the puller runs the vehicle it hooks on to, and gives it back', async () => {
    const vehicle = (x: number) => ({
      region: 'demo', vehicle: 'tgb11', jump: 0, t: 1, paused: false,
      p: [x, 2, 3], q: [0, 0, 0, 1], v: [0, 0, 0], wheels: [], ground: [],
      engine: { rpm: 800, gear: 1, low: false, shifting: false, pedal: 0, drowned: false },
      wading: 0, lights: false, braking: false,
    });
    const a = await connect('Anna');
    const b = await connect('Bo');
    const c = await connect('Cecilia');
    for (const k of [a, b, c]) {
      k.ws.send(JSON.stringify({ type: 'room', region: 'demo' }));
      await k.next('room');
    }
    a.ws.send(JSON.stringify({ type: 'state', vehicle: vehicle(0) }));
    b.ws.send(JSON.stringify({ type: 'state', vehicle: vehicle(20) }));
    await c.waitFor('state', (m) => m.id === b.id);

    // Only the browser running a winch may hook it.
    c.ws.send(JSON.stringify({ type: 'cable', from: a.id, to: b.id, seq: 1 }));
    expect(await c.waitFor('towing', (m) => m.ack === 1)).toMatchObject({ cables: [], runs: [] });
    // Nor on to a vehicle that is not on the road.
    a.ws.send(JSON.stringify({ type: 'cable', from: a.id, to: c.id, seq: 1 }));
    expect(await a.waitFor('towing', (m) => m.ack === 1)).toMatchObject({ cables: [] });

    a.ws.send(JSON.stringify({ type: 'cable', from: a.id, to: b.id, seq: 2 }));
    const hooked = await a.waitFor('towing', (m) => m.ack === 2);
    expect(hooked).toMatchObject({ cables: [{ from: a.id, to: b.id }], runs: [{ vehicle: b.id, by: a.id }] });
    // Everyone hears it, each with their own ack.
    expect(await c.waitFor('towing', (m) => m.cables.length === 1)).toMatchObject({ ack: 1 });

    // Bo's browser hands his vehicle over; his controls go to Anna's.
    const state = {
      vehicle: 'tgb11', jump: 0, p: [20, 2, 3], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
      wheels: [[0, 0, 0.3, 0]], gear: 1, low: false, rpm: 800, locks: [false], holding: true, drowned: false, steer: 0,
    };
    b.ws.send(JSON.stringify({ type: 'handover', vehicle: b.id, to: a.id, state }));
    expect(await a.next('handover')).toEqual({ type: 'handover', from: b.id, vehicle: b.id, state });
    const controls = { throttle: 0.5, brake: 0, steer: 0.1, handbrake: false, digital: true, pull: false, slack: false, lights: true, range: true };
    b.ws.send(JSON.stringify({ type: 'drive', controls }));
    expect(await a.next('drive')).toEqual({ type: 'drive', from: b.id, controls });

    // From now on Anna's browser speaks for Bo's vehicle; Bo's own word is not passed on.
    b.ws.send(JSON.stringify({ type: 'state', vehicle: vehicle(99) }));
    a.ws.send(JSON.stringify({ type: 'state', of: b.id, vehicle: vehicle(21) }));
    const relayed = await c.waitFor('state', (m) => m.id === b.id && m.by === a.id);
    expect(relayed.vehicle.p[0]).toBe(21);
    expect((await b.waitFor('state', (m) => m.id === b.id)).by).toBe(a.id);
    expect(c.seen('state').some((m) => m.vehicle.p[0] === 99)).toBe(false);
    // A push on Bo's vehicle goes to Anna's browser, which moves it.
    c.ws.send(JSON.stringify({ type: 'push', to: b.id, impulse: [500, 0, 0], at: [20, 2, 3] }));
    expect(await a.next('push')).toMatchObject({ from: c.id, to: b.id });

    // Anna leaves: the cable comes off and Bo runs his own vehicle again.
    a.ws.close();
    expect(await b.waitFor('towing', (m) => m.runs.length === 0)).toMatchObject({ cables: [] });
    b.ws.close();
    c.ws.close();
  });

  it('passes on nothing before hello, and refuses a malformed vehicle', async () => {
    const a = await connect('Anna');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'chat', text: 'sneaky' }));
    const reply = await new Promise<unknown>((resolve) => {
      ws.on('message', (d) => resolve(JSON.parse(d.toString())));
      ws.send(JSON.stringify({ type: 'state', vehicle: { region: 'demo' } }));
    });
    expect(reply).toMatchObject({ type: 'error', code: 'bad_message' });
    await new Promise((r) => setTimeout(r, 100));
    expect(a.seen('chat').some((m) => m.text === 'sneaky')).toBe(false);
    ws.close();
    a.ws.close();
  });

  it('gives each connection its own player id', async () => {
    const hello = JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION });
    const [a, b] = (await Promise.all([exchange(hello), exchange(hello)])) as { playerId: string }[];
    expect(a!.playerId).not.toBe(b!.playerId);
  });

  it('rejects another protocol version', async () => {
    const msg = await exchange(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION + 1 }));
    expect(msg).toMatchObject({ type: 'error', code: 'protocol_mismatch' });
  });

  it('rejects garbage and unknown messages', async () => {
    expect(await exchange('not json')).toMatchObject({ type: 'error', code: 'bad_message' });
    expect(await exchange('{"type":"teleport"}')).toMatchObject({ type: 'error', code: 'bad_message' });
  });
});
