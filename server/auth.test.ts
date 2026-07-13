import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { AuthService, expiredSessionCookie, requestHasSameOrigin, sessionCookie } from './auth.js';

describe('AuthService', () => {
  it('creates and revokes an authenticated session', async () => {
    const auth = new AuthService({ pamAuthenticator: async () => true, accountAuthorizer: async () => true, sessionSeconds: 60 });
    const result = await auth.login('herace', 'secret', '127.0.0.1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(auth.session(result.token)).toMatchObject({ username: 'herace' });
    auth.logout(result.token);
    expect(auth.session(result.token)).toBeNull();
  });

  it('rejects invalid users and rate limits repeated failures', async () => {
    const pam = vi.fn(async () => false);
    const auth = new AuthService({ pamAuthenticator: pam, accountAuthorizer: async () => true, maxFailures: 2 });
    expect(await auth.login('herace', 'wrong', '10.0.0.2')).toMatchObject({ ok: false, status: 401 });
    expect(await auth.login('herace', 'wrong', '10.0.0.2')).toMatchObject({ ok: false, status: 401 });
    expect(await auth.login('herace', 'wrong', '10.0.0.2')).toMatchObject({ ok: false, status: 429 });
    expect(pam).toHaveBeenCalledTimes(2);
  });

  it('requires an allowed human account after PAM succeeds', async () => {
    const auth = new AuthService({ pamAuthenticator: async () => true, accountAuthorizer: async () => false });
    expect(await auth.login('root', 'secret', '127.0.0.1')).toMatchObject({ ok: false, status: 401 });
  });
});

describe('authentication HTTP helpers', () => {
  it('uses hardened session cookies', () => {
    expect(sessionCookie('token', 60)).toContain('HttpOnly; SameSite=Strict; Max-Age=60');
    expect(expiredSessionCookie()).toContain('Max-Age=0');
  });

  it('accepts only matching HTTP origins', () => {
    const request = (origin: string, host = 'dashboard.local:4180') => ({ headers: { origin, host } }) as unknown as IncomingMessage;
    expect(requestHasSameOrigin(request('http://dashboard.local:4180'))).toBe(true);
    expect(requestHasSameOrigin(request('https://evil.example'))).toBe(false);
  });
});
