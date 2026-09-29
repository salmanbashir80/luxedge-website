// ============================================================================
// LUXEDGE V2 — STOREFRONT CATALOG SERVICE (Phase 3B)
//
// Loads the storefront catalog from Supabase when it is configured AND
// reachable. Returns an EMPTY REAL CATALOG ({ products: [], categories, … })
// when the database is reachable but has zero published products — a valid
// empty DB result is NOT an error and must never trigger demo/fallback data.
// Returns null ONLY for genuine failures (not configured, unreachable, schema
// not provisioned) — and even then the caller must NOT fall back to demo
// products (Phase 4E.1/4E.2: the storefront starts empty and stays empty
// until genuinely approved products exist).
//
// DATA SOURCES (supabase/migrations/0004_reconcile_live.sql)
//   categories     — active storefront categories
//   products       — published products (status = 'published')
//   product_images — product image urls (optional; tolerated on failure)
//
// PERMANENT STOREFRONT RULE (Phase 4E.1 §10): a product must NOT become
// customer-visible merely because it exists in `products` or is
// PRODUCT_SHORTLISTED. Only `status = 'published'` rows ever render here, and
// the future publish path additionally requires BUSINESS_QUALIFIED + QA PASS +
// OWNER APPROVAL + listing factual QA PASS + creative/image quality gate PASS
// + explicit publish authorization. AUTO PUBLISH = OFF for now — the engine
// only ever creates drafts.
//
// SECURITY
//   Uses the public anon key only (via the db adapter). The service-role key
//   never reaches this module or the browser bundle. RLS further restricts
//   reads to published products for the anon role.
// ============================================================================

import { getDb, isRemoteDb } from './db';
import { deriveCommerceReadiness, deriveInventorySource, deriveSourceType, type CommerceReadiness } from '../features/catalog/commerceReadiness';
import { parseTagList } from '../features/catalog/tags';
import { isHeldProduct } from '../content/reviewHolds';
import { isPubliclyListableProduct } from '../content/productEligibility';

export interface CatalogProduct {
  id: string;
  name: string;
  slug?: string;
  shortDesc: string;
  description: string;
  price: number;
  originalPrice: number;
  category: string;
  categoryId?: string;
  stock: number;
  images: string[];
  imageAlts: string[];
  isActive: boolean;
  brand: string;
  tags: string[];
  featured: boolean;
  newArrival: boolean;
  saleEnabled: boolean;
  discountType?: string;
  discountValue?: number;
  freeShipping: boolean;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  stockStatus: string;
  usInventory: boolean;
  /** Commerce-readiness (migration 0016 or derived from persisted evidence). */
  commerceReadiness: CommerceReadiness;
  sourceType?: string;
  inventorySource?: string;
  /** Manual admin pin (products.sort_order > 0 ranks first, ascending). */
  sortOrder?: number;
  /** Row creation time — used for newest-first home merchandising. */
  createdAt?: string;
  variants: CatalogVariant[];
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords: string[];
  /** Raw owner-editable detail columns — formatted by src/content/productFacts.ts. */
  longDescription?: string | null;
  features?: unknown;
  specifications?: unknown;
  weightOz?: number | null;
  sku?: string;
  supplierSource?: string;
  supplierProductRef?: string;
  supplierUrl?: string | null;
  status?: string;
}

export interface CatalogVariant {
  id: string;
  attributes: Record<string, string>;
  sku: string;
  price: number | null;
  compareAtPrice: number | null;
  inventoryQty: number;
  image?: string | null;
}

export interface StoreCoupon {
  id: string;
  code: string;
  description?: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minCartValue: number;
  eligibleProductIds: string[];
  eligibleCategoryIds: string[];
  endAt?: string | null;
  usageLimit: number | null;
  usedCount: number;
}

export interface StorePromotions {
  coupons: StoreCoupon[];
  freeShippingEnabled: boolean;
  freeShippingThreshold: number;
}

export interface CatalogCategory {
  id: string;
  name: string;
  slug?: string;
  isActive: boolean;
}

export interface StorefrontCatalog {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  source: 'supabase';
}

interface DbProductRow {
  id: string;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
  short_description?: string | null;
  description?: string | null;
  price?: number | null;
  price_amount?: number | null;
  compare_at_price?: number | null;
  compare_at_amount?: number | null;
  category_id?: string | null;
  inventory_qty?: number | null;
  image_url?: string | null;
  status?: string | null;
  brand?: string | null;
  tags?: unknown;
  // Catalog Launch Phase columns (0010_catalog_management.sql)
  featured?: boolean | null;
  new_arrival?: boolean | null;
  free_shipping?: boolean | null;
  us_inventory?: boolean | null;
  sale_enabled?: boolean | null;
  discount_type?: string | null;
  discount_value?: number | null;
  stock_status?: string | null;
  delivery_min_days?: number | null;
  delivery_max_days?: number | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: unknown;
  supplier_source?: string | null;
  supplier_product_ref?: string | null;
  supplier_url?: string | null;
  sort_order?: number | null;
  cost_price?: number | null;
  landed_cost?: number | null;
  shipping_cost?: number | null;
  // Migration 0016 — commerce readiness (may be absent pre-migration)
  commerce_readiness?: string | null;
  source_type?: string | null;
  inventory_source?: string | null;
  created_at?: string | null;
  // Owner-editable detail columns. Kept raw here: formatting (and the
  // "empty means nothing" rule) lives in one place, src/content/productFacts.ts,
  // which BOTH the React page and the worker pre-render read.
  long_description?: string | null;
  features?: unknown;
  specifications?: unknown;
  weight_oz?: number | null;
  [k: string]: unknown;
}

interface DbCategoryRow {
  id: string;
  name: string;
  slug?: string | null;
  is_active?: boolean | null;
  [k: string]: unknown;
}

interface DbImageRow {
  product_id: string;
  url?: string | null;
  public_url?: string | null;
  alt_text?: string | null;
  is_primary?: boolean | null;
  sort_order?: number | null;
  variant_id?: string | null;
  [k: string]: unknown;
}

interface DbVariantRow {
  id: string;
  product_id: string;
  attributes?: unknown;
  sku?: string | null;
  price?: number | null;
  compare_at_price?: number | null;
  inventory_qty?: number | null;
  [k: string]: unknown;
}

interface DbCouponRow {
  id: string;
  code: string;
  description?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  min_cart_value?: number | null;
  eligible_product_ids?: unknown;
  eligible_category_ids?: unknown;
  end_at?: string | null;
  usage_limit?: number | null;
  used_count?: number | null;
  [k: string]: unknown;
}

interface DbSettingRow {
  key: string;
  value?: unknown;
  [k: string]: unknown;
}

// ============================================================================
// PUBLIC READ SELECTS (egress-scoped)
//
// Every column below MUST exist on the live table — PostgREST rejects the
// whole query with a 400 when any requested column is missing (this happened
// once: the storefront silently rendered empty). The contract is enforced by
// src/services/__tests__/select-schema.test.ts against
// supabase/migrations/*.sql as the source of truth.
// ============================================================================
export const CATEGORIES_PUBLIC_SELECT = 'id,name,slug,is_active';
export const PRODUCTS_PUBLIC_SELECT =
  'id,slug,name,short_description,description,long_description,features,specifications,weight_oz,price,compare_at_price,category_id,inventory_qty,status,brand,tags,featured,new_arrival,free_shipping,us_inventory,sale_enabled,discount_type,discount_value,stock_status,delivery_min_days,delivery_max_days,seo_title,seo_description,seo_keywords,supplier_source,supplier_product_ref,supplier_url,cost_price,landed_cost,shipping_cost,commerce_readiness,source_type,inventory_source,sku,sort_order,created_at';
export const PRODUCT_IMAGES_PUBLIC_SELECT = 'product_id,url,alt_text,is_primary,sort_order,variant_id';
export const PRODUCT_VARIANTS_PUBLIC_SELECT = 'id,product_id,attributes,sku,price,compare_at_price,inventory_qty';
export const COUPONS_PUBLIC_SELECT =
  'id,code,description,discount_type,discount_value,min_cart_value,eligible_product_ids,eligible_category_ids,end_at,usage_limit,used_count';
export const STORE_SETTINGS_PUBLIC_SELECT = 'key,value';

const PUBLIC_CACHE_TTL_MS = 5 * 60 * 1000;

function readPublicCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; data?: T };
    if (!parsed.ts || Date.now() - parsed.ts > PUBLIC_CACHE_TTL_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function writePublicCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* storage unavailable - live request already succeeded */
  }
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a legacy cents-amount column to dollars (legacy schema used integer cents). */
function centsToDollars(cents: unknown): number {
  return Math.round(num(cents)) / 100;
}

/**
 * Load the storefront catalog from Supabase.
 * Returns an EMPTY REAL CATALOG when the DB is reachable but has zero
 * published products (intentional empty catalog — never demo fallback).
 * Returns null only when: not configured, unreachable, schema not
 * provisioned, or the DB query itself failed.
 */
/**
 * Map one product row to a storefront CatalogProduct. Shared by the full
 * catalog load and the single-product resolver below so both produce
 * byte-identical shapes.
 */
function mapProductRow(
  p: DbProductRow,
  categories: CatalogCategory[],
  imagesByProduct: Map<string, { url: string; alt: string; isPrimary: boolean; variantId?: string | null }[]>,
  variantsByProduct: Map<string, DbVariantRow[]>,
): CatalogProduct | null {
  if (!p || typeof p.id !== 'string') return null;
  const catName = (id?: string | null): string => {
    if (!id) return '';
    return categories.find((c) => c.id === id)?.name || '';
  };
  const rawTagList = (row: DbProductRow): string[] => parseTagList(row.tags);
  const rawPrice = num(p.price) > 0 ? num(p.price) : centsToDollars(p.price_amount);
  const rawCompare = num(p.compare_at_price) > 0 ? num(p.compare_at_price) : centsToDollars(p.compare_at_amount);
  const imgs = imagesByProduct.get(p.id) || (p.image_url ? [{ url: String(p.image_url), alt: '', isPrimary: true }] : []);
  const images = imgs.map((i) => i.url);
  const imageAlts = imgs.map((i) => i.alt);
  const variants: CatalogVariant[] = (variantsByProduct.get(p.id) || []).map((v) => {
    const attrs = v.attributes && typeof v.attributes === 'object' && !Array.isArray(v.attributes)
      ? (Object.fromEntries(Object.entries(v.attributes as Record<string, unknown>).filter(([, val]) => typeof val === 'string')) as Record<string, string>)
      : {};
    const linked = imgs.find((i) => i.variantId === v.id);
    return {
      id: v.id,
      attributes: attrs,
      sku: v.sku || '',
      price: v.price != null ? num(v.price) : null,
      compareAtPrice: v.compare_at_price != null ? num(v.compare_at_price) : null,
      inventoryQty: num(v.inventory_qty),
      image: linked?.url || null,
    };
  });
  const saleEnabled = p.sale_enabled === true && num(p.discount_value) > 0;
  const salePrice = saleEnabled
    ? (p.discount_type === 'fixed'
        ? Math.max(0, rawPrice - num(p.discount_value))
        : Math.round(rawPrice * (1 - num(p.discount_value) / 100) * 100) / 100)
    : rawPrice;
  return {
    id: p.id,
    name: String(p.name || p.title || p.id),
    slug: p.slug || undefined,
    shortDesc: p.short_description || '',
    description: p.description || '',
    longDescription: p.long_description ?? null,
    features: p.features,
    specifications: p.specifications,
    weightOz: p.weight_oz != null ? num(p.weight_oz) : null,
    price: salePrice,
    originalPrice: rawCompare > salePrice ? rawCompare : 0,
    category: catName(p.category_id),
    categoryId: p.category_id || undefined,
    stock: Math.max(0, num(p.inventory_qty)),
    images,
    imageAlts,
    isActive: true,
    brand: p.brand || 'Luxedge',
    tags: rawTagList(p),
    featured: p.featured === true,
    newArrival: p.new_arrival === true,
    saleEnabled,
    discountType: typeof p.discount_type === 'string' ? p.discount_type : undefined,
    discountValue: num(p.discount_value) || undefined,
    freeShipping: p.free_shipping === true,
    deliveryMinDays: p.delivery_min_days != null ? num(p.delivery_min_days) : null,
    deliveryMaxDays: p.delivery_max_days != null ? num(p.delivery_max_days) : null,
    stockStatus: typeof p.stock_status === 'string' ? p.stock_status : (num(p.inventory_qty) > 0 ? 'in_stock' : 'out_of_stock'),
    usInventory: p.us_inventory === true,
    commerceReadiness: (typeof p.commerce_readiness === 'string' && p.commerce_readiness)
      ? (p.commerce_readiness as CommerceReadiness)
      : deriveCommerceReadiness({
          status: p.status || 'active',
          supplierSource: p.supplier_source,
          supplierProductRef: p.supplier_product_ref,
          costPrice: num(p.cost_price),
          landedCost: num(p.landed_cost),
          shippingCost: num(p.shipping_cost),
          freeShipping: p.free_shipping === true,
          deliveryMinDays: p.delivery_min_days != null ? num(p.delivery_min_days) : null,
          deliveryMaxDays: p.delivery_max_days != null ? num(p.delivery_max_days) : null,
          usInventory: p.us_inventory === true,
          stockStatus: typeof p.stock_status === 'string' ? p.stock_status : null,
          inventoryQty: num(p.inventory_qty),
        }),
    sourceType: (typeof p.source_type === 'string' && p.source_type as string) || deriveSourceType({ supplierSource: p.supplier_source, supplierProductRef: p.supplier_product_ref }),
    inventorySource: (typeof p.inventory_source === 'string' && p.inventory_source as string) || deriveInventorySource({ usInventory: p.us_inventory === true, stockStatus: typeof p.stock_status === 'string' ? p.stock_status : null }),
    variants,
    seoTitle: p.seo_title || undefined,
    seoDescription: p.seo_description || undefined,
    seoKeywords: parseTagList(p.seo_keywords),
    sku: typeof p.sku === 'string' ? p.sku : undefined,
    supplierSource: typeof p.supplier_source === 'string' ? p.supplier_source : undefined,
    supplierProductRef: typeof p.supplier_product_ref === 'string' ? p.supplier_product_ref : undefined,
    supplierUrl: typeof p.supplier_url === 'string' ? p.supplier_url : null,
    status: typeof p.status === 'string' ? p.status : undefined,
    sortOrder: num(p.sort_order),
    createdAt: typeof p.created_at === 'string' ? p.created_at : undefined,
  };
}

/**
 * Resolve a single active/published product by id or slug with the SAME
 * semantics as the SSR/SEO layer (worker/seo-meta.ts serves any active
 * product — the commerce-readiness gate only controls catalog listing).
 *
 * Deep links and the admin product-editor "Preview" button navigate
 * client-side to /product/:slug; without this resolver the SPA rendered
 * "Product Not Found" for products that exist and are live, while the same
 * URL served fine via SSR. Failures return null (page shows the not-found
 * state) — never demo data.
 */
export async function loadProductByIdOrSlug(key: string): Promise<CatalogProduct | null> {
  if (!isRemoteDb() || !key) return null;
  const db = getDb();
  try {
    // Two separate lookups instead of an `or=(id.eq.X,slug.eq.X)` filter:
    // PostgREST casts every operand to the column type, so a slug value 400s
    // against the uuid `id` column before slug.eq is ever evaluated.
    let row: DbProductRow | null = null;
    const bySlug = await db.list<DbProductRow>('products', {
      select: PRODUCTS_PUBLIC_SELECT,
      rawFilters: { slug: `eq.${key}`, status: 'in.(active,published)' },
      limit: 1,
    });
    if (bySlug?.[0]) {
      row = bySlug[0];
    } else {
      const byId = await db.list<DbProductRow>('products', {
        select: PRODUCTS_PUBLIC_SELECT,
        rawFilters: { id: `eq.${key}`, status: 'in.(active,published)' },
        limit: 1,
      }).catch(() => null); // non-uuid keys 400 here — swallow
      row = byId?.[0] || null;
    }
    if (!row || typeof row.id !== 'string') return null;

    const [catRows, imgRows, varRows] = await Promise.all([
      db.list<DbCategoryRow>('categories', { select: CATEGORIES_PUBLIC_SELECT, orderBy: 'sort_order' }),
      db.list<DbImageRow>('product_images', {
        select: PRODUCT_IMAGES_PUBLIC_SELECT,
        rawFilters: { product_id: `eq.${row.id}`, url: 'not.like.data:*' },
        limit: 100,
      }).catch(() => [] as DbImageRow[]),
      db.list<DbVariantRow>('product_variants', { select: PRODUCT_VARIANTS_PUBLIC_SELECT, filters: { product_id: row.id }, limit: 200 }).catch(() => [] as DbVariantRow[]),
    ]);

    const categories: CatalogCategory[] = Array.isArray(catRows)
      ? (catRows as DbCategoryRow[])
          .filter((c) => c && typeof c.id === 'string')
          .map((c) => ({ id: c.id, name: String(c.name || c.id), slug: c.slug || undefined, isActive: c.is_active !== false }))
      : [];
    const imagesByProduct = new Map<string, { url: string; alt: string; isPrimary: boolean; variantId?: string | null }[]>();
    if (Array.isArray(imgRows)) {
      const list: { url: string; alt: string; isPrimary: boolean; variantId?: string | null }[] = [];
      for (const img of imgRows as DbImageRow[]) {
        const url = img.url || img.public_url;
        if (!img || !url) continue;
        list.push({ url: String(url), alt: img.alt_text || '', isPrimary: !!img.is_primary, variantId: img.variant_id || null });
      }
      list.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
      imagesByProduct.set(row.id, list);
    }
    const variantsByProduct = new Map<string, DbVariantRow[]>();
    if (Array.isArray(varRows)) variantsByProduct.set(row.id, varRows as DbVariantRow[]);

    const product = mapProductRow(row, categories, imagesByProduct, variantsByProduct);
    return product && !isHeldProduct(product.slug) && isPubliclyListableProduct(product) ? product : null;
  } catch {
    return null;
  }
}

export async function loadStorefrontCatalog(): Promise<StorefrontCatalog | null> {
  if (!isRemoteDb()) return null;
  const cached = readPublicCache<StorefrontCatalog>('luxedge:storefront-catalog:v1');
  if (cached) return { ...cached, products: cached.products.filter((p) => !isHeldProduct(p.slug) && isPubliclyListableProduct(p)) };
  const db = getDb();

  try {
    const [catRows, prodRows] = await Promise.all([
      db.list<DbCategoryRow>('categories', { select: CATEGORIES_PUBLIC_SELECT, orderBy: 'sort_order' }),
      db.list<DbProductRow>('products', { select: PRODUCTS_PUBLIC_SELECT, orderBy: 'created_at' }),
    ]);

    if (!Array.isArray(catRows) || !Array.isArray(prodRows)) return null;

    const categories: CatalogCategory[] = (catRows as DbCategoryRow[])
      .filter((c) => c && typeof c.id === 'string')
      .map((c) => ({
        id: c.id,
        name: String(c.name || c.id),
        slug: c.slug || undefined,
        isActive: c.is_active !== false,
      }));

    const published = (prodRows as DbProductRow[])
      // Storefront visibility:
      //   - status = 'active' → an admin/owner explicitly published the
      //     product; that human approval IS the business-qualification signal.
      //     (The scout auto-publish path additionally stamps COMMERCE_READY,
      //     and the admin editor/quick-status sets active on the owner's
      //     click — both are deliberate publish actions.)
      //   - status = 'published' (legacy/auto path) → still requires the
      //     commerce-readiness gate: the stored 0016 stamp when present, or
      //     derived evidence (real supplier + cost basis) otherwise, so
      //     RETAIL_REFERENCE_ONLY rows can never become visible on their own.
      .filter((p) => p && typeof p.id === 'string' && (p.status === 'active' || (p.status === 'published' && isStorefrontReady(p))));

    // Products without any price info are not ready for the storefront.
    const usable = published.filter((p) => !isHeldProduct(p.slug) && (num(p.price) > 0 || num(p.price_amount) > 0));
    // Phase 4E.2 — a reachable DB with ZERO published products is a valid
    // EMPTY REAL CATALOG, not an error. Never signal "use demo fallback".
    if (usable.length === 0) {
      return { products: [], categories, source: 'supabase' };
    }

    // Optional: attach product images (with alt/primary/sort + variant links).
    // Tolerate failures (missing table, grants, RLS) without failing the load.
    let imagesByProduct = new Map<string, { url: string; alt: string; isPrimary: boolean; variantId?: string | null }[]>();
    try {
      // Server-side filter drops the inline base64 blob rows (~9 MB in the
      // live DB) — images become ~60 KB and cold loads stop waiting on MBs.
      const imgRows = await db.list<DbImageRow>('product_images', {
        select: PRODUCT_IMAGES_PUBLIC_SELECT,
        limit: 1000,
        rawFilters: { url: 'not.like.data:*' },
      });
      if (Array.isArray(imgRows)) {
        imagesByProduct = (imgRows as DbImageRow[]).reduce((acc, img) => {
          const url = img.url || img.public_url;
          if (!img || !img.product_id || !url) return acc;
          const list = acc.get(img.product_id) || [];
          list.push({
            url: String(url),
            alt: img.alt_text || '',
            isPrimary: !!img.is_primary,
            variantId: img.variant_id || null,
          });
          acc.set(img.product_id, list);
          return acc;
        }, new Map<string, { url: string; alt: string; isPrimary: boolean; variantId?: string | null }[]>());
        // Sort each product's images: primary first, then by insertion order
        for (const [, imgs] of imagesByProduct) {
          imgs.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
        }
      }
    } catch {
      /* product images unavailable — products still render with image_url */
    }

    // Optional: attach product variants (real options only — never invented).
    let variantsByProduct = new Map<string, DbVariantRow[]>();
    try {
      const varRows = await db.list<DbVariantRow>('product_variants', { select: PRODUCT_VARIANTS_PUBLIC_SELECT, limit: 1000 });
      if (Array.isArray(varRows)) {
        variantsByProduct = (varRows as DbVariantRow[]).reduce((acc, v) => {
          if (!v || !v.product_id) return acc;
          const list = acc.get(v.product_id) || [];
          list.push(v);
          acc.set(v.product_id, list);
          return acc;
        }, new Map<string, DbVariantRow[]>());
      }
    } catch {
      /* product variants unavailable */
    }

    const products: CatalogProduct[] = usable
      .map((p) => mapProductRow(p, categories, imagesByProduct, variantsByProduct))
      .filter((x): x is CatalogProduct => x !== null && isPubliclyListableProduct(x));

    const result = { products, categories, source: 'supabase' as const };
    writePublicCache('luxedge:storefront-catalog:v1', result);
    return result;
  } catch {
    // Unreachable / schema not provisioned / permission denied → null.
    // The caller must NOT fall back to demo products — the storefront stays
    // empty (Phase 4E.1/4E.2).
    return null;
  }
}

/**
 * Commerce-readiness gate for storefront visibility.
 *
 * Resilient to the 0016 migration state:
 *   - When `commerce_readiness` exists and is non-null, it is authoritative.
 *   - Otherwise derive from persisted evidence: a real supplier source PLUS a
 *     real cost basis is required. Manufacturer retail-reference products
 *     (e.g. KONG official pages — authenticity proven, purchasing path NOT
 *     proven) have no cost basis and therefore never qualify.
 */
function isStorefrontReady(p: DbProductRow): boolean {
  const stored = p.commerce_readiness as string | null | undefined;
  if (typeof stored === 'string' && stored) {
    return stored === 'COMMERCE_READY';
  }
  const readiness = deriveCommerceReadiness({
    status: p.status || 'active',
    supplierSource: p.supplier_source,
    supplierProductRef: p.supplier_product_ref,
    costPrice: num(p.cost_price),
    landedCost: num(p.landed_cost),
    shippingCost: num(p.shipping_cost),
    freeShipping: p.free_shipping === true,
    deliveryMinDays: p.delivery_min_days != null ? num(p.delivery_min_days) : null,
    deliveryMaxDays: p.delivery_max_days != null ? num(p.delivery_max_days) : null,
    usInventory: p.us_inventory === true,
    stockStatus: typeof p.stock_status === 'string' ? p.stock_status : null,
    inventoryQty: num(p.inventory_qty),
  });
  return readiness === 'COMMERCE_READY';
}

/**
 * Load storefront promotions: ACTIVE coupons + free-shipping strategy.
 * Failures degrade to a safe default (no coupons, free shipping OFF) — the
 * storefront never shows coupons/shipping claims it cannot back.
 */
export async function loadStorefrontPromotions(): Promise<StorePromotions> {
  if (!isRemoteDb()) return { coupons: [], freeShippingEnabled: false, freeShippingThreshold: 50 };
  const promoCache = readPublicCache<StorePromotions>('luxedge:storefront-promotions:v1');
  if (promoCache) return promoCache;
  const db = getDb();
  const out: StorePromotions = { coupons: [], freeShippingEnabled: false, freeShippingThreshold: 50 };
  try {
    const [couponRows, settingRows] = await Promise.all([
      db.list<DbCouponRow>('coupons', { select: COUPONS_PUBLIC_SELECT, limit: 200 }),
      db.list<DbSettingRow>('store_settings', { select: STORE_SETTINGS_PUBLIC_SELECT, limit: 20 }).catch(() => [] as DbSettingRow[]),
    ]);
    if (Array.isArray(couponRows)) {
      out.coupons = (couponRows as DbCouponRow[])
        .filter((c) => c && typeof c.code === 'string')
        .map((c) => ({
          id: c.id,
          code: String(c.code).toUpperCase(),
          description: c.description || undefined,
          discountType: c.discount_type === 'fixed' ? 'fixed' as const : 'percent' as const,
          discountValue: num(c.discount_value),
          minCartValue: num(c.min_cart_value),
          eligibleProductIds: Array.isArray(c.eligible_product_ids) ? (c.eligible_product_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [],
          eligibleCategoryIds: Array.isArray(c.eligible_category_ids) ? (c.eligible_category_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [],
          endAt: c.end_at || null,
          usageLimit: c.usage_limit != null ? num(c.usage_limit) : null,
          usedCount: num(c.used_count),
        }));
    }
    const freeShippingRow = Array.isArray(settingRows) ? (settingRows as DbSettingRow[]).find((r) => r && r.key === 'free_shipping') : undefined;
    if (freeShippingRow && freeShippingRow.value && typeof freeShippingRow.value === 'object') {
      const v = freeShippingRow.value as { freeShippingEnabled?: unknown; freeShippingThreshold?: unknown };
      out.freeShippingEnabled = v.freeShippingEnabled === true;
      out.freeShippingThreshold = num(v.freeShippingThreshold) > 0 ? num(v.freeShippingThreshold) : 50;
    }
  } catch {
    /* promotions unavailable — safe defaults */
  }
  writePublicCache('luxedge:storefront-promotions:v1', out);
  return out;
}
