// ============================================================================
// LUXEDGE — WORKER PUBLIC-READ SELECTS (Supabase anon REST)
//
// Single source for every explicit `select` string the Cloudflare worker uses
// against Supabase. Consumed by:
//   * worker/seo-meta.ts — product/category/blog SSR meta + pre-rendered bodies
//   * worker/sitemap.ts   — the dynamic /sitemap.xml feed
//
// PostgREST rejects the WHOLE query with a 400 when any named column does not
// exist on the live table — a silent 400 here would kill prerendered product
// pages or empty the sitemap (the AdSense-relevant SEO surface) with no error
// surfacing anywhere. Column existence is enforced by
// src/services/__tests__/select-schema.test.ts against supabase/migrations/*.sql
// plus the documented live-verified out-of-band column set in that file.
// ============================================================================

/** Product SSR query (seo-meta.ts) — page facts + embedded category name for
 * the "More in {category}" contextual link.
 *
 * product_images are deliberately NOT embedded here: a handful of junk rows
 * carry inline base64 image blobs (~9 MB in the live DB) that PostgREST
 * embeds into every product row, making the products payload ~9 MB and the
 * first page load after the 15-min worker cache expiry crawl. seo-meta.ts
 * fetches images in a SEPARATE lightweight query filtered to real HTTP URLs
 * (url=not.like.data:*) and merges them back per product. */
export const SEO_PRODUCTS_SELECT =
  'id,slug,name,status,description,short_description,long_description,features,specifications,weight_oz,seo_title,seo_description,seo_keywords,price,compare_at_price,brand,image_url,stock_status,inventory_qty,us_inventory,free_shipping,shipping_cost,delivery_min_days,delivery_max_days,supplier_source,supplier_product_ref,cost_price,commerce_readiness,category_id,categories(name)';

export const SEO_CATEGORIES_SELECT = 'id,slug,name';

export const SEO_BLOG_POSTS_SELECT =
  'slug,title,excerpt,hero_image_url,published_at,created_at,author_name,content,faq';

/** Media SSR query (seo-meta.ts) — hub + video page facts. */
export const SEO_MEDIA_SELECT =
  'slug,title,summary,description,seo_title,meta_description,thumbnail_url,custom_thumbnail_url,youtube_video_id,category,is_short,featured,published_at,duration,transcript,chapters,faq,related_product_ids,related_article_slugs,related_video_slugs';

/** Sitemap product query (sitemap.ts) — the commerce-ready visibility gate
 * mirror (status + supplier/cost/fulfillment evidence). */
export const SITEMAP_PRODUCTS_SELECT =
  'id,slug,name,status,description,short_description,price,image_url,supplier_source,supplier_product_ref,cost_price,us_inventory,stock_status,inventory_qty,commerce_readiness,category_id';

// `name`/`title` are read so the HTML sitemap (/sitemap) can label each link
// with the real category or article name instead of deriving it from the slug.
// Both columns are already read by SEO_CATEGORIES_SELECT / SEO_BLOG_POSTS_SELECT.
export const SITEMAP_CATEGORIES_SELECT = 'id,slug,name';

export const SITEMAP_BLOG_POSTS_SELECT = 'slug,title';

export const SITEMAP_MEDIA_SELECT = 'slug';
