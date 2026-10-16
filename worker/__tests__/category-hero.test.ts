// ============================================================================
// LUXEDGE — worker category header pet-hero image contract
//
// The category page header now shows a pet image related to the category in
// the middle of the header (text left, image center, ad right). These tests
// pin that the SERVER-RENDERED category body emits the matching editorial pet
// image for known categories, and never invents an image for an unknown one.
// The client side renders the same map (CAT_HERO_IMAGES in src/App.tsx).
// ============================================================================

import { describe, expect, it } from 'vitest';
import { injectCategoryBody, type CategoryRow, type ProductRow } from '../seo-meta';
import { setBlogPublicForTesting } from '../../src/content/reviewHolds';

const cat = (name: string, slug: string): CategoryRow => ({ name, slug });

function wrap(c: CategoryRow, products: ProductRow[] = []): string {
  // Matches the production shell: inject() pre-fills #root with the SSR body
  // mount point (PR #110 footer-nav change), which route injectors replace.
  return injectCategoryBody('<div id="root"><div id="ssr-body"></div></div>', c, products);
}

describe('injectCategoryBody — category fashion hero image', () => {
  it('emits the matching fashion image for a known category (Women\'s Clothing)', () => {
    const html = wrap(cat("Women's Clothing", 'womens-clothing'));
    expect(html).toContain('<img src="/images/fashion/women-clothing.jpg" alt="Women&#39;s Clothing essentials" />');
  });

  it('emits the matching fashion image for Men\'s Clothing', () => {
    const html = wrap(cat("Men's Clothing", 'mens-clothing'));
    expect(html).toContain('/images/fashion/men-clothing.jpg');
    expect(html).toContain('alt="Men&#39;s Clothing essentials"');
  });

  it('emits the matching fashion image for Dresses and Lingerie', () => {
    expect(wrap(cat('Dresses and Tops', 'dresses-and-tops'))).toContain('/images/fashion/dresses-tops.jpg');
    expect(wrap(cat('Lingerie & Intimates', 'lingerie-and-intimates'))).toContain('/images/fashion/samples/sample-lace-bralette-and-brief-set.svg');
  });

  it('emits no image for an unknown category (no invented URL)', () => {
    const html = wrap(cat('Unlisted New Category', 'unlisted-new-category'));
    expect(html).not.toContain('<img src="');
  });

  it('still renders the category h1 and description with the image', () => {
    const html = wrap(cat("Women's Clothing", 'womens-clothing'));
    expect(html).toContain('<h1>Women&#39;s Clothing</h1>');
    expect(html).toContain('Everyday tops, layers and wardrobe staples for women');
    // Image appears before the heading.
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<h1>'));
  });

  it('pre-renders the same concise buyer guidance as the category landing', () => {
    const html = wrap(cat("Women's Clothing", 'womens-clothing'));
    expect(html).toContain('Choosing women&#39;s clothing');
    expect(html).toContain('listed dimensions, materials, availability, and delivery details');
  });

  it('emits the breadcrumb trail mirroring the client CategoryHero', () => {
    const html = wrap(cat("Women's Clothing", 'womens-clothing'));
    expect(html).toContain('<nav aria-label="Breadcrumb">');
    expect(html).toContain('<a href="/">Home</a>');
    expect(html).toContain('<a href="/shop">Shop</a>');
    expect(html).toContain('<li>Women&#39;s Clothing</li>');
    // Breadcrumb sits before the h1.
    expect(html.indexOf('Breadcrumb')).toBeLessThan(html.indexOf('<h1>'));
  });

  it('never pre-renders a link to a withdrawn guide', () => {
    // The production crawl audit found eight category/product pages still
    // emitting /blog/... guide links while those articles are retired and their
    // URLs only redirect. The crawl body must carry no such link, for every
    // category — the guide list is filtered at the shared lookup.
    setBlogPublicForTesting(false);
    try {
      for (const slug of ['dog-supplies', 'cat-supplies', 'horse', 'bird-supplies', 'cattle', 'pet-beds']) {
        const html = wrap(cat(slug.replace(/-/g, ' '), slug));
        expect(html, `${slug} still links a guide`).not.toContain('href="/blog/');
      }
    } finally {
      setBlogPublicForTesting(null);
    }
  });
});
