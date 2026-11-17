// Ground shading from the region masks: land cover, roads, wetness and canopy decide the
// colour, the slope adds bare rock, and noise breaks up flat areas.

import * as THREE from 'three/webgpu';
import {
  Fn, clamp, float, floor, fract, int, ivec2, mix, mx_noise_float, normalWorld, positionWorld,
  select, smoothstep, texture, uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import type { RegionIndex } from '@spar/shared';

/** Views switched with the M key: the finished ground, then each raw mask. */
export const GROUND_VIEWS = ['shaded', 'biome mask', 'surface mask', 'wetness mask', 'canopy mask', 'slope'] as const;

// Colours by class name, so they survive a renumbering of ids. sRGB.
const BIOME_COLORS: Record<string, number> = {
  unknown: 0x556b3a,
  forest: 0x3a4d2c,
  wetland: 0x77703e,
  bare_rock: 0x7a7a76,
  scree: 0x8a8780,
  heath: 0x7b774f,
  grassland: 0x76904a,
  farmland: 0x9c9c58,
  water: 0x2b4759,
  scrub: 0x55693c,
  built_up: 0x6f7d48,
  sand: 0xbfb189,
  // Fresh clear-cut: churned soil, dead brash and pale stumps; regrowth: young grass and shrubs.
  clearcut: 0x6e5d43,
  regrowth: 0x66723f,
};
const SURFACE_COLORS: Record<string, number> = {
  none: 0x000000,
  asphalt: 0x38383a,
  gravel: 0x978e7b,
  dirt: 0x6a563d,
  trail: 0x7c6b4d,
  boardwalk: 0x93846b,
  stream: 0x2b4759,
  pool: 0x4a6170,
};
// Water in roads' place shines; everything else on that layer is matt.
const SURFACE_ROUGHNESS: Record<string, number> = { stream: 0.25, pool: 0.15 };
// Loud colours for the raw mask views.
const BIOME_KEY: Record<string, number> = {
  unknown: 0xff00ff, forest: 0x1e6b1e, wetland: 0x8a5a2b, bare_rock: 0x808080, scree: 0xb0b0b0, heath: 0xb59a3c,
  grassland: 0x8fd14f, farmland: 0xe6d96a, water: 0x2f6fe0, scrub: 0x4fa37a, built_up: 0xd66a6a, sand: 0xf0e0a0,
  clearcut: 0xff8c1a, regrowth: 0xb8ff3c,
};
const SURFACE_KEY: Record<string, number> = {
  none: 0x202020, asphalt: 0xffffff, gravel: 0xffc34d, dirt: 0xc46a2b, trail: 0xff5fa2, boardwalk: 0x5fd0ff,
  stream: 0x2f6fe0, pool: 0x1ad1c4,
};

type Classes = RegionIndex['masks']['biomes'];

function byId<T>(classes: Classes, table: Record<string, T>, fallback: T): T[] {
  const out: T[] = [];
  for (const c of classes) out[c.id] = table[c.name] ?? fallback;
  for (let i = 0; i < out.length; i++) out[i] ??= fallback;
  return out;
}

/** Class colours by id, as linear RGB vectors for the shader. */
const colors = (classes: Classes, table: Record<string, number>): THREE.Vector3[] =>
  byId(classes, table, 0xff00ff).map((hex) => {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r, c.g, c.b);
  });

/** Builds the ground materials of one region; they share the view switch. */
export class GroundShading {
  /** Index into GROUND_VIEWS. */
  readonly view = uniform(0);
  /** How rain-soaked the ground is, 0 dry to 1: wet ground is darker and shinier. */
  readonly wet = uniform(0);

  private readonly biomeColors;
  private readonly surfaceColors;
  private readonly biomeKey;
  private readonly surfaceKey;
  private readonly surfaceRoughness;
  private readonly waterId: number;
  private readonly forestId: number;
  private readonly canopyScale: number;

  constructor(index: RegionIndex) {
    const { biomes, surfaces, channels } = index.masks;
    this.biomeColors = uniformArray<'vec3'>(colors(biomes, BIOME_COLORS), 'vec3');
    this.surfaceColors = uniformArray<'vec3'>(colors(surfaces, SURFACE_COLORS), 'vec3');
    this.biomeKey = uniformArray<'vec3'>(colors(biomes, BIOME_KEY), 'vec3');
    this.surfaceKey = uniformArray<'vec3'>(colors(surfaces, SURFACE_KEY), 'vec3');
    this.surfaceRoughness = uniformArray<'float'>(byId(surfaces, SURFACE_ROUGHNESS, -1), 'float');
    this.waterId = biomes.find((b) => b.name === 'water')?.id ?? -1;
    this.forestId = biomes.find((b) => b.name === 'forest')?.id ?? -1;
    this.canopyScale = channels.find((c) => c.name === 'canopy')?.scale ?? 0.25;
  }

  /**
   * A material reading a square RGBA mask texture `size` texels wide through the mesh's
   * uv (R biome id, G surface id and road coverage, B wetness, A canopy height; see
   * buildNodeMask). With `mask` null, every
   * mesh supplies its own texture as `userData.mask`.
   */
  material(size: number, mask: THREE.Texture | null): THREE.MeshStandardNodeMaterial {
    const placeholder = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const maskNode = texture(mask ?? placeholder);
    // Runs before each mesh is drawn and points the shader at that mesh's texture.
    const perMesh = uniform(0).onObjectUpdate(({ object }) => {
      const own = (object?.userData as { mask?: THREE.Texture } | undefined)?.mask;
      if (mask === null && own) maskNode.value = own;
      return 0;
    });

    const ground = positionWorld.xz;
    const rock = float(1).sub(smoothstep(0.62, 0.8, normalWorld.y)); // bare rock from about 37° to 52°
    const tint = float(1)
      .add(mx_noise_float(ground.mul(0.9)).mul(0.1))
      .add(mx_noise_float(ground.mul(0.11)).mul(0.08))
      .add(mx_noise_float(ground.mul(0.013)).mul(0.06));

    const linear = (hex: number) => {
      const c = new THREE.Color(hex);
      return vec3(c.r, c.g, c.b);
    };
    const rockColor = linear(0x73736f);
    const deepForest = linear(0x26361f);

    /** Colour (rgb) and roughness (a) of the natural ground described by one mask texel. */
    const groundTexel = Fn(([texel]: [THREE.Node<'vec4'>]) => {
      const biome = int(texel.x.mul(255).add(0.5));
      const wet = texel.z;
      const canopy = texel.w.mul(255 * this.canopyScale);
      const isWater = biome.equal(int(this.waterId));

      const color = this.biomeColors.element(biome).toVar();
      // Tall forest shades its floor; wet ground is darker; steep ground is bare.
      color.assign(mix(color, deepForest, select(biome.equal(int(this.forestId)), clamp(canopy.div(22), 0, 1).mul(0.3), 0)));
      color.mulAssign(select(isWater, 1, float(1).sub(wet.mul(0.4))));
      color.assign(mix(color, rockColor, select(isWater, 0, rock)));
      color.mulAssign(select(isWater, 1, tint.mul(float(1).sub(this.wet.mul(0.28)))));
      return vec4(color, select(isWater, 0.3, float(1).sub(this.wet.mul(0.3))));
    });

    /** Road colour times coverage (rgb) and coverage (a) of one mask texel. */
    const roadTexel = Fn(([texel]: [THREE.Node<'vec4'>]) => {
      const packed = texel.y.mul(255).add(0.5).floor();
      const surface = packed.div(32).floor();
      const coverage = packed.sub(surface.mul(32)).div(31);
      return vec4(this.surfaceColors.element(int(surface)).mul(coverage), coverage);
    });
    /** Fixed roughness of the surface in one mask texel, or -1 when it follows the weather. */
    const roadRoughness = Fn(([texel]: [THREE.Node<'vec4'>]): THREE.Node<'float'> => {
      const surface = texel.y.mul(255).add(0.5).floor().div(32).floor();
      return float(this.surfaceRoughness.element(int(surface)));
    });

    // Blend the four texels around the fragment ourselves: ids cannot be interpolated,
    // but the colours they stand for can. Land cover borders get a noise wobble so they
    // do not look gridded.
    const texels = (at: THREE.Node<'vec2'>) => {
      const cell = floor(at);
      const pick = (dx: number, dy: number) => maskNode.load(ivec2(clamp(cell.add(vec2(dx, dy)), 0, size - 1)));
      return { t00: pick(0, 0), t10: pick(1, 0), t01: pick(0, 1), t11: pick(1, 1), f: fract(at) };
    };
    const at = uv().mul(size - 1);
    const wobble = vec2(mx_noise_float(ground.mul(0.21)), mx_noise_float(ground.mul(0.21).add(41.7))).mul(0.45);
    const g = texels(at.add(wobble));
    const gBlend = smoothstep(0.2, 0.8, g.f);
    const natural = mix(
      mix(groundTexel(g.t00), groundTexel(g.t10), gBlend.x),
      mix(groundTexel(g.t01), groundTexel(g.t11), gBlend.x),
      gBlend.y,
    );

    // Roads, paths and streams: interpolate coverage smoothly and cut it at one half. The
    // cut follows the real edge closely, so they are not stepped like the 2 m samples.
    const r = texels(at);
    const road = mix(
      mix(roadTexel(r.t00), roadTexel(r.t10), r.f.x),
      mix(roadTexel(r.t01), roadTexel(r.t11), r.f.x),
      r.f.y,
    );
    const onRoad = smoothstep(0.4, 0.6, road.w);
    const roadColor = road.xyz.div(road.w.max(0.001)).mul(tint.mul(0.6).add(0.4)).mul(float(1).sub(this.wet.mul(0.35)));
    // A wet road shines far more than wet moss.
    const fixedRough = roadRoughness(r.t00).max(roadRoughness(r.t11));
    const roadRough = select(fixedRough.greaterThanEqual(0), fixedRough, float(1).sub(this.wet.mul(0.6)));
    const shaded = vec4(mix(natural.xyz, roadColor, onRoad), mix(natural.w, roadRough, onRoad));

    // Raw mask views use the nearest texel, unblended.
    const t00 = r.t00;
    const packed = t00.y.mul(255).add(0.5).floor();
    const slopeDegrees = normalWorld.y.clamp(0, 1).acos().mul(180 / Math.PI);
    const view = this.view;
    const raw = select(
      view.lessThan(1.5),
      this.biomeKey.element(int(t00.x.mul(255).add(0.5))),
      select(
        view.lessThan(2.5),
        this.surfaceKey.element(int(packed.div(32).floor())),
        select(
          view.lessThan(3.5),
          vec3(t00.z),
          select(view.lessThan(4.5), vec3(t00.w.mul((255 * this.canopyScale) / 25)), vec3(slopeDegrees.div(45))),
        ),
      ),
    );
    const plain = view.lessThan(0.5);

    const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    material.colorNode = select(plain, shaded.xyz, raw).add(perMesh);
    material.roughnessNode = select(plain, shaded.w, 1);
    return material;
  }
}
