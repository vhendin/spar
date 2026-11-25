// Fullscreen: the whole screen for the game, without the browser's bars. On a phone it also
// turns the picture sideways and keeps it there. iPhone Safari cannot put a page fullscreen;
// there the game is added to the home screen and opens from there without bars (the web app
// manifest, client/public/manifest.webmanifest).

type WebkitDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

const doc = document as WebkitDocument;

/** Whether this browser can put the page fullscreen. */
export const canFullscreen = (): boolean => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

export const isFullscreen = (): boolean => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);

/** Opened from the home screen (or as an installed app): already without the browser's bars. */
export const isStandalone = (): boolean =>
  matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** An iPhone (or iPod) in the browser: fullscreen only by adding the game to the home screen. */
export const isIPhoneBrowser = (): boolean => /iPhone|iPod/.test(navigator.userAgent) && !isStandalone();

/** Fullscreen on or off. Must be called from a key press or a tap. */
export function toggleFullscreen(): void {
  if (isFullscreen()) {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
    return;
  }
  const root = document.documentElement as WebkitElement;
  const done = (): void => {
    // Phones turn sideways and stay so; elsewhere the lock is refused, which is fine.
    const o = screen.orientation as LockableOrientation | undefined;
    if (matchMedia('(pointer: coarse)').matches) void o?.lock?.('landscape').catch(() => {});
  };
  if (root.requestFullscreen) void root.requestFullscreen({ navigationUI: 'hide' }).then(done, () => {});
  else if (root.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
    done();
  }
}

/** Calls `changed` whenever the page goes into or out of fullscreen. */
export function onFullscreenChange(changed: () => void): void {
  document.addEventListener('fullscreenchange', changed);
  document.addEventListener('webkitfullscreenchange', changed);
}

/**
 * A small button in the top right corner on touch screens, where there is no key for it: it
 * shows while the page is not fullscreen and fullscreen is possible.
 */
export function cornerButton(): void {
  if (!matchMedia('(pointer: coarse)').matches || !canFullscreen()) return;
  const b = document.createElement('button');
  b.id = 'fullscreen';
  b.type = 'button';
  b.title = 'Fullscreen';
  b.setAttribute('aria-label', 'Fullscreen');
  b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
  const show = (): void => {
    b.style.display = isFullscreen() ? 'none' : '';
  };
  onFullscreenChange(show);
  show();
  document.body.append(b);
}
