import { describe, expect, it } from 'vitest';
import { CATEGORY_CONTENT } from '../categoryContent';
import { FASHION_SAMPLE_PRODUCTS } from '../fashionSampleProducts';

describe('fashion sample products', () => {
  it('provides 30-50 samples', () => {
    expect(FASHION_SAMPLE_PRODUCTS.length).toBeGreaterThanOrEqual(30);
    expect(FASHION_SAMPLE_PRODUCTS.length).toBeLessThanOrEqual(50);
  });

  it('never marks a sample purchasable and flags every entry as a sample', () => {
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(product.sample).toBe(true);
      expect(product.purchasable).toBe(false);
    }
  });

  it('uses unique slugs and ids', () => {
    const slugs = FASHION_SAMPLE_PRODUCTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(FASHION_SAMPLE_PRODUCTS.map((p) => p.id)).size).toBe(slugs.length);
  });

  it('places every sample in a known category and covers all 10 categories', () => {
    const known = new Set(Object.keys(CATEGORY_CONTENT));
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(known.has(product.categorySlug)).toBe(true);
    }
    const covered = new Set(FASHION_SAMPLE_PRODUCTS.map((p) => p.categorySlug));
    expect(covered.size).toBe(known.size);
  });
});
