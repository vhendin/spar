// The vehicle menu: each vehicle turning slowly on a plain stage, with its figures beside it
// and bars comparing it with the others. Opens from the start screen and from the menu (Esc);
// choosing a vehicle here is the same as choosing it there.

import * as THREE from 'three/webgpu';
import type { VehicleDef } from '@spar/shared';
import { buildVehicleMeshes } from '../vehicle/body';
import { painted } from '../vehicle/view';
import { extrasText, gearsText, locksText, vehicleStats, type VehicleStats } from '../vehicle/stats';
import { describeVehicle } from './startMenu';

export interface GarageOptions {
  /** The vehicle shown first: the one chosen or driven. */
  current: string;
  /** Paint, #rrggbb, or '' for each vehicle's own colours. */
  color: string;
  /** Words on the button that picks the vehicle shown. */
  chooseLabel: string;
  choose(name: string): void;
  /** Called when the garage closes without a choice (Back, Esc). */
  back(): void;
}

/** Turns a second while nobody drags, radians. */
const TURN_RATE = 0.3;
/** The steepest slope the climbing bar reaches, degrees. */
const CLIMB_FULL = 60;

export class Garage {
  private readonly root: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGPURenderer | null = null;
  private ready: Promise<void> | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 4 / 3, 0.1, 100);
  private readonly turntable = new THREE.Group();
  private model: THREE.Group | null = null;
  private readonly stats: Map<string, VehicleStats>;
  private options: GarageOptions | null = null;
  private shown = 0;
  private angle = -0.6;
  private dragging: { x: number; angle: number } | null = null;
  private last = 0;

  constructor(
    parent: HTMLElement,
    private readonly vehicles: VehicleDef[],
    private readonly forceWebGL: boolean,
  ) {
    this.stats = new Map(vehicles.map((d) => [d.name, vehicleStats(d)]));
    this.root = document.createElement('div');
    this.root.id = 'garage';
    this.box = document.createElement('div');
    this.box.className = 'box';
    this.root.append(this.box);
    parent.append(this.root);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage';
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, angle: this.angle };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.angle = this.dragging.angle + (e.clientX - this.dragging.x) * 0.01;
    });
    const drop = (): void => {
      this.dragging = null;
    };
    this.canvas.addEventListener('pointerup', drop);
    this.canvas.addEventListener('pointercancel', drop);
    // Over everything else while open: Esc goes back, the arrows step through, Enter chooses.
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') this.close();
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') this.step(-1);
      else if (e.code === 'ArrowRight' || e.code === 'ArrowDown') this.step(1);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.choose();
    }, true);
    this.buildStage();
  }

  get open(): boolean {
    return this.root.style.display === 'flex';
  }

  show(options: GarageOptions): void {
    this.options = options;
    this.shown = Math.max(0, this.vehicles.findIndex((d) => d.name === options.current));
    this.root.style.display = 'flex';
    this.render();
    void this.start();
  }

  /** Leaves without choosing. */
  close(): void {
    if (!this.open) return;
    this.hide();
    this.options?.back();
  }

  /** The gamepad's way through: a step to the next or previous vehicle. */
  step(by: number): void {
    const n = this.vehicles.length;
    this.shown = (this.shown + by + n) % n;
    this.render();
  }

  /** Picks the vehicle shown and closes. */
  choose(): void {
    const options = this.options;
    if (!options) return;
    this.hide();
    options.choose(this.vehicles[this.shown]!.name);
  }

  private hide(): void {
    this.root.style.display = 'none';
    this.renderer?.setAnimationLoop(null);
  }

  private buildStage(): void {
    this.scene.background = new THREE.Color(0xe4e2d9);
    this.scene.fog = new THREE.Fog(0xe4e2d9, 14, 30);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0xd6d2c4, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.scene.add(new THREE.HemisphereLight(0xf4f1e8, 0x8c8a7c, 1.6));
    const sun = new THREE.DirectionalLight(0xfff6e4, 2.6);
    sun.position.set(5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -5;
    s.right = s.top = 5;
    s.near = 1;
    s.far = 25;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.scene.add(this.turntable);
  }

  /** The renderer, made the first time (it needs its own GPU context), and the turning started. */
  private async start(): Promise<void> {
    if (!this.ready) {
      this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: this.forceWebGL });
      this.renderer.shadowMap.enabled = true;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.ready = this.renderer.init().then(() => undefined);
    }
    await this.ready;
    if (!this.open) return;
    this.last = performance.now();
    this.renderer!.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const r = this.renderer!;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) this.angle += TURN_RATE * dt;
    this.turntable.rotation.y = this.angle;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * r.getPixelRatio()) || this.canvas.height !== Math.round(h * r.getPixelRatio()))) {
      r.setPixelRatio(Math.min(2, window.devicePixelRatio));
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.aim();
    }
    r.render(this.scene, this.camera);
  }

  /** Puts the vehicle shown on the stage and frames it. */
  private place(def: VehicleDef): void {
    if (this.model) {
      this.model.removeFromParent();
      this.model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      });
    }
    const meshes = buildVehicleMeshes(painted(def, this.options?.color || undefined));
    const model = new THREE.Group();
    meshes.body.castShadow = meshes.body.receiveShadow = true;
    model.add(meshes.body, meshes.glass, meshes.headlights, meshes.taillights);
    const r = def.wheels.radius;
    def.axles.forEach((axle) => {
      for (const side of [1, -1]) {
        const wheel = meshes.wheel.clone();
        wheel.castShadow = true;
        wheel.rotation.order = 'YXZ';
        // The steered wheels turned a little, as if parked mid-turn.
        wheel.rotation.set(0, ((axle.steer ?? 0) * 0.5 * Math.PI) / 180, 0);
        wheel.position.set((side * axle.track) / 2, r, axle.z);
        model.add(wheel);
      }
    });
    this.model = model;
    this.turntable.add(model);
    this.aimed = def;
    this.aim();
  }

  private aimed: VehicleDef | null = null;

  private aim(): void {
    if (!this.aimed) return;
    // Far enough back for the whole length to fit as it turns, looking a little down.
    const b = this.aimed.body;
    const reach = Math.hypot(b.length, b.width) / 2;
    const fit = (reach * 0.82) / Math.tan(((this.camera.fov / 2) * Math.PI) / 180) / Math.min(1, this.camera.aspect);
    const elevation = 0.28;
    this.camera.position.set(0, b.height / 2 + fit * Math.sin(elevation), fit * Math.cos(elevation));
    this.camera.lookAt(0, b.height * 0.42, 0);
  }

  private render(): void {
    const def = this.vehicles[this.shown]!;
    const s = this.stats.get(def.name)!;
    const all = [...this.stats.values()];
    const most = (f: (s: VehicleStats) => number): number => Math.max(...all.map(f));
    this.place(def);

    const box = this.box;
    box.replaceChildren();
    const add = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = box, cls = ''): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      if (text) e.textContent = text;
      if (cls) e.className = cls;
      parent.append(e);
      return e;
    };
    const button = (text: string, onClick: () => void, parent: HTMLElement, cls = ''): HTMLButtonElement => {
      const b = add('button', text, parent, cls);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    add('h2', 'Vehicles');
    const tabs = add('div', '', box, 'tabs');
    this.vehicles.forEach((d, i) => button(d.title, () => {
      this.shown = i;
      this.render();
    }, tabs, i === this.shown ? 'on' : ''));

    const columns = add('div', '', box, 'columns');
    const left = add('div', '', columns, 'column');
    left.append(this.canvas);
    add('div', def.title, left, 'title');
    add('div', describeVehicle(def), left, 'detail');
    add('p', 'Drag to turn it. ← → for the others.', left, 'hint');

    const table = add('table', '', columns, 'stats');
    const row = (label: string, value: string, share?: number, note?: string): void => {
      const tr = add('tr', '', table);
      add('th', label, tr);
      const td = add('td', '', tr);
      add('div', value, td, 'value');
      if (share !== undefined) {
        const bar = add('div', '', td, 'bar');
        add('div', '', bar, 'fill').style.width = `${Math.round(Math.max(0.02, Math.min(1, share)) * 100)}%`;
      }
      if (note) add('div', note, td, 'note');
    };
    const cm = (m: number): string => `${Math.round(m * 100)} cm`;
    row('Drive', `${s.wheels}×${s.driven}`);
    row('Weight', `${(s.mass / 1000).toFixed(1)} t`, s.mass / most((o) => o.mass));
    row('Power', `${Math.round(s.power / 1000)} kW`, s.power / most((o) => o.power));
    row('Torque', `${s.torque} Nm`, s.torque / most((o) => o.torque), def.drivetrain.motor === 'electric' ? 'at the motor' : undefined);
    row('Top speed', `${Math.round(s.topSpeed)} km/h`, s.topSpeed / most((o) => o.topSpeed), 'on asphalt, from gearing and drag');
    row('Climbs', s.climb >= CLIMB_FULL ? `${CLIMB_FULL}°+` : `${Math.round(s.climb)}°`, s.climb / CLIMB_FULL, 'in its lowest gear, if the ground grips');
    row('Gearbox', gearsText(def));
    row('Differentials', locksText(def));
    row('Ground clearance', s.clearance[0] === s.clearance[1] ? cm(s.clearance[0]) : `${cm(s.clearance[0])} – ${cm(s.clearance[1])}`, s.clearance[1] / most((o) => o.clearance[1]));
    row('Wading', cm(s.wading), s.wading / most((o) => o.wading), s.clearance[0] === s.clearance[1] ? undefined : 'at its highest');
    row('Ground pressure', `${Math.round(s.pressure / 1000)} kPa`, s.pressure / most((o) => o.pressure), 'lower floats better on bog and snow');
    row('Winch', s.winch ? `${Math.round(s.winch.pull / 1000)} kN, ${s.winch.cable} m cable` : 'None', s.winch ? s.winch.pull / most((o) => o.winch?.pull ?? 0) : undefined);
    const extras = extrasText(def);
    if (extras.length) row('Also', extras.join(' · '));

    const foot = add('div', '', box, 'foot');
    const current = def.name === this.options?.current;
    button(current ? 'Keep this one' : (this.options?.chooseLabel ?? 'Choose'), () => this.choose(), foot, 'primary');
    button('Back', () => this.close(), foot);
  }
}
