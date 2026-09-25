// ============================================================================
// SALES MANAGEMENT — shared types (generic, brand-agnostic)
//
// Reusable on any Embani LLC storefront (Himalayan Koh, future sites):
// nothing here references Luxedge. The UI label/currency/categories live in
// ./config.ts. Money is always decimal numbers rounded to 2 dp at the edges
// (stored as numeric(12,2) in Postgres — never floats in the database).
// ============================================================================

/** Manually entered per-order financial fields (order_financials sidecar). */
export interface OrderFinancials {
  /** null = row has no sidecar yet (all-zero defaults). */
  id: string | null;
  productCost: number;
  shippingCost: number;
  paymentFee: number;
  otherExpense: number;
  /** null = use the payment provider's refunded_amount. A number is an explicit manual override. */
  refundAmount: number | null;
  /** null = follow the order's own status. Set for ops stages like 'ordered_from_supplier'. */
  opsStatus: string | null;
  supplier: string;
  supplierOrderNumber: string;
  trackingNumber: string;
  notes: string;
}

/** One order as the Sales module sees it: original order facts + manual sidecar. */
export interface SalesOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  /** Compact item summary from the immutable items snapshot (name ×qty). */
  itemsLabel: string;
  /** Original sale amount (luxedge_orders.total) — never modified by this module. */
  saleAmount: number;
  /** Stripe/authoritative refunded_amount on the order itself. */
  providerRefund: number;
  /** Original payment lifecycle status (luxedge_orders.status). */
  status: string;
  paymentProvider: string;
  fin: OrderFinancials;
}

/** A general (non-order) business expense. */
export interface BusinessExpense {
  id: string;
  expenseDate: string; // YYYY-MM-DD
  category: string;
  description: string;
  amount: number;
  paymentMethod: string;
  receiptUrl: string;
  notes: string;
}

/** Per-order profit breakdown — see profit.ts for the exact formula. */
export interface OrderProfit {
  refund: number;
  netSales: number;
  netProfit: number;
  /** null when netSales is 0 (margin undefined). */
  margin: number | null;
  /** Cancelled orders contribute 0 to every aggregate. */
  counted: boolean;
}

/** Aggregated business numbers for a date range (Overview + Reports). */
export interface SalesSummary {
  grossSales: number;
  refunds: number;
  netSales: number;
  orders: number;
  cancelledOrders: number;
  cogs: number;
  shipping: number;
  paymentFees: number;
  otherOrderExpenses: number;
  generalExpenses: number;
  netProfit: number;
  /** null when netSales is 0. */
  margin: number | null;
  aov: number;
}

/** A report row for the by-period breakdown (weekly/monthly/…). */
export interface SalesReportRow extends SalesSummary {
  label: string;
  periodStart: string; // YYYY-MM-DD
}
