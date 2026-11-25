// What follows a logged-in driver from browser to browser: the browser's own stored values
// under these keys, kept on the server per account. The logbook is merged rather than
// replaced, so arrivals made on two devices are all kept; so is what has been seen of each
// region.

import { mergeSeen } from './seen';

/** The browser storage keys kept per account, besides one per region for what has been seen. */
export const ACCOUNT_KEYS = [
  'spar.name',
  'spar.color',
  'spar.region',
  'spar.vehicle',
  'spar.start',
  'spar.last',
  'spar.logbook',
  'spar.settings',
  'spar.minimap',
  'spar.gamepad',
] as const;

export type AccountKey = (typeof ACCOUNT_KEYS)[number];

export const LOGBOOK_KEY = 'spar.logbook';
/** Most logbook entries kept; the oldest go first. */
export const LOGBOOK_MAX = 500;
/** Longest value kept under one key, in characters. */
export const ACCOUNT_VALUE_MAX = 300_000;

/** What has been seen of each region is kept under a key per region, `spar.seen.<region>`. */
const SEEN_KEY = /^spar\.seen\.[a-z0-9_-]{1,64}$/;

export function isAccountKey(key: string): boolean {
  return (ACCOUNT_KEYS as readonly string[]).includes(key) || SEEN_KEY.test(key);
}

/**
 * Two values of a key that is merged rather than replaced (the logbook, what has been seen),
 * as one; null for any other key, where the newer value simply wins.
 */
export function mergeAccountValue(key: string, kept: string | null | undefined, incoming: string | null | undefined): string | null {
  if (key === LOGBOOK_KEY) return mergeLogbooks(kept, incoming);
  if (SEEN_KEY.test(key)) return mergeSeen(kept, incoming);
  return null;
}

interface Entry {
  destination: string;
  at: number;
  with?: string[];
}

function entries(text: string | null | undefined): Entry[] {
  try {
    const list: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(list)
      ? list.filter((e): e is Entry => !!e && typeof e === 'object' && typeof (e as Entry).at === 'number' && typeof (e as Entry).destination === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Two logbooks (as stored, JSON text) as one: every arrival once, in time order, the
 * company of an arrival told in either kept. The newest LOGBOOK_MAX entries are kept.
 */
export function mergeLogbooks(a: string | null | undefined, b: string | null | undefined): string {
  const byArrival = new Map<string, Entry>();
  for (const e of [...entries(a), ...entries(b)]) {
    const key = `${e.at}|${e.destination}`;
    const seen = byArrival.get(key);
    if (!seen) {
      byArrival.set(key, e);
      continue;
    }
    const company = [...new Set([...(seen.with ?? []), ...(e.with ?? [])])];
    if (company.length) byArrival.set(key, { ...seen, with: company });
  }
  const merged = [...byArrival.values()].sort((x, y) => x.at - y.at).slice(-LOGBOOK_MAX);
  return JSON.stringify(merged);
}
