// Runtime validation against the JSON Schemas. Kept out of the main entry so the
// browser bundle does not carry the validator.
import { Ajv, type ValidateFunction } from 'ajv';
import clientSchema from '../schemas/client-message.schema.json' with { type: 'json' };
import serverSchema from '../schemas/server-message.schema.json' with { type: 'json' };
import type { ClientMessage, ServerMessage } from './protocol';

const ajv = new Ajv({ allErrors: false });

export const isClientMessage = ajv.compile(clientSchema) as ValidateFunction<ClientMessage>;
export const isServerMessage = ajv.compile(serverSchema) as ValidateFunction<ServerMessage>;
