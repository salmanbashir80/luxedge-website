// ============================================================================
// LUXEDGE — BUYER AUTH CLIENT (browser)
//
// Browser half of the Cloudflare/D1 buyer authentication (api/auth/index.ts).
// It talks to our OWN origin's /api/auth/* routes; nothing here holds a token
// in localStorage, because the session is an HttpOnly cookie the page cannot
// read — that is the point of moving off Supabase Auth, where the session lived
// in JS-accessible storage.
//
// ADMIN AUTH IS DELIBERATELY UNTOUCHED: admin sign-in still uses the existing
// verified-JWT path in src/services/supabase.ts. This module never handles an
// admin credential and never reads a role — an admin role must keep coming from
// a verified server-side claim, never from a buyer session.
//
// HONESTY RULES:
//   * No client-side availability guessing beyond a probe of /api/auth/me.
//   * No fake success: a failure returns ok:false with the server's message.
//   * A password is passed straight through and never stored or logged.
// ============================================================================

export interface BuyerUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  requiresActivation: boolean;
}

export interface BuyerResult {
  ok: boolean;
  user: BuyerUser | null;
  message: string;
  /** Machine-readable reason from the server (e.g. ACTIVATION_REQUIRED). */
  code?: string;
}

const BASE = '/api/auth';

async function call(path: string, init: RequestInit): Promise<BuyerResult> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      // The session is a cookie: it must be sent (and set) on this origin only.
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    });
    let body: Record<string, unknown> = {};
    try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
    if (!res.ok) {
      return {
        ok: false,
        user: null,
        message: String(body.error || `Request failed (HTTP ${res.status}).`),
        code: typeof body.code === 'string' ? body.code : undefined,
      };
    }
    return { ok: true, user: (body.user as BuyerUser) || null, message: '' };
  } catch {
    return { ok: false, user: null, message: 'Could not reach the store. Please check your connection and try again.' };
  }
}

/** True when the buyer auth routes are actually serving (503 = not configured). */
export async function buyerAuthAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/me`, { credentials: 'same-origin' });
    return res.status !== 503 && res.status !== 404;
  } catch {
    return false;
  }
}

/** The signed-in buyer from the session cookie, or null. */
export async function buyerMe(): Promise<BuyerUser | null> {
  try {
    const res = await fetch(`${BASE}/me`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: BuyerUser };
    return body.user || null;
  } catch {
    return null;
  }
}

export function buyerSignUp(email: string, password: string, displayName?: string): Promise<BuyerResult> {
  return call('/signup', { method: 'POST', body: JSON.stringify({ email, password, displayName }) });
}

export function buyerSignIn(email: string, password: string): Promise<BuyerResult> {
  return call('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function buyerSignOut(): Promise<BuyerResult> {
  return call('/logout', { method: 'POST', body: '{}' });
}

/** Redeem an admin-issued one-time code and choose a new password. */
export function buyerActivate(email: string, code: string, password: string): Promise<BuyerResult> {
  return call('/activate', { method: 'POST', body: JSON.stringify({ email, code, password }) });
}

export function buyerChangePassword(currentPassword: string, newPassword: string): Promise<BuyerResult> {
  return call('/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

/**
 * Buyer-facing message for a failed sign-in. Deliberately generic for bad
 * credentials (never reveals whether an email has an account) while remaining
 * specific when the server told us something actionable.
 */
export function buyerSignInMessage(result: BuyerResult): string {
  switch (result.code) {
    case 'ACTIVATION_REQUIRED':
      return 'This account needs a one-time activation code first — please contact us and we will send you one.';
    case 'DISABLED':
      return result.message;
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'AUTH_UNAVAILABLE':
      return 'Accounts are temporarily unavailable. Please try again shortly.';
    case 'INVALID_CREDENTIALS':
      return 'Email or password is incorrect.';
    default:
      return result.message || 'Sign-in failed.';
  }
}
