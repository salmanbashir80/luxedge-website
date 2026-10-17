// Admin-side public-visibility explanation.
//
// The storefront publishes a product only when `isPubliclyListableProduct`
// passes. Separately, an operator can set a product to ACTIVE, which is how the
// catalog reports "the owner approved this listing" — so the admin can show an
// ACTIVE row whose storefront URL actually 404s. That gap caused real
// confusion (and one dead link from a published guide): the admin previously
// labelled a row "LIVE" from the commerce-readiness column alone, while 66 of
// 98 active rows are not publicly listable.
//
// This helper answers, for one product, both halves of the operator's question
// in the storefront's own words: is it public, and if not, why. It reuses the
// shared contract rather than keeping a third copy of the rules.
import { publicProductIneligibilityReason, type PublicProductFacts } from '../../content/productEligibility';
import { isHeldProduct } from '../../content/reviewHolds';
import type { CatalogProduct } from './types';

export interface PublicVisibility {
  /** True only when the storefront would serve the PDP and list the product. */
  listable: boolean;
  /** Operator-facing reason when it is not listable; null when it is. */
  reason: string | null;
}

/** Maps a CatalogProduct onto the shared public-facts contract.
 * NOTE: `images` must be passed as URL strings — CatalogProduct.images holds
 * CatalogImage objects, and the contract only recognises string URLs. Passing
 * the objects straight through made every listed product look like it had no
 * usable image. */
export function publicFactsFor(p: CatalogProduct): PublicProductFacts {
  const images = (p.images || []).map((img) => img?.url).filter((u): u is string => !!u);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    description: p.description,
    short_description: p.shortDescription,
    price: p.price,
    image_url: p.imageUrl || images[0] || null,
    images,
    commerce_readiness: p.commerceReadiness,
    supplier_source: p.supplierSource,
    cost_price: p.costPrice,
    us_inventory: p.usInventory,
    stock_status: p.stockStatus,
    inventory_qty: p.inventoryQty,
  };
}

export function adminPublicVisibility(p: CatalogProduct): PublicVisibility {
  if (isHeldProduct(p.slug)) {
    return { listable: false, reason: 'held (editorial hold — CMS record kept)' };
  }
  const reason = publicProductIneligibilityReason(publicFactsFor(p));
  return { listable: reason === null, reason };
}
