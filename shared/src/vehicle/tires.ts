import type { VehicleDef } from '../generated/vehicle';

export interface TireOnGround {
  /** Friction coefficient. */
  grip: number;
  /** Drag as a share of the load on the wheel. */
  rollingResistance: number;
}

/** Fallbacks for a ground the vehicle definition does not list. */
const DEFAULT_GRIP = 0.6;
const DEFAULT_ROLLING = 0.05;

/**
 * Grip and rolling resistance of a vehicle's tyres on a kind of ground (a name from
 * defs/ground.json). `wet` runs from 0 dry to 1 soaked by rain.
 */
export function tireOnGround(def: VehicleDef, ground: string, wet = 0): TireOnGround {
  const t = def.tires;
  const dry = t.grip[ground] ?? DEFAULT_GRIP;
  const soaked = dry * (t.wetGrip[ground] ?? 0.8);
  return {
    grip: dry + (soaked - dry) * Math.min(1, Math.max(0, wet)),
    rollingResistance: t.rollingResistance[ground] ?? DEFAULT_ROLLING,
  };
}
