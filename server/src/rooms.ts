// What players changed in each region this session: trees knocked down and holes broken in
// the ice. Each region is a room; a driver entering one is sent its list, and every change is
// passed on to the others there. Nothing is written to disk: a new session starts afresh.

import type { FelledTree, IceHole, ServerMessage } from '@spar/shared';

type RoomState = Extract<ServerMessage, { type: 'room' }>;

/** As many holes as a browser keeps (groundStore.ts); the oldest goes first. */
export const MAX_HOLES = 8;
/** Holes closer than this to one already there are the same hole (groundStore's radius). */
const HOLE_RADIUS = 3.5;
/** Trees kept per region; past this the oldest stand up again for late joiners. */
export const MAX_FELLED = 5000;

interface Room {
  felled: Map<string, FelledTree>;
  holes: IceHole[];
}

export class Rooms {
  private readonly rooms = new Map<string, Room>();

  private room(region: string): Room {
    let room = this.rooms.get(region);
    if (!room) {
      room = { felled: new Map(), holes: [] };
      this.rooms.set(region, room);
    }
    return room;
  }

  /** A tree knocked down; false if it already was. */
  fell(region: string, tree: FelledTree): boolean {
    const room = this.room(region);
    if (room.felled.has(tree.key)) return false;
    room.felled.set(tree.key, tree);
    if (room.felled.size > MAX_FELLED) room.felled.delete(room.felled.keys().next().value!);
    return true;
  }

  /** A hole broken in the ice; false if there already is one there. */
  breakIce(region: string, hole: IceHole): boolean {
    const room = this.room(region);
    if (room.holes.some((h) => Math.hypot(h.x - hole.x, h.z - hole.z) < HOLE_RADIUS)) return false;
    room.holes.push({ x: hole.x, z: hole.z });
    if (room.holes.length > MAX_HOLES) room.holes.shift();
    return true;
  }

  /** The ice has gone everywhere: next winter freezes over the old holes. */
  thaw(): void {
    for (const room of this.rooms.values()) room.holes.length = 0;
  }

  state(region: string): Pick<RoomState, 'felled' | 'holes'> {
    const room = this.rooms.get(region);
    return { felled: room ? [...room.felled.values()] : [], holes: (room ? room.holes.map((h) => ({ ...h })) : []) as RoomState['holes'] };
  }
}
