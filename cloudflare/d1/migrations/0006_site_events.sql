-- 0006 — First-party traffic analytics on D1 (site_events).
--
-- Why: the Admin "Traffic Overview" reads `site_events`, which lives ONLY in
-- Supabase (migration 0023). Supabase answers 402 exceed_egress_quota on every
-- surface, and the D1 admin sign-in does not carry the legacy Supabase JWT the
-- old dashboard relied on — so the dashboard has been showing
-- "Traffic data unavailable / Sign in as admin" even for a signed-in admin.
-- This migration gives D1 the same table (SQLite shape, no RLS needed: the
-- worker API is the only reader, and it enforces the admin gate server-side;
-- public requests can only INSERT, never SELECT).
--
-- Shape mirrors supabase/migrations/0023_site_events.sql + 0024 revenue
-- columns, with TEXT ids/timestamps per the D1 conventions in 0001.
-- Idempotent.

CREATE TABLE IF NOT EXISTS site_events (
  id            TEXT PRIMARY KEY,
  event         TEXT NOT NULL,
  path          TEXT NOT NULL DEFAULT '/',
  referrer      TEXT,
  visitor_id    TEXT,
  session_id    TEXT,
  device        TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  item_ids      TEXT,
  value         NUMERIC,
  currency      TEXT,
  occurred_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_events_occurred ON site_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_event ON site_events (event);
