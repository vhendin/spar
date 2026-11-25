import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * Serves one file from `root`. `relPath` is the still-encoded URL path below the mount
 * point. Requests that would escape `root` are refused.
 */
export async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  relPath: string,
  opts: { immutable?: boolean } = {},
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (decoded.includes('\0')) return send(res, 400, 'Bad request');

  const rootAbs = resolve(root);
  let file = resolve(join(rootAbs, decoded));
  if (file !== rootAbs && !file.startsWith(rootAbs + sep)) return send(res, 403, 'Forbidden');

  let info;
  try {
    info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file);
    }
  } catch {
    return send(res, 404, 'Not found');
  }
  if (!info.isFile()) return send(res, 404, 'Not found');

  // Region files change only when the importer runs: let browsers keep them and ask
  // whether they are still current, instead of downloading them again.
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': opts.immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end();
    return;
  }

  res.writeHead(200, {
    ETag: etag,
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': opts.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}
