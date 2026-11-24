// The finishing pass over the rendered picture: a colour grade that follows the hour and
// the weather (warm low sun, blue night, grey rain), a soft vignette, and optionally a glow
// around the brightest things, the sun and the headlights.

import * as THREE from 'three/webgpu';
import { Fn, float, luminance, max, mix, pass, screenUV, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

export interface Grade {
  tint: THREE.Vector3;
  saturation: number;
  lift: number;
}

export class Look {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly scenePass;
  private readonly u = {
    tint: uniform(new THREE.Vector3(1, 1, 1)),
    saturation: uniform(1),
    lift: uniform(0),
  };
  private glowOn = false;

  /**
   * `glowScale` is the share of the picture's width the glow is worked out at. It is a soft,
   * wide blur, so a quarter looks the same as the half three.js uses by itself, for about a
   * quarter of the GPU work (the glow was a large part of each frame).
   */
  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, glow: boolean, private readonly glowScale = 0.25) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.scenePass = pass(scene, camera);
    this.glow = glow;
  }

  set glow(on: boolean) {
    this.glowOn = on;
    const u = this.u;
    const color = this.scenePass.getTextureNode('output');
    let lit: THREE.Node<"vec4"> = color;
    if (on) {
      const glow = bloom(color, 0.22, 0.45, 0.8);
      glow.setResolutionScale(this.glowScale);
      lit = color.add(glow);
    }
    this.pipeline.outputNode = Fn(() => {
      const c = vec3(lit.rgb).toVar();
      c.assign(c.mul(u.tint));
      const grey = luminance(c);
      c.assign(max(mix(vec3(grey), c, u.saturation), 0));
      // Lift the blacks a touch, so night stays readable.
      c.assign(c.add(vec3(u.lift).mul(float(1).sub(c))));
      // A gentle darkening towards the corners.
      const edge = screenUV.sub(0.5).length();
      c.assign(c.mul(float(1).sub(smoothstep(0.45, 0.85, edge).mul(0.22))));
      return vec4(c, 1);
    })();
    this.pipeline.needsUpdate = true;
  }

  get glow(): boolean {
    return this.glowOn;
  }

  render(grade: Grade): void {
    this.u.tint.value.copy(grade.tint);
    this.u.saturation.value = grade.saturation;
    this.u.lift.value = grade.lift;
    this.pipeline.render();
  }
}
