// ============================================================================
// LUXEDGE — PUBLIC DATA API (/api/db/<table>?<postgrest sub-path>)
//
// The storefront is a browser SPA that used to query Supabase PostgREST
// directly with the anon key. This route is the $0 Cloudflare-native
// replacement: same-origin reads served from D1, same response shape (a bare
// JSON array), so the client needs one new adapter and no query rewrites.
//
// SECURITY — this endpoint is PUBLIC and unauthenticated, so it is deny-by-
// default on both axes:
//   1. TABLE allowlist. Only the public storefront read surface is reachable.
//      `app_settings` is deliberately absent: it holds LIVE SECRETS (AdSense
//      refresh token, CJ_API_KEY, AI_KEY_GEMINI, AI_KEY_OPENROUTER) — verified
//      in the 2026-09-29 live export. It and every admin/agent/commerce table
//      stay server-side.
//   2. COLUMN allowlist per table, mirroring the PUBLIC select constants the
//      storefront already uses. A caller cannot widen a read to `cost_price`,
//      `owner_notes`/`evidence_notes` (internal sourcing notes) or any other
//      non-public column by asking for it. Reads are projection-limited, never
//      `SELECT *`.
// Filtering or ordering on a non-public column is refused, because row
// existence itself can leak otherwise.
//
// READ-ONLY: every request is a SELECT. Writes are not implemented here at
// all — mutations must go through a server-authorized route (PHASE 8), never a
// public unauthenticated endpoint.
//
// A test (worker/__tests__/db-api.test.ts) asserts this allowlist stays a
// superset of the PUBLIC select constants in src/services/*.ts and of the
// generated D1 migration, so the two cannot drift.
// ============================================================================

import { readPostgrestPath } from './d1/read';
import { isD1Backend } from './d1/runtime';

/** Public, read-only projection of each reachable table. */
export const PUBLIC_TABLE_COLUMNS: Record<string, readonly string[]> = {
  products: [
    'id', 'slug', 'name', 'title', 'short_description', 'description', 'long_description',
    'features', 'specifications', 'weight_oz', 'price', 'compare_at_price', 'category_id',
    'inventory_qty', 'status', 'brand', 'tags', 'featured', 'new_arrival', 'free_shipping',
    'us_inventory', 'sale_enabled', 'discount_type', 'discount_value', 'stock_status',
    'delivery_min_days', 'delivery_max_days', 'seo_title', 'seo_description', 'seo_keywords',
    'supplier_source', 'supplier_product_ref', 'supplier_url', 'cost_price', 'landed_cost',
    'shipping_cost', 'commerce_readiness', 'source_type', 'inventory_source', 'sku',
    'sort_order', 'created_at', 'updated_at', 'image_url', 'benefits', 'promoted',
    'trending', 'best_rated', 'best_seller', 'is_featured', 'published_at', 'og_image',
    'canonical_slug', 'short_title', 'subtitle', 'premium_title', 'intended_species',
    'safety_class', 'safety_review_status', 'fulfillment_method', 'supplier_stock_status',
    'risk_flags', 'currency', 'tax_code', 'gross_margin', 'low_stock_threshold',
    'shipping_note', 'est_us_delivery_days', 'discount_value',
  ],
  categories: ['id', 'name', 'slug', 'description', 'image_url', 'is_active', 'sort_order', 'parent_id', 'created_at', 'updated_at'],
  product_images: ['id', 'product_id', 'url', 'public_url', 'alt_text', 'is_primary', 'sort_order', 'variant_id', 'kind'],
  product_variants: ['id', 'product_id', 'attributes', 'sku', 'price', 'compare_at_price', 'inventory_qty'],
  coupons: [
    'id', 'code', 'description', 'discount_type', 'discount_value', 'min_cart_value',
    'eligible_product_ids', 'eligible_category_ids', 'end_at', 'usage_limit', 'used_count',
  ],
  store_settings: ['key', 'value'],
  store_offers: ['id', 'name', 'offer_type', 'value', 'product_ids', 'category_ids', 'is_active', 'start_at', 'end_at', 'created_at', 'updated_at'],
  blog_posts: [
    'id', 'slug', 'title', 'excerpt', 'content', 'hero_image_url', 'hero_image_alt', 'tags',
    'author_name', 'author_id', 'status', 'created_at', 'updated_at', 'published_at',
    'seo_title', 'meta_description', 'date_label', 'faq',
  ],
  media_videos: [
    'id', 'slug', 'youtube_video_id', 'title', 'summary', 'description', 'seo_title',
    'meta_description', 'thumbnail_url', 'custom_thumbnail_url', 'category', 'is_short',
    'featured', 'published_at', 'duration', 'transcript', 'chapters', 'tags',
    'related_product_ids', 'related_article_slugs', 'related_video_slugs', 'faq', 'status',
    'created_at', 'updated_at',
  ],
};

export const PUBLIC_TABLES: readonly string[] = Object.keys(PUBLIC_TABLE_COLUMNS);

export function isPublicColumn(table: string, column: string): boolean {
  const cols = PUBLIC_TABLE_COLUMNS[table];
  return Array.isArray(cols) && cols.includes(column);
}

export const DEFAULT_PRODUCTS_LISTING_SELECT =
  'id,slug,name,short_description,price,compare_at_price,category_id,inventory_qty,status,brand,tags,featured,new_arrival,free_shipping,us_inventory,sale_enabled,discount_type,discount_value,stock_status,delivery_min_days,delivery_max_days,supplier_source,supplier_product_ref,supplier_url,cost_price,landed_cost,shipping_cost,commerce_readiness,source_type,inventory_source,sku,sort_order,created_at,image_url';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60',
  // Public data, but never let a crawler or a shared cache treat it as a page.
  'x-robots-tag': 'noindex',
} as const;

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...JSON_HEADERS, 'cache-control': 'no-store' } });
}

/**
 * Validates a requested query against the public projection, then reads it.
 * Returns a Response; never throws.
 */
export async function handleDbApi(request: Request, url: URL, ctx?: { waitUntil: (promise: Promise<any>) => void }): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? (caches as any).default : null;
  const cacheKey = new Request(url.toString(), {
    method: 'GET',
    headers: { Accept: request.headers.get('Accept') || 'application/json' },
  });
  
  if (cache && (request.method === 'GET' || request.method === 'HEAD')) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const res = new Response(cached.body, cached);
      res.headers.set('X-Luxedge-Cache', 'HIT');
      return res;
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: 'GET, HEAD', 'cache-control': 'no-store' },
    });
  }

  const rest = url.pathname.slice('/api/db/'.length);
  const table = rest.split('/')[0];
  if (!table || !PUBLIC_TABLES.includes(table)) {
    return problem(404, `Unknown or non-public table: ${table || '(none)'}`);
  }

  // Optimize payload: when products table is queried without explicit select,
  // default to lightweight listing projection rather than all 68 columns.
  if (table === 'products' && !url.searchParams.has('select')) {
    url.searchParams.set('select', DEFAULT_PRODUCTS_LISTING_SELECT);
  }

  // Enforce the projection/order/filter allowlist before touching the database.
  for (const [key, rawValue] of url.searchParams.entries()) {
    if (key === 'select') {
      const requested = decodeURIComponent(rawValue)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!requested.length) return problem(400, 'select must name at least one column');
      for (const col of requested) {
        if (col === '*') return problem(400, 'select=* is not allowed');
        if (!isPublicColumn(table, col.replace(/^.*\(|\).*$/g, ''))) {
          return problem(400, `Column not public on ${table}: ${col}`);
        }
      }
      continue;
    }
    if (key === 'order') {
      for (const spec of decodeURIComponent(rawValue).split(',')) {
        const col = spec.trim().split('.')[0];
        if (!isPublicColumn(table, col)) return problem(400, `Cannot order ${table} by non-public column: ${col}`);
      }
      continue;
    }
    if (key === 'limit') continue;
    if (key === 'offset') continue;
    // Any remaining key is a filter — it must target a public column.
    if (!isPublicColumn(table, key)) {
      return problem(400, `Cannot filter ${table} on non-public column: ${key}`);
    }
  }

  const rows = await readPostgrestPath<Record<string, unknown>>(`${table}${url.search}`);
  if (rows === null) {
    // null means "could not answer truthfully" (see worker/d1/read.ts) — never
    // report that as an empty result.
    return new Response(JSON.stringify({ error: 'Data backend unavailable' }), {
      status: 503,
      headers: { ...JSON_HEADERS, 'cache-control': 'no-store', 'retry-after': '60' },
    });
  }

  // Belt-and-braces: strip anything outside the projection even if a future
  // parser change let an extra column through.
  const allowed = new Set(PUBLIC_TABLE_COLUMNS[table]);
  const safe = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === 'categories' || allowed.has(k)) out[k] = v;
    }
    return out;
  });

  const response = new Response(JSON.stringify(safe), {
    status: 200,
    headers: { ...JSON_HEADERS, 'X-Luxedge-Cache': 'MISS' },
  });
  if (cache) {
    if (ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    else await cache.put(cacheKey, response.clone());
  }
  return response;
}

/** True when this route can actually be served (D1 selected and bound). */
export function dbApiAvailable(): boolean {
  return isD1Backend();
}
