import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  rankProducts,
  merchScoreOf,
  markBrokenImage,
  daySeed,
  hashOf,
  emptyMerchStats,
  subscribeVisualQuality,
  getVisualQualityVersion,
  pickHomeBestSellers,
  HOME_BEST_SELLER_SLOTS,
  type MerchStats,
  type RankableProduct,
  type BestSellerCandidate,
} from '../merchandising';

type P = RankableProduct & { id: string };

const mk = (id: string, extra: Partial<P> = {}): P => ({ id, stock: 5, stockStatus: 'in_stock', featured: false, newArrival: false, ...extra });

const stats = (partial: Partial<MerchStats> = {}): MerchStats => ({ ...emptyMerchStats(), ...partial });

function unsubscribeAll() {
  // no-op helpers for visual store cleanup between tests
}

describe('merchScoreOf', () => {
  it('rewards a product with real sales funnel stats over a zero-data product', () => {
    const winner = mk('w', { stock: 5 });
    const newcomer = mk('n', { stock: 5, newArrival: true });
    const s = stats({ i30: 100, i90: 100, v30: 20, v7: 5, c30: 10, a30: 5, o90: 2, q90: 2, r90: 80, m30: 12, m7: 6 });
    expect(merchScoreOf(winner, s)).toBeGreaterThan(merchScoreOf(newcomer, undefined));
  });

  it('never lets 1 view + 1 purchase dominate (Bayesian smoothing)', () => {
    const lucky = mk('l');
    const proven = mk('p');
    // 1 view 1 purchase looks perfect on raw rates…
    const luckyStats = stats({ v30: 1, o90: 1, q90: 1, r90: 50, m7: 1, m30: 2 });
    // …but a product with a large, healthy funnel should still beat it.
    const provenStats = stats({ v30: 200, i30: 900, i90: 900, c30: 90, a30: 60, o90: 30, q90: 40, r90: 1200, m7: 120, m30: 300 });
    expect(merchScoreOf(proven, provenStats)).toBeGreaterThan(merchScoreOf(lucky, luckyStats));
  });

  it('penalizes high-CTR zero-conversion clickbait', () => {
    const clickbait = mk('cb', { stock: 5 });
    const converting = mk('cv', { stock: 5 });
    const cb = stats({ i30: 400, i90: 400, v30: 60, c30: 120, a30: 1, o90: 0, m7: 40, m30: 120 });
    const cv = stats({ i30: 400, i90: 400, v30: 60, c30: 120, a30: 40, o90: 10, q90: 12, r90: 400, m7: 50, m30: 150 });
    expect(merchScoreOf(clickbait, cb)).toBeLessThan(merchScoreOf(converting, cv));
  });
});

describe('rankProducts', () => {
  const base = [
    mk('a', { stock: 3 }),
    mk('b', { stock: 3 }),
    mk('c', { stock: 3 }),
    mk('d', { stock: 3 }),
    mk('e', { stock: 3 }),
    mk('f', { stock: 3 }),
    mk('g', { stock: 3 }),
    mk('h', { stock: 3 }),
    mk('i', { stock: 3 }),
    mk('j', { stock: 3 }),
  ];

  it('sinks out-of-stock products to the bottom', () => {
    const list = [mk('oos', { stock: 0, stockStatus: 'out_of_stock', newArrival: true }), ...base];
    const out = rankProducts(list, { explore: false });
    expect(out[out.length - 1].id).toBe('oos');
  });

  it('is deterministic within the same day', () => {
    const seed = daySeed();
    const a = rankProducts(base, { explore: true, dateSeed: seed });
    const b = rankProducts(base, { explore: true, dateSeed: seed });
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });

  it('rotates the explore share day to day (not a fixed order)', () => {
    const day1 = '2026-09-01';
    const day2 = '2026-09-02';
    // 12 products: 8 with observations (proven) + 4 brand-new (explore pool)
    const proven = Array.from({ length: 8 }, (_, i) => mk(`p${i}`, { stock: 4 }));
    const fresh = Array.from({ length: 4 }, (_, i) => mk(`n${i}`, { stock: 4, newArrival: true }));
    const map = new Map<string, MerchStats>();
    proven.forEach((p) => map.set(p.id, stats({ v30: 30, i30: 150, i90: 150, c30: 15, a30: 8, o90: 3, q90: 3, r90: 90, m7: 12, m30: 25 })));
    const r1 = rankProducts([...proven, ...fresh], { stats: map, explore: true, dateSeed: day1 });
    const r2 = rankProducts([...proven, ...fresh], { stats: map, explore: true, dateSeed: day2 });
    // First six positions must be proven winners on both days.
    for (const day of [r1, r2]) {
      for (const p of day.slice(0, 6)) expect(p.id.startsWith('p')).toBe(true);
    }
    // Both days give fresh products exposure, and the day-2 order differs.
    const freshInR1 = r1.filter((p) => p.id.startsWith('n')).map((p) => p.id);
    const freshInR2 = r2.filter((p) => p.id.startsWith('n')).map((p) => p.id);
    expect(freshInR1.length).toBeGreaterThan(0);
    expect(freshInR2.length).toBeGreaterThan(0);
    expect(freshInR1.join()).not.toBe(freshInR2.join());
  });

  it('puts manually pinned products (sort_order > 0) first, ascending', () => {
    const list = [
      mk('pin2', { sortOrder: 2 }),
      ...base,
      mk('pin1', { sortOrder: 1 }),
    ];
    const out = rankProducts(list, { explore: false });
    expect(out.slice(0, 2).map((p) => p.id)).toEqual(['pin1', 'pin2']);
  });

  it('ranks real winners ahead of unobserved products (no explore, >8 items)', () => {
    const map = new Map<string, MerchStats>();
    const winners = Array.from({ length: 9 }, (_, i) => mk(`w${i}`));
    const fresh = Array.from({ length: 4 }, (_, i) => mk(`f${i}`, { newArrival: true }));
    winners.forEach((p) => map.set(p.id, stats({ v30: 40, i30: 200, i90: 200, c30: 20, a30: 10, o90: 4, q90: 5, r90: 200, m7: 15, m30: 30 })));
    const out = rankProducts([...winners, ...fresh], { stats: map, explore: false });
    expect(out[0].id.startsWith('w')).toBe(true);
    expect(out[1].id.startsWith('w')).toBe(true);
  });
});

describe('visual quality store', () => {
  let seen = 0;
  let unsub: () => void;
  beforeEach(() => {
    seen = getVisualQualityVersion();
    unsub = subscribeVisualQuality(() => { seen += 1; });
  });
  afterEach(() => { unsub(); unsubscribeAll(); });

  it('marks a broken image and notifies subscribers', () => {
    const before = seen;
    markBrokenImage('broken-1');
    expect(getVisualQualityVersion()).toBeGreaterThan(before);
    // broken product can no longer rank as well as an untouched product
    const a = mk('broken-1');
    const b = mk('ok-1');
    const scored = [b, a].map((p) => merchScoreOf(p));
    expect(scored[1]).toBeLessThan(scored[0]);
    expect(seen).toBeGreaterThanOrEqual(before);
  });
});

describe('pickHomeBestSellers', () => {
  const item = (id: string, category: string, slug: string, image: string): BestSellerCandidate => ({
    id, category, slug, images: [image],
  });

  // The live regression: a 7-product visible catalog with no bird/horse/cattle
  // rows. The old fixed-index fallbacks (active[2], active[3]) re-rendered the
  // Bestseller and Popular products under the "Wild Bird"/"Equine Choice"
  // badges, so the homepage showed the same two cards twice.
  const liveBugShape: BestSellerCandidate[] = [
    item('shirt', 'Dog Supplies', 'dog-clothes-spring-and-summer-clothing', 'https://img.example.test/pet-shirt.jpg'),
    item('hammock', 'Cat Supplies', 'cat-window-perch-suction-cup-hammock-seat-for-sunbathing', 'https://img.example.test/hammock.jpg'),
    item('carrier', 'Pet Accessories', 'foldable-pet-travel-carrier-backpack', 'https://img.example.test/carrier.jpg'),
  ];

  it('never repeats a product (or its photo) across slots', () => {
    const picks = pickHomeBestSellers(liveBugShape);
    const ids = picks.map((p) => p.product.id);
    expect(new Set(ids).size).toBe(ids.length);
    const images = picks.map((p) => p.product.images![0]);
    expect(new Set(images).size).toBe(images.length);
    // Only genuine dog/cat products exist → only those two curated slots render.
    expect(ids).toEqual(['shirt', 'hammock']);
  });

  it('never attaches a category badge to a product from another category', () => {
    const picks = pickHomeBestSellers(liveBugShape);
    for (const { badge, product } of picks) {
      if (badge === 'Wild Bird') expect(product.category).toContain('Bird');
      if (badge === 'Equine Choice') expect(product.category).toContain('Horse');
      if (badge === 'Farm Choice') expect(product.category).toContain('Cattle');
    }
    // The accessory row must never inherit a species badge either.
    expect(picks.some((p) => p.product.id === 'carrier')).toBe(false);
  });

  it('treats two rows sharing one supplier image as the same card', () => {
    const sameePhoto: BestSellerCandidate[] = [
      item('bed-a', 'Dog Supplies', 'dog-bed', 'https://img.example.test/bed.jpg?w=500'),
      item('bed-b', 'Dog Supplies', 'cozy-cat-nest-bed', 'https://img.example.test/bed.jpg?w=800'),
    ];
    const picks = pickHomeBestSellers(sameePhoto);
    expect(picks).toHaveLength(1);
    expect(picks[0].product.id).toBe('bed-a');
  });

  it('prefers the owner-curated slug over the first category match', () => {
    const products: BestSellerCandidate[] = [
      item('first-dog', 'Dog Supplies', 'some-other-dog-item', 'https://img.example.test/a.jpg'),
      item('fountain', 'Dog Supplies', 'stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs', 'https://img.example.test/b.jpg'),
    ];
    const picks = pickHomeBestSellers(products);
    expect(picks[0].badge).toBe('Bestseller');
    expect(picks[0].product.id).toBe('fountain');
  });

  it('fills every slot when the full catalog has each curated category', () => {
    const full: BestSellerCandidate[] = [
      item('fountain', 'Dog Supplies', 'stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs', 'https://img.example.test/1.jpg'),
      item('tunnel', 'Cat Supplies', 'collapsible-cat-tunnel-with-crinkle-peek-hole-3-way-play-tube', 'https://img.example.test/2.jpg'),
      item('feeder', 'Bird Supplies', 'outdoor-hanging-bird-feeder', 'https://img.example.test/3.jpg'),
      item('flymask', 'Horse', 'horse-fly-mask-with-ears', 'https://img.example.test/4.jpg'),
      item('trough', 'Cattle', 'heavy-duty-cattle-feed-trough', 'https://img.example.test/5.jpg'),
    ];
    const picks = pickHomeBestSellers(full);
    expect(picks.map((p) => p.badge)).toEqual(HOME_BEST_SELLER_SLOTS.map((s) => s.badge));
    expect(picks.map((p) => p.product.id)).toEqual(['fountain', 'tunnel', 'feeder', 'flymask', 'trough']);
  });

  it('ignores products without a usable image', () => {
    const picks = pickHomeBestSellers([
      { id: 'noimage', category: 'Dog Supplies', slug: 'dog-bed' },
      item('withimage', 'Dog Supplies', 'dog-bed-2', 'https://img.example.test/6.jpg'),
    ]);
    expect(picks.map((p) => p.product.id)).toEqual(['withimage']);
  });
});

describe('helpers', () => {
  it('hashOf is deterministic and varies by input', () => {
    expect(hashOf('2026-09-01p1')).toBe(hashOf('2026-09-01p1'));
    expect(hashOf('2026-09-01p1')).not.toBe(hashOf('2026-09-01p2'));
  });
  it('daySeed is a stable UTC date key', () => {
    expect(daySeed(Date.parse('2026-09-07T23:59:00Z'))).toBe('2026-09-07');
    expect(daySeed(Date.parse('2026-09-07T00:00:00Z'))).toBe('2026-09-07');
  });
});
