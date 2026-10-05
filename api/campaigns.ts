// ============================================================================
// LUXEDGE — CAMPAIGN ENGINE public endpoints
//
//   GET  /api/campaigns                 → public index of live campaigns
//   GET  /api/campaigns/state?slug=…    → one campaign's public state
//   GET  /api/campaigns/eligible?slug=… → eligible products + server-computed
//                                         gift prices (margin-protected)
//   POST /api/campaigns/claim           → claim a gift / issue a claim code
//
// SECURITY / SAFETY
//   - Campaign inventory + eligibility are always checked server-side.
//   - A $0 gift claim creates the order row DIRECTLY with payment
//     NOT_REQUIRED (no Stripe, no card). A premium-tier selection is never
//     auto-priced client-side: it returns the engine-computed gift price and
//     the storefront completes it through the normal checkout flow.
//   - One-per-email per campaign is atomic via the deterministic
//     order_number unique constraint (same mechanism as the original Gift
//     Drop). Duplicate household claims are scanned + self-cancelled.
//   - Public claims can never self-mark as tests (GIFT_TEST_KEY is a dev-only
//     secret, never present in production).
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, clientIp, InMemoryRateLimiter } from './_lib/providers.js';
import {
  CLAIM_MARKER,
  FLAGSHIP_SLUG,
  campaignIsAccepting,
  campaignPublicState,
  campaignStatusAt,
  claimOrderNumber,
  engineProductPrice,
  generateClaimCode,
  isValidEmail,
  legacyGiftOrderNumber,
  loadCampaignBySlug,
  loadProductFlags,
  loadRegistry,
  liveClaimCount,
  normalizeEmail,
  normalizeHouse,
  remainingFor,
  slugifyCampaign,
  supabaseEnv,
  supabaseHeadersFor,
  type CampaignConfig,
  type ClaimEnvelope,
} from './_lib/campaigns.js';
const claimLimiter = new InMemoryRateLimiter();

/** Bridge: flagship campaign config = the legacy gift-drop doc (single source
 * of truth so the original page/API keep working with zero regression). The
 * mapping itself lives in `_lib/campaigns.ts` so the public routes, the state/
 * claim handlers AND the admin Campaign Manager all resolve the flagship the
 * same way — that shared path is what the Campaign Manager was missing. */
async function resolveCampaign(slug: string): Promise<CampaignConfig | null> {
  return loadCampaignBySlug(slugifyCampaign(slug));
}

/** Reads published products for eligibility computation. */
async function fetchPublishedProducts(): Promise<Array<{ id: string; name: string; price: number; image_url?: string | null; slug?: string | null; stock_status?: string | null }>> {
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/products?select=id,name,price,image_url,slug,stock_status,status&status=in.(active,published)&limit=500`,
      { headers: supabaseHeadersFor(serviceRole), signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      price: Number(r.price) || 0,
      image_url: r.image_url ? String(r.image_url) : null,
      slug: r.slug ? String(r.slug) : null,
      stock_status: r.stock_status ? String(r.stock_status) : null,
    })).filter((p) => p.id && p.name && p.price > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /api/campaigns — public live index (popup + listing feeds)
// ---------------------------------------------------------------------------
export async function listHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const flagship = await resolveCampaign(FLAGSHIP_SLUG);
  const registry = (await loadRegistry()).filter((c) => c.status !== 'archived' && campaignIsAccepting(c));
  const all = flagship ? [flagship, ...registry.filter((c) => c.slug !== FLAGSHIP_SLUG)] : registry;
  const list = await Promise.all(all.map(async (c) => {
    const remaining = await remainingFor(c);
    return campaignPublicState(c, remaining);
  }));
  sendJson(res, 200, { ok: true, campaigns: list });
}

// ---------------------------------------------------------------------------
// GET /api/campaigns/state — one campaign (optionally with eligible products)
// ---------------------------------------------------------------------------
export async function stateHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const slug = slugifyCampaign(url.searchParams.get('slug') || '');
  const includeEligible = url.searchParams.get('eligible') === '1';
  const cfg = await resolveCampaign(slug);
  if (!cfg) {
    sendJson(res, 404, { error: 'Campaign not found.' });
    return;
  }
  const remaining = await remainingFor(cfg);
  const state = campaignPublicState(cfg, remaining) as Record<string, unknown>;
  if (includeEligible && cfg.kind === 'gift') {
    const [flags, products] = await Promise.all([loadProductFlags(), fetchPublishedProducts()]);
    const eligible = [];
    for (const p of products) {
      const flag = flags[p.id] || null;
      // Scope rule: when a campaign includes/excludes by list, respect flags.
      if (cfg.offer?.productScope === 'included' && !flag) continue;
      if (cfg.offer?.productScope === 'excluded' && flag?.giftEligible) continue;
      const r = engineProductPrice(cfg, Math.round(p.price * 100), flag);
      if (r.tier !== 'ineligible') {
        eligible.push({
          id: p.id,
          name: p.name,
          priceCents: Math.round(p.price * 100),
          giftPriceCents: r.priceCents,
          tier: r.tier,
          freeShipping: cfg.offer?.freeShipping === true && flag?.freeShipping !== false,
          imageUrl: p.image_url || null,
          slug: p.slug || null,
          stockStatus: p.stock_status || null,
        });
      }
    }
    state.eligible = eligible;
    state.eligibleCount = eligible.length;
  }
  sendJson(res, 200, state);
}

// ---------------------------------------------------------------------------
// POST /api/campaigns/claim
// ---------------------------------------------------------------------------
export async function claimHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) {
    sendJson(res, 503, { error: 'Campaign is temporarily unavailable. Please try again shortly.' });
    return;
  }
  const H = supabaseHeadersFor(serviceRole);

  const ip = clientIp(req);
  if (claimLimiter.isLimited(`c:${ip}`)) {
    sendJson(res, 429, { error: 'Too many attempts from this device. Please wait a minute and try again.' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid request body.' });
    return;
  }
  const b = (body || {}) as Record<string, unknown>;
  if (typeof b.company === 'string' && b.company.trim() !== '') {
    sendJson(res, 400, { error: 'Invalid request.' });
    return;
  }
  const slug = slugifyCampaign(String(b.slug || ''));
  const email = normalizeEmail(String(b.email || ''));
  const firstName = String(b.firstName || '').trim();
  if (!slug) {
    sendJson(res, 400, { error: 'Missing campaign slug.' });
    return;
  }
  if (!isValidEmail(email)) {
    sendJson(res, 400, { error: 'That email address does not look valid.' });
    return;
  }
  if (!firstName || firstName.length > 80) {
    sendJson(res, 400, { error: 'Please enter your first name.' });
    return;
  }

  const cfg = await resolveCampaign(slug);
  if (!cfg) {
    sendJson(res, 404, { error: 'Campaign not found.' });
    return;
  }
  if (!campaignIsAccepting(cfg)) {
    sendJson(res, 409, { error: 'This campaign is not open right now.', closed: true, status: campaignStatusAt(cfg) });
    return;
  }

  // Test marker — only honoured when GIFT_TEST_KEY matches (dev-only).
  let isTest = false;
  const tKey = String(b.testKey || '');
  if (tKey) {
    if (!process.env.GIFT_TEST_KEY || tKey !== process.env.GIFT_TEST_KEY) {
      sendJson(res, 403, { error: 'Test claims are not enabled on this deployment.' });
      return;
    }
    isTest = true;
  }

  const total = Math.max(Number(cfg.totalQuantity) || 0, 0);
  if (total > 0) {
    const claimed = await liveClaimCount(cfg.slug);
    if (claimed >= total) {
      sendJson(res, 409, { error: 'This campaign has been fully claimed.', full: true });
      return;
    }
  }

  // Pet validation against campaign audience.
  const petTypes = cfg.audience?.petTypes?.length ? cfg.audience.petTypes : [];
  const petType = String(b.petType || '').trim().toLowerCase();
  if (petTypes.length && !petTypes.includes(petType)) {
    sendJson(res, 400, { error: `This campaign currently covers ${petTypes.join(' and ')} pets.` });
    return;
  }

  // --- Product selection ----------------------------------------------------
  const flags = await loadProductFlags();
  let productLine: ClaimEnvelope['product'];
  let giftPriceCents = 0;
  let valueCents = Math.max(Number(cfg.giftValueCents) || 0, 0);
  let productName = cfg.giftName || cfg.title;
  const productId = String(b.productId || '').trim();

  if (productId) {
    const products = await fetchPublishedProducts();
    const prod = products.find((p) => p.id === productId);
    if (!prod) {
      sendJson(res, 400, { error: 'That gift is not available right now.' });
      return;
    }
    const flag = flags[prod.id] || null;
    const r = engineProductPrice(cfg, Math.round(prod.price * 100), flag);
    if (r.tier === 'ineligible') {
      sendJson(res, 400, { error: 'That product is not eligible for this campaign gift.' });
      return;
    }
    if (r.tier === 'premium' && r.priceCents > 0) {
      // Tier B: never auto-charge. Return the price; the storefront completes
      // the premium purchase through the normal secure checkout.
      sendJson(res, 200, {
        ok: true,
        premium: true,
        giftPriceCents: r.priceCents,
        regularCents: Math.round(prod.price * 100),
        productId: prod.id,
        productName: prod.name,
        tier: 'premium',
        message: `This gift is priced at $${(r.priceCents / 100).toFixed(2)} (regular $${(prod.price / 100).toFixed(2)}) — complete the secure checkout to confirm.`,
      });
      return;
    }
    valueCents = Math.round(prod.price * 100);
    giftPriceCents = r.priceCents;
    productName = prod.name;
    productLine = { id: prod.id, name: prod.name, valueCents, giftPriceCents, qty: 1 };
  }

  // --- Address (only needed to deliver a physical $0 gift) ------------------
  let addressBlock: Record<string, string> | null = null;
  const hasAddressPayload = !!b.address && typeof b.address === 'object';
  if (hasAddressPayload) {
    const a = (b.address || {}) as Record<string, unknown>;
    const line1 = String(a.line1 || '').trim();
    const city = String(a.city || '').trim();
    const zip = String(a.zip || '').trim();
    if (!line1 || !city || !zip) {
      sendJson(res, 400, { error: 'We need a complete shipping address to deliver your gift (street, city and ZIP/postal code).' });
      return;
    }
    if (line1.length > 160 || city.length > 80 || zip.length > 16 || String(a.state || '').length > 60) {
      sendJson(res, 400, { error: 'An address field is too long — please shorten it.' });
      return;
    }
    addressBlock = {
      line1,
      line2: String(a.line2 || '').trim(),
      city,
      state: String(a.state || '').trim(),
      zip,
      country: (String(a.country || 'US').trim().toUpperCase() || 'US').slice(0, 2),
    };
  }

  // --- Build + insert the $0 claim order ------------------------------------
  const claimCode = generateClaimCode();
  const orderNumber = slug === FLAGSHIP_SLUG ? legacyGiftOrderNumber(email) : claimOrderNumber(slug, email);
  const utmRaw = (b.utm || {}) as Record<string, unknown>;
  const envelope: ClaimEnvelope = {
    campaignSlug: slug,
    campaignTitle: cfg.title,
    claimCode,
    petType: petType || undefined,
    petName: String(b.petName || '').trim().slice(0, 60) || undefined,
    petSize: String(b.petSize || '').trim().slice(0, 40) || undefined,
    petInterest: String(b.petInterest || '').trim().slice(0, 60) || undefined,
    payment: 'NOT_REQUIRED',
    source: String(b.source || 'web').trim().slice(0, 60) || 'web',
    marketingOptIn: !!b.marketingOptIn,
    isTest,
    emailSent: false,
    emailNote: '',
    utm: {
      source: String(utmRaw.source || '').slice(0, 80) || undefined,
      medium: String(utmRaw.medium || '').slice(0, 80) || undefined,
      campaign: String(utmRaw.campaign || '').slice(0, 80) || undefined,
      content: String(utmRaw.content || '').slice(0, 80) || undefined,
      term: String(utmRaw.term || '').slice(0, 80) || undefined,
      referral: String(utmRaw.referral || '').slice(0, 80) || undefined,
    },
    product: productLine || undefined,
  };
  const items = [
    productId
      ? { kind: 'gift', id: productId, name: productName, valueCents, qty: 1, price: 0 }
      : { kind: 'gift', name: productName, valueCents, qty: 1, price: 0 },
  ];
  const row = {
    order_number: orderNumber,
    customer_email: email,
    customer_name: firstName,
    shipping_address: { ...(addressBlock || {}), _gift: envelope },
    items,
    coupon_code: CLAIM_MARKER,
    subtotal: 0,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 0,
    currency: 'USD',
    status: 'pending',
  };

  let insertRes: Response;
  try {
    insertRes = await fetch(`${url}/rest/v1/luxedge_orders`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    sendJson(res, 502, { error: 'Could not complete your claim just now — please try again.' });
    return;
  }
  if (insertRes.status === 409 || insertRes.status === 400) {
    const text = (await insertRes.text()).slice(0, 400);
    if (/duplicate|unique|already exists/i.test(text)) {
      sendJson(res, 409, { error: 'A gift was already claimed for this email on this campaign. One complimentary gift per eligible customer.' });
      return;
    }
    sendJson(res, 502, { error: 'Could not complete your claim just now — please try again.' });
    return;
  }
  if (!insertRes.ok) {
    sendJson(res, 502, { error: 'Could not complete your claim just now — please try again.' });
    return;
  }
  let claimId = '';
  try {
    const inserted = (await insertRes.json()) as Array<Record<string, unknown>>;
    claimId = Array.isArray(inserted) && inserted[0]?.id ? String(inserted[0].id) : '';
  } catch {
    claimId = '';
  }

  // Household dedupe (soft check — never fails a valid claim on a scan error).
  if (addressBlock && cfg.eligibility?.onePerHousehold !== false) {
    try {
      const house = normalizeHouse(addressBlock.line1, addressBlock.zip);
      const listRes = await fetch(
        `${url}/rest/v1/luxedge_orders?select=id,shipping_address&coupon_code=eq.${encodeURIComponent(CLAIM_MARKER)}&status=not.in.(cancelled,failed)&limit=200`,
        { headers: H, signal: AbortSignal.timeout(10_000) },
      );
      if (listRes.ok) {
        const rows = (await listRes.json()) as Array<{ id: string; shipping_address?: { line1?: string; zip?: string; _gift?: ClaimEnvelope } }>;
        const conflict = rows.find((r) => {
          if (r.id === claimId) return false;
          const g = r.shipping_address?._gift;
          if ((g?.campaignSlug || FLAGSHIP_SLUG) !== slug) return false;
          if (g?.isTest && !isTest) return false;
          return normalizeHouse(r.shipping_address?.line1 || '', r.shipping_address?.zip || '') === house;
        });
        if (claimId && conflict) {
          await fetch(`${url}/rest/v1/luxedge_orders?id=eq.${encodeURIComponent(claimId)}`, {
            method: 'PATCH',
            headers: H,
            body: JSON.stringify({ status: 'cancelled' }),
            signal: AbortSignal.timeout(10_000),
          }).catch(() => null);
          sendJson(res, 409, {
            error: 'A complimentary gift was already claimed for this address. One gift per household.',
            conflict: true,
          });
          return;
        }
      }
    } catch {
      /* soft check */
    }
  }

  // Confirmation email (best-effort — never revokes the claim on failure).
  let emailSent = false;
  if (!isTest && cfg.email?.enabled !== false) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mail = (req as any).env?.SEND_MAIL as
        | { send: (m: { from: string; to: string; subject: string; html?: string; text?: string }) => Promise<void> }
        | undefined;
      if (mail) {
        await mail.send({
          from: 'sales@luxedge.us',
          to: email,
          subject: `Your ${cfg.title} claim is confirmed 🎁`,
          text:
            `Hi ${firstName},\n\n` +
            `Your ${cfg.title} claim is confirmed — reference ${claimCode}.\n\n` +
            `Your complimentary gift and standard shipping are free. There is nothing to pay and no payment details were collected.\n` +
            `We will email you once your gift ships.\n\n` +
            `— The Luxedge Team\nhttps://luxedge.us/${cfg.landingSlug || cfg.slug}`,
        });
        emailSent = true;
      }
    } catch {
      emailSent = false;
    }
  }

  sendJson(res, 200, {
    ok: true,
    claimId,
    claimCode,
    orderNumber,
    giftName: productName || cfg.giftName || cfg.title,
    giftPriceCents: 0,
    regularCents: valueCents,
    payment: 'NOT_REQUIRED',
    needsShipping: !!addressBlock,
    test: isTest,
    emailSent: isTest ? true : emailSent,
    message:
      'Your complimentary gift is reserved. Product and standard shipping are free — no payment details were collected.',
  });
}
