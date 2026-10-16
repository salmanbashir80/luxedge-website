import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CategoryHero, { categoryHeroConfig, categoryImageVariant } from '../CategoryHero';
import { categoryContentFor } from '../../content/categoryContent';

const categories = ["Women's Clothing", "Men's Clothing", 'Dresses and Tops', 'Jeans and Pants', 'Jackets and Outerwear', 'Sneakers and Shoes', 'Handbags and Wallets', 'Jewelry', 'Watches', 'Sunglasses and Accessories'];
const slugs = ['womens-clothing', 'mens-clothing', 'dresses-and-tops', 'jeans-and-pants', 'jackets-and-outerwear', 'sneakers-and-shoes', 'handbags-and-wallets', 'jewelry', 'watches', 'sunglasses-and-accessories'];

describe('category hero public rendering', () => {
  it.each(categories)('%s has one heading, a photo, valid shopping links and a search bar', name => {
    const config = categoryHeroConfig(name, 'Fallback');
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={config} /></MemoryRouter>);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('href="#product-grid"');
    const decoded = html.replace(/&#x27;|&apos;|&#39;/g, "'").replace(/&quot;/g, '"');
    expect(decoded).toContain('aria-label="Breadcrumb"');
    expect(decoded).toContain('role="search"');
    expect(decoded).toContain(`Search ${name}`);
    expect(html).toContain('fetchPriority="high"');
    expect(config.imageAlt.length).toBeGreaterThan(10);
    expect(config.image).toMatch(/^(https:\/\/|\/images\/fashion\/)/);
    if (!config.image.startsWith('https://')) expect(existsSync(join(process.cwd(), 'public', config.image))).toBe(true);
    for (const chip of config.chips) expect(slugs).toContain(chip.href.replace('/category/', ''));
  });

  it.each(categories)('%s renders search bar and does not render legacy buyer guidance text', name => {
    const config = categoryHeroConfig(name, 'Fallback');
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={config} /></MemoryRouter>);
    expect(html).toContain('role="search"');
    expect(html).not.toContain('What to look for in');
    expect(html).not.toContain('Related guides:');
  });

  it('renders search bar for a collection without guidance text', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CategoryHero config={categoryHeroConfig('Future collection', 'Desc')} /></MemoryRouter>);
    expect(html).toContain('role="search"');
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
