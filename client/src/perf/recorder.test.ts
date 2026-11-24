import { describe, expect, it } from 'vitest';
import { COLUMNS, FrameTimer, Recorder, SECTIONS, summarise } from './recorder';

describe('frame timer', () => {
  it('puts the time since the last lap in each part', () => {
    let t = 0;
    const timer = new FrameTimer(() => t);
    timer.begin();
    t = 2;
    timer.lap('physics');
    t = 2.5;
    timer.lap('terrain');
    t = 3;
    timer.lap('physics');
    expect(timer.get('physics')).toBe(2.5);
    expect(timer.get('terrain')).toBe(0.5);
    timer.begin();
    expect(timer.get('physics')).toBe(0);
  });
});

describe('recorder', () => {
  it('keeps one rounded row per frame, and sums it up', () => {
    const rec = new Recorder();
    rec.start(1000, { region: 'test' });
    for (let i = 0; i < 600; i++) {
      // Every 100th frame is slow, and slow in the plants; the second half is somewhere heavier.
      const slow = i % 100 === 50;
      Object.assign(rec.row, { cpu: slow ? 30 : 5, plants: slow ? 25 : 1, physics: 2, gpu: i < 300 ? 4 : 9, gpuWait: i < 300 ? 3 : 8, x: i < 300 ? 100 : 700, z: 100, triangles: 1234.5678 });
      rec.commit(1000 + i * (1000 / 60) + (slow ? 20 : 0));
      if (i === 10) rec.mark(1000 + i * (1000 / 60), 'fan');
    }
    const r = rec.stop();
    expect(rec.recording).toBe(false);
    expect(r.rows).toHaveLength(600);
    expect(r.columns).toEqual([...COLUMNS]);
    expect(r.rows[0]![COLUMNS.indexOf('frame')]).toBe(0);
    expect(r.rows[5]![COLUMNS.indexOf('triangles')]).toBe(1234.57);
    expect(r.markers).toEqual([{ t: 167, text: 'fan' }]);
    expect(r.meta.region).toBe('test');
    const s = r.summary;
    expect(s.fps).toBeGreaterThan(55);
    expect(s.cpu.p50).toBe(5);
    expect(s.cpu.max).toBe(30);
    expect(s.gpu!.mean).toBeCloseTo(6.5, 1);
    expect(s.sections[0]!.section).toBe('physics');
    expect(s.sections.map((x) => x.section).sort()).toEqual([...SECTIONS].sort());
    expect(s.worst[0]!.slowest).toBe('plants');
    // The heavier place comes first.
    expect(s.places[0]).toMatchObject({ x: 512 + 128, z: 128, gpu: 8 });
  });

  it('leaves out GPU times the browser could not give', () => {
    const s = summarise([COLUMNS.map(() => 1), COLUMNS.map((c) => (c === 'gpu' ? null : 1))]);
    expect(s.gpu).toBeNull();
    expect(s.gpuWait!.mean).toBe(1);
  });
});
