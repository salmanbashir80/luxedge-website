import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadProductByIdOrSlug, loadStorefrontCatalog, loadStorefrontPromotions } from '../catalog';
import { resetDbForTests, __setDbConfigForTests } from '../db';

const URL = 'https://project.supabase.co';
const ANON = 'anon-key-123';

function jsonResponse(body: unknown, status = 200): Response {
  // Mapper-focused fixtures need the independent public-indexability facts.
  // Individual tests can still override any of them to assert a withholding
  // condition; category and ancillary-table fixtures do not have `status`.
  const withPublicFacts = Array.isArray(body) ? body.map((row) => (
    row && typeof row === 'object' && 'status' in row
      ? {
          description: 'A detailed verified product description that gives a shopper enough factual information to evaluate the listed item before ordering.',
          image_url: 'https://images.example.test/verified-product.jpg',
          slug: `verified-${String((row as Record<string, unknown>).id || 'product')}`,
          ...row,
        }
      : row
  )) : body;
  return new Response(JSON.stringify(withPublicFacts), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('loadStorefrontCatalog', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests({ url: URL, anonKey: ANON });
  });

  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    vi.unstubAllGlobals();
  });

  it('returns null when Supabase is not configured', async () => {
    __setDbConfigForTests(null);
    expect(await loadStorefrontCatalog()).toBeNull();
  });

  it('returns null when the DB is unreachable (no silent fake catalog)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await loadStorefrontCatalog()).toBeNull();
  });

  it('returns an EMPTY REAL CATALOG (not null, not demo fallback) when the DB is reachable with zero published products', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([{ id: 'c1', name: 'Pet Toys', slug: 'pet-toys', is_active: true, sort_order: 0 }]));
      if (url.includes('/products')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.source).toBe('supabase');
    expect(cat!.products).toEqual([]);
    // Categories still load — only the product list is intentionally empty.
    expect(cat!.categories.length).toBe(1);
    expect(cat!.categories[0].name).toBe('Pet Toys');
  });

  it('filters to published commerce-ready products (V2 schema: name/price)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse([{ id: 'c1', name: 'Pet Beds', slug: 'pet-beds', is_active: true, sort_order: 0 }]));
      }
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Dog Bed', slug: 'dog-bed', status: 'published', price: 49.99, category_id: 'c1', inventory_qty: 10, supplier_source: 'CJ', cost_price: 12, us_inventory: true, stock_status: 'in_stock' },
          { id: 'p2', name: 'Draft Item', slug: 'draft', status: 'draft', price: 9.99 },
          { id: 'p3', name: 'Free Item', slug: 'free', status: 'published', price: 0, price_amount: 0, supplier_source: 'CJ', cost_price: 1 },
          { id: 'p4', name: 'Retail-Ref Only', slug: 'ref', status: 'published', price: 29.99, supplier_source: 'KONG Company (official manufacturer)', cost_price: 0, commerce_readiness: 'COMMERCE_READY' },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.source).toBe('supabase');
    // p1 (real supplier + cost + US stock) is visible; p3 has no price; p4 is
    // manufacturer-source and stays storefront-hidden despite COMMERCE_READY.
    expect(cat!.products.map((p) => p.id)).toEqual(['p1']);
    expect(cat!.products[0].name).toBe('Dog Bed');
    expect(cat!.products[0].price).toBe(49.99);
    expect(cat!.products[0].category).toBe('Pet Beds');
    expect(cat!.products[0].commerceReadiness).toBe('COMMERCE_READY');
    expect(cat!.categories.length).toBe(1);
  });

  it('display parity: rows WITHOUT title/description/price_amount/image_url map cleanly (name||id, \'\' desc, price, images from product_images)', async () => {
    // The egress select deliberately omits columns that never existed on
    // public.products (they 400-d the query). The mapping must fall back the
    // same way select=* did: name→display, price_amount absent → price used,
    // image_url absent → product_images table still supplies the images.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Dog Bed', slug: 'dog-bed', status: 'active', price: 49.99, short_description: 'Comfy', category_id: null, inventory_qty: 5, supplier_source: 'CJ', cost_price: 12, us_inventory: true, stock_status: 'in_stock', commerce_readiness: 'COMMERCE_READY' },
          // No name → falls back to id (title is not a column, so never present).
          { id: 'p2', slug: 'nameless', status: 'active', price: 9.99, commerce_readiness: 'COMMERCE_READY' },
        ]));
      }
      if (url.includes('/product_images')) {
        return Promise.resolve(jsonResponse([{ product_id: 'p1', url: 'https://img/x.jpg', alt_text: 'bed', is_primary: true, sort_order: 0 }]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    const byId = new Map(cat!.products.map((p) => [p.id, p]));
    expect(byId.get('p1')?.name).toBe('Dog Bed'); // p.name || p.title → name
    expect(byId.get('p1')?.description).toContain('detailed verified product description');
    expect(byId.get('p1')?.price).toBe(49.99); // price (no price_amount present)
    expect(byId.get('p1')?.images).toEqual(['https://images.example.test/verified-product.jpg']);
    expect(byId.get('p2')).toBeUndefined();
  });

  it('withholds active rows without a verified purchasing path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          // Admin-activated despite no cost basis — the owner's explicit
          // "Active" click IS the approval; visible (today's AliExpress adds).
          { id: 'p1', name: 'KONG Classic Toy', status: 'active', price: 8.99, supplier_source: 'KONG Company (official manufacturer)', cost_price: 0, us_inventory: true, stock_status: 'in_stock', inventory_qty: 25 },
          // Real CJ supply + cost + list-level US inventory → COMMERCE_READY.
          { id: 'p2', name: 'CJ Scratch Board', status: 'active', price: 5.99, supplier_source: 'CJ', supplier_product_ref: 'CJYD2060792', cost_price: 1.99, us_inventory: true, stock_status: 'in_stock', inventory_qty: 4 },
          // PUBLISHED (legacy/auto path) without a purchasing path stays hidden.
          { id: 'p3', name: 'Retail-Ref Only', status: 'published', price: 29.99, supplier_source: 'KONG Company (official manufacturer)', cost_price: 0 },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/product_variants')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat!.products.map((p) => p.id)).toEqual(['p2']);
    expect(cat!.products[0].commerceReadiness).toBe('COMMERCE_READY');
  });

  it('parses comma-separated STRING tags (the CJ-import rows) into arrays', async () => {
    // Live rows (verified against production): some CJ products store tags as a
    // plain text value e.g. "horse,grooming,brush,tack,equestrian" instead of a
    // jsonb array — PostgREST returns it as a JSON string. tagsOf must split it.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Horse Grooming Kit', slug: 'horse-grooming-kit', status: 'active', price: 39.99, tags: 'horse,grooming,brush,tack,equestrian', supplier_source: 'CJ', cost_price: 10, us_inventory: true, stock_status: 'in_stock', commerce_readiness: 'COMMERCE_READY' },
          { id: 'p2', name: 'Bird Feeder', slug: 'bird-feeder', status: 'active', price: 19.99, tags: 'bird, feeder , outdoor', supplier_source: 'CJ', cost_price: 5, us_inventory: true, stock_status: 'in_stock', commerce_readiness: 'COMMERCE_READY' },
        ]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    const byId = new Map(cat!.products.map((p) => [p.id, p]));
    expect(byId.get('p1')?.tags).toEqual(['horse', 'grooming', 'brush', 'tack', 'equestrian']);
    expect(byId.get('p2')?.tags).toEqual(['bird', 'feeder', 'outdoor']); // whitespace trimmed
  });

  it('accepts a JSON-string array shape and keeps jsonb arrays unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'JSON String Array', slug: 'json-string', status: 'active', price: 9.99, tags: '["cat","toys"]', supplier_source: 'CJ', cost_price: 2, us_inventory: true, stock_status: 'in_stock', commerce_readiness: 'COMMERCE_READY' },
          { id: 'p2', name: 'Real Array', slug: 'real-array', status: 'active', price: 9.99, tags: ['dog', 'bed'], seo_keywords: 'walking,training', supplier_source: 'CJ', cost_price: 2, us_inventory: true, stock_status: 'in_stock', commerce_readiness: 'COMMERCE_READY' },
        ]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    const byId = new Map(cat!.products.map((p) => [p.id, p]));
    expect(byId.get('p1')?.tags).toEqual(['cat', 'toys']);
    // jsonb array rows behave exactly as before…
    expect(byId.get('p2')?.tags).toEqual(['dog', 'bed']);
    // …and the shared parser also covers seo_keywords (same tagsOf path).
    expect(byId.get('p2')?.seoKeywords).toEqual(['walking', 'training']);
  });

  it('never throws on any tags shape and degrades to [] only for absent/malformed values', async () => {
    // [shape → expected tags]: the mapper must never throw; array-parseable
    // shapes survive (non-string elements filtered), everything else degrades
    // to [].
    const cases: Array<readonly [unknown, string[]]> = [
      [null, []],
      [undefined, []],
      ['', []],
      ['   ', []],
      ['["broken', []],          // array intent, malformed JSON → []
      ['["a",5,"b"]', ['a', 'b']], // parsed array, non-string filtered
      [42, []],
      [true, []],
      [{}, []],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [shape, expected] = cases[i];
      const row: Record<string, unknown> = {
        id: `s${i}`, name: `Shape ${i}`, slug: `shape-${i}`, status: 'active',
        price: 9.99, tags: shape, supplier_source: 'CJ', cost_price: 2,
        us_inventory: true, stock_status: 'in_stock', commerce_readiness: 'COMMERCE_READY',
      };
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
        if (url.includes('/products')) return Promise.resolve(jsonResponse([row]));
        return Promise.resolve(jsonResponse([]));
      }));
      const cat = await loadStorefrontCatalog();
      expect(cat).not.toBeNull();
      expect(cat!.products[0].tags).toEqual(expected);
    }
  });

  it('handles the legacy schema (title + integer cents) defensively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', title: 'Legacy Bed', status: 'published', price_amount: 4999, compare_at_amount: 8999, image_url: 'https://img/x.jpg', supplier_source: 'CJ', cost_price: 12, us_inventory: true, stock_status: 'in_stock' },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.products[0].name).toBe('Legacy Bed');
    expect(cat!.products[0].price).toBe(49.99);
    expect(cat!.products[0].originalPrice).toBe(89.99);
    expect(cat!.products[0].images).toEqual(['https://img/x.jpg']);
  });

  it('tolerates a missing product_images table without failing the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([{ id: 'p1', name: 'Bed', status: 'published', price: 10, supplier_source: 'CJ', cost_price: 3, us_inventory: true, stock_status: 'in_stock' }]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse({ code: 'PGRST205' }, 404));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat).not.toBeNull();
    expect(cat!.products[0].name).toBe('Bed');
  });

  it('Catalog Launch: ACTIVE products are storefront-visible (status IN published/active)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Active Bed', status: 'active', price: 39.99, featured: true, new_arrival: true, free_shipping: true, sale_enabled: true, discount_type: 'percent', discount_value: 10, price_amount: 3999, supplier_source: 'CJ', cost_price: 10, us_inventory: true, stock_status: 'in_stock' },
          { id: 'p2', name: 'Published Legacy', status: 'published', price: 19.99, supplier_source: 'CJ', cost_price: 5, us_inventory: true, stock_status: 'in_stock' },
          { id: 'p3', name: 'Draft Item', status: 'draft', price: 9.99 },
          { id: 'p4', name: 'Inactive Item', status: 'inactive', price: 8.99 },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/product_variants')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const cat = await loadStorefrontCatalog();
    expect(cat!.products.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    const active = cat!.products.find((p) => p.id === 'p1')!;
    expect(active.featured).toBe(true);
    expect(active.newArrival).toBe(true);
    expect(active.freeShipping).toBe(true);
    // percent sale applied to the storefront price
    expect(active.price).toBeCloseTo(35.99, 5);
  });
});

describe('loadStorefrontPromotions', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests({ url: URL, anonKey: ANON });
  });
  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    vi.unstubAllGlobals();
  });

  it('loads active coupons + free-shipping settings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/coupons')) {
        return Promise.resolve(jsonResponse([
          { id: 'c1', code: 'WELCOME10', discount_type: 'percent', discount_value: 10, min_cart_value: 25, eligible_product_ids: [], eligible_category_ids: [], end_at: null, usage_limit: 100, used_count: 3, is_active: true },
        ]));
      }
      if (url.includes('/store_settings')) {
        return Promise.resolve(jsonResponse([{ key: 'free_shipping', value: { freeShippingEnabled: true, freeShippingThreshold: 75 } }]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    const p = await loadStorefrontPromotions();
    expect(p.coupons.length).toBe(1);
    expect(p.coupons[0].code).toBe('WELCOME10');
    expect(p.coupons[0].discountValue).toBe(10);
    expect(p.freeShippingEnabled).toBe(true);
    expect(p.freeShippingThreshold).toBe(75);
  });

  it('degrades to safe defaults when promotions are unavailable (no fake coupons/shipping)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')));
    const p = await loadStorefrontPromotions();
    expect(p.coupons).toEqual([]);
    expect(p.freeShippingEnabled).toBe(false);
  });
});

describe('loadProductByIdOrSlug', () => {
  beforeEach(() => {
    resetDbForTests();
    __setDbConfigForTests({ url: URL, anonKey: ANON });
  });

  afterEach(() => {
    __setDbConfigForTests(undefined);
    resetDbForTests();
    vi.unstubAllGlobals();
  });

  it('withholds an ACTIVE product by slug when public commerce facts are not verified', async () => {
    // The commerce-readiness gate hides this product from the catalog, but the
    // SSR layer and the admin editor's "Preview" button still serve it. The
    // resolver must return it — this is the exact bug reported on live.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([{ id: 'c1', name: 'Pet Beds', slug: 'pet-beds', is_active: true, sort_order: 0 }]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([
          { id: 'p1', name: 'Dog Bed', slug: 'dog-bed', status: 'active', price: 49.99, category_id: 'c1', inventory_qty: 10, supplier_source: 'KONG Company (official manufacturer)', cost_price: 0 },
        ]));
      }
      if (url.includes('/product_images')) return Promise.resolve(jsonResponse([{ product_id: 'p1', url: 'https://img/bed.jpg', alt_text: 'bed', is_primary: true, sort_order: 0 }]));
      if (url.includes('/product_variants')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    }));
    const p = await loadProductByIdOrSlug('dog-bed');
    expect(p).toBeNull();
  });

  it('resolves a UUID direct lookup when it has no canonical slug match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/categories')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/products')) {
        return Promise.resolve(jsonResponse([{ id: '00000000-0000-4000-8000-000000000009', name: 'Cat Toy', slug: 'cat-toy', status: 'active', price: 4.99, commerce_readiness: 'COMMERCE_READY' }]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    const p = await loadProductByIdOrSlug('00000000-0000-4000-8000-000000000009');
    expect(p?.id).toBe('00000000-0000-4000-8000-000000000009');
  });

  it('returns null for a draft/inactive product (no preview of unpublished rows)', async () => {
    // Emulate the server: the resolver sends status=in.(active,published), so
    // the draft row must NOT match that filter.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const u = new globalThis.URL(url);
      if (u.pathname.endsWith('/products')) {
        const statusOk = u.searchParams.get('status') === 'in.(active,published)';
        return Promise.resolve(statusOk ? jsonResponse([]) : jsonResponse([{ id: 'p3', name: 'Draft', slug: 'draft', status: 'draft', price: 9.99 }]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
    expect(await loadProductByIdOrSlug('draft')).toBeNull();
    expect(await loadProductByIdOrSlug('missing-slug')).toBeNull();
  });

  it('returns null when Supabase is not configured or unreachable (never demo data)', async () => {
    __setDbConfigForTests(null);
    expect(await loadProductByIdOrSlug('dog-bed')).toBeNull();
    __setDbConfigForTests({ url: URL, anonKey: ANON });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await loadProductByIdOrSlug('dog-bed')).toBeNull();
  });
});
