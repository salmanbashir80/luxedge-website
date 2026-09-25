// ============================================================================
// SALES MANAGEMENT — configuration (the ONLY brand-specific file)
//
// To adopt this module on Himalayan Koh (or any other site), change this file
// and the sidebar label — everything else (types, math, CSV, API, UI) is
// generic and reusable as-is.
// ============================================================================

/** UI label for the module. The only place the brand name appears. */
export const SALES_MODULE_LABEL = 'Luxedge Sales';

/** Display/export currency. */
export const SALES_CURRENCY = 'USD';
export const SALES_CURRENCY_SYMBOL = '$';

/** Allowed operational statuses (display order). */
export const ORDER_STATUSES = [
  'pending',
  'paid',
  'processing',
  'ordered_from_supplier',
  'shipped',
  'delivered',
  'cancelled',
  'partially_refunded',
  'refunded',
] as const;

export const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: 'Awaiting Payment',
  failed: 'Failed',
  pending: 'Pending',
  paid: 'Paid',
  processing: 'Processing',
  ordered_from_supplier: 'Ordered From Supplier',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  partially_refunded: 'Partially Refunded',
  refunded: 'Refunded',
};

/** General business expense categories (owner-friendly, non-accounting). */
export const EXPENSE_CATEGORIES = [
  'Advertising',
  'Software',
  'Hosting',
  'Domain',
  'Supplier',
  'Shipping',
  'Payment Fees',
  'Bank Fees',
  'Contractor',
  'Office',
  'Professional Services',
  'Miscellaneous',
] as const;

/** Statuses whose orders still count in sales/profit aggregates. */
export const COUNTED_STATUSES = new Set([
  'paid',
  'processing',
  'ordered_from_supplier',
  'shipped',
  'delivered',
  'partially_refunded',
  // A fully refunded payment is still a real historical sale: include its
  // gross revenue and full refund in reporting so net sales/profit correctly
  // reconcile to zero/negative rather than disappearing from the period.
  'refunded',
]);
