import { describe, expect, it } from 'vitest';
import { CATEGORY_CONTENT } from '../categoryContent';
import { FASHION_SAMPLE_PRODUCTS } from '../fashionSampleProducts';
import { FASHION_SUBCATEGORY_TREE, fashionLeafNames } from '../fashionSubcategories';

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

  it('places every sample in a known category, and every category has samples except Jeans and Pants', () => {
    const known = new Set(Object.keys(CATEGORY_CONTENT));
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(known.has(product.categorySlug)).toBe(true);
    }
    // The owner's 40-concept assortment has no standalone Jeans & Pants entry
    // (the chinos are Men's Clothing). That category must render an empty state.
    const covered = new Set(FASHION_SAMPLE_PRODUCTS.map((p) => p.categorySlug));
    const uncovered = [...known].filter((slug) => !covered.has(slug));
    expect(uncovered).toEqual(['jeans-and-pants']);
  });

  it('names every sample subcategory as a leaf in the Fashion subcategory tree', () => {
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(fashionLeafNames(product.categorySlug)).toContain(product.subcategory);
    }
    expect(Object.keys(FASHION_SUBCATEGORY_TREE).length).toBeGreaterThan(0);
  });

  it('has makeup and beauty samples with no image yet (placeholder rendered)', () => {
    const makeup = FASHION_SAMPLE_PRODUCTS.filter((p) => p.categorySlug === 'makeup-and-beauty');
    expect(makeup.length).toBe(5);
    for (const product of makeup) expect(product.image).toBeNull();
  });
});
