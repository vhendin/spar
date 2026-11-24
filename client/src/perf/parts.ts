// ?bench=parts: what each part of the picture costs the GPU. The camera holds still at two
// places on the benchmark route (in Ottsjö at driving height, and high over the valley) and
// at each one leaves out one thing at a time for a few seconds: the shadows, the glow, the
// finishing pass, the ground (or the ground's noise, or all its shading), the plants, the far trees, the buildings, the sky, the full
// resolution. Same view and same frames, so the difference from the full picture is that
// part's cost. The full picture is measured again at the end of each place, to see drift.

import { benchPose, type BenchPose } from './bench';

export type Part =
  | 'all' | 'shadows' | 'glow' | 'finish' | 'terrain' | 'groundNoise' | 'groundFlat' | 'horizon' | 'plants' | 'farTrees' | 'buildings' | 'sky' | 'resolution';

/** In the order they are measured; `all` first and last at each place. */
export const PARTS: readonly Part[] = ['all', 'shadows', 'glow', 'finish', 'terrain', 'groundNoise', 'groundFlat', 'horizon', 'plants', 'farTrees', 'buildings', 'sky', 'resolution', 'all'];

export const PART_LABELS: Record<Part, string> = {
  all: 'Full picture',
  shadows: 'Without sun shadows',
  glow: 'Without glow',
  finish: 'Without the finishing pass (grade and glow)',
  terrain: 'Without the near ground',
  groundNoise: 'Near ground without its noise (colour and borders)',
  groundFlat: 'Near ground in one flat colour, lit',
  horizon: 'Without the far ground',
  plants: 'Without plants and near trees',
  farTrees: 'Without far trees',
  buildings: 'Without buildings, fences and lines',
  sky: 'Without sky, stars and clouds',
  resolution: 'At one pixel per point (instead of the setting)',
};

/** The places: seconds into the benchmark route. */
export const PLACES: readonly { name: string; t: number }[] = [
  { name: 'Ottsjö, on the road', t: 38 },
  { name: 'High over the valley', t: 72 },
];

/** Each part: this long to settle (shaders built, the GPU's answers catching up), then this long measured. */
export const SETTLE_SECONDS = 1.5;
export const MEASURE_SECONDS = 3;
/** At each place, at most this long waiting for things round it to load, and this long with nothing loading. */
export const PLACE_WARM_MAX = 40;
export const PLACE_WARM_QUIET = 2;

export interface PartResult {
  place: string;
  part: Part;
  /** Mean GPU time a frame, ms, or null if the browser told none. */
  gpu: number | null;
  cpu: number;
  frames: number;
}

type Step =
  | { kind: 'warm'; place: number; since: number; quiet: number }
  | { kind: 'part'; place: number; part: number; since: number }
  | { kind: 'done' };

/**
 * Runs the sequence. `step` is called once a frame with the time and how much is still
 * loading; it says where the camera goes and what to leave out. `sample` takes each
 * frame's measures while one is being measured.
 */
export class PartsBench {
  readonly results: PartResult[] = [];
  private state: Step = { kind: 'warm', place: 0, since: -1, quiet: -1 };
  private gpuSum = 0;
  private gpuCount = 0;
  private cpuSum = 0;
  private frames = 0;
  private measuring = false;

  get done(): boolean {
    return this.state.kind === 'done';
  }

  /** The place being worked on, and what to leave out now ('all' leaves nothing out). */
  step(now: number, loading: number): { place: number; part: Part; measuring: boolean; label: string } | null {
    const r = this.next(now, loading);
    this.measuring = r?.measuring ?? false;
    return r;
  }

  private next(now: number, loading: number): { place: number; part: Part; measuring: boolean; label: string } | null {
    const s = this.state;
    if (s.kind === 'done') return null;
    if (s.kind === 'warm') {
      if (s.since < 0) s.since = s.quiet = now;
      if (loading > 0) s.quiet = now;
      if (now - s.quiet > PLACE_WARM_QUIET * 1000 || now - s.since > PLACE_WARM_MAX * 1000) {
        this.state = { kind: 'part', place: s.place, part: 0, since: now };
        this.reset();
      }
      return { place: s.place, part: 'all', measuring: false, label: `${PLACES[s.place]!.name}: loading…` };
    }
    const into = (now - s.since) / 1000;
    if (into >= SETTLE_SECONDS + MEASURE_SECONDS) {
      const part = PARTS[s.part]!;
      this.results.push({
        place: PLACES[s.place]!.name,
        part,
        gpu: this.gpuCount ? this.gpuSum / this.gpuCount : null,
        cpu: this.frames ? this.cpuSum / this.frames : 0,
        frames: this.frames,
      });
      this.reset();
      if (s.part + 1 < PARTS.length) this.state = { kind: 'part', place: s.place, part: s.part + 1, since: now };
      else if (s.place + 1 < PLACES.length) this.state = { kind: 'warm', place: s.place + 1, since: -1, quiet: -1 };
      else {
        this.state = { kind: 'done' };
        return null;
      }
      return this.next(now, loading);
    }
    const part = PARTS[s.part]!;
    const n = s.part + 1;
    return { place: s.place, part, measuring: into >= SETTLE_SECONDS, label: `${PLACES[s.place]!.name}: ${n} of ${PARTS.length}, ${PART_LABELS[part].toLowerCase()}` };
  }

  /** One frame's measures, counted only if the last `step` said it is measuring. `gpu` is NaN when no answer came this frame. */
  sample(gpu: number, cpu: number): void {
    if (!this.measuring) return;
    if (Number.isFinite(gpu)) {
      this.gpuSum += gpu;
      this.gpuCount++;
    }
    this.cpuSum += cpu;
    this.frames++;
  }

  private reset(): void {
    this.gpuSum = this.gpuCount = this.cpuSum = this.frames = 0;
  }
}

/** Where the camera stands at a place. */
export function placePose(place: number, ground: (x: number, z: number) => number | null, fallback: number): BenchPose {
  return benchPose(PLACES[place]!.t, ground, fallback)!;
}

/** Each part's cost at each place: its GPU time taken from the mean of the full picture's two measures. */
export function partCosts(results: readonly PartResult[]): { place: string; full: number | null; drift: number | null; parts: { part: Part; gpu: number | null; saved: number | null }[] }[] {
  const out = [];
  for (const { name } of PLACES) {
    const here = results.filter((r) => r.place === name);
    const fulls = here.filter((r) => r.part === 'all' && r.gpu !== null).map((r) => r.gpu!);
    const full = fulls.length ? fulls.reduce((a, b) => a + b, 0) / fulls.length : null;
    const drift = fulls.length === 2 ? fulls[1]! - fulls[0]! : null;
    const parts = here
      .filter((r) => r.part !== 'all')
      .map((r) => ({ part: r.part, gpu: r.gpu, saved: full !== null && r.gpu !== null ? full - r.gpu : null }));
    out.push({ place: name, full, drift, parts });
  }
  return out;
}

const round = (v: number | null, digits = 2): string => (v === null ? '–' : v.toFixed(digits));

/** The results over the picture. */
export function showPartsResult(results: readonly PartResult[], where: string): void {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: '40', maxWidth: 'min(94vw, 620px)', maxHeight: '90vh', overflow: 'auto',
    font: '13px/1.45 system-ui, sans-serif', color: '#f4f1ea', background: 'rgba(20, 24, 22, 0.94)', padding: '16px 20px', borderRadius: '10px',
  });
  const title = document.createElement('div');
  title.textContent = 'What each part costs the GPU';
  Object.assign(title.style, { font: '600 17px system-ui, sans-serif', marginBottom: '6px' });
  box.append(title);
  for (const place of partCosts(results)) {
    const head = document.createElement('div');
    head.textContent = `${place.place}: full picture ${round(place.full)} ms a frame (drift ${round(place.drift)} ms)`;
    Object.assign(head.style, { fontWeight: '600', marginTop: '10px' });
    box.append(head);
    const sorted = [...place.parts].sort((a, b) => (b.saved ?? -1e9) - (a.saved ?? -1e9));
    for (const p of sorted) {
      const line = document.createElement('div');
      line.textContent = `${PART_LABELS[p.part]}: ${round(p.gpu)} ms (saves ${round(p.saved)})`;
      box.append(line);
    }
  }
  const foot = document.createElement('div');
  foot.textContent = `Saved: ${where}. Reload to run it again. Click to close.`;
  Object.assign(foot.style, { marginTop: '10px', opacity: '0.65', fontSize: '12px' });
  box.append(foot);
  box.addEventListener('click', () => box.remove());
  document.body.append(box);
}
