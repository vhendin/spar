// The drivers connected: their names and colours, and the lines the server says in the chat
// about them (joining, leaving, changing the clock or the weather).

import type { ClientMessage, Player } from '@spar/shared';

type SetWorld = Extract<ClientMessage, { type: 'set_world' }>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A name as others see it: trimmed, single spaces, no control characters; empty gets `fallback`. */
export function cleanName(name: string | undefined, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = (name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return clean || fallback;
}

/** "21 June" for a day of the year (1 is 1 January), in a year that is not a leap year. */
export function dayName(day: number): string {
  const date = new Date(Date.UTC(2025, 0, day));
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** What a change to the clock or weather says in the chat, after the player's name. */
export function describeWorldChange(msg: SetWorld): string {
  const parts: string[] = [];
  if (msg.day !== undefined) parts.push(`moved the date to ${dayName(msg.day)}`);
  if (msg.hour !== undefined) {
    const minutes = Math.round(msg.hour * 60) % 1440;
    parts.push(`set the clock to ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  if (msg.dayMinutes !== undefined) {
    parts.push(msg.dayMinutes === 0 ? 'stopped the clock' : msg.dayMinutes === 1440 ? 'let the clock run in real time' : `made a day last ${+msg.dayMinutes.toFixed(1)} minutes`);
  }
  if (msg.weather !== undefined) parts.push(msg.weather === 'auto' ? 'let the weather change by itself' : `set the weather to ${msg.weather}`);
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`;
}

/** The players' list as sent to everyone. */
export function playerList(players: Iterable<Player>): Player[] {
  return [...players].map((p) => (p.color ? { id: p.id, name: p.name, color: p.color } : { id: p.id, name: p.name }));
}
