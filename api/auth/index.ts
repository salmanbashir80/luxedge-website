// ============================================================================
// LUXEDGE — BUYER AUTH ENDPOINTS (/api/auth/*)
//
// Replaces Supabase Auth for buyers. Supabase Auth returns HTTP 402 for the
// whole project (exceed_egress_quota), so sign-in has been impossible; this is
// the $0 Cloudflare-native replacement. Admin authentication is deliberately
// NOT touched — it keeps its existing verified-JWT route (api/_lib/auth.ts).
//
//   POST /api/auth/signup    email + password + optional name
//   POST /api/auth/login     email + password            -> session cookie
//   POST /api/auth/logout    (authenticated)             -> revokes the session
//   GET  /api/auth/me        (authenticated)             -> the signed-in buyer
//   POST /api/auth/activate  email + one-time code + new password
//   POST /api/auth/forgot    email                     -> code mailed to the operator
//   POST /api/auth/password  current + new password (authenticated)
//   GET  /api/auth/_bench    KDF benchmark, ONLY when AUTH_BENCH=1 (staging)
//
// RULES APPLIED TO EVERY ROUTE:
//   * Identity comes from the session cookie resolved server-side. No route
//     accepts a user id or a role from the body, so none can be spoofed.
//   * Passwords are never logged, never echoed, never put in a URL, and never
//     returned — success responses name the user, never the secret.
//   * State-changing routes require a same-origin Origin header and a JSON
//     content type (see stateChangingRequestAllowed).
//   * Login/activation/signup failures are generic and cost the same KDF time,
//     so responses cannot be used to enumerate accounts.
//   * Rate limits are durable (D1), not per-isolate.
//   * If the auth datastore is unavailable every route answers 503 — it never
//     falls back to the restricted Supabase Auth and never fails open.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientIp, readJsonBody, sendJson } from '../_lib/providers.js';
import { benchmarkPbkdf2, hashPassword } from '../../worker/auth/password';
import {
  ACTIVATION_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  allowedOrigins,
  audit,
  buyerAuthAvailable,
  clearSessionCookie,
  consumeRateLimit,
  createSession,
  createUser,
  findUserByEmail,
  issueActivationCode,
  readCookie,
  redeemActivationCode,
  rehashIfNeeded,
  resolveSession,
  revokeSessionByToken,
  SESSION_COOKIE,
  sessionCookie,
  setUserPassword,
  stateChangingRequestAllowed,
  touchLastLogin,
  validEmail,
  validPassword,
  verifyUserPassword,
} from '../../worker/auth/store';

interface BuyerRow {
  id: string;
  email: string;
  display_name: string | null;
  email_verified: number;
  requires_activation: number;
  /** Present since migration 0004; treated as 'buyer' when absent. */
  role?: string | null;
}

/** Public projection of a buyer — never includes a hash, id-free of secrets. */
function publicUser(user: BuyerRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    // Reported honestly: signup cannot send a verification email at $0, so this
    // stays false until a mailbox is actually proven. It is never faked true.
    emailVerified: user.email_verified === 1,
    requiresActivation: user.requires_activation === 1,
    // Server-derived from the stored row (0004) — the client checks it, the
    // server never accepts it. Anything that is not 'admin' is a buyer.
    role: user.role === 'admin' ? 'admin' : 'buyer',
  };
}

function cookieHeader(req: IncomingMessage): string | undefined {
  const value = req.headers.cookie;
  return Array.isArray(value) ? value.join('; ') : value;
}

function setCookie(res: ServerResponse, cookie: string): void {
  res.setHeader('Set-Cookie', cookie);
}

/** A 503 here means "buyer auth is not configured", never "come on in". */
function unavailable(res: ServerResponse): void {
  sendJson(res, 503, {
    error: 'Buyer accounts are temporarily unavailable. Please try again shortly.',
    code: 'AUTH_UNAVAILABLE',
  });
}

// ---------------------------------------------------------------------------
// Self-service recovery delivery
//
// The $0 constraint, stated plainly: Cloudflare's only email binding is
// `send_email`, and on the free plan it will deliver to addresses verified in
// the account — not to an arbitrary recipient. So a code CANNOT be mailed to
// whoever typed their address into a form. It is mailed to the one verified
// destination the account owns (the store operator), who then hands it over.
// That is not a workaround for a missing feature: it is the same trust model as
// the admin-issued codes this replaces, with the request automated. The
// recipient is a server constant and is never taken from the request, so this
// route cannot be turned into a relay that mails attacker-controlled content
// anywhere.
// ---------------------------------------------------------------------------

/** The verified Cloudflare destination address (wrangler.toml [[send_email]]). */
export const RECOVERY_MAIL_TO = '8002salman@gmail.com';
const RECOVERY_MAIL_FROM = 'sales@luxedge.us';

interface MailBinding {
  send: (msg: { from: string; to: string; subject: string; html?: string; text?: string }) => Promise<void>;
}

interface EnvWithMail {
  SEND_MAIL?: MailBinding;
  /** Optional override of the operator inbox; absent in both deployments. */
  AUTH_RECOVERY_EMAIL?: string;
}

function mailEnv(req: IncomingMessage): EnvWithMail | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (req as any).env as EnvWithMail | undefined;
}

/**
 * Mails a one-time code to the operator inbox. Returns whether the message was
 * actually handed to the binding — never a lie, and never the code itself in the
 * response. `to` is chosen server-side only.
 */
async function deliverRecoveryCode(
  req: IncomingMessage,
  input: { accountEmail: string; code: string; expiresAt: string },
): Promise<{ configured: boolean; sent: boolean; destination: string | null; error?: string }> {
  const env = mailEnv(req);
  const binding = env?.SEND_MAIL;
  const override = String(env?.AUTH_RECOVERY_EMAIL || '').trim();
  const to = override || RECOVERY_MAIL_TO;
  if (!binding) return { configured: false, sent: false, destination: null };

  const code = input.code;
  const text = [
    'LUXEDGE — one-time account recovery code',
    '',
    `Account : ${input.accountEmail}`,
    `Code    : ${code}`,
    `Expires : ${input.expiresAt}`,
    '',
    'The account holder enters this code on the sign-in page together with a',
    'new password (minimum 10 characters). The code works once and expires.',
    '',
    'If you did not expect this request, ignore it — the account password is',
    'unchanged until the code is redeemed.',
  ].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111"><p><strong>Luxedge — one-time account recovery code</strong></p><p>Account: <code>${input.accountEmail}</code><br/>Code: <strong style="font-size:20px;letter-spacing:2px">${code}</strong><br/>Expires: ${input.expiresAt}</p><p>The account holder enters this code on the sign-in page together with a new password (minimum 10 characters). The code works once and expires.</p><p style="color:#666">If you did not expect this request, ignore it — the account password is unchanged until the code is redeemed.</p></div>`;

  try {
    await binding.send({
      from: RECOVERY_MAIL_FROM,
      to,
      subject: `Luxedge recovery code for ${input.accountEmail}`,
      text,
      html,
    });
    return { configured: true, sent: true, destination: to };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    await audit('recovery_code_mail_failed', { actor: 'system', detail: msg.slice(0, 200) });
    return { configured: true, sent: false, destination: to, error: msg.slice(0, 200) };
  }
}

function guardStateChanging(req: IncomingMessage, res: ServerResponse): boolean {
  const verdict = stateChangingRequestAllowed(req.headers as Record<string, string | string[] | undefined>, allowedOrigins());
  if (!verdict.ok) {
    sendJson(res, 403, { error: verdict.message || 'Request refused.' });
    return false;
  }
  return true;
}

async function limitOr429(res: ServerResponse, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const result = await consumeRateLimit(bucket, limit, windowSeconds);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  sendJson(res, 429, { error: 'Too many attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED' });
  return false;
}

// ---------------------------------------------------------------------------
// POST /api/auth/signup
// ---------------------------------------------------------------------------
async function signup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!guardStateChanging(req, res)) return;
  const ip = clientIp(req);
  if (!(await limitOr429(res, `signup:ip:${ip}`, 5, 3600))) return;

  let body: Record<string, unknown>;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }

  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 120) : null;

  if (!validEmail(email)) { sendJson(res, 400, { error: 'Please enter a valid email address.' }); return; }
  const pw = validPassword(password);
  if (!pw.ok) { sendJson(res, 400, { error: pw.message }); return; }

  const existing = await findUserByEmail(email);
  if (existing) {
    await audit('signup_duplicate', { actor: 'buyer', detail: 'email already registered' });
    sendJson(res, 409, {
      error: 'An account already exists for this email. Sign in, or ask us for a one-time reset code.',
      code: 'EMAIL_IN_USE',
    });
    return;
  }

  const created = await createUser({
    email,
    displayName,
    passwordHash: await hashPassword(password),
    requiresActivation: false,
  });
  if (!created.ok) {
    if (created.reason === 'duplicate') {
      sendJson(res, 409, { error: 'An account already exists for this email.', code: 'EMAIL_IN_USE' });
      return;
    }
    sendJson(res, 503, { error: 'Could not create your account right now. Please try again.', code: 'DB_ERROR' });
    return;
  }

  const session = await createSession(created.user.id);
  if (!session) { sendJson(res, 503, { error: 'Could not start your session. Please sign in.', code: 'DB_ERROR' }); return; }
  await audit('signup', { actor: 'buyer', subjectUserId: created.user.id });
  setCookie(res, sessionCookie(session.token));
  sendJson(res, 200, {
    ok: true,
    user: publicUser(created.user as unknown as BuyerRow),
    // Stated plainly rather than implied: no verification email is sent.
    emailVerification: {
      sent: false,
      reason: 'No transactional email provider is configured, so no verification message was sent. Your account works, but email ownership is not yet proven.',
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!guardStateChanging(req, res)) return;
  const ip = clientIp(req);

  let body: Record<string, unknown>;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }

  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) { sendJson(res, 400, { error: 'Email and password are required.' }); return; }

  // Two buckets: per-IP (credential stuffing across accounts) and per-account
  // (targeted guessing), both durable and shared.
  if (!(await limitOr429(res, `login:ip:${ip}`, 30, 900))) return;
  if (!(await limitOr429(res, `login:email:${email.toLowerCase()}`, 10, 900))) return;

  const user = await findUserByEmail(email);
  const generic = { error: 'Email or password is incorrect.', code: 'INVALID_CREDENTIALS' };

  if (!user) {
    // Same cost as a real verification so the failure cannot be timed apart.
    await verifyUserPassword({ password_hash: null } as never, password);
    await audit('login_failed', { actor: 'buyer', detail: 'unknown email' });
    sendJson(res, 401, generic);
    return;
  }
  if (user.disabled_at) {
    await verifyUserPassword({ password_hash: null } as never, password);
    sendJson(res, 403, { error: 'This account has been disabled. Please contact support.', code: 'DISABLED' });
    return;
  }
  if (user.requires_activation || !user.password_hash) {
    await verifyUserPassword({ password_hash: null } as never, password);
    sendJson(res, 403, {
      error: 'This account still needs a one-time activation code. Please contact us for a code.',
      code: 'ACTIVATION_REQUIRED',
    });
    return;
  }

  const verdict = await verifyUserPassword(user, password);
  if (!verdict.ok) {
    await audit('login_failed', { actor: 'buyer', subjectUserId: user.id });
    sendJson(res, 401, generic);
    return;
  }

  // Session fixation defence: a fresh token every authentication.
  const session = await createSession(user.id);
  if (!session) { sendJson(res, 503, { error: 'Could not start your session. Please try again.', code: 'DB_ERROR' }); return; }
  if (verdict.rehash) await rehashIfNeeded(user.id, password);
  await touchLastLogin(user.id);
  await audit('login', { actor: 'buyer', subjectUserId: user.id });
  setCookie(res, sessionCookie(session.token));
  sendJson(res, 200, { ok: true, user: publicUser(user as unknown as BuyerRow) });
}

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!guardStateChanging(req, res)) return;
  const token = readCookie(cookieHeader(req), SESSION_COOKIE);
  await revokeSessionByToken(token);
  setCookie(res, clearSessionCookie());
  sendJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
async function me(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  const token = readCookie(cookieHeader(req), SESSION_COOKIE);
  const resolved = await resolveSession(token);
  if (!resolved) { sendJson(res, 401, { error: 'Not signed in.', code: 'UNAUTHENTICATED' }); return; }
  sendJson(res, 200, { ok: true, user: publicUser(resolved.user as unknown as BuyerRow) });
}

// ---------------------------------------------------------------------------
// POST /api/auth/activate — email + one-time admin-issued code + new password
// ---------------------------------------------------------------------------
async function activate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!guardStateChanging(req, res)) return;
  const ip = clientIp(req);

  let body: Record<string, unknown>;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }

  const email = String(body.email || '').trim();
  const code = String(body.code || '');
  const password = String(body.password || '');
  if (!validEmail(email)) { sendJson(res, 400, { error: 'Please enter a valid email address.' }); return; }
  if (!code) { sendJson(res, 400, { error: 'Please enter the one-time code.' }); return; }
  const pw = validPassword(password);
  if (!pw.ok) { sendJson(res, 400, { error: pw.message }); return; }

  // Redemption is brute-forceable in principle (the code is short), so it is
  // rate limited per IP and per account before any lookup happens.
  if (!(await limitOr429(res, `activate:ip:${ip}`, 20, 3600))) return;
  if (!(await limitOr429(res, `activate:email:${email.toLowerCase()}`, 6, 900))) return;

  const outcome = await redeemActivationCode({
    email,
    code,
    newPasswordHash: await hashPassword(password),
  });
  if (!outcome.ok) {
    await audit('activation_failed', { actor: 'buyer', detail: outcome.reason || 'invalid' });
    const messages: Record<string, string> = {
      invalid: 'That email and code combination is not valid.',
      expired: 'That code has expired. Please ask us for a new one.',
      used: 'That code has already been used. Please ask us for a new one.',
      revoked: 'That code is no longer valid. Please ask us for a new one.',
      db_error: 'Could not activate your account right now. Please try again.',
    };
    const status = outcome.reason === 'db_error' ? 503 : 400;
    sendJson(res, status, { error: messages[outcome.reason || 'invalid'], code: (outcome.reason || 'invalid').toUpperCase() });
    return;
  }

  const user = await findUserByEmail(email);
  if (!user) { sendJson(res, 503, { error: 'Your account could not be loaded. Please sign in.', code: 'DB_ERROR' }); return; }
  const session = await createSession(user.id);
  if (!session) { sendJson(res, 503, { error: 'Your password was set, but the session could not start. Please sign in.', code: 'DB_ERROR' }); return; }
  await touchLastLogin(user.id);
  setCookie(res, sessionCookie(session.token));
  sendJson(res, 200, { ok: true, user: publicUser(user as unknown as BuyerRow) });
}

// ---------------------------------------------------------------------------
// POST /api/auth/forgot — "send me a one-time code"
//
// Deliberately indistinguishable for known and unknown addresses: same status,
// same body, same code path. A route that answered differently would be an
// account-enumeration oracle for a form anyone can post to. The only difference
// is server-side (whether a code was actually issued), and the code goes to the
// operator inbox — never to the requester.
// ---------------------------------------------------------------------------
async function forgot(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!guardStateChanging(req, res)) return;
  const ip = clientIp(req);

  let body: Record<string, unknown>;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }

  const email = String(body.email || '').trim();
  if (!validEmail(email)) { sendJson(res, 400, { error: 'Please enter a valid email address.' }); return; }

  // Per-IP bounds automated abuse across many accounts; per-address bounds
  // repeated requests against one account (each issue revokes the previous
  // code, so a flood would also keep invalidating a legitimate code).
  if (!(await limitOr429(res, `forgot:ip:${ip}`, 10, 3600))) return;
  if (!(await limitOr429(res, `forgot:email:${email.toLowerCase()}`, 3, 3600))) return;

  const env = mailEnv(req);
  const user = await findUserByEmail(email);
  const deliverable = !!env?.SEND_MAIL;

  // Only issue when the code can actually reach a human. Issuing into a
  // deployment that cannot deliver would revoke a previously relayed code that
  // the account holder may still be about to use, for no benefit at all.
  if (deliverable && user && !user.disabled_at) {
    const issued = await issueActivationCode({
      userId: user.id,
      createdBy: 'self-service',
      // Never lock a working account just because someone typed its address: the
      // requester cannot read the code, so a request must not be able to deny
      // the real owner their existing password.
      markRequiresActivation: !user.password_hash,
    });
    if (issued) {
      await audit('recovery_code_requested', { actor: 'buyer', subjectUserId: user.id });
      // Logged as its own event so "was the code actually mailed?" is
      // answerable from the audit trail without ever storing the code.
      const outcome = await deliverRecoveryCode(req, {
        accountEmail: user.email,
        code: issued.code,
        expiresAt: issued.expiresAt,
      });
      // Whether anything was actually mailed is deliberately NOT part of the
      // response: that flag differs between a known and an unknown address and
      // would turn this route into the very enumeration oracle the identical
      // wording exists to prevent. The audit log records it instead.
      if (outcome.sent) await audit('recovery_code_mailed', { actor: 'system', subjectUserId: user.id });
    }
  }

  // The wording reflects the delivery channel (a deployment-wide fact, equal
  // for every caller), never the account (a secret).
  sendJson(res, 200, {
    ok: true,
    // Email is the only channel here, so when the binding is absent the honest
    // answer is "ask us" — a dead end is worse than a slightly less crisp
    // message, and pretending a message was sent would be a lie.
    channel: deliverable ? 'email-operator' : 'operator-manual',
    delivery: { configured: deliverable },
    message: deliverable
      ? 'If that email has an account here, a one-time code has been emailed to the store owner, who will pass it on to the account holder. It expires in 14 days and works once.'
      : 'If that email has an account here, a one-time reset code can be issued for it. Automated email is not available on this deployment, so please contact us and we will send it to you directly.',
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/password — authenticated password change
// ---------------------------------------------------------------------------
async function changePassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!guardStateChanging(req, res)) return;
  const token = readCookie(cookieHeader(req), SESSION_COOKIE);
  const resolved = await resolveSession(token);
  if (!resolved) { sendJson(res, 401, { error: 'Not signed in.', code: 'UNAUTHENTICATED' }); return; }
  if (!(await limitOr429(res, `password:user:${resolved.user.id}`, 10, 3600))) return;

  let body: Record<string, unknown>;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }
  const current = String(body.currentPassword || '');
  const next = String(body.newPassword || '');
  const pw = validPassword(next);
  if (!pw.ok) { sendJson(res, 400, { error: pw.message }); return; }

  const verdict = await verifyUserPassword(resolved.user, current);
  if (!verdict.ok) {
    await audit('password_change_failed', { actor: 'buyer', subjectUserId: resolved.user.id });
    sendJson(res, 401, { error: 'Your current password is incorrect.', code: 'INVALID_CREDENTIALS' });
    return;
  }

  // Changing a password revokes every other session, so a stolen session cannot
  // survive the change. The current session is rotated (new token, old one
  // revoked) rather than kept.
  await setUserPassword(resolved.user.id, await hashPassword(next), { keepSessionId: null });
  const session = await createSession(resolved.user.id);
  await audit('password_changed', { actor: 'buyer', subjectUserId: resolved.user.id });
  if (session) setCookie(res, sessionCookie(session.token));
  else setCookie(res, clearSessionCookie());
  sendJson(res, 200, { ok: true, signedOutOtherDevices: true });
}

// ---------------------------------------------------------------------------
// GET /api/auth/_bench — KDF benchmark. Staging only, behind AUTH_BENCH=1.
// ---------------------------------------------------------------------------
async function bench(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (String(process.env.AUTH_BENCH || '') !== '1') { sendJson(res, 404, { error: 'Not found' }); return; }
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  const iterations = Math.min(Math.max(Number(url.searchParams.get('iterations') || 210_000), 1000), 2_000_000);
  const runs = Math.min(Math.max(Number(url.searchParams.get('runs') || 3), 1), 10);
  // The failure mode that matters here is a CPU-limit kill (Error 1102), which
  // would otherwise surface as an opaque 500 and make the parameter choice
  // undecidable. Reporting it is the whole point of this route, it is disabled
  // unless AUTH_BENCH=1, and it exposes no secret.
  try {
    const result = await benchmarkPbkdf2(iterations, runs);
    sendJson(res, 200, { algorithm: 'pbkdf2-sha256', ...result });
  } catch (err) {
    const e = err as Error & { name?: string };
    sendJson(res, 500, { error: String(e?.message || e), name: e?.name || 'Error', iterations });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/api/auth', 'https://luxedge.us');
  const path = url.pathname.replace(/\/+$/, '');

  // The benchmark route must not require the auth datastore to be usable.
  if (path === '/api/auth/_bench') { await bench(req, res, url); return; }

  if (!buyerAuthAvailable()) { unavailable(res); return; }

  switch (`${req.method} ${path}`) {
    case 'POST /api/auth/signup': await signup(req, res); return;
    case 'POST /api/auth/login': await login(req, res); return;
    case 'POST /api/auth/logout': await logout(req, res); return;
    case 'GET /api/auth/me': await me(req, res); return;
    case 'POST /api/auth/activate': await activate(req, res); return;
    case 'POST /api/auth/forgot': await forgot(req, res); return;
    case 'POST /api/auth/password': await changePassword(req, res); return;
    default:
      sendJson(res, 404, { error: 'Not found' });
  }
}

export { issueActivationCode, ACTIVATION_TTL_SECONDS, SESSION_TTL_SECONDS };
