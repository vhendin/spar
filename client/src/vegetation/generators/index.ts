import { seasonMix, type SeasonState, type Species } from '@spar/shared';
import { boulder } from './boulder';
import { broadleaf } from './broadleaf';
import { conifer } from './conifer';
import { grass } from './grass';
import { hexColor, mixRgb, type Detail, type Generator, type GeneratorColors, type MeshData, type Params } from './mesh';
import { shrub } from './shrub';
import { stump } from './stump';

/** To add a kind of plant shape: write a generator and list it here and in the species schema. */
export const GENERATORS: Record<Species['generator'], Generator> = { conifer, broadleaf, shrub, grass, boulder, stump };

/** High summer, for when no season is given. */
export const SUMMER: SeasonState = { foliage: { spring: 0, summer: 1, autumn: 0, winter: 0 }, leaves: 1, ground: { summer: 1, autumn: 0, dormant: 0 }, snow: 0, ice: 0 };

/**
 * Builds one individual of a species, in the colours of `season`. Variant numbers give
 * different individuals; the season changes only colours and how full a leafy crown is,
 * never the number of vertices.
 */
export function generate(species: Species, variant: number, detail: Detail, season: SeasonState = SUMMER, picture = false): MeshData {
  const s = species.seasons;
  const foliage = seasonMix(season, { spring: hexColor(s.spring), summer: hexColor(s.summer), autumn: hexColor(s.autumn), winter: hexColor(s.winter) });
  // On ground plants the accent is flowers and seed heads: gone by winter, fading in autumn.
  // On trees it is bark marks, which stay.
  const faded = species.generator === 'grass' || species.generator === 'shrub' ? season.foliage.winter + 0.5 * season.foliage.autumn : 0;
  const bark = species.colors.bark ? hexColor(species.colors.bark) : foliage;
  const colors: GeneratorColors = {
    foliage,
    bark,
    barkTop: species.colors.barkTop ? hexColor(species.colors.barkTop) : bark,
    accent: species.colors.accent ? mixRgb(hexColor(species.colors.accent), foliage, faded) : foliage,
    twig: hexColor(s.winter),
    leaves: species.deciduous ? season.leaves : 1,
  };
  // The seed depends only on the species name and variant, so every client grows the same trees.
  let seed = 2166136261;
  for (let i = 0; i < species.name.length; i++) seed = Math.imul(seed ^ species.name.charCodeAt(i), 16777619);
  const data = GENERATORS[species.generator](species.params as Params, colors, (seed ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0, detail, picture);
  const hold = SNOW_HOLD[species.generator] * Math.min(1, season.snow / SNOW_FULL);
  if (hold > 0) dustWithSnow(data, hold);
  return data;
}

/** How much snow each kind of shape carries on its upper sides in deep winter. */
const SNOW_HOLD: Record<Species['generator'], number> = { conifer: 0.85, broadleaf: 0.35, shrub: 0.6, grass: 0.5, boulder: 0.95, stump: 0.95 };
/** Lying snow (metres) from which plants carry all the snow they can. */
const SNOW_FULL = 0.2;
const SNOW: [number, number, number] = [0.72, 0.78, 0.86];

/** Whitens the upward-facing parts of a mesh: snow on branches, needles and stones. */
function dustWithSnow(data: MeshData, hold: number): void {
  for (let v = 0; v < data.colors.length; v += 3) {
    const up = data.normals[v + 1]!;
    const t = Math.min(1, Math.max(0, (up - 0.15) / 0.6));
    const w = hold * t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) data.colors[v + c] = data.colors[v + c]! + (SNOW[c]! - data.colors[v + c]!) * w;
  }
}

export type { Detail, MeshData };
