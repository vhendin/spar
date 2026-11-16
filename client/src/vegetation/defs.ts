// The species and rules from /defs, bundled at build time so every player connected to a
// host runs the definitions that host was built with.

import type { Species, VegetationRules } from '@spar/shared';
import rules from '../../../defs/biomes.json';

const files = import.meta.glob<Species>('../../../defs/species/*.json', { eager: true, import: 'default' });

/** Every species, in file name order. */
export const SPECIES: Species[] = Object.keys(files).sort().map((path) => files[path]!);
export const RULES = rules as unknown as VegetationRules;
