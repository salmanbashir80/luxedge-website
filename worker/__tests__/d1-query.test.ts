// ============================================================================
// Tests for the PostgREST-sub-path → D1 translation layer.
//
// The paths asserted here are the REAL query strings the Worker issues today
// (worker/sitemap.ts, worker/seo-meta.ts), copied verbatim, so a regression in
// the parser fails here rather than silently emptying /shop or the sitemap.
// ============================================================================

import { describe, expect, it } from 'vitest';
import { buildStatement, coerceRow, parsePath, tolerantJson } from '../d1/query';

describe('parsePath — accepts the real Worker read paths', () => {
  it('parses the sitemap product query (in-list + order + limit)', () => {
    const parsed = parsePath(
      'products?select=id,slug,name&status=in.(active,published)&order=slug.asc&limit=500',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.table).toBe('products');
    expect(parsed!.select).toEqual(['id', 'slug', 'name']);
    expect(parsed!.limit).toBe(500);
    expect(parsed!.order).toEqual([{ column: 'slug', dir: 'ASC', nulls: undefined }]);
    expect(parsed!.filters).toEqual([
      { column: 'status', op: 'in', value: ['active', 'published'] },
    ]);
  });

  it('parses the sitemap category query (eq.true boolean)', () => {
    const parsed = parsePath('categories?select=slug,name&is_active=eq.true&order=slug.asc&limit=200');
    expect(parsed).not.toBeNull();
    expect(parsed!.filters).toEqual([{ column: 'is_active', op: 'eq', value: 'true' }]);
  });

  it('parses the published-blog query', () => {
    const parsed = parsePath('blog_posts?select=slug,title&status=eq.published&order=slug.asc&limit=500');
    expect(parsed).not.toBeNull();
    expect(parsed!.filters).toEqual([{ column: 'status', op: 'eq', value: 'published' }]);
  });

  it('parses the base64-guard image filter (not.like prefix)', () => {
    const parsed = parsePath('product_images?select=product_id,url&url=not.like.data:*&limit=2000');
    expect(parsed).not.toBeNull();
    expect(parsed!.filters).toEqual([{ column: 'url', op: 'notlike', value: 'data:' }]);
  });

  it('recognises the products categories(name) embedded relation', () => {
    const parsed = parsePath('products?select=id,slug,categories(name)&limit=10');
    expect(parsed).not.toBeNull();
    expect(parsed!.embedCategoryName).toBe(true);
    expect(parsed!.select).toEqual(['id', 'slug']);
  });

  it('decodes URL-encoded select lists', () => {
    const parsed = parsePath('categories?select=id%2Cname%2Cslug&limit=5');
    expect(parsed!.select).toEqual(['id', 'name', 'slug']);
  });
});

describe('parsePath — refuses anything outside the public read surface', () => {
  it('rejects a table that is not in the D1 read surface (secrets table)', () => {
    expect(parsePath('app_settings?select=key,value&limit=10')).toBeNull();
  });

  it('rejects an unknown table', () => {
    expect(parsePath('definitely_not_a_table?select=id')).toBeNull();
  });

  it('rejects unsupported operators instead of guessing', () => {
    expect(parsePath('products?select=id&price=gt.10')).toBeNull();
  });

  it('rejects SQL-ish identifiers', () => {
    expect(parsePath('products?select=id&order=slug.asc;drop%20table%20products')).toBeNull();
    expect(parsePath('products?select=id&"slug"=eq.x')).toBeNull();
  });

  it('rejects embedded relations other than products→categories(name)', () => {
    expect(parsePath('blog_posts?select=slug,author(name)&limit=5')).toBeNull();
  });
});

describe('buildStatement — always parameterised, never string-concatenated', () => {
  it('binds every value and leaves no literal in the SQL', () => {
    const built = buildStatement('products?select=id&status=in.(active,published)&limit=500');
    expect(built).not.toBeNull();
    expect(built!.sql).not.toContain('active');
    expect(built!.sql).not.toContain('published');
    expect(built!.sql).toContain('?');
    expect(built!.params).toEqual(['active', 'published', 500]);
  });

  it('coerces eq.true/false to the stored 0/1 representation', () => {
    const built = buildStatement('categories?select=id&is_active=eq.true&limit=10');
    expect(built!.params[0]).toBe(1);
  });

  it('builds a LEFT JOIN for products categories(name)', () => {
    const built = buildStatement('products?select=id,categories(name)&limit=10');
    expect(built!.sql).toContain('LEFT JOIN "categories"');
    expect(built!.sql).toContain('__embed_categories_name');
  });

  it('escapes LIKE metacharacters in a prefix filter', () => {
    const built = buildStatement('product_images?select=id&url=not.like.data:*&limit=10');
    expect(built!.sql).toContain('NOT LIKE ?');
    expect(built!.params[0]).toBe('data:%');
  });

  it('caps an oversized limit at the per-invocation ceiling', () => {
    const built = buildStatement('products?select=id&limit=999999');
    expect(built!.params[built!.params.length - 1]).toBe(2000);
  });
});

describe('coerceRow — consumers never see SQLite types', () => {
  it('turns stored 0/1 back into real booleans', () => {
    const row = coerceRow('categories', { id: 'c1', is_active: 1 });
    expect(row.is_active).toBe(true);
    const off = coerceRow('categories', { id: 'c2', is_active: 0 });
    expect(off.is_active).toBe(false);
  });

  it('coerces product_images.is_primary so image ordering keeps working', () => {
    // seo-meta.ts sorts with `Number(b.is_primary === true) - ...`; a leaked
    // integer 1 would evaluate false and silently mis-order every gallery.
    const row = coerceRow('product_images', { id: 'i1', is_primary: 1 });
    expect(row.is_primary).toBe(true);
    expect(Number((row.is_primary as boolean) === true)).toBe(1);
  });

  it('parses JSON text columns back into arrays', () => {
    const row = coerceRow('products', { id: 'p1', features: '["a","b"]' });
    expect(row.features).toEqual(['a', 'b']);
  });

  it('never throws on the heterogeneous live values (comma-separated text)', () => {
    const row = coerceRow('products', {
      id: 'p1',
      features: 'a,b,c',
      specifications: '{not json',
      seo_keywords: '[unclosed',
    });
    expect(row.features).toBe('a,b,c');
    expect(row.specifications).toBe('{not json');
    expect(row.seo_keywords).toBe('[unclosed');
  });

  it('leaves products.tags raw so parseTagList stays the single tags parser', () => {
    const raw = 'horse,grooming,brush,tack,equestrian';
    const row = coerceRow('products', { id: 'p1', tags: raw });
    expect(row.tags).toBe(raw);
  });

  it('rebuilds the embedded categories(name) nested shape', () => {
    const row = coerceRow('products', { id: 'p1', __embed_categories_name: 'Dog Supplies' });
    expect(row.categories).toEqual({ name: 'Dog Supplies' });
    expect('__embed_categories_name' in row).toBe(false);
  });

  it('maps a missing embedded category to null, like PostgREST did', () => {
    const row = coerceRow('products', { id: 'p1', __embed_categories_name: null });
    expect(row.categories).toBeNull();
  });
});

describe('tolerantJson', () => {
  it('parses JSON and passes everything else through untouched', () => {
    expect(tolerantJson('["a"]')).toEqual(['a']);
    expect(tolerantJson('{"k":1}')).toEqual({ k: 1 });
    expect(tolerantJson('plain')).toBe('plain');
    expect(tolerantJson('[broken')).toBe('[broken');
    expect(tolerantJson(null)).toBeNull();
    expect(tolerantJson(7)).toBe(7);
  });
});
