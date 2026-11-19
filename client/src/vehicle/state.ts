// What the effects read of a vehicle: spray, tracks, grime, exhaust and sound. The simulation
// provides it for our own vehicle; for another driver's, a remote vehicle fills it from the
// snapshots they send (multiplayer/others.ts).

import type { DrivetrainState } from '@spar/shared';
import type { WheelTelemetry } from './sim';
import type { VehicleShape } from './view';

export interface VehicleState extends VehicleShape {
  readonly body: VehicleShape['body'] & {
    linvel(): { x: number; y: number; z: number };
    mass(): number;
  };
  readonly wheels: readonly WheelTelemetry[];
  readonly drivetrain: Pick<DrivetrainState, 'gear' | 'range' | 'rpm' | 'shifting'>;
  /** Speed along the heading in m/s; negative when rolling backwards. */
  readonly speed: number;
  /** The pedal driving the engine, 0..1. */
  readonly pedal: number;
  readonly drowned: boolean;
  /** Deepest water around the vehicle, metres above the bottom of its tyres. */
  readonly wading: number;
}
