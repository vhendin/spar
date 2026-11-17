import type { Species } from '@spar/shared';
import { boulder } from './boulder';
import { broadleaf } from './broadleaf';
import { conifer } from './conifer';
import { grass } from './grass';
import { hexColor, type Detail, type Generator, type GeneratorColors, type MeshData, type Params } from './mesh';
import { shrub } from './shrub';
import { stump } from './stump';

/** To add a kind of plant shape: write a generator and list it here and in the species schema. */
export const GENERATORS: Record<Species['generator'], Generator> = { conifer, broadleaf, shrub, grass, boulder, stump };

/** Which season's foliage colour to use; the game clock will choose this in a later step. */
export type Season = keyof Species['seasons'];

/** Builds one individual of a species. Variant numbers give different individuals. */
export function generate(species: Species, variant: number, detail: Detail, season: Season = 'summer'): MeshData {
  const foliage = hexColor(species.seasons[season]);
  const bark = species.colors.bark ? hexColor(species.colors.bark) : foliage;
  const colors: GeneratorColors = {
    foliage,
    bark,
    barkTop: species.colors.barkTop ? hexColor(species.colors.barkTop) : bark,
    accent: species.colors.accent ? hexColor(species.colors.accent) : foliage,
  };
  // The seed depends only on the species name and variant, so every client grows the same trees.
  let seed = 2166136261;
  for (let i = 0; i < species.name.length; i++) seed = Math.imul(seed ^ species.name.charCodeAt(i), 16777619);
  return GENERATORS[species.generator](species.params as Params, colors, (seed ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0, detail);
}

export type { Detail, MeshData };
