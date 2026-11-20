// Who is asking, as Cloudflare Access vouches for it. Behind Access every request carries a
// token signed by Cloudflare (the Cf-Access-Jwt-Assertion header, and the CF_Authorization
// cookie); it is checked against the team's public keys, so a request that did not come
// through Access (from the home network, say) has no identity, whatever headers it sends.

import { createPublicKey, verify, type JsonWebKeyInput, type KeyObject } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface AccessConfig {
  /** The team domain, as "example.cloudflareaccess.com". */
  team: string;
  /** The Access application's audience tag. */
  aud: string;
}

/** One of the team's public keys, as JSON Web Key. */
export type Jwk = JsonWebKeyInput['key'] & { kid?: string };
/** Fetches the team's public keys (the JSON at /cdn-cgi/access/certs). */
export type CertsFetcher = (url: string) => Promise<{ keys?: Jwk[] }>;

const defaultFetch: CertsFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as { keys?: Jwk[] };
};

/** Seconds of difference between clocks allowed. */
const SKEW = 60;
/** Keys are fetched again after this long, or sooner when a token names an unknown key. */
const KEYS_MAX_AGE = 6 * 3600_000;
/** But not more often than this. */
const KEYS_MIN_AGE = 60_000;

/** "example" or "https://example.cloudflareaccess.com/" as "example.cloudflareaccess.com". */
export function teamDomain(value: string): string {
  const host = value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  return host.includes('.') ? host : `${host}.cloudflareaccess.com`;
}

function base64url(text: string): Buffer {
  return Buffer.from(text, 'base64url');
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export class AccessVerifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private fetching: Promise<void> | null = null;

  constructor(
    private readonly config: AccessConfig,
    private readonly fetchCerts: CertsFetcher = defaultFetch,
  ) {}

  /** The logged-in email of a request, or null when it did not come through Access. */
  async email(req: IncomingMessage): Promise<string | null> {
    const header = req.headers['cf-access-jwt-assertion'];
    const token = (Array.isArray(header) ? header[0] : header) ?? cookie(req, 'CF_Authorization');
    return token ? this.check(token) : null;
  }

  /** The email in a token, or null when the token is not good. */
  async check(token: string, now = Date.now()): Promise<string | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let head: { alg?: string; kid?: string };
    let claims: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
    try {
      head = JSON.parse(base64url(parts[0]!).toString()) as typeof head;
      claims = JSON.parse(base64url(parts[1]!).toString()) as typeof claims;
    } catch {
      return null;
    }
    if (head.alg !== 'RS256' || !head.kid) return null;
    const key = await this.key(head.kid, now);
    if (!key) return null;
    const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, base64url(parts[2]!));
    if (!signed) return null;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(this.config.aud)) return null;
    if (claims.iss !== `https://${this.config.team}`) return null;
    const seconds = now / 1000;
    if (typeof claims.exp !== 'number' || claims.exp + SKEW < seconds) return null;
    if (typeof claims.nbf === 'number' && claims.nbf - SKEW > seconds) return null;
    if (typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
    return claims.email.trim().toLowerCase();
  }

  private async key(kid: string, now: number): Promise<KeyObject | null> {
    const age = now - this.fetchedAt;
    if (age > KEYS_MAX_AGE || (!this.keys.has(kid) && age > KEYS_MIN_AGE)) await this.refresh(now);
    return this.keys.get(kid) ?? null;
  }

  private refresh(now: number): Promise<void> {
    this.fetching ??= this.fetchCerts(`https://${this.config.team}/cdn-cgi/access/certs`)
      .then((certs) => {
        const keys = new Map<string, KeyObject>();
        for (const jwk of certs.keys ?? []) {
          if (!jwk.kid) continue;
          try {
            keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
          } catch {
            // Not a key we can use.
          }
        }
        this.keys = keys;
        this.fetchedAt = now;
      })
      .catch((err: unknown) => {
        // Tried again after a minute; until then the keys known stay.
        this.fetchedAt = now - KEYS_MAX_AGE + KEYS_MIN_AGE;
        console.error('Could not fetch the Cloudflare Access keys:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        this.fetching = null;
      });
    return this.fetching;
  }
}
