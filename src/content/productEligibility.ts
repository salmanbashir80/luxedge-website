// Shared, fail-closed public PDP contract. Admin records are never affected.
export interface PublicProductFacts { id?: string | null; slug?: string | null; name?: string | null; status?: string | null; description?: string | null; short_description?: string | null; shortDesc?: string | null; price?: number | null; image_url?: string | null; images?: string[] | null; product_images?: Array<{ url?: string | null; public_url?: string | null }> | null; commerce_readiness?: string | null; commerceReadiness?: string | null; supplier_source?: string | null; supplierSource?: string | null; cost_price?: number | null; us_inventory?: boolean | null; usInventory?: boolean | null; stock_status?: string | null; stockStatus?: string | null; inventory_qty?: number | null; stock?: number | null; }
const text = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim();
// A usable image is an absolute http(s) URL or a site-relative path (/img/...)
// served from this origin's static assets. A bare token is never usable.
const usableImage = (v: unknown) => /^(https?:\/\/|\/[^/])/i.test(text(v));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isOfficialOrManufacturerSource = (p: PublicProductFacts) => /\bkong\b|\bofficial\b|\bmanufacturer\b/i.test(text(p.supplier_source || p.supplierSource));
export function isCommerceReadyForPublicListing(p: PublicProductFacts): boolean {
  // Manufacturer pages are reference material, not an independently verified
  // commerce supply. Evaluate this before stored readiness so an accidental
  // COMMERCE_READY stamp cannot make an official-source row public.
  if (isOfficialOrManufacturerSource(p)) return false;
  const declared = text(p.commerce_readiness || p.commerceReadiness);
  if (declared) return declared === 'COMMERCE_READY';
  const source = text(p.supplier_source || p.supplierSource).toLowerCase();
  return !!source && num(p.cost_price) > 0 &&
    (p.us_inventory === true || p.usInventory === true || (text(p.stock_status || p.stockStatus) === 'in_stock' && num(p.inventory_qty ?? p.stock) > 0));
}
export function hasKnownProductContradiction(p: PublicProductFacts): boolean {
  const h = text([p.slug, p.name, p.description, p.short_description, p.shortDesc].join(' ')).toLowerCase();
  return (/(horse.*halter|halter.*horse)/.test(h) && /nylon/.test(h) && /cowhide/.test(h)) ||
    (/(grooming.*kit|kit.*grooming)/.test(h) && /\b12[- ]?piece\b/.test(h) && /\b10[- ]?piece\b/.test(h)) ||
    (/(trough|water bladder)/.test(h) && /\b30[- ]?gallon\b/.test(h) && /water bladder/.test(h));
}
export function publicProductIneligibilityReason(p: PublicProductFacts): string | null {
  if (!['active', 'published'].includes(text(p.status).toLowerCase())) return 'not publicly active';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(text(p.slug))) return 'missing canonical slug';
  if (text(p.name).length < 3 || /^(product|item|test)(\s|$)/i.test(text(p.name))) return 'insufficient product identity';
  if (num(p.price) <= 0) return 'missing price fact';
  if (!(usableImage(p.image_url) || (p.images || []).some(usableImage) || (p.product_images || []).some((x) => usableImage(x.url || x.public_url)))) return 'missing usable product image';
  if (text(p.description).length + text(p.short_description || p.shortDesc).length < 100) return 'insufficient verified product content';
  if (!isCommerceReadyForPublicListing(p)) return 'unverified commerce readiness';
  if (hasKnownProductContradiction(p)) return 'known contradictory product facts';
  return null;
}
export function isPubliclyListableProduct(p: PublicProductFacts): boolean { return publicProductIneligibilityReason(p) === null; }
