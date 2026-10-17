// ============================================================================
// LUXEDGE V2 — CATALOG DOMAIN TYPES (Catalog Launch Phase)
//
// The full editable product model backing the admin Product Manager and the
// storefront. Persisted via src/features/catalog/repository.ts on top of the
// existing db adapter (Supabase products / product_images / product_variants
// + the 0010_catalog_management columns and coupon/offer/settings tables).
//
// TRUTH RULES (Master Plan §7, §14):
//   - UNKNOWN stays UNKNOWN — no invented ratings/reviews/sales/shipping.
//   - Merchandising flags are admin-set; they never imply marketplace
//     ratings or customer demand.
// ============================================================================

export type CatalogStatus = 'draft' | 'ready' | 'active' | 'inactive' | 'archived' | 'safety_hold';
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'on_backorder' | 'unknown';
export type DiscountType = 'percent' | 'fixed';
export type ImageKind = 'product' | 'lifestyle' | 'creative' | 'video' | 'ugc';

export type CommerceReadiness =
  | 'COMMERCE_READY'
  | 'SOURCE_PENDING'
  | 'ECONOMICS_PENDING'
  | 'FULFILLMENT_PENDING'
  | 'RISK_REVIEW'
  | 'DRAFT';

export type SourceType =
  | 'CJ_DROPSHIPPING'
  | 'AUTHORIZED_WHOLESALE'
  | 'MANUFACTURER_DIRECT'
  | 'RETAIL_REFERENCE_ONLY'
  | 'OWNER_STOCK'
  | 'OTHER_VERIFIED'
  | 'UNKNOWN';

export type InventorySource = 'SUPPLIER_VERIFIED' | 'INTERNAL_STOCK' | 'UNTRACKED' | 'UNKNOWN';

export interface CatalogImage {
  id: string;
  productId: string;
  url: string;
  altText: string;
  kind: ImageKind;
  isPrimary: boolean;
  sortOrder: number;
  /** Optional variant linkage — a genuine variant→image mapping, never guessed. */
  variantId?: string | null;
}

export interface CatalogVariant {
  id: string;
  productId: string;
  /** Real option map, e.g. { color: 'Gray', size: 'Large' }. */
  attributes: Record<string, string>;
  sku: string;
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  inventoryQty: number;
  status: string;
  lowStockThreshold: number;
  /** Resolved variant image url when a genuine variant→image link exists. */
  image?: string | null;
}

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  shortTitle?: string;
  subtitle?: string;
  shortDescription: string;
  description: string;
  features: string[];
  specifications: Record<string, unknown>;
  categoryId?: string | null;
  categoryName?: string;
  brand: string;
  /** Catalog lifecycle status (draft → ready → active → inactive/archived). */
  status: CatalogStatus;
  price: number;
  compareAtPrice: number;
  costPrice: number;
  landedCost: number;
  /** Derived gross margin % (null when unknowable — never guessed). */
  marginPercent: number | null;
  currency: string;
  sku: string;
  inventoryQty: number;
  stockStatus: StockStatus;
  lowStockThreshold: number;
  shippingCost: number;
  freeShipping: boolean;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  shippingNote?: string;
  usInventory: boolean;
  supplierSource?: string;
  supplierProductRef?: string;
  safetyClass?: import('./productSafety').ProductSafetyClass | null;
  safetyReviewStatus?: import('./productSafety').ProductSafetyReviewStatus | null;
  intendedSpecies?: string | null;
  /** Commerce-readiness model (migration 0016). null/unknown = not yet classified. */
  commerceReadiness?: CommerceReadiness | null;
  sourceType?: SourceType | null;
  inventorySource?: InventorySource | null;
  fulfillmentMethod?: string | null;
  supplierUrl?: string | null;
  supplierStockStatus?: string | null;
  riskFlags?: string[];
  tags: string[];
  featured: boolean;
  newArrival: boolean;
  trending: boolean;
  bestRated: boolean;
  bestSeller: boolean;
  promoted: boolean;
  saleEnabled: boolean;
  discountType?: DiscountType;
  discountValue?: number;
  seoTitle: string;
  seoDescription: string;
  /** Raw persisted seo_title column (no display fallback) — the truth used
   *  by Auto-SEO eligibility. null = never generated. */
  seoTitleStored: string | null;
  /** Raw persisted seo_description column (no display fallback). */
  seoDescriptionStored: string | null;
  seoKeywords: string[];
  canonicalSlug?: string;
  ogImage?: string;
  imageUrl?: string | null;
  images: CatalogImage[];
  variants: CatalogVariant[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  /** Optional listing end (eBay-style). null = Good 'Til Cancelled (no expiry).
   *  Display-only: no automatic archiving exists, and this never expires a
   *  product on its own — it is a seller visibility aid. */
  listingEndsAt?: string | null;
  ownerNotes?: string;
  evidenceNotes?: string;
}

export interface CatalogCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

export interface Coupon {
  id: string;
  code: string;
  description?: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minCartValue: number;
  eligibleProductIds: string[];
  eligibleCategoryIds: string[];
  startAt?: string | null;
  endAt?: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type OfferType = 'percentage' | 'product_sale' | 'category_sale' | 'free_shipping';

export interface StoreOffer {
  id: string;
  name: string;
  offerType: OfferType;
  value: number | null;
  productIds: string[];
  categoryIds: string[];
  isActive: boolean;
  startAt?: string | null;
  endAt?: string | null;
  createdAt: string;
}

export interface StoreSettings {
  freeShippingEnabled: boolean;
  freeShippingThreshold: number;
  defaultDeliveryMinDays: number | null;
  defaultDeliveryMaxDays: number | null;
}

/**
 * The store-wide fallback, mirroring the live `store_settings` row so the
 * published policy and the code agree: free shipping is on at a $50 subtotal
 * and the standard delivery estimate is 7-14 business days where a listing
 * carries no window of its own. Admin can overwrite any of these at runtime
 * (CatalogAdmin), and the header reads the live value rather than a literal.
 */
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  freeShippingEnabled: true,
  freeShippingThreshold: 50,
  defaultDeliveryMinDays: 7,
  defaultDeliveryMaxDays: 14,
};

/** Effective storefront price after any store-approved sale/discount. */
export function effectivePrice(p: Pick<CatalogProduct, 'price' | 'saleEnabled' | 'discountType' | 'discountValue' | 'compareAtPrice'>): number {
  if (!p.saleEnabled) return p.price;
  if (p.discountType === 'percent' && p.discountValue != null && p.discountValue > 0) {
    return Math.round(p.price * (1 - p.discountValue / 100) * 100) / 100;
  }
  if (p.discountType === 'fixed' && p.discountValue != null && p.discountValue > 0) {
    return Math.max(0, Math.round((p.price - p.discountValue) * 100) / 100);
  }
  return p.price;
}

/** Derive stock status honestly from quantity + threshold (never invented). */
export function deriveStockStatus(qty: number, threshold: number, explicit?: StockStatus): StockStatus {
  if (explicit && explicit !== 'unknown') return explicit;
  if (qty <= 0) return 'out_of_stock';
  if (threshold > 0 && qty <= threshold) return 'low_stock';
  return 'in_stock';
}

/** Gross margin % from cost/landed vs price. null = unknowable (cost unset). */
export function deriveMarginPercent(price: number, landedCost: number): number | null {
  if (!(price > 0) || !(landedCost > 0)) return null;
  return Math.round(((price - landedCost) / price) * 1000) / 10;
}

/**
 * Species classification (DOG / CAT / BOTH) derived from category + tags.
 * There is no species column — this is a deterministic label, not stored
 * commerce truth. Returns null when the evidence is ambiguous.
 */
export function speciesOf(p: Pick<CatalogProduct, 'categoryName' | 'name' | 'tags'>): 'DOG' | 'CAT' | 'BOTH' | null {
  const hay = `${p.categoryName || ''} ${p.name} ${(p.tags || []).join(' ')}`.toLowerCase();
  const dog = /\bdog\b|dogs|puppy|canine|k9/.test(hay);
  const cat = /\bcat\b|cats|kitten|feline/.test(hay);
  if (dog && cat) return 'BOTH';
  if (dog) return 'DOG';
  if (cat) return 'CAT';
  return null;
}
