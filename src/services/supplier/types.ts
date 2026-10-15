// Supplier model shared by every provider adapter. Adapters only translate what a
// supplier actually returned into these shapes; nothing here carries invented data.

export type SupplierProvider = 'aliexpress' | 'alibaba';

export interface SupplierVariant {
  /** Supplier's own SKU / variant identifier, kept verbatim. */
  supplierSku: string;
  size?: string;
  color?: string;
  /** Unit cost in USD as reported by the supplier. */
  costUsd: number;
  /** Units the supplier reports as available. `null` = unknown, never assumed in stock. */
  stock: number | null;
}

export interface SupplierProductSnapshot {
  provider: SupplierProvider;
  supplierProductId: string;
  title: string;
  description: string;
  imageUrls: string[];
  variants: SupplierVariant[];
  /** Estimated USD shipping to a US address for the whole order line, when the supplier quotes it. */
  estimatedUsShippingUsd: number | null;
  fetchedAt: string;
}

export interface InventoryCheck {
  supplierSku: string;
  stock: number | null;
}

export interface ImportDraft {
  provider: SupplierProvider;
  supplierProductId: string;
  title: string;
  description: string;
  imageUrls: string[];
  variants: Array<SupplierVariant & { retailPriceUsd: number }>;
  /** Always true for drafts created from a sync: they stay out of checkout until an admin approves them. */
  placeholder: boolean;
  purchasable: boolean;
  blockers: string[];
}
