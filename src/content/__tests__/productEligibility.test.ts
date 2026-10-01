import { describe, expect, it } from 'vitest';
import { isPubliclyListableProduct, publicProductIneligibilityReason } from '../productEligibility';

const qualified = { slug: 'verified-grooming-brush', name: 'Verified Grooming Brush', status: 'active', price: 24.99, description: 'A factual product description with enough verified catalog detail for a customer to understand the listed item before ordering.', image_url: 'https://images.example.test/brush.jpg', commerce_readiness: 'COMMERCE_READY' };
describe('public PDP eligibility', () => {
  it('requires substantive facts and commerce readiness', () => {
    expect(isPubliclyListableProduct(qualified)).toBe(true);
    expect(publicProductIneligibilityReason({ ...qualified, description: 'Too short' })).toBe('insufficient verified product content');
    expect(publicProductIneligibilityReason({ ...qualified, commerce_readiness: 'NEEDS_REVIEW' })).toBe('unverified commerce readiness');
  });
  it('withholds official/manufacturer sources even when declared commerce ready', () => {
    const officialSource = {
      ...qualified,
      slug: 'kong-classic',
      supplier_source: 'KONG Company (official manufacturer)',
      commerce_readiness: 'COMMERCE_READY',
    };
    expect(isPubliclyListableProduct(officialSource)).toBe(false);
    expect(publicProductIneligibilityReason(officialSource)).toBe('unverified commerce readiness');
  });
  it('withholds audited contradictions rather than choosing a claim', () => {
    expect(isPubliclyListableProduct({ ...qualified, slug: 'horse-halter', description: `${qualified.description} Nylon cowhide horse halter.` })).toBe(false);
    expect(isPubliclyListableProduct({ ...qualified, slug: 'grooming-kit', description: `${qualified.description} 12-piece grooming kit, 10-piece grooming kit.` })).toBe(false);
    expect(isPubliclyListableProduct({ ...qualified, slug: 'water-trough', description: `${qualified.description} 30-gallon trough water bladder.` })).toBe(false);
  });
  it('accepts a site-relative local-mirror image but never a bare token', () => {
    // Post-migration-0005 shape: product_images.url points at the site's own
    // static assets (/img/...) instead of the restricted Supabase Storage.
    const localMirror = {
      ...qualified,
      image_url: '',
      product_images: [{ url: '/img/hk/hk-salt-lump.jpg', public_url: '/img/hk/hk-salt-lump.jpg' }],
    };
    expect(isPubliclyListableProduct(localMirror)).toBe(true);
    expect(publicProductIneligibilityReason({ ...qualified, image_url: 'not-a-url' })).toBe('missing usable product image');
  });
});
