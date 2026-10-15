// Turns a supplier snapshot into a catalog import draft. Drafts are never purchasable
// on their own: checkout needs verified stock, a quoted US shipping cost and an admin approval.

import { calculateRetailPriceUsd } from './pricing';
import type { ImportDraft, SupplierProductSnapshot } from './types';

export interface DraftOptions {
  /** Explicit business margin. Required so no margin is assumed in code. */
  marginRate: number;
  /** Set true only after an admin has reviewed and approved the draft. */
  adminApproved?: boolean;
}

export function buildImportDraft(snapshot: SupplierProductSnapshot, options: DraftOptions): ImportDraft {
  const blockers: string[] = [];
  if (snapshot.estimatedUsShippingUsd === null) blockers.push('US shipping cost not quoted by supplier');
  if (snapshot.variants.length === 0) blockers.push('no variants returned');
  if (snapshot.variants.some((v) => v.stock === null)) blockers.push('stock unknown for one or more variants');
  if (snapshot.variants.some((v) => v.stock === 0)) blockers.push('one or more variants out of stock');
  if (!options.adminApproved) blockers.push('awaiting admin approval');

  const shipping = snapshot.estimatedUsShippingUsd ?? 0;
  return {
    provider: snapshot.provider,
    supplierProductId: snapshot.supplierProductId,
    title: snapshot.title,
    description: snapshot.description,
    imageUrls: snapshot.imageUrls,
    variants: snapshot.variants.map((v) => ({
      ...v,
      retailPriceUsd: calculateRetailPriceUsd({ costUsd: v.costUsd, shippingUsd: shipping, marginRate: options.marginRate }),
    })),
    // Drafts are never purchasable from the sync itself; a later approval step must clear blockers.
    placeholder: true,
    purchasable: false,
    blockers,
  };
}

/** Checkout gate: an item is purchasable only with no open blockers and an approved draft. */
export function isPurchasable(draft: ImportDraft): boolean {
  return draft.purchasable === true && draft.blockers.length === 0 && !draft.placeholder;
}
