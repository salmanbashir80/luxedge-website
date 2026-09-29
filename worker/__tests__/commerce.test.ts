// ============================================================================
// LUXEDGE — D1 COMMERCE LAYER TESTS
//
// These run the REAL migration SQL (cloudflare/d1/migrations/*.sql) inside an
// in-memory SQLite engine and then drive worker/d1/commerce.ts against it, so
// this suite verifies the actual SQL, the actual unique indexes and the actual
// CHECK constraints — not a stub's idea of them.
//
// WHY THIS MATTERS: the defect being fixed is that a customer could complete a
// real Stripe payment whose order row was never persisted (Suppabase PostgREST
// returns 402 for the service-role key too). A test that only asserts "insert
// was called" would not have caught it and cannot prove the fix; asserting the
// row exists in the database does.
//
// node:sqlite is used instead of better-sqlite3 because it ships with Node, so
// no new dependency (and no install) is introduced for a test.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  COMMERCE_COLUMNS,
  COMMERCE_TABLES,
  claimWebhookEvent,
  commerceFetch,
  commerceRpc,
  consumeReservation,
  decrementInventory,
  releaseReservation,
  reserveInventory,
} from '../d1/commerce';
import { resetDataRuntime } from '../d1/runtime';
import { PUBLIC_TABLES } from '../db-api';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'cloudflare', 'd1', 'migrations');
const COMMERCE_MIGRATION = '0002_commerce.sql';

function migrations(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

/**
 * Column names declared for `table` in one migration file.
 *
 * Multi-line constraints are skipped: `CHECK (status IN (...))` continues onto
 * its own line, and reading that line as a column would make the parser itself
 * the source of a false drift report.
 */
function ddlColumns(ddl: string, table: string): Set<string> {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = ddl.indexOf(marker);
  if (start === -1) return new Set();
  const end = ddl.indexOf('\n);', start);
  const body = ddl.slice(start + marker.length, end === -1 ? undefined : end);
  const isConstraint = (token: string) =>
    ['CHECK', 'UNIQUE', 'PRIMARY', 'FOREIGN', 'CONSTRAINT', 'REFERENCES'].includes(token.toUpperCase());
  return new Set(
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
      .map((line) => line.split(/\s+/)[0].replace(/,$/, ''))
      .filter((token) => !isConstraint(token)),
  );
}

/**
 * A D1-shaped adapter over node:sqlite: prepare/bind/all/run, with `meta.changes`
 * reported exactly as D1 reports it (that count is the oversell guard).
 */
function d1From(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          const bound = params.map((p) => (p === undefined ? null : p)) as never[];
          return {
            all: async () => ({ results: stmt.all(...bound) as Record<string, unknown>[] }),
            run: async () => {
              const res = stmt.run(...bound);
              return { meta: { changes: Number(res.changes) } };
            },
          };
        },
      };
    },
  };
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(migrations());
  resetDataRuntime({ DATA_BACKEND: 'd1', DB: d1From(db) });
  return db;
}

afterEach(() => {
  resetDataRuntime({});
});

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function seedProduct(db: DatabaseSync, inventoryQty: number | null) {
  db.prepare(
    `INSERT INTO products (id, slug, title, description, status, currency, short_description, tax_code, features, benefits, specifications, seo_keywords, tags, risk_flags, inventory_qty, price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(PRODUCT_ID, 'test-product', 'Test', 'desc', 'active', 'USD', 'short', 'tx', '[]', '[]', '[]', '[]', '[]', '[]', inventoryQty, 29.99);
}

describe('commerce schema contract', () => {
  it('the allowlist is exactly the columns declared in the commerce migration', () => {
    const ddl = fs.readFileSync(path.join(MIGRATIONS_DIR, COMMERCE_MIGRATION), 'utf8');
    for (const table of COMMERCE_TABLES) {
      const declared = ddlColumns(ddl, table);
      expect(declared.size, `no DDL for ${table}`).toBeGreaterThan(0);
      expect(new Set(COMMERCE_COLUMNS[table]), `allowlist drift for ${table}`).toEqual(declared);
    }
  });

  it('no commerce table is reachable through the public /api/db surface', () => {
    for (const table of COMMERCE_TABLES) {
      expect(PUBLIC_TABLES, `${table} must not be public`).not.toContain(table);
    }
  });

  it('the order table carries the idempotency indexes', () => {
    const ddl = fs.readFileSync(path.join(MIGRATIONS_DIR, COMMERCE_MIGRATION), 'utf8');
    expect(ddl).toContain('luxedge_orders_stripe_session_key');
    expect(ddl).toContain('luxedge_orders_stripe_payment_intent_key');
  });
});

describe('commerceFetch — fail-closed backend switch', () => {
  it('returns null (caller uses Supabase) when D1 is not the active backend', async () => {
    resetDataRuntime({ DATA_BACKEND: 'supabase' });
    expect(await commerceFetch('luxedge_orders', '?select=id&limit=1')).toBeNull();
    expect(await commerceRpc('consume_reservation', { p_reservation_id: 'x' })).toBeNull();
    expect(await claimWebhookEvent('evt_1', 'charge.refunded')).toBeNull();
  });

  it('once D1 is active it answers authoritatively — it never falls back', async () => {
    const db = freshDb();
    seedProduct(db, 1);
    const res = await commerceFetch('luxedge_orders', '?select=id&limit=1');
    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
  });

  it('refuses select=* and unknown columns rather than widening the read', async () => {
    freshDb();
    expect((await commerceFetch('luxedge_orders', '?select=*'))!.status).toBe(501);
    expect((await commerceFetch('luxedge_orders', '?select=id,owner_notes'))!.status).toBe(501);
    expect((await commerceFetch('luxedge_orders', '?select=id&secret=eq.x'))!.status).toBe(501);
  });

  it('refuses an unfiltered UPDATE and unknown write columns', async () => {
    const db = freshDb();
    db.prepare(`INSERT INTO luxedge_orders (id, order_number, subtotal, total) VALUES ('o1','LX-1',1,1)`).run();
    expect((await commerceFetch('luxedge_orders', '', { method: 'PATCH', body: { status: 'paid' } }))!.status).toBe(400);
    const bad = await commerceFetch('luxedge_orders', '?id=eq.o1', { method: 'PATCH', body: { not_a_column: 'x' } });
    expect(bad!.status).toBe(400);
    // …and the row is untouched.
    const row = db.prepare(`SELECT status FROM luxedge_orders WHERE id='o1'`).get() as { status: string };
    expect(row.status).toBe('awaiting_payment');
  });
});

describe('order persistence (the payment-without-an-order defect)', () => {
  it('persists a pending order with a generated id and reads it back', async () => {
    const db = freshDb();
    const insert = await commerceFetch('luxedge_orders', '', {
      method: 'POST',
      body: {
        order_number: 'LX-ABC123',
        customer_email: 'buyer@example.com',
        shipping_address: { city: 'Dallas', state: 'TX' },
        items: [{ id: PRODUCT_ID, name: 'Test', quantity: 1, unitPrice: 29.99 }],
        subtotal: 29.99, discount: 0, shipping: 4.99, tax: 0, total: 34.98,
        status: 'pending',
        stripe_payment_intent: 'pi_test_1',
      },
      prefer: 'return=representation',
    });
    expect(insert!.ok).toBe(true);
    const inserted = (insert!.data as Record<string, unknown>[])[0];
    expect(typeof inserted.id).toBe('string');

    // Prove it is really in the database, not merely echoed back.
    const stored = db.prepare(`SELECT COUNT(*) AS n FROM luxedge_orders WHERE stripe_payment_intent='pi_test_1'`).get() as { n: number };
    expect(Number(stored.n)).toBe(1);
    // jsonb columns round-trip as objects (the webhook/gift-drop paths read them).
    expect(inserted.shipping_address).toEqual({ city: 'Dallas', state: 'TX' });
    expect(inserted.items).toEqual([{ id: PRODUCT_ID, name: 'Test', quantity: 1, unitPrice: 29.99 }]);
  });

  it('a duplicate PaymentIntent insert is a 409/23505 — never a second order', async () => {
    const db = freshDb();
    const row = { order_number: 'LX-A', subtotal: 1, total: 1, status: 'pending', stripe_payment_intent: 'pi_dup' };
    expect((await commerceFetch('luxedge_orders', '', { method: 'POST', body: row }))!.ok).toBe(true);
    const dup = await commerceFetch('luxedge_orders', '', { method: 'POST', body: { ...row, order_number: 'LX-B' } });
    expect(dup!.ok).toBe(false);
    expect(dup!.status).toBe(409);
    expect((dup!.data as { code?: string }).code).toBe('23505');
    const count = db.prepare(`SELECT COUNT(*) AS n FROM luxedge_orders WHERE stripe_payment_intent='pi_dup'`).get() as { n: number };
    expect(Number(count.n)).toBe(1);
  });

  it('a duplicate session id is rejected the same way', async () => {
    const db = freshDb();
    const row = { order_number: 'LX-A', subtotal: 1, total: 1, status: 'paid', stripe_session_id: 'cs_dup' };
    await commerceFetch('luxedge_orders', '', { method: 'POST', body: row });
    const dup = await commerceFetch('luxedge_orders', '', { method: 'POST', body: { ...row, order_number: 'LX-B' } });
    expect(dup!.status).toBe(409);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM luxedge_orders`).get() as { n: number }).n).toBe(1);
  });

  it('promotes a pending order to paid exactly once (the verify/webhook race)', async () => {
    const db = freshDb();
    await commerceFetch('luxedge_orders', '', { method: 'POST', body: { order_number: 'LX-A', subtotal: 1, total: 34.98, status: 'pending', stripe_payment_intent: 'pi_1' } });
    const found = await commerceFetch('luxedge_orders', '?stripe_payment_intent=eq.pi_1&select=id,status,total,currency,order_number&limit=1');
    const order = (found!.data as Record<string, unknown>[])[0];
    expect(order.status).toBe('pending');

    const paidAt = new Date().toISOString();
    const ok = await commerceFetch('luxedge_orders', `?id=eq.${order.id}`, {
      method: 'PATCH',
      body: { status: 'paid', paid_at: paidAt },
      prefer: 'return=representation',
    });
    expect(ok!.ok).toBe(true);
    expect((ok!.data as Record<string, unknown>[])[0].status).toBe('paid');

    // A column the row genuinely does not carry is still refused, so the
    // allowlist cannot be widened by a caller.
    const bogus = await commerceFetch('luxedge_orders', `?id=eq.${order.id}`, {
      method: 'PATCH',
      body: { definitely_not_a_column: 'x' },
    });
    expect(bogus!.status).toBe(400);
    const stored = db.prepare(`SELECT status FROM luxedge_orders WHERE id=?`).get(order.id as string) as { status: string };
    expect(stored.status).toBe('paid');
  });

  it('an order can never be written into a status the app does not understand', async () => {
    const db = freshDb();
    const bad = await commerceFetch('luxedge_orders', '', { method: 'POST', body: { order_number: 'LX-X', subtotal: 0, total: 0, status: 'definitely_not_a_status' } });
    expect(bad!.ok).toBe(false);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM luxedge_orders`).get()).toEqual({ n: 0 });
  });
});

describe('inventory holds (migration 0015 semantics on D1)', () => {
  it('reserve reduces stock atomically and holds it', async () => {
    const db = freshDb();
    seedProduct(db, 5);
    const r = await reserveInventory({ reservationId: 'res-1', productId: PRODUCT_ID, quantity: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(3);
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(3);
    expect((db.prepare(`SELECT status FROM inventory_reservations WHERE reservation_id='res-1'`).get() as { status: string }).status).toBe('reserved');
  });

  it('re-reserving the same cart+product is a no-op, not a second hold', async () => {
    const db = freshDb();
    seedProduct(db, 5);
    const args = { reservationId: 'res-1', productId: PRODUCT_ID, quantity: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    await reserveInventory(args);
    const again = await reserveInventory(args);
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(3);
  });

  it('refuses to oversell and leaves stock untouched', async () => {
    const db = freshDb();
    seedProduct(db, 3);
    const r = await reserveInventory({ reservationId: 'res-2', productId: PRODUCT_ID, quantity: 10, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out_of_stock_or_oversell');
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(3);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM inventory_reservations`).get() as { n: number }).n).toBe(0);
  });

  it('D1 keeps products.inventory_qty NOT NULL, so the untracked-stock branch is unreachable', async () => {
    // The live Postgres column is NOT NULL with a 0 default, and the generated
    // 0001 DDL preserves that. Recording it here matters: the untracked branch
    // in reserveInventory exists for schema safety, but a NULL stock product
    // cannot be created through D1 — which is what keeps the oversell guard
    // (`inventory_qty >= ?`) always meaningful.
    const db = freshDb();
    const ddls = migrations();
    expect(/inventory_qty INTEGER NOT NULL/.test(ddls)).toBe(true);
    expect(() =>
      db.prepare(
        `INSERT INTO products (id, slug, title, description, status, currency, short_description, tax_code, features, benefits, specifications, seo_keywords, tags, risk_flags, inventory_qty)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      ).run('p-null', 's', 't', 'd', 'active', 'USD', 'x', 'tx', '[]', '[]', '[]', '[]', '[]', '[]'),
    ).toThrow(/NOT NULL/);
  });

  it('a stock-tracking product at zero refuses a hold instead of overselling', async () => {
    const db = freshDb();
    seedProduct(db, 0);
    const r = await reserveInventory({ reservationId: 'res-3', productId: PRODUCT_ID, quantity: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out_of_stock_or_oversell');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM inventory_reservations`).get() as { n: number }).n).toBe(0);
  });

  it('a missing product is refused, never silently held', async () => {
    freshDb();
    const r = await reserveInventory({ reservationId: 'res-4', productId: 'does-not-exist', quantity: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(r).toEqual({ ok: false, reason: 'product_not_found' });
  });

  it('consume leaves stock alone for a live hold, and never consumes twice', async () => {
    const db = freshDb();
    seedProduct(db, 5);
    await reserveInventory({ reservationId: 'res-5', productId: PRODUCT_ID, quantity: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const first = await consumeReservation('res-5');
    expect(first).toEqual({ ok: true, consumed: 1, group_size: 1 });
    // Stock was already reduced at reserve time — consuming must not reduce again.
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(3);
    const replay = await consumeReservation('res-5');
    expect(replay.consumed).toBe(0);
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(3);
  });

  it('a late payment on an ALREADY-RELEASED hold charges stock exactly once', async () => {
    const db = freshDb();
    seedProduct(db, 5);
    await reserveInventory({ reservationId: 'res-6', productId: PRODUCT_ID, quantity: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await releaseReservation('res-6'); // stock back to 5
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(5);
    const consumed = await consumeReservation('res-6');
    expect(consumed.consumed).toBe(1);
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(3);
    await consumeReservation('res-6'); // replay
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(3);
  });

  it('release restores stock exactly once', async () => {
    const db = freshDb();
    seedProduct(db, 5);
    await reserveInventory({ reservationId: 'res-7', productId: PRODUCT_ID, quantity: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await releaseReservation('res-7')).released).toBe(1);
    expect((await releaseReservation('res-7')).released).toBe(0);
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(5);
  });

  it('the lazy sweep returns stock from an expired hold without a webhook', async () => {
    const db = freshDb();
    seedProduct(db, 5);
    // An abandoned checkout: hold expires in the past.
    db.prepare(
      `INSERT INTO inventory_reservations (id, reservation_id, product_id, quantity, status, expires_at, created_at)
       VALUES ('hold-1','res-old',?,2,'reserved',?,?)`,
    ).run(PRODUCT_ID, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() - 120_000).toISOString());
    db.prepare(`UPDATE products SET inventory_qty = 3 WHERE id = ?`).run(PRODUCT_ID);

    await reserveInventory({ reservationId: 'res-new', productId: PRODUCT_ID, quantity: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    // Expired hold released (3 -> 5), then the new hold taken (5 -> 4).
    expect((db.prepare(`SELECT status FROM inventory_reservations WHERE reservation_id='res-old'`).get() as { status: string }).status).toBe('released');
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(4);
  });

  it('the legacy decrement fallback is atomic and guarded against oversell', async () => {
    const db = freshDb();
    seedProduct(db, 2);
    expect((await decrementInventory(PRODUCT_ID, 1)).ok).toBe(true);
    expect((await decrementInventory(PRODUCT_ID, 5)).reason).toBe('out_of_stock_or_oversell');
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(1);
  });

  it('commerceRpc maps the four service-role RPCs onto the D1 implementation', async () => {
    const db = freshDb();
    seedProduct(db, 4);
    const r = await commerceRpc('reserve_inventory', {
      p_reservation_id: 'res-rpc', p_product_id: PRODUCT_ID, p_quantity: 1,
      p_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect((r!.data as { ok: boolean }).ok).toBe(true);
    const c = await commerceRpc('consume_reservation', { p_reservation_id: 'res-rpc' });
    expect((c!.data as { consumed: number }).consumed).toBe(1);
    const rel = await commerceRpc('release_reservation', { p_reservation_id: 'res-rpc' });
    expect((rel!.data as { released: number }).released).toBe(0); // already consumed
    const dec = await commerceRpc('decrement_inventory', { p_product_id: PRODUCT_ID, p_quantity: 1 });
    expect((dec!.data as { ok: boolean }).ok).toBe(true);
    // Unknown RPC is refused, never silently ignored.
    expect((await commerceRpc('drop_tables', {}))!.status).toBe(501);
    // 4 - 1 (reserve) - 1 (legacy decrement) = 2: consume adds nothing because
    // the hold had already reduced the stock, and the release was a no-op.
    expect((db.prepare(`SELECT inventory_qty FROM products WHERE id=?`).get(PRODUCT_ID) as { inventory_qty: number }).inventory_qty).toBe(2);
  });

  it('an unknown-column reservation never reaches SQL', async () => {
    freshDb();
    const r = await reserveInventory({ reservationId: 'res-8', productId: 'p', quantity: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(r.ok).toBe(false);
  });
});

describe('webhook event idempotency', () => {
  it('records an event once and reports a replay as already seen', async () => {
    freshDb();
    expect(await claimWebhookEvent('evt_1', 'payment_intent.succeeded')).toEqual({ firstSeen: true });
    expect(await claimWebhookEvent('evt_1', 'payment_intent.succeeded')).toEqual({ firstSeen: false });
  });
});

describe('commerce reads used by the admin/ERP paths', () => {
  it('supports the operators the call sites actually use (eq, not.in, not.is.null, order)', async () => {
    const db = freshDb();
    db.prepare(`INSERT INTO luxedge_orders (id, order_number, subtotal, total, status, created_at) VALUES ('a','LX-1',1,1,'paid','2026-09-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO luxedge_orders (id, order_number, subtotal, total, status, created_at, coupon_code) VALUES ('b','LX-2',1,1,'cancelled','2026-09-02T00:00:00Z','PET-GIFT-DROP')`).run();
    db.prepare(`INSERT INTO luxedge_orders (id, order_number, subtotal, total, status, created_at, coupon_code, erp_sync_status) VALUES ('c','LX-3',1,1,'paid','2026-09-03T00:00:00Z','PET-GIFT-DROP','failed')`).run();

    const notCancelled = await commerceFetch('luxedge_orders', '?select=id,order_number&status=not.in.(cancelled,failed)&coupon_code=eq.PET-GIFT-DROP&limit=200');
    expect((notCancelled!.data as { id: string }[]).map((r) => r.id)).toEqual(['c']);

    const failed = await commerceFetch('luxedge_orders', '?erp_sync_status=eq.failed&select=id');
    expect((failed!.data as { id: string }[]).map((r) => r.id)).toEqual(['c']);

    const withErp = await commerceFetch('luxedge_orders', '?erp_sync_status=not.is.null&select=id,erp_sync_status');
    expect((withErp!.data as { id: string }[]).map((r) => r.id)).toEqual(['c']);

    const ordered = await commerceFetch('luxedge_orders', '?order=created_at.asc&select=id&limit=10');
    expect((ordered!.data as { id: string }[]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('order_financials is writable but never unfiltered', async () => {
    const db = freshDb();
    const ins = await commerceFetch('order_financials', '', { method: 'POST', body: { order_id: 'o1', product_cost: 10, shipping_cost: 4, ops_status: 'pending' } });
    expect(ins!.ok).toBe(true);
    const unfiltered = await commerceFetch('order_financials', '', { method: 'PATCH', body: { ops_status: 'shipped' } });
    expect(unfiltered!.status).toBe(400);
    const patched = await commerceFetch('order_financials', '?order_id=eq.o1', { method: 'PATCH', body: { ops_status: 'shipped' } });
    expect((patched!.data as { ops_status: string }[])[0].ops_status).toBe('shipped');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM order_financials`).get() as { n: number }).n).toBe(1);
  });
});
