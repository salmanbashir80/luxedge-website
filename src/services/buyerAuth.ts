// ============================================================================
// LUXEDGE — BUYER AUTH CLIENT (browser)
//
// Browser half of the Cloudflare/D1 buyer authentication (api/auth/index.ts).
// It talks to our OWN origin's /api/auth/* routes; nothing here holds a token
// in localStorage, because the session is an HttpOnly cookie the page cannot
// read — that is the point of moving off Supabase Auth, where the session lived
// in JS-accessible storage.
//
// ADMIN SIGN-IN ALSO COMES THROUGH HERE (same routes, stricter gate): Supabase
// Auth — which used to mint the admin JWT — is restricted by the project-wide
// HTTP 402, so the Admin Console login form answered "HTTP 402" and locked the
// owner out. The admin role itself is never taken from this response for
// authorization purposes: it is re-derived server-side from the session row in
// api/_lib/auth.ts on every guarded request, so a client that lied about its
// role would still be refused.
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
  /** Server-derived (migration 0004). Display/gating only — never trusted. */
  role: 'admin' | 'buyer';
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

export interface BuyerForgotResult {
  ok: boolean;
  message: string;
  /** Server-chosen description of the delivery channel (no personal data). */
  channel?: 'email-operator' | 'operator-manual';
  /**
   * Whether this deployment can email the code at all. A deployment-wide fact —
   * deliberately not "was a message sent for this address", which would tell
   * anyone posting the form whether an account exists.
   */
  deliverable?: boolean;
}

/**
 * Ask for a one-time recovery code for an email address.
 *
 * The server never says whether the address has an account (that would be an
 * enumeration oracle) and never lets the caller choose the recipient: at $0 the
 * only deliverable address is the operator's verified inbox, so the honest
 * outcome is "the code was emailed to the store owner". The returned message is
 * the server's own, so nothing here can claim a delivery that did not happen.
 */
export async function buyerRequestCode(email: string): Promise<BuyerForgotResult> {
  try {
    const res = await fetch(`${BASE}/forgot`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    let body: Record<string, unknown> = {};
    try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
    if (!res.ok) {
      return { ok: false, message: String(body.error || `Request failed (HTTP ${res.status}).`) };
    }
    return {
      ok: true,
      message: String(body.message || 'If that email has an account here, a one-time code has been issued for it.'),
      channel: body.channel as BuyerForgotResult['channel'],
      deliverable: body.channel === 'email-operator',
    };
  } catch {
    return { ok: false, message: 'Could not reach the store. Please check your connection and try again.' };
  }
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
      return 'This account needs a one-time activation code first — use “Send me a recovery code” below and one will be emailed to the store owner.';
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
