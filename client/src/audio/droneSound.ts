// What a small quadcopter sounds like: a whirring buzz from four rotors turning at nearly but
// not quite the same speed, so they beat against each other, with the hiss of the air through
// them. The rotors speed up as it climbs or pushes ahead and slow as it sinks, and the buzz
// follows. Heard where the drone is; made in code like every other sound.

import type { AudioOut } from './output';
import { ease, place } from './output';

/** Blade-passing frequency of a rotor holding a hover, Hz. */
const HOVER = 190;
/** How far apart the four rotors run, as shares of that. */
const SPREAD = [-0.021, -0.007, 0.009, 0.024];

export class DroneSound {
  private readonly panner: PannerNode;
  private readonly level: GainNode;
  private readonly rotors: OscillatorNode[] = [];
  private readonly air: BiquadFilterNode;
  private readonly source: AudioBufferSourceNode;
  private placed = false;

  constructor(private readonly out: AudioOut) {
    const ctx = out.ctx;
    this.panner = out.panner(4, 1.2);
    this.panner.connect(out.world);
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(this.panner);

    // The buzz: sawtooth rotors, the harshest overtones taken off.
    const tone = out.lowpass(2600, 0.8);
    const body = out.filter('peaking', 420, 1.2, 5);
    tone.connect(body).connect(this.level);
    const each = ctx.createGain();
    each.gain.value = 0.25;
    each.connect(tone);
    for (const s of SPREAD) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = HOVER * (1 + s);
      osc.connect(each);
      osc.start();
      this.rotors.push(osc);
    }

    // The air pushed through the rotors: a band of noise that rises with them.
    this.air = out.filter('bandpass', 1500, 0.9);
    const airLevel = ctx.createGain();
    airLevel.gain.value = 0.35;
    this.source = out.loop(out.buffers.white);
    this.source.connect(this.air).connect(airLevel).connect(this.level);
  }

  /**
   * Call every frame. `on` false fades it out (docked, or put away); `thrust` about 1 at a
   * hover, more climbing or pushing ahead, less sinking. `volume` 0..1 scales it (our own
   * drone, heard from its own camera, a little softer).
   */
  update(on: boolean, x: number, y: number, z: number, thrust: number, volume = 1): void {
    const t = this.out.ctx.currentTime;
    place(this.panner, x, y, z, t, !this.placed);
    this.placed = true;
    ease(this.level.gain, on ? 0.09 * volume : 0, t, on ? 0.25 : 0.4);
    const k = Math.max(0.75, Math.min(1.35, thrust));
    SPREAD.forEach((s, i) => ease(this.rotors[i]!.frequency, HOVER * k * (1 + s), t, 0.12));
    ease(this.air.frequency, 1500 * k, t, 0.12);
  }

  dispose(): void {
    for (const o of this.rotors) o.stop();
    this.source.stop();
    this.panner.disconnect();
  }
}

/**
 * How hard the rotors work, from the drone's velocity now and a moment ago: about 1 at a
 * hover, up to about 1.35 climbing hard or speeding up, down to 0.8 sinking.
 */
export function thrustOf(v: { x: number; y: number; z: number }, before: { x: number; y: number; z: number }, dt: number): number {
  if (dt <= 0) return 1;
  const level = Math.hypot(v.x, v.z);
  const accel = Math.hypot(v.x - before.x, v.z - before.z) / dt;
  return 1 + 0.035 * v.y + 0.006 * level + 0.012 * Math.min(10, accel);
}
