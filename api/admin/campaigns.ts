// ============================================================================
// LUXEDGE — CAMPAIGN ENGINE admin endpoints
//
//   GET  /api/admin/campaigns            → registry + per-campaign claims
//                                          stats (campaign manager dashboard)
//   POST /api/admin/campaigns            → actions:
//        { action:'create', templateKey, slug }        create from template
//        { action:'save', config }                     create/update a config
//        { action:'duplicate', slug, newSlug }         duplicate a campaign
//        { action:'status', slug, status }             status transition
//        { action:'archive', slug }                    archive (soft delete)
//        { action:'flags', map }                       save product flags
//        { action:'claim-status', id, status }         advance a claim
//        { action:'cancel-claim', id }                 cancel a claim
//        { action:'tracking', id, carrier, number }    tracking on a claim
//
// Admin-authenticated. Reads/writes the SAME app_settings registry + the SAME
// luxedge_orders claim rows the public flow uses. Flagship (pet-gift-drop)
// stays bridged to the legacy gift-drop doc so the original page + claims
// keep working with zero migration.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import {
  CLAIM_MARKER,
  FLAGSHIP_SLUG,
  campaignPublicState,
  campaignStatusAt,
  campaignFromTemplate,
  campaignStorageHealth,
  loadCampaignBySlug,
  loadProductFlags,
  loadRegistry,
  remainingFor,
  saveProductFlags,
  saveRegistry,
  slugifyCampaign,
  templateKeys,
  type CampaignConfig,
  type ClaimEnvelope,
  type ProductCampaignFlag,
} from '../_lib/campaigns.js';
import {
  giftAddress,
  GIFT_STATUS_FLOW,
} from '../_lib/gift-drop.js';

const envUrl = () => (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const envKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
function headers() {
  const key = envKey();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClaimView(row: any) {
  const g = (row.shipping_address?._gift || {}) as ClaimEnvelope;
  const a = giftAddress(row);
  const line = Array.isArray(row.items) && row.items.length ? row.items[0] : undefined;
  return {
    id: row.id,
    orderNumber: row.order_number,
    email: row.customer_email,
    name: row.customer_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    address: a,
    campaignSlug: g.campaignSlug || FLAGSHIP_SLUG,
    campaignTitle: g.campaignTitle || '',
    claimCode: g.claimCode || '',
    petType: g.petType || '',
    petName: g.petName || '',
    petSize: g.petSize || '',
    petInterest: g.petInterest || '',
    giftName: (line && (line.name || '')) || '',
    giftValueCents: Number(line && line.valueCents) || 0,
    giftPriceCents: Math.round((Number(row.total) || 0) * 100),
    payment: g.payment || 'NOT_REQUIRED',
    source: g.source || 'web',
    marketingOptIn: !!g.marketingOptIn,
    isTest: !!g.isTest,
    emailSent: g.emailSent === true,
    emailNote: g.emailNote || '',
    utm: g.utm || null,
    tracking: g.tracking || null,
    totalCents: Math.round((Number(row.total) || 0) * 100),
    currency: row.currency || 'USD',
  };
}

/** All claim rows grouped by campaign slug (legacy rows → flagship). */
export async function listClaims(): Promise<ReturnType<typeof toClaimView>[]> {
  const url = envUrl();
  const key = envKey();
  if (!url || !key) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/luxedge_orders?select=*&coupon_code=eq.${encodeURIComponent(CLAIM_MARKER)}&order=created_at.desc&limit=1000`,
      { headers: headers(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map(toClaimView);
  } catch {
    return [];
  }
}

/** Public-safe config for admin rendering (flagship bridged from legacy). */
function toAdminConfig(cfg: CampaignConfig | null): Record<string, unknown> | null {
  if (!cfg) return null;
  return {
    slug: cfg.slug,
    kind: cfg.kind,
    templateKey: cfg.templateKey,
    status: cfg.status,
    title: cfg.title,
    subtitle: cfg.subtitle || '',
    message: cfg.message || '',
    giftName: cfg.giftName || '',
    giftValueCents: Math.max(Number(cfg.giftValueCents) || 0, 0),
    totalQuantity: Math.max(Number(cfg.totalQuantity) || 0, 0),
    active: cfg.active !== undefined ? !!cfg.active : cfg.status === 'live',
    startsAt: cfg.startsAt || null,
    endsAt: cfg.endsAt || null,
    heroImage: cfg.heroImage || '',
    termsUrl: cfg.termsUrl || '',
    landingSlug: cfg.landingSlug || cfg.slug,
    priority: cfg.priority || 0,
    audience: cfg.audience || {},
    eligibility: cfg.eligibility || {},
    offer: cfg.offer || {},
    popup: cfg.popup || {},
    referral: cfg.referral || {},
    email: cfg.email || {},
    tracking: cfg.tracking || {},
    updatedAt: cfg.updatedAt || null,
  };
}

// ---------------------------------------------------------------------------
// GET — manager dashboard (+ optional product search for eligibility flags)
// ---------------------------------------------------------------------------
async function searchProducts(q: string, limit = 40): Promise<Array<Record<string, unknown>>> {
  const url = envUrl();
  const key = envKey();
  if (!url || !key) return [];
  try {
    const term = q.trim();
    const ilike = term ? `&name=ilike.*${encodeURIComponent(term.replace(/[%*]/g, ''))}*` : '';
    const res = await fetch(
      `${url}/rest/v1/products?select=id,slug,name,price,image_url,status&status=in.(active,published)&order=name.asc&limit=${limit}${ilike}`,
      { headers: headers(), signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return [];
    return (await res.json()) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

async function handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('view') === 'products') {
    const rows = await searchProducts(url.searchParams.get('q') || '');
    sendJson(res, 200, { ok: true, products: rows });
    return;
  }
  const registry = await loadRegistry();
  const claims = await listClaims();
  const flags = await loadProductFlags();

  // Group claims per campaign (flagship = rows without a slug).
  const bySlug: Record<string, ReturnType<typeof toClaimView>[]> = {};
  for (const c of claims) {
    const s = c.campaignSlug;
    (bySlug[s] = bySlug[s] || []).push(c);
  }

  const campaigns = await Promise.all(
    registry.map(async (cfg) => {
      const remaining = await remainingFor(cfg);
      const rows = bySlug[cfg.slug] || [];
      return {
        config: toAdminConfig(cfg),
        state: { ...campaignPublicState(cfg, remaining), status: campaignStatusAt(cfg) },
        stats: {
          claimed: rows.filter((r) => !['cancelled', 'failed'].includes(r.status) && !r.isTest).length,
          tests: rows.filter((r) => r.isTest).length,
          emails: rows.filter((r) => !r.isTest && r.emailSent).length,
          marketingOptIns: rows.filter((r) => r.marketingOptIn).length,
          redeemed: rows.filter((r) => !['cancelled', 'failed'].includes(r.status) && (r.giftPriceCents || 0) > 0).length,
          sources: rows.reduce<Record<string, number>>((acc, r) => {
            if (r.source) acc[r.source] = (acc[r.source] || 0) + 1;
            return acc;
          }, {}),
        },
      };
    }),
  );

  // Flagship is always present when its legacy config exists.
  const flagshipCfg = await loadCampaignBySlug(FLAGSHIP_SLUG).catch(() => null);
  const templates = templateKeys().map((k) => ({ key: k, title: (k || '').replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()) }));
  sendJson(res, 200, {
    ok: true,
    flagship: flagshipCfg ? { config: toAdminConfig(flagshipCfg), claims: bySlug[FLAGSHIP_SLUG] || [] } : null,
    campaigns,
    claims,
    flags,
    templates,
    petTypes: ['dog', 'cat', 'horse', 'bird', 'cattle', 'other'],
    kinds: ['gift', 'promo'],
    statuses: ['draft', 'scheduled', 'live', 'paused', 'ended', 'archived'],
  });
}

// ---------------------------------------------------------------------------
// POST — actions
// ---------------------------------------------------------------------------
async function handleAction(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const action = String(body.action || '');

  // ---- create from template -------------------------------------------------
  if (action === 'create') {
    const templateKey = String(body.templateKey || '');
    const slug = slugifyCampaign(String(body.slug || ''));
    if (!templateKey) {
      sendJson(res, 400, { error: 'templateKey is required.' });
      return;
    }
    if (!slug) {
      sendJson(res, 400, { error: 'slug is required.' });
      return;
    }
    if (slug === FLAGSHIP_SLUG) {
      sendJson(res, 400, { error: 'The flagship Pet Gift Drop already exists — edit it from the Gift Drop page.' });
      return;
    }
    const existing = await loadCampaignBySlug(slug);
    if (existing) {
      sendJson(res, 409, { error: `A campaign with the slug "${slug}" already exists.` });
      return;
    }
    const cfg = campaignFromTemplate(templateKey, slug);
    if (!cfg) {
      sendJson(res, 400, { error: 'Unknown campaign template.' });
      return;
    }
    const registry = await loadRegistry();
    registry.push(cfg);
    const ok = await saveRegistry(registry);
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, campaign: toAdminConfig(cfg) } : { error: 'Could not save the campaign.' });
    return;
  }

  // ---- save (create/update arbitrary config) --------------------------------
  if (action === 'save') {
    const raw = (body.config || {}) as Record<string, unknown>;
    const slug = slugifyCampaign(String(raw.slug || ''));
    if (!slug) {
      sendJson(res, 400, { error: 'slug is required.' });
      return;
    }
    const registry = await loadRegistry();
    let existing = registry.find((c) => c.slug === slug) || null;
    if (!existing && slug === FLAGSHIP_SLUG) {
      sendJson(res, 400, { error: 'The flagship Pet Gift Drop is configured from the Gift Drop page.' });
      return;
    }
    const merged: CampaignConfig = {
      ...(existing || campaignFromTemplate('free_pet_gift', slug) || { slug, kind: 'gift', templateKey: 'custom', status: 'draft', title: slug, totalQuantity: 0, offer: {} }),
      ...raw,
      slug,
      offer: { ...((existing?.offer || {}) as object), ...((raw.offer || {}) as object) },
      audience: { ...((existing?.audience || {}) as object), ...((raw.audience || {}) as object) },
      eligibility: { ...((existing?.eligibility || {}) as object), ...((raw.eligibility || {}) as object) },
      popup: { ...((existing?.popup || {}) as object), ...((raw.popup || {}) as object) },
      referral: { ...((existing?.referral || {}) as object), ...((raw.referral || {}) as object) },
      email: { ...((existing?.email || {}) as object), ...((raw.email || {}) as object) },
      updatedAt: new Date().toISOString(),
    } as CampaignConfig;
    // Numeric coercion (browser sends strings).
    merged.totalQuantity = Math.max(Math.trunc(Number(raw.totalQuantity ?? existing?.totalQuantity ?? 0)) || 0, 0);
    if (typeof raw.offer === 'object' && raw.offer) {
      const o = raw.offer as Record<string, unknown>;
      const bo = merged.offer as Record<string, unknown>;
      for (const k of ['freeThresholdCents', 'premiumPercentOff', 'maxDiscountCents', 'maxEligibleRetailCents', 'minCartValueCents', 'discountPercentOff', 'discountFixedCents']) {
        if (o[k] !== undefined) bo[k] = Math.max(Number(o[k]) || 0, 0);
      }
      if (o.productScope !== undefined) bo.productScope = o.productScope;
      if (o.includedProductIds !== undefined) bo.includedProductIds = Array.isArray(o.includedProductIds) ? o.includedProductIds : [];
      if (o.excludedProductIds !== undefined) bo.excludedProductIds = Array.isArray(o.excludedProductIds) ? o.excludedProductIds : [];
      if (o.freeShipping !== undefined) bo.freeShipping = !!o.freeShipping;
      if (o.allowStacking !== undefined) bo.allowStacking = !!o.allowStacking;
    }
    // status sanity: scheduled/live/paused/ended/archived/draft
    const want = String(raw.status || existing?.status || 'draft');
    merged.status = ['draft', 'scheduled', 'live', 'paused', 'ended', 'archived'].includes(want) ? (want as CampaignConfig['status']) : 'draft';
    if (!existing) registry.push(merged);
    else {
      const i = registry.findIndex((c) => c.slug === slug);
      registry[i] = merged;
    }
    const ok = await saveRegistry(registry);
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, campaign: toAdminConfig(merged) } : { error: 'Could not save the campaign.' });
    return;
  }

  // ---- duplicate -------------------------------------------------------------
  if (action === 'duplicate') {
    const slug = slugifyCampaign(String(body.slug || ''));
    const newSlug = slugifyCampaign(String(body.newSlug || `${slug}-copy`));
    if (!slug || !newSlug || slug === newSlug) {
      sendJson(res, 400, { error: 'source and new slug are required and must differ.' });
      return;
    }
    if (slug === FLAGSHIP_SLUG) {
      sendJson(res, 400, { error: 'Duplicate the flagship from the Gift Drop page config instead.' });
      return;
    }
    const registry = await loadRegistry();
    const src = registry.find((c) => c.slug === slug);
    if (!src) {
      sendJson(res, 404, { error: 'Source campaign not found.' });
      return;
    }
    if (registry.some((c) => c.slug === newSlug)) {
      sendJson(res, 409, { error: `A campaign with the slug "${newSlug}" already exists.` });
      return;
    }
    const copy: CampaignConfig = {
      ...JSON.parse(JSON.stringify(src)),
      slug: newSlug,
      title: `${src.title} (Copy)`,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    };
    registry.push(copy);
    const ok = await saveRegistry(registry);
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, campaign: toAdminConfig(copy) } : { error: 'Could not duplicate the campaign.' });
    return;
  }

  // ---- status transition -----------------------------------------------------
  if (action === 'status') {
    const slug = slugifyCampaign(String(body.slug || ''));
    const want = String(body.status || '');
    const allowed = ['draft', 'scheduled', 'live', 'paused', 'ended', 'archived'];
    if (!allowed.includes(want)) {
      sendJson(res, 400, { error: `status must be one of ${allowed.join(', ')}.` });
      return;
    }
    if (slug === FLAGSHIP_SLUG) {
      sendJson(res, 400, { error: 'The flagship campaign status is controlled from the Gift Drop page (active toggle).' });
      return;
    }
    const registry = await loadRegistry();
    const idx = registry.findIndex((c) => c.slug === slug);
    if (idx < 0) {
      sendJson(res, 404, { error: 'Campaign not found.' });
      return;
    }
    registry[idx] = { ...registry[idx], status: want as CampaignConfig['status'], updatedAt: new Date().toISOString() };
    const ok = await saveRegistry(registry);
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, slug, status: want } : { error: 'Could not update the campaign status.' });
    return;
  }

  // ---- archive ----------------------------------------------------------------
  if (action === 'archive') {
    const slug = slugifyCampaign(String(body.slug || ''));
    if (!slug || slug === FLAGSHIP_SLUG) {
      sendJson(res, 400, { error: 'The flagship cannot be archived from here.' });
      return;
    }
    const registry = await loadRegistry();
    const next = registry.filter((c) => c.slug !== slug);
    if (next.length === registry.length) {
      sendJson(res, 404, { error: 'Campaign not found.' });
      return;
    }
    const ok = await saveRegistry(next);
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, slug, archived: true } : { error: 'Could not archive the campaign.' });
    return;
  }

  // ---- product flags ------------------------------------------------------------
  if (action === 'flags') {
    const map = (body.map || {}) as Record<string, ProductCampaignFlag>;
    if (typeof map !== 'object' || map === null || Array.isArray(map)) {
      sendJson(res, 400, { error: 'map must be an object keyed by product id.' });
      return;
    }
    const clean: Record<string, ProductCampaignFlag> = {};
    for (const [k, v] of Object.entries(map)) {
      if (!/^[0-9a-f-]{8,}$/i.test(k)) continue;
      const f = (v || {}) as Record<string, unknown>;
      clean[k] = {
        giftEligible: !!f.giftEligible,
        allowFree: !!f.allowFree,
        freeShipping: f.freeShipping === undefined ? undefined : !!f.freeShipping,
        maxDiscountCents: f.maxDiscountCents !== undefined && f.maxDiscountCents !== null && f.maxDiscountCents !== '' ? Math.max(Number(f.maxDiscountCents) || 0, 0) : undefined,
      };
    }
    const ok = await saveProductFlags(clean);
    sendJson(res, ok ? 200 : 502, ok ? { ok: true, count: Object.keys(clean).length } : { error: 'Could not save product flags.' });
    return;
  }

  // ---- claim management -----------------------------------------------------
  const claimId = String(body.id || '');
  if (claimId) {
    const url = envUrl();
    const key = envKey();
    if (!url || !key) {
      sendJson(res, 502, { error: 'Database is not configured on this deployment.' });
      return;
    }
    const rowRes = await fetch(`${url}/rest/v1/luxedge_orders?select=*&id=eq.${encodeURIComponent(claimId)}&limit=1`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!rowRes.ok) {
      sendJson(res, 502, { error: 'Could not read the claim.' });
      return;
    }
    const rows = (await rowRes.json()) as Array<Record<string, unknown>>;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row || row.coupon_code !== CLAIM_MARKER) {
      sendJson(res, 404, { error: 'Claim not found.' });
      return;
    }
    const patch = async (fields: Record<string, unknown>) => {
      const r = await fetch(`${url}/rest/v1/luxedge_orders?id=eq.${encodeURIComponent(claimId)}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(fields),
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok;
    };
    const current = String(row.status || '');

    if (action === 'cancel-claim') {
      if (!['pending', 'processing'].includes(current)) {
        sendJson(res, 400, { error: 'Only unshipped claims can be cancelled.' });
        return;
      }
      const ok = await patch({ status: 'cancelled' });
      sendJson(res, ok ? 200 : 502, ok ? { ok: true, id: claimId, status: 'cancelled' } : { error: 'Could not cancel the claim.' });
      return;
    }
    if (action === 'claim-status') {
      const next = String(body.status || '');
      if (!(GIFT_STATUS_FLOW[current] || []).includes(next)) {
        sendJson(res, 400, { error: `Cannot move a claim from "${current}" to "${next}".` });
        return;
      }
      const ok = await patch({ status: next });
      sendJson(res, ok ? 200 : 502, ok ? { ok: true, id: claimId, status: next } : { error: 'Could not update the claim.' });
      return;
    }
    if (action === 'tracking') {
      const carrier = String(body.carrier || '').slice(0, 60);
      const number = String(body.number || '').slice(0, 80);
      if (!number) {
        sendJson(res, 400, { error: 'Tracking number is required.' });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sa = (row.shipping_address as any) || {};
      const g = (sa._gift || {}) as ClaimEnvelope;
      const ok = await patch({
        shipping_address: { ...sa, _gift: { ...g, tracking: { carrier, number } } },
      });
      sendJson(res, ok ? 200 : 502, ok ? { ok: true, id: claimId, tracking: { carrier, number } } : { error: 'Could not save tracking.' });
      return;
    }
  }

  sendJson(res, 400, { error: `Unknown action "${action}".` });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!(await requireAdmin(req, res))) return;
  if (req.method === 'GET' || req.method === 'POST') {
    const health = await campaignStorageHealth();
    if (!health.ok) { sendJson(res, 503, { error: health.error }); return; }
  }
  if (req.method === 'GET') {
    await handleGet(req, res);
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  await handleAction(body, res);
}
