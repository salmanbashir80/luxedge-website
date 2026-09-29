// POST /api/webhook — Stripe webhook (Stripe calls this server-to-server).
//
// HANDLES (payment-status aware — a completed session is NOT blindly PAID):
//   checkout.session.completed
//     payment_status = paid        → persist paid order exactly once +
//                                    consume the inventory reservation.
//     payment_status != paid       → persist as awaiting_payment (NO
//                                    inventory change — nothing was paid).
//   checkout.session.async_payment_succeeded
//     → complete the payment exactly once (promote awaiting → paid,
//       insert paid if missing, consume reservation).
//   checkout.session.async_payment_failed
//     → release reservation + mark order failed (defensive: launch is
//       card-only, but the account may expose delayed methods later).
//   checkout.session.expired
//     → release reservation + mark any pending order cancelled.
//   charge.refunded → sync order status: refunded / partially_refunded
//                     + refunded_amount (Stripe-authoritative).
//   everything else → acked, ignored.
//
// INVENTORY (migration 0015):
//   Stock is reduced ATOMICALLY at checkout-create (reserve_inventory). At
//   payment the reservation is CONSUMED (status flip; released/expired rows
//   restore-then-decrement so a late async payment still charges stock once).
//   If a reservation id is missing entirely (legacy session), falls back to
//   the 0014 atomic decrement_inventory RPC. Replays never double-consume.
//
// IDEMPOTENCY:
//   - luxedge_orders.stripe_session_id is UNIQUE: a replayed paid event
//     finds the existing row and returns 200 — never a duplicate order and
//     never a second inventory change.
//   - consume/release RPCs are status-guarded (reserved→consumed/released
//     only), so replays are harmless.
//   - Refund updates set absolute values (refunded_amount).
//
// SECURITY:
//   - Verifies the Stripe signature (constant-time HMAC) against
//     STRIPE_WEBHOOK_SECRET. Invalid signatures → 400 with NO database write.
//   - The browser can NEVER mark an order paid; only this endpoint (called by
//     Stripe with a valid signature) can.
//
// ERP AUTO-FORWARD:
//   The moment an order BECOMES paid (fresh paid insert, or an awaiting_payment
//   row promoted by async_payment_succeeded), it is forwarded to the configured
//   Embani ERP webhook via autoForwardPaidOrder (api/admin/erp.ts) — same
//   normalization, stable order_number and ERP_SYNC_STATUS ledger as the manual
//   Push in Admin → Orders. Replays (already-paid duplicates) never re-forward.
//   Forwarding is best-effort with an 8s bound and never fails the webhook:
//   failures land in the ledger as failed entries the owner can Retry.
//   - No card data is stored. Amounts come from Stripe's own session/charge
//     objects, which were created from server-verified totals.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './_lib/providers.js';
import { verifyWebhookSignature, retrieveCheckoutSessionDetailed } from './_lib/stripe.js';
import { autoForwardPaidOrder, type OrderRow } from './admin/erp.js';
import { promotePaidIntent } from './checkout-onsite.js';
import { commerceFetch, commerceRpc, claimWebhookEvent } from '../worker/d1/commerce';

// ---------------------------------------------------------------------------
// ORDER PERSISTENCE IS BACKEND-SWITCHED (Supabase -> Cloudflare D1)
//
// Supabase PostgREST answers HTTP 402 exceed_egress_quota for the service-role
// key, so on the current production deployment a verified payment could arrive
// with nowhere to persist its order. `commerceFetch` / `commerceRpc` serve the
// identical calls from D1 once DATA_BACKEND=d1 is active; until then (null) the
// original Supabase path runs unchanged, so rollback is one Worker var away.
// Once D1 IS active its result is authoritative — never a silent fallback.
// ---------------------------------------------------------------------------

function serviceRole(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}
function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}

function readRawBody(req: IncomingMessage, maxBytes = 200_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      body += chunk.toString('utf8');
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function restFetch(table: string, query: string, init?: { method?: string; body?: unknown; prefer?: string }): Promise<{ ok: boolean; status: number; data: unknown }> {
  const d1 = await commerceFetch(table, query, init);
  if (d1) return d1;
  const base = supabaseBase();
  const key = serviceRole();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };
    const method = init?.method || 'GET';
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init?.prefer) headers.Prefer = init.prefer;
    const res = await fetch(`${base}/rest/v1/${table}${query}`, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

/** Service-role RPC call (inventory reservation functions — migration 0015). */
async function rpcFetch(fn: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown }> {
  const d1 = await commerceRpc(fn, body);
  if (d1) return d1;
  const base = supabaseBase();
  const key = serviceRole();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

/** Atomic inventory decrement (migration 0014) — legacy fallback when no reservation exists. */
async function decrementInventory(productId: string, quantity: number): Promise<{ ok: boolean; reason?: string }> {
  const r = await rpcFetch('decrement_inventory', { p_product_id: productId, p_quantity: quantity });
  if (!r.ok || typeof r.data !== 'object' || r.data === null) return { ok: false, reason: 'db_unavailable' };
  const v = r.data as { ok?: boolean; reason?: string };
  return { ok: v.ok === true, reason: v.reason };
}

function orderNumberFromSession(sessionId: string): string {
  const short = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  return `LX-${short}`;
}

interface CompletedSessionShape {
  id: string;
  payment_status?: string;
  amount_total: number;
  amount_subtotal: number;
  currency: string;
  customer_email?: string | null;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  shipping_details?: {
    name?: string | null;
    address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } | null;
  } | null;
  total_details?: { amount_discount?: number; amount_shipping?: number; amount_tax?: number } | null;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
  line_items?: { data: { description: string | null; quantity: number | null; price: { unit_amount: number | null } | null }[] } | null;
}

function sessionIdsAndQtys(session: CompletedSessionShape): { ids: string[]; qtys: number[] } {
  const ids = (session.metadata?.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  const qtys = (session.metadata?.qtys || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return { ids, qtys };
}

/** Build the purchase snapshot row from Stripe's authoritative session data. */
function buildOrderRow(session: CompletedSessionShape, status: string): OrderRow {
  const sessionId = session.id;
  const { ids, qtys } = sessionIdsAndQtys(session);
  const lineData = session.line_items?.data || [];
  const items = ids.map((id, i) => {
    const li = lineData[i];
    const unitCents = li?.price?.unit_amount ?? null;
    return {
      id,
      name: li?.description || 'Luxedge product',
      quantity: qtys[i] ?? li?.quantity ?? 1,
      unitPrice: unitCents !== null && Number.isFinite(unitCents) ? unitCents / 100 : null,
    };
  });

  const cents = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n / 100 : 0);
  const currency = (session.currency || 'usd').toLowerCase();
  const addr = session.shipping_details?.address || null;
  const cd = session.customer_details || {};

  return {
    order_number: orderNumberFromSession(sessionId),
    customer_email: cd.email || session.customer_email || null,
    customer_name: cd.name || session.shipping_details?.name || null,
    shipping_address: addr ? { line1: addr.line1, line2: addr.line2, city: addr.city, state: addr.state, postal_code: addr.postal_code, country: addr.country } : null,
    items,
    coupon_code: session.metadata?.coupon && session.metadata.coupon !== 'none' ? session.metadata.coupon : null,
    subtotal: cents(session.amount_subtotal),
    discount: cents(session.total_details?.amount_discount),
    shipping: cents(session.total_details?.amount_shipping),
    tax: cents(session.total_details?.amount_tax),
    total: cents(session.amount_total),
    currency,
    status,
    stripe_session_id: sessionId,
    stripe_payment_intent: session.payment_intent || null,
  };
}

/**
 * Consume the reservation after a VERIFIED payment. Idempotent:
 *   - consumed > 0  → handled now (stock already reduced at reserve, or
 *                     restored-then-decremented for released/expired rows).
 *   - consumed = 0 + group_size > 0 → already consumed (replay) → no-op.
 *   - consumed = 0 + group_size = 0 → reservation missing entirely
 *     (legacy session) → caller falls back to decrement_inventory.
 */
async function consumeReservation(reservationId: string): Promise<{ consumed: number; groupSize: number }> {
  const r = await rpcFetch('consume_reservation', { p_reservation_id: reservationId });
  if (!r.ok || typeof r.data !== 'object' || r.data === null) return { consumed: -1, groupSize: -1 };
  const v = r.data as { consumed?: number; group_size?: number };
  return { consumed: typeof v.consumed === 'number' ? v.consumed : -1, groupSize: typeof v.group_size === 'number' ? v.group_size : -1 };
}

async function releaseReservation(reservationId: string): Promise<void> {
  await rpcFetch('release_reservation', { p_reservation_id: reservationId }).catch(() => null);
}

/** Persist/fulfill a PAID order exactly once, then consume the reservation. */
async function fulfillPaidOrder(session: CompletedSessionShape): Promise<{ status: number; body: Record<string, unknown> }> {
  const sessionId = session.id;
  const reservationId = (session.metadata?.reservation || '').trim();

  // Idempotency gate 1: existing row → already handled or awaiting promotion.
  const existing = await restFetch('luxedge_orders', `?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=id,status&limit=1`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    const row = existing.data[0] as { id: string; status?: string };
    if (row.status === 'paid') {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    // awaiting_payment → payment completed (async path): promote to paid,
    // then consume the reservation exactly once.
    const up = await restFetch('luxedge_orders', `?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: { status: 'paid', stripe_payment_intent: session.payment_intent || null, updated_at: new Date().toISOString() },
    });
    if (!up.ok) {
      // A paid order that cannot be promoted is a real incident: log enough to
      // diagnose it, and answer 5xx so Stripe retries rather than dropping it.
      console.error(`[webhook] promote failed session=${sessionId} status=${up.status} reason=${JSON.stringify(up.data).slice(0, 300)}`);
      return { status: up.status >= 500 ? up.status : 500, body: { error: 'database update rejected' } };
    }
    const { consumed, groupSize } = reservationId ? await consumeReservation(reservationId) : { consumed: -1, groupSize: -1 };
    if (consumed === 0 && groupSize === 0) await decrementFallback(session);
    // Payment confirmed (async path) → forward the now-paid order to ERP.
    await autoForwardPaidOrder({ ...buildOrderRow(session, 'paid'), id: row.id }).catch(() => null);
    return { status: 200, body: { received: true, promoted: true } };
  }

  const row = buildOrderRow(session, 'paid');
  const inserted = await restFetch('luxedge_orders', '', { method: 'POST', body: row, prefer: 'return=representation' });
  if (!inserted.ok) {
    // 409 / 23505 = unique violation (race with a concurrent duplicate webhook) —
    // treat as already handled; Stripe's retry loop must never fail on this.
    if (inserted.status === 409 || (inserted.data as { code?: string })?.code === '23505') {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    // A paid order that could not be written is never answered with a 2xx —
    // Stripe would stop retrying and the payment would be lost.
    console.error(`[webhook] order insert failed session=${sessionId} status=${inserted.status} reason=${JSON.stringify(inserted.data).slice(0, 300)}`);
    return { status: inserted.status >= 500 ? inserted.status : 500, body: { error: 'database write rejected' } };
  }

  // Fresh paid order → consume the reservation exactly once.
  const { consumed, groupSize } = reservationId ? await consumeReservation(reservationId) : { consumed: -1, groupSize: -1 };
  // Legacy sessions carry no reservation (or the group is gone entirely) →
  // atomic decrement fallback (0014). Already-consumed → no-op.
  if (!reservationId || (consumed === 0 && groupSize === 0)) await decrementFallback(session);

  // Payment confirmed → forward the fresh paid order to the ERP webhook
  // (best-effort; recorded in the sync ledger, never fails the webhook).
  const insertedRow = (Array.isArray(inserted.data) ? inserted.data[0] : null) as { id?: string } | null;
  await autoForwardPaidOrder({ ...row, id: insertedRow?.id || null }).catch(() => null);

  return { status: 200, body: { received: true, orderNumber: row.order_number as string } };
}

/**
 * On-site PaymentIntent flow — the order row was persisted as `pending` when
 * the PaymentIntent was created (keyed by stripe_payment_intent). This
 * handler promotes that row to paid exactly once and consumes the
 * reservation. Delegates to the shared promotePaidIntent (same logic the
 * client /api/checkout/verify endpoint uses) so the two paths can never
 * diverge; the unique partial index (migration 0030) + status-guarded
 * consume make replays / verify races harmless.
 */
async function promoteIntentPaid(intentId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await promotePaidIntent(intentId);
  if (result.paid) {
    return { status: 200, body: { received: true, duplicate: result.duplicate === true, promoted: result.duplicate !== true } };
  }
  if (!result.ok) {
    if (result.status === 402) {
      // Non-succeeded intent → ack; Stripe re-fires on real success.
      return { status: 200, body: { received: true, ignored: 'payment intent not succeeded yet' } };
    }
    if (result.status === 404) {
      return { status: 200, body: { received: true, ignored: 'no matching pending order' } };
    }
    if (result.status === 409) {
      return { status: 200, body: { received: true, ignored: 'order not payable' } };
    }
    return { status: result.status || 500, body: { error: result.error || 'could not promote order' } };
  }
  return { status: 200, body: { received: true, promoted: true } };
}

/** Legacy fallback: no reservation group exists → atomic decrement per line. */
async function decrementFallback(session: CompletedSessionShape): Promise<void> {
  const { ids, qtys } = sessionIdsAndQtys(session);
  for (let i = 0; i < ids.length; i++) {
    await decrementInventory(ids[i], qtys[i] ?? 1).catch(() => null);
  }
}

/** completed + payment_status != paid → persist awaiting_payment, NO inventory change. */
async function persistAwaitingOrder(session: CompletedSessionShape): Promise<{ status: number; body: Record<string, unknown> }> {
  const sessionId = session.id;
  const existing = await restFetch('luxedge_orders', `?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=id,status&limit=1`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    return { status: 200, body: { received: true, duplicate: true } };
  }
  const row = buildOrderRow(session, 'awaiting_payment');
  const inserted = await restFetch('luxedge_orders', '', { method: 'POST', body: row, prefer: 'return=representation' });
  if (!inserted.ok) {
    if (inserted.status === 409 || (inserted.data as { code?: string })?.code === '23505') {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    console.error(`[webhook] awaiting-order insert failed session=${sessionId} status=${inserted.status} reason=${JSON.stringify(inserted.data).slice(0, 300)}`);
    return { status: inserted.status >= 500 ? inserted.status : 500, body: { error: 'database write rejected' } };
  }
  return { status: 200, body: { received: true, orderNumber: row.order_number as string, awaitingPayment: true } };
}

/**
 * checkout.session.expired / async_payment_failed → release the held stock
 * and (if an order row exists) reflect the terminal state honestly.
 */
async function releaseAndMark(obj: CompletedSessionShape, orderStatus: 'failed' | 'cancelled'): Promise<{ status: number; body: Record<string, unknown> }> {
  const reservationId = (obj.metadata?.reservation || '').trim();
  if (reservationId) await releaseReservation(reservationId);
  // Only touch rows still pending — a paid order must never be downgraded.
  const existing = await restFetch('luxedge_orders', `?stripe_session_id=eq.${encodeURIComponent(obj.id)}&select=id,status&limit=1`);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
    const row = existing.data[0] as { id: string; status?: string };
    if (row.status === 'awaiting_payment' || row.status === 'pending') {
      await restFetch('luxedge_orders', `?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        body: { status: orderStatus, updated_at: new Date().toISOString() },
      }).catch(() => null);
    }
  }
  return { status: 200, body: { received: true, released: true, orderStatus } };
}

interface RefundEventShape {
  id: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  payment_intent?: string | null;
}

/** charge.refunded → sync order status + refunded_amount (Stripe-authoritative). */
async function syncRefund(charge: RefundEventShape): Promise<{ status: number; body: Record<string, unknown> }> {
  const paymentIntent = charge.payment_intent;
  if (!paymentIntent) return { status: 200, body: { received: true, ignored: 'no payment_intent' } };
  const amount = (charge.amount ?? 0) / 100;
  const refunded = (charge.amount_refunded ?? 0) / 100;
  const fullyRefunded = refunded >= amount && amount > 0;
  const patch = {
    status: fullyRefunded ? 'refunded' : 'partially_refunded',
    refunded_amount: refunded,
    refunded_at: new Date().toISOString(),
  };
  const r = await restFetch('luxedge_orders', `?stripe_payment_intent=eq.${encodeURIComponent(paymentIntent)}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (!r.ok) {
    // No matching order (e.g. async payment not yet completed) — ack; the
    // refund event will be re-delivered by Stripe or surfaced in the dashboard.
    return { status: 200, body: { received: true, updated: 0, warning: 'no matching order' } };
  }
  const updated = Array.isArray(r.data) ? r.data.length : 0;
  return { status: 200, body: { received: true, updated, status: patch.status, refundedAmount: refunded } };
}

/** Dispatches one verified Stripe event. Returns what to answer with. */
async function routeEvent(
  event: { type: string; data?: { object?: unknown } },
  obj: (CompletedSessionShape & RefundEventShape) & { id: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    // Pull the AUTHORITATIVE session (line items + totals) from Stripe — the
    // webhook event body alone has no line items.
    const detailed = await retrieveCheckoutSessionDetailed(obj.id);
    if (!detailed.ok) {
      // Fail the webhook so Stripe retries — never persist a guessed snapshot.
      return { status: detailed.status, body: { error: detailed.message, code: detailed.code } };
    }
    const session = detailed.data as CompletedSessionShape;
    if (session.payment_status === 'paid') {
      return await fulfillPaidOrder(session);
    }
    // completed but NOT paid (async methods) → awaiting_payment, no inventory change.
    return await persistAwaitingOrder(session);
  }

  if (event.type === 'checkout.session.expired') {
    return await releaseAndMark(obj as CompletedSessionShape, 'cancelled');
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    return await releaseAndMark(obj as CompletedSessionShape, 'failed');
  }

  if (event.type === 'charge.refunded') {
    return await syncRefund(obj as RefundEventShape);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intentId = obj.id;
    if (!/^pi_[A-Za-z0-9_]+$/.test(intentId)) {
      return { status: 400, body: { error: 'Malformed payment intent id.' } };
    }
    return await promoteIntentPaid(intentId);
  }

  return { status: 200, body: { received: true, ignored: event.type } };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  const rawBody = await readRawBody(req).catch(() => '');
  const sig = req.headers['stripe-signature'] as string | undefined;
  const verified = await verifyWebhookSignature(rawBody, sig);
  if (!verified.ok) {
    sendJson(res, 400, { error: verified.message });
    return;
  }

  const { event } = verified;
  const obj = event.data?.object as (CompletedSessionShape & RefundEventShape) | undefined;
  if (!obj?.id) { sendJson(res, 400, { error: 'Malformed webhook event.' }); return; }

  const outcome = await routeEvent(event, obj as (CompletedSessionShape & RefundEventShape) & { id: string });

  // EVENT-ID IDEMPOTENCY (D1). Recorded only AFTER the event was handled
  // successfully: a failed delivery must stay unrecorded so Stripe's retry is
  // processed rather than discarded as a duplicate. Concurrent deliveries of
  // the same live event are still safe — the order-level unique indexes on
  // stripe_session_id / stripe_payment_intent are the primary guard.
  if (outcome.status < 400) {
    await claimWebhookEvent(event.id, event.type).catch(() => null);
  }
  sendJson(res, outcome.status, outcome.body);
}
