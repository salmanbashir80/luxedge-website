// ============================================================================
// LUXEDGE — SERVER CHECKOUT MATH TESTS
//
// The client can NEVER influence the charged amount. These tests verify the
// server re-reads prices from the catalog loader, validates stock/status,
// applies coupons and free-shipping from store settings, and never produces
// negative totals.
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  validateCheckoutRequest, computeCheckoutTotals, buildStripeLineItems, DEFAULT_SHIPPING_RATE,
  type CheckoutDataLoader, type ServerProduct,
} from '../checkout.js';

const PID = '11111111-1111-4111-8111-111111111111';

function product(over: Partial<ServerProduct> = {}): ServerProduct {
  return { id: PID, slug: PID, name: 'Test Product', price: 25, status: 'active', inventory_qty: 10, image_url: null, ...over };
}

function makeLoader(products: ServerProduct[], coupon?: unknown, settings: { freeShippingEnabled?: boolean; freeShippingThreshold?: number } = {}): CheckoutDataLoader {
  return {
    async getProducts(ids) { return products.filter((p) => ids.includes(p.id)); },
    async getCoupon(code) { return (coupon as { code: string } | null)?.code === code ? (coupon as never) : null; },
    async getFreeShippingSettings() { return { freeShippingEnabled: settings.freeShippingEnabled ?? true, freeShippingThreshold: settings.freeShippingThreshold ?? 50 }; },
  };
}

const WELCOME10 = { code: 'WELCOME10', discount_type: 'percent', discount_value: 10, min_cart_value: 0, is_active: true, start_at: null, end_at: null };

describe('validateCheckoutRequest', () => {
  it('accepts a valid cart', () => {
    const r = validateCheckoutRequest({ items: [{ id: PID, quantity: 2 }], couponCode: 'WELCOME10', customer: { email: 'a@b.com' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.items[0].quantity).toBe(2);
  });

  it('rejects an empty cart', () => {
    expect(validateCheckoutRequest({ items: [] }).ok).toBe(false);
  });

  it('rejects Fashion sample (non-purchasable) product ids before any catalog lookup', () => {
    // Sample ids are `sample-<slug>` and never match the real UUID product-id shape,
    // so a forged cart cannot reach the catalog or create an order for a sample.
    const r = validateCheckoutRequest({ items: [{ id: 'sample-wool-blend-coat', quantity: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Invalid product id/);
  });

  it('rejects bad quantities and duplicate products', () => {
    expect(validateCheckoutRequest({ items: [{ id: PID, quantity: 0 }] }).ok).toBe(false);
    expect(validateCheckoutRequest({ items: [{ id: PID, quantity: 200 }] }).ok).toBe(false);
    expect(validateCheckoutRequest({ items: [{ id: PID, quantity: 1 }, { id: PID, quantity: 1 }] }).ok).toBe(false);
  });

  it('ignores any client-supplied price field', () => {
    const r = validateCheckoutRequest({ items: [{ id: PID, quantity: 1, price: 0.01 }], price: 0.01, total: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('price' in r.request).toBe(false);
      expect('total' in r.request).toBe(false);
    }
  });
});

describe('computeCheckoutTotals — server prices are authoritative', () => {
  it('charges the SERVER price, not anything the client sent', async () => {
    const d = await computeCheckoutTotals(makeLoader([product({ price: 25 })]), { items: [{ id: PID, quantity: 3 }] });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.totals.subtotal).toBe(75);
  });

  it('rejects products not in the catalog', async () => {
    const d = await computeCheckoutTotals(makeLoader([]), { items: [{ id: '99999999-9999-4999-8999-999999999999', quantity: 1 }] });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects inactive products and out-of-stock products', async () => {
    const inactive = await computeCheckoutTotals(makeLoader([product({ status: 'draft' })]), { items: [{ id: PID, quantity: 1 }] });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.code).toBe('PRODUCT_UNAVAILABLE');
    const oos = await computeCheckoutTotals(makeLoader([product({ inventory_qty: 0 })]), { items: [{ id: PID, quantity: 1 }] });
    expect(oos.ok).toBe(false);
    if (!oos.ok) expect(oos.code).toBe('OUT_OF_STOCK');
  });

  it('applies WELCOME10 as a 10% percentage discount', async () => {
    const d = await computeCheckoutTotals(makeLoader([product({ price: 50 })], WELCOME10), { items: [{ id: PID, quantity: 2 }], couponCode: 'WELCOME10' });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.totals.subtotal).toBe(100);
      expect(d.totals.discount).toBe(10);
      expect(d.totals.discountedSubtotal).toBe(90);
      expect(d.totals.couponCode).toBe('WELCOME10');
    }
  });

  it('rejects an unknown coupon', async () => {
    const d = await computeCheckoutTotals(makeLoader([product()]), { items: [{ id: PID, quantity: 1 }], couponCode: 'NOPE' });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('COUPON_INVALID');
  });

  it('rejects an expired coupon', async () => {
    const expired = { ...WELCOME10, end_at: new Date(Date.now() - 86400000).toISOString() };
    const d = await computeCheckoutTotals(makeLoader([product()], expired), { items: [{ id: PID, quantity: 1 }], couponCode: 'WELCOME10' });
    expect(d.ok).toBe(false);
  });

  it('respects coupon minimum cart value', async () => {
    const min = { ...WELCOME10, min_cart_value: 100 };
    const d = await computeCheckoutTotals(makeLoader([product({ price: 20 })], min), { items: [{ id: PID, quantity: 1 }], couponCode: 'WELCOME10' });
    // Below minimum: discount clamps to zero (min_cart_value rule) — never negative.
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.totals.discount).toBe(0);
  });

  it('charges flat shipping below the free threshold and free shipping at/above it', async () => {
    const below = await computeCheckoutTotals(makeLoader([product({ price: 20 })]), { items: [{ id: PID, quantity: 1 }] });
    expect(below.ok).toBe(true);
    if (below.ok) {
      expect(below.totals.shipping).toBe(DEFAULT_SHIPPING_RATE);
      expect(below.totals.freeShippingApplied).toBe(false);
    }
    const at = await computeCheckoutTotals(makeLoader([product({ price: 50 })]), { items: [{ id: PID, quantity: 1 }] });
    expect(at.ok).toBe(true);
    if (at.ok) {
      expect(at.totals.shipping).toBe(0);
      expect(at.totals.freeShippingApplied).toBe(true);
    }
  });

  it('never produces a negative total', async () => {
    const d = await computeCheckoutTotals(makeLoader([product({ price: 10 })], { ...WELCOME10, discount_value: 999 }), { items: [{ id: PID, quantity: 1 }], couponCode: 'WELCOME10' });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.totals.discount).toBeLessThanOrEqual(d.totals.subtotal);
      expect(d.totals.total).toBeGreaterThan(0);
    }
  });

  it('NEVER computes tax — tax is always 0 (no Stripe Tax add-on)', async () => {
    const d = await computeCheckoutTotals(makeLoader([product({ price: 25 })]), { items: [{ id: PID, quantity: 1 }] });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.totals.tax).toBe(0);
      // automatic_tax was removed (paid add-on): Luxedge never fabricates a rate
      // AND never asks the payment provider to calculate one.
      expect(d.totals.total).toBe(29.99); // pre-tax: 25 + 4.99 shipping, rounded — never a fabricated tax
    }
  });
});

describe('buildStripeLineItems — cents-exact discounted lines for Stripe', () => {
  it('passes through undiscounted lines at the catalog unit price', async () => {
    const d = await computeCheckoutTotals(makeLoader([product({ price: 25 })]), { items: [{ id: PID, quantity: 2 }] });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const lines = buildStripeLineItems(d.totals);
      expect(lines).toHaveLength(1);
      expect(lines[0].unitAmountCents).toBe(2500);
      expect(lines[0].quantity).toBe(2);
      expect(lines[0].unitAmountCents * 2).toBe(d.totals.discountedSubtotal * 100);
    }
  });

  it('prorates a percent discount exactly across lines (last line absorbs rounding)', async () => {
    // two lines: $30.00 and $10.00 → subtotal $40; WELCOME10 10% → discounted $36
    const d = await computeCheckoutTotals(
      makeLoader([product({ price: 30, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), product({ price: 10, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })], WELCOME10),
      { items: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quantity: 1 }, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 1 }], couponCode: 'WELCOME10' }
    );
    expect(d.ok).toBe(true);
    if (d.ok) {
      const lines = buildStripeLineItems(d.totals);
      const sum = lines.reduce((s, l) => s + l.unitAmountCents * l.quantity, 0);
      expect(sum).toBe(3600); // exactly $36.00 — no cent drift
      expect(lines.map((l) => l.unitAmountCents).sort((a, b) => b - a)).toEqual([2700, 900]);
    }
  });

  it('never emits a zero/negative unit amount even with a large fixed discount', async () => {
    const d = await computeCheckoutTotals(makeLoader([product({ price: 10 })], { ...WELCOME10, discount_value: 999 }), { items: [{ id: PID, quantity: 1 }], couponCode: 'WELCOME10' });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const lines = buildStripeLineItems(d.totals);
      expect(lines[0].unitAmountCents).toBeGreaterThanOrEqual(1);
    }
  });
});
