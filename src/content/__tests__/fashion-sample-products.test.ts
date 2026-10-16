import { describe, expect, it } from 'vitest';
import { CATEGORY_CONTENT } from '../categoryContent';
import { FASHION_SAMPLE_PRODUCTS } from '../fashionSampleProducts';
import {
  FASHION_SUBCATEGORY_TREE,
  fashionLeafNames,
  fashionSubcategoryLeafSlugs,
  fashionSubcategorySlug,
} from '../fashionSubcategories';

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

  it('places every sample in a known primary category, and every category has at least one primary sample', () => {
    const known = new Set(Object.keys(CATEGORY_CONTENT));
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(known.has(product.categorySlug)).toBe(true);
    }
    // Jeans & Pants has no primary sample of its own: its trousers are listed under
    // Men's Clothing / Women's Clothing and reach Jeans & Pants through collection membership.
    const covered = new Set(FASHION_SAMPLE_PRODUCTS.map((p) => p.categorySlug));
    const uncovered = [...known].filter((slug) => !covered.has(slug));
    expect(uncovered).toEqual(['jeans-and-pants']);
  });

  it('lists Jeans & Pants through collection membership without duplicate SKUs', () => {
    const inJeans = FASHION_SAMPLE_PRODUCTS.filter((p) => p.collectionSlugs.includes('jeans-and-pants'));
    expect(inJeans.map((p) => p.slug).sort()).toEqual([
      'sample-men-s-slim-fit-chino-pants',
      'sample-women-s-tailored-blazer-and-trouser-set',
    ]);
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(product.collectionSlugs[0]).toBe(product.categorySlug);
    }
    const skus = FASHION_SAMPLE_PRODUCTS.flatMap((p) => p.variants.map((v) => v.sku));
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('lists women\'s dresses, tops and outerwear under Women\'s Clothing by membership', () => {
    const inWomens = FASHION_SAMPLE_PRODUCTS.filter((p) => p.collectionSlugs.includes('womens-clothing'));
    const groups = new Set(inWomens.map((p) => p.subcategory));
    expect(inWomens.length).toBe(15);
    for (const leaf of ['Midi', 'Bodycon', 'Maxi', 'Blouses', 'Crop Tops', 'Jackets', 'Trench Coats']) {
      expect(groups.has(leaf)).toBe(true);
    }
    for (const product of inWomens) {
      expect(product.collectionSlugs[0]).toBe(product.categorySlug);
    }
  });

  it('names every sample subcategory as a leaf in the Fashion subcategory tree', () => {
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(fashionLeafNames(product.categorySlug)).toContain(product.subcategory);
    }
    expect(Object.keys(FASHION_SUBCATEGORY_TREE).length).toBeGreaterThan(0);
  });

  it('gives every sample its own image path, with no category photo reused', () => {
    const images = FASHION_SAMPLE_PRODUCTS.map((p) => p.image);
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      expect(product.image).toBe(`/images/fashion/samples/${product.slug}.svg`);
    }
    expect(new Set(images).size).toBe(FASHION_SAMPLE_PRODUCTS.length);
  });

  it('matches every sample under its own leaf subcategory filter, and never matches unknown nodes', () => {
    for (const product of FASHION_SAMPLE_PRODUCTS) {
      const leaf = fashionSubcategorySlug(product.subcategory);
      const leaves = fashionSubcategoryLeafSlugs(product.categorySlug, leaf);
      expect(leaves.has(fashionSubcategorySlug(product.subcategory))).toBe(true);
    }
    expect(fashionSubcategoryLeafSlugs('womens-clothing', 'no-such-node').size).toBe(0);
    expect(fashionSubcategoryLeafSlugs('womens-clothing', 'dresses').has('maxi')).toBe(true);
  });

  it('keeps exactly five Makeup & Beauty samples', () => {
    expect(FASHION_SAMPLE_PRODUCTS.filter((p) => p.categorySlug === 'makeup-and-beauty').length).toBe(5);
  });
});
