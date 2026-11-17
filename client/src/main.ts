import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { parseLocalTime, type RegionIndex, type RegionVectors, type ServerMessage, type VehicleDef, type Weather, type Welcome } from '@spar/shared';
import { fillCredits } from './credits';
import { Features } from './features/features';
import { FlyCamera } from './flyCamera';
import { Connection, type ConnectionState } from './net';
import { WorldPanel } from './worldPanel';
import { chooseQuality, nextQuality, saveQuality } from './quality';
import { SeeThrough } from './seeThrough';
import { Environment } from './sky/environment';
import { GROUND_VIEWS, GroundShading } from './terrain/groundMaterial';
import { loadHorizon } from './terrain/horizon';
import { loadRegionIndex, RegionMissingError, regionUrl } from './terrain/region';
import { Terrain } from './terrain/terrain';
import { Vegetation } from './vegetation/vegetation';
import { ChaseCamera } from './vehicle/chaseCamera';
import { driverEye } from './vehicle/body';
import { Felling } from './vehicle/felling';
import { GroundStore } from './vehicle/groundStore';
import { DriveInput } from './vehicle/input';
import { Obstacles } from './vehicle/obstacles';
import { driveReadout } from './vehicle/overlay';
import { VehicleSim } from './vehicle/sim';
import { Spray } from './vehicle/spray';
import { VehicleView } from './vehicle/view';

/** Physics runs in fixed steps of this many seconds, however fast frames are drawn. */
const STEP = 1 / 60;

const VEHICLES = import.meta.glob<VehicleDef>('../../defs/vehicles/*.json', { eager: true, import: 'default' });

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const fatal = document.querySelector<HTMLDivElement>('#fatal')!;
const credits = document.querySelector<HTMLDivElement>('#credits')!;
const worldRoot = document.querySelector<HTMLDivElement>('#world')!;

function showFatal(text: string): void {
  fatal.textContent = text;
  fatal.style.display = 'flex';
  hud.style.display = 'none';
}

function describe(state: ConnectionState, index: RegionIndex | null): string {
  switch (state.status) {
    case 'connecting':
      return 'connecting…';
    case 'online':
      return `${state.welcome.playerId} · ${index?.title ?? state.welcome.region} · seed ${state.welcome.seed}`;
    case 'offline':
      return `offline: ${state.reason}`;
  }
}

/** Reads "a,b,c" from a URL parameter as numbers, or null when absent or malformed. */
function numbers(params: URLSearchParams, key: string, count: number): number[] | null {
  const parts = params.get(key)?.split(',').map(Number);
  return parts && parts.length === count && parts.every(Number.isFinite) ? parts : null;
}

/** Everything that exists once a region is loaded. */
interface World {
  index: RegionIndex;
  terrain: Terrain;
  shading: GroundShading;
  environment: Environment;
  vegetation: Vegetation | null;
  features: Features | null;
  physics: RAPIER.World;
  ground: GroundStore;
  obstacles: Obstacles | null;
  sim: VehicleSim;
  view: VehicleView;
  spray: Spray;
  felling: Felling;
  /** Where the vehicle starts and returns to: position and heading in degrees. */
  spawn: { x: number; z: number; heading: number; name: string };
  /** True until the vehicle has been set down on loaded ground. */
  unplaced: boolean;
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: params.get('renderer') === 'webgl',
  });
  // Falls back to WebGL 2 by itself when the browser has no WebGPU.
  await Promise.all([renderer.init(), RAPIER.init()]);
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  // ?quality=low|medium|high, or P to step through them (remembered on this computer).
  const quality = chooseQuality(params);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));

  // World axes: X east, Y up, Z south, in metres from the region's north-west corner at sea level.
  const scene = new THREE.Scene();
  // ?shadows=0 turns sun shadows off whatever the quality.
  const shadows = quality.shadows && params.get('shadows') !== '0';
  renderer.shadowMap.enabled = shadows;

  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 60000);
  const fly = new FlyCamera(camera, canvas);
  // Driving is the default; ?fly=1 or the F key hands the camera over to free flight.
  let flying = params.get('fly') === '1' || params.has('pos');
  fly.enabled = flying;
  const chase = new ChaseCamera(camera, canvas, () => !flying);
  // Trees, rocks and buildings between the camera and the vehicle turn see-through.
  const seeThrough = new SeeThrough();
  // ?camera=orbit|cab starts in another view.
  const startView = params.get('camera');
  if (startView === 'orbit' || startView === 'cab') chase.setMode(startView);
  const input = new DriveInput();

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let link: ConnectionState = { status: 'connecting' };
  let connection: Connection | null = null;
  // T opens the time and weather panel; the server makes the change for everyone.
  const panel = new WorldPanel(worldRoot, (msg) => connection?.send(msg));
  let world: World | null = null;
  let loadingRegion: string | null = null;
  let fps: number | null = null;
  /** CPU time of the last frames' work, smoothed, in milliseconds. */
  let frameMs = 0;
  let latestWorld: Extract<ServerMessage, { type: 'world' }> | null = null;
  /** Headlights: null follows the daylight, true and false are the driver's choice. */
  let lamps: boolean | null = null;
  let groundView = Number(params.get('view')) || 0;
  let detailed = params.get('wheels') !== '0';

  const drawHud = (): void => {
    const info = renderer.info.render;
    const lines = [
      `${fps === null ? '–' : fps.toFixed(0)} fps · ${backend} · ${quality.name} quality (P) · ${frameMs.toFixed(1)} ms CPU · ${info.drawCalls} draws · ${(info.triangles / 1e6).toFixed(2)}M triangles`,
      describe(link, world?.index ?? null),
    ];
    if (world) {
      lines.push(world.environment.describe());
      const { terrain, vegetation, index, sim, obstacles } = world;
      const p = camera.position;
      const ground = terrain.heightAt(p.x, p.z);
      lines.push(
        `E ${(index.origin.easting + p.x).toFixed(0)} N ${(index.origin.northing - p.z).toFixed(0)} · ${p.y.toFixed(0)} m` +
          (ground === null ? '' : ` (ground ${ground.toFixed(0)} m)`) +
          (flying ? ` · speed ${fly.speed.toFixed(0)} m/s` : ''),
        `terrain ${terrain.stats.nodes} patches · ${(terrain.stats.triangles / 1000).toFixed(0)}k triangles` +
          (terrain.stats.loading ? ` · loading ${terrain.stats.loading}` : '') +
          ` · ${index.heights.source.name} ${index.heights.source.resolution} m`,
      );
      if (vegetation) {
        const v = vegetation.stats;
        lines.push(
          `plants ${(v.meshes / 1000).toFixed(1)}k meshes (${(v.full / 1000).toFixed(1)}k full) · ${(v.impostors / 1000).toFixed(0)}k far trees in ${v.tiles} tiles` +
            (v.loading ? ` · placing ${v.loading}` : '') +
            (obstacles ? ` · ${obstacles.count} solid nearby` + (obstacles.felled ? ` · ${obstacles.felled} knocked down` : '') : '') +
            (obstacles && obstacles.undrawnEver.size ? ` · ${obstacles.undrawn} NOT DRAWN (${obstacles.undrawnEver.size} so far)` : ''),
        );
      }
      if (world.features) {
        const f = world.features.stats;
        lines.push(`buildings, lines and fences: ${f.tiles} tiles · ${(f.triangles / 1000).toFixed(0)}k triangles` + (f.loading ? ` · building ${f.loading}` : ''));
      }
      if (groundView > 0) lines.push(`view: ${GROUND_VIEWS[groundView]}`);
      lines.push('', world.unplaced ? `${sim.def.title} · waiting for the ground at ${world.spawn.name}…` : `${sim.def.title} · ${driveReadout(sim, detailed)}`);
    } else if (loadingRegion) {
      lines.push(`loading ${loadingRegion}…`);
    }
    lines.push(
      '',
      flying
        ? fly.captured
          ? 'WASD move · Space/Q up/down · Shift fast · wheel speed · F drive · Esc release'
          : 'click to fly · F drive · M masks · T time and weather · C credits'
        : `W/S drive, brake and reverse · A/D steer · Space handbrake · L low range · 1 2 3 diff locks · H lights · R reset · V view (${chase.mode}) · drag to look · G wheels · K colliders · T time and weather · F fly · C credits`,
    );
    hud.textContent = lines.join('\n');
  };
  drawHud();

  const setDown = (w: World, x: number, z: number, heading: number): boolean => {
    const y = w.ground.heightAt(x, z);
    if (y === null) return false;
    w.sim.place(x, y + 0.25, z, heading);
    w.view.snap();
    chase.reset();
    return true;
  };

  const enterRegion = async (welcome: Welcome): Promise<void> => {
    loadingRegion = welcome.region;
    drawHud();
    const index = await loadRegionIndex(welcome.region);
    const shading = new GroundShading(index);
    shading.view.value = groundView;
    const [terrain, horizon, vectors] = await Promise.all([
      Terrain.load(index, shading, quality.terrainSplit),
      loadHorizon(index, shading),
      fetch(regionUrl(index.name, index.vectors.path)).then((r) => r.json() as Promise<RegionVectors>),
    ]);
    scene.add(terrain.group, horizon);

    // Time and weather come from the server. For a look at a particular moment, the URL can
    // freeze them here instead: ?time=2026-12-21T14:00 and ?weather=clear|overcast|rain.
    const fixedTime = params.get('time');
    const sky: Record<string, Weather> = {
      clear: { state: 'clear', cloud: 0.15, rain: 0, wind: 0.2, windDirection: 100, wetness: 0 },
      overcast: { state: 'overcast', cloud: 0.9, rain: 0, wind: 0.4, windDirection: 100, wetness: 0 },
      rain: { state: 'rain', cloud: 1, rain: 0.8, wind: 0.6, windDirection: 100, wetness: 1 },
    };
    const environment = new Environment(
      scene,
      index,
      { shadows, shadowMapSize: quality.shadowMapSize, fixedUtc: fixedTime ? parseLocalTime(fixedTime, 1) : null, fixedWeather: sky[params.get('weather') ?? ''] ?? null },
      camera.far,
    );
    if (latestWorld) environment.setWorld(latestWorld, performance.now());

    // ?plants=0 leaves the ground bare, for looking at the terrain alone.
    let vegetation: Vegetation | null = null;
    if (params.get('plants') !== '0') {
      vegetation = await Vegetation.create(renderer, index, welcome.seed, quality.plantRange, quality.farTreeRange, seeThrough);
      scene.add(vegetation.group);
      // ?atlas=1 stands the far-tree pictures up in front of the start position.
      if (params.get('atlas') === '1') {
        const board = vegetation.atlasBoard(40);
        board.name = 'atlas';
        scene.add(board);
      }
    }

    // ?objects=0 leaves out buildings, power lines, fences and log piles.
    let features: Features | null = null;
    if (params.get('objects') !== '0') {
      features = new Features(index, vectors, welcome.seed, seeThrough);
      features.rangeScale = quality.objectRange;
      scene.add(features.group);
    }

    // Vehicle: ?vehicle=<name> picks a definition, ?spawn=<name or number> a start point.
    const defs = Object.values(VEHICLES);
    const def = defs.find((d) => d.name === params.get('vehicle')) ?? defs.find((d) => d.name === 'tgb11') ?? defs[0]!;
    const wanted = params.get('spawn');
    const spawn =
      vectors.spawns.find((s) => s.name.toLowerCase() === wanted?.toLowerCase()) ??
      vectors.spawns[Number(wanted) || 0] ??
      vectors.spawns[0] ?? { name: 'the middle', x: index.size / 2, z: index.size / 2, heading: 0 };

    const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    physics.timestep = STEP;
    const ground = new GroundStore(RAPIER, physics, index);
    const sim = new VehicleSim(RAPIER, physics, def, ground);
    const view = new VehicleView(sim);
    chase.eye.set(...driverEye(def));
    const spray = new Spray();
    scene.add(view.group, spray.group);
    sim.place(spawn.x, (terrain.heightAt(spawn.x, spawn.z) ?? index.heights.max) + 1, spawn.z, spawn.heading);
    view.snap();

    // K, or ?colliders=1, shows the wireframes of the colliders around the vehicle.
    // Thin trunks give way when hit hard enough.
    const felling = new Felling(RAPIER, sim.body);
    const obstacles = vegetation || features ? new Obstacles(RAPIER, physics, vegetation, features, felling) : null;
    if (obstacles) {
      obstacles.debug.visible = params.get('colliders') === '1';
      scene.add(obstacles.debug);
    }
    world = { index, terrain, shading, environment, vegetation, features, physics, ground, sim, view, spray, felling, spawn, obstacles, unplaced: true };

    // The fly camera starts above the middle of the area looking north, unless the URL says
    // otherwise: ?pos=x,y,z (metres) and ?look=yaw,pitch (degrees). With ?agl=n, y is n
    // metres above the ground.
    const mid = index.size / 2;
    const pos = numbers(params, 'pos', 3) ?? [mid, (terrain.heightAt(mid, mid) ?? index.heights.max) + 250, mid];
    const agl = Number(params.get('agl'));
    if (params.has('agl') && Number.isFinite(agl)) pos[1] = (terrain.heightAt(pos[0]!, pos[2]!) ?? pos[1]!) + agl;
    const look = numbers(params, 'look', 2) ?? [0, -12];
    fly.setPose(pos[0]!, pos[1]!, pos[2]!, THREE.MathUtils.degToRad(look[0]!), THREE.MathUtils.degToRad(look[1]!));
    scene.getObjectByName('atlas')?.position.set(pos[0]!, pos[1]!, pos[2]! - 30);
  };

  // M steps through the raw mask views; ?view=n starts in one.
  const setView = (n: number): void => {
    groundView = ((n % GROUND_VIEWS.length) + GROUND_VIEWS.length) % GROUND_VIEWS.length;
    if (world) world.shading.view.value = groundView;
    drawHud();
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const w = world;
    switch (e.code) {
      case 'KeyM':
        setView(groundView + (e.shiftKey ? -1 : 1));
        break;
      case 'KeyF':
        flying = !flying;
        fly.enabled = flying;
        if (flying) fly.adopt();
        else {
          document.exitPointerLock();
          chase.reset();
        }
        break;
      case 'KeyC':
        // Credits: the data and software the world is made from.
        if (credits.style.display === 'flex') credits.style.display = 'none';
        else {
          fillCredits(credits, w?.index ?? null);
          credits.style.display = 'flex';
        }
        break;
      case 'KeyP': {
        // A new quality takes effect on a fresh start; keep the place and view.
        saveQuality(nextQuality(quality.name));
        const next = new URLSearchParams(location.search);
        next.delete('quality');
        location.search = next.toString();
        break;
      }
      case 'KeyT':
        panel.toggle();
        if (w) panel.refresh(w.environment);
        break;
      case 'Escape':
        if (panel.open) panel.toggle();
        break;
      case 'BracketLeft':
      case 'BracketRight':
        if (w) panel.nudge(w.environment, e.code === 'BracketLeft' ? -1 : 1);
        break;
      case 'KeyV':
        // Views: chase, orbit, cab.
        if (!flying) chase.cycle();
        break;
      case 'KeyK':
        if (w?.obstacles) w.obstacles.debug.visible = !w.obstacles.debug.visible;
        break;
      case 'KeyG':
        detailed = !detailed;
        break;
      case 'KeyH':
        // Lights: follow the daylight, then on, then off.
        lamps = lamps === null ? true : lamps ? false : null;
        break;
      case 'KeyL':
        if (!flying) w?.sim.toggleRange();
        break;
      case 'KeyR':
        // Back on its wheels where it stands; with Shift, back to the start.
        if (w && !flying) {
          const p = w.sim.body.translation();
          const r = w.sim.body.rotation();
          const heading = 180 - THREE.MathUtils.radToDeg(Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)));
          if (e.shiftKey) w.unplaced = !setDown(w, w.spawn.x, w.spawn.z, w.spawn.heading);
          else setDown(w, p.x, p.z, heading);
        }
        break;
      default:
        if (!flying && /^Digit[1-9]$/.test(e.code)) w?.sim.toggleLock(Number(e.code.slice(5)) - 1);
    }
    drawHud();
  });

  connection = new Connection((state) => {
    link = state;
    if (state.status === 'online' && loadingRegion === null) {
      enterRegion(state.welcome).catch((err: unknown) => {
        console.error(err);
        showFatal(
          err instanceof RegionMissingError
            ? `${err.message}\nOn the host, run:  docker compose run --rm importer build ${err.region}`
            : `Spår could not load the world: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    drawHud();
  }, (update) => {
    latestWorld = update;
    world?.environment.setWorld(update, performance.now());
  });

  let last = performance.now();
  let frames = 0;
  let fpsSince = last;
  let owed = 0;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const began = now;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    const w = world;
    if (w) {
      const controls = flying ? { throttle: 0, brake: 0, steer: 0, handbrake: false } : input.read(dt);
      owed += dt;
      let steps = 0;
      while (owed >= STEP && steps < 4) {
        owed -= STEP;
        steps++;
        const p = w.sim.body.translation();
        // Physics waits until the ground under the vehicle has arrived.
        if (!w.ground.update(p.x, p.z)) continue;
        if (w.unplaced) w.unplaced = !setDown(w, w.spawn.x, w.spawn.z, w.spawn.heading);
        w.sim.step(controls, STEP);
        w.felling.before();
        w.physics.step(w.felling.events);
        w.obstacles?.afterStep(STEP);
        w.view.capture();
        // Off the edge of the world or under it: start over.
        if (w.sim.body.translation().y < w.index.heights.min - 50) w.unplaced = true;
      }
      if (steps === 4) owed = 0; // too slow to keep up: let time slip rather than spiral
      w.view.render(w.unplaced ? 1 : owed / STEP);
      // While flying with the collider view on, colliders gather round the camera instead,
      // so they can be inspected anywhere.
      const at = flying && w.obstacles?.debug.visible ? camera.position : w.view.group.position;
      w.obstacles?.update(now / 1000, at.x, at.z);

      if (flying) fly.update(dt);
      else chase.update(dt, w.view.group, (x, z) => w.terrain.heightAt(x, z));
      seeThrough.strength.value = flying || chase.mode === 'cab' ? 0 : 1;
      w.view.setInside(!flying && chase.mode === 'cab');
      seeThrough.eye.value.copy(camera.position);
      seeThrough.focus.value.copy(chase.target);
      w.terrain.update(camera.position);
      w.vegetation?.update(camera.position);
      w.features?.update(camera.position);

      // The sky sets the light, and the weather reaches into everything else.
      const env = w.environment;
      env.update(now, dt, camera.position, flying ? camera.position : w.view.group.position);
      w.shading.wet.value = env.weather.wetness;
      w.ground.rain = env.weather.wetness;
      if (w.vegetation) {
        w.vegetation.shading.wind.value = env.weather.wind;
        w.vegetation.shading.windDirection.value.copy(env.windVector);
        w.vegetation.shading.impostorLight.value = env.daylight;
      }
      // Mud, dust and water off the tyres.
      w.spray.update(w.unplaced ? 0 : dt, w.sim, w.view.group, camera, env.weather.wetness, (x, z) => w.terrain.heightAt(x, z));
      const braking = w.sim.drivetrain.gear > 0 ? controls.brake > 0.05 : controls.throttle > 0.05;
      w.view.setLights(lamps ?? env.dark, braking || controls.handbrake);
    }
    renderer.render(scene, camera);
    frameMs += (performance.now() - began - frameMs) * 0.05;

    frames++;
    if (now - fpsSince >= 250) {
      fps = (frames * 1000) / (now - fpsSince);
      frames = 0;
      fpsSince = now;
      drawHud();
      if (w) panel.refresh(w.environment);
    }
  });
}

start().catch((err: unknown) => {
  console.error(err);
  showFatal(`Spår could not start: ${err instanceof Error ? err.message : String(err)}`);
});
