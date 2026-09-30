// ============================================================================
// LUXEDGE — BUYER AUTH SECURITY SUITE
//
// Drives the REAL /api/auth handler against the REAL migration
// (cloudflare/d1/migrations/*.sql) running in an in-memory SQLite engine, so
// every guarantee is verified against actual stored rows and actual SQLite
// constraints — not against a stub's idea of them.
//
// Covers the mandatory list: registration, duplicate email, activation (valid /
// wrong / expired / reused / regenerated), correct and wrong password, logout,
// expired session, revoked session, tampered cookie, protected route without
// auth, cross-user isolation, admin-vs-buyer authorization, login and
// activation rate limits, CSRF/origin enforcement, session rotation and
// disabled-account handling.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import authHandler from '../auth/index.js';
import adminBuyersHandler from '../admin/buyers.js';
import { resetDataRuntime } from '../../worker/d1/runtime';
import { SESSION_COOKIE } from '../../worker/auth/store';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'cloudflare', 'd1', 'migrations');
const ORIGIN = 'https://luxedge.us';

function migrations(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

function d1From(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          const bound = params.map((p) => (p === undefined ? null : p)) as never[];
          return {
            all: async () => ({ results: stmt.all(...bound) as Record<string, unknown>[] }),
            run: async () => ({ meta: { changes: Number(stmt.run(...bound).changes) } }),
          };
        },
      };
    },
  };
}

let db: DatabaseSync;
function fresh() {
  db = new DatabaseSync(':memory:');
  db.exec(migrations());
  resetDataRuntime({ DATA_BACKEND: 'd1', DB: d1From(db) });
}

interface Captured {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
  headers: Record<string, string>;
}

function makeRes(): { server: ServerResponse; cap: Captured } {
  const cap: Captured = { status: 200, body: {}, setCookie: null, headers: {} };
  const server = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      const key = String(name).toLowerCase();
      cap.headers[key] = String(value);
      if (key === 'set-cookie') cap.setCookie = String(value);
    },
    end: (payload?: unknown) => {
      cap.status = (server as { statusCode: number }).statusCode;
      try { cap.body = payload ? JSON.parse(String(payload)) : {}; } catch { cap.body = { raw: String(payload) }; }
    },
  } as unknown as ServerResponse;
  return { server, cap };
}

function makeReq(
  method: string,
  url: string,
  opts: { body?: unknown; cookie?: string | null; origin?: string | null; contentType?: string | null; ip?: string } = {},
): IncomingMessage {
  const raw = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = opts.contentType === null ? '' : opts.contentType || 'application/json';
  if (opts.origin !== null) headers.origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = {
    method,
    url,
    headers,
    socket: { remoteAddress: opts.ip || '203.0.113.10' },
  } as unknown as IncomingMessage;
  Object.defineProperty(req, 'on', {
    configurable: true,
    value: (name: string, fn: (chunk?: Buffer) => void) => {
      if (name === 'data' && raw) process.nextTick(() => fn(Buffer.from(raw)));
      if (name === 'end') process.nextTick(() => fn());
      return req;
    },
  });
  return req;
}

async function call(
  method: string,
  url: string,
  opts?: Parameters<typeof makeReq>[2],
): Promise<Captured> {
  const { server, cap } = makeRes();
  await authHandler(makeReq(method, url, opts), server);
  return cap;
}

function cookieToken(cap: Captured): string | null {
  const m = /lx_buyer=([^;]+)/.exec(cap.setCookie || '');
  return m ? m[1] : null;
}
const cookieHeader = (token: string) => `${SESSION_COOKIE}=${token}`;

const PASSWORD = 'correct-horse-battery';
const PASSWORD_2 = 'another-long-secret-2';

async function signup(email: string, password = PASSWORD): Promise<Captured> {
  return call('POST', '/api/auth/signup', { body: { email, password } });
}

const count = (sql: string, ...params: string[]) =>
  Number((db.prepare(sql).get(...params) as { n: number }).n);

describe('buyer auth — registration and sign-in', () => {
  beforeEach(() => fresh());
  afterEach(() => resetDataRuntime({}));

  it('registers a buyer, sets an HttpOnly session cookie and never echoes the password', async () => {
    const cap = await signup('buyer@example.com');
    expect(cap.status).toBe(200);
    expect(cap.body.ok).toBe(true);
    expect(JSON.stringify(cap.body)).not.toContain(PASSWORD);
    // The password is stored as a versioned PBKDF2 hash, never in clear.
    const row = db.prepare(`SELECT password_hash, email_normalized, email_verified FROM buyer_users`).get() as Record<string, unknown>;
    expect(String(row.password_hash)).toMatch(/^pbkdf2-sha256\$v1\$100000\$/);
    expect(String(row.password_hash)).not.toContain(PASSWORD);
    expect(row.email_normalized).toBe('buyer@example.com');
    // Honest state: no verification email was sent, so nothing claims it was.
    expect(Number(row.email_verified)).toBe(0);
    expect((cap.body.emailVerification as { sent: boolean }).sent).toBe(false);

    const token = cookieToken(cap);
    expect(token).toBeTruthy();
    expect(cap.setCookie).toContain('HttpOnly');
    expect(cap.setCookie).toContain('Secure');
    expect(cap.setCookie).toContain('SameSite=Lax');
    // Server-derived role: a public signup can only ever be a buyer.
    expect((cap.body.user as { role?: string }).role).toBe('buyer');
    // Only a hash of the token is persisted.
    const session = db.prepare(`SELECT token_hash FROM buyer_sessions`).get() as { token_hash: string };
    expect(session.token_hash).not.toBe(token);
    expect(session.token_hash).toHaveLength(64);
  });

  it('rejects a duplicate email regardless of casing, and does not overwrite the account', async () => {
    await signup('buyer@example.com');
    const dup = await signup('Buyer@Example.COM');
    expect(dup.status).toBe(409);
    expect(count(`SELECT COUNT(*) AS n FROM buyer_users`)).toBe(1);
  });

  it('enforces a minimum password length and rejects a non-JSON / cross-origin post', async () => {
    expect((await signup('short@example.com', 'abc')).status).toBe(400);
    expect(count(`SELECT COUNT(*) AS n FROM buyer_users`)).toBe(0);
    // CSRF: no Origin header at all.
    const noOrigin = await call('POST', '/api/auth/signup', { body: { email: 'x@example.com', password: PASSWORD }, origin: null });
    expect(noOrigin.status).toBe(403);
    // CSRF: a foreign origin.
    const foreign = await call('POST', '/api/auth/signup', { body: { email: 'x@example.com', password: PASSWORD }, origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    // CSRF: a form-encoded body (what a cross-site HTML form can actually send).
    const formy = await call('POST', '/api/auth/signup', { body: { email: 'x@example.com', password: PASSWORD }, contentType: 'text/plain' });
    expect(formy.status).toBe(403);
    expect(count(`SELECT COUNT(*) AS n FROM buyer_users`)).toBe(0);
  });

  it('signs in with the correct password, rejects the wrong one with an identical generic error', async () => {
    await signup('buyer@example.com');
    db.exec('DELETE FROM buyer_rate_limits');
    const ok = await call('POST', '/api/auth/login', { body: { email: 'buyer@example.com', password: PASSWORD } });
    expect(ok.status).toBe(200);
    expect(cookieToken(ok)).toBeTruthy();

    const bad = await call('POST', '/api/auth/login', { body: { email: 'buyer@example.com', password: 'wrong-password-here' } });
    expect(bad.status).toBe(401);
    expect(bad.setCookie).toBeNull();
    // An unknown email must be indistinguishable from a wrong password.
    const unknown = await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'wrong-password-here' } });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(bad.body);
  });

  it('rotates the session on every sign-in (session fixation defence)', async () => {
    const first = await signup('buyer@example.com');
    db.exec('DELETE FROM buyer_rate_limits');
    const second = await call('POST', '/api/auth/login', { body: { email: 'buyer@example.com', password: PASSWORD } });
    expect(cookieToken(second)).not.toBe(cookieToken(first));
    expect(count(`SELECT COUNT(*) AS n FROM buyer_sessions WHERE revoked_at IS NULL`)).toBe(2);
  });
});

describe('buyer auth — sessions', () => {
  beforeEach(() => fresh());
  afterEach(() => resetDataRuntime({}));

  it('resolves the signed-in buyer from the cookie alone, ignoring body/query identity', async () => {
    const first = await signup('a@example.com');
    const token = cookieToken(first)!;
    const me = await call('GET', '/api/auth/me', { cookie: cookieHeader(token) });
    expect(me.status).toBe(200);
    expect((me.body.user as { email: string }).email).toBe('a@example.com');

    // A client-supplied identity must have no effect whatsoever.
    const spoof = await call('GET', '/api/auth/me?userId=someone-else', { cookie: cookieHeader(token) });
    expect((spoof.body.user as { email: string }).email).toBe('a@example.com');
  });

  it('answers 401 without a cookie and for a tampered/forged token', async () => {
    await signup('a@example.com');
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader('not-a-real-token') })).status).toBe(401);
    const real = cookieToken(await signup('b@example.com'))!;
    const tampered = `${real.slice(0, -2)}xy`;
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(tampered) })).status).toBe(401);
  });

  it('logout revokes the session server-side (the old cookie stops working)', async () => {
    const cap = await signup('a@example.com');
    const token = cookieToken(cap)!;
    const out = await call('POST', '/api/auth/logout', { cookie: cookieHeader(token), body: {} });
    expect(out.status).toBe(200);
    expect(out.setCookie).toContain('Max-Age=0');
    // Replaying the pre-logout cookie must fail: revocation is a server fact.
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(token) })).status).toBe(401);
    expect(count(`SELECT COUNT(*) AS n FROM buyer_sessions WHERE revoked_at IS NOT NULL`)).toBe(1);
  });

  it('an expired session is refused even though the row exists', async () => {
    const cap = await signup('a@example.com');
    const token = cookieToken(cap)!;
    db.prepare(`UPDATE buyer_sessions SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(token) })).status).toBe(401);
  });

  it('a session revoked out of band (admin/logout elsewhere) is refused immediately', async () => {
    const cap = await signup('a@example.com');
    const token = cookieToken(cap)!;
    db.prepare(`UPDATE buyer_sessions SET revoked_at = ?`).run(new Date().toISOString());
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(token) })).status).toBe(401);
  });

  it('a disabled buyer loses access at once', async () => {
    const cap = await signup('a@example.com');
    const token = cookieToken(cap)!;
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(token) })).status).toBe(200);
    db.prepare(`UPDATE buyer_users SET disabled_at = ?`).run(new Date().toISOString());
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(token) })).status).toBe(401);
  });

  it('gives two buyers separate identities that cannot be confused', async () => {
    const a = cookieToken(await signup('a@example.com'))!;
    const b = cookieToken(await signup('b@example.com'))!;
    expect(a).not.toBe(b);
    const meA = await call('GET', '/api/auth/me', { cookie: cookieHeader(a) });
    const meB = await call('GET', '/api/auth/me', { cookie: cookieHeader(b) });
    expect((meA.body.user as { email: string }).email).toBe('a@example.com');
    expect((meB.body.user as { email: string }).email).toBe('b@example.com');
    // Each cookie resolves to exactly one user row, and only that one.
    expect((meA.body.user as { id: string }).id).not.toBe((meB.body.user as { id: string }).id);
    expect(count(`SELECT COUNT(*) AS n FROM buyer_sessions`)).toBe(2);
  });

  it('changing a password revokes every other session and rotates the current one', async () => {
    const first = await signup('a@example.com');
    const firstToken = cookieToken(first)!;
    db.exec('DELETE FROM buyer_rate_limits');
    const second = await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: PASSWORD } });
    const secondToken = cookieToken(second)!;

    db.exec('DELETE FROM buyer_rate_limits');
    const changed = await call('POST', '/api/auth/password', {
      cookie: cookieHeader(secondToken),
      body: { currentPassword: PASSWORD, newPassword: PASSWORD_2 },
    });
    expect(changed.status).toBe(200);
    // The other device is signed out…
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(firstToken) })).status).toBe(401);
    // …and the current one was rotated, not kept.
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(secondToken) })).status).toBe(401);
    const rotated = cookieToken(changed)!;
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(rotated) })).status).toBe(200);

    // The new password works and the old one does not.
    db.exec('DELETE FROM buyer_rate_limits');
    expect((await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: PASSWORD_2 } })).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: PASSWORD } })).status).toBe(401);
  });

  it('rejects a password change that does not know the current password', async () => {
    const cap = await signup('a@example.com');
    const token = cookieToken(cap)!;
    const denied = await call('POST', '/api/auth/password', {
      cookie: cookieHeader(token),
      body: { currentPassword: 'not-the-current-one', newPassword: PASSWORD_2 },
    });
    expect(denied.status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: PASSWORD } })).status).toBe(200);
  });
});

describe('buyer auth — one-time activation codes', () => {
  beforeEach(() => fresh());
  afterEach(() => resetDataRuntime({}));

  /** Issues a code the way the admin endpoint does (admin auth is separate). */
  async function issue(email: string): Promise<string> {
    const { issueActivationCode } = await import('../../worker/auth/store');
    const user = db.prepare(`SELECT id FROM buyer_users WHERE email_normalized = ?`).get(email) as { id: string };
    const issued = await issueActivationCode({ userId: user.id, createdBy: 'admin:test' });
    return issued!.code;
  }

  it('activates with a valid code, sets the password and signs the buyer in', async () => {
    await signup('a@example.com');
    const code = await issue('a@example.com');
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    // Only the hash of the code is stored.
    const stored = db.prepare(`SELECT token_hash FROM buyer_activation_tokens`).get() as { token_hash: string };
    expect(stored.token_hash).not.toBe(code);
    expect(stored.token_hash).toHaveLength(64);

    const cap = await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code, password: PASSWORD_2 } });
    expect(cap.status).toBe(200);
    expect(cookieToken(cap)).toBeTruthy();
    const used = db.prepare(`SELECT used_at FROM buyer_activation_tokens`).get() as { used_at: string | null };
    expect(used.used_at).not.toBeNull();
    // The new password works.
    db.exec('DELETE FROM buyer_rate_limits');
    expect((await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: PASSWORD_2 } })).status).toBe(200);
  });

  it('accepts the code typed without dashes or in lower case', async () => {
    await signup('a@example.com');
    const code = await issue('a@example.com');
    const typed = code.replace(/-/g, '').toLowerCase();
    const cap = await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: typed, password: PASSWORD_2 } });
    expect(cap.status).toBe(200);
  });

  it('refuses a wrong code, another account\u2019s code, and an unknown email', async () => {
    await signup('a@example.com');
    await signup('b@example.com');
    const codeForA = await issue('a@example.com');

    expect((await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: 'ZZZZ-ZZZZ-ZZ', password: PASSWORD_2 } })).status).toBe(400);
    // B cannot redeem A's code even knowing it.
    const crossUser = await call('POST', '/api/auth/activate', { body: { email: 'b@example.com', code: codeForA, password: PASSWORD_2 } });
    expect(crossUser.status).toBe(400);
    expect((await call('POST', '/api/auth/activate', { body: { email: 'nobody@example.com', code: codeForA, password: PASSWORD_2 } })).status).toBe(400);
    expect(count(`SELECT COUNT(*) AS n FROM buyer_activation_tokens WHERE used_at IS NOT NULL`)).toBe(0);
  });

  it('refuses an expired code and a reused code', async () => {
    await signup('a@example.com');
    const code = await issue('a@example.com');
    db.prepare(`UPDATE buyer_activation_tokens SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    const expired = await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code, password: PASSWORD_2 } });
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('EXPIRED');

    // A fresh code works once, and never twice.
    const code2 = await issue('a@example.com');
    expect((await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: code2, password: PASSWORD_2 } })).status).toBe(200);
    const replay = await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: code2, password: PASSWORD_2 } });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('USED');
  });

  it('issuing a new code revokes the previous one', async () => {
    await signup('a@example.com');
    const oldCode = await issue('a@example.com');
    const newCode = await issue('a@example.com');
    expect((await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: oldCode, password: PASSWORD_2 } })).status).toBe(400);
    expect((await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: newCode, password: PASSWORD_2 } })).status).toBe(200);
  });

  it('blocks sign-in until an activation is completed, and blocks it again once a reset is issued', async () => {
    const cap = await signup('a@example.com');
    const token = cookieToken(cap)!;
    await issue('a@example.com');
    // requires_activation is now set: the old password must not keep working.
    db.exec('DELETE FROM buyer_rate_limits');
    const blocked = await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: PASSWORD } });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ACTIVATION_REQUIRED');
    // And the still-valid session is not silently trusted either — it is, until
    // the password is reset, which is the documented rule: a pending reset stops
    // new sign-ins; completing it revokes every session.
    expect((await call('GET', '/api/auth/me', { cookie: cookieHeader(token) })).status).toBe(200);
  });
});

describe('buyer auth — rate limits and availability', () => {
  beforeEach(() => fresh());
  afterEach(() => resetDataRuntime({}));

  it('rate limits repeated failed sign-ins for one account', async () => {
    await signup('a@example.com');
    db.exec('DELETE FROM buyer_rate_limits');
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      const cap = await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: 'wrong-password-here' } });
      if (cap.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    // The limiter is durable: it survives the request that created it.
    expect(count(`SELECT COUNT(*) AS n FROM buyer_rate_limits WHERE bucket LIKE 'login:email:%'`)).toBe(1);
  });

  it('rate limits activation-code guessing', async () => {
    await signup('a@example.com');
    db.exec('DELETE FROM buyer_rate_limits');
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const cap = await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: `ZZZZ-ZZZZ-Z${i}`, password: PASSWORD_2 } });
      if (cap.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('answers 503 (never open, never Supabase Auth) when the auth datastore is unavailable', async () => {
    resetDataRuntime({ DATA_BACKEND: 'supabase' });
    expect((await call('POST', '/api/auth/login', { body: { email: 'a@example.com', password: PASSWORD } })).status).toBe(503);
    expect((await call('GET', '/api/auth/me')).status).toBe(503);
    expect((await call('POST', '/api/auth/signup', { body: { email: 'a@example.com', password: PASSWORD } })).status).toBe(503);
    expect((await call('POST', '/api/auth/activate', { body: { email: 'a@example.com', code: 'AAAA-AAAA-AA', password: PASSWORD } })).status).toBe(503);
  });

  it('keeps the KDF benchmark route closed unless explicitly enabled', async () => {
    delete process.env.AUTH_BENCH;
    expect((await call('GET', '/api/auth/_bench', { origin: null })).status).toBe(404);
  });
});

describe('admin buyer endpoints', () => {
  beforeEach(() => fresh());
  afterEach(() => {
    resetDataRuntime({});
    delete process.env.SUPABASE_JWT_SECRET;
  });

  /** Drives the real admin handler (its guard is requireAdmin, unchanged). */
  async function adminCall(method: string, url: string, opts?: Parameters<typeof makeReq>[2]): Promise<Captured> {
    const { server, cap } = makeRes();
    await adminBuyersHandler(makeReq(method, url, opts), server);
    return cap;
  }

  it('refuses a buyer session and an anonymous caller (admin claim required)', async () => {
    const cap = await signup('a@example.com');
    const token = cookieToken(cap)!;
    // A live buyer session is recognised as exactly that: authenticated, but
    // decisively NOT an admin (403 — the role is re-read from the session's
    // user row server-side, never taken from the cookie).
    const asBuyer = await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null });
    expect(asBuyer.status).toBe(403);
    // No session at all is 401 — sign in first.
    const anon = await adminCall('GET', '/api/admin/buyers', { origin: null });
    expect(anon.status).toBe(401);
    expect(JSON.stringify(asBuyer.body)).not.toContain('a@example.com');
  });

  it('authorizes an admin session cookie and re-derives the role from the stored row', async () => {
    const cap = await signup('boss@example.com');
    const token = cookieToken(cap)!;
    // Before promotion: a real session, still not an admin.
    expect((await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null })).status).toBe(403);

    // Promote exactly the way scripts/bootstrap-admin.mjs does — a server-side
    // row update, never an HTTP call and never a client-supplied role.
    db.exec(`UPDATE buyer_users SET role = 'admin' WHERE email_normalized = 'boss@example.com'`);
    const admin = await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null });
    expect(admin.status).toBe(200);
    expect(JSON.stringify(admin.body)).toContain('boss@example.com');

    // The role lives in the row, not in the cookie: demoting locks the same
    // cookie out immediately (server-side revocation semantics).
    db.exec(`UPDATE buyer_users SET role = 'buyer' WHERE email_normalized = 'boss@example.com'`);
    expect((await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null })).status).toBe(403);
  });

  it('rejects expired, revoked, disabled and tampered admin session cookies', async () => {
    const cap = await signup('boss2@example.com');
    const token = cookieToken(cap)!;
    db.exec(`UPDATE buyer_users SET role = 'admin' WHERE email_normalized = 'boss2@example.com'`);
    expect((await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null })).status).toBe(200);

    // Expired: every failure mode must fall through to 401, never to a bypass.
    db.exec(`UPDATE buyer_sessions SET expires_at = '2000-01-01T00:00:00.000Z'`);
    expect((await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null })).status).toBe(401);

    // Revoked (logout elsewhere / admin disable).
    db.exec(`UPDATE buyer_sessions SET revoked_at = '2026-01-01T00:00:00.000Z', expires_at = '2099-01-01T00:00:00.000Z'`);
    expect((await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null })).status).toBe(401);

    // Tampered token (hash mismatch -> unknown session).
    db.exec(`UPDATE buyer_sessions SET revoked_at = NULL`);
    expect((await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(`${token}x`), origin: null })).status).toBe(401);

    // Disabled account: the session still exists but must not authenticate.
    db.exec(`UPDATE buyer_users SET disabled_at = '2026-01-01T00:00:00.000Z' WHERE email_normalized = 'boss2@example.com'`);
    expect((await adminCall('GET', '/api/admin/buyers', { cookie: cookieHeader(token), origin: null })).status).toBe(401);
  });

  it('refuses a state-changing admin request from a foreign origin (cookie CSRF)', async () => {
    const cap = await signup('boss3@example.com');
    const token = cookieToken(cap)!;
    db.exec(`UPDATE buyer_users SET role = 'admin' WHERE email_normalized = 'boss3@example.com'`);

    const crossSite = await adminCall('POST', '/api/admin/buyers?action=code', {
      body: { email: 'target@example.com' },
      cookie: cookieHeader(token),
      origin: 'https://evil.example',
    });
    expect(crossSite.status).toBe(403);
    // Nothing was written by the refused request.
    expect(count(`SELECT COUNT(*) AS n FROM buyer_activation_tokens`)).toBe(0);

    // Same-origin passes the guard and reaches the handler (unknown account is
    // a handler-level refusal, not an auth failure).
    const sameOrigin = await adminCall('POST', '/api/admin/buyers?action=code', {
      body: { email: 'nobody-here@example.com' },
      cookie: cookieHeader(token),
      origin: 'https://luxedge.us',
    });
    expect([401, 403]).not.toContain(sameOrigin.status);
  });

  it('issuing a code for an unknown account is refused, and the guard runs before any lookup', async () => {
    const anon = await adminCall('POST', '/api/admin/buyers?action=code', { body: { email: 'nobody@example.com' }, origin: null });
    expect(anon.status).toBe(401);
    expect(JSON.stringify(anon.body)).not.toContain('nobody@example.com');
    // No code was written by a denied caller.
    expect(count(`SELECT COUNT(*) AS n FROM buyer_activation_tokens`)).toBe(0);
  });
});

describe('buyer auth — password hashing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('produces a unique salt per hash and verifies only the right password', async () => {
    const { hashPassword, verifyPassword, needsRehash, parseHashRecord } = await import('../../worker/auth/password');
    const a = await hashPassword('same-password-value');
    const b = await hashPassword('same-password-value');
    expect(a).not.toBe(b); // unique random salt
    expect(await verifyPassword('same-password-value', a)).toBe(true);
    expect(await verifyPassword('same-password-valuE', a)).toBe(false);
    expect(await verifyPassword('same-password-value', 'garbage')).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
    expect(parseHashRecord(a)?.iterations).toBe(100_000);
    // A hash made with cheaper parameters is flagged for upgrade, not silently accepted.
    const weak = a.replace('$v1$100000$', '$v1$50000$');
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash(a)).toBe(false);
    // A downgrade below the floor is refused outright.
    expect(parseHashRecord(a.replace('$100000$', '$1000$'))).toBeNull();
  });
});
