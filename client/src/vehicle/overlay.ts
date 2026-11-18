import type { VehicleSim } from './sim';

const pad = (text: string, width: number): string => text.padEnd(width);

/** The driving read-out: speed, gear and, per wheel, load, grip, ground and slip. */
export function driveReadout(sim: VehicleSim, detailed: boolean): string {
  const d = sim.drivetrain;
  const gear = d.gear < 0 ? 'R' : String(d.gear);
  const locks = sim.def.axles.map((axle, a) => (axle.differential === 'open' ? '' : `${a + 1}${sim.locks[a] ? '■' : '□'}`)).filter(Boolean).join(' ');
  const head = `${Math.abs(sim.speed * 3.6).toFixed(0)} km/h · gear ${gear} ${d.range} · ${d.rpm.toFixed(0)} rpm · locks ${locks}${sim.holding ? ' · holding' : ''}${sim.wading > 0 ? ` · wading ${sim.wading.toFixed(2)} m` : ''}${sim.drowned ? ' · DROWNED' : ''}`;
  if (!detailed) return head;
  const rows = sim.wheels.map((w, i) => {
    const name = `${i >> 1 === 0 ? 'front' : sim.def.axles.length === 2 || i >> 1 === sim.def.axles.length - 1 ? 'rear' : 'mid'} ${i & 1 ? 'R' : 'L'}`;
    const load = w.contact ? `${(w.load / 1000).toFixed(1)} kN` : 'in air';
    const sunk = w.sink > 0.005 ? `${(w.sink * 100).toFixed(0)} cm` : '';
    return `${pad(name, 9)}${pad(load, 9)}${pad(w.grip.toFixed(2), 6)}${pad(w.ground, 9)}${pad(sunk, 7)}${w.spin > 0.02 ? `${(w.spin * 100).toFixed(0)}% spin` : ''}`;
  });
  return [head, `${pad('wheel', 9)}${pad('load', 9)}${pad('grip', 6)}${pad('ground', 9)}${pad('sunk', 7)}`, ...rows].join('\n');
}
