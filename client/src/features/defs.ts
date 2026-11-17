// Object definitions from /defs/objects, bundled at build time like the species.

import type { ObjectDef } from '@spar/shared';

const files = import.meta.glob<ObjectDef>('../../../defs/objects/*.json', { eager: true, import: 'default' });

/** Every object definition by name. */
export const OBJECTS: Record<string, ObjectDef> = Object.fromEntries(Object.values(files).map((d) => [d.name, d]));
