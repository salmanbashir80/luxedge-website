import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { buildEmergencyStaticSitemap, EMERGENCY_STATIC_HREFS } from '../sitemap';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const SHELL = '<!doctype html><div id="root"></div><title>Luxedge</title>';
const ENV = {
  ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }) },
} as unknown as Parameters<typeof worker.fetch>[1];

async function callSitemap(): Promise<Response> {
  return worker.fetch(new Request('https://luxedge.us/sitemap.xml'), ENV);
}

/** Pathnames of every <loc> in a sitemap XML document. */
function locPaths(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1].trim()).pathname);
}

const PRODUCT = {
  id: 'p1', slug: 'dog-bed', name: 'Verified Dog Bed', status: 'active', price: 49.99,
  description: 'A verified catalog description with enough factual detail for a customer to understand this product before purchasing.',
  image_url: 'https://example.test/dog-bed.jpg', commerce_readiness: 'COMMERCE_READY',
};

describe('sitemap.xml — dynamic vs emergency mode', () => {
  it('serves the live DB-derived sitemap with mode=dynamic when the database is healthy', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/products?')) return new Response(JSON.stringify([PRODUCT]));
      if (url.includes('/rest/v1/categories?')) return new Response(JSON.stringify([{ slug: 'dog-supplies', name: 'Dog supplies' }]));
      if (url.includes('/rest/v1/blog_posts?')) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify([]));
    }));
    const res = await callSitemap();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('x-luxedge-sitemap-mode')).toBe('dynamic');
    const paths = locPaths(await res.text());
    expect(paths).toContain('/');
    expect(paths).toContain('/product/dog-bed');
    expect(paths).toContain('/category/dog-supplies');
  });

  it('serves a valid HTTP 200 emergency sitemap when the database is unavailable (empty config)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await callSitemap();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('x-luxedge-sitemap-mode')).toBe('emergency');
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(locPaths(xml).length).toBe(12);
  });

  it('serves the emergency sitemap when DB fetches fail at request time', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('503 quota restricted'); }));
    const res = await callSitemap();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-luxedge-sitemap-mode')).toBe('emergency');
  });

  it('emergency sitemap excludes the database-dependent /shop and all /blog URLs', () => {
    const paths = locPaths(buildEmergencyStaticSitemap());
    expect(paths).not.toContain('/shop');
    expect(paths.filter((p) => p === '/blog' || p.startsWith('/blog/'))).toEqual([]);
  });

  it('emergency sitemap excludes every /product/* URL, held or not', () => {
    const paths = locPaths(buildEmergencyStaticSitemap());
    expect(paths.filter((p) => p.startsWith('/product/'))).toEqual([]);
  });

  it('emergency sitemap excludes every /category/* URL', () => {
    const paths = locPaths(buildEmergencyStaticSitemap());
    expect(paths.filter((p) => p.startsWith('/category/'))).toEqual([]);
  });

  it('emergency sitemap contains exactly the confirmed static pages (homepage, sitemap, legal set)', () => {
    const paths = locPaths(buildEmergencyStaticSitemap());
    expect([...paths].sort()).toEqual([
      '/', '/about', '/contact', '/copyright', '/disclaimer', '/editorial-policy',
      '/faq', '/privacy', '/returns', '/shipping-policy', '/sitemap', '/terms',
    ].sort());
    expect(paths).toContain('/');
    expect(paths).toContain('/privacy');
    expect(EMERGENCY_STATIC_HREFS).not.toContain('/shop');
    expect(xmlEscapeProof()).toBe(true);
  });

  it('robots.txt keeps pointing crawlers at /sitemap.xml across both modes', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toContain('Sitemap: https://luxedge.us/sitemap.xml');
  });
});

/** The builder derives hrefs from STATIC_ROUTES — confirm no escaping surprises. */
function xmlEscapeProof(): boolean {
  const xml = buildEmergencyStaticSitemap();
  return !xml.includes('&') && !xml.includes('<lastmod>');
}
