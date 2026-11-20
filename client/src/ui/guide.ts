// Finding the way to the destination chosen on the map: an arrow at the top of the screen
// pointing towards it with the distance, and a tall beacon standing on the spot, visible
// from far off and fading as you come close. Arriving says so and clears the destination.
// There are two: the driver's own (gold), and the one shared with everyone in the region
// (blue), in a line of its own under the first.

import * as THREE from 'three/webgpu';
import { float, positionLocal, smoothstep, uniform } from 'three/tsl';
import { formatDistance, type Destination } from './map';

/** Metres from the destination that count as having arrived. */
const ARRIVED = 30;
const BEACON_HEIGHT = 260;

export interface GuideStyle {
  /** The element's id, for its place on screen. */
  id: string;
  color: number;
  /** Where the destination is kept across a rebuild of the world; null not to keep it. */
  key: string | null;
  /** Before the name, as "Shared". */
  label?: string;
}

/** The driver's own destination. */
export const OWN: GuideStyle = { id: 'guide', color: 0xc9a44a, key: 'spar.destination' };
/** The destination shared with everyone in the region. */
export const SHARED: GuideStyle = { id: 'guide-shared', color: 0x4f8fd0, key: null, label: 'Shared' };

export class Guide {
  readonly beacon: THREE.Mesh;
  private readonly el: HTMLDivElement;
  private readonly arrow: HTMLSpanElement;
  private readonly text: HTMLSpanElement;
  private readonly near = uniform(1);
  private target: Destination | null = null;
  private arrivedUntil = 0;
  private readonly forward = new THREE.Vector3();
  /** Called on arriving; what it returns is added to the arrival message. */
  onArrive: ((d: Destination) => string) | null = null;
  /** Kept and arrived at, but not shown: the same place as the other guide's. */
  hidden = false;

  constructor(parent: HTMLElement, private readonly style: GuideStyle = OWN) {
    this.el = document.createElement('div');
    this.el.id = style.id;
    this.el.className = 'guide';
    const hex = `#${style.color.toString(16).padStart(6, '0')}`;
    this.arrow = document.createElement('span');
    this.arrow.className = 'arrow';
    // Points up, at what is straight ahead; turned to point the way.
    this.arrow.innerHTML = `<svg viewBox="-10 -10 20 20" width="20" height="20"><path d="M0 -9.5 L7.5 -1.5 L2.6 -1.5 L2.6 9 L-2.6 9 L-2.6 -1.5 L-7.5 -1.5 Z" fill="${hex}" stroke="#2f3b33" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
    this.text = document.createElement('span');
    this.el.append(this.arrow, this.text);
    parent.append(this.el);

    const geometry = new THREE.CylinderGeometry(2.2, 2.2, BEACON_HEIGHT, 16, 1, true);
    geometry.translate(0, BEACON_HEIGHT / 2, 0);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    material.color = new THREE.Color(style.color);
    // Strong at the foot, gone at the top; faint when you are right next to it.
    material.opacityNode = float(1).sub(smoothstep(0, BEACON_HEIGHT, positionLocal.y)).mul(0.55).mul(this.near);
    this.beacon = new THREE.Mesh(geometry, material);
    this.beacon.name = 'beacon';
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;

    try {
      const saved = style.key && sessionStorage.getItem(style.key);
      if (saved) this.target = JSON.parse(saved) as Destination;
    } catch {
      // No storage: the destination is forgotten on a rebuild.
    }
  }

  /** Whether its line shows on screen now. */
  get showing(): boolean {
    return this.el.style.display !== 'none';
  }

  /** First or second line from the top. */
  set row(row: 0 | 1) {
    this.el.style.top = row ? '90px' : '';
  }

  get destination(): Destination | null {
    return this.target;
  }

  set destination(d: Destination | null) {
    this.target = d;
    this.arrivedUntil = 0;
    const key = this.style.key;
    try {
      if (key && d) sessionStorage.setItem(key, JSON.stringify(d));
      else if (key) sessionStorage.removeItem(key);
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
      const more = this.onArrive?.(d) ?? '';
      this.arrivedUntil = this.hidden ? 0 : now + (more ? 9000 : 5000);
      this.text.textContent = `Arrived at ${d.name === 'Marked spot' ? 'the marked spot' : d.name}${more}`;
      this.beacon.visible = false;
      return;
    }
    if (this.hidden) {
      this.beacon.visible = false;
      this.el.style.display = 'none';
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
    this.text.textContent = `${this.style.label ? `${this.style.label} · ` : ''}${d.name} · ${formatDistance(distance)}`;
    this.el.style.display = show ? 'flex' : 'none';
  }
}
