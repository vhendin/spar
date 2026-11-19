// What an electric drivetrain sounds like, in place of an engine: no beat of firing, but a
// clean whine from the motors that climbs with their speed and swells with the current through
// them, pulling or regenerating; a thin whistle from the inverters that is heard most when
// pulling hard at low speed; the gears of the reduction drive; and, at walking pace, the soft
// two-note hum that electric vehicles play so people on foot hear them coming.

import type { AudioOut } from './output';
import { ease } from './output';

/** Orders of the motor's turning speed heard in the whine, and how loud each is. */
const ORDERS: [order: number, weight: number][] = [
  [6, 1],
  [12, 0.45],
  [24, 0.22],
  [2, 0.6],
];

/** The pedestrian warning sound fades out by this speed (m/s), about 20 km/h as in the EU rule. */
const WARN_UNTIL = 5.6;

export interface MotorSound {
  /** Motor speed, revolutions per minute. */
  rpm: number;
  /** 0..1 how hard it pulls. */
  drive: number;
  /** 0..1 how hard it regenerates, braking. */
  regen: number;
  /** Ground speed in m/s, unsigned. */
  speed: number;
}

export class ElectricMotorSound {
  private readonly level: GainNode;
  private readonly tones: { osc: OscillatorNode; gain: GainNode; order: number; weight: number }[] = [];
  private readonly inverter: OscillatorNode;
  private readonly inverterLevel: GainNode;
  private readonly warn: OscillatorNode[] = [];
  private readonly warnLevel: GainNode;
  private readonly warnTone: BiquadFilterNode;

  constructor(out: AudioOut, to: AudioNode) {
    const ctx = out.ctx;
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(to);

    // The whine: a few pure orders of the motor's speed, softened so the highest do not pierce.
    const soften = out.lowpass(5200, 0.5);
    soften.connect(this.level);
    for (const [order, weight] of ORDERS) {
      const osc = ctx.createOscillator();
      osc.type = order === 2 ? 'triangle' : 'sine';
      osc.frequency.value = 40;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(soften);
      osc.start();
      this.tones.push({ osc, gain, order, weight });
    }

    // The inverters switching: a thin, steady whistle through a narrow band.
    this.inverterLevel = ctx.createGain();
    this.inverterLevel.gain.value = 0;
    this.inverterLevel.connect(this.level);
    this.inverter = ctx.createOscillator();
    this.inverter.type = 'square';
    this.inverter.frequency.value = 1950;
    this.inverter.connect(out.filter('bandpass', 1950, 6)).connect(this.inverterLevel);
    this.inverter.start();

    // The warning hum: two soft notes a fifth apart, rising a little with the speed.
    this.warnLevel = ctx.createGain();
    this.warnLevel.gain.value = 0;
    this.warnLevel.connect(this.level);
    this.warnTone = out.lowpass(900, 0.7);
    this.warnTone.connect(this.warnLevel);
    for (const detune of [0, 702]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 180;
      osc.detune.value = detune;
      osc.connect(this.warnTone);
      osc.start();
      this.warn.push(osc);
    }
  }

  /** Call every frame; `on` false for silence (another kind of engine, or not on the ground yet). */
  update(t: number, on: boolean, m: MotorSound): void {
    ease(this.level.gain, on ? 1 : 0, t, 0.08);
    if (!on) return;
    const rps = m.rpm / 60;
    // The current through the motor makes it sing: louder pulling or regenerating than coasting.
    const current = Math.max(m.drive, m.regen * 0.7);
    const turning = Math.min(1, m.rpm / 600);
    for (const tone of this.tones) {
      ease(tone.osc.frequency, Math.max(20, rps * tone.order), t, 0.03);
      ease(tone.gain.gain, turning * tone.weight * (0.004 + 0.03 * current), t, 0.04);
    }
    // The inverter is heard at low speed under load, before the whine and the tyres cover it.
    const slow = Math.max(0, 1 - m.speed / 12);
    ease(this.inverterLevel.gain, 0.0025 * current * slow, t, 0.05);

    const walking = Math.max(0, 1 - m.speed / WARN_UNTIL);
    const moving = Math.min(1, m.speed / 0.3);
    ease(this.warnLevel.gain, 0.02 * walking * moving, t, 0.15);
    for (const osc of this.warn) ease(osc.frequency, 180 + m.speed * 22, t, 0.1);
    ease(this.warnTone.frequency, 700 + m.speed * 80, t, 0.1);
  }
}
