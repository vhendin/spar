import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@spar/shared';
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
  server = createGameServer({
    host: '127.0.0.1',
    port: 0,
    region: 'demo',
    seed: 42,
    clientDist: join(dir, 'client'),
    regionsDir: join(dir, 'regions'),
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

describe('websocket', () => {
  it('answers hello with a schema-valid welcome', async () => {
    const msg = await exchange(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION }));
    expect(isServerMessage(msg)).toBe(true);
    expect(msg).toMatchObject({ type: 'welcome', region: 'demo', seed: 42, protocol: PROTOCOL_VERSION });
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
