// Generated from schemas/server-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message the server may send to a client.
 */
export type ServerMessage = Welcome | ServerError;

/**
 * Reply to hello: who you are and which world to load.
 */
export interface Welcome {
  type: 'welcome';
  protocol: number;
  playerId: string;
  region: string;
  seed: number;
}
export interface ServerError {
  type: 'error';
  code: 'bad_message' | 'protocol_mismatch';
  message: string;
}
