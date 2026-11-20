// The logged-in driver's account. Behind Cloudflare Access the server knows who is playing,
// and keeps the values under ACCOUNT_KEYS for them (name, paint, logbook, where they left
// off, settings): on loading, those are put in this browser's storage before anything reads
// it; afterwards whatever changed in storage is sent back now and then, and when the page
// is hidden. Players on the home network have no login and keep things in the browser only.

import { ACCOUNT_KEYS, LOGBOOK_KEY, mergeLogbooks } from '@spar/shared';

/** Seconds between looks for changes to send. */
const SYNC_EVERY = 5;

export interface Account {
  email: string;
}

/** Where the values live; localStorage in the game. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The account's values put in storage. Kept values win; the logbooks are merged; values this
 * browser has but the account does not (the first login) are to be sent. Returns those, and
 * what the server has had from this browser so far (the kept values), to compare with later.
 */
export function reconcile(store: KeyStore, kept: Record<string, string>): { send: Record<string, string>; sent: Record<string, string> } {
  const send: Record<string, string> = {};
  const sent: Record<string, string> = { ...kept };
  for (const key of ACCOUNT_KEYS) {
    const local = store.getItem(key);
    const theirs = kept[key];
    if (key === LOGBOOK_KEY && (local !== null || theirs !== undefined)) {
      const merged = mergeLogbooks(theirs, local);
      if (merged !== local) store.setItem(key, merged);
      if (merged !== theirs) send[key] = merged;
    } else if (theirs !== undefined) {
      if (theirs !== local) store.setItem(key, theirs);
    } else if (local !== null) {
      send[key] = local;
    }
  }
  return { send, sent };
}

/** What changed in storage since last sent: a value per key, null when removed. */
export function changes(store: KeyStore, sent: Record<string, string>): Record<string, string | null> {
  const changed: Record<string, string | null> = {};
  for (const key of ACCOUNT_KEYS) {
    const local = store.getItem(key);
    if (local !== (sent[key] ?? null)) changed[key] = local;
  }
  return changed;
}

function storage(): KeyStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Asks the server who is playing; for a logged-in driver, puts their values in storage and
 * keeps sending changes. Null for a guest, or when the server cannot be asked in time.
 */
export async function signIn(): Promise<Account | null> {
  const store = storage();
  if (!store) return null;
  let me: { email?: string; values?: Record<string, string> };
  try {
    const res = await fetch('/api/me', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    if (!res.ok) return null;
    me = (await res.json()) as typeof me;
  } catch {
    return null;
  }
  if (!me.email) return null;
  const { send, sent } = reconcile(store, me.values ?? {});
  let sending = false;
  const push = async (values: Record<string, string | null>, keepalive = false): Promise<void> => {
    if (Object.keys(values).length === 0) return;
    sending = true;
    try {
      const res = await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Spar': '1' },
        body: JSON.stringify({ values }),
        keepalive,
      });
      if (!res.ok) return;
      // Compared with what was sent, not with the merged logbook the server answers with:
      // this browser's logbook has the other devices' arrivals from the next visit on.
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete sent[key];
        else sent[key] = value;
      }
    } catch {
      // Tried again on the next look.
    } finally {
      sending = false;
    }
  };
  void push(send);
  setInterval(() => {
    if (!sending) void push(changes(store, sent));
  }, SYNC_EVERY * 1000);
  // Leaving or switching away: what changed goes at once. A keepalive request carries at most
  // 64 kB, so a big logbook waits for the next visit.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || sending) return;
    const changed = changes(store, sent);
    const size = JSON.stringify(changed).length;
    void push(changed, size < 60_000);
  });
  return { email: me.email };
}
