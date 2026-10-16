/** Reversible public-display holds from the September 2026 editorial audit.
 * CMS records remain intact and editable by admins. Remove individual holds
 * only after the underlying content has been corrected and reviewed.
 */
const heldMedia = new Set([
  '05-05-hollow-crystal-sphere', '09-09-spiral-crystal-discs',
  '07-07-amber-honey-crystal', '08-08-purple-core-crystal',
  '04-04-crystal-cube-crunch', '10-10-ultimate-crystal-crunch',
  '06-06-ice-blue-candy-bar', '03-03-brittle-candy-sheet-snap',
  '02-02-rainbow-crystal-jelly', '01-01-crystal-block-clean-cut',
  'how-pomegranate-juice-is-made-in-a-1-million-bottle-factory',
  'reality-peel-apartment-to-desert-oasis',
  'himalayan-koh-himalayan-salt-block-premium-ranch-cgi-commercial',
  'how-livestock-salt-lick-blocks-are-pressed-shorts',
  'white-salt-vs-trace-mineral-blocks-what-is-the-difference-shorts',
  '4-types-of-livestock-salt-licks-explained-shorts',
  'how-livestock-salt-licks-are-made-and-used-worldwide-factory-to-farm',
  'how-pakistan-s-himalayan-pink-salt-products-are-made-mine-to-factory',
]);
// Legacy pet articles withheld after the Fashion-only transition.
// CMS rows remain safely archived and editable by admins.
const heldBlog = new Set([
  'best-bird-feeder-buyers-guide',
  'how-to-clean-a-bird-feeder',
  'horse-fly-mask-buyers-guide',
  'horse-grooming-kit-buyers-guide',
  'horse-halter-lead-rope-buyers-guide',
  'how-to-choose-a-cat-tunnel',
  'how-to-choose-cattle-trough-feed-water-setup',
  'how-to-fit-no-pull-dog-harness',
  'grooming-routine-long-haired-pets',
]);
/**
 * The manual per-product index control.
 *
 * Add a slug here and that product stops being public inventory: the worker
 * pre-render answers 404 with noindex, the sitemap feed drops it, and the store
 * grid finds no row — while the CMS record itself is untouched and can be
 * restored by deleting one line. That is deliberate: nothing auto-generates a
 * product description, so a listing whose facts are not written up yet can be
 * taken out of the index by hand instead of being padded to look substantial.
 */
const heldProduct = new Set<string>([
  'promo-probe-1788640230930',
  // Withheld until independently verified product facts replace thin or
  // contradictory supplier-derived copy. CMS/admin records stay intact.
  'kong-classic-durable-natural-rubber-dog-toy',
  'adjustable-nylon-horse-halter-lead-rope',
  'horse-grooming-kit-12-piece',
]);

/**
 * SEPTEMBER 2026 — the public blog is withdrawn from Google's index.
 *
 * Owner decision after the AdSense review: the guides are honestly written and
 * human-edited, but the blog is the surface that keeps drawing a "low value
 * content" finding, so it stops being indexable inventory while the storefront
 * and the trust pages carry the review on their own.
 *
 * Nothing is deleted. Every CMS row stays published and editable, /blog and
 * /blog/<slug> still answer 200 for visitors, and flipping this to true brings
 * back indexation, the sitemap entries and the admin generation tools in one
 * edit — that is the whole point of putting it here instead of deleting rows.
 */
let _blogPublicOverride: boolean | null = null;
export const BLOG_PUBLIC = true;
export function isBlogPublic(): boolean {
  return _blogPublicOverride !== null ? _blogPublicOverride : BLOG_PUBLIC;
}
export function setBlogPublicForTesting(val: boolean | null): void {
  _blogPublicOverride = val;
}

export function isHeldMedia(slug: string): boolean { return heldMedia.has(slug); }
export function isHeldBlog(slug: string): boolean { return heldBlog.has(slug); }
export function isHeldProduct(slug?: string | null): boolean {
  return !!slug && heldProduct.has(slug);
}

/** Public routes that were permanently deleted or withdrawn from the catalog.
 * EDITORIAL COPY MUST NEVER LINK TO THESE AGAIN: a crawler following a link
 * from an indexable page to a dead link is a real quality defect (and the
 * September 2026 audit found exactly that — a live guide still linked a
 * deleted article and a delisted product). Both renderers (the client
 * markdown renderer and the worker's article pre-render) degrade a markdown
 * link whose destination is retired to plain text, so a stale CMS body can
 * never emit a dead link, and isLinkablePublicPath() is what the content
 * modules filter their own guide links through. The anchor text stays
 * readable; only the <a> disappears. */
const retiredProductPaths = [
  '/product/2m-pet-dog-leash-with-soft-padded-handle-highly-reflective-dog-rope-for-night-walking-suitable-for-small-medium-and-large-dogs',
];

/**
 * Article URLs that were permanently removed from the CMS or consolidated.
 * Google may still have these in its index, so they 301 to /blog instead of
 * answering 404.
 */
const retiredBlogSlugs = new Set([
  'dog-car-safety-seat-belt-guide',
  'essential-supplies-new-puppy',
]);
export function isRetiredBlogSlug(slug?: string | null): boolean {
  return !!slug && retiredBlogSlugs.has(slug);
}
/** Every retired article URL, so the two rules below cannot disagree: the
 * worker 301s these, and no editorial link may point at them while their page
 * is a redirect. */
const retiredBlogPaths = new Set([...retiredBlogSlugs].map((s) => `/blog/${s}`));
export function isRetiredPublicPath(path?: string | null): boolean {
  if (!path) return false;
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '');
  return !!clean && (retiredBlogPaths.has(clean) || retiredProductPaths.includes(clean));
}

/** Every destination a markdown link in public editorial content may point to
 * without risking a 404: not held, not retired. */
export function isLinkablePublicPath(path?: string | null): boolean {
  if (!path) return false;
  if (isRetiredPublicPath(path)) return false;
  const productSlug = String(path).match(/^\/product\/([^/?#]+)/)?.[1];
  if (productSlug && isHeldProduct(productSlug)) return false;
  const blogSlug = String(path).match(/^\/blog\/([^/?#]+)/)?.[1];
  if (blogSlug) {
    if (!isBlogPublic() || isHeldBlog(blogSlug)) return false;
  }
  return true;
}
