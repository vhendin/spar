// Making and removing areas from the game: a new area's definition is written to
// defs/regions/<name>.json and the importer is run for it, one area at a time, while the game
// asks how it is going. Only the computer the server runs on may do this: building downloads
// data and fills the disk, which is the host's business.

import { spawn } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

/** Sides an area may have, metres: whole numbers of the 2048 m height files. */
export const AREA_SIZES = [2048, 4096, 6144, 10240];
/** SWEREF 99 TM bounds of Sweden, with some sea around it. */
const SWEDEN = { west: 200000, east: 1000000, south: 6100000, north: 7700000 };
/** Lines of importer output kept for the game to show. */
const KEEP = 40;

export interface AreaRequest {
  title: string;
  /** SWEREF 99 TM easting of the west edge and northing of the north edge, metres. */
  west: number;
  north: number;
  size: number;
}

export interface Job {
  name: string;
  title: string;
  state: 'running' | 'done' | 'failed';
  /** The importer's latest output lines. */
  lines: string[];
  started: number;
}

export interface AreaConfig {
  /** Folder holding the region definitions, defs/regions. */
  defsDir: string;
  regionsDir: string;
  /** Folder holding raw downloads, data/raw. */
  rawDir: string;
  /** The importer command and its arguments before `fetch <name>` or `build <name>`; empty turns this off. */
  importer: string[];
  /** Where the importer command runs. */
  cwd: string;
}

/** A region name from a title: lowercase letters and digits, Swedish letters spelt plainly. */
export function nameFor(title: string): string {
  const plain = title
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return plain || 'area';
}

/** What is wrong with a request, or null when it can be built. */
export function checkRequest(r: Partial<AreaRequest>): string | null {
  if (typeof r.title !== 'string' || !r.title.trim() || r.title.length > 40) return 'Give the area a name of at most 40 characters.';
  if (typeof r.size !== 'number' || !AREA_SIZES.includes(r.size)) return `The size must be one of ${AREA_SIZES.join(', ')} metres.`;
  if (typeof r.west !== 'number' || typeof r.north !== 'number' || !Number.isFinite(r.west) || !Number.isFinite(r.north)) return 'The position is missing.';
  if (r.west < SWEDEN.west || r.west + r.size > SWEDEN.east || r.north - r.size < SWEDEN.south || r.north > SWEDEN.north) {
    return 'The area must lie in Sweden: the 1 m elevation comes from Lantmäteriet.';
  }
  return null;
}

/** Whether a request comes from the computer the server runs on (directly, or through the dev proxy). */
export function fromHost(req: IncomingMessage): boolean {
  const local = (a: string | undefined): boolean => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return local(req.socket.remoteAddress) && (first === undefined || local(first));
}

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

export class AreaMaker {
  job: Job | null = null;

  constructor(private readonly config: AreaConfig) {}

  get enabled(): boolean {
    return this.config.importer.length > 0;
  }

  /** Writes the definition and starts building; returns the region name. */
  async create(r: AreaRequest): Promise<string> {
    if (this.job?.state === 'running') throw new Error(`Still building ${this.job.title}.`);
    let name = nameFor(r.title);
    for (let n = 2; (await exists(join(this.config.defsDir, `${name}.json`))) || (await exists(join(this.config.regionsDir, name))); n++) {
      name = `${nameFor(r.title)}-${n}`;
    }
    const def = {
      name,
      title: r.title.trim(),
      crs: 'EPSG:3006',
      origin: { easting: Math.round(r.west), northing: Math.round(r.north) },
      size: r.size,
    };
    await mkdir(this.config.defsDir, { recursive: true });
    await writeFile(join(this.config.defsDir, `${name}.json`), JSON.stringify(def, null, 2) + '\n');
    const job: Job = { name, title: def.title, state: 'running', lines: [], started: Date.now() };
    this.job = job;
    this.run(job).catch((err: unknown) => {
      job.lines.push(String(err));
      job.state = 'failed';
    });
    return name;
  }

  private async run(job: Job): Promise<void> {
    for (const step of ['fetch', 'build']) {
      const code = await this.step(job, step);
      if (code !== 0) {
        job.lines.push(`The importer stopped (${step}, exit code ${code}).`);
        job.state = 'failed';
        return;
      }
    }
    job.state = 'done';
  }

  private step(job: Job, step: string): Promise<number> {
    const [command, ...args] = this.config.importer;
    return new Promise((resolve) => {
      const child = spawn(command!, [...args, step, job.name], { cwd: this.config.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      const take = (chunk: Buffer): void => {
        for (const line of chunk.toString().split(/[\r\n]+/)) {
          const text = line.trim();
          // Docker's own chatter about creating containers says nothing to a player.
          if (!text || /^Container .* (Creat|Start|Stopp|Remov)/.test(text) || text.includes('FutureWarning') || text === 'warnings.warn(') continue;
          job.lines.push(text);
        }
        if (job.lines.length > KEEP) job.lines.splice(0, job.lines.length - KEEP);
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.on('error', (err) => {
        job.lines.push(`Could not run the importer: ${err.message}`);
        resolve(-1);
      });
      child.on('close', (code) => resolve(code ?? -1));
    });
  }

  /** Removes an area's built files, its definition and the downloads that belong to it alone. */
  async remove(name: string, keep: string): Promise<void> {
    if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('No such area.');
    if (name === keep) throw new Error('The server was started with this area; it cannot be removed while running.');
    if (this.job?.state === 'running' && this.job.name === name) throw new Error('It is still being built.');
    if (!(await exists(join(this.config.regionsDir, name)))) throw new Error('No such area.');
    await rm(join(this.config.regionsDir, name), { recursive: true, force: true });
    await rm(join(this.config.defsDir, `${name}.json`), { force: true });
    for (const file of [`osm/${name}.osm.pbf`, `osm/${name}.bbox`, `skogsstyrelsen/${name}.geojson`, `skogsstyrelsen/${name}_tradhojd.tif`]) {
      await rm(join(this.config.rawDir, file), { force: true });
    }
  }
}
