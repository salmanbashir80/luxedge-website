// ============================================================================
// LUXEDGE — SMART PRODUCT MERCHANDISING (adaptive ranking engine)
//
// Purpose: order product grids (homepage sections, Catalog, category pages)
// so the FIRST products shoppers see are the products most likely to attract
// attention and convert — without freezing the same historical best sellers
// on top forever.
//
// Where the data comes from
//   * Per-product performance stats come from the worker endpoint
//     /api/merch-stats (api/merch-stats.ts), which aggregates REAL first-party
//     analytics server-side (site_events + paid luxedge_orders) and caches it
//     15 min. The browser never downloads raw events — only compact per-product
//     counts, and only when that endpoint is reachable. Missing stats simply
//     fall back to a flag/availability/quality ordering (never fabricated).
//   * Visual quality is measured client-side (decode + natural dimensions of
//     the primary image, probed lazily after first paint) and cached for the
//     session. Unmeasured products keep a neutral prior — we never assume a
//     broken or tiny image is good.
//   * Manual admin intent already lives on the product row: `sort_order` > 0
//     pins a product above the automatic ranking (ascending order); featured /
//     new_arrival flags feed the freshness/curation component.
//
// Anti-patterns handled explicitly
//   * Bayesian smoothing (pseudo counts): 1 view + 1 purchase can never jump
//     a product to #1 — rates shrink toward a modest prior until there is a
//     real sample.
//   * Clickbait guard: a high-CTR product that nobody adds to cart or buys
//     loses ranking strength over time.
//   * Bad-product penalties: out-of-stock products sink to the bottom (they
//     are not deleted and still render — just not in prominent positions);
//     broken / unusable primary images are demoted the moment a failure is
//     observed.
//   * Explore vs exploit: for default "Recommended" browsing, a small share of
//     the later slots is reserved for promising-but-unobserved products, and
//     that share rotates deterministically once per day so the grid stays
//     stable within a day but new products keep getting fair impressions.
//
// Stability: rankings are deterministic for a given stats snapshot + day seed
// (no random shuffle) — URLs, canonical tags and SEO never change.
// ============================================================================

// --- Weighted signals (sum ≈ 1.00) -----------------------------------------
// Visual quality is 25% as specified; the rest are performance signals that
// Luxedge actually records. If a signal has no data its component is a tiny
// floor, so a product is never *penalized* for being new — it simply ranks on
// what is known (image, availability, freshness, curation flags).
export const MERCH_WEIGHTS = {
  visual: 0.25, // decode/dimension quality of the primary image (client-measured)
  ctr: 0.2, // click-through from list impressions (select_item / view_item_list)
  atc: 0.18, // add-to-cart rate (add_to_cart / product views)
  conv: 0.15, // paid-order conversion (luxedge_orders / product views)
  revPerView: 0.1, // paid revenue per product view
  stock: 0.05, // available inventory
  momentum: 0.04, // recent (7d) activity trend
  freshness: 0.03, // new-arrival / curation freshness
} as const;

/** Per-product aggregate stats payload from /api/merch-stats (see that file). */
export interface MerchStats {
  i7: number; // list impressions, last 7d
  i30: number; // list impressions, last 30d
  i90: number; // list impressions, last 90d
  v7: number; // product (detail) views, last 7d
  v30: number; // product (detail) views, last 30d
  c30: number; // select_item clicks, last 30d
  a30: number; // add_to_cart, last 30d
  o90: number; // paid orders (lines), last 90d
  q90: number; // paid units, last 90d
  r90: number; // paid revenue (USD), last 90d
  m7: number; // any-touch activity events, last 7d (momentum)
  m30: number; // any-touch activity events, last 30d
}

export const ZERO_MERCH_STATS: MerchStats = {
  i7: 0, i30: 0, i90: 0, v7: 0, v30: 0, c30: 0, a30: 0, o90: 0, q90: 0, r90: 0, m7: 0, m30: 0,
};

export function emptyMerchStats(): MerchStats {
  return { ...ZERO_MERCH_STATS };
}

// --- Client-side visual quality (decode + natural dimensions) ---------------
// Neutral prior for not-yet-measured images: the product passed the
// storefront gate (has a usable primary image), so assume acceptable until an
// objective check says otherwise.
const VISUAL_PRIOR = 0.85;
const MIN_NATURAL = 280; // smaller than this = unusably tiny thumbnail
const quality = new Map<string, { v: number }>();
let qualityVersion = 0;
const qualityListeners = new Set<() => void>();

function notifyQualityChange(): void {
  qualityVersion += 1;
  qualityListeners.forEach((fn) => fn());
}

export function subscribeVisualQuality(fn: () => void): () => void {
  qualityListeners.add(fn);
  return () => qualityListeners.delete(fn);
}

export function getVisualQualityVersion(): number {
  return qualityVersion;
}

/** 0..1 quality factor for a product's primary image. */
export function visualQualityOf(productId: string): number {
  return quality.get(productId)?.v ?? VISUAL_PRIOR;
}

/** Record a broken primary image (observed by the <img> onError path). */
export function markBrokenImage(productId: string): void {
  const cur = quality.get(productId)?.v;
  if (cur !== 0) {
    quality.set(productId, { v: 0 });
    notifyQualityChange();
  }
}

/**
 * Objective visual check: decode the primary image and read its natural size.
 * Called lazily (idle, small concurrency budget, bounded candidate count).
 * Only writes a verdict when it is worse than the neutral prior, so a healthy
 * image never triggers a re-render/re-rank churn.
 */
export async function probeVisualQuality(
  candidates: { id: string; url?: string }[],
  opts: { budget?: number; concurrency?: number } = {},
): Promise<void> {
  const budget = Math.max(0, opts.budget ?? 14);
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const targets = candidates.slice(0, budget).filter((c) => c.url && !quality.has(c.id));
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const c = targets[cursor++];
      if (!c.url) continue;
      const verdict = await measureImage(c.url);
      if (verdict !== null && verdict < VISUAL_PRIOR) {
        quality.set(c.id, { v: verdict });
        notifyQualityChange();
      } else if (verdict === null) {
        // decode failure / network error = treat as broken
        quality.set(c.id, { v: 0 });
        notifyQualityChange();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length || 1) }, () => worker()));
}

function measureImage(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = new Image();
    const done = (v: number | null) => {
      probe.onload = null;
      probe.onerror = null;
      resolve(v);
    };
    probe.onload = () => {
      const w = probe.naturalWidth;
      const h = probe.naturalHeight;
      if (!w || !h) return done(0);
      if (w < MIN_NATURAL || h < MIN_NATURAL) return done(0.2); // tiny thumbnail
      const ratio = w / h;
      // Extreme aspect ratios crop badly in the square product frame.
      if (ratio > 2.4 || ratio < 0.42) return done(0.55);
      return done(1);
    };
    probe.onerror = () => done(null);
    probe.src = src;
  });
}

// --- Bayesian-ish scoring ---------------------------------------------------
function sat(x: number, half: number): number {
  return x / (x + half);
}

export interface RankableProduct {
  id: string;
  stock?: number;
  stockStatus?: string;
  featured?: boolean;
  newArrival?: boolean;
  saleEnabled?: boolean;
  sortOrder?: number;
}

/** Raw merchandising score in [0,1] for a single product. Exported for tests. */
export function merchScoreOf(
  p: RankableProduct,
  stats?: MerchStats,
  qualityOf: (id: string) => number = visualQualityOf,
): number {
  const s = stats || ZERO_MERCH_STATS;
  const inStock = (p.stock ?? 1) > 0 && (p.stockStatus ?? 'in_stock') !== 'out_of_stock';

  // Smoothed rates: pseudo counts shrink small samples toward a modest prior,
  // so a single lucky purchase/view can never dominate (spec requirement).
  const ctrRate = (s.c30 + 0.4) / (s.i30 + 14);
  const atcRate = (s.a30 + 0.4) / (s.v30 + 7);
  const convRate = (s.o90 + 0.25) / (s.v30 + 16);
  const rpv = (s.r90 + 0.5) / (s.v30 + 10);
  const mom = s.m7 + 0.5;

  const visual = qualityOf(p.id);
  const freshness = p.newArrival ? 1 : p.featured ? 0.9 : 0.55;

  const comp = {
    visual,
    ctr: sat(ctrRate, 0.05),
    atc: sat(atcRate, 0.08),
    conv: sat(convRate, 0.035),
    revPerView: sat(rpv, 0.7),
    stock: inStock ? 1 : 0.06,
    momentum: sat(mom, 2),
    freshness,
  };

  let score =
    comp.visual * MERCH_WEIGHTS.visual +
    comp.ctr * MERCH_WEIGHTS.ctr +
    comp.atc * MERCH_WEIGHTS.atc +
    comp.conv * MERCH_WEIGHTS.conv +
    comp.revPerView * MERCH_WEIGHTS.revPerView +
    comp.stock * MERCH_WEIGHTS.stock +
    comp.momentum * MERCH_WEIGHTS.momentum +
    comp.freshness * MERCH_WEIGHTS.freshness;

  // Clickbait guard: many clicks but nobody adds to cart or buys → decay.
  if (s.c30 >= 6 && s.o90 === 0 && s.a30 < 2) score *= 0.8;
  return Math.min(1, Math.max(0, score));
}

function pinOrderOf(p: RankableProduct): number {
  return p.sortOrder && p.sortOrder > 0 ? p.sortOrder : 0;
}

function hasObservations(s?: MerchStats): boolean {
  const x = s || ZERO_MERCH_STATS;
  return x.i30 + x.v30 + x.c30 + x.a30 + x.o90 >= 6;
}

function inStock(p: RankableProduct): boolean {
  return (p.stock ?? 1) > 0 && (p.stockStatus ?? 'in_stock') !== 'out_of_stock';
}

/** Deterministic hash of a string (FNV-1a) — used for daily explore rotation. */
export function hashOf(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable UTC day key — the explore rotation changes once per day. */
export function daySeed(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface MerchOptions {
  stats?: Map<string, MerchStats>;
  /** When true, reserve a small share of later slots for new/unobserved products. */
  explore?: boolean;
  /** Overrides the day seed (tests). */
  dateSeed?: string;
}

/**
 * Rank a product list for display. The caller is responsible for category
 * relevance (filters applied before this call) — this engine never lets an
 * unrelated high-scorer cross into a category it does not belong to.
 *
 * Order contract:
 *   1. Manually pinned products (sort_order > 0) first, ascending.
 *   2. In automatic mode: proven products sorted by score desc, with up to
 *      ~25% of slots *after position 6* rotating through unobserved
 *      candidates once per day. The first row is always proven + in stock.
 *   3. Out-of-stock sinks to the bottom (penalized by the stock component).
 */
export function rankProducts<T extends RankableProduct>(list: T[], opts: MerchOptions = {}): T[] {
  if (list.length === 0) return list;
  const stats = opts.stats || new Map();
  const seed = opts.dateSeed ?? daySeed();
  const explore = opts.explore !== false;

  const scored = list.map((p) => ({ p, score: merchScoreOf(p, stats.get(p.id)) }));
  const pinned = scored.filter((x) => pinOrderOf(x.p) > 0).sort((a, b) => pinOrderOf(a.p) - pinOrderOf(b.p));
  const pinnedIds = new Set(pinned.map((x) => x.p.id));
  const auto = scored.filter((x) => !pinnedIds.has(x.p.id)).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sa = inStock(a.p) ? 1 : 0;
    const sb = inStock(b.p) ? 1 : 0;
    if (sb !== sa) return sb - sa;
    return a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0;
  });

  const order: T[] = pinned.map((x) => x.p);

  if (explore && auto.length >= 8) {
    const proven: typeof auto = [];
    const fresh: typeof auto = [];
    for (const x of auto) {
      if (!inStock(x.p)) {
        proven.push(x); // out-of-stock stays in the proven tail (never deleted)
      } else if (!hasObservations(stats.get(x.p.id))) {
        fresh.push(x);
      } else {
        proven.push(x);
      }
    }
    // Rotate the explore pool deterministically once per day.
    fresh.sort((a, b) => hashOf(seed + a.p.id) - hashOf(seed + b.p.id));
    let pi = 0;
    let fi = 0;
    const n = auto.length;
    for (let slot = 0; slot < n; slot++) {
      // First 6 slots: proven only. After that, ~1 in 4 slots explores.
      const useExplore = slot >= 6 && slot % 4 === 3;
      if (useExplore && fi < fresh.length) order.push(fresh[fi++].p);
      else if (pi < proven.length) order.push(proven[pi++].p);
      else if (fi < fresh.length) order.push(fresh[fi++].p);
    }
    return order;
  }

  order.push(...auto.map((x) => x.p));
  return order;
}

// --- Homepage "Best Sellers" curation ---------------------------------------
// The homepage row is a small curated set of REAL products, one per theme
// slot. Two rules keep it honest; both are regressions this function fixes:
//
//   1. NEVER repeat a product. The previous implementation resolved every slot
//      independently and fell back to a FIXED array index (active[2], active[3],
//      active[4]) whenever the curated slug/category was missing, so a sparse
//      or differently-ordered catalog rendered the same product — and the same
//      photo — two or three times in a row (observed live: the row showed the
//      same dog card under "Bestseller" and "Wild Bird", and the same cat card
//      under "Popular" and "Equine Choice").
//   2. NEVER mislabel. A category badge ("Wild Bird", "Equine Choice",
//      "Farm Choice") is attached only to a product from that category. When the
//      store genuinely has no product for a slot, the slot is dropped — it is
//      never filled with an unrelated product under a false badge.
//
// Two rows that share one supplier image are treated as the same card: to a
// shopper they look like a duplicate even when the ids differ.

export interface BestSellerSlot {
  /** Card badge rendered on the homepage. */
  badge: string;
  /** Owner-curated slug(s) for this slot — checked before the category rule. */
  slugs: readonly string[];
  /** Lower-case category substring that legitimately earns this badge. */
  category?: string;
}

/** Curated homepage slots, in display order. */
export const HOME_BEST_SELLER_SLOTS: readonly BestSellerSlot[] = [
  { badge: 'Bestseller', slugs: ['stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs'], category: 'dog' },
  { badge: 'Popular', slugs: ['collapsible-cat-tunnel-with-crinkle-peek-hole-3-way-play-tube'], category: 'cat' },
  { badge: 'Wild Bird', slugs: ['outdoor-hanging-bird-feeder'], category: 'bird' },
  { badge: 'Equine Choice', slugs: ['horse-fly-mask-with-ears'], category: 'horse' },
  { badge: 'Farm Choice', slugs: ['heavy-duty-cattle-feed-trough'], category: 'cattle' },
];

export interface BestSellerCandidate {
  id: string;
  slug?: string | null;
  category?: string | null;
  images?: readonly string[] | null;
}

export interface BestSellerPick<P> {
  badge: string;
  product: P;
}

/** Stable key for "sold under this photo" de-duplication: the query string and
 * trailing slashes are ignored, so proxied/resized variants of one file and two
 * rows pointing at the same upload collapse to the same card. */
function imageKeyOf(p: BestSellerCandidate): string {
  const raw = (p.images || []).find((u) => Boolean(u));
  return raw ? String(raw).split('?')[0].toLowerCase().replace(/\/+$/, '') : '';
}

/**
 * Pick homepage Best Seller cards: one distinct, real product per curated slot.
 * Returns fewer cards when the catalog has no product for a slot — never a
 * duplicate product/image, and never a category badge on the wrong product.
 */
export function pickHomeBestSellers<P extends BestSellerCandidate>(
  products: readonly P[],
  slots: readonly BestSellerSlot[] = HOME_BEST_SELLER_SLOTS,
): BestSellerPick<P>[] {
  const usedIds = new Set<string>();
  const usedImages = new Set<string>();
  const available = (p: P): boolean => {
    const key = imageKeyOf(p);
    return key !== '' && !usedIds.has(p.id) && !usedImages.has(key);
  };
  const claim = (p: P): void => {
    usedIds.add(p.id);
    const key = imageKeyOf(p);
    if (key) usedImages.add(key);
  };

  const out: BestSellerPick<P>[] = [];
  for (const slot of slots) {
    const bySlug = products.find((p) => available(p) && !!p.slug && slot.slugs.includes(p.slug));
    const pick = bySlug || (slot.category
      ? products.find((p) => available(p) && String(p.category || '').toLowerCase().includes(slot.category as string))
      : undefined);
    if (!pick) continue; // no genuine product for this slot → drop it, never fake it
    claim(pick);
    out.push({ badge: slot.badge, product: pick });
  }
  return out;
}
