// ============================================================================
// LUXEDGE — CAMPAIGN ENGINE tests
//
// Pure logic: status windows, margin-protected pricing tiers, claim codes,
// deterministic dedupe order numbers, templates, slug safety.
// Handler-level: public state/claim + admin manager actions against a stubbed
// PostgREST (no payment fields, $0 totals, marker coupon, atomic duplicate
// rejection, inventory gating, flags persistence, status transitions).
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));

const { requireAdmin } = await import('../_lib/auth.js');

const HOST = 'https://probe.supabase.co';
const KEY = 'svc-key';

function makeRes(): { captured: { status: number; body: unknown }; server: ServerResponse } {
  const captured = { status: 200, body: null as unknown };
  const server = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (body: unknown) => {
      captured.status = (server as { statusCode: number }).statusCode;
      captured.body = typeof body === 'string' ? JSON.parse(body) : body;
    },
  } as unknown as ServerResponse;
  return { captured, server };
}

function makeReq(method: string, payload?: Record<string, unknown>, url = '/api/campaigns'): IncomingMessage {
  const body = payload ? JSON.stringify(payload) : '';
  const r = {
    method,
    url,
    headers: payload ? { 'content-type': 'application/json' } : {},
    socket: { remoteAddress: '203.0.113.7' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data' && body) process.nextTick(() => fn(Buffer.from(body)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

// ---------------------------------------------------------------------------
describe('campaign engine — pure logic', () => {
  it('resolves status from start/end windows', async () => {
    const lib = await import('../_lib/campaigns.js');
    const now = Date.now();
    const base = (p: Partial<import('../_lib/campaigns.js').CampaignConfig>) => ({
      slug: 'x', kind: 'gift' as const, templateKey: 'custom' as const, status: 'live' as const,
      title: 'x', totalQuantity: 10, offer: {}, ...p,
    });
    expect(lib.campaignStatusAt(base({ status: 'draft' }), now)).toBe('draft');
    expect(lib.campaignStatusAt(base({ status: 'paused' }), now)).toBe('paused');
    expect(lib.campaignStatusAt(base({ status: 'archived' }), now)).toBe('archived');
    expect(lib.campaignStatusAt(base({ startsAt: new Date(now + 86_400_000).toISOString() }), now)).toBe('scheduled');
    expect(lib.campaignStatusAt(base({ endsAt: new Date(now - 1000).toISOString() }), now)).toBe('ended');
    expect(lib.campaignStatusAt(base({}), now)).toBe('live');
    expect(lib.campaignIsAccepting(base({ status: 'paused' }), now)).toBe(false);
    expect(lib.campaignIsAccepting(base({}), now)).toBe(true);
  });

  it('prices free tier at $0 and premium with margin cap', async () => {
    const lib = await import('../_lib/campaigns.js');
    const cfg: import('../_lib/campaigns.js').CampaignConfig = {
      slug: 'g', kind: 'gift', templateKey: 'custom', status: 'live', title: 'G',
      totalQuantity: 10,
      offer: { freeThresholdCents: 1500, premiumPercentOff: 50, maxDiscountCents: 1500, maxEligibleRetailCents: 6000 },
    };
    // ≤ threshold → free
    expect(lib.engineProductPrice(cfg, 1200)).toEqual({ tier: 'free', priceCents: 0, discountCents: 1200 });
    // premium: 50% off, cap $15
    expect(lib.engineProductPrice(cfg, 3000)).toEqual({ tier: 'premium', priceCents: 1500, discountCents: 1500 });
    // retail 6000 → 50% = 3000 raw discount, but the $15 cap binds → $45 price
    expect(lib.engineProductPrice(cfg, 6000)).toEqual({ tier: 'premium', priceCents: 4500, discountCents: 1500 });
    // above maxEligibleRetail → not eligible
    expect(lib.engineProductPrice(cfg, 7000).tier).toBe('ineligible');
    // no premium percent configured → not eligible above threshold
    const cfgNoPremium: import('../_lib/campaigns.js').CampaignConfig = {
      slug: 'g', kind: 'gift', templateKey: 'custom', status: 'live', title: 'G', totalQuantity: 1,
      offer: { freeThresholdCents: 1500, premiumPercentOff: 0 },
    };
    expect(lib.engineProductPrice(cfgNoPremium, 2500).tier).toBe('ineligible');
  });

  it('honours per-product flag overrides + exclusions safely', async () => {
    const lib = await import('../_lib/campaigns.js');
    const cfg: import('../_lib/campaigns.js').CampaignConfig = {
      slug: 'g', kind: 'gift', templateKey: 'custom', status: 'live', title: 'G', totalQuantity: 10,
      offer: { freeThresholdCents: 1500, premiumPercentOff: 50, maxDiscountCents: 1500, maxEligibleRetailCents: 8000, productScope: 'included' },
    };
    // scope=included + no flag → ineligible (opt-in only)
    expect(lib.engineProductPrice(cfg, 1200, null).tier).toBe('ineligible');
    // flagged gift-eligible below threshold → free
    expect(lib.engineProductPrice(cfg, 1200, { giftEligible: true })).toEqual({ tier: 'free', priceCents: 0, discountCents: 1200 });
    // allowFree beats the price ceiling (owner opt-in)
    const cfgCeiling: import('../_lib/campaigns.js').CampaignConfig = {
      slug: 'g', kind: 'gift', templateKey: 'custom', status: 'live', title: 'G', totalQuantity: 10,
      offer: { freeThresholdCents: 1500, premiumPercentOff: 0, maxEligibleRetailCents: 2000 },
    };
    expect(lib.engineProductPrice(cfgCeiling, 5000, { giftEligible: true, allowFree: true })).toEqual({ tier: 'free', priceCents: 0, discountCents: 5000 });
    // product-level discount cap is tighter than campaign cap
    const premium = lib.engineProductPrice(cfg, 5000, { giftEligible: true, maxDiscountCents: 1000 });
    expect(premium.tier).toBe('premium');
    expect(premium.discountCents).toBe(1000);
    expect(premium.priceCents).toBe(4000);
  });

  it('generates human-readable claim codes with correct shape', async () => {
    const lib = await import('../_lib/campaigns.js');
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = lib.generateClaimCode();
      expect(lib.isValidClaimCodeShape(c)).toBe(true);
      codes.add(c);
    }
    expect(codes.size).toBe(200);
    expect(lib.isValidClaimCodeShape('LXG-7K3P-92A')).toBe(true);
    expect(lib.isValidClaimCodeShape('LXG-7K3P-92A ')).toBe(true); // trims
    expect(lib.isValidClaimCodeShape('lxg-7k3p-92a')).toBe(true); // uppercases
    expect(lib.isValidClaimCodeShape('GIFT-XYZ')).toBe(false);
    expect(lib.isValidClaimCodeShape('LXG-OOOO-AAA')).toBe(false); // no 0/O in alphabet
  });

  it('dedupes deterministically per campaign+email, flagship matches legacy scheme', async () => {
    const lib = await import('../_lib/campaigns.js');
    const a = lib.claimOrderNumber('flash-sale', 'ada@example.com');
    const b = lib.claimOrderNumber('flash-sale', 'ADA@Example.com ');
    const c = lib.claimOrderNumber('other', 'ada@example.com');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^GIFT-[0-9A-F]{8}$/);
    // flagship reproduces the ORIGINAL gift-drop algorithm exactly
    const legacy = await import('../_lib/gift-drop.js');
    expect(lib.legacyGiftOrderNumber('ada@example.com')).toBe(legacy.giftOrderNumber('ada@example.com'));
  });

  it('provides all twelve templates with sane defaults', async () => {
    const lib = await import('../_lib/campaigns.js');
    const keys = lib.templateKeys();
    expect(keys.length).toBe(14);
    for (const k of keys) {
      const cfg = lib.campaignFromTemplate(k, 'demo-campaign');
      expect(cfg).not.toBeNull();
      expect(cfg!.slug).toBe('demo-campaign');
      expect(cfg!.status).toBe('draft');
      expect(cfg!.title.length).toBeGreaterThan(0);
    }
    const gift = lib.campaignFromTemplate('free_pet_gift', 'pet-gift-drop')!;
    expect(gift.kind).toBe('gift');
    expect(gift.offer.freeShipping).toBe(true);
    expect(lib.campaignFromTemplate('nope', 'x')).toBeNull();
  });

  it('sanitizes slugs', async () => {
    const lib = await import('../_lib/campaigns.js');
    expect(lib.slugifyCampaign('  Pet Gift Drop! ')).toBe('pet-gift-drop');
    expect(lib.slugifyCampaign('')).toBe('campaign');
    expect(lib.slugifyCampaign('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/campaigns/claim + GET state (stubbed DB)', () => {
  const validClaim = {
    slug: 'cat-lovers-gift',
    firstName: 'Ada',
    email: 'ada@example.com',
    petType: 'cat',
    petName: 'Miso',
    address: { line1: '12 Woof Lane', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
    marketingOptIn: true,
    company: '',
    formSeconds: 42,
  };

  const registryCfg = {
    slug: 'cat-lovers-gift',
    kind: 'gift',
    templateKey: 'free_pet_gift',
    status: 'live',
    title: 'Cat Lovers Gift',
    giftName: 'Cat gift',
    giftValueCents: 1500,
    totalQuantity: 20,
    startsAt: null,
    endsAt: null,
    audience: { petTypes: ['cat'] },
    eligibility: { onePerEmail: true, onePerHousehold: true },
    offer: { freeThresholdCents: 1500, freeShipping: true, productScope: 'all', maxDiscountCents: 1500 },
    popup: { enabled: false },
    referral: { enabled: false },
    email: { enabled: true },
  };

  const claimedRow = (i: number) => ({
    id: `11111111-1111-1111-1111-1111111111${String(i).padStart(2, '0')}`,
    order_number: `GIFT-${String(i).padStart(8, 'A')}`,
    shipping_address: { line1: '12 Woof Lane', zip: '78701', _gift: { campaignSlug: 'cat-lovers-gift', isTest: false } },
  });

  /** Stub: registry doc, real claimed row lists, household scan. */
  function stubDb(opts: { claimed?: number; duplicate?: boolean; household?: boolean; noDb?: boolean } = {}) {
    const claimed = opts.claimed ?? 1;
    const inserted: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    if (opts.noDb) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
      return { inserted, calls };
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || 'GET';
        calls.push(`${method} ${url.split(HOST)[1] || url}`);
        if (url.includes('/rest/v1/app_settings') && url.includes('luxedge_campaigns_v1')) {
          return new Response(JSON.stringify([{ value: JSON.stringify({ campaigns: [registryCfg] }) }]), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/rest/v1/app_settings') && url.includes('luxedge_campaign_products_v1')) {
          return new Response(JSON.stringify([{ value: '{}' }]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/rest/v1/app_settings') && url.includes('gift_drop_campaign_v1')) {
          // flagship fallback — only when the flagship slug is used
          return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/rest/v1/products')) {
          return new Response(JSON.stringify([{ id: 'prod1', name: 'Feather Wand', price: 12.95, image_url: null, stock_status: 'in_stock' }]), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/rest/v1/luxedge_orders')) {
          if (method === 'POST') {
            const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
            inserted.push(body);
            if (opts.duplicate) {
              return new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "luxedge_orders_order_number_key"' }), {
                status: 409, headers: { 'content-type': 'application/json' },
              });
            }
            return new Response(
              JSON.stringify([{ id: '11111111-1111-1111-1111-111111111111', order_number: body.order_number, ...body }]),
              { status: 201, headers: { 'content-type': 'application/json' } },
            );
          }
          if (method === 'PATCH') {
            return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
          }
          if (url.includes('select=shipping_address')) {
            // liveClaimCount → real claimed rows for this campaign
            const rows = Array.from({ length: claimed }, (_, i) => claimedRow(i));
            return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          // household scan (select=id,shipping_address)
          const mine = { id: '11111111-1111-1111-1111-111111111111', shipping_address: { line1: '12 Woof Lane', zip: '78701', _gift: { campaignSlug: 'cat-lovers-gift', isTest: false } } };
          const other = { id: '22222222-2222-2222-2222-222222222222', shipping_address: { line1: '12 woof lane', zip: '78701', _gift: { campaignSlug: 'cat-lovers-gift', isTest: false } } };
          return new Response(JSON.stringify(opts.household ? [mine, other] : [mine]), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    return { inserted, calls };
  }

  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('rejects invalid payloads before DB', async () => {
    const { claimHandler } = await import('../campaigns.js');
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', { ...validClaim, email: 'nope' }), server);
    expect(captured.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a pet type outside the campaign audience', async () => {
    const { claimHandler } = await import('../campaigns.js');
    stubDb();
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', { ...validClaim, petType: 'dog' }), server);
    expect(captured.status).toBe(400);
    expect(String((captured.body as { error: string }).error)).toContain('cat');
  });

  it('404 when the campaign does not exist (flagship has no legacy doc)', async () => {
    const { claimHandler } = await import('../campaigns.js');
    stubDb();
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', { ...validClaim, slug: 'pet-gift-drop' }), server);
    // no legacy gift-drop doc → flagship resolves null → 404
    expect(captured.status).toBe(404);
  });

  it('409 full when inventory exhausted', async () => {
    const { claimHandler } = await import('../campaigns.js');
    stubDb({ claimed: 20 });
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(409);
    expect((captured.body as { full?: boolean }).full).toBe(true);
  });

  it('creates a $0 claim with no payment fields + claim code recorded', async () => {
    const { claimHandler } = await import('../campaigns.js');
    const db = stubDb();
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; payment: string; totalCents: number; claimCode: string; orderNumber: string };
    expect(b.ok).toBe(true);
    expect(b.payment).toBe('NOT_REQUIRED');
    expect(b.claimCode).toMatch(/^LXG-/);
    expect(b.orderNumber).toMatch(/^GIFT-[0-9A-F]{8}$/);
    const inserted = db.inserted[0] as Record<string, unknown>;
    expect(inserted.coupon_code).toBe('PET-GIFT-DROP');
    expect(inserted.total).toBe(0);
    const g = (inserted.shipping_address as { _gift: Record<string, unknown> })._gift;
    expect(g.campaignSlug).toBe('cat-lovers-gift');
    expect(g.claimCode).toBe(b.claimCode);
    expect(g.payment).toBe('NOT_REQUIRED');
    const keys = Object.keys(inserted);
    expect(keys).not.toContain('stripe_session_id');
    expect(keys).not.toContain('stripe_payment_intent');
  });

  it('selecting a free-eligible product claims that product at $0', async () => {
    const { claimHandler } = await import('../campaigns.js');
    const db = stubDb();
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', { ...validClaim, productId: 'prod1' }), server);
    expect(captured.status).toBe(200);
    const inserted = db.inserted[0] as Record<string, unknown>;
    const g = (inserted.shipping_address as { _gift: Record<string, unknown> })._gift as { product?: { id: string; name: string; valueCents: number } };
    expect(g.product).toMatchObject({ id: 'prod1', valueCents: 1295 });
    expect((inserted.items as Array<{ id?: string }>)[0].id).toBe('prod1');
  });

  it('rejects duplicate email atomically', async () => {
    const { claimHandler } = await import('../campaigns.js');
    stubDb({ duplicate: true });
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(409);
    expect(String((captured.body as { error: string }).error)).toContain('already claimed');
  });

  it('self-cancels + rejects duplicate household', async () => {
    const { claimHandler } = await import('../campaigns.js');
    stubDb({ household: true });
    const { server, captured } = makeRes();
    await claimHandler(makeReq('POST', validClaim), server);
    expect(captured.status).toBe(409);
    expect(String((captured.body as { error: string }).error)).toContain('household');
  });

  it('GET state returns real inventory + offer', async () => {
    const { stateHandler } = await import('../campaigns.js');
    stubDb({ claimed: 15 });
    const { server, captured } = makeRes();
    await stateHandler(makeReq('GET', undefined, '/api/campaigns/state?slug=cat-lovers-gift&eligible=1'), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { active: boolean; total: number; remaining: number; eligible?: unknown[]; kind: string };
    expect(b.kind).toBe('gift');
    expect(b.total).toBe(20);
    expect(b.remaining).toBe(5);
    expect(Array.isArray(b.eligible)).toBe(true);
  });

  it('GET list returns live campaigns only', async () => {
    const { listHandler } = await import('../campaigns.js');
    stubDb({ claimed: 15 });
    const { server, captured } = makeRes();
    await listHandler(makeReq('GET'), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { campaigns: Array<{ slug: string }> };
    expect(b.campaigns.some((c) => c.slug === 'cat-lovers-gift')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/admin/campaigns (stubbed DB)', () => {
  const regDoc = { campaigns: [{ slug: 'flash-sale', kind: 'promo', templateKey: 'flash_sale', status: 'live', title: 'Flash', totalQuantity: 0, offer: { discountPercentOff: 25 } }] };

  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.clearAllMocks();
  });

  function stubRegistry() {
    const settings: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || 'GET';
        if (url.includes('/rest/v1/app_settings')) {
          if (method === 'POST') {
            const b = JSON.parse(String(init?.body)) as { key: string; value: string };
            settings[b.key] = b.value;
            return new Response(JSON.stringify([{ key: b.key, value: b.value }]), { status: 201, headers: { 'content-type': 'application/json' } });
          }
          const m = url.match(/key=eq\.([^&]+)/);
          const key = m ? decodeURIComponent(m[1]) : '';
          if (key === 'luxedge_campaigns_v1' && !settings[key]) return new Response(JSON.stringify([{ value: JSON.stringify(regDoc) }]), { status: 200 });
          if (key === 'luxedge_campaigns_v1' && settings[key]) return new Response(JSON.stringify([{ value: settings[key] }]), { status: 200 });
          if (key === 'luxedge_campaign_products_v1') return new Response(JSON.stringify([{ value: '{}' }]), { status: 200 });
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/rest/v1/luxedge_orders')) {
          if (method === 'POST') return new Response(JSON.stringify([{ id: '1', order_number: 'X' }]), { status: 201 });
          return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    return settings;
  }

  it('lists the registry as the manager dashboard', async () => {
    stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const { server, captured } = makeRes();
    await handler(makeReq('GET'), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; campaigns: unknown[]; templates: unknown[]; flags: unknown };
    expect(b.ok).toBe(true);
    expect(Array.isArray(b.campaigns)).toBe(true);
    expect(Array.isArray(b.templates)).toBe(true);
  });

  it('creates a campaign from a template', async () => {
    stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const { server, captured } = makeRes();
    await handler(makeReq('POST', { action: 'create', templateKey: 'cat_lovers', slug: 'cat-spring-event' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { ok: boolean; campaign: { slug: string; kind: string; status: string } };
    expect(b.ok).toBe(true);
    expect(b.campaign.slug).toBe('cat-spring-event');
    expect(b.campaign.kind).toBe('promo');
    expect(b.campaign.status).toBe('draft');
  });

  it('rejects duplicate slugs', async () => {
    stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const { server, captured } = makeRes();
    await handler(makeReq('POST', { action: 'create', templateKey: 'cat_lovers', slug: 'flash-sale' }), server);
    expect(captured.status).toBe(409);
  });

  it('saves config updates with coerced numbers', async () => {
    const settings = stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const { server, captured } = makeRes();
    await handler(makeReq('POST', {
      action: 'save',
      config: { slug: 'flash-sale', status: 'paused', totalQuantity: '10', offer: { discountPercentOff: '30' } },
    }), server);
    expect(captured.status).toBe(200);
    const saved = JSON.parse(settings.luxedge_campaigns_v1) as { campaigns: Array<{ slug: string; status: string; totalQuantity: number; offer: Record<string, unknown> }> };
    const c = saved.campaigns.find((x) => x.slug === 'flash-sale')!;
    expect(c.status).toBe('paused');
    expect(c.totalQuantity).toBe(10);
  });

  it('duplicates a campaign under a new slug as draft', async () => {
    stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const { server, captured } = makeRes();
    await handler(makeReq('POST', { action: 'duplicate', slug: 'flash-sale', newSlug: 'flash-sale-round2' }), server);
    expect(captured.status).toBe(200);
    const b = captured.body as { campaign: { slug: string; status: string } };
    expect(b.campaign.slug).toBe('flash-sale-round2');
    expect(b.campaign.status).toBe('draft');
  });

  it('archives a campaign (soft delete)', async () => {
    const settings = stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const { server, captured } = makeRes();
    await handler(makeReq('POST', { action: 'archive', slug: 'flash-sale' }), server);
    expect(captured.status).toBe(200);
    const saved = JSON.parse(settings.luxedge_campaigns_v1) as { campaigns: unknown[] };
    expect(saved.campaigns.length).toBe(0);
  });

  it('persists product flags', async () => {
    const settings = stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const { server, captured } = makeRes();
    await handler(makeReq('POST', {
      action: 'flags',
      map: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': { giftEligible: true, maxDiscountCents: '800' } },
    }), server);
    expect(captured.status).toBe(200);
    const saved = JSON.parse(settings.luxedge_campaign_products_v1) as Record<string, { giftEligible: boolean; maxDiscountCents: number }>;
    expect(saved['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'].giftEligible).toBe(true);
    expect(saved['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'].maxDiscountCents).toBe(800);
  });

  it('rejects illegal claim status transition', async () => {
    stubRegistry();
    const handler = (await import('../admin/campaigns.js')).default;
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      order_number: 'GIFT-AAAAAAAA',
      status: 'pending',
      coupon_code: 'PET-GIFT-DROP',
      shipping_address: { line1: 'a', zip: 'b', _gift: { campaignSlug: 'flash-sale' } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/rest/v1/app_settings')) {
          return new Response(JSON.stringify([{ value: JSON.stringify(regDoc) }]), { status: 200 });
        }
        if (url.includes('/rest/v1/luxedge_orders') && (init?.method || 'GET') === 'GET') {
          return new Response(JSON.stringify([row]), { status: 200 });
        }
        return new Response('[]', { status: 200 });
      }),
    );
    const { server, captured } = makeRes();
    await handler(makeReq('POST', { action: 'claim-status', id: row.id, status: 'delivered' }), server);
    expect(captured.status).toBe(400);
    expect(String((captured.body as { error: string }).error)).toContain('Cannot move');
  });
});

// ---------------------------------------------------------------------------
// FLAGSHIP BRIDGE — the shared resolver every surface now uses
//
// The Campaign Manager asked loadCampaignBySlug() for the flagship and got null
// whenever the registry held no `pet-gift-drop` entry — even when the legacy
// gift-drop document was perfectly readable. These tests pin the read-only
// bridge and its honest failure mode (never a fabricated default config).
// ---------------------------------------------------------------------------
describe('flagship bridge — loadCampaignBySlug', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = HOST;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  function stubLegacy(value: string | null, status = 200) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('luxedge_campaigns_v1')) {
          return new Response(JSON.stringify([{ value: JSON.stringify({ campaigns: [] }) }]), { status: 200 });
        }
        if (url.includes('gift_drop_campaign_v1')) {
          return new Response(
            status === 200 ? JSON.stringify(value === null ? [] : [{ value }]) : JSON.stringify({ message: 'exceed_egress_quota' }),
            { status },
          );
        }
        return new Response('[]', { status: 200 });
      }),
    );
  }

  it('resolves the flagship from the legacy document when the registry has no entry', async () => {
    stubLegacy(JSON.stringify({
      active: true,
      title: 'Pet Gift Drop',
      message: 'Free gift for pet owners',
      giftName: 'Luxedge gift',
      giftValueCents: 1500,
      totalQuantity: 40,
      startsAt: null,
      endsAt: null,
    }));
    const { loadCampaignBySlug } = await import('../_lib/campaigns.js');
    const cfg = await loadCampaignBySlug('pet-gift-drop');
    expect(cfg?.slug).toBe('pet-gift-drop');
    expect(cfg?.kind).toBe('gift');
    expect(cfg?.title).toBe('Pet Gift Drop');
    expect(cfg?.giftName).toBe('Luxedge gift');
    expect(cfg?.giftValueCents).toBe(1500);
    expect(cfg?.totalQuantity).toBe(40);
    expect(cfg?.offer.freeShipping).toBe(true);
    expect(cfg?.status).toBe('live');
  });

  it('never fabricates a flagship when the legacy document is unreadable (402)', async () => {
    stubLegacy(null, 402);
    const { loadCampaignBySlug } = await import('../_lib/campaigns.js');
    expect(await loadCampaignBySlug('pet-gift-drop')).toBeNull();
  });

  it('keeps the bridge exclusive to the flagship slug', async () => {
    stubLegacy(JSON.stringify({ active: true, title: 'Pet Gift Drop' }));
    const { loadCampaignBySlug } = await import('../_lib/campaigns.js');
    expect(await loadCampaignBySlug('some-other-campaign')).toBeNull();
  });
});
