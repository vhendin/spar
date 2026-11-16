import * as THREE from 'three/webgpu';
import { FlyCamera } from './flyCamera';
import { Connection, type ConnectionState } from './net';
import { buildTestScene } from './testScene';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const fatal = document.querySelector<HTMLDivElement>('#fatal')!;

function showFatal(text: string): void {
  fatal.textContent = text;
  fatal.style.display = 'flex';
  hud.style.display = 'none';
}

function describe(state: ConnectionState): string {
  switch (state.status) {
    case 'connecting':
      return 'connecting…';
    case 'online':
      return `${state.welcome.playerId} · region ${state.welcome.region} · seed ${state.welcome.seed}`;
    case 'offline':
      return `offline: ${state.reason}`;
  }
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

  const camera = new THREE.PerspectiveCamera(65, 1, 0.3, 20000);
  camera.position.set(0, 12, 60);
  const fly = new FlyCamera(camera, canvas);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // The scene is built once the server has said which seed to use.
  let scene: THREE.Scene | null = null;
  let seed: number | null = null;
  let link: ConnectionState = { status: 'connecting' };
  let fps: number | null = null;

  const drawHud = (): void => {
    const p = camera.position;
    hud.textContent = [
      `${fps === null ? '–' : fps.toFixed(0)} fps · ${backend}`,
      describe(link),
      `pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)} · speed ${fly.speed.toFixed(0)} m/s`,
      fly.captured ? 'WASD move · Space/Q up/down · Shift fast · wheel speed · Esc release' : 'click to fly',
    ].join('\n');
  };
  drawHud();

  new Connection((state) => {
    link = state;
    if (state.status === 'online' && state.welcome.seed !== seed) {
      seed = state.welcome.seed;
      scene = buildTestScene(seed);
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
    if (scene) renderer.render(scene, camera);

    frames++;
    if (now - fpsSince >= 500) {
      fps = (frames * 1000) / (now - fpsSince);
      drawHud();
      frames = 0;
      fpsSince = now;
    }
  });
}

start().catch((err: unknown) => {
  console.error(err);
  showFatal(`Spår could not start: ${err instanceof Error ? err.message : String(err)}`);
});
