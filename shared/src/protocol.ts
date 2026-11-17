/** Bumped whenever a message changes in a way older clients or servers cannot read. */
export const PROTOCOL_VERSION = 3;

export type * from './generated/client-message';
export type * from './generated/server-message';
