// Flat pictures of trees for the far distance: every tree variant is drawn once, from the
// side, into one texture when the game starts.

import * as THREE from 'three/webgpu';
import { IMPOSTOR_CELL, IMPOSTOR_PAD } from './materials';

const CELL_PIXELS = 160;
const VIEW_FROM_ABOVE = THREE.MathUtils.degToRad(22);
const MARKER_PIXELS = 6;

export interface ImpostorAtlas {
  texture: THREE.Texture;
  columns: number;
  rows: number;
}

/**
 * Draws each geometry (unit height, standing on y = 0) into its own cell of one texture;
 * cell n is column n % columns, row floor(n / columns), with row 0 at v = 0.
 *
 * The drawing is read back and re-uploaded as an ordinary texture. That costs a moment at
 * start-up but behaves the same on WebGPU and WebGL, which disagree about which way up a
 * drawn-to texture is and whether it gets mipmaps.
 */
export async function bakeImpostors(renderer: THREE.WebGPURenderer, trees: THREE.BufferGeometry[], columns: number): Promise<ImpostorAtlas> {
  const rows = Math.max(1, Math.ceil(trees.length / columns));
  const scene = new THREE.Scene();
  // Soft light from the sky and a little from the front, so pictures match trees seen in daylight.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 1.6));
  const front = new THREE.DirectionalLight(0xffffff, 1.4);
  front.position.set(-0.4, 0.8, 1);
  scene.add(front);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  trees.forEach((geometry, n) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(((n % columns) + 0.5) * IMPOSTOR_CELL, Math.floor(n / columns) * IMPOSTOR_CELL + IMPOSTOR_PAD, 0);
    // Lean the top towards the camera: the picture then shows the tree as seen from a
    // little above, with the upper sides of its branches, which is how distant forest
    // is mostly seen. Edge-on branches would all but vanish in a small picture.
    mesh.rotation.x = VIEW_FROM_ABOVE;
    scene.add(mesh);
  });
  // A dot in the bottom-left corner of the sheet tells us afterwards which way up it came out.
  const dot = (MARKER_PIXELS / CELL_PIXELS) * IMPOSTOR_CELL;
  const marker = new THREE.Mesh(new THREE.PlaneGeometry(dot, dot).translate(dot / 2, dot / 2, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(marker);

  const camera = new THREE.OrthographicCamera(0, columns * IMPOSTOR_CELL, rows * IMPOSTOR_CELL, 0, 0.1, 20);
  camera.position.set(0, 0, 10);

  const width = columns * CELL_PIXELS;
  const height = rows * CELL_PIXELS;
  const target = new THREE.RenderTarget(width, height, { samples: 4, depthBuffer: true });
  const oldColor = renderer.getClearColor(new THREE.Color());
  const oldAlpha = renderer.getClearAlpha();
  // Transparent, but leaf-coloured, so the soft edges of the pictures do not turn dark.
  renderer.setClearColor(new THREE.Color(0x2c3d24), 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(oldColor, oldAlpha);

  const read = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  const pixels = new Uint8Array(read.buffer, read.byteOffset, width * height * 4);
  target.dispose();
  material.dispose();
  marker.geometry.dispose();

  // Put the row holding the marker first, then rub the marker out.
  const alphaAt = (x: number, y: number): number => pixels[(y * width + x) * 4 + 3]!;
  const mid = MARKER_PIXELS >> 1;
  if (alphaAt(mid, mid) < 128 && alphaAt(mid, height - 1 - mid) >= 128) {
    const row = new Uint8Array(width * 4);
    for (let y = 0; y < height >> 1; y++) {
      const a = y * width * 4;
      const b = (height - 1 - y) * width * 4;
      row.set(pixels.subarray(a, a + width * 4));
      pixels.copyWithin(a, b, b + width * 4);
      pixels.set(row, b);
    }
  }
  for (let y = 0; y < MARKER_PIXELS + 2; y++) for (let x = 0; x < MARKER_PIXELS + 2; x++) pixels[(y * width + x) * 4 + 3] = 0;

  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, columns, rows };
}
