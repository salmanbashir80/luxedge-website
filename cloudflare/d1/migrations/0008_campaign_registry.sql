-- Campaign Manager registry on D1 (Supabase app_settings PostgREST is HTTP 402).
-- Scope: ONLY the Campaign Manager documents luxedge_campaigns_v1 and
-- luxedge_campaign_products_v1. The Free Gift doc (gift_drop_campaign_v1),
-- luxedge_orders claim rows, checkout, pricing, shipping, inventory and email
-- are deliberately untouched.
-- Private: intentionally absent from both public and generic admin DB
-- allowlists; read/written only by requireAdmin-protected /api/admin/campaigns
-- (and the existing public campaign endpoints' server-side registry reads).
CREATE TABLE IF NOT EXISTS campaign_registry_docs (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Explicit seed so a MISSING row means "not initialized" (fail closed), never
-- "empty". Source verified 2026-10-05 via the read-only Supabase Management
-- API: neither key exists in live app_settings (registry genuinely empty, no
-- product flags). INSERT OR IGNORE never overwrites an existing document.
INSERT OR IGNORE INTO campaign_registry_docs (key, value, updated_at, updated_by)
VALUES
  ('luxedge_campaigns_v1', '{"campaigns":[]}', '2026-10-05T00:00:00.000Z', 'migration-0008'),
  ('luxedge_campaign_products_v1', '{}', '2026-10-05T00:00:00.000Z', 'migration-0008');

INSERT OR REPLACE INTO luxedge_data_provenance
  (table_name, source, source_captured_at, source_row_count, imported_row_count, imported_at, notes)
VALUES
  ('campaign_registry_docs', 'supabase:eidujmfbcfrjjleitaqp app_settings', '2026-10-05', 0, 2, CURRENT_TIMESTAMP,
   'luxedge_campaigns_v1 and luxedge_campaign_products_v1 verified absent live (read-only Management API); seeded as explicit empty docs. gift_drop_campaign_v1 NOT migrated.');
