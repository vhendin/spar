// Procedural vehicle body: everything is built from the numbers in the vehicle definition,
// so another definition gives another vehicle without touching this code. Flat-shaded
// boxes and prisms in the vehicle's frame: x left, y up from the ground, z forward.

import * as THREE from 'three/webgpu';
import type { VehicleDef } from '@spar/shared';

type P3 = [number, number, number];

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
  return [b.width * 0.22, Math.min(b.beltline + 0.36, b.height - 0.4), b.length / 2 - b.windscreenRake - 0.6];
}

function buildInterior(def: VehicleDef, c: Record<string, THREE.Color>): THREE.BufferGeometry {
  const b = def.body;
  const m = new FlatMesh();
  // Kept a little inside the body's own faces, so the two never fight over a pixel.
  const half = b.length / 2 - 0.03, hw = b.width / 2 - 0.03, top = b.height - 0.03;
  const cabBack = b.length / 2 - b.cabLength;
  const lean = b.windscreenRake;
  const front = half - 0.06;
  const [ex, , ez] = driverEye(def);
  const dash = c.trim!, panel = c.body!, roof = c.roof!;

  // Floor, roof lining and the wall behind the seats, with a window in it.
  m.box(-hw, b.floor, cabBack, hw, b.floor + 0.04, front, dash);
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

  for (const side of [1, -1]) {
    const x0 = Math.min(side * (hw - 0.09), side * hw), x1 = Math.max(side * (hw - 0.09), side * hw);
    // Windscreen pillars following its lean, the header above it and the door frames.
    m.prism([[front, b.beltline], [front - lean, top], [front - lean - 0.08, top], [front - 0.08, b.beltline]], Math.min(side * (hw - 0.07), side * hw), Math.max(side * (hw - 0.07), side * hw), panel);
    m.box(x0, b.floor, cabBack, x1, b.beltline + 0.06, front, panel);
    m.box(x0, b.beltline + 0.06, cabBack, x1, top, cabBack + 0.14, panel);
    m.box(x0, top - 0.16, cabBack, x1, top, front - lean, panel);
  }
  m.box(-hw, top - 0.15, front - lean - 0.3, hw, top, front - lean - 0.02, panel);
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

  // Cab: flat front, windscreen leaning back, seen from the side as one outline.
  const lean = b.windscreenRake;
  m.prism([[cabBack, b.floor], [half - 0.05, b.floor], [half, b.floor + 0.2], [half, b.beltline + 0.03], [half - lean, top - 0.07], [half - lean - 0.14, top], [cabBack, top]], -hw, hw, c.body);

  // Behind the cab.
  if (b.rear === 'pickup') {
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
  if (b.rear !== 'canvas') m.box(-hw + 0.05, top - 0.02, -half + 0.05, hw - 0.05, top + 0.015, half - lean - 0.2, c.roof);
  else m.box(-hw + 0.05, top - 0.02, cabBack, hw - 0.05, top + 0.015, half - lean - 0.2, c.roof);

  // Glass, a mesh of its own: from inside the cab it would block the view.
  const glass = new FlatMesh();
  // Windscreen following the lean, door windows, and side windows on a hard top.
  const g = 0.012;
  glass.prism([[half + g, b.beltline + 0.09], [half - lean + g, top - 0.14], [half - lean - 0.02, top - 0.14], [half - 0.02, b.beltline + 0.09]], -hw + 0.1, hw - 0.1, c.glass);
  for (const side of [1, -1]) {
    const x0 = side * (hw - 0.01), x1 = side * (hw + g);
    glass.box(Math.min(x0, x1), b.beltline + 0.06, cabBack + 0.14, Math.max(x0, x1), top - 0.16, half - lean - 0.22, c.glass);
    if (b.rear === 'hardtop') {
      const length = cabBack + half;
      for (const [f0, f1] of [[0.08, 0.46], [0.54, 0.92]] as const) {
        glass.box(Math.min(x0, x1), b.beltline + 0.1, -half + length * f0, Math.max(x0, x1), top - 0.2, -half + length * f1, c.glass);
      }
    }
    // Wheel arches: dark panels over each wheel.
    for (const axle of def.axles) {
      const r = def.wheels.radius;
      m.prism([[axle.z - r - 0.1, b.floor - 0.02], [axle.z + r + 0.1, b.floor - 0.02], [axle.z + r * 0.7, r * 2 + 0.1], [axle.z - r * 0.7, r * 2 + 0.1]], Math.min(x0, x1), Math.max(x0, x1), c.trim);
    }
  }
  if (b.rear === 'hardtop') glass.box(-hw + 0.25, b.beltline + 0.12, -half - g, hw - 0.25, top - 0.22, -half + 0.01, c.glass);

  // Front: grille panel and bumpers; underneath: frame and axle beams.
  m.box(-0.48, b.floor + 0.26, half - 0.01, 0.48, b.beltline - 0.16, half + g, c.trim);
  m.box(-hw, b.floor - 0.06, half - 0.02, hw, b.floor + 0.12, half + 0.1, c.trim);
  m.box(-hw, b.floor - 0.06, -half - 0.08, hw, b.floor + 0.1, -half + 0.02, c.trim);
  m.box(-0.42, clearance + 0.02, -half + 0.25, 0.42, b.floor, half - 0.25, c.trim);
  for (const axle of def.axles) {
    m.cylinder('x', 0, def.wheels.radius, axle.z, 0.07, axle.track / 2 - 0.05, 8, c.trim, c.trim);
    m.cylinder('z', 0.05, def.wheels.radius, axle.z, 0.16, 0.14, 8, c.trim, c.trim);
  }

  if (b.roofRack && b.rear !== 'canvas') {
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
  const { radius, width } = def.wheels;
  w.cylinder('x', 0, 0, 0, radius, width / 2, 20, c.tire, c.tire);
  w.cylinder('x', 0, 0, 0, radius * 0.56, width / 2 + 0.012, 12, c.hub, c.hub);
  // A bar across the hub, so the wheel can be seen to turn.
  w.box(-width / 2 - 0.022, -radius * 0.5, -0.04, width / 2 + 0.022, radius * 0.5, 0.04, c.trim);
  const wheel = new THREE.Mesh(w.build(), material);

  const lamps = (points: number[][], facing: number, color: number): THREE.Mesh => {
    const l = new FlatMesh();
    const lit = new THREE.Color(color);
    for (const p of points) l.cylinder('z', p[0]!, p[1]!, p[2]! + facing * 0.02, 0.085, 0.03, 12, lit, lit);
    return new THREE.Mesh(l.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: color, emissiveIntensity: 0 }));
  };
  const interior = new THREE.Mesh(buildInterior(def, c), material);
  return { body, glass: new THREE.Mesh(glass.build(), material), wheel, headlights: lamps(b.headlights, 1, 0xfff4d6), taillights: lamps(b.taillights, -1, 0xb01818), interior };
}
