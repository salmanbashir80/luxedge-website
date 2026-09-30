import { describe, expect, it } from 'vitest';
import { maybeInjectSeo } from '../seo-meta';
import { STATIC_ROUTES } from '../sitemap';

const shell =
  '<head><title>Luxedge</title><meta name="robots" content="index, follow" /><link rel="canonical" href="https://luxedge.us" /></head><body><div id="ssr-body"></div><div id="root"></div></body>';
const origin = 'https://luxedge.us';
const env = { ASSETS: { fetch: async () => new Response('{}') } } as never;

/**
 * /blog and /sitemap are excluded: both read the CMS, and with no database
 * reachable they deliberately answer 503 / fall back rather than 200. That
 * honest degradation is covered by emergency-sitemap.test.ts instead.
 */
const DB_FREE = STATIC_ROUTES.filter((r) => r.href !== '/blog' && r.href !== '/sitemap');

/**
 * Every page the client routes to must also be served as 200 by the worker.
 *
 * The two route tables are maintained in different files (src/App.tsx and
 * worker/seo-meta.ts), so a page can exist as a live client route and still
 * fall through the worker's own trailing 404 branch. /careers did exactly that:
 * CareersPage rendered fine after hydration, but crawlers and any cold visit
 * got a 404 because STATIC_PAGES had no '/careers' key, which meant
 * injectCareersBody() was unreachable. These assertions fail the moment that
 * class of drift comes back.
 */
describe('static pages are actually served', () => {
  it.each(DB_FREE.map((r) => r.href))('%s answers 200 rather than the catch-all 404', async (href) => {
    const res = await maybeInjectSeo(shell, href, origin, env);
    expect(res).not.toBeNull();
    expect(res && 'status' in res ? res.status : null).toBe(200);
  });

  it('/careers pre-renders its body instead of an empty shell', async () => {
    const res = await maybeInjectSeo(shell, '/careers', origin, env);
    const html = res && 'html' in res ? res.html : '';
    expect(html).toContain('Careers at Luxedge');
    // The real page's one internal link, so the pre-render is not a dead end.
    expect(html).toContain('href="/contact"');
  });

  it('every pre-rendered static page carries a canonical and no stray noindex', async () => {
    for (const { href } of DB_FREE) {
      const res = await maybeInjectSeo(shell, href, origin, env);
      const html = res && 'html' in res ? res.html : '';
      // The homepage canonical is emitted without a trailing slash, so compare
      // the path portion rather than assuming origin + href verbatim.
      const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
      expect(canonical, href).toBeDefined();
      expect(new URL(canonical!).pathname, href).toBe(href === '/' ? '/' : href);
      expect(canonical!.startsWith(origin), href).toBe(true);
      expect(html, href).not.toContain('name="robots" content="noindex, nofollow"');
    }
  });

  it('a genuinely unknown path still 404s, so the guard above is not vacuous', async () => {
    const res = await maybeInjectSeo(shell, '/not-a-real-page', origin, env);
    expect(res && 'status' in res ? res.status : null).toBe(404);
  });
});
