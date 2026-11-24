// Ground shading from the region masks: land cover, roads, wetness and canopy decide the
// colour, the slope adds bare rock, and noise breaks up flat areas. Snow lies above a line
// that follows the season, longest on north-facing slopes. Lakes, pools and streams are
// drawn as water: the sky mirrored at low angles, ripples running with the wind, sparkles
// of sun, light shallows and darker depths, foam at the shore and white water on steep streams.

import * as THREE from 'three/webgpu';
import {
  Fn, If, cameraPosition, clamp, dot, float, floor, fract, int, ivec2, max, mix, mx_noise_float, normalWorld, positionWorld,
  pow, reflect, select, smoothstep, texture, time, uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { cloudShadow } from '../sky/clouds';
import type { GroundClasses, RegionIndex } from '@spar/shared';
import groundDefs from '../../../defs/ground.json';

const ICE = (groundDefs as unknown as GroundClasses).ice;
/** Holes broken through the ice that are drawn at once. */
export const ICE_HOLES = 8;

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
/**
 * Vegetated ground in autumn colours (bilberry and dwarf birch turning red on the heaths,
 * sedges going orange in the bogs) and withered from late autumn until spring greens it.
 * Classes left out keep their summer colour. sRGB.
 */
const AUTUMN_BIOME_COLORS: Record<string, number> = {
  unknown: 0x6a6436,
  forest: 0x4a4228,
  wetland: 0x8f6c38,
  heath: 0x8c5434,
  grassland: 0x8c8a48,
  farmland: 0x9a9254,
  scrub: 0x7c5c32,
  built_up: 0x7a7a4a,
  regrowth: 0x7e6236,
};
const DORMANT_BIOME_COLORS: Record<string, number> = {
  unknown: 0x5e5642,
  forest: 0x403c2c,
  wetland: 0x857552,
  heath: 0x6a5c46,
  grassland: 0x8a7f58,
  farmland: 0x8f8560,
  scrub: 0x5a5140,
  built_up: 0x76705a,
  regrowth: 0x6a5e44,
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
/** Surfaces on the road layer that are water. */
const SURFACE_WATER: Record<string, number> = { stream: 1, pool: 1 };
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

/**
 * Where the snow lies down to through the year in these fells, metres, January first: down to
 * the forest in winter, only the highest north-facing hollows in late summer.
 */
const SNOW_LINE = [650, 650, 680, 800, 950, 1080, 1170, 1190, 1160, 950, 760, 650];
export const snowLine = (month: number): number => SNOW_LINE[((month % 12) + 12) % 12]!;

type Classes = RegionIndex['masks']['biomes'];

/**
 * The finished ground, or for the parts benchmark (?bench=parts) the same without the noise
 * that breaks up its colour and borders, or a flat colour, lit (what the shading costs).
 */
export type GroundLook = 'full' | 'noNoise' | 'flat';

/**
 * How far above the snow line's height the noise, and facing north, can bring snow down:
 * below the line by more than this, with no winter snow, the snow is not worked out at all.
 */
const SNOW_REACH = 70 + 18 + 3 + 110 + 10;

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

/** How much brighter the moon glints off water than its light alone would make it. */
const MOON_GLINT = 4;

/** Builds the ground materials of one region; they share the view switch. */
export class GroundShading {
  /** Index into GROUND_VIEWS. */
  readonly view = uniform(0);
  /** How rain-soaked the ground is, 0 dry to 1: wet ground is darker and shinier. */
  readonly wet = uniform(0);
  /** Colour of the sky near the horizon, which water mirrors; and of the sunlight. Linear RGB. */
  readonly sky = uniform(new THREE.Vector3(0.34, 0.48, 0.58));
  readonly sunColor = uniform(new THREE.Vector3(1, 1, 1));
  /**
   * Towards the light that glints off the water: the sun, or the moon at night (then
   * `moonlit` is 1, and the clouds' shadows, cast for the sun, are left out).
   */
  readonly lightFrom = uniform(new THREE.Vector3(0, 1, 0));
  readonly moonlit = uniform(0);
  /** Wind 0..1 and the way it blows (x east, y south), for the ripples. */
  readonly wind = uniform(0.3);
  readonly windDirection = uniform(new THREE.Vector2(1, 0));
  /** Height above which snow lies on open, north-facing ground, metres. */
  readonly snowLine = uniform(5000);
  /**
   * Winter snow: its depth in metres at `snowReference` metres above sea level, deepening by
   * `snowGain` of that for every hundred metres higher (see snowDepthAt).
   */
  readonly snowDepth = uniform(0);
  readonly snowReference = uniform(600);
  readonly snowGain = uniform(0.12);
  /** Thickness of lake ice away from streams, metres; 0 while the lakes are open. */
  readonly ice = uniform(0);
  /** Holes broken through the ice: x, z, radius (0 for none). */
  readonly iceHoles = Array.from({ length: ICE_HOLES }, () => new THREE.Vector4());
  private readonly holeNodes = uniformArray<'vec4'>(this.iceHoles, 'vec4');
  /** Shares of the summer, autumn and withered ground colours, adding up to 1 (see seasonAt). */
  readonly season = uniform(new THREE.Vector3(1, 0, 0));

  private readonly biomeColors;
  private readonly autumnColors;
  private readonly dormantColors;
  private readonly surfaceColors;
  private readonly biomeKey;
  private readonly surfaceKey;
  private readonly surfaceRoughness;
  private readonly surfaceWater;
  private readonly waterId: number;
  private readonly streamId: number;
  private readonly forestId: number;
  private readonly canopyScale: number;

  constructor(index: RegionIndex) {
    const { biomes, surfaces, channels } = index.masks;
    this.biomeColors = uniformArray<'vec3'>(colors(biomes, BIOME_COLORS), 'vec3');
    this.autumnColors = uniformArray<'vec3'>(colors(biomes, { ...BIOME_COLORS, ...AUTUMN_BIOME_COLORS }), 'vec3');
    this.dormantColors = uniformArray<'vec3'>(colors(biomes, { ...BIOME_COLORS, ...DORMANT_BIOME_COLORS }), 'vec3');
    this.surfaceColors = uniformArray<'vec3'>(colors(surfaces, SURFACE_COLORS), 'vec3');
    this.biomeKey = uniformArray<'vec3'>(colors(biomes, BIOME_KEY), 'vec3');
    this.surfaceKey = uniformArray<'vec3'>(colors(surfaces, SURFACE_KEY), 'vec3');
    this.surfaceRoughness = uniformArray<'float'>(byId(surfaces, SURFACE_ROUGHNESS, -1), 'float');
    this.surfaceWater = uniformArray<'float'>(byId(surfaces, SURFACE_WATER, 0), 'float');
    this.waterId = biomes.find((b) => b.name === 'water')?.id ?? -1;
    this.streamId = surfaces.find((c) => c.name === 'stream')?.id ?? -1;
    this.forestId = biomes.find((b) => b.name === 'forest')?.id ?? -1;
    this.canopyScale = channels.find((c) => c.name === 'canopy')?.scale ?? 0.25;
  }

  /**
   * A material reading a square RGBA mask texture `size` texels wide through the mesh's
   * uv (R biome id, G surface id and road coverage, B wetness, A canopy height; see
   * buildNodeMask). With `mask` null, every
   * mesh supplies its own texture as `userData.mask`, and the metres one texel spans as
   * `userData.texel` (otherwise `texel`).
   */
  material(size: number, mask: THREE.Texture | null, texel = 2, look: GroundLook = 'full'): THREE.MeshStandardNodeMaterial {
    const placeholder = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const maskNode = texture(mask ?? placeholder);
    // Runs before each mesh is drawn and points the shader at that mesh's texture.
    const perMesh = uniform(0).onObjectUpdate(({ object }) => {
      const own = (object?.userData as { mask?: THREE.Texture } | undefined)?.mask;
      if (mask === null && own) maskNode.value = own;
      return 0;
    });
    const texelMetres = uniform(texel).onObjectUpdate(({ object }) => (object?.userData as { texel?: number } | undefined)?.texel ?? texel);

    if (look === 'flat') {
      const flat = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 1 });
      flat.colorNode = vec3(0.09, 0.11, 0.06);
      return flat;
    }

    const ground = positionWorld.xz;
    // The noise that breaks up colour and borders; none for the benchmark's 'noNoise'.
    const noise = (p: THREE.Node<'vec2'>): THREE.Node<'float'> => (look === 'noNoise' ? float(0) : mx_noise_float(p));
    const rock = float(1).sub(smoothstep(0.62, 0.8, normalWorld.y)); // bare rock from about 37° to 52°
    const tint = float(1)
      .add(noise(ground.mul(0.9)).mul(0.1))
      .add(noise(ground.mul(0.11)).mul(0.08))
      .add(noise(ground.mul(0.013)).mul(0.06));

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

      const color = this.biomeColors.element(biome).mul(this.season.x)
        .add(this.autumnColors.element(biome).mul(this.season.y))
        .add(this.dormantColors.element(biome).mul(this.season.z))
        .toVar();
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
    const wobble = vec2(noise(ground.mul(0.21)), noise(ground.mul(0.21).add(41.7))).mul(0.45);
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
    const bare = vec4(mix(natural.xyz, roadColor, onRoad), mix(natural.w, roadRough, onRoad));

    const snowColorNode = () => vec3(0.86, 0.9, 0.95).mul(float(0.96).add(mx_noise_float(ground.mul(0.7)).mul(0.04)));
    // Snow: above the line, more so facing north and in the hollows the noise picks out; none on
    // cliffs. Its noise is a large share of the ground's work, so it is left out (an early
    // branch, the same picture) wherever no snow can lie: well below the line without winter snow.
    const land = Fn(() => {
      const out = vec4(bare).toVar();
      If(this.snowDepth.greaterThan(0).or(positionWorld.y.add(SNOW_REACH).greaterThan(this.snowLine)), () => {
        const north = normalWorld.z.negate();
        const drift = mx_noise_float(ground.mul(0.004)).mul(70).add(mx_noise_float(ground.mul(0.03)).mul(18)).add(mx_noise_float(ground.mul(0.4)).mul(3));
        const flatEnough = smoothstep(0.5, 0.72, normalWorld.y);
        const lingering = smoothstep(this.snowLine, this.snowLine.add(20), positionWorld.y.add(drift).add(north.mul(110)));
        // Winter snow over everything, deeper higher up. While it is thin (first falls, the melt)
        // it lies in patches: in hollows and on north-facing ground first, last to go.
        const depth = this.snowDepth.mul(max(0.2, positionWorld.y.sub(this.snowReference).mul(this.snowGain.div(100)).add(1)));
        const patches = mx_noise_float(ground.mul(0.03)).mul(0.05).add(mx_noise_float(ground.mul(0.25)).mul(0.025)).add(north.mul(0.03));
        const winter = smoothstep(0.03, 0.12, depth.add(patches)).mul(mix(1, 0.85, onRoad));
        const snowy = max(lingering, winter).mul(flatEnough);
        // Roads are ploughed and driven: packed snow with the gravel showing through, so they can still be followed.
        const roadSnow = mix(snowColorNode(), roadColor, onRoad.mul(winter).mul(0.3));
        out.assign(vec4(mix(bare.xyz, roadSnow, snowy), mix(bare.w, 0.6, snowy)));
      });
      return out;
    })();

    // How much of this spot is water: the land-cover texels, and streams and pools on the road layer.
    const isWater = (t: THREE.Node<'vec4'>) => select(int(t.x.mul(255).add(0.5)).equal(int(this.waterId)), float(1), float(0));
    const waterSurface = (t: THREE.Node<'vec4'>) => float(this.surfaceWater.element(int(t.y.mul(255).add(0.5).floor().div(32).floor())));
    const lakeShare = mix(mix(isWater(g.t00), isWater(g.t10), gBlend.x), mix(isWater(g.t01), isWater(g.t11), gBlend.x), gBlend.y);
    const streamShare = onRoad.mul(max(waterSurface(r.t00), waterSurface(r.t11)));
    const water = max(lakeShare, streamShare);
    const shoreline = smoothstep(0.3, 0.6, water);

    /**
     * Inside a Fn: the water's colour (rgb, lit) and how much of the spot it covers (a), and
     * what it mirrors and sparkles (glow, unlit). Worked out only where there is water.
     */
    const waterLook = () => {
      const waterColor = vec4(0).toVar();
      const waterGlow = vec3(0).toVar();
      If(water.greaterThan(0.01), () => {
        // Depth, roughly: how much of the ground a few texels around is water too.
        const reach = 4;
        const far = (dx: number, dy: number) => isWater(maskNode.load(ivec2(clamp(floor(at).add(vec2(dx, dy)), 0, size - 1))));
        const deep = far(reach, 0).add(far(-reach, 0)).add(far(0, reach)).add(far(0, -reach)).mul(0.25).mul(lakeShare);
        // Ripples: two layers of noise drifting with the wind, steeper in a stronger wind or rain.
        const drift = this.windDirection.mul(time.mul(this.wind.mul(1.6).add(0.25)));
        const height = (p: THREE.Node<'vec2'>) =>
          mx_noise_float(p.mul(0.35).sub(drift.mul(0.35))).add(mx_noise_float(p.mul(1.1).sub(drift.mul(0.9)).add(vec2(time.mul(0.11), 0))).mul(0.45));
        const e = 0.6;
        const h0 = height(ground);
        // Far off, ripples smaller than a pixel would only shimmer: calm them down with distance.
        const distance = cameraPosition.sub(positionWorld).length();
        const near = float(1).sub(smoothstep(60, 500, distance));
        const steep = this.wind.mul(1.4).add(0.35).add(this.wet.mul(0.5)).mul(near.mul(0.8).add(0.2));
        const n = vec3(h0.sub(height(ground.add(vec2(e, 0)))).mul(steep), 1, h0.sub(height(ground.add(vec2(0, e)))).mul(steep)).normalize();
        const view = cameraPosition.sub(positionWorld).normalize();
        const facing = max(dot(n, view), 0);
        // The sky mirrored, strongly at a glancing angle, and a cartoon edge to it.
        const fresnel = float(0.05).add(pow(float(1).sub(facing), 4).mul(0.7)).clamp(0, 1);
        const sun = this.lightFrom;
        const glance = max(dot(reflect(view.negate(), n), sun), 0);
        // Crisp sparkles where the sun's reflection catches a ripple, and a soft sheen around them.
        const sparkle = smoothstep(0.9965, 0.9985, glance).mul(3).mul(near).add(pow(glance, 80).mul(0.35));
        // By night the moon's path across the water: brighter than its light alone, as eyes adjust.
        const shadowed = mix(cloudShadow.light, float(MOON_GLINT), this.moonlit);
        const sunLight = this.sunColor.mul(shadowed).mul(select(sun.y.greaterThan(0), 1, 0));
        // Shallows show the bed through tinted water; depths are dark blue-green.
        const shallow = vec3(0.16, 0.17, 0.1);
        const depth = vec3(0.02, 0.06, 0.075);
        const body = mix(shallow, depth, smoothstep(0.2, 1, deep.add(streamShare.mul(0.5))));
        // Foam lapping at the shore, and white water where a stream runs steeply.
        const lap = mx_noise_float(ground.mul(0.9).add(vec2(time.mul(0.35), time.mul(-0.2))));
        const edge = smoothstep(0.3, 0.55, water).mul(float(1).sub(smoothstep(0.65, 0.95, water)));
        const rapids = streamShare.mul(smoothstep(0.04, 0.14, float(1).sub(normalWorld.y)));
        const foam = max(edge.mul(smoothstep(0.05, 0.25, lap.add(edge.mul(0.3)))), rapids.mul(smoothstep(-0.2, 0.2, lap))).clamp(0, 1);
        // Ice: thinner near streams, which keep the water moving, and on the streams themselves;
        // none where a vehicle broke through. Thick ice carries the snow; thin ice shows dark.
        const iceThick = float(0).toVar();
        If(this.ice.greaterThan(0), () => {
          const isStream = (t: THREE.Node<'vec4'>) => {
            const packed = t.y.mul(255).add(0.5).floor();
            const surface = packed.div(32).floor();
            return select(int(surface).equal(int(this.streamId)).and(packed.sub(surface.mul(32)).greaterThan(13)), float(1), float(0));
          };
          const look = (dx: number, dy: number, metres: number) =>
            isStream(maskNode.load(ivec2(clamp(floor(at.add(vec2(dx, dy).mul(metres).div(texelMetres))), 0, size - 1))));
          let distance: THREE.Node<'float'> = float(2 * ICE.reach);
          for (const metres of [44, 30, 16, 6]) {
            let found: THREE.Node<'float'> = float(0);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const) found = max(found, look(dx, dy, metres));
            distance = select(found.greaterThan(0), float(metres), distance);
          }
          const share = select(streamShare.greaterThan(0.5), float(ICE.stream), float(ICE.mouth).add(smoothstep(0, 2 * ICE.reach, distance).mul(1 - ICE.mouth)));
          let open: THREE.Node<'float'> = float(0);
          for (let h = 0; h < ICE_HOLES; h++) {
            const hole = this.holeNodes.element(h);
            const off = positionWorld.xz.sub(vec2(hole.x, hole.y)).length();
            open = max(open, select(hole.z.greaterThan(0), float(1).sub(smoothstep(hole.z.sub(0.6), hole.z, off)), float(0)));
          }
          iceThick.assign(this.ice.mul(share).mul(float(1).sub(open)));
        });
        const frozen = smoothstep(0.02, 0.05, iceThick);
        // Bare ice is smooth, not rippled, and mottled with frozen-in bubbles and cracks.
        const mottle = float(0.88).add(mx_noise_float(ground.mul(0.15)).mul(0.12)).add(smoothstep(0.42, 0.5, mx_noise_float(ground.mul(0.6))).mul(0.15));
        const clearIce = mix(vec3(0.06, 0.09, 0.11), vec3(0.3, 0.36, 0.4), smoothstep(0.05, 0.3, iceThick)).mul(mottle);
        const iceFresnel = float(0.05).add(pow(float(1).sub(max(view.y, 0)), 4).mul(0.7)).clamp(0, 1);
        const snowOnIce = smoothstep(0.03, 0.12, this.snowDepth).mul(smoothstep(0.12, 0.22, iceThick));
        const iceColor = mix(clearIce, snowColorNode(), snowOnIce);
        const open = float(1).sub(frozen);
        waterColor.assign(vec4(mix(mix(body.mul(float(1).sub(fresnel)), vec3(0.82, 0.86, 0.86), foam), iceColor, frozen), shoreline));
        waterGlow.assign(
          this.sky.mul(fresnel).mul(0.85).add(sunLight.mul(sparkle)).mul(float(1).sub(foam)).mul(open)
            .add(this.sky.mul(iceFresnel).mul(0.45).mul(frozen).mul(float(1).sub(snowOnIce)))
            .mul(shoreline),
        );
      });
      return { color: waterColor, glow: waterGlow };
    };
    const shaded = Fn(() => {
      const w = waterLook().color;
      return vec4(mix(land.xyz, w.xyz, w.w), mix(land.w, 1, w.w));
    })();
    const waterGlow = Fn(() => waterLook().glow)();

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
    material.emissiveNode = select(plain, waterGlow, vec3(0));
    return material;
  }
}
