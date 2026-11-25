// Writes Spår's app icon (client/public/icon-180.png and icon-512.png): a dark sky, a moss
// hill with snow, a spruce slope and a mustard track. Run: node client/scripts/make-icon.mjs client/public
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const NIGHT = hex('#1c2230'), LAKE = hex('#4e6573'), MOSS = hex('#6e7a55'), SPRUCE = hex('#2f3b33'), MUSTARD = hex('#c9a44a'), BIRCH = hex('#ecebe6');
function colour(u, v) {
  // u, v in 0..1, v down.
  const far = 0.52 - 0.16 * Math.exp(-((u - 0.68) ** 2) / 0.03) - 0.06 * Math.exp(-((u - 0.3) ** 2) / 0.02);
  const near = 0.66 - 0.12 * Math.exp(-((u - 0.25) ** 2) / 0.05);
  // The track: a curve climbing the near hill, as a band.
  const trackCentre = 0.98 - 0.42 * u + 0.18 * Math.sin(u * 5.5);
  const width = 0.045 * (1.2 - u * 0.7);
  if (v > near && Math.abs(v - trackCentre) < width) return MUSTARD;
  if (v > near) return SPRUCE;
  if (v > far) {
    // Snow on the far top.
    return v < 0.41 + 0.012 * Math.sin(u * 70) ? BIRCH : MOSS;
  }
  const t = v / far;
  return NIGHT.map((c, i) => Math.round(c + (LAKE[i] - c) * t * 0.8));
}
function png(size, file) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const ss = 3;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = colour((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
const out = process.argv[2];
png(180, `${out}/icon-180.png`);
png(512, `${out}/icon-512.png`);
