// Graphics settings: how much of the world is drawn and how finely. Three presets fill in
// every setting at once; each can then be changed on its own. Medium is the target for a
// mid-range laptop at 60 frames a second. Remembered on this computer.

export const PRESET_NAMES = ['low', 'medium', 'high'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export interface Settings {
  /** Highest device pixel ratio rendered. */
  pixelRatio: number;
  /** Sun shadow map size, 0 for no shadows. */
  shadows: number;
  /** Multiplier on the distances plants switch detail and disappear. */
  plantRange: number;
  /** Multiplier on how far away trees are still drawn, as flat pictures. */
  farTreeRange: number;
  /** How eagerly the terrain splits into finer patches: patch distance below this times its size. */
  terrainSplit: number;
  /** Multiplier on the draw distance of buildings, power lines and fences. */
  objectRange: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** 1 for a soft glow around the sun, headlights and other bright things, 0 for none. */
  glow: number;
  /** Sound volume, 0 silent to 1 full. Not part of a graphics preset. */
  volume: number;
}

export const PRESETS: Record<PresetName, Settings> = {
  low: { pixelRatio: 1, shadows: 0, plantRange: 0.6, farTreeRange: 0.5, terrainSplit: 1.2, objectRange: 0.6, fov: 60, glow: 0, volume: 0.7 },
  medium: { pixelRatio: 1.5, shadows: 1024, plantRange: 0.8, farTreeRange: 0.75, terrainSplit: 1.4, objectRange: 0.8, fov: 60, glow: 1, volume: 0.7 },
  high: { pixelRatio: 2, shadows: 2048, plantRange: 1, farTreeRange: 1, terrainSplit: 1.6, objectRange: 1, fov: 60, glow: 1, volume: 0.7 },
};

/** The settings that only take effect when the world is built again. */
export const NEEDS_RESTART: (keyof Settings)[] = ['shadows', 'plantRange', 'farTreeRange'];

/** The choices offered for each setting, as [label, value]. */
export const CHOICES: Record<keyof Settings, { label: string; options: [string, number][] }> = {
  pixelRatio: { label: 'Resolution', options: [['Low', 1], ['Medium', 1.5], ['Full', 2], ['Max', 3]] },
  shadows: { label: 'Shadows', options: [['Off', 0], ['Soft', 1024], ['Sharp', 2048]] },
  farTreeRange: { label: 'Forest draw distance', options: [['Near', 0.5], ['Medium', 0.75], ['Far', 1], ['Very far', 1.3]] },
  plantRange: { label: 'Plant detail', options: [['Low', 0.6], ['Medium', 0.8], ['High', 1], ['Very high', 1.25]] },
  objectRange: { label: 'Building draw distance', options: [['Near', 0.6], ['Medium', 0.8], ['Far', 1], ['Very far', 1.5]] },
  terrainSplit: { label: 'Ground detail', options: [['Low', 1.2], ['Medium', 1.4], ['High', 1.6], ['Very high', 2]] },
  glow: { label: 'Glow', options: [['Off', 0], ['On', 1]] },
  fov: { label: 'Field of view', options: [['50°', 50], ['60°', 60], ['70°', 70], ['80°', 80], ['90°', 90]] },
  volume: { label: 'Volume', options: [['Off', 0], ['Quiet', 0.4], ['Medium', 0.7], ['Loud', 1]] },
};

/** Settings that are a matter of taste rather than of the computer: presets leave them alone. */
export const PERSONAL: (keyof Settings)[] = ['fov', 'volume'];

const KEY = 'spar.settings';
const OLD_KEY = 'spar.quality';

/** The preset these settings match, or null when changed by hand. Personal settings do not count. */
export function presetOf(s: Settings): PresetName | null {
  return PRESET_NAMES.find((name) => (Object.keys(s) as (keyof Settings)[]).every((k) => PERSONAL.includes(k) || PRESETS[name][k] === s[k])) ?? null;
}

const isPreset = (name: string | null): name is PresetName => name !== null && (PRESET_NAMES as readonly string[]).includes(name);

/** ?quality=low|medium|high wins for this visit, then what was chosen on this computer, then medium. */
export function loadSettings(params: URLSearchParams): Settings {
  const asked = params.get('quality');
  if (isPreset(asked)) return { ...PRESETS[asked] };
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Settings>;
      const merged = { ...PRESETS.medium };
      for (const k of Object.keys(merged) as (keyof Settings)[]) if (typeof parsed[k] === 'number' && Number.isFinite(parsed[k])) merged[k] = parsed[k];
      return merged;
    }
    const old = localStorage.getItem(OLD_KEY);
    if (isPreset(old)) return { ...PRESETS[old] };
  } catch {
    // Storage can be off, or hold something unreadable; the default will do.
  }
  return { ...PRESETS.medium };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.removeItem(OLD_KEY);
  } catch {
    // Not remembered, but still applied this time.
  }
}
