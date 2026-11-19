// Procedural vehicle body: everything is built from the numbers in the vehicle definition,
// so another definition gives another vehicle without touching this code. Flat-shaded
// boxes and prisms in the vehicle's frame: x left, y up from the ground, z forward.

import * as THREE from 'three/webgpu';
import type { VehicleDef } from '@spar/shared';

type P3 = [number, number, number];
type P2 = [number, number];

// A body given as one side outline ([z, y] points, convex): where it crosses heights and
// lengths, shrunk inwards, and cut by straight lines.

/** The frontmost z where the outline is at height y. */
function frontAt(outline: P2[], y: number): number {
  let best = -Infinity;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) return;
    best = Math.max(best, a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
  });
  return best;
}

/** The top of the outline at length z. */
function topAt(outline: P2[], z: number): number {
  let best = -Infinity;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    if ((a[0] - z) * (b[0] - z) > 0 || a[0] === b[0]) return;
    best = Math.max(best, a[1] + ((b[1] - a[1]) * (z - a[0])) / (b[0] - a[0]));
  });
  return best;
}

/** The outline moved in by d on every side. */
function inset(outline: P2[], d: number): P2[] {
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = outline[i]!, b = outline[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const turn = area > 0 ? 1 : -1;
  // Each edge as a point and a direction, pushed inwards along its normal.
  const lines = outline.map((a, i) => {
    const b = outline[(i + 1) % n]!;
    const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy) || 1;
    const nz = (-dy / len) * turn, ny = (dz / len) * turn;
    return { z: a[0] + nz * d, y: a[1] + ny * d, dz, dy };
  });
  return lines.map((l, i) => {
    const k = lines[(i + n - 1) % n]!;
    const det = k.dz * l.dy - k.dy * l.dz;
    if (Math.abs(det) < 1e-9) return [l.z, l.y] as P2;
    const t = ((l.z - k.z) * l.dy - (l.y - k.y) * l.dz) / det;
    return [k.z + k.dz * t, k.y + k.dy * t] as P2;
  });
}

/** What is left of the outline where along(p) >= 0, for a straight line `along`. */
function clip(outline: P2[], along: (p: P2) => number): P2[] {
  const out: P2[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const fa = along(a), fb = along(b);
    if (fa >= 0) out.push(a);
    if (fa * fb < 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  return out;
}

class FlatMesh {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];

  /** A triangle facing away from `inside`. */
  private tri(a: P3, b: P3, c: P3, color: THREE.Color, inside: P3): void {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const out = nx * (a[0] - inside[0]) + ny * (a[1] - inside[1]) + nz * (a[2] - inside[2]) >= 0;
    const order = out ? [a, b, c] : [a, c, b];
    for (const p of order) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(out ? nx : -nx, out ? ny : -ny, out ? nz : -nz);
      this.colors.push(color.r, color.g, color.b);
    }
  }

  private quad(a: P3, b: P3, c: P3, d: P3, color: THREE.Color, inside: P3): void {
    this.tri(a, b, c, color, inside);
    this.tri(a, c, d, color, inside);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color): void {
    this.prism([[z0, y0], [z1, y0], [z1, y1], [z0, y1]], x0, x1, color);
  }

  /** A convex outline in the z-y plane, given as [z, y] points, pushed out from x0 to x1. */
  prism(outline: [number, number][], x0: number, x1: number, color: THREE.Color): void {
    const n = outline.length;
    let cz = 0, cy = 0;
    for (const [z, y] of outline) { cz += z / n; cy += y / n; }
    const inside: P3 = [(x0 + x1) / 2, cy, cz];
    const at = (k: number, x: number): P3 => [x, outline[k % n]![1], outline[k % n]![0]];
    for (let k = 0; k < n; k++) this.quad(at(k, x0), at(k + 1, x0), at(k + 1, x1), at(k, x1), color, inside);
    for (let k = 1; k < n - 1; k++) {
      this.tri(at(0, x0), at(k, x0), at(k + 1, x0), color, inside);
      this.tri(at(0, x1), at(k, x1), at(k + 1, x1), color, inside);
    }
  }

  /** A cylinder lying along x ('x') or along z ('z'), centred at the given point. */
  cylinder(axis: 'x' | 'z', cx: number, cy: number, cz: number, radius: number, half: number, segments: number, side: THREE.Color, cap: THREE.Color): void {
    const inside: P3 = [cx, cy, cz];
    const at = (k: number, end: number): P3 => {
      const a = (k / segments) * Math.PI * 2;
      const u = Math.cos(a) * radius, v = Math.sin(a) * radius;
      return axis === 'x' ? [cx + end * half, cy + v, cz + u] : [cx + u, cy + v, cz + end * half];
    };
    const centre = (end: number): P3 => (axis === 'x' ? [cx + end * half, cy, cz] : [cx, cy, cz + end * half]);
    for (let k = 0; k < segments; k++) {
      this.quad(at(k, -1), at(k + 1, -1), at(k + 1, 1), at(k, 1), side, inside);
      this.tri(centre(-1), at(k, -1), at(k + 1, -1), cap, inside);
      this.tri(centre(1), at(k, 1), at(k + 1, 1), cap, inside);
    }
  }

  /** A ring of square section standing in the x-y plane, facing along z. */
  ring(cx: number, cy: number, cz: number, radius: number, thick: number, segments: number, color: THREE.Color): void {
    const t = thick / 2;
    const at = (k: number, r: number, z: number): P3 => {
      const a = (k / segments) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + z];
    };
    for (let k = 0; k < segments; k++) {
      const a = ((k + 0.5) / segments) * Math.PI * 2;
      const inside: P3 = [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz];
      const corners: [number, number][] = [[radius - t, -t], [radius + t, -t], [radius + t, t], [radius - t, t]];
      for (let c = 0; c < 4; c++) {
        const [r0, z0] = corners[c]!, [r1, z1] = corners[(c + 1) % 4]!;
        this.quad(at(k, r0, z0), at(k + 1, r0, z0), at(k + 1, r1, z1), at(k, r1, z1), color, inside);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    return geometry;
  }
}

export interface VehicleMeshes {
  /** The body, with its origin on the ground under the middle of the vehicle. */
  body: THREE.Mesh;
  /** The windows, drawn from outside only. */
  glass: THREE.Mesh;
  /** One wheel, centred on its hub; clone it per wheel. */
  wheel: THREE.Mesh;
  /** Lamp glasses, separate so they can be lit. */
  headlights: THREE.Mesh;
  taillights: THREE.Mesh;
  /**
   * The inside of the cab, seen from the driver's seat. Every face of the body faces
   * outwards, so from inside the body is invisible and only this is drawn.
   */
  interior: THREE.Mesh;
}

/** The driver's eyes in the vehicle's frame (x left, y up, z forward): left-hand drive. */
export function driverEye(def: VehicleDef): P3 {
  const b = def.body;
  const y = Math.min(b.beltline + 0.36, b.height - 0.4);
  // Under a long sloping windscreen: a little behind the glass above the eyes.
  if (b.profile) return [b.width * 0.22, y, frontAt(b.profile as P2[], y + 0.25) - 0.45];
  return [b.width * 0.22, y, cabFront(def) - windscreenLean(def) - 0.6];
}

/** The open end of the exhaust pipe in the vehicle's frame: under the rear bumper on the right. */
export function exhaustOutlet(def: VehicleDef): P3 {
  const b = def.body;
  return [-(b.width / 2 - 0.2), Math.min(def.chassis.groundClearance + 0.12, b.floor - 0.11), -b.length / 2 - 0.2];
}

/** Where the cab starts: the front of the body, the back of the bonnet, or where the outline crosses the beltline. */
function cabFront(def: VehicleDef): number {
  const b = def.body;
  if (b.profile) return frontAt(b.profile as P2[], b.beltline);
  return b.length / 2 - (b.bonnet?.length ?? 0);
}

/** How far the windscreen's top leans back from its foot. */
function windscreenLean(def: VehicleDef): number {
  const b = def.body;
  if (!b.profile) return b.windscreenRake;
  const outline = b.profile as P2[];
  return cabFront(def) - frontAt(outline, Math.max(...outline.map((p) => p[1])) - 0.01);
}

/** The roof's height over the cab: under a sloping outline, its lowest point there. */
function cabTop(def: VehicleDef): number {
  const b = def.body;
  if (!b.profile) return b.height;
  const outline = b.profile as P2[];
  return Math.min(b.height, topAt(outline, b.length / 2 - b.cabLength), topAt(outline, cabFront(def) - windscreenLean(def)));
}

function buildInterior(def: VehicleDef, c: Record<string, THREE.Color>): THREE.BufferGeometry {
  const b = def.body;
  const m = new FlatMesh();
  // Kept a little inside the body's own faces, so the two never fight over a pixel.
  const hw = b.width / 2 - 0.03, top = cabTop(def) - 0.03;
  const cabBack = b.length / 2 - b.cabLength;
  const lean = windscreenLean(def);
  const front = cabFront(def) - 0.09;
  const [ex, , ez] = driverEye(def);
  const dash = c.trim!, panel = c.body!, roof = c.roof!;

  m.box(-hw, b.floor, cabBack, hw, b.floor + 0.04, front, dash);
  if (b.rear === 'open') {
    // No roof and no walls of its own: the tub's sides, the windscreen frame and the seats
    // are part of the body and seen from both sides. Just the dashboard and the wheel.
    m.box(-hw, b.beltline - 0.3, front - 0.42, hw, b.beltline + 0.02, front, dash);
    const wheelZ = Math.min(ez + 0.42, front - 0.5);
    m.ring(ex, b.beltline - 0.05, wheelZ, 0.19, 0.03, 20, dash);
    m.box(ex - 0.012, b.beltline - 0.24, wheelZ - 0.012, ex + 0.012, b.beltline + 0.14, wheelZ + 0.012, dash);
    m.cylinder('z', ex, b.beltline - 0.05, wheelZ + 0.15, 0.035, 0.15, 8, dash, dash);
    return m.build();
  }

  // Roof lining and the wall behind the seats, with a window in it.
  m.box(-hw, top - 0.05, cabBack, hw, top, front - lean - 0.1, roof);
  m.box(-hw, b.floor, cabBack - 0.04, hw, b.beltline + 0.1, cabBack, panel);
  m.box(-hw, top - 0.28, cabBack - 0.04, hw, top, cabBack, panel);
  for (const side of [1, -1]) m.box(Math.min(side * 0.5, side * hw), b.beltline + 0.1, cabBack - 0.04, Math.max(side * 0.5, side * hw), top - 0.28, cabBack, panel);

  // Dashboard under the windscreen, a hood over the instruments and the steering wheel.
  m.box(-hw, b.beltline - 0.3, front - 0.42, hw, b.beltline + 0.02, front, dash);
  m.box(ex - 0.24, b.beltline + 0.02, front - 0.4, ex + 0.24, b.beltline + 0.09, front - 0.22, dash);
  const wheelZ = Math.min(ez + 0.42, front - 0.5);
  m.ring(ex, b.beltline - 0.05, wheelZ, 0.19, 0.03, 20, dash);
  m.box(ex - 0.012, b.beltline - 0.24, wheelZ - 0.012, ex + 0.012, b.beltline + 0.14, wheelZ + 0.012, dash);
  m.cylinder('z', ex, b.beltline - 0.05, wheelZ + 0.15, 0.035, 0.15, 8, dash, dash);
  // Under a long sloping windscreen the dashboard is deep: one block from the floor, so the
  // ground does not show beneath it.
  if (b.profile) m.box(-hw, b.floor, Math.min(ez + 0.6, front - 0.42), hw, b.beltline + 0.02, front, dash);

  for (const side of [1, -1]) {
    const x0 = Math.min(side * (hw - 0.09), side * hw), x1 = Math.max(side * (hw - 0.09), side * hw);
    // Windscreen pillars following its lean, the header above it and the door frames.
    m.prism([[front, b.beltline], [front - lean, top], [front - lean - 0.08, top], [front - 0.08, b.beltline]], Math.min(side * (hw - 0.07), side * hw), Math.max(side * (hw - 0.07), side * hw), panel);
    m.box(x0, b.floor, cabBack, x1, b.beltline + 0.06, front, panel);
    m.box(x0, b.beltline + 0.06, cabBack, x1, top, cabBack + 0.14, panel);
    // A rail over the door; under a sloping outline the roof lining takes its place.
    if (!b.profile) m.box(x0, top - 0.16, cabBack, x1, top, front - lean, panel);
  }
  m.box(-hw, top - 0.15, front - lean - 0.3, hw, top, front - lean - 0.02, panel);
  if (b.profile) {
    // Under a sloping outline, the roof lining follows it from the windscreen's top edge back.
    const lining = clip(clip(inset(b.profile as P2[], 0.03), (p) => p[1] - (b.height - 0.2)), (p) => p[0] - cabBack);
    if (lining.length >= 3) m.prism(lining, -hw, hw, roof);
  }
  return m.build();
}

export function buildVehicleMeshes(def: VehicleDef): VehicleMeshes {
  const b = def.body;
  const c = Object.fromEntries(Object.entries(b.colors).map(([k, hex]) => [k, new THREE.Color(hex)])) as Record<keyof typeof b.colors, THREE.Color>;
  const half = b.length / 2;
  const hw = b.width / 2;
  const top = b.height;
  const cabBack = half - b.cabLength;
  const clearance = def.chassis.groundClearance;
  const m = new FlatMesh();
  const outline = b.profile as P2[] | undefined;
  const open = !outline && b.rear === 'open';
  const lean = windscreenLean(def);
  const front = cabFront(def);
  const { radius, width } = def.wheels;
  const electric = def.drivetrain.motor === 'electric';

  // One outline for the whole body: a wedge, say.
  if (outline) m.prism(outline, -hw, hw, c.body);

  // An engine bonnet ahead of the cab, sloping up a little towards the windscreen.
  if (b.bonnet && !outline) {
    const h = b.bonnet.height;
    m.prism([[front, b.floor], [half - 0.05, b.floor], [half, b.floor + 0.2], [half, h], [half - 0.06, h + 0.02], [front, h + 0.06]], -hw + 0.04, hw - 0.04, c.body);
  }

  if (open) {
    // A tub of thin walls, so it can be seen into, and the windscreen in a frame.
    const t = 0.04;
    m.box(-hw, b.floor, -half, hw, b.floor + t, front, c.body);
    for (const side of [1, -1]) {
      m.box(Math.min(side * hw, side * (hw - t)), b.floor, -half, Math.max(side * hw, side * (hw - t)), b.beltline, front, c.body);
      m.prism([[front, b.beltline], [front - lean, top], [front - lean - 0.05, top], [front - 0.05, b.beltline]], Math.min(side * hw, side * (hw - 0.07)), Math.max(side * hw, side * (hw - 0.07)), c.body);
      // Seats, a cushion and a back.
      const s0 = Math.min(side * 0.1, side * 0.6), s1 = Math.max(side * 0.1, side * 0.6);
      m.box(s0, b.floor + 0.3, cabBack + 0.15, s1, b.floor + 0.42, cabBack + 0.65, c.canvas);
      m.prism([[cabBack + 0.08, b.floor + 0.3], [cabBack + 0.2, b.floor + 0.3], [cabBack + 0.12, b.beltline + 0.4], [cabBack, b.beltline + 0.4]], s0, s1, c.canvas);
    }
    m.box(-hw, b.floor, -half, hw, b.beltline, -half + t, c.body);
    m.box(-hw, b.floor, front - 0.06, hw, b.beltline + 0.03, front, c.body);
    m.box(-hw, b.beltline, front - 0.06, hw, b.beltline + 0.08, front, c.body);
    m.box(-hw, top - 0.06, front - lean - 0.05, hw, top, front - lean + 0.01, c.body);
    // A roll bar behind the seats, braced back to the rear corners.
    const bar = 0.03, x = hw - 0.12, z = cabBack - 0.05, rollTop = top - 0.05;
    for (const side of [x, -x]) {
      m.box(side - bar, b.beltline, z - bar, side + bar, rollTop, z + bar, c.trim);
      m.prism([[z - bar, rollTop], [z + bar, rollTop], [-half + 0.2, b.beltline], [-half + 0.2 - 2 * bar, b.beltline]], side - bar, side + bar, c.trim);
    }
    m.box(-x - bar, rollTop - 2 * bar, z - bar, x + bar, rollTop, z + bar, c.trim);
  } else if (!outline) {
    // Cab: flat front (or the bonnet's back), windscreen leaning back, seen from the side as one outline.
    m.prism([[cabBack, b.floor], [front - 0.05, b.floor], [front, b.floor + 0.2], [front, b.beltline + 0.03], [front - lean, top - 0.07], [front - lean - 0.14, top], [cabBack, top]], -hw, hw, c.body);
  }

  // Behind the cab.
  if (open || outline) {
    // The tub above carries on to the back, or the outline is the whole body.
  } else if (b.rear === 'pickup') {
    m.box(-hw, b.floor, -half, hw, b.beltline - 0.1, cabBack, c.body);
  } else if (b.rear === 'canvas') {
    m.box(-hw, b.floor, -half, hw, b.beltline - 0.12, cabBack, c.body);
    // A canvas cover over bows: a little narrower than the body, with a ridged roof.
    const cw = hw - 0.03;
    for (const [x0, x1, peak] of [[-cw, 0, 0.05], [0, cw, 0.05]] as const) {
      m.prism([[-half + 0.02, b.beltline - 0.12], [cabBack, b.beltline - 0.12], [cabBack, top - 0.02 + peak], [-half + 0.02, top - 0.02 + peak]], x0, x1, c.canvas);
    }
    for (let z = -half + 0.35; z < cabBack - 0.2; z += 0.8) m.box(-cw - 0.012, b.beltline - 0.1, z - 0.02, cw + 0.012, top + 0.04, z + 0.02, c.trim);
  } else {
    m.box(-hw, b.floor, -half, hw, top - 0.02, cabBack, c.body);
  }
  if (b.rear === 'canvas') m.box(-hw + 0.05, top - 0.02, cabBack, hw - 0.05, top + 0.015, front - lean - 0.2, c.roof);
  else if (!open && !outline) m.box(-hw + 0.05, top - 0.02, -half + 0.05, hw - 0.05, top + 0.015, front - lean - 0.2, c.roof);

  // Glass, a mesh of its own: from inside the cab it would block the view.
  const glass = new FlatMesh();
  // Windscreen following the lean, door windows, and side windows on a hard top.
  const g = 0.012;
  if (outline) {
    // Lying on the outline's front slope, just proud of it.
    const p1: P2 = [frontAt(outline, b.beltline + 0.06), b.beltline + 0.06];
    const p2: P2 = [frontAt(outline, top - 0.12), top - 0.12];
    const dz = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dz, dy) || 1;
    const nz = (dy / len) * g, ny = (-dz / len) * g;
    glass.prism([p1, p2, [p2[0] + nz, p2[1] + ny], [p1[0] + nz, p1[1] + ny]], -hw + 0.1, hw - 0.1, c.glass);
  } else if (open) glass.prism([[front - 0.02, b.beltline + 0.08], [front - lean - 0.02, top - 0.06], [front - lean - 0.04, top - 0.06], [front - 0.04, b.beltline + 0.08]], -hw + 0.07, hw - 0.07, c.glass);
  else glass.prism([[front + g, b.beltline + 0.09], [front - lean + g, top - 0.14], [front - lean - 0.02, top - 0.14], [front - 0.02, b.beltline + 0.09]], -hw + 0.1, hw - 0.1, c.glass);
  // Side windows on an outline: the outline shrunk in, above the beltline, from the windscreen's
  // pillar back to the cab's end.
  const sideWindow = outline
    ? clip(clip(clip(inset(outline, 0.08), (p) => p[1] - b.beltline - 0.06), (p) => p[0] - cabBack - 0.1), (p) => front - 0.25 - p[0])
    : [];
  for (const side of [1, -1]) {
    const x0 = side * (hw - 0.01), x1 = side * (hw + g);
    if (outline) {
      if (sideWindow.length >= 3) glass.prism(sideWindow, Math.min(x0, x1), Math.max(x0, x1), c.glass);
    } else if (!open) glass.box(Math.min(x0, x1), b.beltline + 0.06, cabBack + 0.14, Math.max(x0, x1), top - 0.16, front - lean - 0.22, c.glass);
    if (b.rear === 'hardtop' && !outline) {
      const length = cabBack + half;
      for (const [f0, f1] of [[0.08, 0.46], [0.54, 0.92]] as const) {
        glass.box(Math.min(x0, x1), b.beltline + 0.1, -half + length * f0, Math.max(x0, x1), top - 0.2, -half + length * f1, c.glass);
      }
    }
    // Wheel arches: dark panels over each wheel.
    for (const axle of def.axles) {
      const r = def.wheels.radius;
      m.prism([[axle.z - r - 0.1, b.floor - 0.02], [axle.z + r + 0.1, b.floor - 0.02], [axle.z + r * 0.7, r * 2 + 0.1], [axle.z - r * 0.7, r * 2 + 0.1]], Math.min(x0, x1), Math.max(x0, x1), c.trim);
      // Where the tyres stand out past the body, flared mudguards over them.
      const outer = axle.track / 2 + width / 2 + 0.04;
      if (outer > hw) {
        const f0 = Math.min(side * (hw - 0.02), side * outer), f1 = Math.max(side * (hw - 0.02), side * outer);
        const y = r * 2 + 0.08;
        m.box(f0, y - 0.03, axle.z - r * 0.8, f1, y, axle.z + r * 0.8, c.trim);
        for (const end of [1, -1]) {
          const a = axle.z + end * r * 0.8, d = axle.z + end * r * 1.2;
          m.prism([[a, y], [a, y - 0.03], [d, y - 0.25], [d, y - 0.22]], f0, f1, c.trim);
        }
      }
    }
  }
  if (b.rear === 'hardtop' && !outline) glass.box(-hw + 0.25, b.beltline + 0.12, -half - g, hw - 0.25, top - 0.22, -half + 0.01, c.glass);

  if (b.spareWheel) {
    const y = Math.max(b.floor + radius, b.beltline - radius * 0.4);
    m.cylinder('z', 0, y, -half - width / 2 - 0.02, radius, width / 2, 20, c.tire, c.tire);
    m.cylinder('z', 0, y, -half - width / 2 - 0.02, radius * 0.56, width / 2 + 0.012, 12, c.hub, c.hub);
  }

  // Front: grille panel (none on an electric vehicle: nothing to cool behind it) and bumpers;
  // underneath: frame and axle beams.
  if (!electric) m.box(-0.48, b.floor + 0.26, half - 0.01, 0.48, (b.bonnet?.height ?? b.beltline) - 0.16, half + g, c.trim);
  m.box(-hw, b.floor - 0.06, half - 0.02, hw, b.floor + 0.12, half + 0.1, c.trim);
  m.box(-hw, b.floor - 0.06, -half - 0.08, hw, b.floor + 0.1, -half + 0.02, c.trim);
  m.box(-0.42, clearance + 0.02, -half + 0.25, 0.42, b.floor, half - 0.25, c.trim);
  // A small exhaust pipe beside the frame, coming out under the rear bumper on the right,
  // with a sooty opening.
  if (!electric) {
    const [x, y, z1] = exhaustOutlet(def), z0 = -half + 0.15;
    const steel = new THREE.Color(0x77716a), soot = new THREE.Color(0x0c0b0a);
    m.cylinder('z', x, y, (z0 + z1) / 2, 0.038, (z0 - z1) / 2, 10, steel, soot);
    m.box(x - 0.012, y + 0.03, z0 + 0.04, x + 0.012, b.floor, z0 + 0.07, c.trim);
  }
  for (const axle of def.axles) {
    m.cylinder('x', 0, def.wheels.radius, axle.z, 0.07, axle.track / 2 - 0.05, 8, c.trim, c.trim);
    m.cylinder('z', 0.05, def.wheels.radius, axle.z, 0.16, 0.14, 8, c.trim, c.trim);
  }

  if (b.roofRack && b.rear !== 'canvas' && !outline) {
    const y = top + 0.09, x = hw - 0.12, z0 = -half + 0.15, z1 = cabBack + 0.3;
    for (const side of [x, -x]) m.box(side - 0.015, y, z0, side + 0.015, y + 0.03, z1, c.trim);
    for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / 4) {
      m.box(-x, y, z - 0.015, x, y + 0.03, z + 0.015, c.trim);
      for (const side of [x, -x]) m.box(side - 0.012, top, z - 0.012, side + 0.012, y, z + 0.012, c.trim);
    }
  }

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
  const body = new THREE.Mesh(m.build(), material);

  const w = new FlatMesh();
  w.cylinder('x', 0, 0, 0, radius, width / 2, 20, c.tire, c.tire);
  w.cylinder('x', 0, 0, 0, radius * 0.56, width / 2 + 0.012, 12, c.hub, c.hub);
  // A bar across the hub, so the wheel can be seen to turn.
  w.box(-width / 2 - 0.022, -radius * 0.5, -0.04, width / 2 + 0.022, radius * 0.5, 0.04, c.trim);
  const wheel = new THREE.Mesh(w.build(), material);

  const lamps = (points: number[][], facing: number, color: number): THREE.Mesh => {
    const l = new FlatMesh();
    const lit = new THREE.Color(color);
    if (b.lightBars && points.length >= 2) {
      // One thin strip across, between the outermost lamps.
      const xs = points.map((p) => p[0]!), p = points[0]!;
      const z = p[2]! + facing * 0.02;
      l.box(Math.min(...xs), p[1]! - 0.025, z - 0.03, Math.max(...xs), p[1]! + 0.025, z + 0.03, lit);
    } else for (const p of points) l.cylinder('z', p[0]!, p[1]!, p[2]! + facing * 0.02, 0.085, 0.03, 12, lit, lit);
    return new THREE.Mesh(l.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: color, emissiveIntensity: 0 }));
  };
  const interior = new THREE.Mesh(buildInterior(def, c), material);
  return { body, glass: new THREE.Mesh(glass.build(), material), wheel, headlights: lamps(b.headlights, 1, 0xfff4d6), taillights: lamps(b.taillights, -1, 0xb01818), interior };
}
