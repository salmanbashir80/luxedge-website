// ============================================================================
// LUXEDGE — D1 SCHEMA GENERATOR
//
// Emits the D1 (SQLite) migration for a chosen table set from the AUTHORITATIVE
// LIVE Postgres schema captured by scripts/supabase-export.mjs schema.
//
// WHY GENERATE INSTEAD OF HAND-WRITING: supabase/migrations/*.sql lag the live
// schema (AGENTS.md documents live-only columns), so hand-written DDL silently
// omits columns. Any SELECT naming a missing column then fails the whole query —
// in D1 that is `no such column` instead of PostgREST's 400, but the symptom is
// the same silent empty storefront/sitemap. Generating from the real schema
// makes that class of bug impossible.
//
// TYPE MAPPING (Postgres -> D1/SQLite), deliberate and documented:
//   uuid / text / varchar / citext / inet / *_enum  -> TEXT
//   boolean                                         -> INTEGER   (0/1)
//   smallint / integer / bigint / serial            -> INTEGER
//   numeric / decimal / real / double precision     -> NUMERIC
//   jsonb / json / text[] / ARRAY                   -> TEXT      (tolerant-read)
//   timestamptz / timestamp / date / time           -> TEXT      (ISO preserved)
// Postgres-only DEFAULT expressions (gen_random_uuid(), nextval(), auth.uid())
// are dropped: the application supplies ids, and D1 has no equivalents.
//
// USAGE
//   node scripts/d1-generate-schema.mjs                 # storefront-read tables
//   node scripts/d1-generate-schema.mjs --all           # every live table
//   node scripts/d1-generate-schema.mjs --tables a,b    # explicit set
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_FILE = path.join('.freebuff', 'migration', 'live-schema.json');
const OUT_FILE = path.join('cloudflare', 'd1', 'migrations', '0001_storefront_read.sql');

/** Tables the public storefront, the SSR worker and the sitemap read. */
export const STOREFRONT_READ_TABLES = [
  'products',
  'categories',
  'product_images',
  'product_variants',
  'coupons',
  'store_settings',
  'store_offers',
  'blog_posts',
  'blog_revisions',
  'media_videos',
];

/**
 * Indexes for REAL query patterns, derived from the actual call sites:
 *   sitemap/seo:  products.status in (active,published) order by slug
 *   /shop:        products order by created_at
 *   PDP:          product_images by product_id
 *   blog/media:   published rows by slug
 * Rows-read is what the D1 Free tier meters (5M/day), so these are load-bearing.
 */
const INDEXES = [
  ['products', 'idx_products_status_slug', '(status, slug)'],
  ['products', 'idx_products_created_at', '(created_at)'],
  ['products', 'idx_products_category_id', '(category_id)'],
  ['product_images', 'idx_product_images_product', '(product_id)'],
  ['product_variants', 'idx_product_variants_product', '(product_id)'],
  ['categories', 'idx_categories_active_sort', '(is_active, sort_order)'],
  ['blog_posts', 'idx_blog_posts_status_published', '(status, published_at)'],
  ['media_videos', 'idx_media_videos_status', '(status, published_at)'],
];

const UNIQUE_INDEXES = [
  ['categories', 'idx_categories_slug', '(slug)'],
  ['blog_posts', 'idx_blog_posts_slug', '(slug)'],
  ['media_videos', 'idx_media_videos_slug', '(slug)'],
];

const HEADER = `-- ============================================================================
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

`;

/** Source of the generated schema, recorded in the migration for provenance. */
const GENERATED_FROM = 'live Postgres schema eidujmfbcfrjjleitaqp @ 2026-09-29';

const str = (v) => (v === null || v === undefined ? '' : String(v));

function sqliteType(col) {
  const udt = str(col.udt_name).toLowerCase();
  const dt = str(col.data_type).toLowerCase();
  if (udt.startsWith('_') || dt.includes('array')) return 'TEXT';
  if (dt === 'boolean' || udt === 'bool') return 'INTEGER';
  if (['smallint', 'integer', 'bigint', 'int2', 'int4', 'int8'].includes(udt)) return 'INTEGER';
  if (['numeric', 'decimal', 'real', 'double precision', 'float4', 'float8', 'money'].includes(udt)) return 'NUMERIC';
  if (['jsonb', 'json'].includes(udt)) return 'TEXT';
  if (dt.startsWith('timestamp') || dt === 'date' || udt === 'date' || udt === 'timestamptz' || udt === 'timestamp') {
    return 'TEXT';
  }
  return 'TEXT';
}

/** Maps the handful of Postgres defaults that have a safe SQLite meaning. */
function sqliteDefault(col) {
  const d = str(col.column_default).trim();
  if (!d) return null;
  const lower = d.toLowerCase();
  if (lower === 'true') return '1';
  if (lower === 'false') return '0';
  if (lower.includes('now()') || lower.includes('current_timestamp')) return 'CURRENT_TIMESTAMP';
  if (lower.startsWith("'") && lower.endsWith("'")) return d.replace(/::[a-z_ ]+/g, '');
  if (/^-?\d+(\.\d+)?$/.test(lower)) return lower;
  // gen_random_uuid(), uuid_generate_v4(), nextval(...), auth.uid() etc. have no
  // D1 equivalent and the application supplies the value — omit deliberately.
  return null;
}

export function generate(tables, schemaRows) {
  const grouped = new Map();
  for (const row of schemaRows) {
    if (!grouped.has(row.table_name)) grouped.set(row.table_name, []);
    grouped.get(row.table_name).push(row);
  }

  const missing = tables.filter((t) => !grouped.has(t));
  if (missing.length) throw new Error(`tables not present in live schema: ${missing.join(', ')}`);

  const parts = [];
  for (const table of tables) {
    const cols = grouped.get(table).slice().sort((a, b) => a.ordinal_position - b.ordinal_position);
    const pkCols = cols.filter((c) => Number(c.is_pk) > 0).map((c) => c.column_name);

    const lines = [];
    for (const c of cols) {
      const bits = [`  ${c.column_name} ${sqliteType(c)}`];
      const hasDefault = sqliteDefault(c);
      if (pkCols.length === 1 && pkCols[0] === c.column_name) {
        bits.push('PRIMARY KEY');
      } else {
        if (c.is_nullable === 'NO') bits.push('NOT NULL');
        if (hasDefault) bits.push(`DEFAULT ${hasDefault}`);
      }
      lines.push(bits.join(' '));
    }
    if (pkCols.length > 1) lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);

    parts.push(
      [
        `-- ${table} — ${cols.length} columns, generated from the live Postgres schema.`,
        `CREATE TABLE IF NOT EXISTS ${table} (`,
        lines.join(',\n'),
        `);`,
      ].join('\n'),
    );
  }

  const indexLines = [];
  for (const [table, name, cols] of INDEXES) {
    if (grouped.has(table)) indexLines.push(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} ${cols};`);
  }
  for (const [table, name, cols] of UNIQUE_INDEXES) {
    if (grouped.has(table)) indexLines.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table} ${cols};`);
  }

  return { tables: parts.join('\n\n'), indexes: indexLines.join('\n') };
}

// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  if (!fs.existsSync(SCHEMA_FILE)) {
    console.error(`missing ${SCHEMA_FILE} — run: node scripts/supabase-export.mjs schema`);
    return;
  }
  const schemaRows = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));

  let tables = STOREFRONT_READ_TABLES;
  const tblIdx = argv.indexOf('--tables');
  if (argv.includes('--all')) {
    tables = [...new Set(schemaRows.map((r) => r.table_name))].sort();
  } else if (tblIdx >= 0) {
    tables = str(argv[tblIdx + 1]).split(',').map((s) => s.trim()).filter(Boolean);
  }

  const { tables: ddl, indexes } = generate(tables, schemaRows);
  console.log(`tables: ${tables.length}`);
  console.log(`indexes: ${indexes.split('\n').filter(Boolean).length}`);
  if (argv.includes('--dry-run') || argv.includes('--stdout')) {
    console.log(ddl);
    console.log(indexes);
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const body =
    `${HEADER}` +
    `-- Generated from: ${GENERATED_FROM}\n` +
    `-- Tables (${tables.length}): ${tables.join(', ')}\n\n` +
    `-- ---------------------------------------------------------------------------\n` +
    `-- TABLES\n` +
    `-- ---------------------------------------------------------------------------\n\n` +
    ddl +
    `\n\n-- ---------------------------------------------------------------------------\n` +
    `-- INDEXES — sized for the real query patterns so rows-read stays inside the\n` +
    `-- 5M/day Free allowance (D1 meters rows read, not queries).\n` +
    `-- ---------------------------------------------------------------------------\n\n` +
    indexes +
    `\n\n-- ---------------------------------------------------------------------------\n` +
    `-- IMPORT PROVENANCE — which tables are seeded in this environment and from\n` +
    `-- which trustworthy source. Lets the read layer report honestly instead of\n` +
    `-- presenting an unseeded table as a legitimately empty one.\n` +
    `-- ---------------------------------------------------------------------------\n` +
    `CREATE TABLE IF NOT EXISTS luxedge_data_provenance (\n` +
    `  table_name TEXT PRIMARY KEY,\n` +
    `  source TEXT NOT NULL,\n` +
    `  source_captured_at TEXT NOT NULL,\n` +
    `  source_row_count INTEGER NOT NULL,\n` +
    `  imported_row_count INTEGER NOT NULL,\n` +
    `  imported_at TEXT NOT NULL,\n` +
    `  notes TEXT\n` +
    `);\n`;
  fs.writeFileSync(OUT_FILE, body);
  console.log(`wrote ${tables.length} tables -> ${OUT_FILE}`);
}

if (process.argv[1]?.endsWith('d1-generate-schema.mjs')) main();
