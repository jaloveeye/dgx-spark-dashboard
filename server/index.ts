import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthService, clientAddress, expiredSessionCookie, requestCookie, requestHasSameOrigin, sessionCookie, sessionCookieName } from './auth.js';
import { collectSnapshot } from './collector.js';
import { MetricsStore } from './store.js';
import { collectUpdateInfo } from './updates.js';
import type { Snapshot } from '../shared/types.js';

const port = Number(process.env.PORT ?? 4180);
const host = process.env.HOST ?? '0.0.0.0';
const intervalMs = Number(process.env.COLLECT_INTERVAL_MS ?? 15_000);
const databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'metrics.sqlite');
const tlsCertificatePath = process.env.TLS_CERT_PATH;
const tlsKeyPath = process.env.TLS_KEY_PATH;
if (Boolean(tlsCertificatePath) !== Boolean(tlsKeyPath)) throw new Error('TLS_CERT_PATH와 TLS_KEY_PATH를 함께 설정해야 합니다.');
const distPath = join(fileURLToPath(new URL('..', import.meta.url)), '..', 'dist');
const store = new MetricsStore(databasePath);
const auth = new AuthService();
let latest: Snapshot | null = null;
const clients = new Map<ServerResponse, string>();

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

function json(res: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new Error('content-type');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 8192) throw new Error('body-too-large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function sample() {
  latest = await collectSnapshot();
  store.insert(latest);
  const payload = `event: snapshot\ndata: ${JSON.stringify(latest)}\n\n`;
  for (const [client, token] of clients) {
    if (auth.session(token)) client.write(payload);
    else { client.end(); clients.delete(client); }
  }
}

const ranges = { '1h': { ms: 3_600_000, bucket: 60_000 }, '24h': { ms: 86_400_000, bucket: 300_000 }, '7d': { ms: 604_800_000, bucket: 1_800_000 } } as const;
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const token = requestCookie(req, sessionCookieName);

  if (url.pathname === '/api/session' && req.method === 'GET') {
    const session = auth.session(token);
    return json(res, session ? { authenticated: true, username: session.username } : { authenticated: false });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!requestHasSameOrigin(req)) return json(res, { error: 'invalid_origin' }, 403);
    let body: unknown;
    try { body = await readJson(req); } catch { return json(res, { error: 'invalid_request' }, 400); }
    const credentials = typeof body === 'object' && body !== null ? body as { username?: unknown; password?: unknown } : {};
    const result = await auth.login(credentials.username, credentials.password, clientAddress(req));
    if (!result.ok) {
      const headers: Record<string, string> = result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {};
      return json(res, { error: result.status === 429 ? 'too_many_attempts' : 'authentication_failed' }, result.status, headers);
    }
    return json(res, { authenticated: true, username: result.username }, 200, { 'Set-Cookie': sessionCookie(result.token, result.maxAge) });
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    if (!requestHasSameOrigin(req)) return json(res, { error: 'invalid_origin' }, 403);
    auth.logout(token);
    return json(res, { authenticated: false }, 200, { 'Set-Cookie': expiredSessionCookie() });
  }

  if (url.pathname.startsWith('/api/')) {
    const session = auth.session(token);
    if (!session) return json(res, { error: 'authentication_required' }, 401);
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, { status: latest ? (latest.errors.length ? 'degraded' : 'ok') : 'starting', lastCollectedAt: latest?.timestamp ?? null, collectorErrors: latest?.errors ?? [], uptimeSeconds: process.uptime() });
    if (url.pathname === '/api/snapshot' && req.method === 'GET') return latest ? json(res, latest) : json(res, { error: 'collector_starting' }, 503);
    if (url.pathname === '/api/updates' && req.method === 'GET') {
      try { return json(res, await collectUpdateInfo(url.searchParams.get('refresh') === '1')); }
      catch { return json(res, { error: 'update_check_failed' }, 503); }
    }
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const rangeName = url.searchParams.get('range') as keyof typeof ranges ?? '1h';
      const range = ranges[rangeName] ?? ranges['1h'];
      return json(res, store.history(Date.now() - range.ms, range.bucket));
    }
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.set(res, token!);
      if (latest) res.write(`event: snapshot\ndata: ${JSON.stringify(latest)}\n\n`);
      req.on('close', () => clients.delete(res));
      return;
    }
    return json(res, { error: 'not_found' }, 404);
  }

  const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
  let path = join(distPath, requested);
  if (!path.startsWith(distPath) || !existsSync(path) || statSync(path).isDirectory()) path = join(distPath, 'index.html');
  if (!existsSync(path)) return json(res, { error: 'frontend_not_built' }, 404);
  res.writeHead(200, { ...securityHeaders, 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream', 'Cache-Control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  createReadStream(path).pipe(res);
}

const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
  void handleRequest(req, res).catch((error) => {
    console.error('요청 처리 실패:', error instanceof Error ? error.message : error);
    if (!res.headersSent) json(res, { error: 'internal_error' }, 500);
    else res.end();
  });
};
const server = tlsCertificatePath && tlsKeyPath
  ? createHttpsServer({ cert: readFileSync(tlsCertificatePath), key: readFileSync(tlsKeyPath), minVersion: 'TLSv1.2' }, requestHandler)
  : createHttpServer(requestHandler);

await sample();
const timer = setInterval(() => sample().catch((error) => console.error('수집 실패:', error)), intervalMs);
const pruneTimer = setInterval(() => store.prune(Date.now() - 7 * 24 * 60 * 60 * 1000), 60 * 60 * 1000);
server.listen(port, host, () => console.log(`DGX Dashboard: ${tlsCertificatePath ? 'https' : 'http'}://${host}:${port}`));

function shutdown() { clearInterval(timer); clearInterval(pruneTimer); for (const client of clients.keys()) client.end(); server.close(() => { store.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
