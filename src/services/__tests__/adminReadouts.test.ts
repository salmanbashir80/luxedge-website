import { describe, expect, it } from 'vitest';
import {
  GIFT_STORAGE_UNAVAILABLE,
  ORDERS_UNAVAILABLE,
  ORDERS_UNAVAILABLE_SHORT,
  giftStorageUnreadable,
} from '../adminReadouts';

// The rule these strings exist to protect: an UNREACHABLE store must never be
// rendered as a real zero. These copy strings are the owner-facing half of that
// rule, so they must stay honest wording (no "0", no "none yet").
describe('admin readout honesty', () => {
  it('makes clear the order store could not be read, not that there are zero orders', () => {
    expect(ORDERS_UNAVAILABLE).toMatch(/unavailable/i);
    expect(ORDERS_UNAVAILABLE).toMatch(/could not be read/i);
    expect(ORDERS_UNAVAILABLE).not.toMatch(/\b0\b|no orders/i);
    expect(ORDERS_UNAVAILABLE_SHORT).toBe('order store unreachable');
  });

  it('tells the owner storage is down instead of asking them to seed an existing row', () => {
    expect(GIFT_STORAGE_UNAVAILABLE).toMatch(/storage unavailable/i);
    expect(GIFT_STORAGE_UNAVAILABLE).toMatch(/nothing is shown as zero/i);
    expect(GIFT_STORAGE_UNAVAILABLE).not.toMatch(/seed the app_settings row/i);
  });
});

describe('giftStorageUnreadable', () => {
  it('is true for the live unreadable-store shape (campaign null, remaining -1)', () => {
    expect(giftStorageUnreadable(null, -1)).toBe(true);
  });

  it('is true when the remaining count is missing or not a number', () => {
    expect(giftStorageUnreadable(null, Number.NaN)).toBe(true);
    expect(giftStorageUnreadable(null, Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('is false when a campaign config was actually returned', () => {
    expect(giftStorageUnreadable({ title: 'Luxedge Pet Gift Drop' }, 42)).toBe(false);
    // A configured campaign whose ledger is unreadable is still a real campaign.
    expect(giftStorageUnreadable({ title: 'Luxedge Pet Gift Drop' }, -1)).toBe(false);
  });

  it('is false for a genuinely empty campaign whose ledger was read', () => {
    expect(giftStorageUnreadable(null, 0)).toBe(false);
  });
});
