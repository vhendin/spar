/** Bumped whenever a message changes in a way older clients or servers cannot read. */
export const PROTOCOL_VERSION = 4;

export type * from './generated/client-message';
export type * from './generated/server-message';
// Both files declare the snapshot (the server's message refers to the client's); this one is it.
export type { VehicleSnapshot } from './generated/client-message';
