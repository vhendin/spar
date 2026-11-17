// Finding the way to the destination chosen on the map: an arrow at the top of the screen
// pointing towards it with the distance, and a tall beacon standing on the spot, visible
// from far off and fading as you come close. Arriving says so and clears the destination.

import * as THREE from 'three/webgpu';
import { float, positionLocal, smoothstep, uniform } from 'three/tsl';
import { formatDistance, type Destination } from './map';

/** Metres from the destination that count as having arrived. */
const ARRIVED = 30;
const BEACON_HEIGHT = 260;
const KEY = 'spar.destination';

export class Guide {
  readonly beacon: THREE.Mesh;
  private readonly el: HTMLDivElement;
  private readonly arrow: HTMLSpanElement;
  private readonly text: HTMLSpanElement;
  private readonly near = uniform(1);
  private target: Destination | null = null;
  private arrivedUntil = 0;
  private readonly forward = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'guide';
    this.arrow = document.createElement('span');
    this.arrow.className = 'arrow';
    // Points up, at what is straight ahead; turned to point the way.
    this.arrow.innerHTML = '<svg viewBox="-10 -10 20 20" width="20" height="20"><path d="M0 -9.5 L7.5 -1.5 L2.6 -1.5 L2.6 9 L-2.6 9 L-2.6 -1.5 L-7.5 -1.5 Z" fill="#ff7a2e" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/></svg>';
    this.text = document.createElement('span');
    this.el.append(this.arrow, this.text);
    parent.append(this.el);

    const geometry = new THREE.CylinderGeometry(2.2, 2.2, BEACON_HEIGHT, 16, 1, true);
    geometry.translate(0, BEACON_HEIGHT / 2, 0);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    material.color = new THREE.Color(0xff7a2e);
    // Strong at the foot, gone at the top; faint when you are right next to it.
    material.opacityNode = float(1).sub(smoothstep(0, BEACON_HEIGHT, positionLocal.y)).mul(0.55).mul(this.near);
    this.beacon = new THREE.Mesh(geometry, material);
    this.beacon.name = 'beacon';
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;

    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) this.target = JSON.parse(saved) as Destination;
    } catch {
      // No storage: the destination is forgotten on a rebuild.
    }
  }

  get destination(): Destination | null {
    return this.target;
  }

  set destination(d: Destination | null) {
    this.target = d;
    this.arrivedUntil = 0;
    try {
      if (d) sessionStorage.setItem(KEY, JSON.stringify(d));
      else sessionStorage.removeItem(KEY);
    } catch {
      // Not remembered across a rebuild, which is fine.
    }
  }

  /**
   * Call every frame. `from` is the vehicle (or the camera when flying); `ground` gives the
   * height under the beacon when known.
   */
  update(now: number, camera: THREE.Camera, from: THREE.Vector3, ground: (x: number, z: number) => number | null, show: boolean): void {
    const d = this.target;
    if (!d) {
      this.beacon.visible = false;
      this.el.style.display = show && now < this.arrivedUntil ? 'flex' : 'none';
      this.arrow.style.visibility = 'hidden';
      return;
    }
    const dx = d.x - from.x, dz = d.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance < ARRIVED) {
      this.destination = null;
      this.arrivedUntil = now + 5000;
      this.text.textContent = `Arrived at ${d.name === 'Marked spot' ? 'the marked spot' : d.name}`;
      this.beacon.visible = false;
      return;
    }
    const y = ground(d.x, d.z);
    this.beacon.visible = y !== null;
    if (y !== null) this.beacon.position.set(d.x, y - 2, d.z);
    // Seen from afar it grows, so it stays a few pixels wide and tall enough to see over a ridge.
    const far = camera.position.distanceTo(this.beacon.position);
    const wide = Math.max(1, far / 450);
    this.beacon.scale.set(wide, Math.max(1, far / 2500), wide);
    this.near.value = THREE.MathUtils.smoothstep(distance, 40, 150) * 0.8 + 0.2;

    // Which way, seen from the camera: straight ahead is up.
    camera.getWorldDirection(this.forward);
    const fx = this.forward.x, fz = this.forward.z;
    const angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    this.arrow.style.visibility = 'visible';
    this.arrow.style.transform = `rotate(${angle.toFixed(3)}rad)`;
    this.text.textContent = `${d.name} · ${formatDistance(distance)}`;
    this.el.style.display = show ? 'flex' : 'none';
  }
}
