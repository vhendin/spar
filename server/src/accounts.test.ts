import { generateKeyPairSync, sign } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mergeLogbooks } from '@spar/shared';
import { AccessVerifier, teamDomain, type Jwk } from './access';
import { AccountStore, cleanChanges } from './accounts';
import { loadConfig } from './config';
import { createGameServer, type GameServer } from './server';

const TEAM = 'testteam.cloudflareaccess.com';
const AUD = 'aud-tag-1234';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk: Jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };

/** A token as Cloudflare Access signs it, with claims changed as asked. */
function token(claims: Record<string, unknown> = {}, key = privateKey, kid = 'k1'): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ alg: 'RS256', kid, typ: 'JWT' })}.${part({ aud: [AUD], iss: `https://${TEAM}`, email: 'Anna@Example.se', iat: now, nbf: now, exp: now + 3600, ...claims })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

let fetches = 0;
const verifier = () =>
  new AccessVerifier({ team: TEAM, aud: AUD }, async () => {
    fetches++;
    return { keys: [jwk] };
  });

describe('logins through Cloudflare Access', () => {
  it('takes the email from a token signed by the team, from the header or the cookie', async () => {
    const access = verifier();
    expect(await access.check(token())).toBe('anna@example.se');
    const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
    expect(await access.email(req({ 'cf-access-jwt-assertion': token() }))).toBe('anna@example.se');
    expect(await access.email(req({ cookie: `a=b; CF_Authorization=${token()}` }))).toBe('anna@example.se');
    expect(await access.email(req({ 'cf-access-authenticated-user-email': 'anna@example.se' }))).toBeNull();
  });

  it('refuses tokens signed by others, for another application or team, or out of date', async () => {
    const access = verifier();
    expect(await access.check(token({}, other.privateKey))).toBeNull();
    expect(await access.check(token({ aud: ['someone-else'] }))).toBeNull();
    expect(await access.check(token({ iss: 'https://evil.cloudflareaccess.com' }))).toBeNull();
    expect(await access.check(token({ exp: Math.floor(Date.now() / 1000) - 3600 }))).toBeNull();
    expect(await access.check(token({ email: undefined }))).toBeNull();
    expect(await access.check('not.a.token')).toBeNull();
    // An unknown key is looked for again, but not more than once a minute.
    fetches = 0;
    expect(await access.check(token({}, privateKey, 'k2'))).toBeNull();
    expect(await access.check(token({}, privateKey, 'k2'))).toBeNull();
    expect(fetches).toBe(0);
  });

  it('reads the team and audience from the environment, both or neither', () => {
    expect(teamDomain('https://Vhendin.cloudflareaccess.com/')).toBe('vhendin.cloudflareaccess.com');
    expect(teamDomain('vhendin')).toBe('vhendin.cloudflareaccess.com');
    expect(loadConfig({ ACCESS_TEAM: 'vhendin', ACCESS_AUD: 'abc' }).access).toEqual({ team: 'vhendin.cloudflareaccess.com', aud: 'abc' });
    expect(loadConfig({})).not.toHaveProperty('access');
    expect(() => loadConfig({ ACCESS_TEAM: 'vhendin' })).toThrow(/ACCESS_AUD/);
  });
});

const entry = (at: number, destination = 'Hut', withs?: string[]) => ({ region: 'r', destination, vehicle: 'v', date: '1 Jan', season: 'winter', seconds: 10, metres: 20, at, ...(withs ? { with: withs } : {}) });

describe('accounts', () => {
  it('merge logbooks: every arrival once, in time order, company from either', () => {
    const a = JSON.stringify([entry(3), entry(1, 'Hut', ['Bo'])]);
    const b = JSON.stringify([entry(1, 'Hut', ['Cilla']), entry(2, 'Peak')]);
    const merged = JSON.parse(mergeLogbooks(a, b)) as ReturnType<typeof entry>[];
    expect(merged.map((e) => e.at)).toEqual([1, 2, 3]);
    expect(merged[0]!.with).toEqual(['Bo', 'Cilla']);
    expect(mergeLogbooks('garbage', null)).toBe('[]');
  });

  it('keep only known keys, as text', () => {
    expect(cleanChanges({ values: { 'spar.name': 'Anna', 'spar.color': null, 'spar.token': 'x', 'spar.minimap': 3 } })).toEqual({ 'spar.name': 'Anna', 'spar.color': null });
    expect(cleanChanges({ values: [] })).toBeNull();
    expect(cleanChanges(null)).toBeNull();
  });

  it('keep values per account in a file, merging the logbook', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spar-accounts-'));
    try {
      const store = new AccountStore(dir);
      await store.update('anna@example.se', { 'spar.name': 'Anna', 'spar.logbook': JSON.stringify([entry(1)]) });
      const back = await store.update('anna@example.se', { 'spar.logbook': JSON.stringify([entry(2)]) });
      expect(JSON.parse(back['spar.logbook']!)).toHaveLength(2);
      await store.update('anna@example.se', { 'spar.name': null });
      const values = await store.get('anna@example.se');
      expect(values['spar.name']).toBeUndefined();
      expect(JSON.parse(values['spar.logbook']!)).toHaveLength(2);
      expect(await store.get('bo@example.se')).toEqual({});
      // The email is not in the file name.
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).not.toContain('anna');
      expect(JSON.parse(await readFile(join(dir, files[0]!), 'utf8'))).toMatchObject({ email: 'anna@example.se' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('/api/me', () => {
  let dir: string;
  let server: GameServer;
  let base: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spar-me-'));
    server = createGameServer({ ...loadConfig({ PORT: '0', HOST: '127.0.0.1', ACCOUNTS_DIR: join(dir, 'accounts'), IMPORTER: 'none' }) }, { access: verifier() });
    base = `http://127.0.0.1:${(await server.listen()).port}/api/me`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const put = (headers: Record<string, string>, values: unknown) =>
    fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ values }) });

  it('tells a guest nothing and keeps nothing for them', async () => {
    expect(await (await fetch(base)).json()).toEqual({});
    expect((await put({ 'X-Spar': '1' }, { 'spar.name': 'X' })).status).toBe(403);
  });

  it('keeps what a logged-in driver sends, only from the game itself', async () => {
    const login = { 'Cf-Access-Jwt-Assertion': token() };
    expect((await put(login, { 'spar.name': 'Anna' })).status).toBe(403);
    expect((await put({ ...login, 'X-Spar': '1', 'Sec-Fetch-Site': 'cross-site' }, { 'spar.name': 'Anna' })).status).toBe(403);
    const res = await put({ ...login, 'X-Spar': '1' }, { 'spar.name': 'Anna', 'spar.logbook': JSON.stringify([entry(5)]) });
    expect(await res.json()).toEqual({ values: {} });
    expect(await (await fetch(base, { headers: login })).json()).toEqual({
      email: 'anna@example.se',
      values: { 'spar.name': 'Anna', 'spar.logbook': JSON.stringify([entry(5)]) },
    });
  });
});
