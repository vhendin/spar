// The engine's sound, made sample by sample on the audio thread: one exhaust pulse for every
// cylinder firing, so the beat follows the revs exactly. Under load each pulse is harder and
// rougher; off the throttle it softens to a burble. The filters outside shape the pipe.
//
// Kept as source text and loaded from a blob, so it needs no separate build step.

export const ENGINE_WORKLET = /* js */ `
class SparEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 800, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.cylinders = (options.processorOptions && options.processorOptions.cylinders) || 6;
    this.seed = 0x2545f491;
    // No two cylinders fire quite alike: the uneven beat of a real engine.
    this.trim = [];
    for (let i = 0; i < this.cylinders; i++) this.trim.push(0.82 + 0.36 * this.rand());
    this.phase = 0;
    this.slot = 0;
    this.pulse = 0;
    this.decay = 0.99;
    this.rpm = 800;
    this.load = 0;
    this.x1 = 0;
    this.y1 = 0;
    this.lp = 0;
  }

  rand() {
    this.seed ^= this.seed << 13; this.seed >>>= 0;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5; this.seed >>>= 0;
    return this.seed / 4294967296;
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpmTarget = Math.max(200, parameters.rpm[0]);
    const loadTarget = parameters.load[0];
    // About 30 ms to follow a change, as a flywheel would.
    const follow = 1 - Math.exp(-1 / (0.03 * sampleRate));
    const n = this.cylinders;
    for (let i = 0; i < out.length; i++) {
      this.rpm += (rpmTarget - this.rpm) * follow;
      this.load += (loadTarget - this.load) * follow;
      // Phase runs 0..1 over two turns of the crank, the time for every cylinder to fire once.
      this.phase += this.rpm / 120 / sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      const slot = Math.floor(this.phase * n);
      if (slot !== this.slot) {
        this.slot = slot;
        const load = this.load;
        const rough = 1 + (this.rand() - 0.5) * (0.12 + 0.35 * load);
        this.pulse += (0.3 + 0.7 * load) * this.trim[slot] * rough;
        // Each pulse rings away in about a third of the time to the next one.
        const gap = 120 / (this.rpm * n);
        this.decay = Math.exp(-1 / (gap * 0.32 * sampleRate));
      }
      this.pulse *= this.decay;
      const rasp = (this.rand() * 2 - 1) * this.pulse * (0.15 + 0.45 * this.load);
      // A touch of smoothing on the pulse's leading edge, then the rasp on top.
      this.lp += (this.pulse - this.lp) * 0.35;
      const x = this.lp + rasp;
      // Block the steady part, leaving only the beat.
      const y = x - this.x1 + 0.995 * this.y1;
      this.x1 = x;
      this.y1 = y;
      out[i] = y;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('spar-engine', SparEngine);
`;
