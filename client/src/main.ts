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
import { Drone, type DroneControls, type Obstacle, type P3 } from './vehicle/drone';
import { DroneSound, thrustOf } from './audio/droneSound';
import { DroneView } from './vehicle/droneView';
import { Dashboard } from './ui/dashboard';
import { listNames, Menu } from './ui/menu';
import { Look, type Grade } from './sky/look';
import { Ambience } from './audio/ambience';
import { AudioOut } from './audio/output';
import { VehicleAudio, type Impact } from './audio/vehicleAudio';
import { bearing, Compass } from './ui/compass';
import { Guide, SHARED } from './ui/guide';
import { formatDistance, MapScreen, type Destination, type MapState } from './ui/map';
import { Minimap } from './ui/minimap';
import { AreaMaker, areasInfo, removeArea } from './ui/areaMaker';
import { signIn } from './account';
import { saveLastPosition, StartMenu, storedProfile } from './ui/startMenu';
import { Garage } from './ui/garage';
import { Chat } from './ui/chat';
import { Others } from './multiplayer/others';
import { takeSnapshot } from './multiplayer/track';
import { Ghosts } from './multiplayer/ghosts';
import { Towing } from './multiplayer/towing';
import { StartStore } from './ui/starts';
import seasonDefs from '../../defs/seasons.json';
import { dateOfYear, formatDuration, seasonName, TOGETHER_MS, Trips } from './trips';
import { FrameTimer, MAX_SECONDS, MODES, Recorder, saveRecording, SECTIONS, type Mode, type Summary } from './perf/recorder';
import { BENCH_ROUTE, BENCH_SECONDS, BENCH_SETUP, benchPose, showBenchResult, WARM_MAX_SECONDS, WARM_QUIET_SECONDS, type BenchPose } from './perf/bench';
import { PartsBench, placePose, showPartsResult, type Part } from './perf/parts';

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
  // ?bench=1: the benchmark route (perf/bench.ts), at its own place, time and weather unless
  // the URL says otherwise, in the free camera from the start of the route.
  // ?bench=parts holds the camera still at two places on the route and leaves out one part of
  // the picture at a time, to see what each costs (perf/parts.ts).
  const benchmark = params.has('bench');
  const partsBench = params.get('bench') === 'parts' ? new PartsBench() : null;
  if (benchmark) {
    for (const [k, v] of Object.entries(BENCH_SETUP)) if (!params.has(k)) params.set(k, v);
    const [x, z] = partsBench ? ((p) => [p.x, p.z])(placePose(0, () => 0, 0)) : BENCH_ROUTE[0]!;
    params.set('pos', `${x},0,${z}`);
    params.set('agl', '3.5');
  }
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: params.get('renderer') === 'webgl',
    // How long the GPU takes to draw, for F3 and the performance recorder (F9); ?gpu=0 turns it off.
    trackTimestamp: params.get('gpu') !== '0',
  });
  // Falls back to WebGL 2 by itself when the browser has no WebGPU. A logged-in driver's
  // kept values are in storage before anything below reads it.
  const [, , account] = await Promise.all([renderer.init(), RAPIER.init(), signIn()]);
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
  const chase = new ChaseCamera(camera, canvas, () => !flying && !drone.flown);
  // Trees, rocks and buildings between the camera and the vehicle turn see-through.
  const seeThrough = new SeeThrough();
  const vehicleSize = new THREE.Vector3();
  const vehicleCentre = new THREE.Vector3();
  // ?camera=orbit|cab starts in another view.
  const startView = resumeAt?.camera ?? params.get('camera');
  if (startView === 'orbit' || startView === 'cab') chase.setMode(startView);
  const gamepad = new PadControls();
  const input = new DriveInput(gamepad);
  // ?glowres=0.5 works the glow out at half the picture's width instead of a quarter, to compare.
  const glowRes = Number(params.get('glowres'));
  const look = new Look(renderer, scene, camera, settings.glow > 0, glowRes > 0 && glowRes <= 1 ? glowRes : undefined);
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
  /**
   * The destination shared with everyone in this region, and the id of who shared it (null:
   * this driver). It has a guide of its own beside the driver's own destination.
   */
  let shared: { destination: Destination; by: string | null } | null = null;
  const sharedGuide = new Guide(document.body, SHARED);
  const compass = new Compass(document.body);
  const compassLook = new THREE.Vector3();
  /** The other drivers' arrivals of the last minute: who, where, and when (Date.now()). */
  const arrivals: { name: string; destination: Destination; at: number }[] = [];
  const samePlace = (a: Destination, b: Destination): boolean => a.name === b.name && Math.hypot(a.x - b.x, a.z - b.z) < 1;
  /** As the protocol carries it: name, position, and kind for a place from the map data. */
  const wireDestination = (d: Destination): Destination => ({ name: d.name.slice(0, 80), x: d.x, z: d.z, ...(d.kind ? { kind: d.kind } : {}) });
  /** The shared destination this driver has already reached, so a reload does not send them there again. */
  const REACHED_KEY = 'spar.sharedReached';
  const reachedShared = (d: Destination): boolean => {
    try {
      const r = sessionStorage.getItem(REACHED_KEY);
      return !!r && samePlace(JSON.parse(r) as Destination, d);
    } catch {
      return false;
    }
  };
  /**
   * The shared destination changed (or is told again on entering the region): its guide
   * points there and its trip clock starts, unless already under way or reached.
   */
  const setShared = (next: typeof shared): boolean => {
    shared = next;
    world?.map.refresh();
    if (!next) {
      sharedGuide.destination = null;
      trips.begin(null, 'shared');
      return false;
    }
    if (reachedShared(next.destination)) {
      sharedGuide.destination = null;
      return false;
    }
    sharedGuide.destination = next.destination;
    if (!trips.going(next.destination, 'shared')) trips.begin(next.destination, 'shared');
    return true;
  };
  /** Arrived at the own or the shared destination: the logbook, and the others told. */
  const arrive = (d: Destination, kind: 'own' | 'shared'): string => {
    const w = world;
    chapter(d.name === 'Marked spot' ? 'The marked spot' : d.name, 'Arrived');
    if (kind === 'shared') {
      try {
        sessionStorage.setItem(REACHED_KEY, JSON.stringify(d));
      } catch {
        // Then a reload may guide there again.
      }
    }
    // Flying there is not a trip.
    if (!w || flying || w.unplaced) {
      trips.begin(null, kind);
      return '';
    }
    // Only arrivals the others care about: at the shared destination, or at a place from the map data.
    if (kind === 'shared' || d.kind) connection?.send({ type: 'arrived', region: w.index.name, destination: wireDestination(d) });
    const now = Date.now();
    const along = [...new Set(arrivals.filter((a) => now - a.at <= TOGETHER_MS && samePlace(a.destination, d)).map((a) => a.name))];
    const day = w.environment.dayOfYear();
    const season = seasonAt(CALENDAR, day);
    const entry = trips.arrive({ region: w.index.name, vehicle: w.sim.def.title, date: dateOfYear(day), season: seasonName(season, day), with: along }, now, kind);
    if (!entry) return ' · not logged: the vehicle was moved on the way';
    return ` · ${formatDuration(entry.seconds)} · ${formatDistance(entry.metres)}${along.length ? ` · with ${listNames(along)}` : ''} · written in the logbook`;
  };
  sharedGuide.onArrive = (d) => arrive(d, 'shared');
  // The own destination at the shared one's place is reached with it, and logged once, as shared.
  guide.onArrive = (d) => (shared && samePlace(shared.destination, d) ? (trips.begin(null), '') : arrive(d, 'own'));
  scene.add(guide.beacon, sharedGuide.beacon);
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

  /** A driver's name, by their id. */
  function playerName(id: string): string {
    return others.players.find((p) => p.id === id)?.name ?? 'another driver';
  }

  // ?ghosts=4 brings made-up drivers along behind our vehicle, for trying the game with company.
  const ghosts = params.has('ghosts') ? new Ghosts(Number(params.get('ghosts')) || 4, params.get('region') ?? stored(REGION_KEY) ?? '') : null;

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
  /** The GPU's time drawing a recent frame, smoothed, when the browser can tell. */
  let gpuSmooth: number | null = null;
  /** The latest GPU time, and whether it is new since the last frame recorded. */
  let gpuMs = 0;
  let gpuFresh = false;
  let gpuPending = false;
  let gpuWait = 0;
  let gpuWaitFresh = false;
  let gpuWaitPending = false;
  let gpuWaitSmooth: number | null = null;
  // ?fps=<n> sets the frame rate limit for this visit (0 for none).
  const fpsParam = params.get('fps');
  const capOverride = fpsParam !== null && Number.isFinite(Number(fpsParam)) ? Number(fpsParam) : null;
  const frameCap = (): number => Math.max(0, capOverride ?? settings.frameCap);
  const timer = new FrameTimer();
  const recorder = new Recorder();
  let stepsThisFrame = 0;
  let markCount = 0;
  const recBadge = document.createElement('div');
  Object.assign(recBadge.style, {
    position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: '30', display: 'none',
    font: '600 13px system-ui, sans-serif', color: '#fff', background: 'rgba(160, 20, 20, 0.85)', padding: '4px 10px', borderRadius: '12px', pointerEvents: 'none',
  });
  document.body.append(recBadge);
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
  // The vehicle menu, over the start screen or the menu.
  const garage = new Garage(document.body, Object.values(VEHICLES).sort((a, b) => a.title.localeCompare(b.title)), params.get('renderer') === 'webgl');
  const dash = new Dashboard(document.body);
  dash.visible = false;

  // The scouting drone, launched with Q from the vehicle's roof while it stands still. While it
  // is out the driving controls fly it and the picture is its camera, with the vehicle in a corner.
  const drone = new Drone();
  const droneView = new DroneView();
  droneView.group.visible = false;
  scene.add(droneView.group);
  /** The jump counter the drone went out under: the vehicle put somewhere new puts it away. */
  let droneJump = -1;
  let droneWasOut = false;
  /** Radians the drone's camera looks down; the mouse wheel and the pad's right stick tilt it. */
  let droneTilt = 0.3;
  const tiltDrone = (by: number): void => {
    droneTilt = Math.max(-0.2, Math.min(1.5, droneTilt + by));
  };
  /** Why the drone key did nothing, shown for a moment. */
  let droneNote = { text: '', until: 0 };
  const NO_DRONE: DroneControls = { forward: 0, turn: 0, climb: 0 };
  const droneSound = new DroneSound(audio);
  const droneBefore = { x: 0, y: 0, z: 0 };
  const droneNear: Obstacle[] = [];
  /** Trunks (not leaves or needles), rocks and buildings round a point, as the drone runs into them. */
  const droneSolids = (w: World) => (x: number, z: number): readonly Obstacle[] => {
    droneNear.length = 0;
    w.vegetation?.forEachSolid(x, z, 3, (_key, shape, px, py, pz, size, radiusPerHeight) => {
      if (shape === 'rock') {
        const r = radiusPerHeight * size;
        droneNear.push({ kind: 'post', x: px, z: pz, r, bottom: py - 1, top: py + 0.25 * size + r });
        return;
      }
      droneNear.push({ kind: 'post', x: px, z: pz, r: Math.max(0.07, radiusPerHeight * size), bottom: py - 1, top: py + size });
    });
    w.features?.forEachSolid(x, z, 2, (s) => droneNear.push({ kind: 'box', x: s.x, y: s.y, z: s.z, hx: s.hx, hy: s.hy, hz: s.hz, yaw: s.yaw }));
    return droneNear;
  };
  const insetCamera = new THREE.PerspectiveCamera(50, 1.6, 0.3, 4000);
  const droneReadout = document.createElement('div');
  droneReadout.id = 'drone-readout';
  const droneHelp = document.createElement('div');
  droneHelp.id = 'drone-help';
  const droneInset = document.createElement('div');
  droneInset.id = 'drone-inset';
  droneInset.innerHTML = '<span>VEHICLE</span>';
  document.body.append(droneReadout, droneHelp, droneInset);
  canvas.addEventListener('wheel', (e) => {
    if (drone.flown && !flying) tiltDrone(e.deltaY > 0 ? 0.06 : -0.06);
  }, { passive: true });
  // The mouse looks round while flying the drone: the pointer is held (on launch, or a click on
  // the picture) and moving it turns the drone and tilts its camera.
  const droneLooking = (): boolean => drone.state === 'flying' && !flying && !paused && !starting;
  const holdPointer = (): void => {
    if (document.pointerLockElement !== canvas) Promise.resolve(canvas.requestPointerLock()).catch(() => {});
  };
  canvas.addEventListener('click', () => {
    if (droneLooking()) holdPointer();
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas || !droneLooking()) return;
    drone.look(-e.movementX * 0.0022);
    tiltDrone(e.movementY * 0.0022);
  });
  const roofLocal = new THREE.Vector3();
  const roofWorld = new THREE.Vector3();
  const vehicleForward = new THREE.Vector3();
  /** Where the drone sits on the vehicle: on the roof over the cab. */
  const roofOf = (w: World): P3 => {
    const def = w.sim.def;
    roofLocal.set(0, def.body.height + 0.1, driverEye(def)[2] - 0.6);
    w.view.group.updateMatrixWorld();
    return roofWorld.copy(roofLocal).applyMatrix4(w.view.group.matrixWorld);
  };
  /** The vehicle's facing as the drone counts it: radians from +z towards +x. */
  const yawOf = (w: World): number => {
    vehicleForward.set(0, 0, 1).applyQuaternion(w.view.group.quaternion);
    return Math.atan2(vehicleForward.x, vehicleForward.z);
  };
  const droneKey = (w: World): void => {
    const why = drone.key(roofOf(w), yawOf(w), w.sim.speed);
    droneNote = { text: why ?? '', until: why ? performance.now() + 2500 : 0 };
    if (drone.state === 'flying') holdPointer();
  };
  let droneShown = '';
  /** The drone's read-out at the top and its keys at the bottom, while it is out. */
  const drawDrone = (w: World, roof: P3): void => {
    let readout = '';
    let help = '';
    const now = performance.now();
    const pad = gamepad.pad !== null;
    const key = pad ? buttonName(gamepad.bindings.drone) : 'Q';
    if (drone.state === 'home' && !paused && !starting && !flying && !w.map.open) {
      // Flying home by itself while the vehicle is driven: a short line at the top.
      const why = drone.reason === 'range' ? 'out of range · ' : drone.reason === 'battery' ? 'battery low · ' : '';
      readout = `<span class="tag-name">DRONE</span><span>${why}flying home · ${formatDistance(drone.distance(roof))} away</span>`
        + (drone.reason === 'sent' ? `<span><kbd>${key}</kbd> take it back (stopped)</span>` : '');
      if (now < droneNote.until) help = droneNote.text;
    } else if (drone.flown && !paused && !starting && !flying && !w.map.open) {
      const warn = drone.warning(roof);
      const up = drone.p.y - (w.terrain.heightAt(drone.p.x, drone.p.z) ?? drone.p.y);
      const left = Math.max(0, Math.floor(drone.battery));
      const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      readout = `<span class="tag-name">DRONE</span><span>${Math.round(up)} m up</span>`
        + `<span class="${warn === 'range' || drone.reason === 'range' ? 'warn' : ''}">${formatDistance(drone.distance(roof))} away</span>`
        + `<span class="${warn === 'battery' || drone.reason === 'battery' ? 'warn' : ''}">battery ${clock}</span>`;
      if (warn) readout += `<span class="warn">${warn === 'range' ? 'near the end of its range' : 'battery low soon'}</span>`;
      help = pad
        ? `Drone · triggers forward and back · left stick sideways and climb · right stick looks round · <kbd>${key}</kbd> back to driving`
        : `Drone · <kbd>W</kbd> <kbd>S</kbd> forward and back · <kbd>A</kbd> <kbd>D</kbd> sideways · <kbd>Space</kbd> up · <kbd>Shift</kbd> down · ${document.pointerLockElement === canvas ? 'mouse looks round' : 'click to look round with the mouse'} · <kbd>${key}</kbd> back to driving (it flies home)`;
    } else if (!paused && !starting && now < droneNote.until) help = droneNote.text;
    const html = `${readout}|${help}`;
    if (html === droneShown) return;
    droneShown = html;
    droneReadout.innerHTML = readout;
    droneReadout.style.display = readout ? 'flex' : 'none';
    droneHelp.innerHTML = help;
    droneHelp.style.display = help ? 'block' : 'none';
  };
  /** The vehicle seen from behind, small in the bottom right corner, while the drone is out. */
  const drawInset = (w: World): void => {
    const width = Math.round(Math.min(320, window.innerWidth * 0.3));
    const height = Math.round(width * 0.62);
    const margin = 16;
    const g = w.view.group;
    const yaw = yawOf(w);
    const x = g.position.x - Math.sin(yaw) * 9, z = g.position.z - Math.cos(yaw) * 9;
    const ground = w.terrain.heightAt(x, z) ?? g.position.y;
    insetCamera.position.set(x, Math.max(g.position.y + 3.5, ground + 1.5), z);
    insetCamera.lookAt(g.position.x, g.position.y + 1, g.position.z);
    insetCamera.aspect = width / height;
    insetCamera.updateProjectionMatrix();
    const left = window.innerWidth - width - margin;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    // The renderer counts from the top of the canvas.
    const top = window.innerHeight - height - margin;
    renderer.setViewport(left, top, width, height);
    renderer.setScissor(left, top, width, height);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(scene, insetCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.autoClear = autoClear;
    Object.assign(droneInset.style, { display: 'block', left: `${left}px`, bottom: `${margin}px`, width: `${width}px`, height: `${height}px` });
  };
  let hintUntil = 0;

  const drawHud = (): void => {
    drawStatus();
    if (!debug) return;
    const info = renderer.info.render;
    const lines = [
      `${fps === null ? '–' : fps.toFixed(0)} fps${frameCap() > 0 ? ` (limit ${frameCap()})` : ''} · ${backend} · ${frameMs.toFixed(1)} ms CPU` +
        (gpuWaitSmooth === null ? '' : ` · GPU ${gpuWaitSmooth.toFixed(1)} ms`) +
        (gpuSmooth === null ? '' : ` (passes ${gpuSmooth.toFixed(1)} ms)`) +
        ` · ${info.drawCalls} draws · ${(info.triangles / 1e6).toFixed(2)}M triangles`,
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
      const o = others.stats;
      if (o.drawn) lines.push(`others: ${o.drawn} drawn · ${o.heard} heard · ${o.effects} with spray, smoke and tracks`);
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
    let { x, z } = clear ? others.clearSpot(x0, z0, heading) : { x: x0, z: z0 };
    const groundAt = (gx: number, gz: number): number | null => w.ground.heightAt(gx, gz);
    if (groundAt(x, z) === null) return false;
    // Clear of rocks, trunks and buildings: the nearest free spot, back, ahead or to a side.
    if (!w.sim.fitsAt(x, z, heading, groundAt)) {
      const yaw = ((180 - heading) * Math.PI) / 180;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      found: for (const d of [1.5, 3, 4.5, 6, 8, 10]) {
        for (const [a, b] of [[-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [-1, -1], [1, 1], [1, -1]] as const) {
          const cx = x + (fx * a + fz * b) * d, cz = z + (fz * a - fx * b) * d;
          if (groundAt(cx, cz) !== null && w.sim.fitsAt(cx, cz, heading, groundAt)) {
            x = cx;
            z = cz;
            break found;
          }
        }
      }
    }
    towing.reclaim();
    w.tracks.break();
    w.winch.stow();
    jumps++;
    w.sim.setDownOn(x, z, heading, groundAt);
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
      sharing: {
        available: () => others.players.length > 1,
        shared: () => shared && { destination: shared.destination, by: shared.by === null ? null : playerName(shared.by) },
        share: (d) => {
          connection?.send({ type: 'share', region: index.name, destination: d && wireDestination(d) });
          chat.add(d ? `You shared ${d.name} with everyone here` : `You stopped sharing ${shared?.destination.name ?? 'the destination'}`);
          setShared(d ? { destination: d, by: null } : null);
        },
      },
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
      garage: (current, color, choose) => garage.show({ current, color, chooseLabel: 'Choose', choose, back: () => {} }),
    });
    // Only the computer running the server may make and remove areas.
    void areasInfo().then((info) => {
      starts.editable = info?.enabled ?? false;
      start.setMaker(info?.enabled ?? false);
    });
    start.setPlayers(others.list());
    start.setAddresses(welcome.addresses ?? []);
    start.setAccount(account?.email ?? null);
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
      return { x: camera.position.x, z: camera.position.z, heading: THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)), destination: guide.destination, shared: shared?.destination ?? null, others: others.markers() };
    }
    const p = w.sim.body.translation();
    return { x: p.x, z: p.z, heading: headingOf(w), destination: guide.destination, shared: shared?.destination ?? null, others: others.markers() };
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
    // Vehicles run here for others go to a browser that is not paused.
    connection?.send({ type: 'pause', paused: true });
    if (document.pointerLockElement) document.exitPointerLock();
    menu.show();
  };
  const resume = (): void => {
    paused = false;
    connection?.send({ type: 'pause', paused: false });
    audio.paused = false;
    menu.hide();
    if (panel.open) panel.toggle();
    showCredits(false);
  };

  /** Swaps the vehicle being driven for another, where it stands, and drives on. */
  const chooseVehicle = (name: string): void => {
    const w = world;
    const def = Object.values(VEHICLES).find((d) => d.name === name);
    // Swapped where it stands, set down on its wheels.
    if (w && def && def !== w.sim.def) {
      setVehicle(w, def);
      if (!w.unplaced) setDownHere(w);
    }
    resume();
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
      garage: () => {
        const w = world;
        if (!w) return;
        menu.hide();
        garage.show({ current: w.sim.def.name, color: w.color, chooseLabel: 'Drive this one', choose: chooseVehicle, back: () => menu.show() });
      },
      chooseVehicle: (name) => chooseVehicle(name),
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
    if (e.code === 'F9') {
      e.preventDefault();
      toggleRecording();
      return;
    }
    if (e.code === 'F8' && recorder.recording) {
      e.preventDefault();
      markCount++;
      recorder.mark(performance.now(), `mark ${markCount}`);
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
    // With the drone out the vehicle waits: no camera views, winch, gears or resetting.
    if (drone.flown && ['KeyV', 'KeyE', 'KeyX', 'KeyZ', 'KeyL', 'KeyR', 'KeyF'].includes(e.code)) return;
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
      case 'KeyX':
        if (!flying && w) crawlKey(w, e.shiftKey);
        break;
      case 'KeyZ':
        // Air suspension: a level higher; with Shift, lower.
        if (!flying && w) rideKey(w, e.shiftKey);
        break;
      case 'KeyQ':
        // The drone: launch, send home, take back.
        if (w && !flying && !w.unplaced && !w.map.open) droneKey(w);
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
  const crawlKey = (w: World, off: boolean): void => {
    if (towing.following) towing.event({ crawl: off ? 'off' : 'next' });
    else w.sim.crawlKey(off);
  };
  const rideKey = (w: World, down: boolean): void => {
    if (towing.following) towing.event({ ride: down ? 'down' : 'up' });
    else w.sim.rideKey(down);
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
        if (paused) connection?.send({ type: 'pause', paused: true });
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
      others.setPlayers(ghosts ? [...msg.players, ...ghosts.players] : msg.players);
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
      // Entering a region: the trees others knocked down there, the holes in its ice, and the
      // destination shared there.
      const w = world;
      if (!w || msg.region !== w.index.name) return;
      const before = shared;
      const next = msg.shared ? { destination: msg.shared.destination, by: msg.shared.by === towing.me ? null : msg.shared.by } : null;
      if (setShared(next) && next && !(before && samePlace(before.destination, next.destination))) {
        chat.add(`${next.by === null ? 'You' : playerName(next.by)} shared ${next.destination.name} with everyone here: it shows in blue on the map and at the top`);
      }
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
    share: (msg) => {
      const w = world;
      if (!w || msg.region !== w.index.name) return;
      const name = playerName(msg.by);
      if (msg.destination) chat.add(`${name} shared ${msg.destination.name} with everyone here: it shows in blue on the map and at the top`);
      else if (shared) chat.add(`${name} stopped sharing ${shared.destination.name}`);
      setShared(msg.destination ? { destination: msg.destination, by: msg.by } : null);
    },
    arrived: (msg) => {
      const w = world;
      if (!w || msg.region !== w.index.name) return;
      const name = playerName(msg.id);
      const now = Date.now();
      while (arrivals.length && now - arrivals[0]!.at > TOGETHER_MS) arrivals.shift();
      arrivals.push({ name, destination: msg.destination, at: now });
      // Arrived within the minute after us: together, in the logbook too.
      const together = trips.together(w.index.name, msg.destination.name, name, now);
      chat.add(`${name} arrived at ${msg.destination.name}${together ? ', a moment after you' : ''}`);
    },
    chat: (msg) => {
      const from = msg.from === undefined ? undefined : others.players.find((p) => p.id === msg.from);
      chat.add(msg.text, msg.from === undefined ? undefined : (msg.name ?? from?.name ?? '?'), from?.color);
      playersChanged();
    },
  }, storedProfile());

  /** This frame's row in the performance recording. */
  const recordFrame = (now: number, began: number): void => {
    const r = recorder.row;
    SECTIONS.forEach((section, i) => (r[section] = timer.ms[i]!));
    r.cpu = performance.now() - began;
    r.gpu = gpuFresh ? gpuMs : NaN;
    gpuFresh = false;
    r.gpuWait = gpuWaitFresh ? gpuWait : NaN;
    gpuWaitFresh = false;
    partsBench?.sample(r.gpuWait, r.cpu);
    r.steps = stepsThisFrame;
    const info = renderer.info.render;
    r.draws = info.drawCalls;
    r.triangles = info.triangles / 1000;
    r.x = camera.position.x;
    r.y = camera.position.y;
    r.z = camera.position.z;
    const w = world;
    const mode: Mode = starting ? 'start' : !w || w.unplaced ? 'loading' : paused ? 'paused' : w.map.open ? 'map' : flying ? 'flying' : drone.flown ? 'drone' : 'driving';
    r.mode = MODES.indexOf(mode);
    r.speed = w && !w.unplaced ? Math.abs(w.sim.speed) : 0;
    r.terrainLoading = w?.terrain.stats.loading ?? 0;
    r.plantsLoading = w?.vegetation?.stats.loading ?? 0;
    r.buildingsLoading = w?.features?.stats.loading ?? 0;
    r.plantMeshes = (w?.vegetation?.stats.meshes ?? 0) / 1000;
    r.farTrees = (w?.vegetation?.stats.impostors ?? 0) / 1000;
    const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    r.heap = memory ? memory.usedJSHeapSize / 1e6 : NaN;
    recorder.commit(now);
    if (recorder.elapsed(now) > MAX_SECONDS * 1000) toggleRecording();
  };
  /** F9: starts a performance recording, or stops it and saves it. */
  const toggleRecording = (label = 'drive'): void => {
    const now = performance.now();
    if (!recorder.recording) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const device = (renderer.backend as { device?: { adapterInfo?: { vendor?: string; architecture?: string; description?: string } } }).device;
      recorder.start(now, {
        label,
        region: world?.index.name ?? null,
        vehicle: world?.sim.def.name ?? null,
        backend,
        gpu: device?.adapterInfo ? { vendor: device.adapterInfo.vendor, architecture: device.adapterInfo.architecture, description: device.adapterInfo.description } : null,
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency,
        devicePixelRatio: window.devicePixelRatio,
        drawingBuffer: [size.x, size.y],
        window: [window.innerWidth, window.innerHeight],
        frameCap: frameCap(),
        settings: { ...settings },
        url: location.search,
      });
      markCount = 0;
      recBadge.textContent = '● REC 0:00 · F8 mark · F9 stop';
      recBadge.style.display = 'block';
      return;
    }
    const rec = recorder.stop();
    recBadge.style.display = 'none';
    const s = rec.summary;
    const line = `${s.seconds.toFixed(0)} s at ${s.fps.toFixed(0)} fps · ${s.cpu.mean} ms CPU` + (s.gpuWait ? ` · ${s.gpuWait.mean} ms GPU` : '') + ` a frame · slowest frames ${s.frame.p99} ms`;
    chat.add(`Recording stopped: ${line}. Saving…`);
    const bench = rec.meta.label === 'bench' || rec.meta.label === 'parts';
    saveRecording(rec)
      .then((r) => {
        const where = 'saved' in r ? `data/perf/${r.saved}` : `downloaded as ${r.downloaded}`;
        chat.add('saved' in r ? `Recording saved on the server as ${where}` : `The server would not keep it: ${where}`);
        if (bench) benchDone(s, where);
      })
      .catch((err: unknown) => {
        chat.add(`Recording not saved: ${err instanceof Error ? err.message : String(err)}`);
        if (bench) benchDone(s, 'not saved');
      });
  };
  /** The benchmark's state: loading round the start, flying the route, or done. */
  let benchPhase: 'warming' | 'running' | 'done' = benchmark ? 'warming' : 'done';
  let benchAt = 0;
  let benchQuiet = 0;
  let benchGround = 0;
  let benchLast: BenchPose | null = null;
  const benchDone = (summary: Summary, where: string): void => {
    if (partsBench) showPartsResult(partsBench.results, where);
    else showBenchResult(summary, frameCap(), where);
    // For a script driving the browser.
    (window as unknown as { sparBench?: unknown }).sparBench = { summary, where, parts: partsBench?.results };
  };
  /** What ?bench=parts leaves out now, and the things hidden for this frame's drawing. */
  let partNow: Part = 'all';
  const partHidden: THREE.Object3D[] = [];
  const sunLight = (): THREE.DirectionalLight | undefined =>
    scene.children.find((o): o is THREE.DirectionalLight => (o as THREE.DirectionalLight).isDirectionalLight === true);
  /** Switches what is left out: shadows, glow and resolution stay switched until the next part. */
  const setPart = (part: Part): void => {
    if (part === partNow) return;
    const sun = sunLight();
    if (partNow === 'shadows' && sun) sun.castShadow = shadows;
    if (partNow === 'glow') look.glow = settings.glow > 0;
    if (partNow === 'resolution') renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
    partNow = part;
    if (part === 'shadows' && sun) sun.castShadow = false;
    if (part === 'glow') look.glow = false;
    if (part === 'resolution') renderer.setPixelRatio(1);
    recorder.mark(performance.now(), `part: ${part}`);
  };
  /** Hides what the part leaves out, for this frame's drawing only (the systems set their own visibility each frame). */
  const hidePart = (): void => {
    const names: Partial<Record<Part, string[]>> = { terrain: ['terrain'], horizon: ['horizon'], buildings: ['features'], sky: ['sky', 'stars', 'clouds'] };
    for (const name of names[partNow] ?? []) {
      const o = scene.getObjectByName(name);
      if (o?.visible) partHidden.push(o);
    }
    if (partNow === 'plants' || partNow === 'farTrees') {
      for (const o of scene.getObjectByName('vegetation')?.children ?? []) {
        if (o.visible && (o.name === 'farTrees') === (partNow === 'farTrees')) partHidden.push(o);
      }
    }
    for (const o of partHidden) o.visible = false;
  };
  const showPart = (): void => {
    for (const o of partHidden) o.visible = true;
    partHidden.length = 0;
  };
  /** ?bench=parts: each place in turn, every part there, then the results. */
  const partsStep = (w: World, now: number, bench: PartsBench): void => {
    const ground = (x: number, z: number): number | null => w.terrain.heightAt(x, z);
    const loading = w.terrain.stats.loading + (w.vegetation?.stats.loading ?? 0) + (w.features?.stats.loading ?? 0) + (w.unplaced ? 1 : 0);
    const wasDone = bench.done;
    const s = bench.step(now, loading);
    if (s) {
      if (!recorder.recording) toggleRecording('parts');
      setPart(s.part);
      const p = placePose(s.place, ground, benchGround);
      const h = ground(p.x, p.z);
      if (h !== null) benchGround = h;
      benchLast = p;
      recBadge.style.display = 'block';
      recBadge.textContent = `● ${s.label}`;
    } else if (!wasDone || recorder.recording) {
      setPart('all');
      benchPhase = 'done';
      // The results go into the recording too.
      for (const r of bench.results) recorder.mark(now, `result · ${r.place} · ${r.part} · GPU ${r.gpu === null ? '–' : r.gpu.toFixed(2)} ms · CPU ${r.cpu.toFixed(2)} ms · ${r.frames} frames`);
      if (recorder.recording) toggleRecording();
    }
    if (benchLast) {
      camera.position.set(benchLast.x, benchLast.y, benchLast.z);
      camera.lookAt(benchLast.tx, benchLast.ty, benchLast.tz);
    }
  };
  /** Puts the camera where the benchmark has it, and starts and stops the recording. */
  const benchStep = (w: World, now: number): void => {
    if (partsBench) {
      partsStep(w, now, partsBench);
      return;
    }
    const ground = (x: number, z: number): number | null => w.terrain.heightAt(x, z);
    if (benchPhase === 'warming') {
      if (!benchAt) benchAt = benchQuiet = now;
      const p = benchPose(0, ground, benchGround)!;
      const h = ground(p.x, p.z);
      if (h !== null) benchGround = h;
      const loading = w.terrain.stats.loading + (w.vegetation?.stats.loading ?? 0) + (w.features?.stats.loading ?? 0) + (w.unplaced || h === null ? 1 : 0);
      if (loading > 0) benchQuiet = now;
      recBadge.style.display = 'block';
      recBadge.textContent = 'Benchmark: loading round the start…';
      benchLast = p;
      if (now - benchQuiet > WARM_QUIET_SECONDS * 1000 || now - benchAt > WARM_MAX_SECONDS * 1000) {
        benchPhase = 'running';
        benchAt = now;
        toggleRecording('bench');
      }
    } else if (benchPhase === 'running') {
      const p = benchPose((now - benchAt) / 1000, ground, benchGround);
      if (p) {
        const h = ground(p.x, p.z);
        if (h !== null) benchGround = h;
        benchLast = p;
      } else {
        benchPhase = 'done';
        if (recorder.recording) toggleRecording();
      }
    }
    // Done, it stays where the route ended.
    if (benchLast) {
      camera.position.set(benchLast.x, benchLast.y, benchLast.z);
      camera.lookAt(benchLast.tx, benchLast.ty, benchLast.tz);
    }
  };

  let last = performance.now();
  let frames = 0;
  let fpsSince = last;
  let owed = 0;
  const aim = new THREE.Vector3();
  /** What the winch keys do now, at the bottom of the screen while it is in use. */
  let winchShown = '';
  const nameOf = playerName;
  const drawWinchHelp = (w: World): void => {
    const pad = gamepad.pad !== null;
    const key = (k: string, action: Parameters<typeof gamepad.tapped>[0]): string => `<kbd>${pad ? buttonName(gamepad.bindings[action]) : k}</kbd>`;
    let html = '';
    if (!paused && !flying && !drone.flown && !w.unplaced && !w.map.open) {
      if (w.winch.state === 'choosing') {
        const picked = w.winch.pickedAnchor;
        const on = picked?.kind === 'vehicle' && picked.vehicle ? `${nameOf(picked.vehicle)}'s ${(picked.local?.[2] ?? 0) >= 0 ? 'front' : 'rear'} · ` : '';
        html = w.winch.choices.length
          ? `Winch · ${on}${pad ? 'right stick' : 'move the mouse'} to aim · ${key('E', 'winch')} hook on · ${pad ? '' : `<kbd>Tab</kbd> next · `}${key('K', 'winchOut')} cancel`
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
    // The frame rate limit: screens drawing faster are skipped (2 ms early, for the timing's
    // jitter). The menus and start screen need no more than 30.
    const cap = paused || starting ? Math.min(frameCap() || 30, 30) : frameCap();
    if (cap > 0 && now - last < 1000 / cap - 2) return;
    const began = now;
    timer.begin();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    // The gamepad's Start button opens and closes the menu.
    gamepad.poll();
    if (gamepad.tapped('menu') && garage.open) garage.choose();
    else if (gamepad.tapped('menu') && world) {
      if (starting) {
        if (world.start.open) world.start.drive();
      } else if (paused) resume();
      else pause();
    }
    const w0 = world;
    if (w0 && !paused && !starting) {
      if (gamepad.tapped('map')) toggleMap();
      if (gamepad.tapped('minimap')) minimap.cycle();
      if (!flying && !w0.map.open && !w0.unplaced && gamepad.tapped('drone')) droneKey(w0);
      if (!flying && !w0.map.open && !drone.flown) {
        if (gamepad.tapped('right')) resetVehicle(w0);
        if (gamepad.tapped('toStart')) toStart(w0);
        if (gamepad.tapped('camera')) chase.cycle();
        if (gamepad.tapped('lights')) lamps = lamps === null ? true : lamps ? false : null;
        if (gamepad.tapped('range')) toggleRange(w0);
        if (gamepad.tapped('crawl')) crawlKey(w0, false);
        if (gamepad.tapped('rideUp')) rideKey(w0, false);
        if (gamepad.tapped('rideDown')) rideKey(w0, true);
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
    timer.lap('input');
    stepsThisFrame = 0;

    const w = world;
    if (w) {
      // While paused nothing moves: no input, no physics, no flying mud.
      const still = flying || paused || starting || w.map.open;
      // With the drone out the driving controls fly it, and the vehicle waits on its handbrake.
      const controls = still ? { throttle: 0, brake: 0, steer: 0, handbrake: false } : drone.flown ? { throttle: 0, brake: 0, steer: 0, handbrake: true } : input.read(dt);
      const winching: WinchControls = still || w.unplaced ? { pull: false, slack: false } : input.winch();
      // Paused, the physics still runs while our vehicle follows another browser: it is not ours to stop.
      if (!paused || towing.following) owed += dt;
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
        if (!towing.following) w.sim.beforeWorldStep();
        // The others' vehicles where they are at the end of this step.
        others.step(stepAt);
        w.physics.step(w.felling.events);
        if (!towing.following) w.sim.afterWorldStep();
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
      stepsThisFrame = steps;
      timer.lap('physics');
      w.view.render(w.unplaced ? 1 : owed / STEP);
      // The drone: put away whenever the vehicle is put somewhere new, else flown or charging.
      if (jumps !== droneJump || starting || w.unplaced) {
        droneJump = jumps;
        drone.dock();
      }
      const roof = roofOf(w);
      const piloting = drone.flown && !flying && !w.map.open && !paused;
      Object.assign(droneBefore, drone.v);
      if (!paused) drone.step(dt, piloting ? input.drone() : NO_DRONE, roof, (x, z) => w.terrain.heightAt(x, z), droneSolids(w));
      if (piloting) tiltDrone(input.tilt() * dt * 1.2);
      // The pointer let go once the drone flies home or lands (the free camera keeps its own).
      if (!flying && document.pointerLockElement === canvas && (!droneLooking() || w.map.open)) document.exitPointerLock();
      droneView.group.visible = drone.out && !starting;
      droneView.update(paused ? 0 : dt, drone.p, drone.yaw, drone.v, true);
      // Back on the roof: the driving camera picks up where the vehicle is.
      if (droneWasOut && !drone.flown) chase.reset();
      droneWasOut = drone.flown;
      drawDrone(w, roof);
      // While flying with the collider view on, colliders gather round the camera instead,
      // so they can be inspected anywhere.
      const at = flying && w.obstacles?.debug.visible ? camera.position : w.view.group.position;
      timer.lap('vehicle');
      w.obstacles?.update(now / 1000, at.x, at.z, towing.places());
      timer.lap('solids');
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
      } else if (benchmark) benchStep(w, now);
      else if (flying) fly.update(dt);
      else if (drone.flown) {
        // The drone's camera, under its nose, turned with it and tilted down.
        camera.position.set(drone.p.x, drone.p.y - 0.1, drone.p.z);
        camera.rotation.set(-droneTilt, drone.yaw + Math.PI, 0, 'YXZ');
      } else chase.update(dt, w.view.group, (x, z) => w.terrain.heightAt(x, z), (from, to) => others.clearance(from, to));
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
        const snapshot = takeSnapshot(w.sim, {
          region: w.index.name,
          jump: jumps,
          t: now,
          paused,
          lights: lamps ?? w.environment.dark,
          braking: w.sim.drivetrain.gear > 0 ? controls.brake > 0.05 : controls.throttle > 0.05,
          winch: w.winch.info(),
        });
        if (drone.out) {
          const r = (x: number): number => Math.round(x * 100) / 100;
          snapshot.drone = [r(drone.p.x), r(drone.p.y), r(drone.p.z), r(drone.yaw)];
        }
        connection?.send({ type: 'state', vehicle: snapshot });
        if (ghosts) for (const g of ghosts.follow(snapshot, now)) others.receive(g.id, g.snapshot, now);
      } else if (!onRoad && present) {
        present = false;
        connection?.send({ type: 'away' });
      }
      // Snapshots of the vehicles run here for others, and their pushes.
      if (onRoad) towing.send(now, paused);
      // From the drone's camera the vehicle is seen from outside, and nothing turns see-through.
      const cab = !flying && !drone.flown && !starting && chase.mode === 'cab';
      seeThrough.strength.value = flying || drone.flown || chase.mode === 'cab' ? 0 : 1;
      seeThrough.cab.value = cab ? 1 : 0;
      // The vehicle's own space, from just above the ground to the roof: plants there are not drawn.
      const body = w.sim.def.body;
      w.view.group.updateMatrixWorld();
      vehicleSize.set(body.width + 0.1, body.height - 0.2, body.length + 0.1);
      vehicleCentre.set(0, 0.2 + vehicleSize.y / 2, w.sim.def.chassis.box.center[2]!);
      if (w.unplaced) vehicleCentre.y = -1e6;
      seeThrough.setVehicle(w.view.group.matrixWorld, vehicleSize, vehicleCentre);
      w.view.setInside(cab);
      seeThrough.eye.value.copy(camera.position);
      seeThrough.focus.value.copy(chase.target);
      timer.lap('misc');
      w.terrain.update(camera.position);
      timer.lap('terrain');
      w.vegetation?.update(camera.position);
      timer.lap('plants');
      w.features?.update(camera.position);
      timer.lap('buildings');

      // The sky sets the light, and the weather reaches into everything else.
      const env = w.environment;
      const day = env.dayOfYear(now);
      const season = seasonAt(CALENDAR, day);
      // ?snow=<metres> instead puts the lingering snow line there, with no winter snow.
      const snowDepth = snowOverride === null ? season.snow : 0;
      env.snowing = snowDepth > 0.02;
      env.update(now, dt, camera.position, flying || drone.flown ? camera.position : w.view.group.position);
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
      timer.lap('sky');
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
      timer.lap('effects');

      // Sound: the vehicle where it is, the world where the camera is.
      const inside = cab;
      audio.inside = inside;
      audio.listen(camera);
      // The drone's rotors, softer heard from its own camera.
      droneSound.update(drone.out && !starting, drone.p.x, drone.p.y, drone.p.z, thrustOf(drone.v, droneBefore, paused ? 0 : dt), drone.flown && !flying ? 0.6 : 1);
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
      timer.lap('sound');

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
      // The shared destination first, so arriving at a place that is both is logged as shared.
      // From the drone, the compass and the way to the destination count from it.
      const from = flying || drone.flown ? camera.position : w.view.group.position;
      const groundAt = (x: number, z: number): number | null => w.terrain.heightAt(x, z) ?? w.map.heightAt(x, z);
      const guiding = !w.unplaced && !w.map.open;
      const both = sharedGuide.destination;
      guide.hidden = !!both && !!guide.destination && samePlace(both, guide.destination);
      sharedGuide.update(now, camera, from, groundAt, guiding);
      guide.update(now, camera, from, groundAt, guiding);
      sharedGuide.row = guide.showing ? 1 : 0;
      camera.getWorldDirection(compassLook);
      compass.update(guiding, bearing(0, 0, compassLook.x, compassLook.z), from, [guide.mark, sharedGuide.mark].filter((m) => m !== null));

      // On its side or roof and not going anywhere: say how to get back on the wheels.
      const lying = !w.unplaced && !flying && !w.sim.beingRighted && w.sim.upright < 0.4 && Math.abs(w.sim.speed) < 2;
      overturned = lying && !paused ? overturned + dt : lying ? overturned : 0;
      const say = paused || w.map.open || w.unplaced || flying ? '' : overturned > 1.5 ? 'overturned' : w.sim.drowned ? (w.sim.def.drivetrain.motor === 'electric' ? 'shorted' : 'drowned') : '';
      if (say && say !== prompted) prompt.innerHTML = PROMPTS[say];
      if (say) prompted = say;
      prompt.style.opacity = say ? '1' : '0';

      dash.visible = !flying && !drone.flown && !w.unplaced;
      const gauge = w.winch.state === 'hooked' ? { load: w.winch.load, tension: w.winch.tension, length: w.winch.length } : null;
      if (!flying && !w.unplaced) dash.update(dt, w.sim, { lights: lamps ?? env.dark, autoLights: lamps === null, parked: controls.handbrake || (!towing.following && w.sim.holding) }, gauge);
      hint.style.opacity = now < hintUntil && !paused && winchShown === '' ? '1' : '0';
      timer.lap('hud');
    }
    // ?look=0 draws the plain picture, without the grade and glow.
    hidePart();
    if (plain || partNow === 'finish') renderer.render(scene, camera);
    else look.render(world?.environment.grade ?? NEUTRAL);
    showPart();
    if (world && drone.flown && !flying && !starting && !world.unplaced && !world.map.open && !paused) drawInset(world);
    else droneInset.style.display = 'none';
    timer.lap('render');
    frameMs += (performance.now() - began - frameMs) * 0.05;
    // The GPU's time comes back a few frames late; one question at a time.
    if (!gpuPending) {
      gpuPending = true;
      renderer
        .resolveTimestampsAsync('render')
        .then((ms) => {
          if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return;
          gpuMs = ms;
          gpuFresh = true;
          gpuSmooth = gpuSmooth === null ? ms : gpuSmooth + (ms - gpuSmooth) * 0.05;
        })
        .catch(() => {})
        .finally(() => (gpuPending = false));
    }
    const device = (renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<undefined> } } }).device;
    if (device && !gpuWaitPending) {
      gpuWaitPending = true;
      const handed = performance.now();
      device.queue
        .onSubmittedWorkDone()
        .then(() => {
          gpuWait = performance.now() - handed;
          gpuWaitFresh = true;
          gpuWaitSmooth = gpuWaitSmooth === null ? gpuWait : gpuWaitSmooth + (gpuWait - gpuWaitSmooth) * 0.05;
        })
        .catch(() => {})
        .finally(() => (gpuWaitPending = false));
    }

    frames++;
    if (now - fpsSince >= 250) {
      fps = (frames * 1000) / (now - fpsSince);
      frames = 0;
      fpsSince = now;
      drawHud();
      if (w) panel.refresh(w.environment);
      timer.lap('hud');
      if (recorder.recording) {
        const s = Math.floor(recorder.elapsed(now) / 1000);
        if (!partsBench) recBadge.textContent = benchmark && benchPhase === 'running'
          ? `● Benchmark ${s} of ${BENCH_SECONDS} s`
          : `● REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · F8 mark${markCount ? ` (${markCount})` : ''} · F9 stop`;
      }
    }
    if (recorder.recording) recordFrame(now, began);
  });
}

start().catch((err: unknown) => {
  console.error(err);
  showFatal(`Spår could not start: ${err instanceof Error ? err.message : String(err)}`);
});
