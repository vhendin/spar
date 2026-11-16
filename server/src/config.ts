import { resolve } from 'node:path';

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
}

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
  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 8080, 'PORT'),
    region,
    seed: int(env.SEED, 20261116, 'SEED') >>> 0,
    clientDist: resolve(env.CLIENT_DIST ?? '../client/dist'),
    regionsDir: resolve(env.REGIONS_DIR ?? '../data/regions'),
  };
}
