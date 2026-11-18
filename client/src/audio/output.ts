// The way out to the speakers: one audio context for the page, a master volume, and two
// buses, the vehicle's own sounds and the world around it (wind, rain, birds). From inside
// the cab both are muffled the way a closed cab muffles them.
//
// Browsers only let sound start after the player has pressed something, so the context
// waits for the first key, click or tap. Everything is made in code: no recordings.

import * as THREE from 'three/webgpu';
import { ENGINE_WORKLET } from './engineWorklet';

/** Seconds for the volume and the cab muffling to settle. */
/** Master level at full volume: the steady sounds stay this far below the limiter. */
const HEADROOM = 0.8;
const EASE = 0.08;

export class AudioOut {
  readonly ctx: AudioContext;
  /** Sounds of the vehicle, positioned on it. */
  readonly vehicle: GainNode;
  /** Sounds of the world: wind, rain, birds. */
  readonly world: GainNode;
  /** True once the engine's sound processor has loaded. */
  ready = false;
  /** Loops of noise for the textures everything is shaped from. */
  readonly buffers: {
    white: AudioBuffer;
    gravel: AudioBuffer;
    crackle: AudioBuffer;
    drops: AudioBuffer;
    bubbles: AudioBuffer;
    gurgle: AudioBuffer;
  };
  private readonly master: GainNode;
  private readonly vehicleMuffle: BiquadFilterNode;
  private readonly worldMuffle: BiquadFilterNode;
  private readonly worldLevel: GainNode;
  private volumeSet = 0.7;
  private pausedSet = false;
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(volume: number) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    // The volume, then a limiter as the very last thing: it only catches the peaks of crashes
    // just below full scale, so the steady sounds pass untouched and leave room above them.
    this.master = this.ctx.createGain();
    const limit = this.ctx.createDynamicsCompressor();
    limit.threshold.value = -2;
    limit.knee.value = 2;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.12;
    this.master.connect(limit).connect(this.ctx.destination);

    this.vehicleMuffle = this.lowpass(20000);
    this.vehicleMuffle.connect(this.master);
    this.vehicle = this.ctx.createGain();
    this.vehicle.connect(this.vehicleMuffle);

    this.worldLevel = this.ctx.createGain();
    this.worldLevel.connect(this.master);
    this.worldMuffle = this.lowpass(20000);
    this.worldMuffle.connect(this.worldLevel);
    this.world = this.ctx.createGain();
    this.world.connect(this.worldMuffle);

    const sr = this.ctx.sampleRate;
    this.buffers = {
      white: noise(sr, 2, () => Math.random() * 2 - 1),
      gravel: clicks(sr, 2, 1400, 0.0012, 0.5),
      crackle: clicks(sr, 2, 260, 0.002, 0.3),
      drops: clicks(sr, 2, 2600, 0.0006, 0.6),
      bubbles: bubbles(sr, 3, 45, 500, 1700),
      gurgle: bubbles(sr, 3, 22, 110, 420),
    };
    this.volume = volume;

    // Sound may start only after the player has done something on the page.
    const unlock = (): void => {
      if (this.ctx.state === 'suspended' && !this.pausedSet && this.volumeSet > 0) void this.ctx.resume();
    };
    for (const type of ['keydown', 'pointerdown', 'touchstart'] as const) window.addEventListener(type, unlock, { capture: true });
    unlock();

    const url = URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: 'application/javascript' }));
    this.ctx.audioWorklet.addModule(url).then(
      () => {
        this.ready = true;
        URL.revokeObjectURL(url);
      },
      (err: unknown) => console.warn('No engine sound:', err),
    );
  }

  lowpass(frequency: number, q = 0.7): BiquadFilterNode {
    return this.filter('lowpass', frequency, q);
  }

  filter(type: BiquadFilterType, frequency: number, q = 0.7, gain = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }

  /** A looping buffer, started at a random point so loops of the same texture do not line up. */
  loop(buffer: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start(0, Math.random() * buffer.duration);
    return s;
  }

  /** 0 silent to 1 full. */
  set volume(v: number) {
    this.volumeSet = v;
    // A little below unity even at full volume, as headroom for crashes.
    this.master.gain.setTargetAtTime(v * v * HEADROOM, this.ctx.currentTime, EASE);
    this.apply();
  }

  /** While paused the sound stops altogether. */
  set paused(on: boolean) {
    this.pausedSet = on;
    this.apply();
  }

  private apply(): void {
    if (this.pausedSet || this.volumeSet <= 0) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Inside the cab the world is muffled, and the vehicle's own sounds a little. */
  set inside(on: boolean) {
    const t = this.ctx.currentTime;
    this.worldMuffle.frequency.setTargetAtTime(on ? 1100 : 20000, t, EASE);
    this.worldLevel.gain.setTargetAtTime(on ? 0.55 : 1, t, EASE);
    this.vehicleMuffle.frequency.setTargetAtTime(on ? 2600 : 20000, t, EASE);
  }

  /** The ears go where the camera is. */
  listen(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    const p = camera.position;
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(this.forward.x, t);
      l.forwardY.setValueAtTime(this.forward.y, t);
      l.forwardZ.setValueAtTime(this.forward.z, t);
      l.upX.setValueAtTime(this.up.x, t);
      l.upY.setValueAtTime(this.up.y, t);
      l.upZ.setValueAtTime(this.up.z, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z);
    }
  }

  /** A sound source in the world, quieter with distance. */
  panner(refDistance: number, rolloff = 1): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = 10000;
    return p;
  }
}

/** Moves a panner, smoothly enough not to click, or at once with `jump`. */
export function place(p: PannerNode, x: number, y: number, z: number, t: number, jump = false): void {
  if (!p.positionX) p.setPosition(x, y, z);
  else if (jump) {
    p.positionX.setValueAtTime(x, t);
    p.positionY.setValueAtTime(y, t);
    p.positionZ.setValueAtTime(z, t);
  } else {
    p.positionX.setTargetAtTime(x, t, 0.02);
    p.positionY.setTargetAtTime(y, t, 0.02);
    p.positionZ.setTargetAtTime(z, t, 0.02);
  }
}

/** Eases an audio parameter towards a value. */
export function ease(param: AudioParam, value: number, t: number, tau = 0.05): void {
  param.setTargetAtTime(value, t, tau);
}

function noise(sr: number, seconds: number, sample: () => number): AudioBuffer {
  const buffer = new AudioBuffer({ length: Math.floor(sr * seconds), sampleRate: sr, numberOfChannels: 1 });
  const d = buffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = sample();
  return buffer;
}

/**
 * Sparse little bursts at random, `rate` a second, each `length` seconds long: stones under a
 * tyre, raindrops, twigs. Played faster, they come thicker and sharper.
 */
function clicks(sr: number, seconds: number, rate: number, length: number, spread: number): AudioBuffer {
  const buffer = noise(sr, seconds, () => 0);
  const d = buffer.getChannelData(0);
  const n = Math.floor(rate * seconds);
  const len = Math.max(4, Math.floor(length * sr));
  for (let k = 0; k < n; k++) {
    const at = Math.floor(Math.random() * d.length);
    const amp = (1 - spread + spread * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
    const l = Math.floor(len * (0.5 + Math.random()));
    for (let i = 0; i < l; i++) d[(at + i) % d.length]! += amp * (Math.random() * 2 - 1) * Math.exp((-5 * i) / l);
  }
  return buffer;
}

/** Bubbles: short tones that rise as they ring away, the sound of water being churned. */
function bubbles(sr: number, seconds: number, rate: number, low: number, high: number): AudioBuffer {
  const buffer = noise(sr, seconds, () => 0);
  const d = buffer.getChannelData(0);
  const n = Math.floor(rate * seconds);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(Math.random() * d.length);
    const f = low * Math.pow(high / low, Math.random());
    const life = (0.012 + Math.random() * 0.03) * (600 / f) ** 0.5;
    const len = Math.floor(life * sr * 3);
    const amp = 0.3 + 0.7 * Math.random();
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      phase += (2 * Math.PI * f * (1 + (t / life) * 0.6)) / sr;
      d[(at + i) % d.length]! += amp * Math.sin(phase) * Math.exp(-t / life);
    }
  }
  // Keep the loudest bubble within range.
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 1) for (let i = 0; i < d.length; i++) d[i]! /= peak;
  return buffer;
}
