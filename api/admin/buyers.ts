// ============================================================================
// LUXEDGE — ADMIN → BUYER ACCOUNTS (/api/admin/buyers)
//
// The owner-approved $0 recovery workflow. There is no transactional email
// provider available (the only binding, Cloudflare's send_email, delivers to
// verified destinations only — it cannot mail an arbitrary customer), so an
// authenticated admin issues a ONE-TIME activation/reset code and hands it to
// the buyer out of band. The buyer then redeems it at /api/auth/activate and
// chooses their own password.
//
//   GET  /api/admin/buyers              list buyer accounts (no secrets)
//   POST /api/admin/buyers/code         { email | userId } -> one-time code
//
// AUTHORIZATION: requireAdmin (api/_lib/auth.ts) — the existing verified-JWT
// admin guard, unchanged. Buyer identity is never used here, and a buyer cannot
// reach this route (it requires the admin claim, not a buyer session).
//
// WHAT IS NEVER RETURNED: password hashes, session tokens, existing activation
// codes (only a newly issued one, once, because the admin has to read it to the
// customer), and the token hashes of anything.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { getDataRuntime } from '../../worker/d1/runtime';
import {
  ACTIVATION_TTL_SECONDS,
  audit,
  buyerAuthAvailable,
  countActiveActivationCodes,
  findUserByEmail,
  findUserById,
  issueActivationCode,
} from '../../worker/auth/store';

function db() {
  const rt = getDataRuntime();
  return rt.backend === 'd1' && rt.db ? rt.db : null;
}

interface BuyerAdminRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
  email_verified: number;
  requires_activation: number;
  disabled_at: string | null;
}

/** Admin view of one account: status only, never credential material. */
async function describe(row: BuyerAdminRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    emailVerified: row.email_verified === 1,
    requiresActivation: row.requires_activation === 1,
    disabled: Boolean(row.disabled_at),
    hasPassword: true,
    activeActivationCodes: await countActiveActivationCodes(row.id),
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (!buyerAuthAvailable()) {
    sendJson(res, 503, { error: 'Buyer accounts are not configured on this deployment.', code: 'AUTH_UNAVAILABLE' });
    return;
  }

  const url = new URL(req.url || '/api/admin/buyers', 'https://luxedge.us');
  const action = url.searchParams.get('action') || '';

  if (req.method === 'GET') {
    const conn = db();
    if (!conn) { sendJson(res, 503, { error: 'Database unavailable.' }); return; }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const query = String(url.searchParams.get('query') || '').trim().toLowerCase();
    const sql = query
      ? `SELECT id, email, display_name, created_at, last_login_at, email_verified, requires_activation, disabled_at
           FROM buyer_users WHERE lower(email) LIKE ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, email, display_name, created_at, last_login_at, email_verified, requires_activation, disabled_at
           FROM buyer_users ORDER BY created_at DESC LIMIT ?`;
    const stmt = conn.prepare(sql);
    const rows = query
      ? await stmt.bind(`%${query}%`, limit).all<BuyerAdminRow>()
      : await stmt.bind(limit).all<BuyerAdminRow>();
    const accounts = await Promise.all((rows?.results || []).map(describe));
    sendJson(res, 200, { accounts, total: accounts.length, activationTtlDays: ACTIVATION_TTL_SECONDS / 86400 });
    return;
  }

  if (req.method === 'POST' && action === 'code') {
    let body: Record<string, unknown>;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }

    const email = String(body.email || '').trim();
    const userId = String(body.userId || '').trim();
    if (!email && !userId) { sendJson(res, 400, { error: 'Provide the buyer email or userId.' }); return; }

    const user = userId ? await findUserById(userId) : await findUserByEmail(email);
    if (!user) { sendJson(res, 404, { error: 'No buyer account matches that email or id.' }); return; }
    if (user.disabled_at) { sendJson(res, 409, { error: 'That account is disabled.' }); return; }

    const issued = await issueActivationCode({
      userId: user.id,
      createdBy: String(admin.sub || 'admin'),
    });
    if (!issued) { sendJson(res, 503, { error: 'Could not issue a code right now. Please try again.' }); return; }

    await audit('activation_code_issued_by_admin', { actor: String(admin.sub || 'admin'), subjectUserId: user.id });
    // ISSUED ONCE, and this is the only time it is ever readable: only its hash
    // is stored, so it cannot be re-fetched — a new code must be issued instead.
    sendJson(res, 200, {
      ok: true,
      email: user.email,
      code: issued.code,
      expiresAt: issued.expiresAt,
      instructions:
        'Give this code to the buyer privately. They redeem it at /account with their email and choose a new password. It works once, and issuing another code cancels this one.',
    });
    return;
  }

  if (req.method === 'POST' && action === 'disable') {
    let body: Record<string, unknown>;
    try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }
    const user = body.userId ? await findUserById(String(body.userId)) : await findUserByEmail(String(body.email || ''));
    if (!user) { sendJson(res, 404, { error: 'No buyer account matches that email or id.' }); return; }
    const conn = db();
    if (!conn) { sendJson(res, 503, { error: 'Database unavailable.' }); return; }
    const disabled = body.disabled === false ? null : new Date().toISOString();
    await conn.prepare(`UPDATE buyer_users SET disabled_at = ?, updated_at = ? WHERE id = ?`).bind(disabled, new Date().toISOString(), user.id).run?.();
    // Disabling an account must also end its sessions, not just block the next sign-in.
    if (disabled) {
      await conn.prepare(`UPDATE buyer_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(new Date().toISOString(), user.id).run?.();
    }
    await audit(disabled ? 'account_disabled' : 'account_enabled', { actor: String(admin.sub || 'admin'), subjectUserId: user.id });
    sendJson(res, 200, { ok: true, disabled: Boolean(disabled) });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}
