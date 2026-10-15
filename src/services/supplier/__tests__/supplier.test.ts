import { describe, expect, it } from 'vitest';
import { calculateRetailPriceUsd } from '../pricing';
import { checkUsShippingEligibility, US_SHIP_STATES } from '../usShipping';
import {
  createAliExpressAdapter,
  createAlibabaAdapter,
  SupplierClientUnverifiedError,
  SupplierNotConfiguredError,
} from '../adapters';
import { buildImportDraft, isPurchasable } from '../importDraft';
import type { SupplierProductSnapshot } from '../types';

describe('calculateRetailPriceUsd', () => {
  it('grosses landed cost up by the margin and rounds up to the cent', () => {
    expect(calculateRetailPriceUsd({ costUsd: 10, shippingUsd: 5, marginRate: 0.5 })).toBe(30);
    expect(calculateRetailPriceUsd({ costUsd: 10, shippingUsd: 0, marginRate: 0.3 })).toBe(14.29);
  });

  it('rejects invalid inputs instead of returning a price', () => {
    expect(() => calculateRetailPriceUsd({ costUsd: 0, shippingUsd: 0, marginRate: 0.3 })).toThrow();
    expect(() => calculateRetailPriceUsd({ costUsd: 5, shippingUsd: -1, marginRate: 0.3 })).toThrow();
    expect(() => calculateRetailPriceUsd({ costUsd: 5, shippingUsd: 0, marginRate: 1 })).toThrow();
    expect(() => calculateRetailPriceUsd({ costUsd: Number.NaN, shippingUsd: 0, marginRate: 0.3 })).toThrow();
  });
});

describe('checkUsShippingEligibility', () => {
  const base = { country: 'US', state: 'NY', zip: '10001' };

  it('accepts a US address with a 5-digit or ZIP+4 code', () => {
    expect(checkUsShippingEligibility(base)).toEqual({ eligible: true });
    expect(checkUsShippingEligibility({ ...base, zip: '10001-1234' })).toEqual({ eligible: true });
  });

  it('refuses non-US countries', () => {
    expect(checkUsShippingEligibility({ ...base, country: 'CA' }).eligible).toBe(false);
  });

  it('refuses unknown states and malformed ZIP codes', () => {
    expect(checkUsShippingEligibility({ ...base, state: 'ZZ' }).eligible).toBe(false);
    expect(checkUsShippingEligibility({ ...base, zip: '1000' }).eligible).toBe(false);
    expect(checkUsShippingEligibility({ ...base, zip: 'ABCDE' }).eligible).toBe(false);
  });

  it('lists the same 50 states as the checkout page', () => {
    expect(US_SHIP_STATES).toHaveLength(50);
  });
});

describe('supplier adapters without credentials', () => {
  it('report exactly which settings are missing and never return data', async () => {
    const ali = createAliExpressAdapter({});
    expect(ali.missingConfig()).toEqual(['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET']);
    await expect(ali.fetchProduct('123')).rejects.toBeInstanceOf(SupplierNotConfiguredError);

    const ab = createAlibabaAdapter({ ALIBABA_APP_KEY: '  ' });
    expect(ab.missingConfig()).toEqual(['ALIBABA_APP_KEY', 'ALIBABA_APP_SECRET']);
    await expect(ab.checkInventory('456', ['sku'])).rejects.toBeInstanceOf(SupplierNotConfiguredError);
  });

  it('refuse to sync even when credentials are present, until a client is verified', async () => {
    const ali = createAliExpressAdapter({ ALIEXPRESS_APP_KEY: 'k', ALIEXPRESS_APP_SECRET: 's' });
    expect(ali.missingConfig()).toEqual([]);
    await expect(ali.fetchProduct('123')).rejects.toBeInstanceOf(SupplierClientUnverifiedError);
  });
});

describe('buildImportDraft and the checkout gate', () => {
  const snapshot: SupplierProductSnapshot = {
    provider: 'aliexpress',
    supplierProductId: 'p1',
    title: 'Wool scarf',
    description: 'Supplier description',
    imageUrls: [],
    variants: [{ supplierSku: 's1', color: 'Grey', costUsd: 8, stock: 40 }],
    estimatedUsShippingUsd: 4,
    fetchedAt: '2026-10-15T00:00:00Z',
  };

  it('prices variants from the supplier cost and shipping, and stays non-purchasable', () => {
    const draft = buildImportDraft(snapshot, { marginRate: 0.5, adminApproved: true });
    expect(draft.variants[0].retailPriceUsd).toBe(24);
    expect(draft.placeholder).toBe(true);
    expect(draft.purchasable).toBe(false);
    expect(isPurchasable(draft)).toBe(false);
  });

  it('lists blockers for unknown stock, missing shipping and missing approval', () => {
    const draft = buildImportDraft(
      { ...snapshot, estimatedUsShippingUsd: null, variants: [{ supplierSku: 's1', costUsd: 8, stock: null }] },
      { marginRate: 0.5 },
    );
    expect(draft.blockers).toEqual(
      expect.arrayContaining([
        'US shipping cost not quoted by supplier',
        'stock unknown for one or more variants',
        'awaiting admin approval',
      ]),
    );
    expect(isPurchasable(draft)).toBe(false);
  });
});
