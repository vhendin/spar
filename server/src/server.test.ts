import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@spar/shared';
import { isServerMessage } from '@spar/shared/validate';
import { createGameServer, type GameServer } from './server';

type WorldUpdate = Extract<ServerMessage, { type: 'world' }>;

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
    importer: [process.execPath, join(dir, 'importer.mjs')],
    importerCwd: dir,
  });
  port = (await server.listen()).port;
});

afterAll(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

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
    const messages = await new Promise<unknown[]>((resolve, reject) => {
      const got: unknown[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION })));
      ws.on('message', (data) => {
        got.push(JSON.parse(data.toString()));
        if (got.length === 3) {
          ws.close();
          resolve(got);
        }
      });
      ws.on('error', reject);
    });
    expect(messages.every((m) => isServerMessage(m))).toBe(true);
    const [welcome, first, later] = messages as [{ type: string }, WorldUpdate, WorldUpdate];
    expect(welcome.type).toBe('welcome');
    expect(first.type).toBe('world');
    expect(first.time.utcOffset).toBe(1);
    expect(first.time.rate).toBe(48); // a day in 30 minutes
    expect(first.time.utc).toBeGreaterThanOrEqual(Date.UTC(2026, 11, 21, 13, 0));
    expect(first.weather.state).toBe('rain'); // pinned by the configuration
    expect(later.time.utc).toBeGreaterThan(first.time.utc + 30000); // well over a real second has passed
  }, 10000);

  it('passes a change to the clock and weather on to every player at once', async () => {
    const join = (): Promise<{ ws: WebSocket; next: () => Promise<WorldUpdate> }> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const queue: WorldUpdate[] = [];
        let waiting: ((m: WorldUpdate) => void) | null = null;
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          if (msg.type === 'welcome') resolve({ ws, next });
          if (msg.type !== 'world') return;
          if (waiting) { waiting(msg); waiting = null; } else queue.push(msg);
        });
        const next = (): Promise<WorldUpdate> => new Promise((r) => (queue.length ? r(queue.shift()!) : (waiting = r)));
        ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION })));
        ws.on('error', reject);
      });
    const [a, b] = await Promise.all([join(), join()]);
    await Promise.all([a.next(), b.next()]); // the update that follows each welcome
    a.ws.send(JSON.stringify({ type: 'set_world', hour: 6, dayMinutes: 0, weather: 'clear' }));
    const seen = await b.next();
    expect(isServerMessage(seen)).toBe(true);
    expect(seen.weather.state).toBe('clear');
    expect(seen.time.rate).toBe(0);
    expect(seen.time.utc).toBe(Date.UTC(2026, 11, 21, 5, 0)); // 06:00 local, same day
    a.ws.close();
    b.ws.close();
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
