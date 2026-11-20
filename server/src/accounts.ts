// What is kept for each logged-in driver: the browser values under ACCOUNT_KEYS, one JSON
// file per account in the accounts folder, named by a hash of the email.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ACCOUNT_VALUE_MAX, isAccountKey, LOGBOOK_KEY, mergeLogbooks } from '@spar/shared';

export type AccountValues = Record<string, string>;

interface AccountFile {
  email: string;
  updated: number;
  values: AccountValues;
}

/** Changes from a browser: a value per key, null to forget it; anything else is left out. */
export function cleanChanges(body: unknown): Record<string, string | null> | null {
  const values = (body as { values?: unknown } | null)?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const changes: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!isAccountKey(key)) continue;
    if (value === null || (typeof value === 'string' && value.length <= ACCOUNT_VALUE_MAX)) changes[key] = value;
  }
  return changes;
}

export class AccountStore {
  /** Writes to one account wait for the one before. */
  private readonly queue = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private path(email: string): string {
    return join(this.dir, `${createHash('sha256').update(email).digest('hex').slice(0, 32)}.json`);
  }

  private async read(email: string): Promise<AccountFile> {
    try {
      const file = JSON.parse(await readFile(this.path(email), 'utf8')) as AccountFile;
      if (file.email === email && file.values && typeof file.values === 'object') return file;
    } catch {
      // New, or unreadable: starts empty.
    }
    return { email, updated: 0, values: {} };
  }

  private serial<T>(email: string, job: () => Promise<T>): Promise<T> {
    const next = (this.queue.get(email) ?? Promise.resolve()).then(job, job);
    const settled = next.catch(() => {});
    this.queue.set(email, settled);
    void settled.then(() => {
      if (this.queue.get(email) === settled) this.queue.delete(email);
    });
    return next;
  }

  /** Everything kept for an account. */
  get(email: string): Promise<AccountValues> {
    return this.serial(email, async () => (await this.read(email)).values);
  }

  /**
   * Keeps the changes; the logbook is merged with what is kept. Resolves with the values
   * that now differ from what was sent (the merged logbook), for the browser to take.
   */
  update(email: string, changes: Record<string, string | null>, now = Date.now()): Promise<AccountValues> {
    return this.serial(email, async () => {
      const file = await this.read(email);
      const back: AccountValues = {};
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) {
          delete file.values[key];
          continue;
        }
        const kept = key === LOGBOOK_KEY ? mergeLogbooks(file.values[key], value) : value;
        file.values[key] = kept;
        if (kept !== value) back[key] = kept;
      }
      file.updated = now;
      await mkdir(this.dir, { recursive: true });
      const path = this.path(email);
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(file));
      await rename(temp, path);
      return back;
    });
  }
}
