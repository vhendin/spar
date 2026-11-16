import type { PerspectiveCamera } from 'three/webgpu';

const KEYS_FORWARD = ['KeyW', 'ArrowUp'];
const KEYS_BACK = ['KeyS', 'ArrowDown'];
const KEYS_LEFT = ['KeyA', 'ArrowLeft'];
const KEYS_RIGHT = ['KeyD', 'ArrowRight'];
const KEYS_UP = ['Space', 'KeyE'];
const KEYS_DOWN = ['KeyQ', 'ControlLeft'];

/**
 * Free-fly camera: click to capture the mouse, WASD to move, Space/E up, Q down,
 * Shift for speed, mouse wheel to change the base speed.
 */
export class FlyCamera {
  /** Base speed in metres per second. */
  speed = 60;
  private yaw = 0;
  private pitch = 0;
  private readonly down = new Set<string>();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly element: HTMLElement,
  ) {
    camera.rotation.order = 'YXZ';
    this.yaw = camera.rotation.y;
    this.pitch = camera.rotation.x;

    element.addEventListener('click', () => {
      // Rejected when the page is not focused or the user just pressed Esc; harmless.
      Promise.resolve(element.requestPointerLock()).catch(() => {});
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== element) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      const limit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });
    element.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.speed = Math.max(1, Math.min(2000, this.speed * (e.deltaY < 0 ? 1.25 : 0.8)));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** Moves the camera. Yaw 0 looks north and grows to the left (west); pitch is positive upward. Radians. */
  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.camera.rotation.set(pitch, yaw, 0);
  }

  get captured(): boolean {
    return document.pointerLockElement === this.element;
  }

  private axis(positive: string[], negative: string[]): number {
    const has = (keys: string[]): boolean => keys.some((k) => this.down.has(k));
    return (has(positive) ? 1 : 0) - (has(negative) ? 1 : 0);
  }

  update(dt: number): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    const forward = this.axis(KEYS_FORWARD, KEYS_BACK);
    const right = this.axis(KEYS_RIGHT, KEYS_LEFT);
    const up = this.axis(KEYS_UP, KEYS_DOWN);
    if (forward === 0 && right === 0 && up === 0) return;

    const boost = this.down.has('ShiftLeft') || this.down.has('ShiftRight') ? 5 : 1;
    const step = this.speed * boost * dt;
    // Forward follows the view direction, so looking down and pressing W descends.
    this.camera.translateZ(-forward * step);
    this.camera.translateX(right * step);
    this.camera.position.y += up * step;
  }
}
