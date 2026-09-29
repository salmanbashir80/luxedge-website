// ============================================================================
// LUXEDGE — D1 COLUMN-TYPE REGISTRY (single source of truth)
//
// WHY THIS EXISTS: Postgres/PostgREST returned real JS booleans and real jsonb
// arrays/objects. SQLite returns INTEGER 0/1 and TEXT. Without coercion:
//   * `Number(b.is_primary === true)` is 0 for every row (image ordering breaks)
//   * `features.map(...)` throws on a plain string
// Consumers must never see the difference, so each column's shape is declared
// here once and applied by the D1 read layer.
//
// MODES
//   bool — stored 0/1, read back as real booleans
//   json — stored as TEXT; read back by a TOLERANT parse (array/object when the
//          text is JSON, otherwise the raw string). Never throws.
//
// The tolerance on `json` is a HARD requirement, not politeness. AGENTS.md
// documents that live `products.tags/features/benefits/specifications` are
// heterogeneous: jsonb arrays, JSON strings, and plain comma-separated text all
// coexist in the same column. A strict array-only path silently wipes
// string-tag rows to [] on admin edit — a regression that was fixed once and
// must never return.
//
// The importer (scripts/d1-import.mjs) converts values type-driven (JS boolean
// -> 1/0, array/object -> JSON.stringify), which is equivalent and needs no
// registry, so this file is only consumed by the read layer.
// ============================================================================

export type ColumnMode = 'bool' | 'json';

export interface TableSchema {
  bool: readonly string[];
  json: readonly string[];
  /** Columns deliberately read back raw, with the reason recorded. */
  raw?: Record<string, string>;
}

export const TABLE_SCHEMA: Record<string, TableSchema> = {
  products: {
    bool: [
      'is_featured', 'featured', 'new_arrival', 'trending', 'best_rated',
      'best_seller', 'promoted', 'sale_enabled', 'free_shipping', 'us_inventory',
    ],
    json: [
      'features', 'benefits', 'specifications', 'seo_keywords',
      'structured_data', 'product_source_evidence', 'risk_flags',
    ],
    raw: {
      tags:
        'Kept as raw stored TEXT. src/features/catalog/tags.ts parseTagList() is the ONE tolerant tags parser (jsonb array, JSON string, or comma/;/| text) used by the storefront mapper, the admin repository and CSV import. Pre-parsing here would create a second divergent tag path — the exact regression AGENTS.md forbids. Non-empty raw values are therefore returned verbatim so the existing parser stays authoritative.',
    },
  },
  categories: { bool: ['is_active'], json: [] },
  product_images: { bool: ['is_primary'], json: [] },
  product_variants: { bool: [], json: ['attributes'] },
  coupons: { bool: [], json: ['eligible_product_ids', 'eligible_category_ids'] },
  store_settings: { bool: [], json: [] },
  store_offers: {
    // Live columns are product_ids/category_ids (verified 2026-09-29). Getting
    // these names wrong would leave jsonb arrays as raw strings, and strArr()
    // in the admin repository is array-only by design — so offers would silently
    // lose their product scope.
    bool: ['is_active'],
    json: ['product_ids', 'category_ids'],
  },
  blog_posts: {
    bool: ['automation_locked'],
    json: ['tags', 'secondary_keywords', 'faq', 'internal_links'],
  },
  blog_revisions: { bool: [], json: [] },
  media_videos: {
    bool: ['is_short', 'featured'],
    json: [
      'tags', 'chapters', 'faq', 'related_product_ids',
      'related_article_slugs', 'related_video_slugs',
    ],
  },
};

/** Tables the D1 read layer is allowed to touch. Anything else is refused. */
export const D1_READABLE_TABLES: readonly string[] = Object.keys(TABLE_SCHEMA);

export function isReadableTable(table: string): boolean {
  return D1_READABLE_TABLES.includes(table);
}
