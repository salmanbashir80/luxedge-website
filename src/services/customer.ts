// ============================================================================
// LUXEDGE V2 — CUSTOMER PROFILE SYNC (Phase 3B)
//
// Ensures a `customers` row exists for a signed-in Supabase user. Called after
// sign-in / sign-up so the storefront has a real customer identity to attach
// orders and reviews to (customers.auth_user_id → auth.users.id).
//
// SAFETY
//  * The insert is performed with the USER'S OWN access token, so RLS
//    (customer insert own profile: auth.uid() = auth_user_id) governs it —
//    a user can only ever create their own profile row. No service-role key.
//  * Never sets a role. Admin claims come only from the signed JWT.
//  * If the `customers` table is not provisioned yet (migration 0004 not
//    applied), this returns `ok: false, reason: 'not-provisioned'` — signup
//    itself still succeeds. No silent fake success, no crash.
//  * Duplicate/retry safe: existence is checked first; a concurrent insert
//    that races to the unique auth_user_id constraint is treated as success.
// ============================================================================

import { getDb, getDbMode } from './db';
import { getAccessToken } from './supabase';

export interface CustomerSyncResult {
  ok: boolean;
  reason: 'created' | 'exists' | 'not-provisioned' | 'not-configured' | 'no-session' | 'error';
  detail?: string;
}

/**
 * Ensure a customers row exists for the given auth user. Fire-and-forget
 * friendly: never throws. Callers should not block sign-in on this.
 */
export async function ensureCustomerProfile(user: { id: string; email: string; name: string }): Promise<CustomerSyncResult> {
  if (getDbMode() === 'local') return { ok: false, reason: 'not-configured' };
  const token = getAccessToken();
  if (!token) return { ok: false, reason: 'no-session' };

  const db = getDb();
  // Use the user's own JWT so RLS sees their identity (own-profile policies).
  if ('setAccessToken' in db && typeof (db as { setAccessToken: (t: string | null) => void }).setAccessToken === 'function') {
    (db as { setAccessToken: (t: string | null) => void }).setAccessToken(token);
  }

  try {
    const existing = await db.findFirst<{ id: string }>('customers', 'auth_user_id', user.id);
    if (existing) return { ok: true, reason: 'exists' };

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `cust-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    await db.insert('customers', {
      id,
      auth_user_id: user.id,
      email: user.email,
      name: user.name || user.email.split('@')[0] || 'Customer',
      created_at: now,
      updated_at: now,
    });
    return { ok: true, reason: 'created' };
  } catch (e) {
    const msg = (e as Error).message || '';
    // Table not provisioned yet (migration 0004 not applied) — honest, non-fatal.
    if (/PGRST205|42P01|does not exist|relation .*customers/i.test(msg)) {
      return { ok: false, reason: 'not-provisioned', detail: msg.slice(0, 160) };
    }
    // Unique violation (auth_user_id) — a concurrent insert won the race.
    if (/23505|duplicate key|already exists/i.test(msg)) {
      return { ok: true, reason: 'exists', detail: msg.slice(0, 160) };
    }
    return { ok: false, reason: 'error', detail: msg.slice(0, 160) };
  }
}
