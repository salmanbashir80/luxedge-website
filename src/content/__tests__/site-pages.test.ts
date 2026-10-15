// ============================================================================
// LUXEDGE — homepage / contact-page content contract
//
// sitePages.ts exists to lift the two thinnest pages the AdSense report named
// (homepage, /contact) above "Low value content" WITHOUT inventing a fact: no
// delivery window, carrier, handling time, dimension or certification that the
// policy pages and the catalogue do not already publish.
//
// The suite is the guard rail on five things:
//
//   1. Both pages are substantive (word floors), and no section is a stub.
//   2. Nothing here asserts a claim we cannot evidence — same class of wording
//      the AdSense policy and our own crawl claim-scan reject.
//   3. Every number is one the policy pages already publish.
//   4. Every reused FAQ/shipping/return fact still matches the page that owns
//      it, so the same question cannot be answered two different ways.
//   5. BOTH renderers — the worker pre-render and the React page — are driven
//      from this file, asserted by actually rendering each and comparing.
//      Crawl-vs-visitor divergence has already shipped twice on this site.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { HOME_SECTIONS, HOME_FAQ, CONTACT_SECTIONS } from '../sitePages';
import type { SiteFaqItem, SiteSection } from '../sitePages';
import { SHIPPING_SECTIONS, RETURNS_SECTIONS, FAQ_DATA } from '../policies';
import { CATEGORY_CONTENT } from '../categoryContent';
import { SiteSections, SiteFaq } from '../../components/SiteContent';
import { injectHomeBody, injectContactBody } from '../../../worker/seo-meta';

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function pageParts(sections: SiteSection[], faq: SiteFaqItem[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    out.push(s.heading, ...(s.paragraphs || []), ...(s.bullets || []), ...(s.links || []).map((l) => l.label));
  }
  for (const f of faq) out.push(f.q, f.a);
  return out;
}

const HOME_PARTS = pageParts(HOME_SECTIONS, HOME_FAQ);
// The contact page deliberately has no FAQ block — its sections answer the
// contact questions and /faq owns the long-form answers (faq-source test).
const CONTACT_PARTS = pageParts(CONTACT_SECTIONS, []);
const countWords = (parts: string[]) => parts.reduce((n, p) => n + words(p), 0);

/** Undo HTML entity escaping so a rendered page can be compared to the source. */
const decode = (html: string) => html
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#(?:0?39|x27);|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ');

const render = (node: ReactElement) => decode(renderToStaticMarkup(createElement(MemoryRouter, null, node)));

// ---------------------------------------------------------------------------
// Claim guard (same shape as the product-content suite: a disclaimer is not a
// claim, so a negated sentence passes and an asserted one fails).
// ---------------------------------------------------------------------------
const NEGATION = /\b(?:not|never|no|isn't|is not|does not|doesn't|cannot|can't|without|rather than|instead)\b/i;

const BANNED: Array<[string, RegExp]> = [
  ['certification', /certipur|airline[- ]approved|fda[- ]approved|iso[- ]certified|\bcertified\b/i],
  ['crash test', /crash[- ]test|crash[- ]rated/i],
  ['medical or vet claim', /veterinar|vet[- ]?(?:reviewed|approved|recommended|endorsed)|medical[- ]grade|therapeutic|\bcures?\b|medically (?:proven|tested)|\btreats?\s+(?:arthritis|pain|disease|infection|anxiety)/i],
  ['degradation timeline', /\b\d+\s*(?:days?|months?|years?)\b(?=[^.]*biodegrad)/i],
  ['guarantee', /100% (?:safe|guaranteed|effective)|guaranteed to/i],
  ['decibel figure', /\b\d+\s*(?:db|dba)\b/i],
  ['load rating', /\b\d+\s?(?:lb|lbs|kg)\s+(?:load|capacity|rating)\b/i],
];

function assertNoAssertedClaims(page: string, text: string): void {
  for (const sentence of text.split(/(?<=[.!?;:])\s*/).filter(Boolean)) {
    for (const [label, re] of BANNED) {
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      for (const match of sentence.matchAll(global)) {
        if (NEGATION.test(sentence.slice(0, match.index))) continue;
        expect.fail(`${page}: ${label} asserted → "${match[0]}" in: ${sentence.trim()}`);
      }
    }
  }
}

/** Longest run of consecutive words two strings share — a padding smell guard. */
function longestSharedRun(a: string, b: string): number {
  const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const A = tokens(a);
  const B = tokens(b);
  let best = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      let len = 0;
      while (i + len < A.length && j + len < B.length && A[i + len] === B[j + len]) len++;
      if (len > best) best = len;
    }
  }
  return best;
}

describe('homepage / contact copy — substance', () => {
  it('adds real depth to both pages the AdSense report named', () => {
    // Measured before this change: homepage 131 words, /contact 112.
    expect(countWords(HOME_PARTS)).toBeGreaterThan(600);
    expect(countWords(CONTACT_PARTS)).toBeGreaterThan(300);
  });

  it('every section has a heading and at least one substantive block', () => {
    for (const [page, sections] of [['home', HOME_SECTIONS], ['contact', CONTACT_SECTIONS]] as const) {
      const seen = new Set<string>();
      for (const s of sections) {
        expect(s.heading.length, `${page}: heading`).toBeGreaterThan(8);
        expect(seen.has(s.heading), `${page}: duplicate heading ${s.heading}`).toBe(false);
        seen.add(s.heading);
        const blocks = (s.paragraphs?.length || 0) + (s.bullets?.length || 0);
        expect(blocks, `${page}: "${s.heading}" has no body`).toBeGreaterThan(0);
        for (const p of s.paragraphs || []) expect(p.length, `${page}: short paragraph in "${s.heading}"`).toBeGreaterThan(110);
        for (const b of s.bullets || []) expect(b.length, `${page}: short bullet in "${s.heading}"`).toBeGreaterThan(55);
      }
    }
  });

  it('does not pad a page by repeating itself, and a FAQ answer never restates a section', () => {
    for (const [page, sections, faq] of [
      ['home', HOME_SECTIONS, HOME_FAQ],
      ['contact', CONTACT_SECTIONS, []],
    ] as const) {
      const bodies = sections.flatMap((s) => [...(s.paragraphs || []), ...(s.bullets || [])]);
      for (const f of faq) {
        for (const body of bodies) {
          expect(longestSharedRun(f.a, body), `${page}: FAQ "${f.q}" restates a section:\n  ${body}`).toBeLessThan(8);
        }
      }
      for (let i = 0; i < faq.length; i++) {
        for (let j = i + 1; j < faq.length; j++) {
          expect(longestSharedRun(faq[i].a, faq[j].a), `${page}: two FAQ answers overlap`).toBeLessThan(8);
        }
      }
    }
    for (const a of HOME_PARTS) {
      for (const b of CONTACT_PARTS) {
        expect(longestSharedRun(a, b), `home and contact copy overlap:\n  ${a}\n  ${b}`).toBeLessThan(10);
      }
    }
  });
});

describe('homepage / contact copy — honesty', () => {
  it('never asserts a claim the store cannot evidence', () => {
    for (const part of HOME_PARTS) assertNoAssertedClaims('home', part);
    for (const part of CONTACT_PARTS) assertNoAssertedClaims('contact', part);
  });

  it('the claim guard tells a disclaimer from a claim', () => {
    assertNoAssertedClaims('t', 'It is not a veterinary service.');
    assertNoAssertedClaims('t', 'We cannot give veterinary or medical advice.');
    assertNoAssertedClaims('t', 'Speak to a vet or a feed adviser about your animal\u2019s diet.');
    expect(() => assertNoAssertedClaims('t', 'Our vet-reviewed food treats arthritis.')).toThrow();
    expect(() => assertNoAssertedClaims('t', 'The carrier is airline-approved.')).toThrow();
  });

  it('publishes only numbers the policy pages already publish', () => {
    // 30-day return window, 2-hour cancellation window, 24-hour reply time,
    // 9AM-6PM CT support hours, the published business postal code, and the
    // restored public support phone number.
    const allowed = new Set(['30', '2', '24', '9', '6', '80203', '1500', '440', '941', '8002']);
    for (const [page, parts] of [['home', HOME_PARTS], ['contact', CONTACT_PARTS]] as const) {
      for (const part of parts) {
        for (const m of part.matchAll(/\b\d+\b/g)) {
          expect(allowed.has(m[0]), `${page}: unpinned number "${m[0]}" in: ${part}`).toBe(true);
        }
      }
    }
  });

  it('every reused shipping / return / FAQ fact still matches the page that owns it', () => {
    const policyText = [...SHIPPING_SECTIONS, ...RETURNS_SECTIONS].map((s) => s.body).join('\n');
    // FAQ_DATA is now the only FAQ copy on the site — the React page reads it
    // too, so there is no second source left to disagree with.
    const faqText = FAQ_DATA.flatMap((c) => c.items.map((i) => `${i.q} ${i.a}`)).join('\n');
    const ourFaq = HOME_FAQ.map((f) => f.a).join('\n');

    // Only the facts THIS module still reuses. Cancellations, address changes
    // and order tracking moved back to /faq (the contact page used to restate
    // them, which duplicated /faq on a second indexed URL); their consistency is
    // pinned by the faq-source suite, which owns FAQ_DATA.
    const pins: Array<[string, string]> = [
      ['express shipping', 'Express shipping is not currently offered unless it is specifically shown as an option at checkout'],
      ['warranty coverage', 'Warranty coverage varies by product and manufacturer'],
    ];
    for (const [label, phrase] of pins) {
      const ownerHas = policyText.includes(phrase) || faqText.includes(phrase);
      expect(ownerHas, `${label}: the owning page no longer says "${phrase}"`).toBe(true);
      expect(ourFaq.includes(phrase), `${label}: our copy drifted from "${phrase}"`).toBe(true);
    }
  });

  it('links only to routes that exist', () => {
    const literals = new Set(['/', '/shop', '/blog', '/faq', '/sitemap', '/contact', '/orders', '/about', '/privacy', '/terms', '/returns', '/shipping-policy', '/copyright', '/cart']);
    const categorySlugs = new Set(Object.keys(CATEGORY_CONTENT));
    const hrefs: string[] = [];
    for (const sections of [HOME_SECTIONS, CONTACT_SECTIONS]) {
      for (const s of sections) for (const l of s.links || []) hrefs.push(l.href);
    }
    expect(hrefs.length).toBeGreaterThan(12);
    for (const href of hrefs) {
      if (href.startsWith('/category/')) {
        expect(categorySlugs.has(href.replace('/category/', '')), `unknown collection: ${href}`).toBe(true);
      } else {
        expect(literals.has(href), `unknown route: ${href}`).toBe(true);
      }
    }
  });
});

describe('homepage / contact copy — renderer parity', () => {
  const homeHtml = injectHomeBody('<div id="ssr-body"></div>');
  const contactHtml = injectContactBody('<div id="ssr-body"></div>');
  const homeNode = createElement('div', null,
    createElement(SiteSections, { sections: HOME_SECTIONS }),
    createElement(SiteFaq, { items: HOME_FAQ }),
  ) as ReactElement;
  const contactNode = createElement('div', null,
    createElement(SiteSections, { sections: CONTACT_SECTIONS }),
  ) as ReactElement;

  it.each([['home', HOME_PARTS], ['contact', CONTACT_PARTS]] as const)(
    'the worker pre-renders every %s string into the crawl HTML',
    (page, parts) => {
      // Decoded, because the worker HTML-escapes "&" and quotes on the way in.
      const html = decode(page === 'home' ? homeHtml : contactHtml);
      for (const part of parts) {
        expect(html.includes(part), `${page}: crawl HTML is missing: ${part}`).toBe(true);
      }
    },
  );

  it.each([['home', HOME_PARTS, homeNode], ['contact', CONTACT_PARTS, contactNode]] as const)(
    'the hydrated %s page renders the same strings the crawler gets',
    (page, parts, node) => {
      const markup = render(node);
      for (const part of parts) {
        expect(markup.includes(part), `${page}: hydrated DOM is missing: ${part}`).toBe(true);
      }
    },
  );

  it('the crawl HTML and the hydrated page link to the same destinations', () => {
    for (const [page, html, node] of [['home', homeHtml, homeNode], ['contact', contactHtml, contactNode]] as const) {
      const markup = render(node);
      const from = (s: string) => new Set([...s.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]));
      const crawl = from(html);
      const hydrated = from(markup);
      for (const href of hydrated) {
        expect(crawl.has(href), `${page}: ${href} is linked on the hydrated page but not in the crawl HTML`).toBe(true);
      }
      expect(hydrated.size).toBeGreaterThan(2);
    }
  });

  it('both pages are wired to this one module, not to a private copy', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const worker = readFileSync('worker/seo-meta.ts', 'utf8');
    for (const needle of [
      '<SiteSections sections={HOME_SECTIONS} />',
      '<SiteFaq items={HOME_FAQ} />',
      '<SiteSections sections={CONTACT_SECTIONS} />',
    ]) {
      expect(app.includes(needle), `App.tsx missing: ${needle}`).toBe(true);
    }
    for (const needle of [
      'renderSiteSections(HOME_SECTIONS)',
      'renderSiteFaq(HOME_FAQ)',
      'renderSiteSections(CONTACT_SECTIONS)',
    ]) {
      expect(worker.includes(needle), `worker/seo-meta.ts missing: ${needle}`).toBe(true);
    }
    // The contact page's FAQ block is gone on BOTH sides — neither renderer may
    // keep a copy, or the duplication the faq-source suite forbids returns.
    expect(app.includes('CONTACT_FAQ')).toBe(false);
    expect(worker.includes('CONTACT_FAQ')).toBe(false);
  });

  it('gives the homepage FAQ the same heading in the crawl HTML and the hydrated DOM', () => {
    // A heading that only exists on one side is exactly how the two copies
    // silently diverge, so it is pinned literally.
    expect(homeHtml).toContain('<h2>Common questions</h2>');
    expect(render(homeNode)).toContain('Common questions');
  });
});
