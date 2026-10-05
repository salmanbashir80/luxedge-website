import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIVACY_SECTIONS } from '../policies';
import { maybeInjectSeo } from '../../../worker/seo-meta';

/**
 * AdSense consent pipeline regressions (EEA/UK/Switzerland readiness).
 *
 * Google requires two things of sites serving ads in the EEA/UK/Switzerland:
 *   1. Consent Mode v2 signals (ad_storage, ad_user_data, ad_personalization,
 *      analytics_storage) must DEFAULT TO DENIED before any Google tag loads.
 *   2. The ad script must not personalize or read/write ad cookies without
 *      consent, and EEA traffic must run under a Google-certified CMP.
 *
 * The pipeline implemented here:
 *   shell <head> bootstrap  → sets denied defaults before any Google tag
 *   src/lib/consent.ts      → module-init defaults + decision sync
 *   src/lib/marketing.ts    → loadAdSenseScript refuses to load without
 *                             'accepted' and removes any existing tag
 *   MarketingManager        → re-syncs signals and removes the shell tag when
 *                             consent is missing/declined
 *   CookieConsent           → the single first-party consent surface
 *
 * A Google-certified CMP, once connected, must drive the SAME signals in
 * src/lib/consent.ts — these tests guard the contract it has to keep.
 *
 * The disclosure half of that contract is pinned in REQUIRED_DISCLOSURE below:
 * the facts the policy has to state, checked against PRIVACY_SECTIONS — the one
 * array the visitor page and the crawl HTML both render — and against the
 * worker's pre-rendered /privacy output, which is what a reviewer without
 * JavaScript actually reads.
 */

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

const CONSENT_SIGNALS = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];

/**
 * The sentences Google's ad review and the EEA/UK/Switzerland consent rules
 * expect to find published. Pinned as literals rather than derived from the
 * array, because an assertion built from the copy it is checking would pass
 * after every sentence is deleted: each entry below maps to a separate claim, so
 * dropping one fails here instead of quietly shrinking the published policy.
 */
const REQUIRED_DISCLOSURE = [
  // AdSense is named as the ad technology, and the vendor section exists.
  'AdSense',
  'Advertising and Third-Party Vendors',
  // Consent Mode v2 is named with all four signal categories it governs.
  'Consent Mode',
  'advertising storage, advertising personalization, advertising measurement, and analytics storage',
  // The signals default to denied and stay denied until the visitor accepts.
  'remain denied until you accept',
  'not to read or write advertising cookies while they are denied',
  // The visitor-controlled opt-out and Google's own partner-sites policy.
  'https://adssettings.google.com',
  'https://policies.google.com/technologies/partner-sites',
  // The EEA/UK/Switzerland certification requirement, and consent preceding
  // any personalized advertising.
  'certification requirements',
  'European Economic Area, the United Kingdom, and Switzerland',
  'personalized or non-personalized depending on your consent and your region',
  'collected before personalized advertising runs',
];

// The worker entity-escapes quotes and ampersands on the way into the HTML, so
// decode before comparing against the copy above (as faq-source.test.ts does).
const decode = (html: string) => html
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ');

const ORIGIN = 'https://luxedge.us';
// Same shape as the real index.html shell: inject() can only fill the mount
// points it is given, so a shell without #root would test the wrong thing.
const SHELL = '<!doctype html><html><head><title>Luxedge</title>'
  + '<meta name="description" content="Shop practical pet and horse essentials at Luxedge." />'
  + '<meta name="robots" content="index, follow" />'
  + '<link rel="canonical" href="https://luxedge.us" /></head>'
  + '<body><div id="root"></div></body></html>';
const env = { ASSETS: { fetch: async () => new Response(SHELL) } };

// The repo's .env carries the real Supabase project, which vitest loads; stub it
// empty so this render can never answer from the live catalog.
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function disclosureText(): string {
  return PRIVACY_SECTIONS.map((s) => `${s.title}\n${s.body}`).join('\n\n');
}

describe('AdSense consent pipeline (Consent Mode v2)', () => {
  it('shell <head> sets denied defaults before the publisher script tag', () => {
    const html = read('index.html');
    const bootstrap = html.indexOf("gtag('consent', 'default'");
    const scriptTag = html.indexOf('adsbygoogle-script');
    expect(bootstrap, 'shell must carry a consent-default bootstrap').toBeGreaterThan(-1);
    expect(scriptTag).toBeGreaterThan(-1);
    expect(bootstrap).toBeLessThan(scriptTag);
    for (const signal of CONSENT_SIGNALS) {
      expect(html).toContain(`${signal}: 'denied'`);
    }
  });

  it('consent.ts defaults to denied and syncs the decision', () => {
    const src = read('src/lib/consent.ts');
    for (const signal of CONSENT_SIGNALS) {
      expect(src).toContain(`${signal}: 'denied'`);
      expect(src).toContain(`${signal}: 'granted'`);
    }
    expect(src).toContain("w.gtag('consent', 'default', state)");
  });

  it('loadAdSenseScript refuses to load without accepted consent and cleans up', () => {
    const src = read('src/lib/marketing.ts');
    const fn = src.slice(src.indexOf('export function loadAdSenseScript'), src.indexOf('export function removeAdSenseScript'));
    expect(fn).toContain("getConsent() !== 'accepted'");
    expect(fn).toContain('removeAdSenseScript()');
  });

  it('MarketingManager re-syncs consent signals and removes the shell tag when unconsented', () => {
    const src = read('src/components/MarketingManager.tsx');
    expect(src).toContain('syncConsentMode(getConsent())');
    expect(src).toContain('removeAdSenseScript()');
  });

  it('keeps exactly one consent surface and one decision store', () => {
    // One banner component; the Consent Mode plumbing lives in lib/consent.ts,
    // not duplicated in the component or a second storage key.
    expect(read('src/components/CookieConsent.tsx')).toContain("import { getConsent, setConsent } from '../lib/consent'");
    const consentSrc = read('src/lib/consent.ts');
    expect(consentSrc.match(/CONSENT_KEY = '/g)?.length).toBe(1);
  });

  it('PRIVACY_SECTIONS keeps the AdSense / Consent Mode v2 disclosure', () => {
    const copy = disclosureText();
    for (const phrase of REQUIRED_DISCLOSURE) {
      expect(copy, `PRIVACY_SECTIONS no longer states: "${phrase}"`).toContain(phrase);
    }
  });

  it('pre-renders that disclosure into the /privacy crawl HTML', async () => {
    const res = await maybeInjectSeo(SHELL, '/privacy', ORIGIN, env);
    expect(res, '/privacy did not resolve to HTML').not.toBeNull();
    if (!res || !('html' in res)) throw new Error('/privacy did not return HTML');
    expect(res.status).toBe(200);

    const html = decode(res.html);
    // Injection really happened: the mount point was replaced by the article,
    // so a missing disclosure below is a content failure, not an empty shell.
    expect(html).toContain('<h1>Privacy Policy</h1>');
    expect(html).not.toContain('<div id="ssr-body"></div>');

    const start = html.indexOf('<article>');
    const end = html.indexOf('</article>');
    expect(start, 'no <article> in the pre-rendered /privacy').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = html.slice(start, end);

    for (const phrase of REQUIRED_DISCLOSURE) {
      expect(body, `pre-rendered /privacy no longer states: "${phrase}"`).toContain(phrase);
    }
    // The vendor section must still be a heading a crawler can parse, not a
    // paragraph that merely contains the words.
    expect(body).toContain('<h2>Advertising and Third-Party Vendors</h2>');
    expect(body).toContain('<h2>Cookies and Analytics</h2>');
  });

  it('ads.txt keeps the verified publisher line', () => {
    expect(read('public/ads.txt')).toContain('google.com, pub-5473713135927706, DIRECT, f08c47fec0942fa0');
  });
});
