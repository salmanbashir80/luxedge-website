-- =============================================================
-- 0033 — On-site checkout columns on luxedge_orders
--
-- WHY: api/checkout-onsite.ts persists the shipping method the customer
-- selected and the carrier/service/rate that Shippo quoted, then PATCHes
-- `paid_at` when the PaymentIntent succeeds. Verified against the LIVE schema
-- (2026-09-29, 673 columns / 53 tables): NONE of these five columns exist on
-- `luxedge_orders` — `shipping_carrier`/`shipping_service` exist only on the
-- unused `orders` table. So the on-site write fails on the current production
-- schema for a second reason on top of the HTTP 402 egress restriction:
-- PostgREST rejects a body containing an unknown column.
--
-- This migration is ADDITIVE and IDEMPOTENT. It adds NULLable columns with no
-- default, so no existing row is rewritten and no data is invented: the values
-- the app writes are the fulfilment facts it actually collected
-- (`shipping_method` is 'free' | 'flat' | 'shippo'; carrier/service are NULL
-- for any order that did not come from a live Shippo rate).
--
-- NOTE ON THE MIGRATIONS-AS-TRUTH CONTRACT: src/services/__tests__/
-- select-schema.test.ts treats supabase/migrations/*.sql as the source of truth
-- for column existence. This file declares columns that do not exist live yet,
-- so it must be applied before the Supabase path could serve checkout again —
-- and cloudflare/d1/migrations/0002_commerce.sql carries the identical DDL for
-- the D1 backend, which is where order persistence now lives.
-- =============================================================

alter table public.luxedge_orders
  add column if not exists shipping_method text,
  add column if not exists shipping_carrier text,
  add column if not exists shipping_service text,
  add column if not exists shipping_rate_id text,
  add column if not exists paid_at timestamptz,
  -- The checkout also persists the customer's phone for delivery; the live
  -- table has no such column (only the unused `orders.phone` does), so the
  -- insert was rejected outright — losing the order, not just the phone.
  add column if not exists customer_phone text;
