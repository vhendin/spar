// What the vehicle sounds like: the engine following revs and throttle, a gearbox whine that
// rises with road speed (loudest in low range and reverse), a clunk at each gear change, the
// tyres on each kind of ground, splashing through water and squelching in bog, thumps from
// the suspension over bumps, bangs when it bottoms out or the vehicle lands from a jump, the
// crash of hitting a tree, rock, building or the ground, the scrape of the body sliding on
// the ground, and the crack of a tree giving way.

import * as THREE from 'three/webgpu';
import type { VehicleSim } from '../vehicle/sim';
import { AudioOut, ease, place } from './output';

/** The engine: an inline six, like the real vehicles' petrol engines. */
const CYLINDERS = 6;

interface Voice {
  /** Which of the output's noise loops. */
  buffer: keyof AudioOut['buffers'];
  filter: BiquadFilterType;
  frequency: number;
  q: number;
  /** Loudness at full speed. */
  gain: number;
  /** Surface speed (m/s) at which it is at its loudest and plays at its normal rate. */
  full: number;
  /** How much the loop speeds up with the tyres, 0 not at all. */
  rate: number;
}

/** The tyres on each kind of ground. */
const VOICES: Record<string, Voice> = {
  asphalt: { buffer: 'white', filter: 'lowpass', frequency: 420, q: 0.6, gain: 0.22, full: 20, rate: 0 },
  gravel: { buffer: 'gravel', filter: 'bandpass', frequency: 2400, q: 0.5, gain: 0.7, full: 14, rate: 0.8 },
  dirt: { buffer: 'crackle', filter: 'lowpass', frequency: 1100, q: 0.7, gain: 0.55, full: 12, rate: 0.7 },
  rock: { buffer: 'crackle', filter: 'bandpass', frequency: 900, q: 0.6, gain: 0.5, full: 10, rate: 0.6 },
  grass: { buffer: 'white', filter: 'bandpass', frequency: 2600, q: 0.6, gain: 0.12, full: 12, rate: 0 },
  sand: { buffer: 'white', filter: 'bandpass', frequency: 1400, q: 0.5, gain: 0.16, full: 10, rate: 0 },
  bog: { buffer: 'gurgle', filter: 'lowpass', frequency: 900, q: 0.8, gain: 0.9, full: 6, rate: 0.8 },
  water: { buffer: 'bubbles', filter: 'bandpass', frequency: 1300, q: 0.4, gain: 1.1, full: 6, rate: 0.6 },
};

/** A tree that gave way near the vehicle. */
export interface Crack {
  x: number;
  y: number;
  z: number;
  /** Trunk diameter in metres. */
  diameter: number;
}

/** Something pushed against the vehicle's body during a frame. */
export interface Impact {
  kind: 'ground' | 'tree' | 'rock' | 'object';
  /** Newtons. */
  force: number;
}

/** Contacts gentler than this many times the vehicle's weight are not hits. */
const HIT_G = 2.5;

export class VehicleAudio {
  private readonly at: PannerNode;
  private engine: AudioWorkletNode | null = null;
  private readonly engineTone: BiquadFilterNode;
  private readonly engineLevel: GainNode;
  private readonly intakeLevel: GainNode;
  private readonly intakeTone: BiquadFilterNode;
  private readonly whine: OscillatorNode;
  private readonly whineLevel: GainNode;
  private readonly squealLevel: GainNode;
  private readonly hissLevel: GainNode;
  private readonly hissTone: BiquadFilterNode;
  private readonly voices = new Map<string, { source: AudioBufferSourceNode; level: GainNode; voice: Voice }>();
  private gear = 1;
  private readonly lastSuspension: number[] = [];
  private readonly lastWater: boolean[] = [];
  private readonly forward = new THREE.Vector3();
  private readonly bed: GainNode;
  private bumpQuiet = 0;
  private stopQuiet = 0;
  private readonly hitQuiet = new Map<Impact['kind'], number>();
  /** The hardest push of each kind last frame: a hit is a sudden rise, not a steady weight. */
  private readonly lastPush = new Map<Impact['kind'], number>();
  /** Seconds with every wheel off the ground, and how fast it was falling a moment ago. */
  private airborne = 0;
  private falling = 0;
  private readonly scrapeLevel: GainNode;
  private readonly scrapeMetal: GainNode;
  private readonly scrapeSource: AudioBufferSourceNode;
  private scrape = 0;
  /** A hard saturation curve for the blows of crashes. */
  private readonly hard = softClip(4);
  private load = 0;

  constructor(private readonly out: AudioOut) {
    const ctx = out.ctx;
    this.at = out.panner(7, 1);
    this.at.connect(out.vehicle);
    // The steady sounds (engine, gears, tyres) go through one level that dips for a moment
    // when something hits hard, so the blow is heard over them.
    this.bed = ctx.createGain();
    this.bed.connect(this.at);

    // The exhaust: lowpassed pulses with a hollow resonance and a little grit from clipping.
    this.engineLevel = ctx.createGain();
    this.engineLevel.gain.value = 0;
    this.engineLevel.connect(this.bed);
    // A deep, boomy pipe: the low end lifted, a hollow resonance around 70 Hz.
    const boom = out.filter('lowshelf', 140, 0.7, 5);
    boom.connect(this.engineLevel);
    const body = out.filter('peaking', 70, 1.1, 8);
    body.connect(boom);
    this.engineTone = out.lowpass(300, 0.6);
    this.engineTone.connect(body);

    // Air drawn in and the rattle of the valves: a breathy band that climbs with the revs.
    this.intakeLevel = ctx.createGain();
    this.intakeLevel.gain.value = 0;
    this.intakeLevel.connect(this.bed);
    this.intakeTone = out.filter('bandpass', 900, 1.4);
    this.intakeTone.connect(this.intakeLevel);
    out.loop(out.buffers.white).connect(this.intakeTone);

    // Gears: a thin whine that rises with the speed of the shafts.
    this.whineLevel = ctx.createGain();
    this.whineLevel.gain.value = 0;
    this.whineLevel.connect(this.bed);
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whine.connect(this.whineLevel);
    this.whine.start();

    // Tyres squealing on hard ground.
    this.squealLevel = ctx.createGain();
    this.squealLevel.gain.value = 0;
    this.squealLevel.connect(this.bed);
    const squeal = out.filter('bandpass', 1050, 14);
    squeal.connect(this.squealLevel);
    out.loop(out.buffers.white).connect(squeal);

    // Spray hissing off the tyres on wet ground.
    this.hissLevel = ctx.createGain();
    this.hissLevel.gain.value = 0;
    this.hissLevel.connect(this.bed);
    this.hissTone = out.filter('highpass', 2500, 0.5);
    this.hissTone.connect(this.hissLevel);
    out.loop(out.buffers.white).connect(this.hissTone);

    // The body sliding on the ground: grinding grit, and a metal screech on top.
    this.scrapeLevel = ctx.createGain();
    this.scrapeLevel.gain.value = 0;
    this.scrapeLevel.connect(this.at);
    this.scrapeSource = out.loop(out.buffers.gravel);
    this.scrapeSource.connect(out.filter('bandpass', 1500, 1.1)).connect(this.scrapeLevel);
    this.scrapeMetal = ctx.createGain();
    this.scrapeMetal.gain.value = 0;
    this.scrapeMetal.connect(this.at);
    out.loop(out.buffers.white).connect(out.filter('bandpass', 3300, 7)).connect(this.scrapeMetal);

    for (const [ground, voice] of Object.entries(VOICES)) {
      const source = out.loop(out.buffers[voice.buffer]);
      const filter = out.filter(voice.filter, voice.frequency, voice.q);
      const level = ctx.createGain();
      level.gain.value = 0;
      source.connect(filter).connect(level).connect(this.bed);
      this.voices.set(ground, { source, level, voice });
    }
  }

  /**
   * Call every frame. `group` is the drawn vehicle; `quiet` when it is not on the ground yet,
   * so nothing plays. `pedal` is the throttle pedal in the direction of travel.
   */
  update(dt: number, sim: VehicleSim, group: THREE.Object3D, pedal: number, wetness: number, cracks: Crack[], impacts: Impact[], quiet: boolean): void {
    const ctx = this.out.ctx;
    const t = ctx.currentTime;
    if (!this.engine && this.out.ready) {
      this.engine = new AudioWorkletNode(ctx, 'spar-engine', { processorOptions: { cylinders: CYLINDERS }, outputChannelCount: [1] });
      const grit = ctx.createWaveShaper();
      grit.curve = softClip();
      this.engine.connect(grit).connect(this.engineTone);
    }

    this.forward.set(0, 0, 1).applyQuaternion(group.quaternion);
    const p = group.position;
    place(this.at, p.x + this.forward.x * 1.2, p.y + 1 + this.forward.y * 1.2, p.z + this.forward.z * 1.2, t);

    const d = sim.drivetrain;
    const def = sim.def.drivetrain;
    const rpm = quiet ? 0 : Math.max(def.idle, d.rpm || def.idle);
    const rev = rpm / def.redline;
    // Off the throttle while the clutch is out for a gear change.
    this.load += ((d.shifting > 0 ? 0 : pedal) - this.load) * Math.min(1, dt * 12);
    const load = this.load;
    if (this.engine) {
      ease(this.engine.parameters.get('rpm')!, rpm, t, 0.02);
      ease(this.engine.parameters.get('load')!, load, t, 0.03);
    }
    ease(this.engineTone.frequency, 140 + rpm * 0.1 + load * 380, t);
    ease(this.engineLevel.gain, quiet ? 0 : 1.1 + 0.6 * load + 0.4 * rev, t);
    ease(this.intakeTone.frequency, 250 + rpm * 0.2, t);
    ease(this.intakeLevel.gain, quiet ? 0 : (0.004 + 0.02 * load) * (0.3 + rev), t);

    // Gears: the transfer case turns with the wheels, faster in low range; reverse is straight-cut and sings.
    const speed = Math.abs(sim.speed);
    const shaft = (speed / (2 * Math.PI * sim.def.wheels.radius)) * def.finalDrive * def.ranges[d.range]!;
    const reverse = d.gear < 0;
    ease(this.whine.frequency, Math.max(30, shaft * (reverse ? 19 : 13)), t);
    const whine = quiet ? 0 : Math.min(1, speed / 3) * (0.002 + 0.004 * load) * (d.range === 'low' ? 2 : 1) * (reverse ? 2 : 1);
    ease(this.whineLevel.gain, whine, t);

    if (d.gear !== this.gear) {
      if (!quiet) this.clunk();
      this.gear = d.gear;
    }

    // Tyres: each ground's sound in proportion to the wheels on it, louder as they turn faster or slip.
    const levels = new Map<string, number>();
    let rate = 0;
    let squeal = 0;
    let wetRoll = 0;
    const n = sim.wheels.length;
    sim.wheels.forEach((wheel, i) => {
      // Thumps when a wheel is pushed up hard: a pothole, a rock, a landing.
      const prev = this.lastSuspension[i] ?? wheel.suspension;
      const push = dt > 0 ? (prev - wheel.suspension) / dt : 0;
      this.lastSuspension[i] = wheel.suspension;
      if (!quiet && wheel.bump > 0.97 && push > 0.6 && this.stopQuiet <= 0) {
        // On the bump stops: a hard metallic bang instead of a thump.
        this.bottomOut(Math.min(1, (push - 0.6) / 2.5));
        this.stopQuiet = 0.15;
        this.bumpQuiet = 0.08;
      } else if (!quiet && push > 0.7 && this.bumpQuiet <= 0) {
        this.thump(Math.min(1, (push - 0.7) / 2.2));
        this.bumpQuiet = 0.08;
      }
      const inWater = wheel.contact && wheel.ground === 'water';
      if (!quiet && inWater && !this.lastWater[i] && speed > 1.5) this.splash(Math.min(1, speed / 8));
      this.lastWater[i] = inWater;
      if (!wheel.contact) return;
      const surface = speed + Math.min(1, wheel.spin) * 6 + Math.abs(wheel.slide) * 0.6 + wheel.skid * speed * 0.4;
      const share = 1 / n;
      const add = (ground: string, amount: number): void => {
        levels.set(ground, (levels.get(ground) ?? 0) + amount);
      };
      add(wheel.ground, share * surface);
      // Wet dirt and grass squelch a bit too.
      if ((wheel.ground === 'dirt' || wheel.ground === 'grass') && wetness > 0.3) add('bog', share * surface * 0.3 * wetness);
      if (wheel.ground === 'asphalt' || wheel.ground === 'rock') squeal = Math.max(squeal, Math.max(wheel.skid, Math.min(1, (Math.abs(wheel.slide) - 2) / 4)));
      if (wheel.ground !== 'water' && wheel.ground !== 'bog') wetRoll += share * wetness * surface;
      rate = Math.max(rate, surface);
    });
    this.bumpQuiet -= dt;
    this.stopQuiet -= dt;

    // Landing: after a while with every wheel in the air, the first one down; as hard as the fall was fast.
    const vy = sim.body.linvel().y;
    if (sim.wheels.every((w) => !w.contact)) {
      this.airborne += dt;
      this.falling = Math.max(0, -vy);
    } else {
      if (!quiet && this.airborne > 0.35) {
        const strength = Math.min(1, (this.falling - 1.5) / 6);
        if (strength > 0.05) this.land(strength);
      }
      this.airborne = 0;
    }

    // Hits against the body, by what was hit, as hard as the push was against the vehicle's weight.
    const weight = sim.body.mass() * 9.81;
    const hardest = new Map<Impact['kind'], number>();
    let rubbing = 0;
    for (const i of impacts) {
      const g = i.force / weight;
      hardest.set(i.kind, Math.max(hardest.get(i.kind) ?? 0, g));
      if (i.kind === 'ground') rubbing = Math.max(rubbing, g);
    }
    for (const [kind, quietFor] of this.hitQuiet) this.hitQuiet.set(kind, quietFor - dt);
    for (const kind of ['ground', 'tree', 'rock', 'object'] as const) {
      const g = hardest.get(kind) ?? 0;
      const before = this.lastPush.get(kind) ?? 0;
      this.lastPush.set(kind, g);
      // Lying on its side or leaning on a trunk pushes all the time; only a jump in the push is a hit.
      if (quiet || g < HIT_G || g < before * 2 + HIT_G * 0.5 || (this.hitQuiet.get(kind) ?? 0) > 0) continue;
      this.hit(kind, Math.min(1, (g - HIT_G) / 12));
      this.hitQuiet.set(kind, 0.25);
    }
    // Scraping: the body pressed on the ground while it moves.
    const scrape = quiet ? 0 : Math.min(1, rubbing / 1.5) * Math.min(1, speed / 5);
    this.scrape += (scrape - this.scrape) * Math.min(1, dt * (scrape > this.scrape ? 20 : 6));
    ease(this.scrapeLevel.gain, this.scrape * 0.9, t, 0.03);
    ease(this.scrapeMetal.gain, this.scrape * 0.12, t, 0.03);
    ease(this.scrapeSource.playbackRate, 0.7 + Math.min(1.2, speed / 10), t, 0.05);

    for (const [ground, v] of this.voices) {
      const s = quiet ? 0 : (levels.get(ground) ?? 0) / v.voice.full;
      const level = v.voice.gain * Math.min(1.4, Math.pow(s, 0.8));
      ease(v.level.gain, level, t, 0.06);
      if (v.voice.rate > 0) ease(v.source.playbackRate, 0.55 + v.voice.rate * Math.min(1.5, rate / v.voice.full), t, 0.1);
    }
    ease(this.squealLevel.gain, quiet ? 0 : squeal * Math.min(1, speed / 4) * 0.5, t);
    ease(this.hissLevel.gain, quiet ? 0 : Math.min(0.25, wetRoll * 0.02), t);
    ease(this.hissTone.frequency, 2000 + wetRoll * 120, t);

    for (const c of cracks) if (!quiet) this.crack(c);
  }

  /** A short one-off sound at the vehicle: a burst of a noise loop through a filter. */
  private burst(buffer: AudioBuffer, type: BiquadFilterType, frequency: number, q: number, gain: number, decay: number, rate = 1, delay = 0, to: AudioNode = this.at): void {
    const ctx = this.out.ctx;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    const f = this.out.filter(type, frequency, q);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, decay);
    s.connect(f).connect(g).connect(to);
    const offset = Math.random() * (buffer.duration - 1);
    s.start(t, Math.max(0, offset));
    s.stop(t + decay * 8 + 0.05);
    s.onended = () => g.disconnect();
  }

  /**
   * A heavy body blow, made to be felt on small speakers too: a tone that drops fast from
   * around 150 Hz to `low` (a kick drum's punch), driven hard so its overtones carry where a
   * pure deep tone would not be heard, with a low burst of noise for the crunch.
   */
  private slam(low: number, gain: number, decay: number): void {
    const ctx = this.out.ctx;
    const t = ctx.currentTime;
    // Duck the engine and tyres under the blow, the harder the deeper, and bring them back.
    const dip = Math.max(0.25, 1 - 0.55 * gain);
    this.bed.gain.cancelScheduledValues(t);
    this.bed.gain.setValueAtTime(this.bed.gain.value, t);
    this.bed.gain.linearRampToValueAtTime(dip, t + 0.01);
    this.bed.gain.setTargetAtTime(1, t + 0.25, 0.2);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(low * 3.2, t);
    o.frequency.exponentialRampToValueAtTime(low, t + 0.07);
    const drive = ctx.createWaveShaper();
    drive.curve = this.hard;
    const tone = this.out.lowpass(900, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, decay);
    // Driven before the envelope, so the blow keeps its weight as it dies away.
    const pre = ctx.createGain();
    pre.gain.value = 3;
    o.connect(pre).connect(drive).connect(tone).connect(g).connect(this.at);
    o.start(t);
    o.stop(t + decay * 8 + 0.05);
    o.onended = () => g.disconnect();
    this.burst(this.out.buffers.white, 'lowpass', 260, 0.9, gain * 0.55, decay * 0.7);
  }

  /** A low thud: a falling tone that dies quickly. */
  private thud(frequency: number, gain: number, decay: number, to: AudioNode = this.at): void {
    const ctx = this.out.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(frequency, t);
    o.frequency.exponentialRampToValueAtTime(frequency * 0.55, t + decay * 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.005, decay);
    o.connect(g).connect(to);
    o.start(t);
    o.stop(t + decay * 8 + 0.05);
    o.onended = () => g.disconnect();
  }

  private clunk(): void {
    const b = this.out.buffers;
    this.burst(b.white, 'bandpass', 1500, 4, 0.18, 0.02);
    this.thud(150, 0.25, 0.035);
  }

  private thump(strength: number): void {
    const b = this.out.buffers;
    this.thud(75, 0.4 + 0.6 * strength, 0.06 + 0.05 * strength);
    this.burst(b.white, 'lowpass', 500, 0.7, 0.25 * strength + 0.05, 0.04);
    // Loose things in the back rattle.
    this.burst(b.crackle, 'bandpass', 1800, 1.2, 0.3 * strength, 0.08, 1.5);
  }

  private splash(strength: number): void {
    const b = this.out.buffers;
    this.burst(b.white, 'bandpass', 1400, 0.5, 0.5 * strength, 0.12);
    this.burst(b.bubbles, 'lowpass', 2500, 0.7, 0.8 * strength, 0.25, 1.4);
  }

  /** A struck metal panel: a few inharmonic partials that ring briefly. */
  private ring(frequencies: number[], gain: number, decay: number): void {
    const ctx = this.out.ctx;
    const t = ctx.currentTime;
    frequencies.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      const level = gain / (1 + i * 0.8);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, decay / (1 + i * 0.4));
      o.connect(g).connect(this.at);
      o.start(t);
      o.stop(t + decay * 8 + 0.05);
      o.onended = () => g.disconnect();
    });
  }

  /** The suspension hitting its bump stops: a hard bang through the frame, and everything loose jumps. */
  private bottomOut(strength: number): void {
    const b = this.out.buffers;
    this.thud(95, 0.9 + 0.5 * strength, 0.07);
    this.ring([180, 497, 973], 0.12 + 0.18 * strength, 0.08);
    this.burst(b.white, 'bandpass', 1200, 2, 0.35 * strength + 0.1, 0.03);
    this.burst(b.crackle, 'bandpass', 2200, 1.2, 0.4 * strength + 0.1, 0.12, 1.6);
  }

  /** Coming down from a jump: a deep slam of the whole vehicle, rattling, and the body creaking. */
  private land(strength: number): void {
    const b = this.out.buffers;
    this.slam(50, 0.7 + 0.84 * strength, 0.12 + 0.06 * strength);
    this.thud(110, 0.4 + 0.4 * strength, 0.06);
    this.burst(b.crackle, 'bandpass', 1900, 1, 0.5 * strength + 0.1, 0.18, 1.4);
    this.burst(b.white, 'bandpass', 700, 9, 0.2 * strength, 0.2, 1, 0.05);
  }

  /** The body hitting something, sounding of what it hit. */
  private hit(kind: Impact['kind'], strength: number): void {
    const b = this.out.buffers;
    const s = strength;
    switch (kind) {
      case 'ground':
        // Rolling or nosing in: a heavy slam, crumpling metal, earth and bits flying.
        this.slam(45, 0.98 + 0.84 * s, 0.16);
        this.ring([140, 389, 812, 1490], 0.08 + 0.12 * s, 0.1);
        this.burst(b.gravel, 'bandpass', 1500, 0.8, 0.6 * s + 0.15, 0.2, 1.2);
        this.burst(b.crackle, 'bandpass', 1800, 1, 0.4 * s, 0.2, 1.3, 0.04);
        break;
      case 'tree':
        // A trunk does not give: the whole vehicle slams to a stop against it. A deep thud,
        // the bumper and panels crumpling (a dull dent, not a bell), a hard knock of wood,
        // and only a faint rustle from the crown.
        this.slam(48, 1.12 + 0.84 * s, 0.17 + 0.06 * s);
        this.burst(b.crackle, 'bandpass', 500, 1.2, 0.5 * s + 0.2, 0.09, 0.6);
        this.ring([92, 238, 455], 0.05 + 0.08 * s, 0.06);
        this.burst(b.white, 'lowpass', 1100, 0.6, 0.04 + 0.06 * s, 0.25, 1, 0.08);
        break;
      case 'rock':
        // Stone: a hard crack, metal ringing, grit.
        this.slam(60, 0.98 + 0.7 * s, 0.12);
        this.ring([160, 450, 920, 1700], 0.08 + 0.14 * s, 0.1);
        this.burst(b.gravel, 'bandpass', 2600, 0.9, 0.5 * s + 0.15, 0.12, 1.4);
        break;
      case 'object':
        // A wall, fence or log pile: boards splintering.
        this.slam(55, 0.98 + 0.7 * s, 0.13);
        this.burst(b.crackle, 'bandpass', 1400, 0.9, 0.6 * s + 0.2, 0.15, 1.2);
        this.ring([200, 540, 1050], 0.06 + 0.1 * s, 0.08);
        break;
    }
  }

  /** A trunk breaking: a sharp crack, a second as it splits, then the crown swishing down. */
  private crack(c: Crack): void {
    const ctx = this.out.ctx;
    const to = this.out.panner(10, 1);
    place(to, c.x, c.y + 1.5, c.z, ctx.currentTime, true);
    to.connect(this.out.vehicle);
    const size = Math.min(1, c.diameter / 0.25);
    const b = this.out.buffers;
    this.burst(b.white, 'highpass', 1400, 0.7, 0.6 + 0.4 * size, 0.025, 1, 0, to);
    this.burst(b.crackle, 'bandpass', 2200, 0.8, 0.8 * size + 0.3, 0.06, 1.6, 0.03, to);
    this.burst(b.white, 'bandpass', 600, 1, 0.3 * size + 0.1, 0.05, 1, 0.06, to);
    this.burst(b.white, 'bandpass', 4200, 0.6, 0.18 + 0.1 * size, 0.35, 1, 0.25, to);
    this.thud(55, 0.3 + 0.5 * size, 0.15, to);
    setTimeout(() => to.disconnect(), 4000);
  }
}

/** A gentle saturation curve, for some grit in the exhaust. */
function softClip(drive = 1.8): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}
