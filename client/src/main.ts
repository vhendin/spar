import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { parseLocalTime, seasonAt, type RegionIndex, type SeasonCalendar, type RegionVectors, type ServerMessage, type VehicleDef, type Weather, type Welcome } from '@spar/shared';
import { fillCredits } from './credits';
import { Features } from './features/features';
import { FlyCamera } from './flyCamera';
import { Connection, type ConnectionState } from './net';
import { WorldPanel } from './worldPanel';
import { loadSettings, saveSettings, type Settings } from './settings';
import { SeeThrough } from './seeThrough';
import { Environment } from './sky/environment';
import { GROUND_VIEWS, GroundShading, snowLine } from './terrain/groundMaterial';
import { loadHorizon } from './terrain/horizon';
import { loadRegionIndex, loadRegionList, RegionMissingError, regionUrl } from './terrain/region';
import { Terrain } from './terrain/terrain';
import { Vegetation } from './vegetation/vegetation';
import { ChaseCamera } from './vehicle/chaseCamera';
import { driverEye } from './vehicle/body';
import { Felling } from './vehicle/felling';
import { GroundStore } from './vehicle/groundStore';
import { DriveInput } from './vehicle/input';
import { buttonName, PadControls } from './vehicle/gamepad';
import { Obstacles } from './vehicle/obstacles';
import { driveReadout } from './vehicle/overlay';
import { VehicleSim } from './vehicle/sim';
import { Spray } from './vehicle/spray';
import { Tracks } from './vehicle/tracks';
import { VehicleView } from './vehicle/view';
import { Winch, type WinchControls } from './vehicle/winch';
import { WinchView } from './vehicle/winchView';
import { Dashboard } from './ui/dashboard';
import { Menu } from './ui/menu';
import { Look, type Grade } from './sky/look';
import { Ambience } from './audio/ambience';
import { AudioOut } from './audio/output';
import { VehicleAudio, type Impact } from './audio/vehicleAudio';
import { Guide } from './ui/guide';
import { formatDistance, MapScreen, type MapState } from './ui/map';
import { Minimap } from './ui/minimap';
import { AreaMaker, areasInfo, removeArea } from './ui/areaMaker';
import { saveLastPosition, StartMenu } from './ui/startMenu';
import { StartStore } from './ui/starts';
import seasonDefs from '../../defs/seasons.json';
import { dateOfYear, formatDuration, seasonName, Trips } from './trips';

const NEUTRAL: Grade = { tint: new THREE.Vector3(1, 1, 1), saturation: 1, lift: 0 };

/** Physics runs in fixed steps of this many seconds, however fast frames are drawn. */
const STEP = 1 / 60;

const CALENDAR = seasonDefs as SeasonCalendar;
/** Plants are recoloured when the season has moved on this many days; the ground follows smoothly. */
const SEASON_STEP = 3;
const seasonStep = (day: number): number => Math.round(day / SEASON_STEP) * SEASON_STEP;
const VEHICLES = import.meta.glob<VehicleDef>('../../defs/vehicles/*.json', { eager: true, import: 'default' });

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const fatal = document.querySelector<HTMLDivElement>('#fatal')!;
const credits = document.querySelector<HTMLDivElement>('#credits')!;
const worldRoot = document.querySelector<HTMLDivElement>('#world')!;
const menuRoot = document.querySelector<HTMLDivElement>('#menu')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const hint = document.querySelector<HTMLDivElement>('#hint')!;

/** Where to put the vehicle after the world is rebuilt for new settings (kept for this tab only). */
const RESUME_KEY = 'spar.resume';
/** The vehicle last chosen in the menu. */
const VEHICLE_KEY = 'spar.vehicle';
const REGION_KEY = 'spar.region';
interface Resume {
  x: number;
  z: number;
  heading: number;
  camera: string;
}

function takeResume(): Resume | null {
  try {
    const text = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return text ? (JSON.parse(text) as Resume) : null;
  } catch {
    return null;
  }
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function showFatal(text: string): void {
  fatal.textContent = text;
  fatal.style.display = 'flex';
  hud.style.display = 'none';
  status.style.display = 'none';
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
  /** The day of the year the plants are coloured for, in SEASON_STEP steps. */
  seasonDay: number;
  features: Features | null;
  physics: RAPIER.World;
  ground: GroundStore;
  obstacles: Obstacles | null;
  sim: VehicleSim;
  view: VehicleView;
  spray: Spray;
  tracks: Tracks;
  felling: Felling;
  winch: Winch;
  winchView: WinchView;
  sound: VehicleAudio;
  map: MapScreen;
  /** Where the vehicle starts and returns to: position and heading in degrees. */
  spawn: { x: number; z: number; heading: number; name: string };
  /** Where the vehicle is set down first: the spawn, or where it was before a rebuild. */
  arrival: { x: number; z: number; heading: number; name: string };
  /** True until the vehicle has been set down on loaded ground. */
  unplaced: boolean;
  /** The start screen, unless the URL or a rebuild went straight to driving. */
  start: StartMenu;
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
  // Graphics settings from the menu (remembered on this computer); ?quality=low|medium|high
  // picks a preset for this visit. `built` is what the world was built with.
  const settings = loadSettings(params);
  const built: Settings = { ...settings };
  const resumeAt = takeResume();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));

  // World axes: X east, Y up, Z south, in metres from the region's north-west corner at sea level.
  const scene = new THREE.Scene();
  // ?shadows=0 turns sun shadows off whatever the quality.
  const shadows = settings.shadows > 0 && params.get('shadows') !== '0';
  renderer.shadowMap.enabled = shadows;

  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.5, 60000);
  const fly = new FlyCamera(camera, canvas);
  // Driving is the default; ?fly=1 or the F key hands the camera over to free flight.
  let flying = params.get('fly') === '1' || params.has('pos');
  fly.enabled = flying;
  const chase = new ChaseCamera(camera, canvas, () => !flying);
  // Trees, rocks and buildings between the camera and the vehicle turn see-through.
  const seeThrough = new SeeThrough();
  const vehicleSize = new THREE.Vector3();
  const vehicleCentre = new THREE.Vector3();
  // ?camera=orbit|cab starts in another view.
  const startView = resumeAt?.camera ?? params.get('camera');
  if (startView === 'orbit' || startView === 'cab') chase.setMode(startView);
  const gamepad = new PadControls();
  const input = new DriveInput(gamepad);
  const look = new Look(renderer, scene, camera, settings.glow > 0);
  const plain = params.get('look') === '0';
  const snowOverride = params.has('snow') && Number.isFinite(Number(params.get('snow'))) ? Number(params.get('snow')) : null;
  // Sound starts with the first key or click; ?sound=0 keeps it off for this visit.
  const audio = new AudioOut(params.get('sound') === '0' ? 0 : settings.volume);
  const ambience = new Ambience(audio);
  // The way to the destination chosen on the map.
  const guide = new Guide(document.body);
  // Trips to the destination and the logbook of arrivals.
  const trips = new Trips();
  /** Destinations on the map of the area being driven. */
  let placesToReach = 0;
  let tripFrom: { x: number; z: number } | null = null;
  guide.onArrive = () => {
    const w = world;
    // Flying there is not a trip.
    if (!w || flying || w.unplaced) {
      trips.begin(null);
      return '';
    }
    const day = w.environment.dayOfYear();
    const season = seasonAt(CALENDAR, day);
    const entry = trips.arrive({ region: w.index.name, vehicle: w.sim.def.title, date: dateOfYear(day), season: seasonName(season, day) });
    if (!entry) return ' · not logged: the vehicle was moved on the way';
    return ` · ${formatDuration(entry.seconds)} · ${formatDistance(entry.metres)} · written in the logbook`;
  };
  scene.add(guide.beacon);
  const minimap = new Minimap(document.body);

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
  // F3, or ?debug=1, shows the developer read-out and allows the developer keys
  // (F fly, B masks, K colliders, G wheels).
  let debug = params.get('debug') === '1';
  let paused = false;
  /** True while the start screen shows: the world turns slowly behind it and nothing drives. */
  let starting = false;
  /** Where the camera is in its slow turn round the valley behind the start screen. */
  let tour = 0;
  let lastSaved = 0;
  /** Seconds the vehicle has lain on its side or roof; after a moment the way back is offered. */
  let overturned = 0;
  const winchHelp = document.createElement('div');
  winchHelp.id = 'winch-help';
  document.body.append(winchHelp);
  const prompt = document.createElement('div');
  prompt.id = 'prompt';
  const PROMPTS = {
    overturned: 'Overturned · press <kbd>R</kbd> to get back on the wheels',
    drowned: 'Water in the engine · winch out with <kbd>E</kbd>; it starts again a few seconds after leaving the water',
  };
  let prompted = '';
  document.body.append(prompt);
  const startRoot = document.createElement('div');
  startRoot.id = 'start';
  document.body.append(startRoot);
  const dash = new Dashboard(document.body);
  dash.visible = false;
  let hintUntil = 0;

  const drawHud = (): void => {
    drawStatus();
    if (!debug) return;
    const info = renderer.info.render;
    const lines = [
      `${fps === null ? '–' : fps.toFixed(0)} fps · ${backend} · ${frameMs.toFixed(1)} ms CPU · ${info.drawCalls} draws · ${(info.triangles / 1e6).toFixed(2)}M triangles`,
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
          : 'click to fly · F drive · B masks · M map · F3 hide'
        : `view ${chase.mode} · J wheels · K colliders · B masks · M map · F fly · F3 hide`,
    );
    hud.textContent = lines.join('\n');
  };

  /** What players see before they can drive: connecting, loading, or what went wrong. */
  const drawStatus = (): void => {
    let text = '';
    if (link.status === 'offline') text = `No connection to the game server: ${link.reason}`;
    else if (!world) text = link.status === 'connecting' ? 'Connecting…' : `Loading ${loadingRegion ?? ''}…`;
    else if (world.unplaced && !starting) text = `Loading ${world.index.title}…`;
    status.textContent = text;
    status.style.display = text && !debug ? 'flex' : 'none';
    hud.style.display = debug ? 'block' : 'none';
  };
  drawHud();

  const setDown = (w: World, x: number, z: number, heading: number): boolean => {
    const y = w.ground.heightAt(x, z);
    if (y === null) return false;
    w.tracks.break();
    w.winch.stow();
    w.sim.place(x, y + 0.25, z, heading);
    w.view.snap();
    chase.reset();
    return true;
  };

  const enterRegion = async (welcome: Welcome): Promise<void> => {
    // Playing alone, the region is ours to choose (?region=<name>, or the last one picked);
    // the server's choice is the fallback. With others along, the host's choice will rule.
    const listed = await loadRegionList();
    const chosenRegion = params.get('region') ?? stored(REGION_KEY);
    const regionName = listed.regions.some((r) => r.name === chosenRegion) ? chosenRegion! : welcome.region;
    loadingRegion = regionName;
    drawHud();
    const index = await loadRegionIndex(regionName);
    ambience.treeline = index.masks.treeline;
    const shading = new GroundShading(index);
    shading.view.value = groundView;
    const [terrain, horizon, vectors] = await Promise.all([
      Terrain.load(index, shading, settings.terrainSplit),
      loadHorizon(index, shading),
      fetch(regionUrl(index.name, index.vectors.path)).then((r) => r.json() as Promise<RegionVectors>),
    ]);
    scene.add(terrain.group, horizon);
    placesToReach = vectors.destinations?.length ?? 0;

    // Time and weather come from the server. For a look at a particular moment, the URL can
    // freeze them here instead: ?time=2026-12-21T14:00 and ?weather=clear|cloudy|wet|overcast|rain;
    // ?aurora=0..1 sets the northern lights' strength whatever the night.
    const fixedTime = params.get('time');
    const sky: Record<string, Weather> = {
      clear: { state: 'clear', cloud: 0.15, rain: 0, wind: 0.2, windDirection: 100, wetness: 0 },
      wet: { state: 'clear', cloud: 0.3, rain: 0, wind: 0.2, windDirection: 100, wetness: 1 },
      cloudy: { state: 'clear', cloud: 0.45, rain: 0, wind: 0.25, windDirection: 100, wetness: 0 },
      overcast: { state: 'overcast', cloud: 0.9, rain: 0, wind: 0.4, windDirection: 100, wetness: 0 },
      rain: { state: 'rain', cloud: 1, rain: 0.8, wind: 0.6, windDirection: 100, wetness: 1 },
    };
    const environment = new Environment(
      scene,
      index,
      { shadows, shadowMapSize: settings.shadows, fixedUtc: fixedTime ? parseLocalTime(fixedTime, 1) : null, fixedWeather: sky[params.get('weather') ?? ''] ?? null, fixedAurora: params.has('aurora') ? Number(params.get('aurora')) : null },
      camera.far,
    );
    if (latestWorld) environment.setWorld(latestWorld, performance.now());

    // ?plants=0 leaves the ground bare, for looking at the terrain alone.
    let vegetation: Vegetation | null = null;
    if (params.get('plants') !== '0') {
      vegetation = await Vegetation.create(renderer, index, welcome.seed, settings.plantRange, settings.farTreeRange, seeThrough, seasonAt(CALENDAR, seasonStep(environment.dayOfYear())));
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
      features.rangeScale = settings.objectRange;
      scene.add(features.group);
    }

    // Vehicle: ?vehicle=<name> picks a definition, ?spawn=<name or number> a start point
    // (or ?at=x,z,heading anywhere).
    const defs = Object.values(VEHICLES);
    const def = defs.find((d) => d.name === (params.get('vehicle') ?? stored(VEHICLE_KEY))) ?? defs.find((d) => d.name === 'tgb11') ?? defs[0]!;
    // Start points placed by hand on the map come first.
    const starts = new StartStore(index.name);
    await starts.load();
    const allSpawns = [...starts.list.map((s) => ({ ...s, road: '' })), ...vectors.spawns];
    const wanted = params.get('spawn');
    // ?at=x,z,heading starts anywhere, for trying out a spot.
    const at = numbers(params, 'at', 3);
    const spawn =
      (at ? { name: 'here', x: at[0]!, z: at[1]!, heading: at[2]!, road: '' } : undefined) ??
      allSpawns.find((s) => s.name.toLowerCase() === wanted?.toLowerCase()) ??
      allSpawns[Number(wanted) || 0] ??
      allSpawns[0] ?? { name: 'the middle', x: index.size / 2, z: index.size / 2, heading: 0 };

    const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    physics.timestep = STEP;
    const ground = new GroundStore(RAPIER, physics, index);
    const sim = new VehicleSim(RAPIER, physics, def, ground);
    const view = new VehicleView(sim);
    chase.eye.set(...driverEye(def));
    const spray = new Spray();
    const tracks = new Tracks();
    scene.add(view.group, spray.group, tracks.mesh);
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
    // After a rebuild for new settings, the vehicle goes back where it was.
    const arrival = resumeAt ? { name: 'where you were', x: resumeAt.x, z: resumeAt.z, heading: resumeAt.heading } : spawn;
    // The winch hooks on to the same trees, rocks and buildings; thin trees pulled too hard go over.
    const winch = new Winch(sim, obstacles);
    winch.onGiveWay = (anchor, dx, dz) => obstacles?.fell(anchor, dx, dz);
    const winchView = new WinchView();
    scene.add(winchView.group);
    const sound = new VehicleAudio(audio);
    const map = new MapScreen(document.body, index, vectors, {
      setDestination: (d) => {
        guide.destination = d;
        trips.begin(d);
      },
      reached: () => trips.reached(index.name),
      travel: (s) => {
        const w = world;
        if (!w) return;
        // Opened from the start screen: drive off from there, as with the Drive button.
        if (starting) {
          w.map.toggle(mapState(w));
          w.start.driveFrom(s);
          return;
        }
        travel(w, s);
        toggleMap();
      },
      close: () => toggleMap(),
    }, starts);
    // The minimap needs the map's picture from the start.
    map.prepare();
    const goToRegion = (name: string): void => {
      try {
        localStorage.setItem(REGION_KEY, name);
      } catch {
        // Then only the URL carries it.
      }
      const url = new URL(location.href);
      url.searchParams.set('region', name);
      location.href = url.toString();
    };
    const areaRoot = document.createElement('div');
    areaRoot.id = 'areas';
    document.body.append(areaRoot);
    const areaMaker = new AreaMaker(
      areaRoot,
      listed.regions,
      { easting: index.origin.easting, northing: index.origin.northing, size: index.size },
      goToRegion,
      () => start.show(),
    );
    const start = new StartMenu(startRoot, index, vectors, starts, defs, def.name, listed.regions, {
      region: goToRegion,
      placeStarts: () => toggleMap(),
      newArea: () => {
        start.hide();
        void areaMaker.show();
      },
      removeArea,
      drive: (choice) => {
        const w = world;
        if (!w) return;
        const chosen = defs.find((d) => d.name === choice.vehicle);
        if (chosen) setVehicle(w, chosen);
        travel(w, { name: choice.start.name, x: choice.start.x, z: choice.start.z, heading: choice.start.heading });
        starting = false;
        start.hide();
        w.view.group.visible = true;
        chase.reset();
        drawHud();
      },
      settings: () => {
        start.hide();
        menu.showPage('settings', () => start.show());
      },
      controls: () => {
        start.hide();
        menu.showPage('controls', () => start.show());
      },
      credits: () => showCredits(true),
    });
    // Only the computer running the server may make and remove areas.
    void areasInfo().then((info) => {
      starts.editable = info?.enabled ?? false;
      start.setMaker(info?.enabled ?? false);
    });
    world = { index, terrain, shading, environment, vegetation, seasonDay: seasonStep(environment.dayOfYear()), features, physics, ground, sim, view, spray, tracks, felling, winch, winchView, sound, map, spawn, arrival, obstacles, unplaced: true, start };
    // The start screen, unless the URL asks for a particular start or a rebuild is resuming.
    const direct = resumeAt !== null || ['spawn', 'vehicle', 'fly', 'pos', 'camera'].some((k) => params.has(k)) || params.get('menu') === '0';
    if (!direct) showStart(world);

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

  // B steps through the raw mask views; ?view=n starts in one.
  const setView = (n: number): void => {
    groundView = ((n % GROUND_VIEWS.length) + GROUND_VIEWS.length) % GROUND_VIEWS.length;
    if (world) world.shading.view.value = groundView;
    drawHud();
  };

  const headingOf = (w: World): number => {
    const r = w.sim.body.rotation();
    return 180 - THREE.MathUtils.radToDeg(Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x)));
  };
  /** Rolled back onto its wheels where it lies, keeping its heading. */
  const resetVehicle = (w: World): void => {
    if (w.unplaced || w.sim.beingRighted) return;
    const p = w.sim.body.translation();
    w.winch.stow();
    w.sim.right(w.ground.heightAt(p.x, p.z) ?? p.y - 1);
    overturned = 0;
  };
  /** Straight down on its wheels where it is, at once: after swapping vehicles. */
  const setDownHere = (w: World): void => {
    const p = w.sim.body.translation();
    setDown(w, p.x, p.z, headingOf(w));
  };
  /** Swaps the vehicle for another kind, where the old one stood. */
  const setVehicle = (w: World, def: VehicleDef): void => {
    try {
      localStorage.setItem(VEHICLE_KEY, def.name);
    } catch {
      // Not remembered for next time.
    }
    if (w.sim.def === def) return;
    const p = w.sim.body.translation();
    const heading = headingOf(w);
    const visible = w.view.group.visible;
    w.view.dispose();
    w.sim.dispose();
    w.sim = new VehicleSim(RAPIER, w.physics, def, w.ground);
    w.view = new VehicleView(w.sim);
    w.view.group.visible = visible;
    scene.add(w.view.group);
    w.felling.body = w.sim.body;
    w.winch.sim = w.sim;
    w.winch.stow();
    chase.eye.set(...driverEye(def));
    w.sim.place(p.x, p.y, p.z, heading);
    w.view.snap();
    w.tracks.break();
  };
  /** The start screen, over the world turning slowly. */
  const showStart = (w: World): void => {
    starting = true;
    w.unplaced = true;
    w.winch.stow();
    w.view.group.visible = false;
    if (w.map.open) toggleMap();
    flying = false;
    fly.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    w.start.show();
    drawHud();
  };
  /** Off to another start point, which then becomes the one to go back to. */
  const travel = (w: World, s: World['spawn']): void => {
    trips.jumped();
    w.spawn = { name: s.name, x: s.x, z: s.z, heading: s.heading };
    w.arrival = w.spawn;
    // Moved there first, so the ground around it loads; set down properly once it has.
    const y = w.map.heightAt(s.x, s.z) ?? w.terrain.heightAt(s.x, s.z) ?? w.index.heights.max;
    w.sim.place(s.x, y + 1, s.z, s.heading);
    w.tracks.break();
    w.winch.stow();
    w.unplaced = true;
  };
  /** Where the vehicle is and faces, or the camera when flying. */
  const mapState = (w: World): MapState => {
    if (flying) {
      const f = camera.getWorldDirection(new THREE.Vector3());
      return { x: camera.position.x, z: camera.position.z, heading: THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)), destination: guide.destination };
    }
    const p = w.sim.body.translation();
    return { x: p.x, z: p.z, heading: headingOf(w), destination: guide.destination };
  };
  const toggleMap = (): void => {
    if (!world) return;
    if (document.pointerLockElement) document.exitPointerLock();
    // From the start screen the map takes its place for a while, then gives it back.
    const opening = !world.map.open;
    if (starting && opening) world.start.hide();
    world.map.toggle(mapState(world));
    if (starting && !opening) world.start.show();
  };
  const toStart = (w: World): void => {
    trips.jumped();
    w.unplaced = !setDown(w, w.spawn.x, w.spawn.z, w.spawn.heading);
  };

  /** Starts over with the saved settings, putting the vehicle back where it is now. */
  const rebuild = (): void => {
    const w = world;
    try {
      if (w && !w.unplaced) {
        const p = w.sim.body.translation();
        const keep: Resume = { x: p.x, z: p.z, heading: headingOf(w), camera: chase.mode };
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(keep));
      }
    } catch {
      // Without storage the vehicle starts at the spawn point instead.
    }
    // The URL's preset and vehicle would override what was just chosen.
    const next = new URLSearchParams(location.search);
    next.delete('quality');
    next.delete('vehicle');
    location.search = next.toString();
  };

  const showCredits = (on: boolean): void => {
    if (on) fillCredits(credits, world?.index ?? null);
    credits.style.display = on ? 'flex' : 'none';
  };
  credits.addEventListener('click', () => showCredits(false));

  const pause = (): void => {
    if (paused) return;
    paused = true;
    audio.paused = true;
    if (document.pointerLockElement) document.exitPointerLock();
    menu.show();
  };
  const resume = (): void => {
    paused = false;
    audio.paused = false;
    menu.hide();
    if (panel.open) panel.toggle();
    showCredits(false);
  };

  const menu = new Menu(
    menuRoot,
    {
      resume,
      mainMenu: () => {
        resume();
        if (world) showStart(world);
      },
      map: () => {
        resume();
        toggleMap();
      },
      timeAndWeather: () => {
        panel.toggle();
        if (world) panel.refresh(world.environment);
      },
      resetVehicle: () => {
        if (world) resetVehicle(world);
        resume();
      },
      toStart: () => {
        if (world) toStart(world);
        resume();
      },
      credits: () => showCredits(true),
      logbook: () => ({
        title: world?.index.title ?? '',
        entries: trips.entries.filter((e) => e.region === world?.index.name),
        places: placesToReach,
      }),
      vehicles: Object.values(VEHICLES).map((d) => ({ name: d.name, title: d.title })).sort((a, b) => a.title.localeCompare(b.title)),
      vehicle: () => world?.sim.def.name ?? '',
      chooseVehicle: (name) => {
        const w = world;
        const def = Object.values(VEHICLES).find((d) => d.name === name);
        if (!w || !def || def === w.sim.def) return;
        // Swapped where it stands, set down on its wheels.
        setVehicle(w, def);
        if (!w.unplaced) setDownHere(w);
        resume();
      },
      changed: (key) => {
        saveSettings(settings);
        switch (key) {
          case 'pixelRatio':
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
            resize();
            break;
          case 'fov':
            camera.fov = settings.fov;
            camera.updateProjectionMatrix();
            break;
          case 'terrainSplit':
            if (world) world.terrain.split = settings.terrainSplit;
            break;
          case 'glow':
            look.glow = settings.glow > 0;
            break;
          case 'volume':
            audio.volume = settings.volume;
            break;
          case 'objectRange':
            if (world?.features) world.features.rangeScale = settings.objectRange;
            break;
        }
      },
      restart: rebuild,
    },
    settings,
    built,
    gamepad,
  );

  // Switching to another tab or window pauses too.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && world) pause();
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const w = world;
    if (e.code === 'Escape') {
      // Close whatever is on top: credits, then the time and weather panel, then the menu.
      if (starting) {
        if (credits.style.display === 'flex') showCredits(false);
        else if (menu.open) menu.back();
        return;
      }
      if (credits.style.display === 'flex') showCredits(false);
      else if (w?.map.open) toggleMap();
      else if (panel.open) panel.toggle();
      else if (menu.open) {
        if (menu.back()) resume();
      } else pause();
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      debug = !debug;
      drawHud();
      drawStatus();
      return;
    }
    if (paused || starting) return;
    // The developer's keys work only while the developer read-out shows (F3).
    if (!debug && ['KeyB', 'KeyF', 'KeyK', 'KeyJ'].includes(e.code)) return;
    switch (e.code) {
      case 'KeyM':
        toggleMap();
        break;
      case 'KeyN':
        // Minimap: near, far, hidden.
        minimap.cycle();
        break;
      case 'KeyB':
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
        showCredits(credits.style.display !== 'flex');
        break;
      case 'KeyT':
        panel.toggle();
        if (w) panel.refresh(w.environment);
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
      case 'KeyJ':
        detailed = !detailed;
        break;
      case 'KeyH':
        // Lights: follow the daylight, then on, then off.
        lamps = lamps === null ? true : lamps ? false : null;
        break;
      case 'KeyG':
        if (!flying) w?.sim.toggleRange();
        break;
      case 'KeyE':
        // The winch: choose an anchor, hook on, unhook.
        if (w && !flying && !w.unplaced) w.winch.toggle();
        break;
      case 'Tab':
        if (w?.winch.state === 'choosing') w.winch.next();
        break;
      case 'KeyL':
        if (w?.winch.state === 'choosing') w.winch.cancel();
        break;
      case 'KeyR':
        // Back on its wheels where it stands; with Shift, back to the start.
        if (w && !flying) {
          if (e.shiftKey) toStart(w);
          else resetVehicle(w);
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
  /** Pushes against the vehicle body gathered over the physics steps of a frame, for its sound. */
  const impacts: Impact[] = [];
  const aim = new THREE.Vector3();
  /** What the winch keys do now, at the bottom of the screen while it is in use. */
  let winchShown = '';
  const drawWinchHelp = (w: World): void => {
    const pad = gamepad.pad !== null;
    const key = (k: string, action: Parameters<typeof gamepad.tapped>[0]): string => `<kbd>${pad ? buttonName(gamepad.bindings[action]) : k}</kbd>`;
    let html = '';
    if (!paused && !flying && !w.unplaced && !w.map.open) {
      if (w.winch.state === 'choosing') {
        html = w.winch.choices.length
          ? `Winch · ${pad ? 'right stick' : 'move the mouse'} to aim · ${key('E', 'winch')} hook on · ${pad ? '' : `<kbd>Tab</kbd> next · `}${key('L', 'winchOut')} cancel`
          : `Nothing to hook the winch to within reach ahead · ${key('L', 'winchOut')} cancel`;
      } else if (w.winch.state === 'hooked') {
        html = `Winch · hold ${key('O', 'winchIn')} to winch in · ${key('L', 'winchOut')} pay out · ${key('E', 'winch')} unhook`;
      }
    }
    if (html === winchShown) return;
    winchShown = html;
    winchHelp.innerHTML = html;
    winchHelp.style.display = html ? 'block' : 'none';
  };

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const began = now;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    // The gamepad's Start button opens and closes the menu.
    gamepad.poll();
    if (gamepad.tapped('menu') && world) {
      if (starting) {
        if (world.start.open) world.start.drive();
      } else if (paused) resume();
      else pause();
    }
    const w0 = world;
    if (w0 && !paused && !starting) {
      if (gamepad.tapped('map')) toggleMap();
      if (gamepad.tapped('minimap')) minimap.cycle();
      if (!flying && !w0.map.open) {
        if (gamepad.tapped('right')) resetVehicle(w0);
        if (gamepad.tapped('toStart')) toStart(w0);
        if (gamepad.tapped('camera')) chase.cycle();
        if (gamepad.tapped('lights')) lamps = lamps === null ? true : lamps ? false : null;
        if (gamepad.tapped('range')) w0.sim.toggleRange();
        if (gamepad.tapped('winch') && !w0.unplaced) w0.winch.toggle();
        if (gamepad.tapped('winchOut') && w0.winch.state === 'choosing') w0.winch.cancel();
        if (gamepad.tapped('locks')) {
          // All lockable axles together: lock them all, or free them all if they already are.
          const lockable = w0.sim.def.axles.map((a, i) => (a.differential === 'lockable' ? i : -1)).filter((i) => i >= 0);
          const lock = lockable.some((i) => !w0.sim.locks[i]);
          for (const i of lockable) if (w0.sim.locks[i] !== lock) w0.sim.toggleLock(i);
        }
      }
    }

    const w = world;
    if (w) {
      // While paused nothing moves: no input, no physics, no flying mud.
      const still = flying || paused || starting || w.map.open;
      const controls = still ? { throttle: 0, brake: 0, steer: 0, handbrake: false } : input.read(dt);
      const winching: WinchControls = still || w.unplaced ? { pull: false, slack: false } : input.winch();
      if (!paused) owed += dt;
      let steps = 0;
      if (starting) owed = 0;
      while (owed >= STEP && steps < 4) {
        owed -= STEP;
        steps++;
        const p = w.sim.body.translation();
        // Physics waits until the ground under the vehicle has arrived.
        if (!w.ground.update(p.x, p.z)) continue;
        if (w.unplaced) {
          w.unplaced = !setDown(w, w.arrival.x, w.arrival.z, w.arrival.heading);
          if (!w.unplaced) {
            // From now on, falling off the world means back to the spawn point.
            w.arrival = w.spawn;
            hintUntil = now + 8000;
            drawHud();
          }
        }
        w.sim.step(controls, STEP);
        w.winch.step(STEP, winching);
        w.felling.before();
        w.physics.step(w.felling.events);
        // The event queue must be emptied every step, with or without obstacles around.
        if (w.obstacles) w.obstacles.afterStep(STEP);
        else w.felling.after(STEP);
        // Pushes against the vehicle's body, sorted by what pushed, for its sound.
        for (const c of w.felling.contacts.splice(0)) {
          const mine = w.sim.chassis.has(c.a), theirs = w.sim.chassis.has(c.b);
          if (mine === theirs || impacts.length >= 32) continue;
          impacts.push({ kind: w.obstacles?.kindOf(mine ? c.b : c.a) ?? 'ground', force: c.force });
        }
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

      // The winch: what can be hooked to, picked by looking towards it; the cable.
      chase.freeLook = w.winch.state === 'choosing' && !paused && !w.map.open;
      if (w.winch.state === 'choosing') w.winch.aim(now / 1000, camera.getWorldDirection(aim));
      w.winchView.group.visible = !w.unplaced && !starting;
      w.winchView.update(dt, w.winch, w.view.group, (x, z) => w.terrain.heightAt(x, z), camera.position);
      drawWinchHelp(w);

      if (starting) {
        // A slow turn round the middle of the region, high up, while the start screen shows.
        tour += dt * 0.012;
        const mid = w.index.size / 2;
        const below = w.terrain.heightAt(mid, mid) ?? (w.index.heights.min + w.index.heights.max) / 2;
        // Sized to the area: a quarter of the way in from the edge, at a height that shows it all.
        const k = Math.min(1, w.index.size / 10240);
        const radius = mid * 0.5;
        const cx = mid + Math.cos(tour) * radius, cz = mid + Math.sin(tour) * radius;
        // High over the valley, and never into a fellside on the way round.
        camera.position.set(cx, Math.max(below + 650 * k + 60, (w.terrain.heightAt(cx, cz) ?? below) + 300 * k + 30), cz);
        camera.lookAt(mid, below + 150 * k, mid);
        w.start.setPicture(w.map.picture);
      } else if (flying) fly.update(dt);
      else chase.update(dt, w.view.group, (x, z) => w.terrain.heightAt(x, z));
      seeThrough.strength.value = flying || chase.mode === 'cab' ? 0 : 1;
      seeThrough.cab.value = !flying && !starting && chase.mode === 'cab' ? 1 : 0;
      // The vehicle's own space, from just above the ground to the roof: plants there are not drawn.
      const body = w.sim.def.body;
      w.view.group.updateMatrixWorld();
      vehicleSize.set(body.width + 0.1, body.height - 0.2, body.length + 0.1);
      vehicleCentre.set(0, 0.2 + vehicleSize.y / 2, w.sim.def.chassis.box.center[2]!);
      if (w.unplaced) vehicleCentre.y = -1e6;
      seeThrough.setVehicle(w.view.group.matrixWorld, vehicleSize, vehicleCentre);
      w.view.setInside(!flying && chase.mode === 'cab');
      seeThrough.eye.value.copy(camera.position);
      seeThrough.focus.value.copy(chase.target);
      w.terrain.update(camera.position);
      w.vegetation?.update(camera.position);
      w.features?.update(camera.position);

      // The sky sets the light, and the weather reaches into everything else.
      const env = w.environment;
      const day = env.dayOfYear(now);
      const season = seasonAt(CALENDAR, day);
      // ?snow=<metres> instead puts the lingering snow line there, with no winter snow.
      const snowDepth = snowOverride === null ? season.snow : 0;
      env.snowing = snowDepth > 0.02;
      env.update(now, dt, camera.position, flying ? camera.position : w.view.group.position);
      w.shading.wet.value = env.weather.wetness;
      w.shading.sky.value.set(env.skyColor.r, env.skyColor.g, env.skyColor.b);
      w.shading.sunColor.value.set(env.sunLight.r, env.sunLight.g, env.sunLight.b);
      w.shading.wind.value = env.weather.wind;
      w.shading.windDirection.value.copy(env.windVector);
      // ?snow=<metres> puts the snow line there instead of where the month has it.
      w.shading.snowLine.value = snowOverride ?? snowLine(env.month());
      // The ground turns with the season smoothly; the plants are recoloured every few days.
      w.shading.season.value.set(season.ground.summer, season.ground.autumn, season.ground.dormant);
      // Lake ice: what the vehicle drives on, and how it is drawn, with the holes broken in it.
      const ice = snowOverride === null ? season.ice : 0;
      w.ground.ice = ice;
      w.ground.snow = snowDepth;
      w.shading.ice.value = ice;
      if (ice <= 0) w.ground.holes.length = 0; // open water again; next winter freezes over them
      w.shading.iceHoles.forEach((v, k) => {
        const h = w.ground.holes[k];
        v.set(h?.x ?? 0, h?.z ?? 0, h?.radius ?? 0, 0);
      });
      for (const target of w.vegetation ? [w.shading, w.vegetation.shading] : [w.shading]) {
        target.snowDepth.value = snowDepth;
        target.snowReference.value = CALENDAR.snowHeight.reference;
        target.snowGain.value = CALENDAR.snowHeight.gainPerHundred;
      }
      if (seasonStep(day) !== w.seasonDay) {
        w.seasonDay = seasonStep(day);
        w.vegetation?.setSeason(seasonAt(CALENDAR, w.seasonDay));
      }
      w.ground.rain = env.weather.wetness;
      if (w.vegetation) {
        w.vegetation.shading.wind.value = env.weather.wind;
        w.vegetation.shading.windDirection.value.copy(env.windVector);
        w.vegetation.shading.impostorLight.value = env.daylight;
        if (!w.unplaced) w.vegetation.shading.trample.update(paused ? 0 : dt, w.sim, w.view.group);
      }
      // Mud, dust and water off the tyres.
      // Ruts behind the wheels, and mud on the vehicle.
      if (!w.unplaced) w.tracks.update(w.sim, env.weather.wetness, now);
      w.view.grime.update(w.unplaced || paused ? 0 : dt, w.sim, env.weather.wetness, env.weather.rain);
      w.spray.update(w.unplaced || paused ? 0 : dt, w.sim, w.view.group, camera, env.weather.wetness, (x, z) => w.terrain.heightAt(x, z));
      const braking = w.sim.drivetrain.gear > 0 ? controls.brake > 0.05 : controls.throttle > 0.05;
      w.view.setLights(lamps ?? env.dark, braking || controls.handbrake);

      // Sound: the vehicle where it is, the world where the camera is.
      const inside = !flying && !starting && chase.mode === 'cab';
      audio.inside = inside;
      audio.listen(camera);
      w.sound.update(paused ? 0 : dt, w.sim, w.view.group, w.unplaced ? 0 : w.sim.pedal, env.weather.wetness, w.obstacles?.cracks.splice(0) ?? [], impacts.splice(0), w.unplaced);
      const spec = w.sim.def.winch;
      w.sound.winch(paused ? 0 : dt, {
        drum: w.winch.drum,
        speed: spec?.speed ?? 1,
        load: w.winch.load,
        hooked: w.winch.state === 'hooked',
        working: w.winch.state === 'hooked' && (winching.pull || winching.slack),
        events: w.winch.events,
      }, w.unplaced || paused);
      ambience.update(paused ? 0 : dt, {
        sun: THREE.MathUtils.radToDeg(env.sunElevation),
        hour: env.localHour(),
        month: env.month(),
        wind: env.weather.wind,
        rain: env.weather.rain,
        ground: w.terrain.heightAt(camera.position.x, camera.position.z),
        speed: flying ? 0 : Math.abs(w.sim.speed),
        inside,
      }, camera.position);

      // The map, and the way to the destination.
      const where = mapState(w);
      // The trip's clock runs while driving: not paused, not on the map, not flying.
      if (!w.unplaced && !flying && !paused && !w.map.open && !starting) {
        trips.tick(dt, tripFrom ? Math.min(50, Math.hypot(where.x - tripFrom.x, where.z - tripFrom.z)) : 0, now);
        tripFrom = { x: where.x, z: where.z };
      } else tripFrom = null;
      if (!w.unplaced && !flying) {
        w.map.record(where.x, where.z);
        // Remembered now and then, for "Where you left off" next time.
        if (now - lastSaved > 5000) {
          lastSaved = now;
          saveLastPosition({ region: w.index.name, x: where.x, z: where.z, heading: where.heading });
        }
      }
      w.map.update(where, now);
      minimap.update(dt, w.map, where, !w.unplaced && !w.map.open);
      guide.update(now, camera, flying ? camera.position : w.view.group.position, (x, z) => w.terrain.heightAt(x, z) ?? w.map.heightAt(x, z), !w.unplaced && !w.map.open);

      // On its side or roof and not going anywhere: say how to get back on the wheels.
      const lying = !w.unplaced && !flying && !w.sim.beingRighted && w.sim.upright < 0.4 && Math.abs(w.sim.speed) < 2;
      overturned = lying && !paused ? overturned + dt : lying ? overturned : 0;
      const say = paused || w.map.open || w.unplaced || flying ? '' : overturned > 1.5 ? 'overturned' : w.sim.drowned ? 'drowned' : '';
      if (say && say !== prompted) prompt.innerHTML = PROMPTS[say];
      if (say) prompted = say;
      prompt.style.opacity = say ? '1' : '0';

      dash.visible = !flying && !w.unplaced;
      const gauge = w.winch.state === 'hooked' ? { load: w.winch.load, tension: w.winch.tension, length: w.winch.length } : null;
      if (!flying && !w.unplaced) dash.update(dt, w.sim, { lights: lamps ?? env.dark, autoLights: lamps === null, parked: controls.handbrake || w.sim.holding }, gauge);
      hint.style.opacity = now < hintUntil && !paused && winchShown === '' ? '1' : '0';
    }
    // ?look=0 draws the plain picture, without the grade and glow.
    if (plain) renderer.render(scene, camera);
    else look.render(world?.environment.grade ?? NEUTRAL);
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
