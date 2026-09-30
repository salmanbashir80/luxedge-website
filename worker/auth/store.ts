// ============================================================================
// LUXEDGE — BUYER AUTH STORE (Cloudflare D1)
//
// The persistence and policy half of buyer authentication: users, sessions,
// one-time activation codes, rate limits and an audit log. The HTTP layer
// (api/auth/index.ts) owns request parsing and responses; this module owns the
// security rules, so none of them can be forgotten by a new endpoint.
//
// SECURITY PROPERTIES (each one is covered by worker/__tests__/buyer-auth.test.ts):
//   * Passwords: PBKDF2-SHA256, versioned, per-user salt (worker/auth/password.ts).
//     Plaintext exists only inside a single function call and is never logged.
//   * Sessions: a 256-bit CSPRNG token in an HttpOnly + Secure + SameSite=Lax
//     cookie; D1 stores only its SHA-256. Expiry and revocation are re-checked
//     server-side on every request, so logout is immediately effective and a
//     copied cookie cannot outlive a revocation.
//   * Session fixation: a brand-new token is issued on every authentication
//     (login, activation, password change) and every other session for that user
//     is revoked on a password change.
//   * Identity is resolved from the session row, never from the request body or
//     a client-supplied id/role. There is no client-supplied role anywhere.
//   * Rate limits are durable and shared (D1), not per-isolate, so brute force
//     is actually bounded.
//   * Account enumeration: unknown emails and pending activations produce the
//     same generic failure AND the same KDF cost (burnPasswordTime).
// ============================================================================

import { getDataRuntime, type D1DatabaseLike } from '../d1/runtime';
import { hashPassword, needsRehash, PBKDF2_ITERATIONS, verifyPassword, burnPasswordTime } from './password';
import { generateActivationCode, normalizeActivationCode, randomToken, sha256Hex } from './tokens';

export const SESSION_COOKIE = 'lx_buyer';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const ACTIVATION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export interface BuyerUser {
  id: string;
  email: string;
  email_normalized: string;
  display_name: string | null;
  email_verified: number;
  requires_activation: number;
  disabled_at: string | null;
  created_at: string;
  last_login_at: string | null;
  password_hash: string | null;
  /**
   * 'buyer' (default) or 'admin'. Written only by trusted server-side code —
   * public signup never mentions this column, so it cannot be self-granted.
   * Read from the session's user row, never from the request.
   */
  role: string;
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

/**
 * The D1 binding, whenever one exists — deliberately NOT gated on
 * DATA_BACKEND. The buyer_* tables are new and self-contained, so sign-in must
 * keep working while the storefront reads are still pointed at Supabase (that
 * cutover is a separate, evidence-gated decision). Gating auth on the storefront
 * backend would 503 the Admin Console on production until the full cutover,
 * which is exactly the lockout this system was built to end.
 */
function authDb(): D1DatabaseLike | null {
  const rt = getDataRuntime();
  return rt.db;
}

/**
 * True when buyer auth can be served. The endpoint layer maps a false result to
 * a 503 — never to an open endpoint, and never to the legacy Supabase Auth path
 * (which is HTTP 402 and cannot be made to work at $0).
 */
export function buyerAuthAvailable(): boolean {
  return authDb() !== null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function changesOf(result: unknown): Promise<number> {
  const meta = (result as { meta?: { changes?: number } } | null)?.meta;
  return typeof meta?.changes === 'number' ? meta.changes : 0;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  const value = String(email || '').trim();
  if (value.length < 5 || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Password policy: length only (NIST SP 800-63B — composition rules reduce
 * security without adding any), with an upper bound so a password cannot be
 * used as a CPU-exhaustion vector.
 */
export function validPassword(password: unknown): { ok: boolean; message?: string } {
  if (typeof password !== 'string' || !password) return { ok: false, message: 'A password is required.' };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: `Your password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function findUserByEmail(email: string): Promise<BuyerUser | null> {
  const db = authDb();
  if (!db) return null;
  const res = await db
    .prepare(`SELECT * FROM buyer_users WHERE email_normalized = ? LIMIT 1`)
    .bind(normalizeEmail(email))
    .all<BuyerUser>();
  return (res?.results || [])[0] || null;
}

export async function findUserById(id: string): Promise<BuyerUser | null> {
  const db = authDb();
  if (!db) return null;
  const res = await db.prepare(`SELECT * FROM buyer_users WHERE id = ? LIMIT 1`).bind(id).all<BuyerUser>();
  return (res?.results || [])[0] || null;
}

export async function createUser(input: {
  email: string;
  displayName?: string | null;
  passwordHash?: string | null;
  requiresActivation?: boolean;
  legacyUserId?: string | null;
}): Promise<{ ok: true; user: BuyerUser } | { ok: false; reason: 'duplicate' | 'db_error' }> {
  const db = authDb();
  if (!db) return { ok: false, reason: 'db_error' };
  const id = crypto.randomUUID();
  const email = String(input.email).trim();
  const now = nowIso();
  try {
    await db
      .prepare(
        `INSERT INTO buyer_users (id, legacy_user_id, email, email_normalized, display_name, created_at, updated_at, email_verified, requires_activation, password_hash, password_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .bind(
        id, input.legacyUserId || null, email, normalizeEmail(email), input.displayName || null,
        now, now, input.requiresActivation ? 1 : 0, input.passwordHash || null,
        input.passwordHash ? now : null,
      )
      .run?.();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(message)) return { ok: false, reason: 'duplicate' };
    return { ok: false, reason: 'db_error' };
  }
  const created = await findUserById(id);
  if (!created) return { ok: false, reason: 'db_error' };
  return { ok: true, user: created };
}

/**
 * Store a new password hash, activate the account and revoke every other
 * session for that user (a password change must invalidate what the old
 * password could reach).
 */
export async function setUserPassword(
  userId: string,
  passwordHash: string,
  opts: { clearActivation?: boolean; keepSessionId?: string | null } = {},
): Promise<boolean> {
  const db = authDb();
  if (!db) return false;
  const now = nowIso();
  await db
    .prepare(
      `UPDATE buyer_users
          SET password_hash = ?, password_updated_at = ?, updated_at = ?,
              requires_activation = CASE WHEN ? THEN 0 ELSE requires_activation END
        WHERE id = ?`,
    )
    .bind(passwordHash, now, now, opts.clearActivation ? 1 : 0, userId)
    .run?.();
  await revokeAllSessions(userId, opts.keepSessionId || null);
  return true;
}

export async function touchLastLogin(userId: string): Promise<void> {
  const db = authDb();
  if (!db) return;
  const now = nowIso();
  await db.prepare(`UPDATE buyer_users SET last_login_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, userId).run?.();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

/** Issues a brand-new session and returns the cookie token (returned once). */
export async function createSession(userId: string, ttlSeconds = SESSION_TTL_SECONDS): Promise<{ token: string; expiresAt: string } | null> {
  const db = authDb();
  if (!db) return null;
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = plusSeconds(ttlSeconds);
  try {
    await db
      .prepare(`INSERT INTO buyer_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, tokenHash, nowIso(), expiresAt, nowIso())
      .run?.();
  } catch {
    return null;
  }
  return { token, expiresAt };
}

/**
 * Resolves the session cookie to a live user. Every failure mode — unknown
 * token, expired, revoked, disabled account — returns null, so callers cannot
 * accidentally treat a dead session as authenticated.
 */
export async function resolveSession(token: string | null | undefined): Promise<{ user: BuyerUser; session: SessionRecord } | null> {
  const db = authDb();
  if (!db || !token) return null;
  const tokenHash = await sha256Hex(token);
  const res = await db
    .prepare(`SELECT * FROM buyer_sessions WHERE token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .all<SessionRecord>();
  const session = (res?.results || [])[0];
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  const user = await findUserById(session.user_id);
  if (!user) return null;
  if (user.disabled_at) return null;

  // Throttle the liveness write: one per 5 minutes per session, not one per
  // request (D1 Free allows 100k rows written per day).
  const lastSeen = session as unknown as { last_seen_at?: string | null };
  const last = lastSeen.last_seen_at ? new Date(lastSeen.last_seen_at).getTime() : 0;
  if (Date.now() - last > 5 * 60_000) {
    await db.prepare(`UPDATE buyer_sessions SET last_seen_at = ? WHERE id = ?`).bind(nowIso(), session.id).run?.();
  }
  return { user, session };
}

export async function revokeSessionByToken(token: string | null | undefined): Promise<boolean> {
  const db = authDb();
  if (!db || !token) return false;
  const tokenHash = await sha256Hex(token);
  const res = await db
    .prepare(`UPDATE buyer_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(nowIso(), tokenHash)
    .run?.();
  return (await changesOf(res)) > 0;
}

/** Revokes every session for a user, optionally sparing the current one. */
export async function revokeAllSessions(userId: string, keepSessionId: string | null = null): Promise<number> {
  const db = authDb();
  if (!db) return 0;
  const now = nowIso();
  const res = keepSessionId
    ? await db
        .prepare(`UPDATE buyer_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`)
        .bind(now, userId, keepSessionId)
        .run?.()
    : await db
        .prepare(`UPDATE buyer_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
        .bind(now, userId)
        .run?.();
  return await changesOf(res);
}

/** Verifies a password and reports whether the stored hash needs upgrading. */
export async function verifyUserPassword(
  user: BuyerUser,
  password: string,
): Promise<{ ok: boolean; rehash: boolean }> {
  if (!user.password_hash) {
    // No password yet (activation pending): spend the same work so timing and
    // the response shape cannot be used to enumerate accounts.
    await burnPasswordTime();
    return { ok: false, rehash: false };
  }
  const ok = await verifyPassword(password, user.password_hash);
  return { ok, rehash: ok && needsRehash(user.password_hash) };
}

/** Transparently upgrades a legacy-strength hash after a successful sign-in. */
export async function rehashIfNeeded(userId: string, password: string): Promise<boolean> {
  const db = authDb();
  if (!db) return false;
  try {
    await db
      .prepare(`UPDATE buyer_users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?`)
      .bind(await hashPassword(password, PBKDF2_ITERATIONS), nowIso(), nowIso(), userId)
      .run?.();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Activation / reset codes (admin-issued — the $0 recovery path)
// ---------------------------------------------------------------------------

export async function issueActivationCode(input: {
  userId: string;
  createdBy?: string | null;
  ttlSeconds?: number;
}): Promise<{ code: string; expiresAt: string } | null> {
  const db = authDb();
  if (!db) return null;
  const code = generateActivationCode();
  const normalized = normalizeActivationCode(code);
  const tokenHash = await sha256Hex(normalized);
  const expiresAt = plusSeconds(input.ttlSeconds || ACTIVATION_TTL_SECONDS);
  try {
    // Regenerating revokes the previous code for that account, so an
    // intercepted old code can never be replayed after a new one is issued.
    await db
      .prepare(`UPDATE buyer_activation_tokens SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL`)
      .bind(nowIso(), input.userId)
      .run?.();
    await db
      .prepare(
        `INSERT INTO buyer_activation_tokens (id, user_id, token_hash, created_at, expires_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), input.userId, tokenHash, nowIso(), expiresAt, input.createdBy || null)
      .run?.();
    // The account now requires activation: the old password must not keep working.
    await db.prepare(`UPDATE buyer_users SET requires_activation = 1, updated_at = ? WHERE id = ?`).bind(nowIso(), input.userId).run?.();
  } catch {
    return null;
  }
  await audit('activation_code_issued', { actor: input.createdBy || 'admin', subjectUserId: input.userId });
  return { code, expiresAt };
}

export interface ActivationOutcome {
  ok: boolean;
  reason?: 'invalid' | 'expired' | 'used' | 'revoked' | 'db_error';
  userId?: string;
}

/**
 * Redeems a code and sets the new password. The single-use guarantee is the
 * conditional UPDATE (`WHERE used_at IS NULL`): two concurrent redemptions of
 * the same code cannot both report success.
 */
export async function redeemActivationCode(input: {
  email: string;
  code: string;
  newPasswordHash: string;
}): Promise<ActivationOutcome> {
  const db = authDb();
  if (!db) return { ok: false, reason: 'db_error' };
  const normalized = normalizeActivationCode(input.code);
  if (normalized.length < 8) return { ok: false, reason: 'invalid' };
  const tokenHash = await sha256Hex(normalized);
  const user = await findUserByEmail(input.email);
  if (!user) return { ok: false, reason: 'invalid' };

  const res = await db
    .prepare(`SELECT * FROM buyer_activation_tokens WHERE token_hash = ? AND user_id = ? LIMIT 1`)
    .bind(tokenHash, user.id)
    .all<{ id: string; expires_at: string; used_at: string | null; revoked_at: string | null }>();
  const row = (res?.results || [])[0];
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  const claimed = await db
    .prepare(`UPDATE buyer_activation_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`)
    .bind(nowIso(), row.id)
    .run?.();
  if ((await changesOf(claimed)) === 0) return { ok: false, reason: 'used' };

  await setUserPassword(user.id, input.newPasswordHash, { clearActivation: true });
  await audit('activation_redeemed', { actor: 'buyer', subjectUserId: user.id });
  return { ok: true, userId: user.id };
}

export async function countActiveActivationCodes(userId: string): Promise<number> {
  const db = authDb();
  if (!db) return 0;
  const res = await db
    .prepare(`SELECT COUNT(*) AS n FROM buyer_activation_tokens WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
    .bind(userId, nowIso())
    .all<{ n: number }>();
  return Number((res?.results || [])[0]?.n || 0);
}

// ---------------------------------------------------------------------------
// Rate limiting (durable, shared across isolates)
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window limiter. The window and the counter live in one row, updated by
 * a single atomic upsert, so parallel requests cannot each slip through.
 */
export async function consumeRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const db = authDb();
  if (!db) return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  const windowStart = new Date(now - windowSeconds * 1000).toISOString();
  const freshStart = nowText;
  try {
    const res = await db
      .prepare(
        `INSERT INTO buyer_rate_limits (bucket, window_started_at, count) VALUES (?, ?, 1)
         ON CONFLICT(bucket) DO UPDATE SET
           count = CASE WHEN buyer_rate_limits.window_started_at <= ? THEN 1 ELSE buyer_rate_limits.count + 1 END,
           window_started_at = CASE WHEN buyer_rate_limits.window_started_at <= ? THEN ? ELSE buyer_rate_limits.window_started_at END
         RETURNING count, window_started_at`,
      )
      .bind(bucket, freshStart, windowStart, windowStart, freshStart)
      .all<{ count: number; window_started_at: string }>();
    const row = (res?.results || [])[0];
    const count = Number(row?.count || 1);
    const startedAt = row?.window_started_at ? new Date(row.window_started_at).getTime() : now;
    const retryAfter = Math.max(1, Math.ceil((startedAt + windowSeconds * 1000 - now) / 1000));
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: retryAfter };
  } catch {
    // Fail CLOSED: an unusable limiter must not become an unlimited login form.
    return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function audit(
  action: string,
  opts: { actor?: string | null; subjectUserId?: string | null; detail?: string | null } = {},
): Promise<void> {
  const db = authDb();
  if (!db) return;
  try {
    await db
      .prepare(`INSERT INTO buyer_auth_audit (id, at, action, actor, subject_user_id, detail) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), nowIso(), action, opts.actor || null, opts.subjectUserId || null, opts.detail || null)
      .run?.();
  } catch {
    /* audit must never break the request it records */
  }
}

export async function recentAudit(limit = 50): Promise<Array<Record<string, unknown>>> {
  const db = authDb();
  if (!db) return [];
  const res = await db
    .prepare(`SELECT at, action, actor, subject_user_id FROM buyer_auth_audit ORDER BY at DESC LIMIT ?`)
    .bind(limit)
    .all<Record<string, unknown>>();
  return res?.results || [];
}

// ---------------------------------------------------------------------------
// Cookies + request guards
// ---------------------------------------------------------------------------

export function readCookie(headerValue: string | undefined, name: string): string | null {
  if (!headerValue) return null;
  for (const part of headerValue.split(';')) {
    const [k, ...rest] = part.split('=');
    if (k && k.trim() === name) return rest.join('=').trim() || null;
  }
  return null;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  // SameSite=Lax (not None): the checkout POSTs are same-origin, and Lax means a
  // cross-site form post cannot carry the session at all.
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * CSRF/DNS-rebinding guard for state-changing requests: the browser must name
 * an origin we serve, and the body must be JSON (a cross-site HTML form can
 * only send urlencoded/text/plain, all of which are rejected here).
 */
export function stateChangingRequestAllowed(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: string[],
): { ok: boolean; message?: string } {
  const origin = String(headers.origin || '').trim();
  if (!origin) return { ok: false, message: 'Missing Origin header.' };
  if (!allowedOrigins.includes(origin.toLowerCase())) return { ok: false, message: 'Cross-origin request refused.' };
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) return { ok: false, message: 'Content-Type must be application/json.' };
  return { ok: true };
}

/** Production origins, extendable by var for staging/preview deploys. */
export function allowedOrigins(): string[] {
  const configured = String(process.env.AUTH_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  const base = ['https://luxedge.us', 'https://www.luxedge.us'];
  return [...new Set([...base, ...configured])];
}

export { PBKDF2_ITERATIONS };
