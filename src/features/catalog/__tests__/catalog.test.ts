import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDbForTests, __setDbConfigForTests, getDb, type DbAdapter } from '../../../services/db';
import {
  createProduct, updateProduct, setProductStatus, archiveProduct, hardDeleteProduct,
  duplicateProduct, saveProductImages, saveProductVariants, listProducts, getProduct,
  rowToProduct,
  createCoupon, updateCoupon, deleteCoupon, listCoupons, getCouponByCode, validateCoupon,
  createOffer, updateOffer, deleteOffer, listOffers,
  getStoreSettings, saveStoreSettings, quoteShipping, setDbToken, uid,
  __resetCatalogSchemaCacheForTests,
} from '../repository';
import {
  effectivePrice, deriveStockStatus, deriveMarginPercent, DEFAULT_STORE_SETTINGS,
} from '../types';
import {
  buildProductJsonLd, buildFeedRow, buildFeedCsv, buildProductMeta, altTextFor, productUrl, productPath,
} from '../seo';
import type { CatalogProduct, CatalogStatus } from '../types';
import { RETURNS_SECTIONS } from '../../../content/policies';

function reset() {
  // LocalStorageAdapter reads window.localStorage — install an in-memory
  // shim so the local adapter persists across calls inside the test.
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  };
  resetDbForTests();
  __setDbConfigForTests(null); // local adapter — no schema constraints
}

import type { ProductInput } from '../repository';

const base: ProductInput = {
  name: 'Interactive Squeaky Enrichment Toy for Dogs',
  shortDescription: 'Durable squeaky toy for play and enrichment.',
  description: 'A durable, easy-to-clean squeaky toy that keeps dogs engaged during play.',
  price: 14.99,
  compareAtPrice: 19.99,
  costPrice: 4.5,
  landedCost: 6.0,
  categoryId: 'cat-toys',
  brand: 'Luxedge',
  sku: 'TOY-SQ-001',
  inventoryQty: 50,
  tags: ['dog toy', 'enrichment'],
  status: 'draft',
};

describe('catalog repository (local adapter)', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('creates a product with a unique slug', async () => {
    const a = await createProduct({ ...base });
    const b = await createProduct({ ...base, name: base.name });
    expect(a.slug).toBe('interactive-squeaky-enrichment-toy-for-dogs');
    expect(b.slug).toBe('interactive-squeaky-enrichment-toy-for-dogs-2');
  });

  it('AI content updates preserve the product URL and unrelated fields', async () => {
    const p = await createProduct(base);
    const next = await updateProduct(p.id, { name: 'Improved Squeaky Dog Toy', description: 'Updated factual copy.' }, { preserveSlug: true });
    expect(next?.name).toBe('Improved Squeaky Dog Toy');
    expect(next?.slug).toBe(p.slug);
    expect(next?.price).toBe(p.price);
    expect(next?.status).toBe(p.status);
    expect(next?.tags).toEqual(p.tags);
  });

  it('updates a product and derives margin + stock status', async () => {
    const p = await createProduct({ ...base });
    const updated = await updateProduct(p.id, { ...base, price: 24.99, inventoryQty: 3, lowStockThreshold: 5, stockStatus: 'low_stock' });
    expect(updated!.price).toBe(24.99);
    expect(updated!.slug).toBe(p.slug);
    expect(updated!.stockStatus).toBe('low_stock');
    expect(updated!.marginPercent).toBeCloseTo(((24.99 - 6) / 24.99) * 100, 1);
  });

  it('maps string-tags rows to arrays (admin edit must not wipe CJ text tags)', () => {
    // Live CJ rows store tags as comma-separated text; if rowToProduct kept
    // them as-is, the admin editor would save `tags: []` and silently erase them.
    const row = {
      id: 'p1', slug: 'p1', name: 'Horse Grooming Kit', status: 'active', price: 39.99,
      tags: 'horse,grooming,brush,tack,equestrian', seo_keywords: 'curry comb,body brush',
    } as unknown as Parameters<typeof rowToProduct>[0];
    const p = rowToProduct(row, [], [], []);
    expect(p.tags).toEqual(['horse', 'grooming', 'brush', 'tack', 'equestrian']);
    expect(Array.isArray(p.tags)).toBe(true);
    expect(p.seoKeywords).toEqual(['curry comb', 'body brush']);
  });

  it('keeps raw persisted SEO truth separate from display fallbacks (Auto-SEO eligibility)', () => {
    // Regression for the "All listings already SEO" bug: rowToProduct falls
    // back seo_title → name and seo_description → short_description for
    // DISPLAY, so `p.seoTitle && p.seoDescription` was always truthy and the
    // bulk Auto-SEO run skipped products whose DB columns were NULL. The raw
    // stored fields must expose the real column values (null = needs SEO).
    const noSeo = {
      id: 'p1', slug: 'p1', name: 'Massage Brush', short_description: 'A brush.',
      status: 'active', price: 15, seo_title: null, seo_description: null,
    } as unknown as Parameters<typeof rowToProduct>[0];
    const missing = rowToProduct(noSeo, [], [], []);
    expect(missing.seoTitle).toBe('Massage Brush'); // display fallback preserved
    expect(missing.seoDescription).toBe('A brush.');
    expect(missing.seoTitleStored).toBeNull(); // raw column truth
    expect(missing.seoDescriptionStored).toBeNull();
    // The exact eligibility check the bulk Auto-SEO run performs.
    expect(Boolean(missing.seoTitleStored && missing.seoDescriptionStored) && missing.seoKeywords.length > 0).toBe(false);

    const withSeo = {
      id: 'p2', slug: 'p2', name: 'Massage Brush', short_description: 'A brush.',
      status: 'active', price: 15, seo_title: 'Custom SEO Title', seo_description: 'Custom SEO description',
      seo_keywords: ['brush'],
    } as unknown as Parameters<typeof rowToProduct>[0];
    const complete = rowToProduct(withSeo, [], [], []);
    expect(complete.seoTitleStored).toBe('Custom SEO Title');
    expect(complete.seoDescriptionStored).toBe('Custom SEO description');
    expect(Boolean(complete.seoTitleStored && complete.seoDescriptionStored) && complete.seoKeywords.length > 0).toBe(true);
  });

  it('maps optional listing end date through create/update (null = no expiry)', async () => {
    const p = await createProduct({ ...base });
    expect(p.listingEndsAt).toBeNull();
    const ends = new Date(Date.now() + 30 * 86400000).toISOString();
    const updated = await updateProduct(p.id, { listingEndsAt: ends });
    expect(updated!.listingEndsAt).toBe(ends);
    const cleared = await updateProduct(p.id, { listingEndsAt: null });
    expect(cleared!.listingEndsAt).toBeNull();
  });

  it('sets status, archives (not delete), and lists all', async () => {
    const p = await createProduct({ ...base });
    await setProductStatus(p.id, 'active');
    expect((await getProduct(p.id))!.status).toBe('active');
    await archiveProduct(p.id);
    const archived = await getProduct(p.id);
    expect(archived!.status).toBe('archived');
    expect((await listProducts()).length).toBe(1); // still listed for admin
  });

  it('hard deletes a product', async () => {
    const p = await createProduct({ ...base });
    await hardDeleteProduct(p.id);
    expect(await getProduct(p.id)).toBeNull();
  });

  it('duplicates product with images + variants as a DRAFT', async () => {
    const p = await createProduct({ ...base });
    await saveProductImages(p.id, [
      { url: 'https://img/1.jpg', altText: 'Front', isPrimary: true, sortOrder: 0 },
      { url: 'https://img/2.jpg', altText: 'Side', sortOrder: 1 },
    ]);
    await saveProductVariants(p.id, [
      { attributes: { size: 'S' }, sku: 'TOY-S', price: 14.99, inventoryQty: 20 },
      { attributes: { size: 'L' }, sku: 'TOY-L', price: 16.99, inventoryQty: 30 },
    ]);
    const dup = await duplicateProduct(p.id);
    expect(dup!.name).toBe(`${p.name} (Copy)`);
    expect(dup!.status).toBe('draft');
    expect(dup!.images.length).toBe(2);
    expect(dup!.variants.length).toBe(2);
    expect(dup!.sku).toBe('TOY-SQ-001-COPY');
    expect(dup!.id).not.toBe(p.id);
  });

  it('image manager replaces the set (add/remove/reorder/primary/alt/variant)', async () => {
    const p = await createProduct({ ...base });
    await saveProductImages(p.id, [
      { url: 'https://img/a.jpg', altText: 'A', isPrimary: true, sortOrder: 0 },
      { url: 'https://img/b.jpg', altText: 'B', sortOrder: 1 },
    ]);
    await saveProductVariants(p.id, [{ attributes: { color: 'Blue' }, sku: 'B-1', price: 10, inventoryQty: 5 }]);
    const withVariant = await getProduct(p.id);
    const vid = withVariant!.variants[0].id;

    // Replace: keep A (now alt + variant-linked), drop B, add C as new primary.
    const a = withVariant!.images.find((i) => i.url === 'https://img/a.jpg')!;
    await saveProductImages(p.id, [
      { id: a.id, url: a.url, altText: 'Updated alt', isPrimary: false, sortOrder: 1, variantId: vid },
      { url: 'https://img/c.jpg', altText: 'C', isPrimary: true, sortOrder: 0 },
    ]);
    const after = await getProduct(p.id);
    expect(after!.images.length).toBe(2);
    expect(after!.images.map((i) => i.url)).toEqual(['https://img/c.jpg', 'https://img/a.jpg']);
    expect(after!.images[0].isPrimary).toBe(true);
    expect(after!.images[1].altText).toBe('Updated alt');
    expect(after!.images[1].variantId).toBe(vid);
  });

  it('getProduct shows inline-base64 image rows the bulk loader hides', async () => {
    // Regression: an upload that fell back to a data: URL is persisted, but
    // loadRefs skips data:* rows on bulk loads. getProduct must merge the
    // product's OWN rows back in so the admin editor never hides a saved
    // image (which previously made the next Save delete it silently).
    const p = await createProduct({ ...base });
    await saveProductImages(p.id, [
      { url: 'https://img/real.jpg', isPrimary: true, sortOrder: 0 },
      { url: 'data:image/webp;base64,UklGRi4CAABXRUJQVlA4ICICAACQAgCdASoAA', sortOrder: 1 },
    ]);
    const loaded = await getProduct(p.id);
    expect(loaded!.images.length).toBe(2);
    expect(loaded!.images.map((i) => i.url)).toEqual([
      'https://img/real.jpg',
      'data:image/webp;base64,UklGRi4CAABXRUJQVlA4ICICAACQAgCdASoAA',
    ]);
  });

  it('variant manager replaces the set', async () => {
    const p = await createProduct({ ...base });
    await saveProductVariants(p.id, [
      { attributes: { size: 'S' }, sku: 'S-1', price: 10, inventoryQty: 2 },
      { attributes: { size: 'M' }, sku: 'M-1', price: 12, inventoryQty: 3 },
    ]);
    const before = await getProduct(p.id);
    const s = before!.variants.find((v) => v.sku === 'S-1')!;
    await saveProductVariants(p.id, [
      { id: s.id, attributes: { size: 'S' }, sku: 'S-1', price: 11, inventoryQty: 9 },
    ]);
    const after = await getProduct(p.id);
    expect(after!.variants.length).toBe(1);
    expect(after!.variants[0].price).toBe(11);
    expect(after!.variants[0].inventoryQty).toBe(9);
  });
});

describe('coupons', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('creates + lists + updates + deletes a coupon', async () => {
    const c = await createCoupon({ code: 'welcome10', discountType: 'percent', discountValue: 10, minCartValue: 25 });
    expect(c.code).toBe('WELCOME10');
    expect((await listCoupons()).length).toBe(1);
    await updateCoupon(c.id, { code: 'welcome15', discountType: 'percent', discountValue: 15 });
    expect((await getCouponByCode('welcome15'))!.discountValue).toBe(15);
    await deleteCoupon(c.id);
    expect(await getCouponByCode('welcome15')).toBeNull();
  });

  it('validates percent coupon with minimum cart value', () => {
    const coupon = {
      id: '1', code: 'P10', discountType: 'percent' as const, discountValue: 10,
      minCartValue: 50, eligibleProductIds: [], eligibleCategoryIds: [],
      startAt: null, endAt: null, usageLimit: null, usedCount: 0, isActive: true,
      createdAt: '', updatedAt: '',
    };
    expect(validateCoupon(coupon, 40, []).ok).toBe(false);
    expect(validateCoupon(coupon, 100, []).discount).toBeCloseTo(10, 5);
  });

  it('validates fixed coupon capped at subtotal', () => {
    const coupon = {
      id: '2', code: 'FIX', discountType: 'fixed' as const, discountValue: 20,
      minCartValue: 0, eligibleProductIds: [], eligibleCategoryIds: [],
      startAt: null, endAt: null, usageLimit: null, usedCount: 0, isActive: true,
      createdAt: '', updatedAt: '',
    };
    expect(validateCoupon(coupon, 15, []).discount).toBe(15);
    expect(validateCoupon(coupon, 100, []).discount).toBe(20);
  });

  it('enforces usage limit, dates, inactive, and eligibility', () => {
    const base = {
      id: '3', code: 'X', discountType: 'percent' as const, discountValue: 10,
      minCartValue: 0, eligibleProductIds: [], eligibleCategoryIds: [],
      startAt: null, endAt: null, usageLimit: 1, usedCount: 1, isActive: true,
      createdAt: '', updatedAt: '',
    };
    expect(validateCoupon(base, 100, []).ok).toBe(false);
    expect(validateCoupon({ ...base, usageLimit: null, usedCount: 0, isActive: false }, 100, []).ok).toBe(false);
    const now = new Date('2026-01-01');
    expect(validateCoupon({ ...base, usageLimit: null, usedCount: 0, startAt: '2026-02-01' }, 100, [], now).ok).toBe(false);
    expect(validateCoupon({ ...base, usageLimit: null, usedCount: 0, endAt: '2025-12-01' }, 100, [], now).ok).toBe(false);
    const scoped = {
      ...base, usageLimit: null, usedCount: 0, eligibleProductIds: ['p1'],
    };
    expect(validateCoupon(scoped, 100, [{ productId: 'p2' }]).ok).toBe(false);
    expect(validateCoupon(scoped, 100, [{ productId: 'p1' }]).ok).toBe(true);
    const catScoped = {
      ...base, usageLimit: null, usedCount: 0, eligibleProductIds: [], eligibleCategoryIds: ['cat-toys'],
    };
    expect(validateCoupon(catScoped, 100, [{ productId: 'x', categoryId: 'cat-toys' }]).ok).toBe(true);
  });
});

describe('offers + settings + shipping', () => {
  beforeEach(reset);
  afterEach(() => { __setDbConfigForTests(undefined); resetDbForTests(); });

  it('creates/updates/deletes offers', async () => {
    const o = await createOffer({ name: 'Free Shipping Week', offerType: 'free_shipping', isActive: true });
    expect((await listOffers()).length).toBe(1);
    await updateOffer(o.id, { name: 'Renamed', offerType: 'percentage', value: 10 });
    const after = (await listOffers())[0];
    expect(after.name).toBe('Renamed');
    expect(after.offerType).toBe('percentage');
    expect(after.value).toBe(10);
    await deleteOffer(o.id);
    expect((await listOffers()).length).toBe(0);
  });

  it('round-trips store settings with defaults', async () => {
    expect((await getStoreSettings()).freeShippingThreshold).toBe(DEFAULT_STORE_SETTINGS.freeShippingThreshold);
    await saveStoreSettings({ freeShippingEnabled: true, freeShippingThreshold: 75, defaultDeliveryMinDays: 5, defaultDeliveryMaxDays: 12 });
    const s = await getStoreSettings();
    expect(s.freeShippingThreshold).toBe(75);
    expect(s.defaultDeliveryMinDays).toBe(5);
  });

  it('quotes shipping honestly from settings + product flags', () => {
    const settings = { freeShippingEnabled: true, freeShippingThreshold: 50, defaultDeliveryMinDays: null, defaultDeliveryMaxDays: null };
    expect(quoteShipping(settings, [{ productFreeShipping: false, productSubtotal: 30 }]).freeEligible).toBe(false);
    expect(quoteShipping(settings, [{ productFreeShipping: false, productSubtotal: 60 }]).freeEligible).toBe(true);
    expect(quoteShipping(settings, [{ productFreeShipping: true, productSubtotal: 10 }]).freeEligible).toBe(true);
  });
});

describe('pricing + status helpers', () => {
  it('computes effective price for percent/fixed sales', () => {
    expect(effectivePrice({ price: 20, saleEnabled: false, discountType: 'percent', discountValue: 10, compareAtPrice: 0 })).toBe(20);
    expect(effectivePrice({ price: 20, saleEnabled: true, discountType: 'percent', discountValue: 10, compareAtPrice: 25 })).toBe(18);
    expect(effectivePrice({ price: 20, saleEnabled: true, discountType: 'fixed', discountValue: 5, compareAtPrice: 25 })).toBe(15);
  });
  it('derives stock status + margin honestly', () => {
    expect(deriveStockStatus(0, 0)).toBe('out_of_stock');
    expect(deriveStockStatus(3, 5)).toBe('low_stock');
    expect(deriveStockStatus(10, 5)).toBe('in_stock');
    expect(deriveStockStatus(10, 5, 'on_backorder')).toBe('on_backorder');
    expect(deriveMarginPercent(20, 0)).toBeNull();
    expect(deriveMarginPercent(20, 10)).toBe(50);
  });
});

describe('seo + feed', () => {
  const p: CatalogProduct = {
    id: 'p1', slug: 'toy', name: 'Interactive Squeaky Toy', shortDescription: 'Durable squeaky toy.',
    description: 'Longer description.', price: 14.99, compareAtPrice: 19.99, costPrice: 4, landedCost: 5,
    marginPercent: 66.6, currency: 'USD', sku: 'SKU-1', inventoryQty: 10, stockStatus: 'in_stock',
    lowStockThreshold: 0, shippingCost: 4.99, freeShipping: false, deliveryMinDays: null, deliveryMaxDays: null,
    usInventory: false, tags: ['toy'], featured: false, newArrival: true, trending: false, bestRated: false,
    bestSeller: false, promoted: false, saleEnabled: false, seoTitle: 'SEO Toy Title', seoDescription: 'SEO desc.',
    seoTitleStored: 'SEO Toy Title', seoDescriptionStored: 'SEO desc.',
    seoKeywords: ['toy'], images: [
      { id: 'i1', productId: 'p1', url: 'https://img/1.jpg', altText: '', kind: 'product', isPrimary: true, sortOrder: 0 },
    ], variants: [], categoryId: 'cat-toys', categoryName: 'Pet Toys', brand: 'Luxedge',
    status: 'active', features: [], specifications: {}, createdAt: '', updatedAt: '', publishedAt: null,
  };

  it('builds meta with real fields', () => {
    const meta = buildProductMeta(p);
    expect(meta.title).toBe('SEO Toy Title');
    expect(meta.canonical).toBe(productUrl(p));
    expect(meta.ogImage).toBe('https://img/1.jpg');
  });

  it('emits JSON-LD without fake ratings; includes them only when real reviews passed', () => {
    const ld = buildProductJsonLd(p);
    const product = ld.find((x) => x['@type'] === 'Product') as Record<string, unknown>;
    expect(product.aggregateRating).toBeUndefined();
    const withReviews = buildProductJsonLd(p, { count: 4, average: 4.5 });
    const rated = withReviews.find((x) => x['@type'] === 'Product') as Record<string, unknown>;
    expect((rated.aggregateRating as Record<string, unknown>).reviewCount).toBe(4);
  });

  it('client Offer carries merchant return policy + US shipping details (GSC parity)', () => {
    const ld = buildProductJsonLd(p);
    const offer = (ld.find((x) => x['@type'] === 'Product') as Record<string, unknown>)['offers'] as Record<string, unknown>;
    const policy = offer.hasMerchantReturnPolicy as Record<string, unknown>;
    expect(policy.merchantReturnDays).toBe(30);
    expect(policy.applicableCountry).toBe('US');
    // GSC merchant-listing subfields (returnMethod + returnFees) — returns are
    // by mail and the customer pays the return shipping, exactly as the
    // published Returns policy states.
    expect(policy.returnMethod).toBe('https://schema.org/ReturnByMail');
    expect(policy.returnFees).toBe('https://schema.org/ReturnFeesCustomerResponsibility');
    const sd = offer.shippingDetails as Record<string, unknown>;
    expect((sd.shippingDestination as Record<string, unknown>).addressCountry).toBe('US');
  });

  it('return-policy schema agrees with the published Returns policy', () => {
    // Regression guard: the schema used to declare FreeReturn while /returns
    // said the customer pays return shipping — a visible-vs-structured-data
    // contradiction that GSC merchant listings flag.
    const policyText = RETURNS_SECTIONS.map((s) => `${s.title} ${s.body}`).join(' ');
    const customerPays = /customers? (are|is) responsible for[^.]*return shipping costs/i.test(policyText);
    const ld = buildProductJsonLd(p);
    const offer = (ld.find((x) => x['@type'] === 'Product') as Record<string, unknown>)['offers'] as Record<string, unknown>;
    const schemaFees = (offer.hasMerchantReturnPolicy as Record<string, unknown>).returnFees;
    expect(customerPays, 'Returns policy must state who pays return shipping').toBe(true);
    expect(schemaFees).toBe('https://schema.org/ReturnFeesCustomerResponsibility');
    expect(String(schemaFees)).not.toContain('FreeReturn');
  });

  it('never claims the retailer name as the product brand', () => {
    const product = (brand?: string) => {
      const ld = buildProductJsonLd({ ...p, brand } as CatalogProduct);
      return ld.find((x) => x['@type'] === 'Product') as Record<string, unknown>;
    };
    // Generic third-party goods: no brand recorded, or the store's own name.
    expect(product('').brand).toBeUndefined();
    expect(product('Luxedge').brand).toBeUndefined();
    expect(product(undefined).brand).toBeUndefined();
    // A real recorded brand is still published.
    expect(product('Himalayan Koh').brand).toEqual({ '@type': 'Brand', name: 'Himalayan Koh' });
  });

  it('productPath always resolves to the canonical slug form (GSC merchant-listing contract)', () => {
    // Slug present → slug is the only kind of link the storefront emits.
    expect(productPath({ id: 'uuid-1', slug: 'horse-grooming-kit-12-piece' })).toBe('/product/horse-grooming-kit-12-piece');
    // id fallback only when the slug is genuinely missing/empty.
    expect(productPath({ id: 'uuid-2' })).toBe('/product/uuid-2');
    expect(productPath({ id: 'uuid-3', slug: '' })).toBe('/product/uuid-3');
    expect(productPath({ id: 'uuid-4', slug: null as unknown as undefined })).toBe('/product/uuid-4');
  });

  it('productUrl is the absolute form of the same slug-first path', () => {
    const p = { id: 'uuid-1', slug: 'horse-grooming-kit-12-piece' };
    expect(productUrl(p)).toBe('https://luxedge.us/product/horse-grooming-kit-12-piece');
    expect(productUrl({ id: 'uuid-5' })).toBe('https://luxedge.us/product/uuid-5');
  });

  it('builds feed rows + CSV for Merchant readiness', () => {
    const row = buildFeedRow(p);
    expect(row.id).toBe('p1');
    expect(row.availability).toBe('in stock');
    expect(row.condition).toBe('new');
    expect(String(row.price)).toBe('14.99 USD');
    const csv = buildFeedCsv([p]);
    expect(csv).toContain('id,title');
    expect(csv).toContain('p1');
  });

  it('feed rows carry the return policy in CSV form (Meta/Pinterest parity with merchantOfferExtras)', () => {
    const row = buildFeedRow(p);
    // Same storewide policy as the JSON-LD offer and the published Returns
    // page: 30-day returns by mail, customer pays return shipping.
    expect(row.return_method).toBe('by_mail');
    expect(row.return_fees).toBe('customer');
    expect(row.return_days).toBe(30);
    const csv = buildFeedCsv([p]);
    expect(csv).toContain('return_method,return_fees,return_days');
    expect(csv).toContain('by_mail,customer,30');
  });

  it('feed rows omit the retailer name as a brand (same rule as JSON-LD)', () => {
    expect(buildFeedRow({ ...p, brand: 'Luxedge' } as CatalogProduct).brand).toBeUndefined();
    expect(buildFeedRow({ ...p, brand: '' } as CatalogProduct).brand).toBeUndefined();
    expect(buildFeedRow({ ...p, brand: 'Himalayan Koh' } as CatalogProduct).brand).toBe('Himalayan Koh');
  });

  it('alt text is deterministic and never invented', () => {
    expect(altTextFor(p, p.images[0], 0)).toBe('Interactive Squeaky Toy — primary image');
  });

  it('setDbToken is safe on any adapter', () => {
    resetDbForTests();
    __setDbConfigForTests({ url: 'https://test.supabase.co', anonKey: 'test-anon' });
    try {
      setDbToken('jwt');
      expect((getDb() as DbAdapter & { getAccessToken?: () => string | null }).getAccessToken?.()).toBe('jwt');
      resetDbForTests();
      __setDbConfigForTests(null);
      expect(() => setDbToken('jwt')).not.toThrow();
    } finally {
      resetDbForTests();
      __setDbConfigForTests(undefined);
    }
  });

  it('uid generates unique ids', () => {
    expect(uid()).not.toBe(uid());
  });
});

describe('catalog repository (pre-0010 live schema degradation)', () => {
  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    vi.unstubAllGlobals();
  });

  // Mock a Supabase REST endpoint whose schema has ONLY legacy product
  // columns (no featured/tags/coupons/safety) — exactly the live pre-0010
  // state. select= probes are validated the way PostgREST validates them:
  // a select naming a missing column returns 400 PGRST204 with the FIRST
  // missing column in the message.
  function mockLegacySupabase() {
    const db: Record<string, unknown[]> = {};
    // Live pre-0010 products has BOTH name + title (title NOT NULL — the
    // legacy column the repository must mirror on write) plus the core V2 set.
    const legacyCols = ['id', 'slug', 'name', 'title', 'status', 'price', 'cost_price', 'sku', 'inventory_qty', 'category_id', 'brand', 'currency', 'created_at', 'updated_at', 'description', 'short_description', 'compare_at_price', 'stock_status', 'low_stock_threshold', 'supplier_source', 'supplier_product_ref', 'delivery_min_days', 'delivery_max_days', 'shipping_note', 'us_inventory'];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url.split('?')[0]}`);
      // select= schema probe: name the first requested column missing from
      // the live schema (exactly PostgREST's PGRST204 behavior).
      if (url.includes('select=')) {
        const qs = new URL(url, 'https://x').searchParams;
        const requested = (qs.get('select') || '').split(',');
        const missing = requested.find((c) => !legacyCols.includes(c));
        if (missing) {
          // Real PostgREST 42703 shape (verified against the live Supabase).
          return new Response(JSON.stringify({ code: '42703', message: `column products.${missing} does not exist` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/rest/v1/categories')) {
        const rows = db['categories'] || [];
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/rest/v1/products')) {
        if (!db['products']) db['products'] = [];
        const rows = db['products'];
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          rows.push(body);
          return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (init?.method === 'PATCH') {
          const id = url.match(/id=eq\.([^&]+)/)?.[1];
          const body = JSON.parse(String(init.body));
          const typed = rows as { id?: string }[];
          const idx = typed.findIndex((r) => r.id === decodeURIComponent(id || ''));
          if (idx >= 0) rows[idx] = { ...(rows[idx] as Record<string, unknown>), ...body };
          return new Response(JSON.stringify([rows[idx]]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('id=eq.')) {
          const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)?.[1] || '');
          const typed = rows as { id?: string }[];
          return new Response(JSON.stringify(typed.filter((r) => r.id === id)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('slug=eq.')) {
          const slug = decodeURIComponent(url.match(/slug=eq\.([^&]+)/)?.[1] || '');
          const typed = rows as { slug?: string }[];
          return new Response(JSON.stringify(typed.filter((r) => r.slug === slug)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('sku=eq.')) {
          const sku = decodeURIComponent(url.match(/sku=eq\.([^&]+)/)?.[1] || '');
          const typed = rows as { sku?: string }[];
          return new Response(JSON.stringify(typed.filter((r) => r.sku === sku)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    return { db, calls };
  }

  it('pre-0010: requesting active status degrades to DRAFT (never silent publish)', async () => {
    const { db, calls } = mockLegacySupabase();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    const p = await createProduct({ ...base, status: 'active' });
    expect(p.status).toBe('draft');
    const stored = db['products'][0] as Record<string, unknown>;
    expect(stored.status).toBe('draft');
    expect(stored.featured).toBeUndefined(); // 0010 columns never sent
    expect(calls.some((c) => c.startsWith('GET https://db.example.com/rest/v1/'))).toBe(true);
  });

  it('pre-0021: safety columns are filtered when missing from live schema (PGRST204 guard)', async () => {
    // Regression for the live 400 "Could not find the 'intended_species' column"
    // that occurs when migration 0021 is not yet applied: the schema probe must
    // drop safety_class / safety_review_status / intended_species from the write
    // instead of sending them and letting PostgREST reject the whole row.
    const { db } = mockLegacySupabase(); // legacyCols has NO safety columns
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    await createProduct({
      ...base,
      safetyClass: 'NON_INGESTIBLE',
      safetyReviewStatus: 'APPROVED_FOR_SALE',
      intendedSpecies: 'dog',
    });
    const stored = db['products'][0] as Record<string, unknown>;
    expect(stored.safety_class).toBeUndefined();
    expect(stored.safety_review_status).toBeUndefined();
    expect(stored.intended_species).toBeUndefined();
    // Core columns still land — the row must not be dropped wholesale.
    expect(stored.name).toBe(base.name);
    expect(stored.price).toBe(base.price);
  });

  it('schema probe uses the anon-key-safe select= endpoint (no OpenAPI 401)', async () => {
    // Regression for the LIVE failure: the OpenAPI probe endpoint 401s for
    // the browser anon key, so the probe "failed" and the repository assumed
    // the FULL schema — then wrote columns that do not exist (PGRST204) or
    // skipped NOT NULL legacy mirrors (storage_path). The probe must hit the
    // table endpoint with select= (PostgREST validates it for anon keys) and
    // filter missing columns out of the write.
    const probeCalls: string[] = [];
    const legacyCols = ['id', 'slug', 'name', 'title', 'status', 'price', 'cost_price', 'sku', 'inventory_qty', 'category_id', 'brand', 'currency', 'created_at', 'updated_at', 'description', 'short_description'];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('select=')) {
        probeCalls.push(url.split('?')[0]);
        const qs = new URL(url, 'https://x').searchParams;
        const requested = (qs.get('select') || '').split(',');
        const missing = requested.find((c) => !legacyCols.includes(c));
        if (missing) {
          // Legacy PGRST204 shape — the probe must handle this format too.
          return new Response(JSON.stringify({ code: 'PGRST204', message: `Could not find the '${missing}' column of 'products' in the schema cache` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    await createProduct({ ...base, featured: true, safetyClass: 'NON_INGESTIBLE' });
    // Probe hit the table endpoint (not the OpenAPI root), and the missing
    // 0010/0021 columns were filtered out of the write.
    expect(probeCalls.some((c) => c.endsWith('/rest/v1/products'))).toBe(true);
    expect(probeCalls.some((c) => c.endsWith('/rest/v1/'))).toBe(false);
  });

  it('live 42703 probe: storage_path detected so the NOT NULL image row saves (PGRST204/42703 regression)', async () => {
    // The user's live failure: "null value in column \"storage_path\" ...
    // violates not-null constraint". The image probe must succeed with the
    // anon key (select= endpoint, not OpenAPI) and detect storage_path so the
    // write includes it. Uses the REAL 42703 error shape verified against the
    // live Supabase server.
    const db: Record<string, unknown[]> = { products: [], product_images: [] };
    const legacyCols = ['id', 'slug', 'name', 'title', 'status', 'price', 'cost_price', 'sku', 'inventory_qty', 'category_id', 'brand', 'currency', 'created_at', 'updated_at', 'description', 'short_description'];
    const imgCols = ['id', 'product_id', 'url', 'storage_path', 'public_url', 'alt_text', 'kind', 'is_primary', 'sort_order', 'variant_id', 'created_at'];
    const tableCols: Record<string, string[]> = { products: legacyCols, product_images: imgCols };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('select=')) {
        const qs = new URL(url, 'https://x').searchParams;
        const path = url.split('?')[0];
        const table = path.split('/rest/v1/')[1]?.split('/')[0] || '';
        const requested = (qs.get('select') || '').split(',');
        const missing = requested.find((c) => !(tableCols[table] || []).includes(c));
        if (missing) {
          return new Response(JSON.stringify({ code: '42703', message: `column ${table}.${missing} does not exist` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const path = url.split('?')[0];
      const table = path.split('/rest/v1/')[1]?.split('/')[0] || '';
      const rows = (db[table] ||= []) as Record<string, unknown>[];
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        rows.push(body);
        return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('id=eq.')) {
        const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)?.[1] || '');
        return new Response(JSON.stringify(rows.filter((r) => r.id === id)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    const p = await createProduct({ ...base });
    await saveProductImages(p.id, [{ url: 'https://img/a.jpg', altText: 'A', isPrimary: true, sortOrder: 0 }]);
    const img = db['product_images'][0] as Record<string, unknown>;
    expect(img.storage_path).toContain('catalog/'); // NOT NULL column satisfied
    expect(img.public_url).toBe('https://img/a.jpg');
  });

  it('pre-0010: coupons and offers degrade to empty lists', async () => {
    mockLegacySupabase();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    expect(await listCoupons()).toEqual([]);
    expect(await listOffers()).toEqual([]);
  });

  it('writes the legacy NOT NULL title column on create and update (live products.title)', async () => {
    const { db } = mockLegacySupabase();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    const p = await createProduct({ ...base });
    const stored = db['products'][0] as Record<string, unknown>;
    expect(stored.title).toBe(base.name); // legacy NOT NULL column satisfied
    await updateProduct(p.id, { name: 'Renamed Toy' });
    const after = db['products'][0] as Record<string, unknown>;
    expect(after.title).toBe('Renamed Toy'); // title follows name
    expect(after.description).toBe(base.description); // untouched fields preserved
  });

  it('pre-0010: an unknown status is fail-closed to DRAFT (never silently stored)', async () => {
    const { db } = mockLegacySupabase();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    await createProduct({ ...base });
    const id = (db['products'][0] as { id: string }).id;
    await updateProduct(id, { status: 'bogus' as CatalogStatus });
    const after = db['products'][0] as Record<string, unknown>;
    expect(after.status).toBe('draft'); // clamped, never 'bogus'
  });
});

// ---------------------------------------------------------------------------
// Full-schema (post-0010) legacy-column handling for images/variants/settings
// ---------------------------------------------------------------------------
describe('catalog repository (post-0010 live schema: legacy NOT NULL mirrors)', () => {
  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    vi.unstubAllGlobals();
  });

  // Simulates the REAL live schema: products has both name + title; product_images
  // requires storage_path/public_url/created_at; product_variants requires
  // title/price_amount/option_values/created_at/updated_at; store_settings PK = key.
  function mockFullSchema() {
    const db: Record<string, unknown[]> = { products: [], product_images: [], product_variants: [], coupons: [], store_offers: [], store_settings: [], categories: [{ id: 'cat-toys', name: 'Pet Toys', slug: 'pet-toys' }] };
    const tableCols: Record<string, string[]> = {
      products: ['id', 'slug', 'name', 'title', 'status', 'price', 'compare_at_price', 'cost_price', 'sku', 'inventory_qty', 'category_id', 'brand', 'currency', 'created_at', 'updated_at', 'short_description', 'description', 'tags', 'featured', 'new_arrival', 'free_shipping', 'stock_status', 'low_stock_threshold', 'us_inventory', 'supplier_source', 'supplier_product_ref', 'delivery_min_days', 'delivery_max_days', 'shipping_note', 'seo_title', 'seo_description', 'seo_keywords', 'published_at', 'owner_notes', 'evidence_notes', 'sort_order'],
      product_images: ['id', 'product_id', 'url', 'storage_path', 'public_url', 'alt_text', 'kind', 'is_primary', 'sort_order', 'variant_id', 'created_at'],
      product_variants: ['id', 'product_id', 'attributes', 'sku', 'price', 'compare_at_price', 'cost_price', 'inventory_qty', 'status', 'low_stock_threshold', 'title', 'price_amount', 'option_values', 'created_at', 'updated_at'],
      coupons: [],
      store_offers: [],
      store_settings: ['key', 'value', 'updated_at'],
      categories: ['id', 'name', 'slug'],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('select=')) {
        const qs = new URL(url, 'https://x').searchParams;
        const path = url.split('?')[0];
        const table = path.split('/rest/v1/')[1]?.split('/')[0] || '';
        const requested = (qs.get('select') || '').split(',');
        const missing = requested.find((c) => !(tableCols[table] || []).includes(c));
        if (missing) {
          // Real PostgREST 42703 shape (verified against the live Supabase).
          return new Response(JSON.stringify({ code: '42703', message: `column ${table}.${missing} does not exist` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const path = url.split('?')[0];
      const table = path.split('/rest/v1/')[1]?.split('/')[0] || '';
      const rows = (db[table] ||= []) as Record<string, unknown>[];
      const qs = url.split('?')[1] || '';
      const parseEq = (): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const part of qs.split('&')) {
          const m = part.match(/^([a-z_]+)=eq\.([^&]+)$/);
          if (m) out[m[1]] = decodeURIComponent(m[2]);
        }
        return out;
      };
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        rows.push(body);
        return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (init?.method === 'PATCH') {
        const eq = parseEq();
        const body = JSON.parse(String(init.body));
        const idx = rows.findIndex((r) => eq.column ? r[eq.column] === eq.value : r[Object.keys(eq)[0]] === eq[Object.keys(eq)[0]]);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...body };
        return new Response(JSON.stringify([rows[idx]]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (init?.method === 'DELETE') {
        const eq = parseEq();
        const key = Object.keys(eq)[0];
        db[table] = rows.filter((r) => r[key] !== eq[key]);
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const eq = parseEq();
      if (Object.keys(eq).length) {
        const key = Object.keys(eq)[0];
        return new Response(JSON.stringify(rows.filter((r) => r[key] === eq[key])), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    return { db };
  }

  it('satisfies legacy product_images NOT NULL storage_path/public_url/created_at', async () => {
    const { db } = mockFullSchema();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    const p = await createProduct({ ...base });
    await saveProductImages(p.id, [{ url: 'https://img/a.jpg', altText: 'A', isPrimary: true, sortOrder: 0 }]);
    const img = (db['product_images'][0] as Record<string, unknown>);
    expect(img.storage_path).toContain('catalog/');
    expect(img.public_url).toBe('https://img/a.jpg');
    expect(img.created_at).toBeTruthy();
  });

  it('updateProduct is a TRUE partial update — unspecified fields are preserved, never nulled', async () => {
    const { db } = mockFullSchema();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    await createProduct({ ...base, status: 'active' as CatalogStatus });
    // Editing ONLY the price must not touch status, description, title, etc.
    await updateProduct((db['products'][0] as { id: string }).id, { price: 99.99 });
    const after = db['products'][0] as Record<string, unknown>;
    expect(after.price).toBe(99.99);
    expect(after.status).toBe('active'); // NOT reset to draft
    expect(after.description).toBe(base.description);
    expect(after.title).toBe(base.name);
    expect(after.sku).toBe(base.sku);
  });

  it('satisfies legacy product_variants NOT NULL title/price_amount/option_values/created_at', async () => {
    const { db } = mockFullSchema();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    const p = await createProduct({ ...base });
    await saveProductVariants(p.id, [{ attributes: { size: 'S' }, sku: 'S-1', price: 10, inventoryQty: 2 }]);
    const v = db['product_variants'][0] as Record<string, unknown>;
    expect(v.title).toBe('size: S');
    expect(v.price_amount).toBe(1000); // cents mirror of $10
    expect(v.option_values).toEqual({ size: 'S' });
    expect(v.created_at).toBeTruthy();
    expect(v.updated_at).toBeTruthy();
  });

  it('store_settings round-trips via its key PK (insertRaw + updateBy)', async () => {
    const { db } = mockFullSchema();
    __setDbConfigForTests({ url: 'https://db.example.com', anonKey: 'anon' });
    resetDbForTests();
    __resetCatalogSchemaCacheForTests();
    await saveStoreSettings({ freeShippingEnabled: true, freeShippingThreshold: 75, defaultDeliveryMinDays: 5, defaultDeliveryMaxDays: 12 });
    expect((db['store_settings'] as Record<string, unknown>[]).length).toBe(1);
    await saveStoreSettings({ freeShippingEnabled: false, freeShippingThreshold: 60, defaultDeliveryMinDays: null, defaultDeliveryMaxDays: null });
    const rows = db['store_settings'] as Record<string, unknown>[];
    expect(rows.length).toBe(1); // updated, not duplicated
    expect((rows[0].value as Record<string, unknown>).freeShippingThreshold).toBe(60);
    expect((await getStoreSettings()).freeShippingEnabled).toBe(false);
  });
});
