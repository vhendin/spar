// Runtime validation against the JSON Schemas. Kept out of the main entry so the
// browser bundle does not carry the validator.
import { Ajv, type ValidateFunction } from 'ajv';
import clientSchema from '../schemas/client-message.schema.json' with { type: 'json' };
import groundClassesSchema from '../schemas/ground-classes.schema.json' with { type: 'json' };
import regionDefSchema from '../schemas/region-def.schema.json' with { type: 'json' };
import regionIndexSchema from '../schemas/region-index.schema.json' with { type: 'json' };
import serverSchema from '../schemas/server-message.schema.json' with { type: 'json' };
import type { GroundClasses } from './generated/ground-classes';
import type { RegionDef } from './generated/region-def';
import type { RegionIndex } from './generated/region-index';
import type { ClientMessage, ServerMessage } from './protocol';

const ajv = new Ajv({ allErrors: false });

export const isClientMessage = ajv.compile(clientSchema) as ValidateFunction<ClientMessage>;
export const isServerMessage = ajv.compile(serverSchema) as ValidateFunction<ServerMessage>;
export const isRegionDef = ajv.compile(regionDefSchema) as ValidateFunction<RegionDef>;
export const isRegionIndex = ajv.compile(regionIndexSchema) as ValidateFunction<RegionIndex>;
export const isGroundClasses = ajv.compile(groundClassesSchema) as ValidateFunction<GroundClasses>;
