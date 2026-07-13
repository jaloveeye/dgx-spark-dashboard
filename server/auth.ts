import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

export const sessionCookieName = 'dgx_session';

type PamAuthenticator = (username: string, password: string, remoteHost: string) => Promise<boolean>;
type AccountAuthorizer = (username: string) => Promise<boolean>;

interface Session {
  username: string;
  expiresAt: number;
}

interface AttemptWindow {
  failures: number;
  resetsAt: number;
}

export type LoginResult =
  | { ok: true; username: string; token: string; maxAge: number }
  | { ok: false; status: 401 | 429; retryAfter?: number };

function helperPath() {
  return process.env.PAM_HELPER_PATH ?? join(process.cwd(), 'dist-server', 'server', 'pam-auth-helper');
}

export async function authenticateWithPam(username: string, password: string, remoteHost: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(helperPath(), [username, remoteHost], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { LANG: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin', PAM_SERVICE: process.env.PAM_SERVICE ?? 'login' },
    });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false); }, 10_000);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    child.stdin.on('error', () => finish(false));
    child.stdin.end(password);
  });
}

export async function authorizeHumanAccount(username: string) {
  try {
    const allowed = process.env.PAM_ALLOWED_USERS?.split(',').map((item) => item.trim()).filter(Boolean);
    if (allowed?.length && !allowed.includes(username)) return false;
    const entry = (await readFile('/etc/passwd', 'utf8')).split('\n').find((line) => line.startsWith(`${username}:`));
    if (!entry) return false;
    const fields = entry.split(':');
    const uid = Number(fields[2]);
    const minimumUid = Number(process.env.PAM_MIN_UID ?? 1000);
    const shell = fields[6] ?? '';
    return Number.isInteger(uid) && uid >= minimumUid && uid < 65534 && !/(?:nologin|false)$/.test(shell);
  } catch {
    return false;
  }
}

export function clientAddress(request: IncomingMessage) {
  return request.socket.remoteAddress ?? 'unknown';
}

export function requestCookie(request: IncomingMessage, name: string) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}

export function requestHasSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, maxAge: number) {
  const secure = process.env.AUTH_COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function expiredSessionCookie() {
  const secure = process.env.AUTH_COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export class AuthService {
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, AttemptWindow>();
  private pamAuthenticator: PamAuthenticator;
  private accountAuthorizer: AccountAuthorizer;
  private sessionSeconds: number;
  private maxFailures: number;
  private attemptWindowMs: number;

  constructor(options: {
    pamAuthenticator?: PamAuthenticator;
    accountAuthorizer?: AccountAuthorizer;
    sessionSeconds?: number;
    maxFailures?: number;
    attemptWindowMs?: number;
  } = {}) {
    this.pamAuthenticator = options.pamAuthenticator ?? authenticateWithPam;
    this.accountAuthorizer = options.accountAuthorizer ?? authorizeHumanAccount;
    this.sessionSeconds = options.sessionSeconds ?? Math.min(Math.max(Number(process.env.AUTH_SESSION_HOURS ?? 8), 1), 168) * 3600;
    this.maxFailures = options.maxFailures ?? 5;
    this.attemptWindowMs = options.attemptWindowMs ?? 10 * 60_000;
  }

  private tokenKey(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private clean(now = Date.now()) {
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
    for (const [key, attempt] of this.attempts) if (attempt.resetsAt <= now) this.attempts.delete(key);
  }

  async login(username: unknown, password: unknown, remoteHost: string): Promise<LoginResult> {
    const now = Date.now();
    this.clean(now);
    const attempt = this.attempts.get(remoteHost);
    if (attempt && attempt.failures >= this.maxFailures) {
      return { ok: false, status: 429, retryAfter: Math.max(1, Math.ceil((attempt.resetsAt - now) / 1000)) };
    }

    const validInput = typeof username === 'string' && /^[a-z_][a-z0-9_.-]{0,63}$/i.test(username)
      && typeof password === 'string' && password.length > 0 && Buffer.byteLength(password) <= 4096;
    const authenticated = validInput && await this.pamAuthenticator(username, password, remoteHost);
    const authorized = authenticated && await this.accountAuthorizer(username);

    if (!authorized) {
      const current = this.attempts.get(remoteHost);
      this.attempts.set(remoteHost, current && current.resetsAt > now
        ? { failures: current.failures + 1, resetsAt: current.resetsAt }
        : { failures: 1, resetsAt: now + this.attemptWindowMs });
      return { ok: false, status: 401 };
    }

    this.attempts.delete(remoteHost);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(this.tokenKey(token), { username, expiresAt: now + this.sessionSeconds * 1000 });
    return { ok: true, username, token, maxAge: this.sessionSeconds };
  }

  session(token: string | null) {
    if (!token) return null;
    this.clean();
    return this.sessions.get(this.tokenKey(token)) ?? null;
  }

  logout(token: string | null) {
    if (token) this.sessions.delete(this.tokenKey(token));
  }
}
