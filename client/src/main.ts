import * as THREE from 'three/webgpu';
import type { RegionIndex, Welcome } from '@spar/shared';
import { FlyCamera } from './flyCamera';
import { Connection, type ConnectionState } from './net';
import { GROUND_VIEWS, GroundShading } from './terrain/groundMaterial';
import { loadHorizon } from './terrain/horizon';
import { loadRegionIndex, RegionMissingError } from './terrain/region';
import { Terrain } from './terrain/terrain';
import { Vegetation } from './vegetation/vegetation';

const SKY = 0x9db8c8;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const fatal = document.querySelector<HTMLDivElement>('#fatal')!;

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

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: params.get('renderer') === 'webgl',
  });
  // Falls back to WebGL 2 by itself when the browser has no WebGPU.
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // World axes: X east, Y up, Z south, in metres from the region's north-west corner at sea level.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 2500, 30000);
  scene.add(new THREE.HemisphereLight(0xcfe3f0, 0x4a4636, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
  sun.position.set(-0.6, 0.4, 0.65); // from the south-west, mid afternoon
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(60, 1, 1, 60000);
  const fly = new FlyCamera(camera, canvas);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let link: ConnectionState = { status: 'connecting' };
  let terrain: Terrain | null = null;
  let vegetation: Vegetation | null = null;
  let loadingRegion: string | null = null;
  let fps: number | null = null;
  let shading: GroundShading | null = null;
  let groundView = 0;

  const drawHud = (): void => {
    const lines = [`${fps === null ? '–' : fps.toFixed(0)} fps · ${backend}`, describe(link, terrain?.index ?? null)];
    if (terrain) {
      const p = camera.position;
      const { origin, heights } = terrain.index;
      const ground = terrain.heightAt(p.x, p.z);
      lines.push(
        `E ${(origin.easting + p.x).toFixed(0)} N ${(origin.northing - p.z).toFixed(0)} · ${p.y.toFixed(0)} m` +
          (ground === null ? '' : ` (ground ${ground.toFixed(0)} m)`) +
          ` · speed ${fly.speed.toFixed(0)} m/s`,
        `terrain ${terrain.stats.nodes} patches · ${(terrain.stats.triangles / 1000).toFixed(0)}k triangles` +
          (terrain.stats.loading ? ` · loading ${terrain.stats.loading}` : '') +
          ` · ${heights.source.name} ${heights.source.resolution} m`,
      );
      if (vegetation) {
        const v = vegetation.stats;
        lines.push(
          `plants ${(v.meshes / 1000).toFixed(1)}k meshes (${(v.full / 1000).toFixed(1)}k full) · ${(v.impostors / 1000).toFixed(0)}k far trees in ${v.tiles} tiles` +
            (v.loading ? ` · placing ${v.loading}` : ''),
        );
      }
    } else if (loadingRegion) {
      lines.push(`loading ${loadingRegion}…`);
    }
    if (groundView > 0) lines.push(`view: ${GROUND_VIEWS[groundView]}`);
    lines.push(fly.captured ? 'WASD move · Space/Q up/down · Shift fast · wheel speed · M masks · Esc release' : 'click to fly · M masks');
    hud.textContent = lines.join('\n');
  };
  drawHud();

  const enterRegion = async (welcome: Welcome): Promise<void> => {
    loadingRegion = welcome.region;
    drawHud();
    const index = await loadRegionIndex(welcome.region);
    shading = new GroundShading(index);
    shading.view.value = groundView;
    const [ground, horizon] = await Promise.all([Terrain.load(index, shading), loadHorizon(index, shading)]);
    scene.add(ground.group, horizon);
    terrain = ground;
    // ?plants=0 leaves the ground bare, for looking at the terrain alone.
    if (params.get('plants') !== '0') {
      vegetation = await Vegetation.create(renderer, index, welcome.seed);
      scene.add(vegetation.group);
      // ?atlas=1 stands the far-tree pictures up in front of the start position.
      if (params.get('atlas') === '1') {
        const board = vegetation.atlasBoard(40);
        board.name = 'atlas';
        scene.add(board);
      }
    }

    // Start above the middle of the area looking north, unless the URL says otherwise:
    // ?pos=x,y,z (metres) and ?look=yaw,pitch (degrees). With ?agl=n, y is n metres above the ground.
    const mid = index.size / 2;
    const pos = numbers(params, 'pos', 3) ?? [mid, (ground.heightAt(mid, mid) ?? index.heights.max) + 250, mid];
    const agl = Number(params.get('agl'));
    if (params.has('agl') && Number.isFinite(agl)) pos[1] = (ground.heightAt(pos[0]!, pos[2]!) ?? pos[1]!) + agl;
    const look = numbers(params, 'look', 2) ?? [0, -12];
    fly.setPose(pos[0]!, pos[1]!, pos[2]!, THREE.MathUtils.degToRad(look[0]!), THREE.MathUtils.degToRad(look[1]!));
    scene.getObjectByName('atlas')?.position.set(pos[0]!, pos[1]!, pos[2]! - 30);
  };

  // M steps through the raw mask views; ?view=n starts in one.
  const setView = (n: number): void => {
    groundView = ((n % GROUND_VIEWS.length) + GROUND_VIEWS.length) % GROUND_VIEWS.length;
    if (shading) shading.view.value = groundView;
    drawHud();
  };
  setView(Number(params.get('view')) || 0);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) setView(groundView + (e.shiftKey ? -1 : 1));
  });

  new Connection((state) => {
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
  });

  let last = performance.now();
  let frames = 0;
  let fpsSince = last;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    fly.update(dt);
    terrain?.update(camera.position);
    vegetation?.update(camera.position);
    renderer.render(scene, camera);

    frames++;
    if (now - fpsSince >= 500) {
      fps = (frames * 1000) / (now - fpsSince);
      frames = 0;
      fpsSince = now;
      drawHud();
    }
  });
}

start().catch((err: unknown) => {
  console.error(err);
  showFatal(`Spår could not start: ${err instanceof Error ? err.message : String(err)}`);
});
