// Draws the winch: rings round what can be hooked to while choosing, the cable hanging or
// pulled straight, and the strap round the anchor.

import * as THREE from 'three/webgpu';
import type { Anchor } from './obstacles';
import { hookPoint, type Winch } from './winch';

/** Pieces the cable is drawn in. */
const SEGMENTS = 40;
const CABLE_RADIUS = 0.018;
/** Far off, the cable and the rings are drawn thicker so they stay a few pixels wide: radians. */
const MIN_CABLE_ANGLE = 0.0012;
const MIN_RING_ANGLE = 0.018;
const MAX_MARKERS = 24;
const PICKED = new THREE.Color(0xf08a24);
const OTHER = new THREE.Color(0xd8e2e6);

type HeightFn = (x: number, z: number) => number | null;

/** A ring's radius round an anchor. */
const ringRadius = (a: Anchor): number => (a.box ? 0.35 : Math.min(2, a.radius + 0.18));

export class WinchView {
  readonly group = new THREE.Group();
  private readonly cable: THREE.InstancedMesh;
  private readonly markers: THREE.InstancedMesh;
  private readonly pointer: THREE.Mesh;
  private readonly strap: THREE.Mesh;
  private readonly hook: THREE.Mesh;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly points: THREE.Vector3[] = Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3());
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private readonly attach = new THREE.Vector3();
  private time = 0;

  constructor() {
    this.group.name = 'winch';
    const steel = new THREE.MeshStandardNodeMaterial({ color: 0x2b2d2e, roughness: 0.45, metalness: 0.8 });
    this.cable = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), steel, SEGMENTS);
    this.cable.frustumCulled = false;
    this.cable.castShadow = true;
    this.cable.count = 0;

    // Rings round the choices, seen through whatever is in the way.
    const glow = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, fog: false });
    this.markers = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.045, 6, 32).rotateX(Math.PI / 2), glow, MAX_MARKERS);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 11;
    this.markers.count = 0;
    for (let i = 0; i < MAX_MARKERS; i++) this.markers.setColorAt(i, OTHER);
    // An arrow over the picked one.
    this.pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.45, 12).rotateX(Math.PI),
      new THREE.MeshBasicNodeMaterial({ color: PICKED, transparent: true, opacity: 0.95, depthTest: false, fog: false }),
    );
    this.pointer.renderOrder = 11;
    this.pointer.visible = false;

    // Round a trunk, a strap; elsewhere just the hook.
    this.strap = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 24).rotateX(Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0x8a5a1c, roughness: 0.9 }));
    this.strap.visible = false;
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), steel);
    this.hook.visible = false;
    this.group.add(this.cable, this.markers, this.pointer, this.strap, this.hook);
  }

  /**
   * Call every frame. `vehicle` is the drawn vehicle (so the cable stays on it between physics
   * steps), `at` where on it the cable leaves.
   */
  update(dt: number, winch: Winch, vehicle: THREE.Object3D, heightAt: HeightFn, eye: THREE.Vector3): void {
    this.time += dt;
    const at = winch.sim.def.attachments.find((a) => a.name === winch.sim.def.winch?.attachment)?.position;
    this.drawChoices(winch, eye);
    if (!at || winch.state === 'stowed' || winch.state === 'choosing') {
      this.cable.count = 0;
      this.strap.visible = this.hook.visible = false;
      return;
    }
    this.from.set(at[0]!, at[1]!, at[2]!);
    vehicle.localToWorld(this.from);
    this.to.set(winch.end.x, winch.end.y, winch.end.z);
    const d = this.from.distanceTo(this.to);

    // How far it hangs in the middle: a parabola as long as the cable, or nearly straight under load.
    let sag: number;
    if (winch.state === 'hooked') {
      const slack = Math.max(0, winch.length - d);
      sag = Math.max(Math.sqrt((3 * d * slack) / 8), (d * 0.02) / (1 + winch.tension / 2000));
    } else sag = d * 0.04; // shot out or wound in: nearly straight
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      const p = this.points[i]!.lerpVectors(this.from, this.to, s);
      p.y -= sag * 4 * s * (1 - s);
      // Never through the ground: slack cable lies on it.
      const g = heightAt(p.x, p.z);
      if (g !== null && p.y < g + CABLE_RADIUS + 0.02) p.y = g + CABLE_RADIUS + 0.02;
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = this.points[i]!, b = this.points[i + 1]!;
      this.dir.subVectors(b, a);
      const len = this.dir.length();
      this.q.setFromUnitVectors(this.up, len > 1e-6 ? this.dir.divideScalar(len) : this.up);
      this.attach.addVectors(a, b).multiplyScalar(0.5);
      const r = Math.max(CABLE_RADIUS, this.attach.distanceTo(eye) * MIN_CABLE_ANGLE);
      this.s.set(r, len + 0.004, r);
      this.m.compose(this.attach, this.q, this.s);
      this.cable.setMatrixAt(i, this.m);
    }
    this.cable.count = SEGMENTS;
    this.cable.instanceMatrix.needsUpdate = true;

    const anchor = winch.anchor;
    this.strap.visible = winch.state === 'hooked' && anchor !== null && !anchor.box;
    if (anchor && this.strap.visible) {
      this.strap.position.set(anchor.x, anchor.y, anchor.z);
      this.strap.scale.setScalar(anchor.radius + 0.03);
    }
    this.hook.visible = true;
    this.hook.position.copy(this.to);
  }

  private drawChoices(winch: Winch, eye: THREE.Vector3): void {
    const choices = winch.state === 'choosing' ? winch.choices : [];
    const n = Math.min(MAX_MARKERS, choices.length);
    const pulse = 1 + 0.12 * Math.sin(this.time * 6);
    for (let i = 0; i < n; i++) {
      const a = choices[i]!;
      const picked = i === winch.picked;
      // Round a trunk or rock; on a building, where the cable would meet it.
      const p = a.box ? this.attach.copy(hookPoint(a, winch.origin())) : this.attach.set(a.x, a.y, a.z);
      const far = p.distanceTo(eye);
      const r = Math.max(ringRadius(a), far * MIN_RING_ANGLE) * (picked ? pulse : 1);
      this.m.compose(p, this.q.identity(), this.s.set(r, picked ? 1.6 : 1, r));
      this.markers.setMatrixAt(i, this.m);
      this.markers.setColorAt(i, picked ? PICKED : OTHER);
      if (picked) {
        const k = Math.max(1, far * 0.06);
        this.pointer.scale.setScalar(k);
        this.pointer.position.set(p.x, p.y + 1.1 + k * (0.3 + 0.1 * Math.sin(this.time * 4)), p.z);
      }
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    this.pointer.visible = n > 0 && winch.picked < n;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
