import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATEGORY_CONTENT, categoryContentFor } from '../categoryContent';
import { isLinkablePublicPath, setBlogPublicForTesting } from '../reviewHolds';

/** The twelve USA Fashion categories (src/content/categoryContent.ts is the source of truth). */
const CATEGORY_SLUGS = [
  'womens-clothing', 'mens-clothing', 'dresses-and-tops', 'jeans-and-pants', 'jackets-and-outerwear',
  'sneakers-and-shoes', 'handbags-and-wallets', 'jewelry', 'watches', 'sunglasses-and-accessories',
  'lingerie-and-intimates', 'makeup-and-beauty',
];

/** public/blog-seo.json is the offline snapshot of the PUBLISHED CMS corpus. */
const publishedBlogSlugs = (
  JSON.parse(readFileSync('public/blog-seo.json', 'utf8')) as { posts: { slug: string }[] }
).posts.map((p) => p.slug);

describe('category content', () => {
  it('covers every live category with a real intro and usable considerations', () => {
    for (const slug of CATEGORY_SLUGS) {
      const c = CATEGORY_CONTENT[slug];
      expect(c, slug).toBeTruthy();
      expect(c.desc.length, slug).toBeGreaterThan(20);
      expect(c.considerations.length, `${slug} considerations`).toBeGreaterThanOrEqual(2);
      for (const item of c.considerations) {
        // A short bullet is filler; these must carry actual guidance.
        expect(item.length, `${slug}: "${item}"`).toBeGreaterThan(50);
      }
    }
  });

  it('advertises only guide links a reader can actually open', () => {
    // The raw data still names the guides, but the lookup is the gate: a
    // category page must never render a link to a retired or held URL, which is
    // what the reader would otherwise click into a redirect.
    for (const slug of Object.keys(CATEGORY_CONTENT)) {
      const resolved = categoryContentFor(slug)!;
      for (const g of resolved.guides) {
        expect(g.href.startsWith('/blog/'), `${slug} -> ${g.href}`).toBe(true);
        expect(publishedBlogSlugs, `${slug} -> ${g.href}`).toContain(g.href.replace('/blog/', ''));
        // And whatever survives the filter must satisfy the same rule the
        // markdown linker uses.
        expect(isLinkablePublicPath(g.href), `${slug} -> ${g.href}`).toBe(true);
      }
      expect(resolved.considerations).toEqual(CATEGORY_CONTENT[slug].considerations);
    }
  });

  it('drops the guide list entirely while the guides are withdrawn', () => {
    // The live CMS holds no published posts, so every guide href in these
    // modules is retired and the lookup must return none of them.
    setBlogPublicForTesting(false);
    try {
      for (const slug of Object.keys(CATEGORY_CONTENT)) {
        expect(categoryContentFor(slug)!.guides, slug).toEqual([]);
      }
    } finally {
      setBlogPublicForTesting(null);
    }
  });

  it('resolves by display name as well as by slug (the client passes a name)', () => {
    expect(categoryContentFor("Women's Clothing")?.desc).toBe(CATEGORY_CONTENT['womens-clothing'].desc);
    expect(categoryContentFor('Jewelry')?.desc).toBe(CATEGORY_CONTENT['jewelry'].desc);
    expect(categoryContentFor('All')).toBeNull();
  });

  it('is the single source for both the client and the pre-rendered category page', () => {
    // Guards against the previous duplicated maps (CAT_META / CATEGORY_DESC)
    // drifting apart again — that duplication is what this module replaced.
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("from './content/categoryContent'");
    expect(readFileSync('worker/seo-meta.ts', 'utf8')).toContain("from '../src/content/categoryContent'");
  });

  it('makes no certification, safety, medical or performance claims', () => {
    const all = Object.values(CATEGORY_CONTENT).flatMap((c) => [c.desc, ...c.considerations]).join(' ');
    for (const bad of [
      /\bairline[- ]approved\b/i, /\bcertified\b/i, /\bcures?\b/i, /\bguarantee/i,
      /\bnon[- ]toxic\b/i, /\b\d+\s?dB\b/i, /\bUV[- ]?(protection|resistant)\b/i, /\bcrash[- ]tested\b/i,
    ]) {
      expect(all).not.toMatch(bad);
    }
  });
});
