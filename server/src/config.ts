import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLocalTime, type WeatherState } from '@spar/shared';

export interface ServerConfig {
  host: string;
  port: number;
  /** Name of the region under regionsDir that every client loads. */
  region: string;
  /** World seed shared by all clients; unsigned 32-bit. */
  seed: number;
  /** Folder holding the built client (index.html and assets). */
  clientDist: string;
  /** Folder holding generated regions, one subfolder per region name. */
  regionsDir: string;
  /** The in-game instant the session starts at, as UTC milliseconds. */
  startUtc: number;
  /** Hours the region's clocks are ahead of UTC. */
  utcOffset: number;
  /** Real minutes one in-game day takes; 0 stops the clock. */
  dayLengthMinutes: number;
  /** Pins the weather to one state; null lets it change. */
  weather: WeatherState | null;
  /** Folder of region definitions, where new areas are written. */
  defsDir: string;
  /** Folder of raw downloads. */
  rawDir: string;
  /** Folder of start points placed by hand. */
  startsDir: string;
  /** Command that runs the importer, before `fetch <name>`; empty turns making areas off. */
  importer: string[];
  /** Folder the importer command runs in. */
  importerCwd: string;
  /** The address others open to join, shown in the start menu; worked out from the network when left out. */
  address?: string;
  /** Seconds a dropped player keeps their place for, to come back as the same player; 60 if left out. */
  rejoinSeconds?: number;
}

/** Central European standard time; the game does not follow summer time. */
const UTC_OFFSET = 1;

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  return n;
}

/** Reads settings from the environment. Default paths assume the server runs from /server. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const region = env.REGION ?? 'valadalen';
  if (!/^[a-z0-9_-]+$/.test(region)) throw new Error(`REGION must be lowercase letters, digits, - or _, got "${region}"`);
  const start = env.START_TIME ?? '2026-08-15T09:00';
  const startUtc = parseLocalTime(start, UTC_OFFSET);
  if (startUtc === null) throw new Error(`START_TIME must look like 2026-08-15T09:00, got "${start}"`);
  const dayLengthMinutes = env.DAY_LENGTH_MINUTES === undefined || env.DAY_LENGTH_MINUTES === '' ? 30 : Number(env.DAY_LENGTH_MINUTES);
  if (!Number.isFinite(dayLengthMinutes) || dayLengthMinutes < 0) throw new Error(`DAY_LENGTH_MINUTES must be zero or more, got "${env.DAY_LENGTH_MINUTES}"`);
  const weather = env.WEATHER ?? '';
  if (!['', 'clear', 'overcast', 'rain'].includes(weather)) throw new Error(`WEATHER must be clear, overcast or rain, got "${weather}"`);
  return {
    startUtc,
    utcOffset: UTC_OFFSET,
    dayLengthMinutes,
    weather: weather === '' ? null : (weather as WeatherState),
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 8080, 'PORT'),
    region,
    seed: int(env.SEED, 20261116, 'SEED') >>> 0,
    clientDist: resolve(env.CLIENT_DIST ?? '../client/dist'),
    regionsDir: resolve(env.REGIONS_DIR ?? '../data/regions'),
    defsDir: resolve(env.DEFS_DIR ?? '../defs/regions'),
    rawDir: resolve(env.RAW_DIR ?? '../data/raw'),
    startsDir: resolve(env.STARTS_DIR ?? '../data/starts'),
    // Making areas runs the importer through Docker from the repository; inside the game's own
    // container there is no Docker, so it is off there unless IMPORTER says how.
    importer: (env.IMPORTER ?? (existsSync('/.dockerenv') ? '' : 'docker compose run --rm importer')).split(' ').filter(Boolean),
    importerCwd: resolve(env.IMPORTER_CWD ?? '..'),
    ...(env.ADDRESS ? { address: env.ADDRESS.slice(0, 100) } : {}),
  };
}
