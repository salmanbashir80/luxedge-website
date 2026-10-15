import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maybeInjectSeo } from '../seo-meta';

/**
 * Google must receive real HTML, not a React root waiting for JavaScript.
 *
 * One flat word count is the wrong rule — a product page and the privacy policy
 * legitimately differ — so each page type carries its own floor, and the shell
 * control proves the floors can actually fail: if the empty shell passed, every
 * assertion below would be theatre.
 */
const ORIGIN = 'https://luxedge.us';
// Same shape as the real index.html shell: title, robots, canonical, empty root.
// Mirrors the real index.html head: the injector can only replace tags that
// exist, so a shell missing its description would test the wrong thing.
const SHELL = '<!doctype html><html><head><title>Luxedge</title>'
  + '<meta name="description" content="Shop practical pet and horse essentials at Luxedge." />'
  + '<meta name="robots" content="index, follow" />'
  + '<link rel="canonical" href="https://luxedge.us" /></head>'
  + '<body><div id="root"></div></body></html>';

const env = { ASSETS: { fetch: async () => new Response(SHELL) } };

// The repo's `.env` carries the real Supabase URL, which vitest loads, so a test
// that does not stub it would query the live catalog over the network and cache
// the answer for every later test in this file. Stub it empty by default: these
// pages must serve their own copy whether or not the database answers.
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** Visible text only: markup, scripts and styles cannot pad a word count. */
function visibleWords(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function render(path: string) {
  const res = await maybeInjectSeo(SHELL, path, ORIGIN, env);
  if (!res || !('html' in res)) throw new Error(`${path} did not return HTML`);
  return { status: res.status, html: res.html };
}

// Floors follow the review targets per page type (a policy page is expected to
// carry more text than the contact page), not one flat number.
const CONTENT_PAGES: [string, number][] = [
  ['/', 400],
  ['/about', 400],
  ['/contact', 200],
  ['/faq', 200],
  ['/privacy', 800],
  ['/terms', 600],
  ['/returns', 150],
  ['/shipping-policy', 400],
  ['/copyright', 400],
  ['/editorial-policy', 300],
  ['/disclaimer', 300],
];

describe('server HTML carries substantive content for each page type', () => {
  it('is a shell before injection — the control the floors are measured against', () => {
    expect(visibleWords(SHELL)).toBeLessThan(30);
  });

  for (const [path, floor] of CONTENT_PAGES) {
    it(`${path} pre-renders at least ${floor} words of real text`, async () => {
      const { status, html } = await render(path);
      expect(status).toBe(200);
      const words = visibleWords(html);
      expect(words, `${path} served ${words} visible words`).toBeGreaterThanOrEqual(floor);
      // The body mount point must have been REPLACED, not left waiting for JS.
      expect(html).not.toContain('<div id="ssr-body"></div>');
      expect(html).toMatch(/<h1>/);
    });
  }

  it('gives every content page a title, description and canonical', async () => {
    for (const [path] of CONTENT_PAGES) {
      const { html } = await render(path);
      const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
      const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
      expect(title.length, `${path} title`).toBeGreaterThan(10);
      expect(desc.length, `${path} description`).toBeGreaterThan(40);
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${path === '/' ? '' : path}" />`);
    }
  });

  it('pre-renders a product page from its own facts, not from the shell', async () => {
    // Fresh module instance: the catalog is cached per module for 15 minutes, so
    // the renders above would otherwise answer this request from their own run.
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/categories')) {
        return new Response(JSON.stringify([{ id: 'cat-fashion', slug: 'womens-clothing', name: "Women's Clothing" }]));
      }
      if (String(input).includes('/products')) {
        return new Response(JSON.stringify([{
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'orthopedic-dog-bed-verified',
          category_id: 'cat-fashion',
          name: 'Orthopedic Dog Bed',
          status: 'active',
          description: 'A supportive foam bed for older dogs with stiff joints, sized for medium and large dogs.',
          short_description: 'Supportive memory-foam bed with a removable, washable cover.',
          long_description: 'The cover unzips for washing and the base is a single foam slab.',
          features: ['Removable washable cover', 'Non-slip base'],
          specifications: { Material: 'Memory foam', Size: 'Large' },
          price: 49.95,
          image_url: 'https://cdn.example.com/bed.jpg',
          commerce_readiness: 'COMMERCE_READY',
          supplier_source: 'cj-dropshipping',
          cost_price: 12,
          us_inventory: true,
          stock_status: 'in_stock',
          inventory_qty: 5,
        }]));
      }
      return new Response('[]');
    }));

    const { maybeInjectSeo: fresh } = await import('../seo-meta');
    const res = await fresh(SHELL, '/product/orthopedic-dog-bed-verified', ORIGIN, env);
    if (!res || !('html' in res)) throw new Error('product page did not return HTML');
    const { status, html } = res;
    expect(status).toBe(200);
    const words = visibleWords(html);
    expect(words, `product page served ${words} visible words`).toBeGreaterThanOrEqual(60);
    expect(html).toContain('Orthopedic Dog Bed');
    expect(html).not.toContain('<div id="ssr-body"></div>');
  });
});
