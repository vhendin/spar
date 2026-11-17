// The world around: wind that rises and falls in gusts, leaves rustling in it below the
// treeline, rain hissing on the ground and drumming on the roof when heard from the cab,
// and birds singing by day, most at dawn and in early summer.

import type * as THREE from 'three/webgpu';
import { song, sing, type Species } from './birds';
import { AudioOut, ease, place } from './output';


export interface AmbienceState {
  /** Sun's height in degrees, hours on the local clock, month 0..11. */
  sun: number;
  hour: number;
  month: number;
  /** 0..1 each. */
  wind: number;
  rain: number;
  /** Height of the ground under the listener, or null when not known. */
  ground: number | null;
  /** How fast the listener moves through the air, m/s. */
  speed: number;
  inside: boolean;
}

export class Ambience {
  private readonly windLevel: GainNode;
  private readonly windTone: BiquadFilterNode;
  private readonly leavesLevel: GainNode;
  private readonly rainLevel: GainNode;
  private readonly roofLevel: GainNode;
  private time = Math.random() * 100;
  /** Seconds until the next bird may start. */
  private nextBird = 2;
  private singing = 0;

  /** Where the forest gives way to bare fell in this region, metres above sea level. */
  treeline = 880;

  constructor(private readonly out: AudioOut) {
    const ctx = out.ctx;
    const b = out.buffers;
    const chain = (source: AudioNode, ...nodes: AudioNode[]): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      let at = source;
      for (const n of nodes) at = at.connect(n);
      at.connect(g).connect(out.world);
      return g;
    };
    this.windTone = out.lowpass(400, 0.9);
    this.windLevel = chain(out.loop(b.white), this.windTone);
    this.leavesLevel = chain(out.loop(b.white), out.filter('bandpass', 3800, 0.5));
    // Rain on the ground: drops, and the hiss of all of them together.
    const rainHiss = chain(out.loop(b.white), out.filter('bandpass', 5500, 0.4));
    const drops = out.loop(b.drops);
    drops.playbackRate.value = 1.2;
    this.rainLevel = chain(drops, out.filter('highpass', 900, 0.5));
    rainHiss.disconnect();
    rainHiss.connect(this.rainLevel);
    // Rain on the roof, heard only from inside: straight into the vehicle bus, unmuffled by the cab.
    this.roofLevel = ctx.createGain();
    this.roofLevel.gain.value = 0;
    const roof = out.loop(b.drops);
    roof.playbackRate.value = 0.5;
    roof.connect(out.lowpass(2200, 1)).connect(this.roofLevel).connect(out.vehicle);
  }

  update(dt: number, state: AmbienceState, listener: THREE.Vector3): void {
    const t = this.out.ctx.currentTime;
    this.time += dt;
    const s = this.time;
    // Gusts: slow, uneven swells.
    const gust = 0.55 + 0.25 * Math.sin(s * 0.31) * Math.sin(s * 0.13 + 1.7) + 0.2 * Math.sin(s * 0.71 + Math.sin(s * 0.23) * 2);
    const forest = state.ground === null ? 0.5 : Math.min(1, Math.max(0, (this.treeline + 40 - state.ground) / 80));
    // Higher up the wind is stronger and nothing breaks it.
    const exposed = state.ground === null ? 1 : 1 + 0.6 * Math.min(1, Math.max(0, (state.ground - this.treeline) / 300));
    const wind = Math.min(1, state.wind * exposed);
    const air = Math.min(1, state.speed / 25);
    ease(this.windLevel.gain, (0.04 + 0.5 * wind * gust) * (1 - 0.4 * forest) + (state.inside ? 0.05 : 0.6) * air * air, t, 0.3);
    ease(this.windTone.frequency, 180 + 650 * wind * gust + 900 * air, t, 0.3);
    ease(this.leavesLevel.gain, forest * (0.015 + 0.16 * wind * gust), t, 0.3);
    ease(this.rainLevel.gain, 0.5 * state.rain, t, 0.5);
    ease(this.roofLevel.gain, state.inside ? 0.9 * state.rain : 0, t, 0.2);

    this.birds(dt, state, forest, listener);
  }

  private birds(dt: number, state: AmbienceState, forest: number, listener: THREE.Vector3): void {
    this.singing -= dt;
    this.nextBird -= dt;
    if (this.nextBird > 0) return;
    const { sun, month } = state;
    const smooth = (a: number, b: number, x: number): number => {
      const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    const day = smooth(-6, 2, sun);
    // The dawn chorus: busiest just after sunrise.
    const dawn = state.hour < 12 ? Math.exp(-(((sun - 4) / 7) ** 2)) : 0;
    // Most song from May to July, some into August, little the rest of the year.
    const season = month >= 4 && month <= 6 ? 1 : month === 3 || month === 7 ? 0.5 : 0.12;
    const weather = (1 - 0.9 * state.rain) * (1 - 0.6 * state.wind);
    const busy = (0.25 * day + 0.9 * dawn) * season * weather;
    // An owl now and then in the dark.
    const owl = sun < -4 ? 0.012 * forest * (1 - state.rain) : 0;
    // One song at a time is plenty, with gaps; a busy chorus overlaps a little.
    const rate = busy + owl;
    this.nextBird = rate > 0 ? -Math.log(1 - Math.random()) / rate : 5;
    if (rate <= 0 || this.singing > 1.5 - busy) return;

    let species: Species;
    if (Math.random() < owl / rate) species = 'owl';
    else if (Math.random() > forest) species = 'plover';
    else {
      const pool: Species[] = ['willowWarbler', 'willowWarbler', 'chaffinch', 'chaffinch', 'greatTit', 'redwing', 'redwing'];
      if (month >= 4 && month <= 6 && day > 0.5) pool.push('cuckoo');
      species = pool[Math.floor(Math.random() * pool.length)]!;
    }
    const s = song(species);
    const ctx = this.out.ctx;
    const where = this.out.panner(s.near * 0.6, 1);
    const angle = Math.random() * Math.PI * 2;
    const distance = s.near + Math.random() * (s.far - s.near);
    place(where, listener.x + Math.cos(angle) * distance, listener.y + 4 + Math.random() * 10, listener.z + Math.sin(angle) * distance, ctx.currentTime, true);
    where.connect(this.out.world);
    const length = sing(ctx, where, s, 0.35);
    this.singing = length;
    setTimeout(() => where.disconnect(), (length + 1) * 1000);
  }
}
