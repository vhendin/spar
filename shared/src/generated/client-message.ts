// Generated from schemas/client-message.schema.json by scripts/gen-types.ts. Do not edit.

/**
 * Every message a client may send to the server.
 */
export type ClientMessage = Hello;

/**
 * First message on a new connection.
 */
export interface Hello {
  type: 'hello';
  protocol: number;
}
