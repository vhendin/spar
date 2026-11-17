// Birdsong, made from whistled tones. A handful of birds of the Jämtland forest and fell,
// each with the shape of its song rather than a recording of it: the great tit's see-saw,
// the chaffinch's tumbling run, the willow warbler's soft falling cascade, the redwing's
// fluted phrase, the cuckoo far off in early summer, the golden plover's lonely whistle
// above the trees, and at night now and then a little owl's run of hoots.

/** One whistled note: time from the start, length, start and end pitch, loudness. */
export type Note = [at: number, length: number, from: number, to: number, gain: number];

export interface Song {
  notes: Note[];
  /** How far away it is usually heard, metres. */
  near: number;
  far: number;
}

const r = (a: number, b: number): number => a + Math.random() * (b - a);
const ri = (a: number, b: number): number => Math.floor(r(a, b + 1));

export type Species = 'greatTit' | 'chaffinch' | 'willowWarbler' | 'redwing' | 'cuckoo' | 'plover' | 'owl';

export function song(species: Species): Song {
  const notes: Note[] = [];
  let t = 0;
  switch (species) {
    case 'greatTit': {
      // "ti-tu, ti-tu, ti-tu".
      const hi = r(5600, 7000), lo = hi * r(0.62, 0.72);
      for (let k = ri(3, 6); k > 0; k--) {
        notes.push([t, 0.09, hi, hi * 0.97, 0.8], [t + 0.13, 0.11, lo, lo * 0.95, 0.7]);
        t += r(0.3, 0.36);
      }
      return { notes, near: 15, far: 70 };
    }
    case 'chaffinch': {
      // A run that speeds up and falls, and a flourish at the end.
      let f = r(5800, 6600);
      for (let k = 0; k < 5; k++, t += 0.12) notes.push([t, 0.07, f, f * 0.8, 0.6]);
      f *= 0.82;
      for (let k = 0; k < 5; k++, t += 0.08) notes.push([t, 0.05, f, f * 0.82, 0.7]);
      f *= 0.85;
      notes.push([t, 0.06, f, f * 0.85, 0.8], [t + 0.08, 0.06, f * 1.2, f * 1.45, 0.8], [t + 0.16, 0.18, f * 1.1, f * 0.62, 0.9]);
      return { notes, near: 15, far: 80 };
    }
    case 'willowWarbler': {
      // Soft slurred notes falling down the scale.
      const count = ri(10, 14);
      const top = r(4800, 5400), bottom = r(2800, 3200);
      for (let k = 0; k < count; k++) {
        const f = top + ((bottom - top) * k) / (count - 1);
        notes.push([t, 0.11, f * 1.1, f * 0.9, 0.35 + 0.35 * Math.sin((Math.PI * (k + 1)) / (count + 1))]);
        t += 0.14;
      }
      return { notes, near: 12, far: 60 };
    }
    case 'redwing': {
      // A few fluted notes falling, then a quiet twitter.
      let f = r(3100, 3500);
      for (let k = ri(3, 5); k > 0; k--, t += 0.18) {
        notes.push([t, 0.14, f, f * 0.94, 0.8]);
        f *= r(0.86, 0.92);
      }
      for (let k = ri(4, 7); k > 0; k--, t += 0.05) {
        const g = r(4200, 6500);
        notes.push([t, 0.035, g, g * r(0.8, 1.2), 0.3]);
      }
      return { notes, near: 20, far: 90 };
    }
    case 'cuckoo': {
      // "Ku-ku", over and over, from across the valley.
      const hi = r(660, 720);
      for (let k = ri(5, 9); k > 0; k--, t += r(0.85, 1)) notes.push([t, 0.2, hi, hi * 0.98, 1], [t + 0.3, 0.32, hi * 0.82, hi * 0.8, 0.9]);
      return { notes, near: 120, far: 400 };
    }
    case 'plover': {
      // One mournful whistle, a pause, again.
      const f = r(2200, 2500);
      for (let k = ri(3, 6); k > 0; k--, t += r(2.4, 3.6)) notes.push([t, 0.38, f, f * 0.9, 1]);
      return { notes, near: 40, far: 160 };
    }
    case 'owl': {
      // A quick run of soft hoots.
      const f = r(600, 700);
      for (let k = ri(6, 10); k > 0; k--, t += 0.18) notes.push([t, 0.11, f, f * 0.96, 1]);
      return { notes, near: 60, far: 220 };
    }
  }
}

/** Plays a song from a source already placed in the world. */
export function sing(ctx: AudioContext, to: AudioNode, s: Song, loudness: number): number {
  const start = ctx.currentTime + 0.05;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, start);
  o.frequency.setValueAtTime(s.notes[0]![2], start);
  for (const [at, length, from, to2, gain] of s.notes) {
    const t = start + at;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to2, t + length);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * loudness, t + Math.min(0.015, length * 0.25));
    g.gain.linearRampToValueAtTime(gain * loudness * 0.7, t + length * 0.7);
    g.gain.linearRampToValueAtTime(0, t + length);
  }
  const last = s.notes[s.notes.length - 1]!;
  const end = start + last[0] + last[1] + 0.05;
  o.connect(g).connect(to);
  o.start(start);
  o.stop(end);
  o.onended = () => g.disconnect();
  return end - ctx.currentTime;
}
