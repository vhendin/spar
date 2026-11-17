// The game clock. The server says what instant it is in the game and how fast time runs;
// everyone works out the rest from that.

export interface GameClock {
  /** The in-game instant as UTC milliseconds, at the moment `at` on the local stopwatch. */
  utc: number;
  /** In-game seconds per real second. */
  rate: number;
  /** Hours the region's clocks are ahead of UTC. */
  utcOffset: number;
  /** Local stopwatch reading (milliseconds) that `utc` belongs to. */
  at: number;
}

/** The in-game instant now, as UTC milliseconds. `now` is the local stopwatch in milliseconds. */
export const gameUtc = (clock: GameClock, now: number): number => clock.utc + (now - clock.at) * clock.rate;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 15 Aug 09:42" on the region's clocks. */
export function formatGameTime(utcMs: number, utcOffset: number): string {
  const d = new Date(utcMs + utcOffset * 3600000);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/**
 * Reads "2026-08-15T09:00" (or with seconds) as a time on the region's clocks and gives
 * the UTC instant in milliseconds, or null when the text is not such a time.
 */
export function parseLocalTime(text: string, utcOffset: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => Number(v ?? 0)) as [number, number, number, number, number, number];
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - utcOffset * 3600000;
  return Number.isFinite(utc) ? utc : null;
}

/** The instant on the same local day as `utcMs` at `hour` o'clock (fractions allowed), as UTC milliseconds. */
export function atLocalHour(utcMs: number, utcOffset: number, hour: number): number {
  const local = utcMs + utcOffset * 3600000;
  const midnight = Math.floor(local / 86400000) * 86400000;
  return midnight + Math.round(hour * 3600000) - utcOffset * 3600000;
}
