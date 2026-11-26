import { beforeEach, describe, expect, it } from 'vitest';
import { TRAILS_KEY, readTrails, type TrailLine } from '@spar/shared';
import { CHECKPOINT_EVERY, STRAY_SECONDS, Trails, course, offLine, trailEnds } from './trails';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

// 1200 m east along z = 0, then 600 m south.
const hike: TrailLine = { id: 'hiking:r1:0', kind: 'hiking', name: 'Kungsleden: A – B', points: [[0, 0], [1200, 0], [1200, 600]], length: 1800 };
const sled: TrailLine = { id: 'snowmobile:w2:0', kind: 'snowmobile', name: 'Snowmobile trail: C – D', points: [[0, 5000], [2000, 5000]], length: 2000 };
const up: TrailLine = { id: 'ascent:n3:0', kind: 'ascent', name: 'Ascent of E', points: [[3000, 0], [3000, 800]], length: 800, climb: 300 };
const info = () => ({ vehicle: 'Hilux', date: '14 Mar', season: 'winter' });

/** Drives along the course in steps of `step` metres, `dt` seconds each, collecting the events. */
function drive(trails: Trails, points: number[][], step = 10, dt = 1): string[] {
  const out: string[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!, b = points[k + 1]!;
    const n = Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / step);
    for (let s = 1; s <= n; s++) {
      const e = trails.update(dt, a[0]! + ((b[0]! - a[0]!) * s) / n, a[1]! + ((b[1]! - a[1]!) * s) / n, info);
      if (e) out.push(e.kind);
    }
  }
  return out;
}

describe('trails', () => {
  it('lays checkpoints about every 300 m along the line, the last at the end, each facing on', () => {
    const c = course(hike, false);
    expect(c.checkpoints).toHaveLength(Math.round(1800 / CHECKPOINT_EVERY) + 1);
    expect(c.checkpoints[0]).toMatchObject({ x: 0, z: 0, heading: 90 });
    expect(c.checkpoints.at(-1)).toMatchObject({ x: 1200, z: 600, heading: 180 });
    const back = course(hike, true);
    expect(back.checkpoints[0]).toMatchObject({ x: 1200, z: 600, heading: 0 });
    expect(offLine(c, 600, 80, 0, 1800)).toBeCloseTo(80);
  });

  it('offers a trail when stopped at either end; an ascent only at its foot; a snowmobile trail only in winter', () => {
    const t = new Trails('valadalen', [hike, sled, up]);
    let now = 0;
    const offer = (x: number, z: number, speed = 0, winter = false) => t.offer((now += 1000), x, z, speed, winter);
    expect(offer(5, 5)).toMatchObject({ kind: 'offer', trail: { id: hike.id }, reversed: false });
    expect(offer(1200, 610)).toMatchObject({ kind: 'offer', reversed: true });
    expect(offer(5, 5, 4).kind).toBe('none');
    expect(offer(3000, 0)).toMatchObject({ kind: 'offer', trail: { id: up.id } });
    expect(offer(3000, 800).kind).toBe('none');
    expect(offer(0, 5000).kind).toBe('none');
    expect(offer(0, 5000, 0, true)).toMatchObject({ kind: 'offer', trail: { id: sled.id } });
  });

  it('counts the checkpoints, finishes at the end and keeps the time', () => {
    const t = new Trails('valadalen', [hike]);
    t.start(hike, false, 0, 0);
    const events = drive(t, hike.points);
    expect(events.filter((e) => e === 'checkpoint')).toHaveLength(5);
    expect(events.at(-1)).toBe('finished');
    expect(t.current).toBeNull();
    const kept = readTrails(store.get(TRAILS_KEY));
    expect(kept.valadalen![hike.id]).toMatchObject({ runs: 1, vehicle: 'Hilux' });
    expect(kept.valadalen![hike.id]!.best).toBeGreaterThan(170);
    expect(t.summary()).toMatchObject({ driven: 1, total: 1, kinds: [{ kind: 'hiking', driven: 1, total: 1 }] });
    // Just finished there: not offered again straight away, the other way.
    expect(t.offer(1e6, 1200, 600, 0, false).kind).toBe('none');
  });

  it('puts the vehicle back at the last checkpoint after a few seconds off the line', () => {
    const t = new Trails('valadalen', [hike]);
    t.start(hike, false, 0, 0);
    drive(t, [[0, 0], [320, 0]]);
    // Wanders 150 m off to the north.
    drive(t, [[320, 0], [320, -150]]);
    let e = null;
    for (let s = 0; s < STRAY_SECONDS + 1 && !e; s++) e = t.update(1, 320, -150, info);
    expect(e).toMatchObject({ kind: 'putBack', x: 300, z: 0, heading: 90 });
    expect(t.current).not.toBeNull();
  });

  it('gives the trail up when the vehicle is put somewhere else', () => {
    const t = new Trails('valadalen', [hike]);
    t.start(hike, false, 0, 0);
    expect(t.update(1, 2000, 2000, info)).toEqual({ kind: 'lost' });
    expect(t.current).toBeNull();
  });
});

describe('going to a trail from the map', () => {
  it('sets down at either end facing along it, an ascent only at the bottom', () => {
    expect(trailEnds(hike)).toEqual([
      { x: 0, z: 0, heading: 90, reversed: false },
      { x: 1200, z: 600, heading: 0, reversed: true },
    ]);
    expect(trailEnds(up)).toEqual([{ x: 3000, z: 0, heading: 180, reversed: false }]);
  });

  it('drops a trail on the way and offers the one gone to at once, even where one just ended', () => {
    const trails = new Trails('valadalen', [hike, up]);
    trails.start(hike, false, 0, 0);
    trails.giveUp(3000, 0);
    expect(trails.offer(0, 3000, 0, 0, false).kind).toBe('none');
    trails.start(hike, false, 0, 0);
    trails.goTo(up, false);
    expect(trails.current).toBeNull();
    expect(trails.offer(1, 3000, 0, 0, false)).toMatchObject({ kind: 'offer', trail: up });
  });

  it('offers the trail gone to before another starting at the same spot', () => {
    const other: TrailLine = { ...hike, id: 'hiking:r9:0', name: 'Another route', points: [[0, 0], [0, -900]], length: 900 };
    const trails = new Trails('valadalen', [hike, other]);
    expect(trails.offer(0, 1, 0, 0, false)).toMatchObject({ trail: other });
    trails.goTo(hike, false);
    expect(trails.offer(1, 1, 0, 0, false)).toMatchObject({ trail: hike, reversed: false });
  });
});
