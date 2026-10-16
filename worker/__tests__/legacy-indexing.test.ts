import { describe, it, expect, afterEach, vi } from 'vitest';
import worker from '../index';
import { CATEGORY_CONTENT } from '../../src/content/categoryContent';
import { setBlogPublicForTesting } from '../../src/content/reviewHolds';

/**
 * Two indexation-hygiene contracts the AdSense review turned up:
 *
 *  1. WordPress-era URL shapes this domain still gets crawled for must 301 to
 *     the homepage — but /category is shared with the live catalogue, so only
 *     a slug the store does NOT publish may be treated as legacy.
 *  2. The public blog is withdrawn from the index (src/content/reviewHolds.ts):
 *     /blog and /blog/<slug> still answer 200 for readers, and carry both the
 *     meta robots tag and the X-Robots-Tag header.
 */
const ORIGIN = 'https://luxedge-production.8002salman.workers.dev';
const SHELL = '<!doctype html><head><title>Luxedge</title>'
  + '<meta name="robots" content="index, follow" /></head><div id="root"></div>';

afterEach(() => {
  setBlogPublicForTesting(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function call(path: string) {
  const env = {
    ASSETS: {
      fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }),
    } as unknown as import('../seo-meta').SeoEnv['ASSETS'],
  };
  return worker.fetch(new Request(ORIGIN + path), env);
}

/** One published post, enough for the blog branches to reach their 200 path. */
function stubBlog() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
    { slug: 'a-guide', title: 'A Guide', excerpt: 'A published guide.', published_at: '2026-09-01', content: 'Body.' },
  ]))));
}

describe('legacy WordPress URLs', () => {
  for (const path of [
    '/trendings', '/trendings/2024/best-pet-beds', '/tag/pets', '/tag/pets/page/2',
    '/wp-content/uploads/2020/01/hero.jpg', '/wp-includes/js/x.js',
    '/category', '/category/uncategorized', '/category/legacy-posts',
    '/index.php', '/feed',
  ]) {
    it(`301s ${path} to the homepage`, async () => {
      const res = await call(path);
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/`);
    });
  }

  it('301s a WordPress post permalink without keeping ?p= (which would loop)', async () => {
    const res = await call('/?p=123');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  it('301s an index.php attachment permalink', async () => {
    const res = await call('/index.php?page_id=9');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  it('never touches a category the store actually publishes', async () => {
    for (const slug of Object.keys(CATEGORY_CONTENT)) {
      const res = await call(`/category/${slug}`);
      expect(res.status, `${slug} must not be redirected`).not.toBe(301);
    }
  });
});

describe('the blog is withdrawn from the index', () => {
  it('answers /blog with 200 and both noindex signals when withdrawn', async () => {
    setBlogPublicForTesting(false);
    stubBlog();
    const res = await call('/blog');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const html = await res.text();
    // The 503 outage branch also sets noindex, so pin the real index title too:
    // otherwise this test would pass while the blog served nothing at all.
    expect(html).toContain('Fashion, Style &amp; Wardrobe Guides');
    expect(html).not.toContain('temporarily unavailable');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('answers /blog/<slug> with 200 and both noindex signals when withdrawn', async () => {
    setBlogPublicForTesting(false);
    stubBlog();
    const res = await call('/blog/a-guide');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const html = await res.text();
    expect(html).toContain('A Guide');
    expect(html).not.toContain('temporarily unavailable');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('answers /blog with 200 and index signals when public', async () => {
    stubBlog();
    const res = await call('/blog');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBeNull();
    const html = await res.text();
    expect(html).toContain('Fashion, Style &amp; Wardrobe Guides');
    expect(html).not.toContain('noindex');
  });

  it('301s an article URL that was published and then removed', async () => {
    stubBlog();
    const res = await call('/blog/essential-supplies-new-puppy');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/blog`);
  });

  it('still 404s an article slug that was never published', async () => {
    stubBlog();
    const res = await call('/blog/never-existed');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('noindex');
  });

  it('leaves the rest of the store indexable', async () => {
    for (const path of ['/about', '/contact', '/returns']) {
      const res = await call(path);
      expect(res.headers.get('x-robots-tag'), path).toBeNull();
      expect(await res.text(), path).toContain('index, follow');
    }
  });
});
