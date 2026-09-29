// ============================================================================
// LUXEDGE — ON-SITE CHECKOUT (Stripe PaymentElement + PaymentIntent)
//
// The customer NEVER leaves luxedge.us to pay. Flow:
//
//   1. Client submits cart items + contact + shipping address + selected
//      shipping-rate object id (from /api/shippo/rates) + coupon code.
//   2. THIS module re-reads the catalog server-side (price authority),
//      normalizes the address, validates it (Shippo/USPS for US), re-fetches
//      live rates and verifies the chosen rate actually exists, then reserves
//      inventory atomically (migration 0015).
//   3. A PENDING order row is persisted keyed by the PaymentIntent id
//      (unique partial index — migration 0030) so webhook replays and
//      duplicate verify races can never create two orders.
//   4. A Stripe PaymentIntent is created for the exact server total.
//      The client renders Stripe PaymentElement and calls confirmPayment.
//   5. The webhook (payment_intent.succeeded) promotes pending → paid and
//      consumes the reservation; the client-side verify endpoint does the
//      same synchronously — both are idempotent and race-safe.
//
// SECURITY: the browser never sends a price, payment status or arbitrary
// shipping amount. Selected shipping is a Shippo rate object id that this
// module validates by re-fetching the live rates for the cart + address.
//
// The legacy Stripe-hosted Checkout flow (/api/checkout + sessions webhook)
// remains fully intact — this is an additive route.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './_lib/providers.js';
import { computeCheckoutTotals, validateCheckoutRequest, type CheckoutDataLoader } from './_lib/checkout.js';
import { autoForwardPaidOrder } from './admin/erp.js';
import {
  createPaymentIntent,
  resolvePublishableKey,
  retrievePaymentIntent,
  stripeReady,
  stripeMode,
  type PaymentIntentResult,
} from './_lib/stripe.js';
import {
  addressIsComplete,
  basicValidation,
  fetchLiveRates,
  normalizeShippingAddress,
  shippoConfigured,
  validateShippingAddress,
  type ShippingAddressInput,
} from './_lib/shippo.js';
import {
  getProviderForCheckout,
  type ProviderId,
} from './_lib/payment-providers.js';
import { commerceFetch, commerceRpc, commerceDbActive } from '../worker/d1/commerce';

// ---------------------------------------------------------------------------
// Environment + order persistence
//
// ORDER PERSISTENCE IS BACKEND-SWITCHED, AND THE SWITCH IS EXPLICIT.
// Supabase PostgREST is hard-restricted (HTTP 402) for the service-role key too,
// so on the current production deployment this module could take a real Stripe
// payment whose order row was never written anywhere. `commerceFetch` /
// `commerceRpc` serve the identical calls from Cloudflare D1 once
// DATA_BACKEND=d1 is active; otherwise (null) the original Supabase path below
// runs unchanged, which keeps the rollback one Worker var away.
// Fail-closed on purpose: when D1 IS active its result is authoritative and we
// never silently fall back to Supabase — a fallback would report an order as
// persisted when it was not.
// ---------------------------------------------------------------------------

function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}
function serviceRole(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

/** True when an order can be persisted and read back somewhere. */
export function orderStorageConfigured(): boolean {
  return commerceDbActive() || Boolean(supabaseBase() && serviceRole());
}

interface DbResult { ok: boolean; status: number; data: unknown }

async function restFetch(table: string, query: string, init?: { method?: string; body?: unknown; prefer?: string }): Promise<DbResult> {
  // Cloudflare D1 (commerce) takes precedence when it is the active backend.
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

async function rpcFetch(fn: string, body: Record<string, unknown>): Promise<DbResult> {
  // Cloudflare D1 implements the four inventory RPCs natively when active.
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

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

interface CheckoutAddressInput {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/** Same authoritative loader used by the legacy checkout (catalog/coupons/settings).
 * Products additionally carry weight_oz (migration 0030) for live rates. */
function makeLoader(): CheckoutDataLoader & {
  getWeightedProducts(ids: string[]): Promise<Array<{ id: string; weight_oz: number | null }>>;
} {
  return {
    async getProducts(ids: string[]) {
      const rows = await readProducts(ids);
      return rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        price: p.price,
        status: p.status,
        inventory_qty: p.inventory_qty,
        image_url: p.image_url,
      }));
    },
    async getWeightedProducts(ids: string[]) {
      const rows = await readProducts(ids);
      return rows.map((p) => ({ id: p.id, weight_oz: p.weight_oz }));
    },
    async getCoupon(code: string) {
      const r = await restFetch('coupons', `?code=eq.${encodeURIComponent(code)}&select=code,discount_type,discount_value,min_cart_value,is_active,start_at,end_at&limit=1`);
      if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) return null;
      const c = r.data[0] as Record<string, unknown>;
      return {
        code: String(c.code),
        discount_type: (c.discount_type === 'fixed' ? 'fixed' : 'percent') as 'fixed' | 'percent',
        discount_value: Number(c.discount_value),
        min_cart_value: Number(c.min_cart_value),
        is_active: Boolean(c.is_active),
        start_at: c.start_at ? String(c.start_at) : null,
        end_at: c.end_at ? String(c.end_at) : null,
      };
    },
    async getFreeShippingSettings() {
      const r = await restFetch('store_settings', `?key=eq.free_shipping&select=value&limit=1`);
      if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) return {};
      const v = (r.data[0] as { value?: Record<string, unknown> }).value || {};
      return {
        freeShippingEnabled: Boolean(v.freeShippingEnabled),
        freeShippingThreshold: typeof v.freeShippingThreshold === 'number' ? v.freeShippingThreshold : Number(v.freeShippingThreshold) || 0,
      };
    },
  };
}

async function readProducts(ids: string[]): Promise<Array<{
  id: string;
  slug: string;
  name: string;
  price: number | null;
  status: string;
  inventory_qty: number | null;
  image_url: string | null;
  weight_oz: number | null;
}>> {
  const q = ids.map((i) => `"${i}"`).join(',');
  const r = await restFetch('products', `?id=in.(${q})&select=id,slug,name,price,status,inventory_qty,image_url,weight_oz`);
  if (!r.ok || !Array.isArray(r.data)) return [];
  return (r.data as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id || ''),
    slug: p.slug ? String(p.slug) : '',
    name: p.name ? String(p.name) : 'Unnamed product',
    price: typeof p.price === 'number' ? p.price : p.price === null ? null : Number(p.price),
    status: p.status ? String(p.status) : 'draft',
    inventory_qty: p.inventory_qty === null || p.inventory_qty === undefined ? null : Number(p.inventory_qty),
    image_url: p.image_url ? String(p.image_url) : null,
    weight_oz: p.weight_oz === null || p.weight_oz === undefined ? null : Number(p.weight_oz),
  }));
}

interface OnsiteRequest {
  items: { id: string; quantity: number }[];
  couponCode?: string;
  email: string;
  phone?: string;
  fullName: string;
  /** Address guaranteed complete by parseBody (addressIsComplete gate). */
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  shippingRateId?: string; // Shippo rate object id (validated server-side)
}

function parseBody(body: unknown): { ok: true; r: OnsiteRequest } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Invalid request body.' };
  const b = body as Record<string, unknown>;
  const items = Array.isArray(b.items)
    ? b.items.map((raw) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        return { id: String(it.id || '').trim(), quantity: Math.floor(Number(it.quantity) || 0) };
      }).filter((i) => i.id && i.quantity > 0)
    : [];
  if (items.length === 0) return { ok: false, message: 'Your cart is empty.' };
  if (items.length > 10) return { ok: false, message: 'Too many items in the cart (max 10 distinct products).' };
  const email = String(b.email || '').trim().slice(0, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'A valid email is required for the order.' };
  const fullName = String(b.fullName || '').trim().slice(0, 200);
  if (!fullName) return { ok: false, message: 'Your name is required for delivery.' };
  const a = (b.address ?? {}) as CheckoutAddressInput;
  const address: OnsiteRequest['address'] = {
    line1: String(a.line1 || '').trim().slice(0, 200),
    line2: a.line2 ? String(a.line2).trim().slice(0, 200) : undefined,
    city: String(a.city || '').trim().slice(0, 120),
    state: String(a.state || '').trim().slice(0, 60),
    zip: String(a.zip || '').trim().slice(0, 16),
    country: String(a.country || '').trim().slice(0, 60) || 'US',
  };
  if (!addressIsComplete({
    fullName,
    addressLine1: address.line1 || '',
    addressLine2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.zip,
    country: address.country || 'US',
  })) {
    return { ok: false, message: 'Please complete your shipping address (street, city, state, ZIP).' };
  }
  const shippingRateId = typeof b.shippingRateId === 'string' && b.shippingRateId.trim() ? b.shippingRateId.trim().slice(0, 120) : undefined;
  return {
    ok: true,
    r: {
      items,
      couponCode: typeof b.couponCode === 'string' && b.couponCode.trim() ? b.couponCode.trim().toUpperCase().slice(0, 40) : undefined,
      email,
      phone: typeof b.phone === 'string' ? b.phone.trim().slice(0, 40) : undefined,
      fullName,
      address,
      shippingRateId,
    },
  };
}

/** Deterministic order number for the pending row (pre-Stripe). */
export function onsiteOrderNumber(): string {
  const hex = crypto.randomUUID().replace(/[^a-f0-9]/g, '').slice(0, 8).toUpperCase();
  return `LX-${hex}`;
}

// ---------------------------------------------------------------------------
// GET /api/checkout/onsite — client config (safe public values only)
// ---------------------------------------------------------------------------
export async function configHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  const stripeCfg = await stripeReady();
  const pk = stripeCfg ? await resolvePublishableKey() : '';

  // Payment provider engine info
  const { cardProvider, paypalProvider } = getProviderForCheckout();
  const activeCardId: ProviderId | null = cardProvider?.id || null;
  const hasPaypal = paypalProvider?.isConfigured() || false;
  const anyProviderReady = (cardProvider?.isConfigured() || false) || hasPaypal;

  sendJson(res, 200, {
    stripeConfigured: stripeCfg && !!pk,
    stripePublishableKey: pk || null,
    stripeMode: stripeCfg ? await stripeMode() : null,
    shippoConfigured: shippoConfigured(),
    // Multi-provider engine
    activeCardProvider: activeCardId,
    hasPaypal,
    anyProviderReady,
    cardClientConfig: cardProvider?.getClientConfig() || null,
    paypalClientConfig: paypalProvider?.getClientConfig() || null,
  });
}

// ---------------------------------------------------------------------------
// POST /api/checkout/onsite — validate + reserve + persist pending + create PI
// ---------------------------------------------------------------------------
export async function onsiteHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  if (!orderStorageConfigured()) {
    sendJson(res, 503, { error: 'Checkout is temporarily unavailable. Please try again shortly.' });
    return;
  }

  let body: unknown;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }
  const parsed = parseBody(body);
  if (!parsed.ok) { sendJson(res, 400, { error: parsed.message }); return; }
  const r = parsed.r;

  // 1) Authoritative totals from the real catalog + coupon rules.
  const loader = makeLoader();
  const validation = validateCheckoutRequest({
    items: r.items,
    couponCode: r.couponCode,
    customer: { email: r.email, name: r.fullName, phone: r.phone },
  });
  if (!validation.ok) { sendJson(res, 400, { error: validation.message }); return; }
  const decision = await computeCheckoutTotals(loader, validation.request);
  if (!decision.ok) { sendJson(res, decision.status, { error: decision.message, code: decision.code }); return; }
  const { totals } = decision;

  // 2) Normalize + validate the shipping address (server-side, again).
  const addrInput: ShippingAddressInput = {
    fullName: r.fullName,
    addressLine1: r.address.line1 || '',
    addressLine2: r.address.line2,
    city: r.address.city || '',
    state: r.address.state || '',
    postalCode: r.address.zip || '',
    country: r.address.country || 'US',
  };
  const normalized = normalizeShippingAddress(addrInput);
  const country = normalized.country;
  if (country !== 'US') {
    // Non-US: format-level validation only (store ships domestically today).
    const basic = basicValidation(addrInput);
    if (!basic.isValid) { sendJson(res, 400, { error: basic.messages[0] || 'Please check the shipping address.' }); return; }
  } else {
    const outcome = await validateShippingAddress(addrInput);
    if (!outcome.isValid && outcome.source === 'shippo' && shippoConfigured()) {
      // Shippo explicitly rejected the address — never ship blind.
      sendJson(res, 400, { error: outcome.messages[0] || 'We could not verify this shipping address. Please double-check it.' });
      return;
    }
    if (!outcome.isValid && outcome.source === 'basic') {
      sendJson(res, 400, { error: outcome.messages[0] || 'Please check the shipping address.' });
      return;
    }
    // Silently adopt normalization (state abbreviation, ZIP format) — street
    // corrections were already accepted by the customer on the address step.
    const n = outcome.normalizedAddress;
    r.address.line1 = n.addressLine1;
    r.address.line2 = n.addressLine2 || undefined;
    r.address.city = n.city;
    r.address.state = n.state;
    r.address.zip = n.postalCode;
    r.address.country = n.country;
  }

  // 3) Free-shipping rule first (store setting, server-side), else if the
  //    client picked a live rate, RE-FETCH the rates and validate the id.
  let shippingCents = Math.round(totals.shipping * 100);
  let shippingMethod = totals.freeShippingApplied ? 'free' : 'flat';
  let carrier: string | null = null;
  let serviceName: string | null = null;
  let rateId: string | null = null;

  // When the client DID select a live rate, it must be validated against the
  // real Shippo rates — never accept an unvalidated client-chosen amount, and
  // never silently fall back to flat shipping while the UI showed a rate.
  if (!totals.freeShippingApplied && r.shippingRateId && totals.shipping > 0) {
    const weighted = await loader.getWeightedProducts(totals.lines.map((l) => l.id));
    const weightByProduct = new Map(weighted.map((p) => [p.id, p.weight_oz]));
    const weightLines = totals.lines.map((l) => ({
      weightOz: Number(weightByProduct.get(l.id) || 0),
      quantity: l.quantity,
    }));
    const ratesRes = await fetchLiveRates({ address: addrInput, lineItems: weightLines });
    if (!ratesRes.ok || ratesRes.rates.length === 0) {
      sendJson(res, 400, { error: 'Live shipping rates are not available for this order. Please refresh and retry, or contact support.' });
      return;
    }
    const chosen = ratesRes.rates.find((rt) => rt.objectId === r.shippingRateId);
    if (!chosen) {
      sendJson(res, 400, { error: 'The selected shipping method is no longer available. Please choose another.' });
      return;
    }
    shippingCents = Math.round(chosen.amount * 100);
    shippingMethod = 'shippo';
    carrier = chosen.provider;
    serviceName = chosen.serviceName;
    rateId = chosen.objectId;
  }

  const totalCents = Math.round((totals.subtotal - totals.discount) * 100) + shippingCents;
  if (totalCents <= 0) { sendJson(res, 400, { error: 'Order total must be greater than zero.', code: 'EMPTY_TOTAL' }); return; }

  // 4) Reserve inventory atomically BEFORE persisting anything.
  const reservationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  for (const line of totals.lines) {
    const rpc = await rpcFetch('reserve_inventory', {
      p_reservation_id: reservationId,
      p_product_id: line.id,
      p_quantity: line.quantity,
      p_expires_at: expiresAt,
    });
    const v = (rpc.data ?? {}) as { ok?: boolean; reason?: string };
    if (!rpc.ok || v.ok !== true) {
      await rpcFetch('release_reservation', { p_reservation_id: reservationId }).catch(() => null);
      sendJson(res, 400, { error: 'Some items in your cart are no longer available in stock. Please review your cart.', code: 'OUT_OF_STOCK' });
      return;
    }
  }

  // 5) Create the Stripe PaymentIntent (server total only).
  const orderNumber = onsiteOrderNumber();
  const piRes = await createPaymentIntent({
    amountCents: totalCents,
    currency: 'usd',
    receiptEmail: r.email,
    metadata: {
      ids: totals.lines.map((l) => l.id).join(','),
      qtys: totals.lines.map((l) => String(l.quantity)).join(','),
      coupon: totals.couponCode || 'none',
      reservation: reservationId,
      order_number: orderNumber,
      channel: 'onsite',
    },
  });
  if (!piRes.ok) {
    await rpcFetch('release_reservation', { p_reservation_id: reservationId }).catch(() => null);
    sendJson(res, piRes.status, { error: piRes.message, code: piRes.code });
    return;
  }
  const pi = piRes.data as PaymentIntentResult & { id: string };

  // 6) Persist the PENDING order row (unique on stripe_payment_intent — the
  //    webhook + verify both promote this same row; replays are no-ops).
  const row = {
    order_number: orderNumber,
    customer_email: r.email,
    customer_name: r.fullName,
    customer_phone: r.phone || null,
    shipping_address: {
      line1: r.address.line1,
      line2: r.address.line2 || null,
      city: r.address.city,
      state: r.address.state,
      postal_code: r.address.zip,
      country: r.address.country,
      verified: true,
    },
    items: totals.lines.map((l) => ({
      id: l.id,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      image: l.imageUrl,
    })),
    coupon_code: totals.couponCode || null,
    subtotal: totals.subtotal,
    discount: totals.discount,
    shipping: shippingCents / 100,
    shipping_method: shippingMethod,
    shipping_carrier: carrier,
    shipping_service: serviceName,
    shipping_rate_id: rateId,
    tax: 0,
    total: totalCents / 100,
    currency: 'usd',
    status: 'pending',
    stripe_payment_intent: pi.id,
    stripe_session_id: null,
  };
  const inserted = await restFetch('luxedge_orders', '', { method: 'POST', body: row, prefer: 'return=representation' });
  if (!inserted.ok) {
    // Unique violation (23505) → a concurrent identical checkout already
    // persisted this intent; release OUR reservation (theirs is live) and
    // return the existing state so the customer can pay.
    const code = (inserted.data as { code?: string })?.code;
    if (inserted.status === 409 || code === '23505') {
      await rpcFetch('release_reservation', { p_reservation_id: reservationId }).catch(() => null);
      sendJson(res, 409, { error: 'This order was already started. Please refresh and check your order status.', code: 'DUPLICATE_ORDER' });
      return;
    }
    await rpcFetch('release_reservation', { p_reservation_id: reservationId }).catch(() => null);
    // Server-side diagnosis: the refusal reason names a column or a constraint,
    // never a secret — and the customer must never see it. Losing this line is
    // what made the previous "ordered but never persisted" failure invisible.
    console.error(
      `[checkout] order persist failed status=${inserted.status} intent=${pi.id} order=${orderNumber} reason=${JSON.stringify(inserted.data).slice(0, 300)}`,
    );
    sendJson(res, inserted.status, { error: 'Could not start checkout right now. Please try again.' });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    paymentIntentId: pi.id,
    clientSecret: (pi as { client_secret?: string | null }).client_secret || null,
    orderNumber,
    reservationId,
    totals: {
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: shippingCents / 100,
      shippingMethod,
      tax: 0,
      total: totalCents / 100,
      currency: 'USD',
      freeShippingApplied: totals.freeShippingApplied,
      couponCode: totals.couponCode,
    },
    address: r.address,
  });
}

// ---------------------------------------------------------------------------
// Payment verification + promotion (shared with the webhook)
// ---------------------------------------------------------------------------

async function consumeReservation(reservationId: string): Promise<void> {
  await rpcFetch('consume_reservation', { p_reservation_id: reservationId }).catch(() => null);
}

/**
 * Promote the pending order for a SUCCEEDED PaymentIntent exactly once
 * (idempotent; replay/verify/webhook races are harmless thanks to the unique
 * partial index + status-guarded consume). Returns the order number when paid.
 */
export async function promotePaidIntent(intentId: string): Promise<{
  ok: boolean;
  status?: number;
  paid?: boolean;
  duplicate?: boolean;
  orderNumber?: string | null;
  error?: string;
}> {
  const pi = await retrievePaymentIntent(intentId);
  if (!pi.ok) return { ok: false, status: pi.status, error: pi.message };
  const intent = pi.data as { status: string; amount: number; currency: string; metadata?: Record<string, string> | null; receipt_email?: string | null };
  if (intent.status !== 'succeeded') return { ok: false, status: 402, error: `Payment has not completed (${intent.status}).` };
  const reservationId = (intent.metadata?.reservation || '').trim();

  const existing = await restFetch('luxedge_orders', `?stripe_payment_intent=eq.${encodeURIComponent(intentId)}&select=id,status,total,currency,order_number&limit=1`);
  if (!existing.ok) return { ok: false, status: existing.status, error: 'Could not look up the order.' };
  const rows = Array.isArray(existing.data) ? existing.data : [];
  if (rows.length === 0) return { ok: false, status: 404, error: 'No order found for this payment.' };
  const row = rows[0] as { id: string; status?: string; total?: number | null; currency?: string | null; order_number?: string | null };
  if (row.status === 'paid') {
    return { ok: true, paid: true, duplicate: true, orderNumber: row.order_number || null };
  }
  if (row.status !== 'pending' && row.status !== 'awaiting_payment') {
    return { ok: false, status: 409, error: `This order is ${row.status} and cannot be paid now.` };
  }
  const orderTotal = Number(row.total || 0);
  if (Math.round(orderTotal * 100) !== intent.amount) {
    return { ok: false, status: 400, error: 'Payment amount does not match the order total.' };
  }

  const up = await restFetch('luxedge_orders', `?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    body: { status: 'paid', stripe_payment_intent: intentId, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  if (!up.ok) return { ok: false, status: up.status, error: 'Could not update the order.' };
  if (reservationId) await consumeReservation(reservationId);

  // Forward the now-paid order to ERP (best-effort; same ledger + stable
  // order_number as the session webhook path — never duplicates).
  try {
    const patched = (up.data && Array.isArray(up.data) && up.data[0] ? up.data[0] : null) as Record<string, unknown> | null;
    await autoForwardPaidOrder({
      id: String(patched?.id ?? row.id),
      order_number: String(patched?.order_number ?? row.order_number ?? ''),
      customer_email: patched?.customer_email ? String(patched.customer_email) : (intent.receipt_email || null),
      total: orderTotal,
      currency: patched?.currency ? String(patched.currency) : row.currency || 'usd',
      status: 'paid',
    }).catch(() => null);
  } catch {
    /* best-effort — never fails payment verification */
  }

  return { ok: true, paid: true, orderNumber: row.order_number || null };
}

/** POST /api/checkout/verify — real verification used after confirmPayment. */
export async function verifyHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  let body: unknown;
  try { body = await readJsonBody(req); } catch { sendJson(res, 400, { error: 'Invalid request body.' }); return; }
  const b = (body ?? {}) as Record<string, unknown>;
  const orderNumber = String(b.orderNumber || '').trim();
  const paymentIntentId = String(b.paymentIntentId || '').trim();
  if (!/^LX-/.test(orderNumber)) { sendJson(res, 400, { error: 'Missing order number.' }); return; }
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) { sendJson(res, 400, { error: 'Invalid payment intent.' }); return; }
  const result = await promotePaidIntent(paymentIntentId);
  if (!result.ok) {
    // A succeeded intent with an already-paid order is NOT an error.
    if (result.paid) { sendJson(res, 200, { paid: true, orderNumber: result.orderNumber }); return; }
    sendJson(res, result.status || 500, { error: result.error || 'Could not verify payment.' });
    return;
  }
  sendJson(res, 200, { paid: true, orderNumber: result.orderNumber || orderNumber });
}

/** Worker route dispatcher: GET → config probe, POST → start on-site checkout. */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'GET') { await configHandler(req, res); return; }
  if (req.method === 'POST') { await onsiteHandler(req, res); return; }
  sendJson(res, 405, { error: 'Method not allowed' });
}
