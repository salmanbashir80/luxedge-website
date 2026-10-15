import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CategoryHero, { categoryHeroConfig, categoryImageVariant } from '../CategoryHero';
import { categoryContentFor } from '../../content/categoryContent';

const categories = ["Women's Clothing", "Men's Clothing", 'Dresses and Tops', 'Jeans and Pants', 'Jackets and Outerwear', 'Sneakers and Shoes', 'Handbags and Wallets', 'Jewelry', 'Watches', 'Sunglasses and Accessories'];
const slugs = ['womens-clothing', 'mens-clothing', 'dresses-and-tops', 'jeans-and-pants', 'jackets-and-outerwear', 'sneakers-and-shoes', 'handbags-and-wallets', 'jewelry', 'watches', 'sunglasses-and-accessories'];

describe('category hero public rendering', () => {
  it.each(categories)('%s has one heading, a photo and valid shopping links', name => {
    const config = categoryHeroConfig(name, 'Fallback');
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={config} /></MemoryRouter>);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('href="#product-grid"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('Buyer guidance');
    expect(html).toContain(config.buyerNote);
    expect(html).toContain('fetchPriority="high"');
    expect(config.imageAlt.length).toBeGreaterThan(10);
    expect(config.image).toMatch(/^https:\/\//);
    for (const chip of config.chips) expect(slugs).toContain(chip.href.replace('/category/', ''));
  });

  it.each(categories)('%s renders the shared considerations and honest guide links', name => {
    // The worker pre-renders these same considerations into the crawl HTML, so a
    // visitor seeing less guidance than a crawler is a real defect, not a
    // cosmetic difference.
    const config = categoryHeroConfig(name, 'Fallback');
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={config} /></MemoryRouter>);
    const shared = categoryContentFor(name);
    expect(shared, `${name} must have shared content`).not.toBeNull();
    // Decode entities once: "Feeding & Water" legitimately renders as
    // "Feeding &amp; Water", and comparing raw HTML to source text would either
    // fail on that or hide a double-escape.
    const decoded = html.replace(/&#x27;|&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    expect(decoded).not.toContain('&amp;');
    expect(decoded).toContain(`What to look for in ${name.toLowerCase()}`);
    for (const consideration of shared!.considerations) {
      expect(decoded).toContain(consideration);
    }
    for (const guide of shared!.guides) {
      expect(html).toContain(`href="${guide.href}"`);
    }
    // A collection with no genuinely relevant guide must not link one.
    if (shared!.guides.length === 0) expect(html).not.toContain('Related guides:');
  });

  it('renders no considerations section for a collection with no shared content', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={categoryHeroConfig('Future collection', 'Desc')} /></MemoryRouter>);
    expect(html).not.toContain('What to look for in');
    expect(html).not.toContain('Related guides:');
  });

  it('retains unknown category copy without inventing imagery', () => {
    const config = categoryHeroConfig('Future collection', 'Useful collection description');
    expect(config.headline).toBe('Future collection');
    expect(config.desc).toBe('Useful collection description');
    expect(config.image).toBe('');
    expect(config.chips).toEqual([]);
    expect(config.buyerNote).toContain('task');
  });

  it('sizes known CDN images without rewriting custom image URLs', () => {
    const custom = 'https://luxedge.us/images/custom.webp';
    expect(categoryImageVariant(custom, 360)).toBe(custom);
    const image = new URL(categoryImageVariant('https://images.unsplash.com/photo-1552053831-71594a27632d?w=720&h=820&fit=crop', 360));
    expect(image.searchParams.get('w')).toBe('360');
    expect(image.searchParams.get('h')).toBe('324');
    expect(image.searchParams.get('auto')).toBe('format');
  });
});
