// The benchmark: ?bench=1 flies the camera along a fixed route in Vålådalen at a fixed time and
// weather and records it like F9 does, so a change can be measured before and after. The
// route follows Ottsjövägen west through the forest into Ottsjö at driving height (forest,
// houses, the lift, the lake shore), then climbs over the village and turns full circle to
// look across the valley (far forest, the fells, the horizon).

import type { Stats, Summary } from './recorder';

/** Where and when it runs, set in the URL unless the URL already says otherwise. */
export const BENCH_SETUP: Record<string, string> = {
  region: 'valadalen',
  spawn: 'Ottsjö',
  time: '2026-08-15T13:00',
  weather: 'clear',
};

/** Ottsjövägen, every 20 m, east to west, in world metres (x east, z south). */
export const BENCH_ROUTE: readonly (readonly [number, number])[] = [
  [7664, 2007], [7644, 2009], [7624, 2011], [7604, 2013], [7584, 2013], [7564, 2013], [7544, 2013], [7524, 2013], [7504, 2013], [7484, 2014],
  [7464, 2014], [7444, 2014], [7424, 2014], [7404, 2014], [7384, 2014], [7364, 2014], [7344, 2014], [7324, 2014], [7304, 2014], [7284, 2014],
  [7264, 2015], [7244, 2015], [7224, 2015], [7204, 2015], [7184, 2015], [7164, 2015], [7144, 2016], [7124, 2015], [7104, 2015], [7084, 2016],
  [7064, 2016], [7044, 2016], [7024, 2017], [7004, 2017], [6984, 2017], [6964, 2017], [6944, 2017], [6925, 2015], [6905, 2013], [6885, 2009],
  [6866, 2004], [6848, 1995], [6831, 1985], [6814, 1975], [6798, 1962], [6783, 1948], [6769, 1935], [6753, 1922], [6735, 1913], [6716, 1907],
  [6697, 1903], [6677, 1899], [6658, 1895], [6638, 1891], [6618, 1887], [6599, 1884], [6579, 1880], [6559, 1876], [6540, 1873], [6520, 1869],
  [6500, 1866],
];

const SPACING = 20;
/** Along the road at 72 km/h, the camera 3.5 m over it looking 30 m ahead. */
const SPEED = 20;
const EYE = 3.5;
const AHEAD = 30;
const ROAD_SECONDS = 50;
/** Then up to 220 m over the ground, still drifting on. */
const CLIMB_SECONDS = 12;
const HIGH = 220;
const DRIFT = 8;
/** Then a full turn. */
const TURN_SECONDS = 18;
export const BENCH_SECONDS = ROAD_SECONDS + CLIMB_SECONDS + TURN_SECONDS;

/** At most this long waiting for the ground, plants and buildings round the start to load. */
export const WARM_MAX_SECONDS = 45;
/** And this long with nothing loading before it starts. */
export const WARM_QUIET_SECONDS = 2;

export interface BenchPose {
  x: number;
  y: number;
  z: number;
  /** The point looked at. */
  tx: number;
  ty: number;
  tz: number;
}

/** A point `s` metres along the route, carried straight on past its end. */
export function alongRoute(s: number): { x: number; z: number; dx: number; dz: number } {
  const last = BENCH_ROUTE.length - 1;
  const i = Math.max(0, Math.min(last - 1, Math.floor(s / SPACING)));
  const [ax, az] = BENCH_ROUTE[i]!;
  const [bx, bz] = BENCH_ROUTE[i + 1]!;
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const f = s / SPACING - i;
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, dx, dz };
}

const smooth = (u: number): number => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

/**
 * Where the camera is `t` seconds in, or null once the route is done. `ground` gives the
 * ground's height, or null where it has not loaded (the last known height is kept then).
 */
export function benchPose(t: number, ground: (x: number, z: number) => number | null, fallback = 0): BenchPose | null {
  if (t >= BENCH_SECONDS) return null;
  const h = (x: number, z: number): number => ground(x, z) ?? fallback;
  const roadEnd = SPEED * ROAD_SECONDS;
  if (t < ROAD_SECONDS) {
    const p = alongRoute(t * SPEED), q = alongRoute(t * SPEED + AHEAD);
    return { x: p.x, y: h(p.x, p.z) + EYE, z: p.z, tx: q.x, ty: h(q.x, q.z) + 1.5, tz: q.z };
  }
  const climb = Math.min(t - ROAD_SECONDS, CLIMB_SECONDS);
  const p = alongRoute(roadEnd + DRIFT * climb);
  const lift = smooth(climb / CLIMB_SECONDS);
  const y = h(p.x, p.z) + EYE + (HIGH - EYE) * lift;
  // Looking ahead and, as it rises, more and more down across the valley.
  const reach = AHEAD + 270 * lift;
  const turn = t > ROAD_SECONDS + CLIMB_SECONDS ? (2 * Math.PI * smooth((t - ROAD_SECONDS - CLIMB_SECONDS) / TURN_SECONDS)) : 0;
  const c = Math.cos(turn), s = Math.sin(turn);
  const dx = p.dx * c - p.dz * s, dz = p.dx * s + p.dz * c;
  return { x: p.x, y, z: p.z, tx: p.x + dx * reach, ty: y - 1 - 60 * lift, tz: p.z + dz * reach };
}

/** The results, over the picture, once the recording is saved. */
export function showBenchResult(s: Summary, cap: number, where: string): void {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: '40', maxWidth: 'min(92vw, 520px)',
    font: '14px/1.5 system-ui, sans-serif', color: '#f4f1ea', background: 'rgba(20, 24, 22, 0.92)', padding: '18px 22px', borderRadius: '10px',
  });
  const ms = (st: Stats | null): string => (st ? `${st.mean} ms (95%: ${st.p95} ms)` : 'not told by this browser');
  const rows: [string, string][] = [
    ['Frames', `${s.fps} a second${cap > 0 ? ` (limit ${cap})` : ''}, slowest 1% ${s.frame.p99} ms`],
    ['CPU a frame', ms(s.cpu)],
    ['GPU a frame', ms(s.gpuWait)],
    ['Heaviest parts', s.sections.slice(0, 4).map((x) => `${x.section} ${x.ms}`).join(' · ')],
    ['Stalls', String(s.stalls)],
    ['Saved', where],
  ];
  const title = document.createElement('div');
  title.textContent = 'Benchmark done';
  Object.assign(title.style, { font: '600 17px system-ui, sans-serif', marginBottom: '8px' });
  box.append(title);
  for (const [k, v] of rows) {
    const line = document.createElement('div');
    const key = document.createElement('span');
    key.textContent = `${k}: `;
    key.style.opacity = '0.65';
    line.append(key, v);
    box.append(line);
  }
  const foot = document.createElement('div');
  foot.textContent = 'Reload the page to run it again. Click to close.';
  Object.assign(foot.style, { marginTop: '10px', opacity: '0.65', fontSize: '12px' });
  box.append(foot);
  box.addEventListener('click', () => box.remove());
  document.body.append(box);
}
