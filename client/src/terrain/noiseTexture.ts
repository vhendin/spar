// Gradient noise worked out once into a texture that repeats seamlessly, so the ground shader
// reads its noise from memory instead of computing it for every pixel (the noise was a large
// share of the ground's GPU time). Each of the four channels is a different noise, so octaves
// read from different channels do not repeat together.

import * as THREE from 'three/webgpu';
import { createRng } from '@spar/shared';

/** Lattice cells across the texture, and texels per cell. */
export const NOISE_CELLS = 64;
const TEXELS_PER_CELL = 8;
export const NOISE_SIZE = NOISE_CELLS * TEXELS_PER_CELL;

/**
 * Four channels of seamless gradient noise, NOISE_SIZE square, each value -1..1 stored as 0..255.
 * One unit of the noise's input is one lattice cell, as with mx_noise_float.
 */
export function noiseData(seed = 0x6e01): Uint8Array {
  const size = NOISE_SIZE;
  const out = new Uint8Array(size * size * 4);
  const rng = createRng(seed);
  for (let ch = 0; ch < 4; ch++) {
    // A unit gradient at every lattice point, wrapping at NOISE_CELLS.
    const gx = new Float32Array(NOISE_CELLS * NOISE_CELLS);
    const gy = new Float32Array(NOISE_CELLS * NOISE_CELLS);
    for (let i = 0; i < gx.length; i++) {
      const a = rng.float() * Math.PI * 2;
      gx[i] = Math.cos(a);
      gy[i] = Math.sin(a);
    }
    const dot = (cx: number, cy: number, dx: number, dy: number): number => {
      const i = (cy % NOISE_CELLS) * NOISE_CELLS + (cx % NOISE_CELLS);
      return gx[i]! * dx + gy[i]! * dy;
    };
    const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = (x + 0.5) / TEXELS_PER_CELL;
        const py = (y + 0.5) / TEXELS_PER_CELL;
        const cx = Math.floor(px);
        const cy = Math.floor(py);
        const fx = px - cx;
        const fy = py - cy;
        const u = fade(fx);
        const v = fade(fy);
        const top = dot(cx, cy, fx, fy) * (1 - u) + dot(cx + 1, cy, fx - 1, fy) * u;
        const bottom = dot(cx, cy + 1, fx, fy - 1) * (1 - u) + dot(cx + 1, cy + 1, fx - 1, fy - 1) * u;
        // Unit gradients reach about ±0.7; stretch to about ±1, like mx_noise_float.
        const n = Math.max(-1, Math.min(1, (top * (1 - v) + bottom * v) * 1.4));
        out[(y * size + x) * 4 + ch] = Math.round((n * 0.5 + 0.5) * 255);
      }
    }
  }
  return out;
}

let shared: THREE.DataTexture | null = null;

/** The noise texture, made once: repeating, smoothly filtered, with mipmaps so far ground does not shimmer. */
export function noiseTexture(): THREE.DataTexture {
  if (shared) return shared;
  const t = new THREE.DataTexture(noiseData(), NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  shared = t;
  return t;
}
