// Sends the browser's errors and warnings to the server (/api/log, appended to
// data/perf/client-errors.log), so a problem on screen can be read there without the
// browser's console. Repeats of the same message are counted, not sent again; at most
// MAX_LINES a visit. The server takes them only from its own computer or a logged-in driver;
// otherwise they are quietly dropped.

const MAX_LINES = 200;
const SEND_EVERY_MS = 1500;

export function startErrorLog(): void {
  const seen = new Map<string, number>();
  let queue: string[] = [];
  let sent = 0;
  let off = false;

  const text = (v: unknown): string => {
    if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ''}`;
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const add = (level: string, parts: unknown[]): void => {
    if (off) return;
    const line = `${level} ${parts.map(text).join(' ')}`.slice(0, 8000);
    const n = (seen.get(line) ?? 0) + 1;
    seen.set(line, n);
    if (n === 1 || n === 10 || n === 100 || n === 1000) queue.push(n === 1 ? line : `(×${n}) ${line.slice(0, 300)}`);
  };
  const flush = (): void => {
    if (off || queue.length === 0) return;
    const lines = queue.slice(0, MAX_LINES - sent);
    queue = [];
    sent += lines.length;
    if (sent >= MAX_LINES) lines.push('… more left out this visit');
    if (lines.length === 0) return;
    fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Spar': '1' }, body: JSON.stringify({ lines: [`[${location.search || '/'}]`, ...lines] }) })
      .then((r) => {
        if (r.status === 403 || r.status === 404) off = true;
      })
      .catch(() => {});
    if (sent >= MAX_LINES) off = true;
  };

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      add(level.toUpperCase(), args);
      original(...args);
    };
  }
  window.addEventListener('error', (e) => add('UNCAUGHT', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', (e) => add('REJECTED', [e.reason]));
  setInterval(flush, SEND_EVERY_MS);
  window.addEventListener('pagehide', flush);
}
