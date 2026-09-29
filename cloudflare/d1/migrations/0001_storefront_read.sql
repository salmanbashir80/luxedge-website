-- ============================================================================
-- LUXEDGE — CLOUDFLARE D1 MIGRATION 0001 — PUBLIC STOREFRONT READ SURFACE
--
-- GENERATED FILE — do not hand-edit. Regenerate with:
--   node scripts/supabase-export.mjs schema
--   node scripts/d1-generate-schema.mjs
-- The generator reads the AUTHORITATIVE LIVE Postgres schema (673 columns / 53
-- tables, captured 2026-09-29) instead of supabase/migrations/*.sql, which are
-- known to lag the live schema. A hand-written column list silently omits
-- live-only columns and every SELECT naming one fails the whole query — the
-- same silent-empty-storefront failure mode AGENTS.md documents for PostgREST.
--
-- WHY THIS EXISTS: production Supabase is hard-restricted (HTTP 402
-- exceed_egress_quota), which emptied /shop and forced the emergency static
-- sitemap. This schema is the $0 Cloudflare-native replacement for the tables
-- the public storefront, the SSR worker and the sitemap actually read.
--
-- SCOPE: only the public/SSR read surface. Admin-only, Hermes/AI research,
-- agent and legacy tables are deliberately NOT here — they are not read by the
-- storefront, and PHASE 1 forbids migrating unused tables just because they
-- exist. The full 53-table logical backup lives outside the repo.
--
-- POSTGRES -> D1 TYPE ADAPTATION:
--   uuid/text/varchar/citext      -> TEXT   (ids and slugs preserved verbatim)
--   boolean                       -> INTEGER 0/1 (coerced to real booleans on read)
--   integer/bigint/smallint       -> INTEGER
--   numeric/decimal               -> NUMERIC (money never loses precision)
--   jsonb/json/text[]             -> TEXT   (tolerant read; see table-schema.ts)
--   timestamptz/date/time         -> TEXT   (ISO-8601 preserved verbatim)
-- Postgres-only DEFAULT expressions (gen_random_uuid(), nextval(), auth.uid())
-- are dropped: D1 has no equivalent and the application supplies those values.
--
-- D1 FREE-TIER LIMITS RESPECTED (verified 2026-09-29 from
-- developers.cloudflare.com/d1/platform/limits): 100 columns/table (products
-- uses 75), 2 MB max row/string, 500 MB max database, 5 GB per account.
-- ============================================================================

-- Generated from: live Postgres schema eidujmfbcfrjjleitaqp @ 2026-09-29
-- Tables (10): products, categories, product_images, product_variants, coupons, store_settings, store_offers, blog_posts, blog_revisions, media_videos

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

-- products — 75 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  category_id TEXT,
  short_description TEXT NOT NULL,
  image_url TEXT,
  compare_at_amount INTEGER,
  is_featured INTEGER NOT NULL DEFAULT 0,
  weight_oz NUMERIC,
  seo_title TEXT,
  seo_description TEXT,
  tax_code TEXT NOT NULL,
  name TEXT,
  premium_title TEXT,
  long_description TEXT,
  features TEXT NOT NULL,
  benefits TEXT NOT NULL,
  specifications TEXT NOT NULL,
  brand TEXT,
  agent_score NUMERIC,
  score_explanation TEXT,
  price NUMERIC,
  compare_at_price NUMERIC,
  cost_price NUMERIC,
  landed_cost NUMERIC,
  gross_margin NUMERIC,
  sku TEXT,
  inventory_qty INTEGER NOT NULL DEFAULT 0,
  shipping_cost NUMERIC,
  est_us_delivery_days INTEGER,
  seo_keywords TEXT NOT NULL,
  structured_data TEXT,
  product_source_evidence TEXT,
  published_at TEXT,
  short_title TEXT,
  subtitle TEXT,
  tags TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  new_arrival INTEGER NOT NULL DEFAULT 0,
  trending INTEGER NOT NULL DEFAULT 0,
  best_rated INTEGER NOT NULL DEFAULT 0,
  best_seller INTEGER NOT NULL DEFAULT 0,
  promoted INTEGER NOT NULL DEFAULT 0,
  sale_enabled INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT,
  discount_value NUMERIC,
  stock_status TEXT,
  low_stock_threshold INTEGER NOT NULL DEFAULT 0,
  free_shipping INTEGER NOT NULL DEFAULT 0,
  delivery_min_days INTEGER,
  delivery_max_days INTEGER,
  shipping_note TEXT,
  us_inventory INTEGER NOT NULL DEFAULT 0,
  supplier_source TEXT,
  supplier_product_ref TEXT,
  canonical_slug TEXT,
  og_image TEXT,
  owner_notes TEXT,
  evidence_notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  commerce_readiness TEXT,
  source_type TEXT,
  inventory_source TEXT,
  fulfillment_method TEXT,
  supplier_url TEXT,
  supplier_stock_status TEXT,
  risk_flags TEXT NOT NULL,
  safety_class TEXT,
  safety_review_status TEXT,
  intended_species TEXT
);

-- categories — 10 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  parent_id TEXT
);

-- product_images — 11 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  url TEXT,
  kind TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  variant_id TEXT
);

-- product_variants — 16 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  price_amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  option_values TEXT NOT NULL,
  compare_at_amount INTEGER,
  attributes TEXT NOT NULL,
  price NUMERIC,
  compare_at_price NUMERIC,
  cost_price NUMERIC,
  inventory_qty INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 0
);

-- coupons — 15 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL,
  discount_value NUMERIC NOT NULL DEFAULT 0,
  min_cart_value NUMERIC NOT NULL DEFAULT 0,
  eligible_product_ids TEXT NOT NULL,
  eligible_category_ids TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- store_settings — 3 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- store_offers — 11 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS store_offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  offer_type TEXT NOT NULL,
  value NUMERIC,
  product_ids TEXT NOT NULL,
  category_ids TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  start_at TEXT,
  end_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- blog_posts — 28 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  hero_image_url TEXT,
  hero_image_alt TEXT,
  tags TEXT NOT NULL,
  author_name TEXT,
  author_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_at TEXT,
  published_at TEXT,
  seo_title TEXT,
  meta_description TEXT,
  target_keyword TEXT,
  secondary_keywords TEXT NOT NULL,
  search_intent TEXT,
  faq TEXT NOT NULL,
  internal_links TEXT NOT NULL,
  quality_score INTEGER,
  source_notes TEXT,
  generated_by TEXT,
  automation_run_id TEXT,
  automation_locked INTEGER NOT NULL DEFAULT 0,
  date_label TEXT
);

-- blog_revisions — 9 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS blog_revisions (
  id TEXT PRIMARY KEY,
  blog_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  previous TEXT,
  next TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- media_videos — 26 columns, generated from the live Postgres schema.
CREATE TABLE IF NOT EXISTS media_videos (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  youtube_video_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  seo_title TEXT,
  meta_description TEXT,
  thumbnail_url TEXT,
  custom_thumbnail_url TEXT,
  category TEXT NOT NULL,
  is_short INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  duration TEXT,
  transcript TEXT,
  chapters TEXT NOT NULL,
  tags TEXT NOT NULL,
  related_product_ids TEXT NOT NULL,
  related_article_slugs TEXT NOT NULL,
  related_video_slugs TEXT NOT NULL,
  faq TEXT NOT NULL,
  source_notes TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- INDEXES — sized for the real query patterns so rows-read stays inside the
-- 5M/day Free allowance (D1 meters rows read, not queries).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_products_status_slug ON products (status, slug);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_categories_active_sort ON categories (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published ON blog_posts (status, published_at);
CREATE INDEX IF NOT EXISTS idx_media_videos_status ON media_videos (status, published_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_videos_slug ON media_videos (slug);

-- ---------------------------------------------------------------------------
-- IMPORT PROVENANCE — which tables are seeded in this environment and from
-- which trustworthy source. Lets the read layer report honestly instead of
-- presenting an unseeded table as a legitimately empty one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS luxedge_data_provenance (
  table_name TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_captured_at TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  imported_row_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL,
  notes TEXT
);
