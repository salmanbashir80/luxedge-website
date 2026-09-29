// ============================================================================
// LUXEDGE — ON-SITE CHECKOUT ON THE CLOUDFLARE D1 BACKEND (end-to-end)
//
// THE DEFECT THIS PROVES FIXED: with Supabase PostgREST returning HTTP 402
// exceed_egress_quota (for the service-role key too), a customer could complete
// a real Stripe payment whose order row was never persisted — money taken, no
// order, stock silently held or never released.
//
// Every assertion here reads the REAL database: the actual migration
// (cloudflare/d1/migrations/*.sql) runs in an in-memory SQLite engine and the
// real route handler is driven against it. Nothing is stubbed at the data layer
// — only Stripe and Shippo (external services we must not call in a test) are.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler, { promotePaidIntent } from '../checkout-onsite.js';
import { resetDataRuntime } from '../../worker/d1/runtime';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'cloudflare', 'd1', 'migrations');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const STRIPE = 'sk_test_probe_secret';
const PK = 'pk_test_probe_publishable';

const original = {
  url: process.env.VITE_SUPABASE_URL,
  sr: process.env.SUPABASE_SERVICE_ROLE_KEY,
  stripe: process.env.STRIPE_SECRET_KEY,
  pk: process.env.STRIPE_PUBLISHABLE_KEY,
};

function migrations(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

function d1From(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          const bound = params.map((p) => (p === undefined ? null : p)) as never[];
          return {
            all: async () => ({ results: stmt.all(...bound) as Record<string, unknown>[] }),
            run: async () => ({ meta: { changes: Number(stmt.run(...bound).changes) } }),
          };
        },
      };
    },
  };
}

/** The real D1 schema plus a real product, coupon and free-shipping setting. */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(migrations());
  db.prepare(
    `INSERT INTO products (id, slug, title, description, status, currency, short_description, tax_code, features, benefits, specifications, seo_keywords, tags, risk_flags, inventory_qty, price, name, weight_oz)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    PRODUCT_ID, 'test-product', 'Test Product', 'A real description of the product.', 'active', 'USD',
    'Short description', 'tx', '[]', '[]', '[]', '[]', '[]', '[]', 10, 25, 'Test Product', 8,
  );
  db.prepare(
    `INSERT INTO coupons (id, code, discount_type, discount_value, min_cart_value, eligible_product_ids, eligible_category_ids, is_active)
     VALUES ('c1','WELCOME10','percent',10,0,'[]','[]',1)`,
  ).run();
  db.prepare(
    `INSERT INTO store_settings (key, value) VALUES ('free_shipping', '{"freeShippingEnabled":true,"freeShippingThreshold":50}')`,
  ).run();
  resetDataRuntime({ DATA_BACKEND: 'd1', DB: d1From(db) });
  return db;
}

/** Only Stripe + Shippo are stubbed — the data layer is the real D1 schema. */
function stubExternal(opts: { intentStatus?: string; intentAmount?: number } = {}) {
  const piCalls: Array<Record<string, string>> = [];
  let lastMetadata: Record<string, string> = {};
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.startsWith('https://api.goshippo.com/addresses/')) {
      return json({
        object_id: 'addr_probe', street1: '456 ELM ST', city: 'DALLAS', state: 'TX', zip: '75201', country: 'US',
        validation_results: { is_valid: true, messages: [] },
      });
    }
    if (url.startsWith('https://api.goshippo.com/shipments/')) {
      return json({ rates: [{ object_id: 'rate_probe_1', provider: 'USPS', servicelevel: { name: 'Priority' }, amount: '6.45', currency: 'USD', days: 3, duration_terms: '3 days' }] });
    }
    if (url.startsWith('https://api.stripe.com/v1/payment_intents') && method === 'POST') {
      const body = new URLSearchParams(String(init?.body || ''));
      const flat = Object.fromEntries(body.entries());
      piCalls.push(flat);
      // Stripe echoes back the metadata that was set at creation, and the
      // inventory reservation id lives ONLY there — so a retrieval that dropped
      // it would silently skip consuming the hold.
      lastMetadata = Object.fromEntries(
        Object.entries(flat)
          .filter(([k]) => k.startsWith('metadata['))
          .map(([k, v]) => [k.slice('metadata['.length, -1), v]),
      );
      return json({ id: 'pi_d1_1', client_secret: 'pi_d1_1_secret', amount: 2999, currency: 'usd', status: 'requires_payment_method' });
    }
    if (url.startsWith('https://api.stripe.com/v1/payment_intents/')) {
      return json({
        id: 'pi_d1_1',
        status: opts.intentStatus || 'succeeded',
        amount: opts.intentAmount ?? 2999,
        currency: 'usd',
        receipt_email: 'buyer@example.com',
        metadata: lastMetadata,
      });
    }
    // Any Supabase call would be a regression: on D1 the data layer must not
    // reach PostgREST at all.
    if (url.includes('/rest/v1/')) throw new Error(`unexpected Supabase call: ${url}`);
    return json({ error: 'not found' }, 404);
  }));
  return { piCalls };
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

function req(payload?: unknown): IncomingMessage {
  const body = payload ? JSON.stringify(payload) : '';
  const r = { method: 'POST', url: '/api/checkout/onsite', headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '203.0.113.9' } } as unknown as IncomingMessage;
  Object.defineProperty(r, 'on', {
    configurable: true,
    value: (name: string, fn: (chunk?: Buffer) => void) => {
      if (name === 'data' && body) process.nextTick(() => fn(Buffer.from(body)));
      if (name === 'end') process.nextTick(() => fn());
      return r;
    },
  });
  return r;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ id: PRODUCT_ID, quantity: 1 }],
    email: 'buyer@example.com',
    phone: '(555) 123-4567',
    fullName: 'Jane Smith',
    address: { line1: '456 Elm St', line2: '', city: 'Dallas', state: 'TX', zip: '75201', country: 'US' },
    ...overrides,
  };
}

const count = (db: DatabaseSync, sql: string, ...params: string[]) =>
  Number((db.prepare(sql).get(...params) as { n: number }).n);

describe('on-site checkout persists orders to Cloudflare D1', () => {
  beforeEach(() => {
    // Deliberately NO Supabase credentials: the D1 path must stand alone, which
    // is the whole point of the migration. orderStorageConfigured() passes on D1.
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.STRIPE_SECRET_KEY = STRIPE;
    process.env.STRIPE_PUBLISHABLE_KEY = PK;
    process.env.SHIPPO_FROM_NAME = 'Luxedge HQ';
    process.env.SHIPPO_FROM_ADDRESS = '1 Fulfilment Way';
    process.env.SHIPPO_FROM_CITY = 'Dallas';
    process.env.SHIPPO_FROM_STATE = 'TX';
    process.env.SHIPPO_FROM_ZIP = '75201';
  });
  afterEach(() => {
    resetDataRuntime({});
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete process.env.SHIPPO_FROM_NAME;
    delete process.env.SHIPPO_FROM_ADDRESS;
    delete process.env.SHIPPO_FROM_CITY;
    delete process.env.SHIPPO_FROM_STATE;
    delete process.env.SHIPPO_FROM_ZIP;
  });

  it('checkout is open on D1 even with no Supabase configuration at all', async () => {
    const db = freshDb();
    stubExternal();
    const { server, cap } = res();
    await handler(req(body()), server);
    expect(cap.status, JSON.stringify(cap.body)).toBe(200);
    expect(count(db, `SELECT COUNT(*) AS n FROM luxedge_orders`)).toBe(1);
  });

  it('persists a PENDING order keyed by the PaymentIntent and holds stock', async () => {
    const db = freshDb();
    const { piCalls } = stubExternal();
    const { server, cap } = res();
    await handler(req(body()), server);

    expect(cap.status).toBe(200);
    const out = cap.body as { paymentIntentId: string; clientSecret: string; orderNumber: string; totals: { total: number } };
    expect(out.paymentIntentId).toBe('pi_d1_1');
    expect(out.orderNumber).toMatch(/^LX-/);
    // Server-authoritative total is what Stripe was asked for.
    expect(piCalls[0].amount).toBe('2999');

    const order = db.prepare(`SELECT order_number, status, total, stripe_payment_intent, customer_email, shipping_address, items FROM luxedge_orders`).get() as Record<string, unknown>;
    expect(order.status).toBe('pending');
    expect(order.stripe_payment_intent).toBe('pi_d1_1');
    expect(Number(order.total)).toBeCloseTo(29.99, 2);
    expect(order.customer_email).toBe('buyer@example.com');
    // jsonb columns are real objects on the way out, exactly as PostgREST gave them.
    expect(JSON.parse(String(order.shipping_address))).toMatchObject({ city: 'Dallas', state: 'TX', postal_code: '75201' });
    expect(JSON.parse(String(order.items))).toHaveLength(1);

    // Stock held at reserve time (this is what stops the oversell race).
    const inv = db.prepare(`SELECT inventory_qty FROM products WHERE id = ?`).get(PRODUCT_ID) as { inventory_qty: number };
    expect(Number(inv.inventory_qty)).toBe(9);
    expect(count(db, `SELECT COUNT(*) AS n FROM inventory_reservations WHERE status = 'reserved'`)).toBe(1);
  });

  it('promotes the pending order to paid exactly once and consumes the hold', async () => {
    const db = freshDb();
    stubExternal();
    const { server } = res();
    await handler(req(body()), server);

    const first = await promotePaidIntent('pi_d1_1');
    expect(first.ok).toBe(true);
    expect(first.paid).toBe(true);
    expect((db.prepare(`SELECT status FROM luxedge_orders`).get() as { status: string }).status).toBe('paid');
    // Consuming a live hold must NOT reduce stock a second time.
    expect(Number((db.prepare(`SELECT inventory_qty FROM products WHERE id = ?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty)).toBe(9);
    expect(count(db, `SELECT COUNT(*) AS n FROM inventory_reservations WHERE status = 'consumed'`)).toBe(1);

    // Replay (Stripe retries, or the client verify races the webhook).
    const replay = await promotePaidIntent('pi_d1_1');
    expect(replay.ok).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect(count(db, `SELECT COUNT(*) AS n FROM luxedge_orders`)).toBe(1);
    expect(Number((db.prepare(`SELECT inventory_qty FROM products WHERE id = ?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty)).toBe(9);
  });

  it('never marks an order paid when the charged amount disagrees with it', async () => {
    const db = freshDb();
    stubExternal({ intentAmount: 9999 });
    const { server } = res();
    await handler(req(body()), server);

    const r = await promotePaidIntent('pi_d1_1');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    // The row must stay pending: an underpaid/overpaid intent is never "paid".
    expect((db.prepare(`SELECT status FROM luxedge_orders`).get() as { status: string }).status).toBe('pending');
    expect(count(db, `SELECT COUNT(*) AS n FROM inventory_reservations WHERE status = 'consumed'`)).toBe(0);
  });

  it('never marks an order paid for a non-succeeded PaymentIntent', async () => {
    const db = freshDb();
    stubExternal({ intentStatus: 'requires_payment_method' });
    const { server } = res();
    await handler(req(body()), server);

    const r = await promotePaidIntent('pi_d1_1');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(402);
    expect((db.prepare(`SELECT status FROM luxedge_orders`).get() as { status: string }).status).toBe('pending');
  });

  it('refuses to start checkout when the cart is out of stock, writing no order', async () => {
    const db = freshDb();
    db.prepare(`UPDATE products SET inventory_qty = 0 WHERE id = ?`).run(PRODUCT_ID);
    stubExternal();
    const { server, cap } = res();
    await handler(req(body()), server);
    expect(cap.status).toBe(400);
    expect((cap.body as { code?: string }).code).toBe('OUT_OF_STOCK');
    expect(count(db, `SELECT COUNT(*) AS n FROM luxedge_orders`)).toBe(0);
    expect(count(db, `SELECT COUNT(*) AS n FROM inventory_reservations`)).toBe(0);
  });

  it('releases the hold when Stripe rejects the PaymentIntent, writing no order', async () => {
    const db = freshDb();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://api.goshippo.com/addresses/')) {
        return json({ object_id: 'a', street1: '456 ELM ST', city: 'DALLAS', state: 'TX', zip: '75201', country: 'US', validation_results: { is_valid: true, messages: [] } });
      }
      if (url.startsWith('https://api.goshippo.com/shipments/')) {
        return json({ rates: [{ object_id: 'rate_probe_1', provider: 'USPS', servicelevel: { name: 'Priority' }, amount: '6.45', currency: 'USD', days: 3, duration_terms: '3 days' }] });
      }
      if (url.startsWith('https://api.stripe.com/v1/payment_intents') && (init?.method || 'GET') === 'POST') {
        return json({ error: { message: 'Your card was declined.' } }, 402);
      }
      if (url.includes('/rest/v1/')) throw new Error(`unexpected Supabase call: ${url}`);
      return json({}, 404);
    }));

    const { server, cap } = res();
    await handler(req(body()), server);
    expect(cap.status).toBe(402);
    expect(count(db, `SELECT COUNT(*) AS n FROM luxedge_orders`)).toBe(0);
    // The hold must be given back — stock is not silently consumed by a failure.
    expect(Number((db.prepare(`SELECT inventory_qty FROM products WHERE id = ?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty)).toBe(10);
    expect(count(db, `SELECT COUNT(*) AS n FROM inventory_reservations WHERE status = 'released'`)).toBe(1);
  });

  it('applies a real coupon from D1 without trusting a client price', async () => {
    const db = freshDb();
    stubExternal();
    const { server, cap } = res();
    await handler(req(body({ couponCode: 'WELCOME10' })), server);
    expect(cap.status).toBe(200);
    const order = db.prepare(`SELECT discount, coupon_code, total FROM luxedge_orders`).get() as Record<string, unknown>;
    expect(Number(order.discount)).toBeCloseTo(2.5, 2);
    expect(order.coupon_code).toBe('WELCOME10');
  });

  it('a repeated identical checkout cannot create a second order for one intent', async () => {
    const db = freshDb();
    stubExternal();
    const a = res();
    await handler(req(body()), a.server);
    const b = res();
    // Same PaymentIntent id from Stripe (the dupe index is what makes this safe).
    await handler(req(body()), b.server);
    expect(count(db, `SELECT COUNT(*) AS n FROM luxedge_orders WHERE stripe_payment_intent = 'pi_d1_1'`)).toBe(1);
    expect(b.cap.status).toBe(409);
  });
});
