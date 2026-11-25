import { describe, expect, it } from 'vitest';
import { decodeSeen, encodeSeen, mergeSeen, seenCells } from './seen';

describe('seen cells', () => {
  it('reads back what was written, and stays small for long runs', () => {
    const n = seenCells(10240);
    expect(n).toBe(640);
    const cells = new Uint8Array(n * n);
    for (let j = 100; j < 300; j++) cells.fill(1, j * n + 50, j * n + 400);
    cells[0] = 1;
    cells[cells.length - 1] = 1;
    const text = encodeSeen(cells, 10240);
    expect(text.length).toBeLessThan(2000);
    expect(decodeSeen(text, 10240)).toEqual(cells);
  });

  it('does not read text for another size of region, or nonsense', () => {
    const text = encodeSeen(new Uint8Array(16 * 16), 256);
    expect(decodeSeen(text, 256)).not.toBeNull();
    expect(decodeSeen(text, 512)).toBeNull();
    expect(decodeSeen('nonsense', 256)).toBeNull();
    expect(decodeSeen(null, 256)).toBeNull();
  });

  it('merges by keeping every cell seen in either', () => {
    const a = new Uint8Array(256), b = new Uint8Array(256);
    a[3] = 1;
    b[200] = 1;
    const merged = decodeSeen(mergeSeen(encodeSeen(a, 256), encodeSeen(b, 256)), 256)!;
    expect(merged[3]).toBe(1);
    expect(merged[200]).toBe(1);
    expect(merged.reduce((s, v) => s + v, 0)).toBe(2);
  });

  it('when the region changed size, the newer wins; nothing kept takes the other', () => {
    const old = encodeSeen(new Uint8Array(256), 256);
    const now = encodeSeen(new Uint8Array(1024), 512);
    expect(mergeSeen(old, now)).toBe(now);
    expect(mergeSeen(undefined, now)).toBe(now);
    expect(mergeSeen(old, null)).toBe(old);
  });
});
