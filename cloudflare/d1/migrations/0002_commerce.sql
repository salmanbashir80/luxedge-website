-- ============================================================================
-- LUXEDGE — CLOUDFLARE D1 MIGRATION 0002 — COMMERCE / ORDER PERSISTENCE
--
-- HAND-AUTHORED (unlike 0001, which is generated from the live Postgres schema
-- by scripts/d1-generate-schema.mjs). Commerce is not part of the public read
-- surface, so it is not in the generator's table list — but the column lists
-- below ARE transcribed from the authoritative live schema captured
-- 2026-09-29 (673 columns / 53 tables), not from supabase/migrations/*.sql,
-- which are known to lag it. A hand-guessed column list is what silently
-- empties a storefront; the same rule applies to orders.
--
-- WHY THIS EXISTS (the blocker it closes):
--   api/checkout-onsite.ts, api/webhook.ts and api/admin/erp.ts write orders
--   through Supabase PostgREST, which returns HTTP 402 exceed_egress_quota for
--   the service-role key too. Today a customer can complete a Stripe payment
--   whose order row CANNOT be persisted — money taken, no order. Payment
--   without durable order persistence is unacceptable, so order persistence
--   moves to D1 *before* any other cutover consideration.
--
-- SCOPE (minimum required for checkout → payment → order): 4 tables.
--   luxedge_orders            the live order table the checkout + webhook use
--   inventory_reservations    the reservation ledger (migration 0015 semantics)
--   order_financials          admin Sales module cost/refund ledger
--   processed_webhook_events  Stripe event-id idempotency gate
-- The unused parallel `orders`/`order_items`/`payments` tables (0 rows live)
-- are deliberately NOT migrated: they are not on the checkout path.
--
-- POSTGRES -> D1 TYPE ADAPTATION (same rules as 0001):
--   uuid/text          -> TEXT     (ids preserved verbatim so Stripe ids, buyer
--                                   ids and erp ledgers keep referring to the
--                                   same rows across the cutover)
--   boolean            -> INTEGER 0/1 (coerced back to real booleans on read)
--   numeric            -> NUMERIC  (money never loses precision)
--   jsonb              -> TEXT     (tolerant read; see worker/d1/table-schema.ts)
--   timestamptz        -> TEXT     (ISO-8601 preserved verbatim)
--
-- DEFAULTS: Postgres-only expressions (gen_random_uuid()) are dropped — D1 has
-- no equivalent and the application supplies ids explicitly. The remaining
-- defaults are real and load-bearing: `items` defaults to '[]', `status` to
-- 'awaiting_payment', `order_type` to 'paid', `payment_required` to 1,
-- `payment_provider` to 'stripe', `payment_status` to 'pending'. Live Postgres
-- relies on them (the webhook's insert omits those columns), so D1 must carry
-- the same defaults or a webhook insert would fail on NOT NULL.
--
-- D1 FREE-TIER LIMITS RESPECTED (verified 2026-09-29 from
-- developers.cloudflare.com/d1/platform/limits): 100 columns/table (widest here
-- is luxedge_orders at 29), 2 MB max row/string, 500 MB max database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- luxedge_orders — the order of record for both checkout flows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS luxedge_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  customer_email TEXT,
  customer_name TEXT,
  shipping_address TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  coupon_code TEXT,
  subtotal NUMERIC NOT NULL,
  discount NUMERIC NOT NULL DEFAULT 0,
  shipping NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  -- Mirrors the live CHECK constraint (migration 0014). An order can never be
  -- written into a status the admin UI and the webhook do not understand.
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('pending','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded','partially_refunded','failed')),
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refunded_amount NUMERIC NOT NULL DEFAULT 0,
  refunded_at TEXT,
  order_type TEXT NOT NULL DEFAULT 'paid',
  payment_required INTEGER NOT NULL DEFAULT 1,
  payment_provider TEXT NOT NULL DEFAULT 'stripe',
  payment_provider_payment_id TEXT,
  payment_provider_order_id TEXT,
  erp_sync_status TEXT,
  erp_synced_at TEXT,
  erp_sync_error TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  -- -------------------------------------------------------------------------
  -- WRITTEN BY THE APP, MISSING FROM THE LIVE SUPABASE TABLE.
  --
  -- api/checkout-onsite.ts persists the chosen shipping method and PATCHes
  -- paid_at when the PaymentIntent succeeds. Verified against the live schema
  -- (2026-09-29): none of these five columns exist on the live
  -- `luxedge_orders` — they live on the unused `orders` table instead. That
  -- means the on-site write currently fails on BOTH backends: PostgREST rejects
  -- an unknown column in the body (PGRST204) and D1 would refuse it by
  -- allowlist. Order persistence is exactly what this migration exists to fix,
  -- and "shipping details required by the current app" is in scope, so the
  -- columns are added here and the same DDL is recorded for Supabase in
  -- supabase/migrations/0033 (idempotent, additive, NOT yet applied live).
  --
  -- These are fulfilment facts the app really collects (they are what the
  -- customer picked and what the carrier quoted), never fabricated defaults:
  -- shipping_method is 'free' | 'flat' | 'shippo' and the carrier/service are
  -- NULL for anything that did not come from a live rate.
  -- -------------------------------------------------------------------------
  shipping_method TEXT,
  shipping_carrier TEXT,
  shipping_service TEXT,
  shipping_rate_id TEXT,
  paid_at TEXT,
  -- Same situation: the checkout collects the customer's phone for delivery and
  -- persists it, but `luxedge_orders` never had the column (only the unused
  -- `orders.phone` does). Without it the insert is rejected outright, so the
  -- order — not just the phone — would be lost.
  customer_phone TEXT
);

-- IDEMPOTENCY (the whole point of these two indexes):
--   * stripe_session_id is UNIQUE live (migration 0013) — a replayed
--     checkout.session.completed finds the existing row instead of inserting a
--     duplicate order.
--   * stripe_payment_intent is UNIQUE *partial* (migration 0030) so the on-site
--     flow can persist a pending row before Stripe confirms and a duplicate
--     verify/webhook race is a no-op. SQLite supports the same partial form;
--     the WHERE clause keeps legacy/NULL rows out of the index exactly as
--     Postgres does.
CREATE UNIQUE INDEX IF NOT EXISTS luxedge_orders_stripe_session_key
  ON luxedge_orders (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS luxedge_orders_stripe_payment_intent_key
  ON luxedge_orders (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_luxedge_orders_created_at ON luxedge_orders (created_at);
CREATE INDEX IF NOT EXISTS idx_luxedge_orders_status ON luxedge_orders (status);
CREATE INDEX IF NOT EXISTS idx_luxedge_orders_coupon_code ON luxedge_orders (coupon_code);
CREATE INDEX IF NOT EXISTS idx_luxedge_orders_order_number ON luxedge_orders (order_number);
-- Admin → Orders → ERP Sync scans the ledger by this column.
CREATE INDEX IF NOT EXISTS idx_luxedge_orders_erp_sync_status ON luxedge_orders (erp_sync_status);

-- ---------------------------------------------------------------------------
-- inventory_reservations — stock held between checkout create and payment
-- (migration 0015). Stock is reduced at RESERVE, consumed at PAID, restored at
-- RELEASE; the status column is what makes every one of those idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','consumed','released','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT,
  released_at TEXT,
  -- Re-calling reserve_inventory for the same cart is a no-op, not a second hold.
  UNIQUE (reservation_id, product_id)
);
CREATE INDEX IF NOT EXISTS inventory_reservations_group_idx ON inventory_reservations (reservation_id);
CREATE INDEX IF NOT EXISTS inventory_reservations_expiry_idx ON inventory_reservations (status, expires_at);

-- ---------------------------------------------------------------------------
-- order_financials — Admin → Sales costs/refunds ledger (migration 0032).
-- luxedge_orders stays read-only there; only this table is written.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_financials (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_cost NUMERIC NOT NULL DEFAULT 0,
  shipping_cost NUMERIC NOT NULL DEFAULT 0,
  payment_fee NUMERIC NOT NULL DEFAULT 0,
  other_expense NUMERIC NOT NULL DEFAULT 0,
  refund_amount NUMERIC,
  ops_status TEXT,
  supplier TEXT,
  supplier_order_number TEXT,
  tracking_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS order_financials_order_id_key ON order_financials (order_id);

-- ---------------------------------------------------------------------------
-- processed_webhook_events — Stripe event-id idempotency gate. The table exists
-- live (and is empty, because nothing used it); the D1 webhook path records
-- every event id BEFORE processing so a replayed delivery is a no-op even if
-- the order-level guard would not catch it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- IMPORT PROVENANCE — the commerce side of the ledger 0001 created, so a
-- partially seeded table is never mistaken for a legitimately empty one.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO luxedge_data_provenance
  (table_name, source, source_captured_at, source_row_count, imported_row_count, imported_at, notes)
VALUES
  ('luxedge_orders', 'supabase:eidujmfbcfrjjleitaqp', '2026-09-29', 9, 9, CURRENT_TIMESTAMP,
   'Live order history carried over so Stripe/ERP ledgers keep referring to the same rows.'),
  ('inventory_reservations', 'supabase:eidujmfbcfrjjleitaqp', '2026-09-29', 2, 2, CURRENT_TIMESTAMP,
   'Open/closed reservation ledger; imported so a replay can never double-restore stock.'),
  ('order_financials', 'supabase:eidujmfbcfrjjleitaqp', '2026-09-29', 0, 0, CURRENT_TIMESTAMP,
   'Empty at capture; schema only.'),
  ('processed_webhook_events', 'supabase:eidujmfbcfrjjleitaqp', '2026-09-29', 0, 0, CURRENT_TIMESTAMP,
   'Empty at capture; the D1 webhook path now writes it.');
