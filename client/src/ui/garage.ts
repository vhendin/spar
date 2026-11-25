// The vehicle menu: each vehicle turning slowly on a plain stage, with its figures beside it
// and bars comparing it with the others. Opens from the start screen and from the menu (Esc);
// choosing a vehicle here is the same as choosing it there.

import * as THREE from 'three/webgpu';
import type { VehicleDef } from '@spar/shared';
import { buildVehicleMeshes } from '../vehicle/body';
import { painted } from '../vehicle/view';
import { extrasText, gearsText, locksText, vehicleStats, type VehicleStats } from '../vehicle/stats';
import { describeVehicle } from './startMenu';
import { backButton, builder } from './dom';

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
/** How far out towards the picture's edges the body may reach, 1 being the edge. */
const MARGIN = 0.9;
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
    // A mid-toned stage, so light paint shows its shading as well as dark paint does.
    this.scene.background = new THREE.Color(0x9fa497);
    this.scene.fog = new THREE.Fog(0x9fa497, 12, 28);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x8f9386, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Soft fill from above, a strong warm key from one side and a cool rim from behind, so each
    // face of the body gets its own shade.
    this.scene.add(new THREE.HemisphereLight(0xe8ecf0, 0x5d5a50, 0.9));
    const rim = new THREE.DirectionalLight(0xc8d8ec, 1.4);
    rim.position.set(-6, 5, -7);
    this.scene.add(rim);
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
    sun.position.set(7, 8, 3);
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
    // Looking a little down, as close as lets every corner of the body stay in the picture
    // whichever way it has turned: tried at closer and closer distances.
    const b = this.aimed.body;
    const elevation = 0.28;
    const target = new THREE.Vector3(0, b.height * 0.45, 0);
    const corners: THREE.Vector3[] = [];
    for (let a = 0; a < 16; a++) {
      const turn = (a / 16) * Math.PI * 2, c = Math.cos(turn), sn = Math.sin(turn);
      for (const x of [-b.width / 2, b.width / 2]) for (const z of [-b.length / 2, b.length / 2]) for (const y of [0, b.height]) {
        corners.push(new THREE.Vector3(x * c + z * sn, y, -x * sn + z * c));
      }
    }
    const p = new THREE.Vector3();
    const fits = (d: number): boolean => {
      this.camera.position.set(0, target.y + d * Math.sin(elevation), d * Math.cos(elevation));
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      return corners.every((v) => {
        p.copy(v).project(this.camera);
        return Math.abs(p.x) < MARGIN && Math.abs(p.y) < MARGIN;
      });
    };
    let near = 1, far = 40;
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    fits(far);
  }

  private render(): void {
    const def = this.vehicles[this.shown]!;
    const s = this.stats.get(def.name)!;
    const all = [...this.stats.values()];
    const most = (f: (s: VehicleStats) => number): number => Math.max(...all.map(f));
    this.place(def);

    const box = this.box;
    box.replaceChildren();
    const { add, button } = builder(box);
    backButton(box, () => this.close());

    const head = add('div', '', box, 'head');
    add('h2', 'Vehicles', head);
    const tabs = add('div', '', head, 'tabs');
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
      const line = add('div', value, td, 'value');
      if (note) add('span', note, line, 'note');
      if (share !== undefined) {
        const bar = add('div', '', td, 'bar');
        add('div', '', bar, 'fill').style.width = `${Math.round(Math.max(0.02, Math.min(1, share)) * 100)}%`;
      }
    };
    const cm = (m: number): string => `${Math.round(m * 100)} cm`;
    row('Drive', `${s.wheels}×${s.driven}`);
    row('Weight', `${(s.mass / 1000).toFixed(1)} t`, s.mass / most((o) => o.mass));
    row('Power', `${Math.round(s.power / 1000)} kW`, s.power / most((o) => o.power));
    row('Torque', `${s.torque} Nm`, s.torque / most((o) => o.torque), def.drivetrain.motor === 'electric' ? 'at the motor' : undefined);
    row('Top speed', `${Math.round(s.topSpeed)} km/h`, s.topSpeed / most((o) => o.topSpeed), 'on asphalt');
    row('Climbs', s.climb >= CLIMB_FULL ? `${CLIMB_FULL}°+` : `${Math.round(s.climb)}°`, s.climb / CLIMB_FULL, 'lowest gear, if it grips');
    row('Gearbox', gearsText(def));
    row('Differentials', locksText(def));
    row('Ground clearance', s.clearance[0] === s.clearance[1] ? cm(s.clearance[0]) : `${cm(s.clearance[0])} – ${cm(s.clearance[1])}`, s.clearance[1] / most((o) => o.clearance[1]));
    row('Wading', cm(s.wading), s.wading / most((o) => o.wading), s.clearance[0] === s.clearance[1] ? undefined : 'at its highest');
    row('Ground pressure', `${Math.round(s.pressure / 1000)} kPa`, s.pressure / most((o) => o.pressure), 'lower floats better');
    row('Winch', s.winch ? `${Math.round(s.winch.pull / 1000)} kN, ${s.winch.cable} m cable` : 'None', s.winch ? s.winch.pull / most((o) => o.winch?.pull ?? 0) : undefined);
    const extras = extrasText(def);
    if (extras.length) row('Also', extras.join(' · '));

    const foot = add('div', '', box, 'foot');
    const current = def.name === this.options?.current;
    button(current ? 'Keep this one' : (this.options?.chooseLabel ?? 'Choose'), () => this.choose(), foot, 'primary');
  }
}
