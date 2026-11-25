// Steering by tilting the phone, held sideways like a wheel: turning it clockwise steers right.
// Read from gravity as the motion sensor sees it (accelerationIncludingGravity), projected on
// the screen, so it does not matter how far back the phone is tipped. On an iPhone the page has
// to ask first, from a tap (Settings, Steering: Tilt).

/** Turn of the phone, degrees, that gives full lock. */
export const TILT_FULL = 30;
/** The middle that does nothing, degrees: a phone is never held quite level. */
export const TILT_DEAD = 2;
/** Below this, m/s², gravity hardly lies in the screen (the phone flat): the reading is noise. */
const TILT_MIN_G = 2.5;

/**
 * The phone's turn from level in the screen's plane, radians, clockwise negative: from the
 * sensor's gravity in the device's own axes (x right, y up, held upright) and the screen's turn
 * (screen.orientation.angle, degrees). Null when the phone lies too flat to tell.
 *
 * Taken modulo a half turn, so it is the same whichever way round the phone is turned sideways
 * and whichever sign the browser gives gravity (iOS and Android disagree).
 */
export function tiltAngle(gx: number, gy: number, screenAngle: number): number | null {
  if (Math.hypot(gx, gy) < TILT_MIN_G) return null;
  const a = (screenAngle * Math.PI) / 180;
  // Gravity in the screen's axes.
  const sx = gx * Math.cos(a) - gy * Math.sin(a);
  const sy = gx * Math.sin(a) + gy * Math.cos(a);
  let t = Math.atan2(sx, sy);
  if (t > Math.PI / 2) t -= Math.PI;
  else if (t < -Math.PI / 2) t += Math.PI;
  return t;
}

/** The steering from a turn of the phone (radians): −1..1, left positive, as the stick. */
export function tiltSteer(angle: number, full = TILT_FULL, dead = TILT_DEAD): number {
  const d = Math.abs((angle * 180) / Math.PI);
  if (d <= dead) return 0;
  return Math.sign(angle) * Math.min(1, (d - dead) / (full - dead));
}

type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** The motion sensor, read for steering while switched on. */
export class Tilt {
  /** −1..1, left positive; null until the sensor has said something, or with the phone flat. */
  steer: number | null = null;
  private on = false;
  private readonly listener = (e: DeviceMotionEvent): void => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    const angle = tiltAngle(g.x, g.y, screenAngle());
    // Lying flat, the last steering holds rather than jumping about.
    if (angle === null) return;
    const s = tiltSteer(angle);
    // A little smoothing: the sensor trembles with the hand.
    this.steer = this.steer === null ? s : this.steer + (s - this.steer) * 0.5;
  };

  /**
   * Starts reading. On an iPhone this asks for the sensor, and must be called from a tap;
   * resolves false when refused or there is no sensor.
   */
  async enable(): Promise<boolean> {
    if (typeof DeviceMotionEvent === 'undefined') return false;
    const ask = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
    if (typeof ask === 'function') {
      try {
        if ((await ask.call(DeviceMotionEvent)) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.on) window.addEventListener('devicemotion', this.listener);
    this.on = true;
    return true;
  }

  disable(): void {
    window.removeEventListener('devicemotion', this.listener);
    this.on = false;
    this.steer = null;
  }

  get enabled(): boolean {
    return this.on;
  }
}

function screenAngle(): number {
  const o = screen.orientation?.angle;
  if (typeof o === 'number') return o;
  const w = (window as unknown as { orientation?: number }).orientation;
  return typeof w === 'number' ? w : 0;
}
