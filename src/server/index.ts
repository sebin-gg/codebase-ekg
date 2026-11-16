import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { ViteDevServer } from 'vite';
import { toFhirBundle } from '../shared/fhir.ts';
import type { Reading } from '../shared/types.ts';
import { assess } from '../shared/vitals.ts';
import { InputError, messageOf } from './errors.ts';
import { openSource, type Source } from './sources/index.ts';

const dev = process.argv.includes('--dev');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 1313);
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
const wildcard = ['0.0.0.0', '::'].includes(host);
const allowLocal = process.env.EKG_ALLOW_LOCAL ? process.env.EKG_ALLOW_LOCAL === '1' : loopback;
const dist = resolve(import.meta.dirname, '../../dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

async function measure(source: Source): Promise<Reading> {
  const signals = await source.read();
  return { signals, vitals: assess(signals) };
}

const patientOf = (url: URL) => openSource(url.searchParams.get('source') ?? '', url.searchParams.get('target') ?? '', allowLocal);

function stream(req: IncomingMessage, res: ServerResponse, url: URL) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const end = () => { if (!res.writableEnded) res.end(); };

  let source: Source;
  try {
    source = patientOf(url);
  } catch (e) {
    emit('fault', { message: messageOf(e), fatal: true });
    return end();
  }

  res.write('retry: 5000\n\n');
  const stop = () => {
    clearInterval(timer);
    clearInterval(ping);
    end();
  };
  const tick = () => measure(source).then(
    (reading) => emit('reading', { ...reading, pollMs: source.pollMs }),
    (e: unknown) => {
      const fatal = e instanceof InputError;
      emit('fault', { message: messageOf(e), fatal });
      if (fatal) stop();
    },
  );
  const timer = setInterval(tick, source.pollMs);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', stop);
  void tick();
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, allowLocal, githubToken: Boolean(process.env.GITHUB_TOKEN) });
  if (url.pathname === '/api/stream') return stream(req, res, url);
  if (url.pathname !== '/api/reading' && url.pathname !== '/api/fhir') return send(res, 404, { error: 'No such ward' });
  try {
    const reading = await measure(patientOf(url));
    if (url.pathname === '/api/fhir') send(res, 200, toFhirBundle(reading), 'application/fhir+json');
    else send(res, 200, reading);
  } catch (e) {
    send(res, e instanceof InputError ? 400 : 502, { error: messageOf(e) });
  }
}

async function serveStatic(res: ServerResponse, pathname: string) {
  let file = resolve(dist, `.${decodeURIComponent(pathname)}`);
  const isFile = await stat(file).then((s) => s.isFile(), () => false);
  if (!file.startsWith(dist + sep) || !isFile) file = join(dist, 'index.html');
  try {
    const body = await readFile(file);
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    send(res, 503, { error: 'No build found: run `pnpm build` (or use `pnpm dev`)' });
  }
}

let vite: ViteDevServer | undefined;

const server = createServer((req, res) => {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (!wildcard && !['localhost', '127.0.0.1', '[::1]', host].includes(hostname)) return send(res, 421, { error: 'Misdirected request' });
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) return void api(req, res, url);
  if (vite) return vite.middlewares(req, res);
  serveStatic(res, url.pathname).catch((e: unknown) => send(res, 400, { error: messageOf(e) }));
});

if (dev) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
}

server.listen(port, host, () => {
  console.log(`Codebase EKG monitoring on http://${loopback ? host : 'localhost'}:${port}${dev ? ' (dev)' : ''}`);
  console.log(`Local admissions ${allowLocal ? 'enabled' : 'disabled'}; GitHub ${process.env.GITHUB_TOKEN ? 'authenticated' : 'anonymous (5 min polling)'}`);
});
