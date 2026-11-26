// Shaders are built the first time something is drawn, and that frame waits for them: a tenth
// of a second or more each, seconds for a handful when the graphics driver has not built them
// before (after an update, say). Things first seen while driving (a plant met further on, the
// first mud thrown) would each stall the game then. Instead, stand-ins for them that draw
// nothing are put in the scene for the first few frames, so it is all built while loading.

import * as THREE from 'three/webgpu';

/** Frames the stand-ins are kept for; the shadows' shaders are built in the same frames. */
const FRAMES = 3;

export class WarmUp {
  readonly group = new THREE.Group();
  private frames = 0;

  constructor() {
    this.group.name = 'warm-up';
  }

  /** Stand-ins to draw for the first frames. Their geometry and materials stay their owners'. */
  add(objects: THREE.Object3D[]): void {
    for (const o of objects) {
      o.traverse((m) => (m.frustumCulled = false));
      this.group.add(o);
    }
  }

  /** Call after each frame drawn: the stand-ins go after the first few. */
  drawn(): void {
    if (this.group.parent && ++this.frames >= FRAMES) this.group.removeFromParent();
  }
}

/** A stand-in for each mesh under `root`: the same geometry and material, cast the same. */
export function standIns(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const copy = new THREE.Mesh(o.geometry, o.material);
    copy.castShadow = o.castShadow;
    copy.receiveShadow = o.receiveShadow;
    out.push(copy);
  });
  return out;
}
