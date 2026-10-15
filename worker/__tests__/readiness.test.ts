import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSitemap } from '../sitemap';
import { maybeInjectSeo } from '../seo-meta';
import { isHeldBlog, isHeldMedia, isHeldProduct, isLinkablePublicPath, isRetiredPublicPath } from '../../src/content/reviewHolds';
import { DEFAULT_CONFIG, isExcludedPath } from '../../src/lib/marketing';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const shell = '<head><title>Luxedge</title><meta name="robots" content="index, follow" /><link rel="canonical" href="https://luxedge.us" /></head><div id="root"></div>';
const env = { ASSETS: { fetch: async () => new Response('{}') } };

describe('editorial release boundaries', () => {
  it('holds only the identified test product and unrelated imported videos', () => {
    expect(isHeldProduct('promo-probe-1788640230930')).toBe(true);
    expect(isHeldProduct('kong-classic-durable-natural-rubber-dog-toy')).toBe(true);
    expect(isHeldProduct('adjustable-nylon-horse-halter-lead-rope')).toBe(true);
    expect(isHeldProduct('horse-grooming-kit-12-piece')).toBe(true);
    expect(isHeldProduct('dog-bed')).toBe(false);
    expect(isHeldMedia('05-05-hollow-crystal-sphere')).toBe(true);
    expect(isHeldMedia('a-reviewed-dog-guide')).toBe(false);
    expect(isHeldBlog('grooming-routine-long-haired-pets')).toBe(true);
  });
  it('returns noindex 404 for held pages even during a database outage', async () => {
    for (const path of ['/product/promo-probe-1788640230930', '/media/05-05-hollow-crystal-sphere', '/blog/grooming-routine-long-haired-pets']) {
      const result = await maybeInjectSeo(shell, path, 'https://luxedge.us', env);
      expect(result).toHaveProperty('status', 404);
      expect(result && 'html' in result && result.html).toContain('noindex');
    }
  });
  it('serves /campaigns/:slug as a noindexed 200 (engine landings, SPA-rendered)', async () => {
    const result = await maybeInjectSeo(shell, '/campaigns/pet-gift-drop', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 200);
    expect(result && 'html' in result && result.html).toContain('noindex');
    expect(result && 'html' in result && result.html).toContain('canonical');
    const missing = await maybeInjectSeo(shell, '/campaigns/not-a-campaign', 'https://luxedge.us', env);
    expect(missing).toHaveProperty('status', 404);
  });
  it('keeps truly unknown routes as real noindex 404s (no homepage soft-404)', async () => {
    const result = await maybeInjectSeo(shell, '/campaigns', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 404);
    expect(result && 'html' in result && result.html).toContain('noindex');
    expect(result && 'html' in result && result.html).toContain('Page Not Found | Luxedge');
  });
  it('keeps media out of organic indexing while rendering its published metadata', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { slug: 'guide', title: 'Published Guide', summary: 'A published video.', youtube_video_id: 'abcdefghijk', thumbnail_url: 'https://example.com/a.jpg' },
    ]))));
    for (const path of ['/media', '/media/guide']) {
      const result = await maybeInjectSeo(shell, path, 'https://luxedge.us', env);
      expect(result).toHaveProperty('status', 200);
      expect(result && 'html' in result && result.html).toContain('noindex, nofollow');
    }
  });
  it('handles /blog/write before the general blog slug lookup', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify([])));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await maybeInjectSeo(shell, '/blog/write', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 200);
    expect(result && 'html' in result && result.html).toContain('noindex, nofollow');
    expect(result && 'html' in result && result.html).toContain('Write | Luxedge');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('excludes utility, nested checkout, search and media routes from both ad modes', () => {
    for (const path of ['/admin', '/checkout/success', '/cart', '/account', '/wishlist', '/blog/write', '/media/example', '/404']) {
      expect(isExcludedPath(path, DEFAULT_CONFIG), path).toBe(true);
    }
    // Shop/category listing pages are owner-approved ad inventory.
    expect(isExcludedPath('/shop', DEFAULT_CONFIG)).toBe(false);
    expect(isExcludedPath('/category/horse', DEFAULT_CONFIG)).toBe(false);
    expect(isExcludedPath('/blog/how-to-choose-a-cat-tunnel', DEFAULT_CONFIG)).toBe(false);
  });
  it('excludes all media URLs while retaining qualified products and published blog URLs', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/categories') ? [{ id: 'cat-fashion', slug: 'womens-clothing', name: "Women's Clothing" }] : url.includes('/products?') ? [
        { slug: 'promo-probe-1788640230930', status: 'active', commerce_readiness: 'COMMERCE_READY' },
        { slug: 'dog-bed', category_id: 'cat-fashion', name: 'Verified Dog Bed', status: 'active', price: 49.99, image_url: 'https://example.test/dog-bed.jpg', description: 'A verified catalog description with enough factual detail for a customer to understand this product before purchasing.', commerce_readiness: 'COMMERCE_READY' },
        { slug: 'kong-classic', name: 'KONG Classic', status: 'active', price: 12.99, image_url: 'https://example.test/kong.jpg', description: 'A factual product description with enough verified catalog detail for a customer to understand the listed item before ordering.', supplier_source: 'KONG Company (official manufacturer)', commerce_readiness: 'COMMERCE_READY' },
      ] : []
    ))));
    const sitemap = await buildSitemap();
    expect(sitemap).toContain('/product/dog-bed');
    expect(sitemap).not.toContain('promo-probe');
    expect(sitemap).not.toContain('/product/kong-classic');
    expect(sitemap).not.toContain('/media');
    expect(sitemap).not.toContain('<lastmod>');
  });
  it('returns noindex 503 rather than a legacy fallback when the CMS is unavailable', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    for (const path of ['/blog', '/blog/retired-article', '/media/example']) {
      const result = await maybeInjectSeo(shell, path, 'https://luxedge.us', env);
      expect(result).toHaveProperty('status', 503);
      expect(result && 'html' in result && result.html).toContain('noindex');
    }
  });
  it('returns a noindex 404 for a declared-ready official-source PDP', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      id: 'kong-1', slug: 'kong-classic', name: 'KONG Classic', status: 'active', price: 12.99,
      image_url: 'https://example.test/kong.jpg',
      description: 'A factual product description with enough verified catalog detail for a customer to understand the listed item before ordering.',
      supplier_source: 'KONG Company (official manufacturer)', commerce_readiness: 'COMMERCE_READY',
    }]))));
    const result = await maybeInjectSeo(shell, '/product/kong-classic', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 404);
    expect(result && 'html' in result && result.html).toContain('noindex');
  });
  it('exposes one linkability contract for every editorial destination', () => {
    // Deleted routes: the September 2026 crawl found a live guide linking both
    // of these from indexable copy.
    expect(isRetiredPublicPath('/blog/dog-car-safety-seat-belt-guide')).toBe(true);
    expect(isRetiredPublicPath('/blog/dog-car-safety-seat-belt-guide/')).toBe(true);
    expect(isRetiredPublicPath('/blog/dog-car-safety-seat-belt-guide#top')).toBe(true);
    expect(isLinkablePublicPath('/blog/dog-car-safety-seat-belt-guide')).toBe(false);
    expect(isLinkablePublicPath('/product/2m-pet-dog-leash-with-soft-padded-handle-highly-reflective-dog-rope-for-night-walking-suitable-for-small-medium-and-large-dogs')).toBe(false);
    // Held products and held articles stay unlinkable too.
    expect(isLinkablePublicPath('/product/kong-classic-durable-natural-rubber-dog-toy')).toBe(false);
    expect(isLinkablePublicPath('/blog/grooming-routine-long-haired-pets')).toBe(false);
    // Real destinations are still linkable.
    expect(isLinkablePublicPath('/product/dog-bed')).toBe(true);
    expect(isLinkablePublicPath('/category/dog-supplies')).toBe(true);
  });
  it('never pre-renders a link to a deleted route, even from stale CMS copy', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      slug: 'guide', title: 'Guide', excerpt: 'excerpt', published_at: '2026-09-01T00:00:00Z',
      content: 'Read the [Car Safety Guide](/blog/dog-car-safety-seat-belt-guide) and the [reflective leash](/product/2m-pet-dog-leash-with-soft-padded-handle-highly-reflective-dog-rope-for-night-walking-suitable-for-small-medium-and-large-dogs), then browse [a live product](/product/dog-bed).',
    }]))));
    const result = await maybeInjectSeo(shell, '/blog/guide', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 200);
    const html = (result && 'html' in result && result.html) || '';
    expect(html).not.toContain('/blog/dog-car-safety-seat-belt-guide');
    expect(html).not.toContain('2m-pet-dog-leash');
    // The sentence survives as plain text; the dead link does not ship.
    expect(html).toContain('Car Safety Guide');
    expect(html).toContain('/product/dog-bed');
  });
  it('serves /copyright as an indexable page with the notice process pre-rendered, and lists it in the sitemap', async () => {
    const result = await maybeInjectSeo(shell, '/copyright', 'https://luxedge.us', env);
    expect(result).toHaveProperty('status', 200);
    const html = (result && 'html' in result && result.html) || '';
    expect(html).toContain('Copyright &amp; DMCA');
    expect(html).toContain('index, follow');
    expect(html).toContain('<link rel="canonical" href="https://luxedge.us/copyright" />');
    // The reporting instructions must be in the crawl HTML, not only in the SPA.
    expect(html).toContain('Copyright Notice');
    expect(html).toContain('hello@luxedge.us');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]))));
    expect(await buildSitemap()).toContain('https://luxedge.us/copyright');
  });
});
