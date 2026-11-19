/** Bumped whenever a message changes in a way older clients or servers cannot read. */
export const PROTOCOL_VERSION = 7;

export type * from './generated/client-message';
export type * from './generated/server-message';
// Both files declare these (the server's messages refer to the client's); these are them.
export type { Anchor, Anchor as AnchorData, DriveControls, FelledTree, IceHole, SnapshotWinch, VehicleHandover, VehicleSnapshot, WinchHandover } from './generated/client-message';
