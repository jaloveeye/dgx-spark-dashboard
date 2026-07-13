import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot } from './collector.js';
import { MetricsStore } from './store.js';
import type { Snapshot } from '../shared/types.js';

const port = Number(process.env.PORT ?? 4180);
const host = process.env.HOST ?? '0.0.0.0';
const intervalMs = Number(process.env.COLLECT_INTERVAL_MS ?? 15_000);
const databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'metrics.sqlite');
const distPath = join(fileURLToPath(new URL('..', import.meta.url)), '..', 'dist');
const store = new MetricsStore(databasePath);
let latest: Snapshot | null = null;
const clients = new Set<ServerResponse>();

function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function sample() {
  latest = await collectSnapshot();
  store.insert(latest);
  const payload = `event: snapshot\ndata: ${JSON.stringify(latest)}\n\n`;
  for (const client of clients) client.write(payload);
}

const ranges = { '1h': { ms: 3_600_000, bucket: 60_000 }, '24h': { ms: 86_400_000, bucket: 300_000 }, '7d': { ms: 604_800_000, bucket: 1_800_000 } } as const;
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api/health') return json(res, { status: latest ? (latest.errors.length ? 'degraded' : 'ok') : 'starting', lastCollectedAt: latest?.timestamp ?? null, collectorErrors: latest?.errors ?? [], uptimeSeconds: process.uptime() });
  if (url.pathname === '/api/snapshot') return latest ? json(res, latest) : json(res, { error: '수집 준비 중입니다.' }, 503);
  if (url.pathname === '/api/history') {
    const rangeName = url.searchParams.get('range') as keyof typeof ranges ?? '1h';
    const range = ranges[rangeName] ?? ranges['1h'];
    return json(res, store.history(Date.now() - range.ms, range.bucket));
  }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    if (latest) res.write(`event: snapshot\ndata: ${JSON.stringify(latest)}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname.startsWith('/api/')) return json(res, { error: '찾을 수 없습니다.' }, 404);
  const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
  let path = join(distPath, requested);
  if (!path.startsWith(distPath) || !existsSync(path) || statSync(path).isDirectory()) path = join(distPath, 'index.html');
  if (!existsSync(path)) return json(res, { error: '프런트엔드 빌드가 없습니다. npm run build를 실행하세요.' }, 404);
  res.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});

await sample();
const timer = setInterval(() => sample().catch((error) => console.error('수집 실패:', error)), intervalMs);
const pruneTimer = setInterval(() => store.prune(Date.now() - 7 * 24 * 60 * 60 * 1000), 60 * 60 * 1000);
server.listen(port, host, () => console.log(`DGX Dashboard: http://${host}:${port}`));

function shutdown() { clearInterval(timer); clearInterval(pruneTimer); for (const client of clients) client.end(); server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
