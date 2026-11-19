import './ui/theme.css';
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
import { Environment, GALE } from './sky/environment';
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
import { airTemperature, Exhaust } from './vehicle/exhaust';
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
import { saveLastPosition, StartMenu, storedProfile } from './ui/startMenu';
import { Chat } from './ui/chat';
import { Others } from './multiplayer/others';
import { takeSnapshot } from './multiplayer/track';
import { Towing } from './multiplayer/towing';
import { StartStore } from './ui/starts';
import seasonDefs from '../../defs/seasons.json';
import { dateOfYear, formatDuration, seasonName, Trips } from './trips';

const NEUTRAL: Grade = { tint: new THREE.Vector3(1, 1, 1), saturation: 1, lift: 0 };

/** Session key for a driver to join after the page loads their region, and how long to wait for them (ms). */
const JOIN_KEY = 'spar.join';
const JOIN_WAIT = 30_000;
/** Milliseconds between snapshots of our vehicle sent to the others. */
const SEND_EVERY = 50;

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
  /** The paint the view was built with, '' for the vehicle's own colours. */
  color: string;
  spray: Spray;
  exhaust: Exhaust;
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
  // A place name fading in and out over the view, like a chapter card: on setting off and on arriving.
  const chapterCard = document.getElementById('chapter')!;
  let chapterTimer = 0;
  const chapter = (name: string, line: string): void => {
    chapterCard.querySelector('.name')!.textContent = name;
    chapterCard.querySelector('.line')!.textContent = line;
    chapterCard.classList.add('show');
    window.clearTimeout(chapterTimer);
    chapterTimer = window.setTimeout(() => chapterCard.classList.remove('show'), 4200);
  };
  /** Destinations on the map of the area being driven. */
  let placesToReach = 0;
  let tripFrom: { x: number; z: number } | null = null;
  guide.onArrive = (d) => {
    const w = world;
    chapter(d.name === 'Marked spot' ? 'The marked spot' : d.name, 'Arrived');
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
  // The other drivers, and the chat with them.
  const others = new Others(scene, Object.values(VEHICLES));
  others.audio = audio;
  /** Pushes against the vehicle body gathered over the physics steps of a frame, for its sound. */
  const impacts: Impact[] = [];
  const chat = new Chat(document.body, (text) => connection?.send({ type: 'chat', text }));
  /** Goes up whenever our vehicle is put somewhere new, so the others jump it there. */
  let jumps = 0;
  /** When our last snapshot went out, and whether the others are drawing our vehicle. */
  let sentAt = 0;
  let present = false;
  // Winching each other: which browser runs which vehicle, and handing them over.
  const towing = new Towing({
    R: RAPIER,
    defs: Object.values(VEHICLES),
    others,
    send: (msg) => connection?.send(msg),
    world: () => {
      const w = world;
      return w && {
        physics: w.physics, ground: w.ground, obstacles: w.obstacles, region: w.index.name, sim: w.sim, winch: w.winch, jump: jumps,
        fell: (a, dx, dz) => w.obstacles?.fell(a, dx, dz),
      };
    },
  });

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
  /** Loads another region (the page loads again), once a world has been built. */
  let switchRegion: (name: string) => void = () => {};
  /** Region titles by name, for the player lists. */
  let regionTitles = new Map<string, string>();
  /** A driver to join once their vehicle shows up in this region, after loading it to join them. */
  let pendingJoin: { id: string; until: number } | null = (() => {
    try {
      const raw = sessionStorage.getItem(JOIN_KEY);
      sessionStorage.removeItem(JOIN_KEY);
      return raw ? (JSON.parse(raw) as { id: string; until: number }) : null;
    } catch {
      return null;
    }
  })();
  let loadingRegion: string | null = null;
  let fps: number | null = null;
  /** CPU time of the last frames' work, smoothed, in milliseconds. */
  let frameMs = 0;
  let latestWorld: Extract<ServerMessage, { type: 'world' }> | null = null;
  /** Headlights: null follows the daylight, true and false are the driver's choice. */
  let lamps: boolean | null = null;
  let groundView = Number(params.get('view')) || 0;
  let detailed = params.get('wheels') !== '0';
  const exhaustWind = new THREE.Vector2();
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
    shorted: 'Water in the electrics · winch out with <kbd>E</kbd>; the motors come back a few seconds after leaving the water',
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
        : `view ${chase.mode} · G wheels · U colliders · B masks · M map · F fly · F3 hide`,
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

  const setDown = (w: World, x0: number, z0: number, heading: number, clear = false): boolean => {
    // At a start point, not on top of another driver who set off from the same one.
    const { x, z } = clear ? others.clearSpot(x0, z0, heading) : { x: x0, z: z0 };
    const y = w.ground.heightAt(x, z);
    if (y === null) return false;
    towing.reclaim();
    w.tracks.break();
    w.winch.stow();
    jumps++;
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
    others.region = regionName;
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
    others.attach(RAPIER, physics);
    const color = storedProfile().color ?? '';
    const view = new VehicleView(sim, { color });
    chase.eye.set(...driverEye(def));
    const spray = new Spray();
    const exhaust = new Exhaust();
    const tracks = new Tracks();
    scene.add(view.group, spray.group, exhaust.group, tracks.mesh);
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
    const winch = new Winch(sim, towing.anchors(obstacles));
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
    switchRegion = goToRegion;
    regionTitles = new Map(listed.regions.map((r) => [r.name, r.title]));
    const start = new StartMenu(startRoot, index, vectors, starts, defs, def.name, listed.regions, {
      region: goToRegion,
      join: (id) => joinFriend(id),
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
        if (chosen) setVehicle(w, chosen, choice.color);
        connection?.setProfile(choice.color ? { name: choice.name, color: choice.color } : { name: choice.name });
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
    start.setPlayers(others.list());
    world = { index, terrain, shading, environment, vegetation, seasonDay: seasonStep(environment.dayOfYear()), features, physics, ground, sim, view, color, spray, exhaust, tracks, felling, winch, winchView, sound, map, spawn, arrival, obstacles, unplaced: true, start };
    // What we change in the world goes to the others in this region; what they changed is asked for.
    if (obstacles) obstacles.onFelled = (tree) => connection?.send({ type: 'felled', region: index.name, tree });
    ground.onBreak = (x, z) => connection?.send({ type: 'ice_hole', region: index.name, hole: { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 } });
    enterRoom();
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
    if (towing.following) return towing.event({ right: true });
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
  /** Swaps the vehicle for another kind or another paint, where the old one stood. */
  const setVehicle = (w: World, def: VehicleDef, color = w.color): void => {
    try {
      localStorage.setItem(VEHICLE_KEY, def.name);
    } catch {
      // Not remembered for next time.
    }
    if (w.sim.def === def && w.color === color) return;
    towing.reclaim();
    const p = w.sim.body.translation();
    const heading = headingOf(w);
    const visible = w.view.group.visible;
    w.view.dispose();
    w.sim.dispose();
    w.sim = new VehicleSim(RAPIER, w.physics, def, w.ground);
    w.view = new VehicleView(w.sim, { color });
    w.color = color;
    jumps++;
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
    towing.reclaim();
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
    towing.reclaim();
    trips.jumped();
    jumps++;
    w.spawn = { name: s.name, x: s.x, z: s.z, heading: s.heading };
    w.arrival = w.spawn;
    // Moved there first, so the ground around it loads; set down properly once it has.
    const y = w.map.heightAt(s.x, s.z) ?? w.terrain.heightAt(s.x, s.z) ?? w.index.heights.max;
    w.sim.place(s.x, y + 1, s.z, s.heading);
    w.tracks.break();
    w.winch.stow();
    w.unplaced = true;
  };
  /**
   * Sets off just behind another driver. In another region the page loads that one first and
   * joins them once their vehicle shows up there (JOIN_KEY).
   */
  const joinFriend = (id: string): void => {
    const w = world;
    const at = others.whereIs(id);
    if (!w || !at) return;
    if (at.region !== w.index.name) {
      try {
        sessionStorage.setItem(JOIN_KEY, JSON.stringify({ id, until: Date.now() + JOIN_WAIT }));
      } catch {
        return;
      }
      switchRegion(at.region);
      return;
    }
    const s = { name: `With ${at.name}`, x: at.x, z: at.z, heading: at.heading };
    if (starting) w.start.driveFrom(s);
    else {
      travel(w, s);
      if (paused) resume();
    }
  };
  /** Where the vehicle is and faces, or the camera when flying. */
  const mapState = (w: World): MapState => {
    if (flying) {
      const f = camera.getWorldDirection(new THREE.Vector3());
      return { x: camera.position.x, z: camera.position.z, heading: THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)), destination: guide.destination, others: others.markers() };
    }
    const p = w.sim.body.translation();
    return { x: p.x, z: p.z, heading: headingOf(w), destination: guide.destination, others: others.markers() };
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
    w.unplaced = !setDown(w, w.spawn.x, w.spawn.z, w.spawn.heading, true);
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
      players: () => ({ list: others.list(), region: world?.index.title ?? '', titleOf: (name) => regionTitles.get(name) ?? name }),
      join: (id) => joinFriend(id),
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

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') minimap.expand(false);
  });
  window.addEventListener('blur', () => minimap.expand(false));

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
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // A line to the others.
      e.preventDefault();
      if (document.pointerLockElement) document.exitPointerLock();
      chat.open();
      return;
    }
    // The developer's keys work only while the developer read-out shows (F3).
    if (!debug && ['KeyB', 'KeyF', 'KeyU', 'KeyG'].includes(e.code)) return;
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
      case 'KeyU':
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
        if (!flying && w) toggleRange(w);
        break;
      case 'KeyE':
        // The winch: choose an anchor, hook on, unhook.
        if (w && !flying && !w.unplaced) winchKey(w);
        break;
      case 'Tab':
        // Choosing an anchor, Tab picks the next one; otherwise it holds the minimap open large.
        if (w?.winch.state === 'choosing') w.winch.next();
        else minimap.expand(true);
        break;
      case 'KeyK':
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
        if (!flying && w && /^Digit[1-9]$/.test(e.code)) toggleLock(w, Number(e.code.slice(5)) - 1);
    }
    drawHud();
  });

  /** High and low range, diff locks and the winch key: sent on while another browser runs our vehicle. */
  const toggleRange = (w: World): void => {
    if (towing.following) towing.event({ range: true });
    else w.sim.toggleRange();
  };
  const toggleLock = (w: World, axle: number): void => {
    if (towing.following) {
      if (w.sim.def.axles[axle]?.differential === 'lockable') towing.event({ lock: axle });
    } else w.sim.toggleLock(axle);
  };
  const winchKey = (w: World): void => {
    if (towing.following) towing.winchKey(w.winch);
    else w.winch.toggle();
  };

  const playersChanged = (): void => {
    world?.start.setPlayers(others.list());
  };
  /** Tells the server which region we are in, so it sends what has changed there. */
  function enterRoom(): void {
    if (world && connection?.state.status === 'online') connection.send({ type: 'room', region: world.index.name });
  }
  connection = new Connection({
    change: (state) => {
      link = state;
      if (state.status === 'online') {
        others.me = state.welcome.playerId;
        towing.me = state.welcome.playerId;
        towing.reconnected();
        // After a reconnect the others need to see our vehicle again from scratch.
        present = false;
        enterRoom();
      }
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
    },
    world: (update) => {
      latestWorld = update;
      world?.environment.setWorld(update, performance.now());
    },
    players: (msg) => {
      others.setPlayers(msg.players);
      playersChanged();
    },
    state: (msg) => {
      if (others.receive(msg.id, msg.vehicle, performance.now(), msg.by ?? msg.id)) playersChanged();
    },
    away: (msg) => {
      others.away(msg.id);
      playersChanged();
    },
    push: (msg) => {
      // Another vehicle pushed one this browser runs; only this browser moves it. Ours is heard as a knock too.
      const w = world;
      if (!w || paused || starting || w.unplaced) return;
      if (!towing.push(msg.to, msg.impulse, msg.at)) return;
      const force = Math.hypot(...msg.impulse) / (SEND_EVERY / 1000);
      if (impacts.length < 32) impacts.push({ kind: 'object', force });
    },
    towing: (msg) => towing.onTowing(msg, performance.now()),
    drive: (msg) => towing.onDrive(msg, performance.now()),
    handover: (msg) => towing.onHandover(msg, performance.now()),
    room: (msg) => {
      // Entering a region: the trees others knocked down there and the holes in its ice.
      const w = world;
      if (!w || msg.region !== w.index.name) return;
      for (const tree of msg.felled) w.obstacles?.fellFromAfar(tree, null);
      for (const hole of msg.holes) w.ground.breakIce(hole.x, hole.z, true);
    },
    felled: (msg) => {
      const w = world;
      if (!w || msg.region !== w.index.name) return;
      w.obstacles?.fellFromAfar(msg.tree, w.terrain.heightAt(msg.tree.x, msg.tree.z) ?? null);
    },
    iceHole: (msg) => {
      const w = world;
      if (w && msg.region === w.index.name) w.ground.breakIce(msg.hole.x, msg.hole.z, true);
    },
    chat: (msg) => {
      const from = msg.from === undefined ? undefined : others.players.find((p) => p.id === msg.from);
      chat.add(msg.text, msg.from === undefined ? undefined : (msg.name ?? from?.name ?? '?'), from?.color);
      playersChanged();
    },
  }, storedProfile());

  let last = performance.now();
  let frames = 0;
  let fpsSince = last;
  let owed = 0;
  const aim = new THREE.Vector3();
  /** What the winch keys do now, at the bottom of the screen while it is in use. */
  let winchShown = '';
  const nameOf = (id: string): string => others.players.find((p) => p.id === id)?.name ?? 'another driver';
  const drawWinchHelp = (w: World): void => {
    const pad = gamepad.pad !== null;
    const key = (k: string, action: Parameters<typeof gamepad.tapped>[0]): string => `<kbd>${pad ? buttonName(gamepad.bindings[action]) : k}</kbd>`;
    let html = '';
    if (!paused && !flying && !w.unplaced && !w.map.open) {
      if (w.winch.state === 'choosing') {
        html = w.winch.choices.length
          ? `Winch · ${pad ? 'right stick' : 'move the mouse'} to aim · ${key('E', 'winch')} hook on · ${pad ? '' : `<kbd>Tab</kbd> next · `}${key('K', 'winchOut')} cancel`
          : `Nothing to hook the winch to within reach ahead · ${key('K', 'winchOut')} cancel`;
      } else if (w.winch.state === 'hooked') {
        const on = towing.hookedTo(towing.me);
        html = `Winch${on ? ` on ${nameOf(on)}` : ''} · hold ${key('I', 'winchIn')} to winch in · ${key('K', 'winchOut')} pay out · ${key('E', 'winch')} unhook`;
      } else {
        // Another driver's cable on ours.
        const by = towing.lines.find((c) => c.to === towing.me)?.from;
        if (by) html = `On ${nameOf(by)}'s winch · drive to help it along`;
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
        if (gamepad.tapped('range')) toggleRange(w0);
        if (gamepad.tapped('winch') && !w0.unplaced) winchKey(w0);
        if (gamepad.tapped('winchOut') && w0.winch.state === 'choosing') w0.winch.cancel();
        if (gamepad.tapped('locks')) {
          // All lockable axles together: lock them all, or free them all if they already are.
          const lockable = w0.sim.def.axles.map((a, i) => (a.differential === 'lockable' ? i : -1)).filter((i) => i >= 0);
          const lock = lockable.some((i) => !w0.sim.locks[i]);
          for (const i of lockable) if (w0.sim.locks[i] !== lock) toggleLock(w0, i);
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
        // Physics waits until the ground under the vehicle, and under any run here for others, has arrived.
        if (!w.ground.update(p.x, p.z, towing.places())) continue;
        if (w.unplaced) {
          w.unplaced = !setDown(w, w.arrival.x, w.arrival.z, w.arrival.heading, true);
          if (!w.unplaced) {
            if (w.arrival.name !== 'where you were') chapter(w.arrival.name, `${w.index.title} · ${w.sim.def.title}`);
            // From now on, falling off the world means back to the spawn point.
            w.arrival = w.spawn;
            hintUntil = now + 8000;
            drawHud();
          }
        }
        const stepAt = now - owed * 1000;
        // Our vehicle, unless another browser runs it (joined to theirs by a cable): then it
        // goes where that one says. Then any vehicles run here for others.
        if (towing.following) towing.follow(stepAt, STEP);
        else {
          w.sim.step(controls, STEP);
          w.winch.step(STEP, winching);
        }
        towing.step(STEP, now);
        w.felling.before();
        // The others' vehicles where they are at the end of this step.
        others.step(stepAt);
        w.physics.step(w.felling.events);
        others.gather(towing.chassis());
        towing.afterStep();
        // The event queue must be emptied every step, with or without obstacles around.
        if (w.obstacles) w.obstacles.afterStep(STEP);
        else w.felling.after(STEP);
        // Pushes against the vehicle's body, sorted by what pushed, for its sound.
        for (const c of w.felling.contacts.splice(0)) {
          const mine = w.sim.chassis.has(c.a), theirs = w.sim.chassis.has(c.b);
          if (mine === theirs || impacts.length >= 32) continue;
          const hit = mine ? c.b : c.a;
          impacts.push({ kind: others.owns(hit) ? 'object' : (w.obstacles?.kindOf(hit) ?? 'ground'), force: c.force });
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
      w.obstacles?.update(now / 1000, at.x, at.z, towing.places());
      towing.update(now);

      // The winch: what can be hooked to, picked by looking towards it; the cable.
      chase.freeLook = w.winch.state === 'choosing' && !paused && !w.map.open;
      if (w.winch.state === 'choosing') w.winch.aim(now / 1000, camera.getWorldDirection(aim));
      w.winchView.group.visible = !w.unplaced && !starting;
      w.winchView.update(dt, w.winch, w.view.group, (x, z) => w.terrain.heightAt(x, z), camera.position);
      drawWinchHelp(w);

      if (starting && pendingJoin) {
        // Loaded this region to join someone: off behind them as soon as their vehicle is known.
        if (Date.now() > pendingJoin.until) pendingJoin = null;
        else if (others.whereIs(pendingJoin.id)?.region === w.index.name) {
          const id = pendingJoin.id;
          pendingJoin = null;
          joinFriend(id);
        }
      }
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
      else chase.update(dt, w.view.group, (x, z) => w.terrain.heightAt(x, z), (from, to) => others.clearance(from, to));
      // Our vehicle sent to the others (drawn further down, once the weather is known), with
      // any pushes it gave theirs.
      camera.updateMatrixWorld();
      const onRoad = !starting && !w.unplaced;
      if (onRoad && towing.following) {
        // Another browser runs our vehicle: our controls go there, and it sends the snapshots.
        present = true;
        const unit = (x: number): number => Math.min(1, Math.max(0, x));
        towing.drive({
          throttle: unit(controls.throttle), brake: unit(controls.brake), steer: Math.min(1, Math.max(-1, controls.steer)),
          handbrake: controls.handbrake, digital: !!controls.digital, pull: winching.pull, slack: winching.slack, lights: lamps ?? w.environment.dark,
        }, now);
      } else if (onRoad && now - sentAt >= SEND_EVERY) {
        sentAt = now;
        present = true;
        for (const push of others.takePushes()) connection?.send({ type: 'push', ...push });
        connection?.send({
          type: 'state',
          vehicle: takeSnapshot(w.sim, {
            region: w.index.name,
            jump: jumps,
            t: now,
            paused,
            lights: lamps ?? w.environment.dark,
            braking: w.sim.drivetrain.gear > 0 ? controls.brake > 0.05 : controls.throttle > 0.05,
            winch: w.winch.info(),
          }),
        });
      } else if (!onRoad && present) {
        present = false;
        connection?.send({ type: 'away' });
      }
      // Snapshots of the vehicles run here for others, and their pushes.
      if (onRoad) towing.send(now, paused);
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
      w.shading.lightFrom.value.copy(env.lightFrom);
      w.shading.moonlit.value = env.moonlit ? 1 : 0;
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
      // Fumes from the pipe, carried off by the wind; white in the cold.
      exhaustWind.copy(env.windVector).multiplyScalar(env.weather.wind * GALE);
      w.exhaust.update(paused ? 0 : dt, w.sim, w.view.group, camera, !w.unplaced, Math.min(1, w.winch.tension / 80_000), exhaustWind, airTemperature(day, env.sunElevation));
      const braking = w.sim.drivetrain.gear > 0 ? controls.brake > 0.05 : controls.throttle > 0.05;
      w.view.setLights(lamps ?? env.dark, braking || controls.handbrake);
      // The other drivers, drawn where their snapshots say, with their spray, smoke and sound.
      others.update(now, paused ? 0 : dt, camera, !w.map.open, {
        wetness: env.weather.wetness,
        rain: env.weather.rain,
        wind: exhaustWind,
        celsius: airTemperature(day, env.sunElevation),
        heightAt: (x, z) => w.terrain.heightAt(x, z),
      });

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
      const say = paused || w.map.open || w.unplaced || flying ? '' : overturned > 1.5 ? 'overturned' : w.sim.drowned ? (w.sim.def.drivetrain.motor === 'electric' ? 'shorted' : 'drowned') : '';
      if (say && say !== prompted) prompt.innerHTML = PROMPTS[say];
      if (say) prompted = say;
      prompt.style.opacity = say ? '1' : '0';

      dash.visible = !flying && !w.unplaced;
      const gauge = w.winch.state === 'hooked' ? { load: w.winch.load, tension: w.winch.tension, length: w.winch.length } : null;
      if (!flying && !w.unplaced) dash.update(dt, w.sim, { lights: lamps ?? env.dark, autoLights: lamps === null, parked: controls.handbrake || (!towing.following && w.sim.holding) }, gauge);
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
