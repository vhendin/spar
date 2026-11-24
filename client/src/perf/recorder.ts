// Performance recording: where each frame's time goes, frame by frame, with where the camera
// was and what was loading, plus the main thread's long stalls. F9 starts and stops it while
// playing; the recording is saved on the game server under data/perf (or downloaded when the
// server will not take it) for reading afterwards.

/** The parts of a frame timed on their own, in the order they run. */
export const SECTIONS = [
  'input', // gamepad and menu keys
  'physics', // the fixed steps: vehicle, winch, world, others' vehicles
  'vehicle', // interpolation, the drone
  'solids', // colliders gathered round the vehicle
  'misc', // camera, snapshot sent, see-through
  'terrain',
  'plants',
  'buildings',
  'sky', // sky, weather and the shading values that follow it
  'effects', // ruts, mud, spray, exhaust, others' vehicles drawn
  'sound',
  'hud', // map, guides, compass, dashboard, the F3 text
  'render', // drawing, as far as the CPU goes (the GPU's part is `gpu`)
] as const;
export type Section = (typeof SECTIONS)[number];
const INDEX = Object.fromEntries(SECTIONS.map((s, i) => [s, i])) as Record<Section, number>;

/** Times the parts of one frame. */
export class FrameTimer {
  readonly ms = new Float64Array(SECTIONS.length);
  private at = 0;
  constructor(private readonly clock: () => number = () => performance.now()) {}

  begin(): void {
    this.ms.fill(0);
    this.at = this.clock();
  }

  /** The time since the last lap (or the beginning) goes to `section`. */
  lap(section: Section): void {
    const t = this.clock();
    this.ms[INDEX[section]]! += t - this.at;
    this.at = t;
  }

  get(section: Section): number {
    return this.ms[INDEX[section]]!;
  }
}

/** What the camera was doing. */
export const MODES = ['driving', 'flying', 'drone', 'start', 'paused', 'map', 'loading'] as const;
export type Mode = (typeof MODES)[number];

/** The columns of each row, one row per frame drawn. Times in ms, places in metres. */
export const COLUMNS = [
  't', // since the recording began
  'frame', // since the frame before
  'cpu', // all the work this frame on the main thread
  ...SECTIONS,
  // The GPU's time drawing a recent frame, as the sum of its render passes, when the browser
  // can tell (else empty). Apple's GPUs overlap passes, so this can be more than the frame took.
  'gpu',
  // From handing a frame to the GPU until it was done with it: the GPU's time for that frame
  // when it was idle before, later when still busy with the frame before (WebGPU only).
  'gpuWait',
  'steps', // physics steps this frame
  'draws',
  'triangles', // thousands
  'x',
  'y',
  'z',
  'speed', // m/s, the vehicle's
  'mode', // index into MODES
  'terrainLoading',
  'plantsLoading',
  'buildingsLoading',
  'plantMeshes', // thousands
  'farTrees', // thousands
  'heap', // MB of JavaScript memory, where the browser tells
] as const;
export type Column = (typeof COLUMNS)[number];

/** A long stall of the main thread, with the scripts behind it where the browser names them. */
export interface Stall {
  t: number;
  ms: number;
  blocking?: number;
  scripts?: { ms: number; what: string }[];
}

export interface Summary {
  seconds: number;
  frames: number;
  fps: number;
  /** Time between frames drawn. */
  frame: Stats;
  /** Main-thread work per frame. */
  cpu: Stats;
  gpu: Stats | null;
  gpuWait: Stats | null;
  /** Average ms per frame in each part, most first. */
  sections: { section: Section; ms: number }[];
  /** Frames that took longest to come, with where and what was slowest. */
  worst: { t: number; frame: number; cpu: number; gpu: number | null; slowest: Section; x: number; z: number }[];
  /** 256 m squares with the most GPU (or else CPU) time per frame, where at least 2 s were spent; GPU as `gpuWait`. */
  places: { x: number; z: number; seconds: number; cpu: number; gpu: number | null; triangles: number }[];
  stalls: number;
}

export interface Stats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface Recording {
  version: 1;
  meta: Record<string, unknown>;
  columns: string[];
  modes: readonly string[];
  rows: (number | null)[][];
  markers: { t: number; text: string }[];
  stalls: Stall[];
  summary: Summary;
}

/** Longest recording before it stops by itself. */
export const MAX_SECONDS = 15 * 60;

const round = (v: number): number | null => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

function stats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const r = (v: number): number => Math.round(v * 100) / 100;
  return { mean: r(values.reduce((a, b) => a + b, 0) / values.length), p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(sorted[sorted.length - 1]!) };
}

/** What a recording shows at a glance. */
export function summarise(rows: (number | null)[][], stallCount = 0): Summary {
  const col = (name: Column): number => COLUMNS.indexOf(name);
  const num = (row: (number | null)[], name: Column): number | null => row[col(name)] ?? null;
  // The first frame has no frame before it.
  const timed = rows.slice(1);
  const frames = timed.map((r) => num(r, 'frame') ?? 0);
  const cpu = timed.map((r) => num(r, 'cpu') ?? 0);
  const gpus = timed.map((r) => num(r, 'gpu')).filter((v): v is number => v !== null);
  const waits = timed.map((r) => num(r, 'gpuWait')).filter((v): v is number => v !== null);
  const seconds = rows.length ? (num(rows[rows.length - 1]!, 't') ?? 0) / 1000 : 0;
  const sections = SECTIONS.map((section) => ({
    section,
    ms: Math.round((timed.reduce((a, r) => a + (num(r, section) ?? 0), 0) / Math.max(1, timed.length)) * 100) / 100,
  })).sort((a, b) => b.ms - a.ms);
  const slowestOf = (r: (number | null)[]): Section => SECTIONS.reduce((best, s) => ((num(r, s) ?? 0) > (num(r, best) ?? 0) ? s : best), SECTIONS[0] as Section);
  const worst = [...timed]
    .sort((a, b) => (num(b, 'frame') ?? 0) - (num(a, 'frame') ?? 0))
    .slice(0, 10)
    .map((r) => ({ t: num(r, 't') ?? 0, frame: num(r, 'frame') ?? 0, cpu: num(r, 'cpu') ?? 0, gpu: num(r, 'gpu'), slowest: slowestOf(r), x: Math.round(num(r, 'x') ?? 0), z: Math.round(num(r, 'z') ?? 0) }));
  // By 256 m square of the map.
  const cells = new Map<string, { x: number; z: number; seconds: number; cpu: number; gpu: number; gpuFrames: number; triangles: number; n: number }>();
  for (const r of timed) {
    const x = Math.floor((num(r, 'x') ?? 0) / 256), z = Math.floor((num(r, 'z') ?? 0) / 256);
    const key = `${x},${z}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { x: x * 256 + 128, z: z * 256 + 128, seconds: 0, cpu: 0, gpu: 0, gpuFrames: 0, triangles: 0, n: 0 }));
    c.n++;
    c.seconds += (num(r, 'frame') ?? 0) / 1000;
    c.cpu += num(r, 'cpu') ?? 0;
    c.triangles += num(r, 'triangles') ?? 0;
    const g = num(r, 'gpuWait') ?? num(r, 'gpu');
    if (g !== null) {
      c.gpu += g;
      c.gpuFrames++;
    }
  }
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const places = [...cells.values()]
    .filter((c) => c.seconds >= 2)
    .map((c) => ({ x: c.x, z: c.z, seconds: Math.round(c.seconds), cpu: r2(c.cpu / c.n), gpu: c.gpuFrames ? r2(c.gpu / c.gpuFrames) : null, triangles: Math.round(c.triangles / c.n) }))
    .sort((a, b) => (b.gpu ?? b.cpu) - (a.gpu ?? a.cpu))
    .slice(0, 8);
  return {
    seconds: Math.round(seconds * 10) / 10,
    frames: rows.length,
    fps: seconds > 0 ? Math.round((rows.length / seconds) * 10) / 10 : 0,
    frame: stats(frames),
    cpu: stats(cpu),
    gpu: gpus.length ? stats(gpus) : null,
    gpuWait: waits.length ? stats(waits) : null,
    sections,
    worst,
    places,
    stalls: stallCount,
  };
}

interface LoafScript {
  duration: number;
  sourceURL?: string;
  sourceFunctionName?: string;
  sourceCharPosition?: number;
  invoker?: string;
}
interface LoafEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: LoafScript[];
}

/** Collects rows while recording. */
export class Recorder {
  recording = false;
  /** Filled in by the frame loop before `commit`. */
  readonly row = Object.fromEntries(COLUMNS.map((c) => [c, 0])) as Record<Column, number>;
  private t0 = 0;
  private rows: (number | null)[][] = [];
  private markers: { t: number; text: string }[] = [];
  private stalls: Stall[] = [];
  private meta: Record<string, unknown> = {};
  private observer: PerformanceObserver | null = null;
  private lastAt = 0;

  start(now: number, meta: Record<string, unknown>): void {
    this.recording = true;
    this.t0 = now;
    this.lastAt = now;
    this.rows = [];
    this.markers = [];
    this.stalls = [];
    this.meta = { ...meta, started: new Date().toISOString() };
    this.observe();
  }

  /** Time since the recording began, in ms. */
  elapsed(now: number): number {
    return now - this.t0;
  }

  /** Adds `row` as this frame's. */
  commit(now: number): void {
    if (!this.recording) return;
    this.row.t = now - this.t0;
    this.row.frame = this.rows.length ? now - this.lastAt : 0;
    this.lastAt = now;
    this.rows.push(COLUMNS.map((c) => round(this.row[c])));
  }

  mark(now: number, text: string): void {
    if (this.recording) this.markers.push({ t: Math.round(now - this.t0), text });
  }

  stop(): Recording {
    this.recording = false;
    this.observer?.disconnect();
    this.observer = null;
    return {
      version: 1,
      meta: this.meta,
      columns: [...COLUMNS],
      modes: MODES,
      rows: this.rows,
      markers: this.markers,
      stalls: this.stalls,
      summary: summarise(this.rows, this.stalls.length),
    };
  }

  /** Long stalls of the main thread: Chrome names the scripts behind them; Firefox tells nothing. */
  private observe(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    const kinds = PerformanceObserver.supportedEntryTypes ?? [];
    const type = kinds.includes('long-animation-frame') ? 'long-animation-frame' : kinds.includes('longtask') ? 'longtask' : null;
    if (!type) return;
    this.observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as LoafEntry[]) {
        if (e.startTime < this.t0 || this.stalls.length >= 5000) continue;
        const scripts = (e.scripts ?? [])
          .filter((s) => s.duration >= 5)
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 4)
          .map((s) => ({
            ms: Math.round(s.duration),
            what: [s.invoker, s.sourceFunctionName, s.sourceURL ? `${s.sourceURL.split('/').pop()}:${s.sourceCharPosition ?? ''}` : ''].filter(Boolean).join(' · '),
          }));
        this.stalls.push({
          t: Math.round(e.startTime - this.t0),
          ms: Math.round(e.duration),
          ...(e.blockingDuration !== undefined ? { blocking: Math.round(e.blockingDuration) } : {}),
          ...(scripts.length ? { scripts } : {}),
        });
      }
    });
    try {
      this.observer.observe({ type, buffered: false });
    } catch {
      this.observer = null;
    }
  }
}

/**
 * Saves a recording on the game server, which keeps it under data/perf; when the server will
 * not take it (another computer, not logged in), the browser downloads it instead.
 */
export async function saveRecording(rec: Recording): Promise<{ saved: string } | { downloaded: string }> {
  const body = JSON.stringify(rec);
  try {
    const res = await fetch('/api/perf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Spar': '1' }, body });
    if (res.ok) return { saved: ((await res.json()) as { name: string }).name };
  } catch {
    // Downloaded instead, below.
  }
  const name = `spar-perf-${String(rec.meta.started ?? Date.now()).replace(/[:.]/g, '-')}.json`;
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { downloaded: name };
}
