// ============================================================================
// LUXEDGE V2 — API AUTH GUARD (serverless)
//
// Protects credit-consuming / sensitive endpoints (/api/ai/*, /api/fetch-page).
//
// Contract:
//   - No Authorization header            -> 401 Unauthorized
//   - Invalid / expired / tampered token -> 401 Unauthorized
//   - Valid token, role != admin         -> 403 Forbidden
//   - No verification configured        -> 503 (fail closed — never open)
//
// Verification strategy (both enforce the same admin claim):
//   1. Local HS256 verification when SUPABASE_JWT_SECRET is set (fast, no
//      network) — preferred.
//   2. Remote validation via GET {SUPABASE_URL}/auth/v1/user when the JWT
//      secret is absent but VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are
//      configured server-side. The endpoint returns 401 for invalid tokens
//      and the user's app_metadata.role is the same trusted claim RLS uses.
//
// The role claim is read from the VERIFIED token (app_metadata.role), never
// from a browser-supplied field.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyJwtHs256, isAdminClaim, type VerifiedJwt } from './jwt.js';
import { sendJson } from './providers.js';
import { allowedOrigins, readCookie, resolveSession, SESSION_COOKIE } from '../../worker/auth/store';

export interface AuthResult {
  ok: true;
  payload: VerifiedJwt;
}
export interface AuthFailure {
  ok: false;
  status: number;
  error: string;
}
export type AuthDecision = AuthResult | AuthFailure;

/** Extract a Bearer token from the Authorization header. */
export function getBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (!header) return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

/**
 * Remote admin verification against the live Supabase project. The user's
 * access token is validated by Supabase itself; the admin role claim is read
 * from the returned user record's app_metadata. Never exposes secrets.
 */
async function remoteVerifyAdmin(token: string, requireAdmin = true): Promise<AuthDecision> {
  const url = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    return { ok: false, status: 503, error: 'Authentication is not configured on this deployment. Set SUPABASE_JWT_SECRET (or VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY) — see .env.example.' };
  }
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 502, error: 'Auth service is unreachable right now.' };
  }
  // Supabase answers 401 for missing tokens and 403 bad_jwt for malformed/
  // invalid ones — both mean the session is not valid.
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 401, error: 'Unauthorized — invalid or expired session.' };
  }
  if (!res.ok) {
    return { ok: false, status: 502, error: `Auth service error (HTTP ${res.status}).` };
  }
  const user = (await res.json().catch(() => null)) as {
    id?: string;
    email?: string;
    app_metadata?: { role?: string };
    user_metadata?: Record<string, unknown>;
  } | null;
  if (!user?.id) {
    return { ok: false, status: 502, error: 'Auth service returned an invalid response.' };
  }
  if (requireAdmin && user.app_metadata?.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden — admin role required.' };
  }
  return {
    ok: true,
    payload: { sub: user.id, email: user.email, app_metadata: user.app_metadata, user_metadata: user.user_metadata },
  };
}

/**
 * Admin verification through the Cloudflare/D1 session cookie — the path that
 * works while Supabase Auth is restricted (HTTP 402) and therefore cannot mint
 * the JWTs this guard used to require.
 *
 * Security properties:
 *   * The identity is resolved server-side from the session row (D1), never
 *     from the request body or a client-supplied id/role.
 *   * The cookie is HttpOnly + Secure + SameSite=Lax, so a cross-site form
 *     cannot carry it at all; as defence in depth, a state-changing request
 *     whose Origin is present but not one of ours is refused outright.
 *   * A dead/expired/revoked cookie returns null, so the caller falls through
 *     to the JWT paths below — rollback behaviour is completely unchanged.
 *
 * Returns null when the request carries no usable session cookie.
 */
async function sessionAdmin(req: IncomingMessage): Promise<AuthDecision | null> {
  const rawCookie = req.headers.cookie;
  const header = Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie;
  const token = readCookie(header || undefined, SESSION_COOKIE);
  if (!token) return null;

  const resolved = await resolveSession(token);
  if (!resolved) return null; // unknown/expired/revoked/disabled -> fall through

  if (resolved.user.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden — admin role required.' };
  }

  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = String(req.headers.origin || '').trim().toLowerCase();
    if (origin && !allowedOrigins().includes(origin)) {
      return { ok: false, status: 403, error: 'Cross-origin request refused.' };
    }
  }

  return {
    ok: true,
    payload: {
      sub: resolved.user.id,
      email: resolved.user.email,
      app_metadata: { role: 'admin' },
      user_metadata: {},
    },
  };
}

/** Verify the admin identity from the request. Never trusts client input. */
export async function adminAuth(req: IncomingMessage): Promise<AuthDecision> {
  // 1) D1 session cookie (primary): works with Supabase Auth restricted. A
  //    decisive failure (live session that is not an admin) returns immediately
  //    so a buyer cookie can never be laundered through a stale JWT below.
  const fromSession = await sessionAdmin(req);
  if (fromSession) return fromSession;

  // 2) Legacy Supabase JWT paths — kept intact for rollback.
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Unauthorized — sign in to the admin dashboard first.' };
  }
  const secret = (process.env.SUPABASE_JWT_SECRET || '').trim();
  if (secret) {
    let payload: VerifiedJwt;
    try {
      payload = verifyJwtHs256(token, secret);
    } catch (e) {
      return { ok: false, status: 401, error: `Unauthorized — ${(e as Error).message}.` };
    }
    if (!isAdminClaim(payload)) {
      return { ok: false, status: 403, error: 'Forbidden — admin role required.' };
    }
    return { ok: true, payload };
  }
  return remoteVerifyAdmin(token);
}

/** Convenience: enforce admin auth and send the failure response if denied. */
export async function requireAdmin(req: IncomingMessage, res: ServerResponse): Promise<VerifiedJwt | null> {
  const decision = await adminAuth(req);
  if (!decision.ok) {
    sendJson(res, decision.status, { error: decision.error });
    return null;
  }
  return decision.payload;
}
