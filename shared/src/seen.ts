// What a driver has seen of a region: one bit per cell of SEEN_CELL metres, row by row from
// the north-west corner. Kept in the browser and with the account as text: the lengths of
// the runs of unseen and seen cells (starting with unseen) as varints, in base64. A region
// is mostly long runs, so a well-explored 10 km region is a few kilobytes.

/** Metres per side of a cell. */
export const SEEN_CELL = 16;
/** Storage key of a region's seen cells. */
export const SEEN_PREFIX = 'spar.seen.';

/** Cells per side for a region `size` metres across. */
export function seenCells(size: number, cell = SEEN_CELL): number {
  return Math.ceil(size / cell);
}

export interface SeenText {
  size: number;
  cell: number;
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The cells (one byte each, 0 or 1) as text. */
export function encodeSeen(cells: Uint8Array, size: number, cell = SEEN_CELL): string {
  const bytes: number[] = [];
  const put = (n: number): void => {
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 0x80);
    }
    bytes.push(n);
  };
  let value = 0;
  let run = 0;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i] ? 1 : 0;
    if (v === value) run++;
    else {
      put(run);
      value = v;
      run = 1;
    }
  }
  put(run);
  const text: SeenText = { size, cell, data: toBase64(Uint8Array.from(bytes)) };
  return JSON.stringify(text);
}

/**
 * Text back into cells, for a region `size` metres across; null when it does not read, or
 * was kept for a region of another size or with other cells.
 */
export function decodeSeen(text: string | null | undefined, size: number, cell = SEEN_CELL): Uint8Array | null {
  if (!text) return null;
  try {
    const t = JSON.parse(text) as Partial<SeenText>;
    if (t.size !== size || t.cell !== cell || typeof t.data !== 'string') return null;
    const n = seenCells(size, cell);
    const cells = new Uint8Array(n * n);
    const bytes = fromBase64(t.data);
    let at = 0;
    let value = 0;
    let i = 0;
    while (i < bytes.length) {
      let run = 0;
      let scale = 1;
      for (;;) {
        const b = bytes[i++];
        if (b === undefined) return null;
        run += (b & 0x7f) * scale;
        scale *= 0x80;
        if (b < 0x80) break;
      }
      if (at + run > cells.length) return null;
      if (value) cells.fill(1, at, at + run);
      at += run;
      value ^= 1;
    }
    return at === cells.length ? cells : null;
  } catch {
    return null;
  }
}

/**
 * Two kept texts as one: every cell seen in either. When they are for regions of different
 * sizes (imported again), `b` wins; when one does not read, the other.
 */
export function mergeSeen(a: string | null | undefined, b: string | null | undefined): string {
  const head = (text: string | null | undefined): SeenText | null => {
    try {
      const t = JSON.parse(text ?? '') as SeenText;
      return typeof t.size === 'number' && typeof t.cell === 'number' ? t : null;
    } catch {
      return null;
    }
  };
  const ha = head(a), hb = head(b);
  if (!hb) return a ?? '';
  if (!ha || ha.size !== hb.size || ha.cell !== hb.cell) return b!;
  const ca = decodeSeen(a, ha.size, ha.cell), cb = decodeSeen(b, hb.size, hb.cell);
  if (!ca) return b!;
  if (!cb) return a!;
  for (let i = 0; i < ca.length; i++) ca[i] = ca[i]! | cb[i]!;
  return encodeSeen(ca, hb.size, hb.cell);
}
