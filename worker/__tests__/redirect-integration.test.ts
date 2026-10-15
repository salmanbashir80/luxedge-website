import { describe, it, expect, afterEach, vi } from 'vitest';
import worker from '../index';

const SHELL = '<!doctype html><div id="root"></div><title>Luxedge</title>';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function call(path: string) {
  const env = {
    ASSETS: {
      fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }),
    } as unknown as import('../seo-meta').SeoEnv['ASSETS'],
  };
  const req = new Request('https://luxedge-production.8002salman.workers.dev' + path);
  return worker.fetch(req, env);
}

describe('worker fetch — legacy path aliases', () => {
  // The storefront footer linked /shipping for months before /shipping-policy
  // became the canonical route, so Google recorded a 404 for every crawl of
  // that link. The alias must stay a permanent redirect, not a 404 and not a
  // second indexable copy of the policy.
  it('/shipping → 301 to the canonical policy URL', async () => {
    const res = await call('/shipping');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://luxedge-production.8002salman.workers.dev/shipping-policy',
    );
  });

  it('/shipping/ resolves the same way as /shipping', async () => {
    const res = await call('/shipping/');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://luxedge-production.8002salman.workers.dev/shipping-policy',
    );
  });

  it('preserves the query string across the alias redirect', async () => {
    const res = await call('/shipping?utm_source=newsletter');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(
      'https://luxedge-production.8002salman.workers.dev/shipping-policy?utm_source=newsletter',
    );
  });

  it('does not redirect the canonical policy URL itself', async () => {
    const res = await call('/shipping-policy');
    expect(res.status).not.toBe(301);
  });
});

describe('worker fetch — legacy UUID product URL redirect', () => {
  it('known UUID param → 301 with slug Location', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/categories') ? [{ id: 'cat-fashion', slug: 'womens-clothing', name: "Women's Clothing" }] : [{ category_id: 'cat-fashion',
      id: '9e1927f7-cde7-46bc-9e14-662dca6c6b3a',
      slug: 'horse-grooming-kit-12-piece', name: 'Horse Grooming Kit',
    }]))));
    const res = await call('/product/9e1927f7-cde7-46bc-9e14-662dca6c6b3a');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toContain('/product/horse-grooming-kit-12-piece');
  });
});
