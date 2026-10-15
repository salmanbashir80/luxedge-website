// ============================================================================
// LUXEDGE — /api/checkout/onsite ROUTE TESTS
//
// The on-site (PaymentElement) flow must:
//   - compute authoritative totals server-side (never trust client prices),
//   - reserve inventory atomically and persist a PENDING order keyed by the
//     PaymentIntent id,
//   - return the client secret WITHOUT exposing secrets,
//   - validate the address (Shippo) and the chosen shipping rate server-side,
//   - never send the customer to Stripe-hosted checkout.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../checkout-onsite.js';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ANON = 'anon-key';
const SR = 'service-role-key';
const STRIPE = 'sk_test_probe_secret';
const PK = 'pk_test_probe_publishable';

const original = {
  url: process.env.VITE_SUPABASE_URL,
  anon: process.env.VITE_SUPABASE_ANON_KEY,
  sr: process.env.SUPABASE_SERVICE_ROLE_KEY,
  stripe: process.env.STRIPE_SECRET_KEY,
  pk: process.env.STRIPE_PUBLISHABLE_KEY,
};

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT = { id: PRODUCT_ID, slug: 'test-product', name: 'Test Product', price: 25, status: 'active', inventory_qty: 10, image_url: 'https://img.test/x.jpg', weight_oz: 8 };
const WELCOME10 = { code: 'WELCOME10', discount_type: 'percent', discount_value: 10, min_cart_value: 0, is_active: true, start_at: null, end_at: null };
const SETTINGS = { key: 'free_shipping', value: { freeShippingEnabled: true, freeShippingThreshold: 50 } };

function validBody(): {
  items: { id: string; quantity: number }[];
  couponCode?: string;
  email: string;
  phone?: string;
  fullName: string;
  address: { line1: string; line2?: string; city: string; state: string; zip: string; country: string };
  shippingRateId?: string;
} {
  return {
    items: [{ id: PRODUCT_ID, quantity: 1 }],
    couponCode: undefined,
    email: 'buyer@example.com',
    phone: '(555) 123-4567',
    fullName: 'Jane Smith',
    address: { line1: '456 Elm St', line2: '', city: 'Dallas', state: 'TX', zip: '75201', country: 'US' },
    shippingRateId: undefined,
  };
}

/** Stub PostgREST + Stripe + Shippo. Handles the real catalog, reservations,
 * PaymentIntent creation and a single deterministic Shippo rate. */
function stubEnv(opts: { invalidAddress?: boolean; reserveFail?: boolean } = {}) {
  const insertedOrders: Array<Record<string, unknown>> = [];
  const piCalls: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const reserveCalls: number[] = [];
  const releaseCalls: number[] = [];

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push(`${method} ${url}`);

    // Shippo address validation + from/to address creation for rates.
    if (url.startsWith('https://api.goshippo.com/addresses/')) {
      if (opts.invalidAddress) {
        return new Response(JSON.stringify({
          street1: '999 NOPE ST', city: 'NOWHERE', state: 'ZZ', zip: '99999',
          validation_results: { is_valid: false, messages: [{ text: 'The address could not be verified.' }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        object_id: 'addr_to_probe', street1: '456 ELM ST', city: 'DALLAS', state: 'TX', zip: '75201', country: 'US',
        validation_results: { is_valid: true, messages: [] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Shippo shipment rates → one deterministic rate (amount 6.45).
    if (url.startsWith('https://api.goshippo.com/shipments/')) {
      return new Response(JSON.stringify({
        rates: [{
          object_id: 'rate_probe_1', provider: 'USPS', servicelevel: { name: 'Priority' },
          amount: '6.45', currency: 'USD', days: 3, duration_terms: '3 days',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Stripe PaymentIntent creation.
    if (url.startsWith('https://api.stripe.com/v1/payment_intents') && method === 'POST') {
      const body = new URLSearchParams(String(init?.body || ''));
      piCalls.push(Object.fromEntries(body.entries()));
      return new Response(JSON.stringify({
        id: 'pi_test_123', client_secret: 'pi_test_123_secret_abc', amount: 5100, currency: 'usd', status: 'requires_payment_method',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Reservation RPCs.
    if (url.includes('/rest/v1/rpc/reserve_inventory')) {
      reserveCalls.push(1);
      if (opts.reserveFail) return new Response(JSON.stringify({ ok: false, reason: 'out_of_stock' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true, remaining: 8 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/rest/v1/rpc/release_reservation')) {
      releaseCalls.push(1);
      return new Response(JSON.stringify({ ok: true, released: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Catalog / coupons / settings / orders.
    if (url.includes('/rest/v1/products')) return new Response(JSON.stringify([PRODUCT]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/rest/v1/coupons')) return new Response(JSON.stringify([WELCOME10]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/rest/v1/store_settings')) return new Response(JSON.stringify([SETTINGS]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/rest/v1/luxedge_orders')) {
      if (method === 'POST') {
        const b = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        insertedOrders.push(b);
        return new Response(JSON.stringify([{ id: 'ord_onsite_1', ...b }]), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }));

  return { insertedOrders, piCalls, calls, reserveCalls, releaseCalls };
}

interface Cap { status: number; body: unknown }
function res(): { server: ServerResponse; cap: Cap } {
  const cap: Cap = { status: 200, body: null };
  const server = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (payload?: unknown) => {
      cap.status = (server as { statusCode: number }).statusCode;
      try { cap.body = payload ? JSON.parse(String(payload)) : null; } catch { cap.body = String(payload); }
    },
  } as unknown as ServerResponse;
  return { server, cap };
}

function req(method: string, path: string, payload?: unknown): IncomingMessage {
  const body = payload ? JSON.stringify(payload) : '';
  const r = {
    method,
    url: path,
    headers: payload ? { 'content-type': 'application/json' } : {},
    socket: { remoteAddress: '203.0.113.9' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data' && body) process.nextTick(() => fn(Buffer.from(body)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

describe('GET /api/checkout/onsite (config probe)', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SR;
    process.env.STRIPE_SECRET_KEY = STRIPE;
    process.env.STRIPE_PUBLISHABLE_KEY = PK;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete process.env.SHIPPO_API_KEY;
  });

  it('returns the publishable key + configuration WITHOUT any secret', async () => {
    stubEnv();
    const { server, cap } = res();
    await handler(req('GET', '/api/checkout/onsite'), server);
    expect(cap.status).toBe(200);
    const b = cap.body as { stripeConfigured: boolean; stripePublishableKey: string | null; stripeMode: string | null };
    expect(b.stripeConfigured).toBe(true);
    expect(b.stripePublishableKey).toBe(PK);
    expect(JSON.stringify(b)).not.toContain(STRIPE);
    expect(JSON.stringify(b)).not.toContain('sk_test');
  });
});

describe('POST /api/checkout/onsite (start on-site payment)', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
    process.env.VITE_SUPABASE_ANON_KEY = ANON;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SR;
    process.env.STRIPE_SECRET_KEY = STRIPE;
    process.env.STRIPE_PUBLISHABLE_KEY = PK;
    process.env.SHIPPO_FROM_NAME = 'Luxedge HQ';
    process.env.SHIPPO_FROM_ADDRESS = '1 Fulfilment Way';
    process.env.SHIPPO_FROM_CITY = 'Dallas';
    process.env.SHIPPO_FROM_STATE = 'TX';
    process.env.SHIPPO_FROM_ZIP = '75201';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete process.env.SHIPPO_API_KEY;
    delete process.env.SHIPPO_FROM_NAME;
    delete process.env.SHIPPO_FROM_ADDRESS;
    delete process.env.SHIPPO_FROM_CITY;
    delete process.env.SHIPPO_FROM_STATE;
    delete process.env.SHIPPO_FROM_ZIP;
  });

  it('creates a PaymentIntent for the server total and persists a pending order (no hosted URL)', async () => {
    const { insertedOrders, piCalls, reserveCalls } = stubEnv();
    const { server, cap } = res();
    await handler(req('POST', '/api/checkout/onsite', validBody()), server);
    expect(cap.status).toBe(200);
    const b = cap.body as { clientSecret: string; paymentIntentId: string; orderNumber: string; totals: { total: number; shipping: number } };
    expect(b.paymentIntentId).toBe('pi_test_123');
    expect(b.clientSecret).toContain('pi_test_123');
    expect(b.orderNumber).toMatch(/^LX-/);
    // 1 × $25 subtotal, no coupon → total includes flat shipping $4.99.
    expect(b.totals.total).toBeCloseTo(29.99, 2);
    // The client must never receive the Stripe secret or a hosted URL.
    expect(JSON.stringify(b)).not.toContain('sk_');
    expect(JSON.stringify(b)).not.toContain('checkout.stripe.com');
    // Stripe was charged exactly the server total.
    expect(piCalls.length).toBe(1);
    expect(piCalls[0].amount).toBe('2999');
    expect(reserveCalls.length).toBe(1);
    // Pending order persisted keyed by the intent.
    expect(insertedOrders.length).toBe(1);
    expect(insertedOrders[0].status).toBe('pending');
    expect(insertedOrders[0].stripe_payment_intent).toBe('pi_test_123');
    expect(insertedOrders[0].shipping_address).toMatchObject({ postal_code: '75201', state: 'TX' });
  });

  it('validates the address via Shippo and blocks clearly-invalid addresses BEFORE any reservation/order', async () => {
    process.env.SHIPPO_API_KEY = 'shippo_test_abc';
    const { reserveCalls, insertedOrders } = stubEnv({ invalidAddress: true });
    const bad = validBody();
    bad.address = { line1: '999 NOPE ST', line2: '', city: 'Nowhere', state: 'TX', zip: '99999', country: 'US' };
    const { server, cap } = res();
    await handler(req('POST', '/api/checkout/onsite', bad), server);
    expect(cap.status).toBe(400);
    expect((cap.body as { error: string }).error).toMatch(/verif|double-check/i);
    expect(reserveCalls.length).toBe(0);
    expect(insertedOrders.length).toBe(0);
  });

  it('blocks non-US shipping addresses (USA-only storefront) BEFORE any reservation/order', async () => {
    process.env.SHIPPO_API_KEY = 'shippo_test_abc';
    const { reserveCalls, insertedOrders } = stubEnv();
    const body = validBody();
    body.address = { line1: '1 Maple Ave', line2: '', city: 'Toronto', state: 'ON', zip: 'M5V 2T6', country: 'CA' };
    const { server, cap } = res();
    await handler(req('POST', '/api/checkout/onsite', body), server);
    expect(cap.status).toBe(400);
    expect((cap.body as { error: string }).error).toMatch(/United States/i);
    expect(reserveCalls.length).toBe(0);
    expect(insertedOrders.length).toBe(0);
  });

  it('rejects a rate id that is not among the real Shippo rates (no client-chosen shipping price)', async () => {
    process.env.SHIPPO_API_KEY = 'shippo_test_abc';
    const { reserveCalls, insertedOrders } = stubEnv();
    const body = validBody();
    body.shippingRateId = 'rate_fake_not_returned';
    const { server, cap } = res();
    await handler(req('POST', '/api/checkout/onsite', body), server);
    expect(cap.status).toBe(400);
    expect((cap.body as { error: string }).error).toMatch(/shipping method/i);
    expect(reserveCalls.length).toBe(0);
    expect(insertedOrders.length).toBe(0);
  });

  it('rejects an empty / malformed cart and never touches Stripe', async () => {
    const { piCalls } = stubEnv();
    const { server, cap } = res();
    await handler(req('POST', '/api/checkout/onsite', { items: [] }), server);
    expect(cap.status).toBe(400);
    expect(piCalls.length).toBe(0);
  });
});
