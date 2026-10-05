// ============================================================================
// LUXEDGE — ADMIN READOUT HONESTY
//
// The admin panels read Supabase-backed stores (orders, the gift-drop ledger)
// that can be unreachable — quota, outage, expired key. An unreachable store
// must never render as a real zero: "$0.00 revenue", "0 orders" and
// "0 gifts left" all read as facts to the owner.
//
// These helpers are the single source of that rule for /admin so the
// dashboard, the Orders page and the Gift Drop page cannot drift apart.
// ============================================================================

/** Shown wherever an order figure would otherwise be a fabricated zero. */
export const ORDERS_UNAVAILABLE = 'Orders data unavailable — the order store could not be read.';

/** Short KPI subtitle for the same condition (fits a metric card). */
export const ORDERS_UNAVAILABLE_SHORT = 'order store unreachable';

/** Shown on the Gift Drop page when its campaign/ledger store is unreadable. */
export const GIFT_STORAGE_UNAVAILABLE =
  'Gift Drop storage unavailable — the campaign configuration and claims ledger could not be read. Nothing is shown as zero; retry once storage access is restored.';

/**
 * True when a Gift Drop read returned no campaign AND an unknown remaining
 * count. The admin API reports `remaining: -1` for "ledger unreadable"
 * (see api/admin/gift-drop.ts) — that is NOT the same as an empty campaign,
 * so the UI must not tell the owner to seed a row that already exists.
 */
export function giftStorageUnreadable(campaign: unknown, remaining: number): boolean {
  return !campaign && (!Number.isFinite(remaining) || remaining < 0);
}
