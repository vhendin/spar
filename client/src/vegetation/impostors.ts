// Flat pictures of trees for the far distance: every tree variant is drawn once, from the
// side, into one texture when the game starts.

import * as THREE from 'three/webgpu';
import { normalViewGeometry } from 'three/tsl';
import { IMPOSTOR_CELL, IMPOSTOR_PAD } from './materials';

const CELL_PIXELS = 160;
const VIEW_FROM_ABOVE = THREE.MathUtils.degToRad(22);
const MARKER_PIXELS = 6;

export interface ImpostorAtlas {
  /** Each tree's own colours, unlit; alpha is its outline. */
  texture: THREE.Texture;
  /** Which way each pixel of a picture faces, as seen from the front: x right, y up, z out. */
  normals: THREE.Texture;
  columns: number;
  rows: number;
}

/**
 * Draws each geometry (unit height, standing on y = 0) into its own cell of one texture;
 * cell n is column n % columns, row floor(n / columns), with row 0 at v = 0. The pictures
 * are drawn twice, unlit: once for the colours and once for which way each part faces, so
 * the game can light them with the same sun and sky as the trees close by.
 *
 * The drawing is read back and re-uploaded as an ordinary texture. That costs a moment at
 * start-up but behaves the same on WebGPU and WebGL, which disagree about which way up a
 * drawn-to texture is and whether it gets mipmaps.
 */
export async function bakeImpostors(renderer: THREE.WebGPURenderer, trees: THREE.BufferGeometry[], columns: number): Promise<ImpostorAtlas> {
  const rows = Math.max(1, Math.ceil(trees.length / columns));
  const scene = new THREE.Scene();
  const colours = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // The surface's own facing, not turned towards the camera on its back: the near trees are
  // lit that way too (see VegetationShading.meshMaterial).
  const facing = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  facing.colorNode = normalViewGeometry.mul(0.5).add(0.5);
  const meshes = trees.map((geometry, n) => {
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, colours);
    mesh.position.set(((n % columns) + 0.5) * IMPOSTOR_CELL, Math.floor(n / columns) * IMPOSTOR_CELL + IMPOSTOR_PAD, 0);
    // Lean the top towards the camera: the picture then shows the tree as seen from a
    // little above, with the upper sides of its branches, which is how distant forest
    // is mostly seen. Edge-on branches would all but vanish in a small picture.
    mesh.rotation.x = VIEW_FROM_ABOVE;
    scene.add(mesh);
    return mesh;
  });
  // A dot in the bottom-left corner of the sheet tells us afterwards which way up it came out.
  const dot = (MARKER_PIXELS / CELL_PIXELS) * IMPOSTOR_CELL;
  const marker = new THREE.Mesh(new THREE.PlaneGeometry(dot, dot).translate(dot / 2, dot / 2, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(marker);

  const camera = new THREE.OrthographicCamera(0, columns * IMPOSTOR_CELL, rows * IMPOSTOR_CELL, 0, 0.1, 20);
  camera.position.set(0, 0, 10);

  const width = columns * CELL_PIXELS;
  const height = rows * CELL_PIXELS;
  const oldColor = renderer.getClearColor(new THREE.Color());
  const oldAlpha = renderer.getClearAlpha();
  const draw = async (material: THREE.Material, clear: number): Promise<Uint8Array> => {
    for (const mesh of meshes) mesh.material = material;
    const target = new THREE.RenderTarget(width, height, { samples: 4, depthBuffer: true });
    // Transparent, but in a colour near the trees', so the soft edges do not turn dark.
    renderer.setClearColor(new THREE.Color(clear), 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const read = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    target.dispose();
    return new Uint8Array(read.buffer, read.byteOffset, width * height * 4).slice();
  };
  const pixels = await draw(colours, 0x3a3d2c);
  // Facing straight out of the picture, for the soft edges.
  const normals = await draw(facing, 0x8080ff);
  renderer.setClearColor(oldColor, oldAlpha);
  colours.dispose();
  facing.dispose();
  marker.geometry.dispose();

  // Put the row holding the marker first, then rub the marker out.
  const alphaAt = (x: number, y: number): number => pixels[(y * width + x) * 4 + 3]!;
  const mid = MARKER_PIXELS >> 1;
  if (alphaAt(mid, mid) < 128 && alphaAt(mid, height - 1 - mid) >= 128) {
    const row = new Uint8Array(width * 4);
    for (const sheet of [pixels, normals]) {
      for (let y = 0; y < height >> 1; y++) {
        const a = y * width * 4;
        const b = (height - 1 - y) * width * 4;
        row.set(sheet.subarray(a, a + width * 4));
        sheet.copyWithin(a, b, b + width * 4);
        sheet.set(row, b);
      }
    }
  }
  for (let y = 0; y < MARKER_PIXELS + 2; y++) for (let x = 0; x < MARKER_PIXELS + 2; x++) pixels[(y * width + x) * 4 + 3] = 0;

  const sheet = (data: Uint8Array): THREE.DataTexture => {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };
  return { texture: sheet(pixels), normals: sheet(normals), columns, rows };
}
