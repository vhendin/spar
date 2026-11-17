// Quality presets: how much of the world is drawn in detail. Medium is the target for a
// mid-range laptop at 60 frames a second; low and high trade looks against speed.

export const QUALITY_NAMES = ['low', 'medium', 'high'] as const;
export type QualityName = (typeof QUALITY_NAMES)[number];

export interface Quality {
  name: QualityName;
  /** Highest device pixel ratio rendered. */
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Multipliers on the distances plants switch detail and disappear. */
  plantRange: number;
  farTreeRange: number;
  /** How eagerly the terrain splits into finer patches: patch distance below this times its size. */
  terrainSplit: number;
  /** Multiplier on the draw distance of buildings, power lines and fences. */
  objectRange: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', pixelRatio: 1, shadows: false, shadowMapSize: 1024, plantRange: 0.6, farTreeRange: 0.5, terrainSplit: 1.2, objectRange: 0.6 },
  medium: { name: 'medium', pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, plantRange: 0.8, farTreeRange: 0.75, terrainSplit: 1.4, objectRange: 0.8 },
  high: { name: 'high', pixelRatio: 2, shadows: true, shadowMapSize: 2048, plantRange: 1, farTreeRange: 1, terrainSplit: 1.6, objectRange: 1 },
};

const KEY = 'spar.quality';

/** ?quality=low|medium|high wins, then the last choice made on this computer, then medium. */
export function chooseQuality(params: URLSearchParams): Quality {
  const asked = params.get('quality');
  if (asked && asked in QUALITY) return QUALITY[asked as QualityName];
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in QUALITY) return QUALITY[saved as QualityName];
  } catch {
    // Storage can be off; the default will do.
  }
  return QUALITY.medium;
}

export function saveQuality(name: QualityName): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Not remembered, but still applied this time.
  }
}

export function nextQuality(name: QualityName): QualityName {
  return QUALITY_NAMES[(QUALITY_NAMES.indexOf(name) + 1) % QUALITY_NAMES.length]!;
}
