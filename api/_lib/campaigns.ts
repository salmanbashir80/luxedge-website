// ============================================================================
// LUXEDGE — CAMPAIGN ENGINE (shared server-side core)
//
// Evolves the original Pet Gift Drop (a single hard-coded giveaway) into a
// reusable, data-driven campaign engine. Every campaign is a config document
// in the `luxedge_campaigns_v1` app_settings row (registry). Claims remain
// REAL luxedge_orders rows marked coupon_code='PET-GIFT-DROP' (so the ERP
// forwarder, Orders screen and merchant stats keep excluding them), with the
// campaign slug + claim code carried in the shipping_address._gift envelope.
//
// CAMPAIGN KINDS
//   'gift'  — customer claims a real gift. When the engine price for the
//             selected eligible product is $0 the claim creates the $0 order
//             directly (no Stripe session, payment NOT_REQUIRED). When the
//             engine price is > 0 (premium tier) the claim issues a claim
//             code the customer applies at cart/checkout; the server-side
//             checkout loader (api/_lib/checkout.ts + api/checkout.ts) then
//             prices that product at the engine's margin-protected price.
//   'promo' — a claim code acts like a coupon (percent / fixed / free
//             shipping) validated server-side against this campaign's rules
//             (min cart, max discount, product scoping, one-per-email).
//
// Everything public-facing is derived from real server config + real claim
// rows. No fake inventory, no fake scarcity, no fabricated numbers.
//
// DATA MODEL (stored config — all amounts in cents where currency applies):
// {
//   slug, kind, templateKey, status, title, subtitle, message,
//   giftName, giftValueCents, totalQuantity, active,
//   startsAt, endsAt, timezoneHint,
//   heroImage, termsUrl, landingSlug, priority,
//   audience: { petTypes: [], regions: [], everyone: bool },
//   eligibility: { onePerEmail, onePerHousehold, limitPerCustomer },
//   offer: {
//     freeThresholdCents,             // products at/below this retail → $0 tier
//     premiumPercentOff,              // retail above threshold → off % (e.g. 50)
//     maxDiscountCents,               // margin-protection cap on the discount
//     maxEligibleRetailCents,         // retail above this → not campaign-eligible
//     freeShipping,                   // campaign pays standard shipping
//     productScope: 'all' | 'included' | 'excluded',
//     includedProductIds: [], excludedProductIds: [],
//     minCartValueCents (promo), allowStacking
//   },
//   popup: { enabled, delayMs, scrollDepth, exitIntent, frequencyDays,
//            mobileTrigger, ctaLabel, headline, subtext },
//   referral: { enabled, shareHeadline, shareSubtext, rewardCopy },
//   email: { enabled, subject },
//   tracking: { channels: [] },
// }
//
// TEMPLATES: twelve ready-made campaign presets populate sensible defaults
// that the owner edits before publishing — a new campaign takes minutes.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
import { getDataRuntime, type D1DatabaseLike } from '../../worker/d1/runtime';
import { readCampaignDoc, writeCampaignDoc } from './campaign-store';

export type CampaignKind = 'gift' | 'promo';
export type CampaignStatus = 'draft' | 'scheduled' | 'live' | 'paused' | 'ended' | 'archived';
export type TemplateKey =
  | 'free_pet_gift'
  | 'first_order'
  | 'email_welcome'
  | 'flash_sale'
  | 'pet_birthday'
  | 'customer_appreciation'
  | 'refer_a_friend'
  | 'free_shipping'
  | 'seasonal_giveaway'
  | 'black_friday'
  | 'christmas_pet_gift'
  | 'cat_lovers'
  | 'dog_lovers'
  | 'horse_owner';

export interface CampaignAudience {
  everyone?: boolean;
  petTypes?: string[]; // dog | cat | horse | bird | cattle | other
  regions?: string[];
}

export interface CampaignEligibility {
  onePerEmail?: boolean;
  onePerHousehold?: boolean;
  limitPerCustomer?: number;
}

export interface CampaignOffer {
  /** Retail price at/below which an eligible product is FREE (cents). */
  freeThresholdCents?: number;
  /** Discount % off retail for premium-tier products (e.g. 50 = 50% off). */
  premiumPercentOff?: number;
  /** Margin-protection cap: the largest single discount allowed (cents). */
  maxDiscountCents?: number;
  /** Products above this retail are NOT campaign eligible (cents). */
  maxEligibleRetailCents?: number;
  /** Campaign pays standard shipping for gift claims. */
  freeShipping?: boolean;
  /** 'all' published products vs an explicit include/exclude list. */
  productScope?: 'all' | 'included' | 'excluded';
  includedProductIds?: string[];
  excludedProductIds?: string[];
  /** promo kind */
  minCartValueCents?: number;
  discountPercentOff?: number;
  discountFixedCents?: number;
  allowStacking?: boolean;
}

export interface CampaignPopupCfg {
  enabled?: boolean;
  delayMs?: number;
  scrollDepth?: number; // 0-100
  exitIntent?: boolean;
  frequencyDays?: number;
  mobileDelayMs?: number;
  ctaLabel?: string;
  headline?: string;
  subtext?: string;
}

export interface CampaignReferral {
  enabled?: boolean;
  shareHeadline?: string;
  shareSubtext?: string;
  rewardCopy?: string;
}

export interface CampaignEmailCfg {
  enabled?: boolean;
  subject?: string;
}

export interface CampaignConfig {
  slug: string;
  kind: CampaignKind;
  templateKey: TemplateKey | 'custom';
  status: CampaignStatus;
  title: string;
  subtitle?: string;
  message?: string;
  giftName?: string;
  giftValueCents?: number;
  totalQuantity: number; // real gift pool size (0 for unlimited promos)
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  timezoneHint?: string;
  heroImage?: string;
  termsUrl?: string;
  landingSlug?: string;
  priority?: number;
  audience?: CampaignAudience;
  eligibility?: CampaignEligibility;
  offer: CampaignOffer;
  popup?: CampaignPopupCfg;
  referral?: CampaignReferral;
  email?: CampaignEmailCfg;
  tracking?: { channels?: string[] };
  updatedAt?: string | null;
}

export interface ProductCampaignFlag {
  /** Product may be claimed as a gift (subject to offer rules). */
  giftEligible?: boolean;
  /** Force-free (even above threshold) — owner opt-in, margin-safe override. */
  allowFree?: boolean;
  /** Per-product discount cap (cents); tighter than the campaign cap wins. */
  maxDiscountCents?: number;
  /** Campaign pays standard shipping for this product's gift claim. */
  freeShipping?: boolean;
}

export interface ClaimEnvelope {
  campaignSlug: string;
  campaignTitle?: string;
  claimCode?: string;
  petType?: string;
  petName?: string;
  petSize?: string;
  petInterest?: string;
  payment: 'NOT_REQUIRED' | 'REQUIRED';
  source?: string;
  marketingOptIn?: boolean;
  isTest?: boolean;
  emailSent?: boolean;
  emailNote?: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string; referral?: string };
  product?: { id?: string; name?: string; valueCents?: number; giftPriceCents?: number; qty?: number };
  tracking?: { carrier?: string; number?: string };
  redeemedAt?: string | null;
  redemptionOrder?: string | null;
}

// ---------------------------------------------------------------------------
// Registry storage keys
// ---------------------------------------------------------------------------
export const CAMPAIGN_REGISTRY_KEY = 'luxedge_campaigns_v1';
export const CAMPAIGN_PRODUCT_FLAGS_KEY = 'luxedge_campaign_products_v1';
/** Legacy single-campaign doc (flagship bridge — Pet Gift Drop). */
export const LEGACY_GIFT_CAMPAIGN_KEY = 'gift_drop_campaign_v1';
export const FLAGSHIP_SLUG = 'pet-gift-drop';
/** Claim marker kept identical to the original giveaway so ERP/Orders/analytics
 * exclusion filters (`coupon_code=not.eq.PET-GIFT-DROP`) keep working. */
export const CLAIM_MARKER = 'PET-GIFT-DROP';
export const PET_TYPES = ['dog', 'cat', 'horse', 'bird', 'cattle', 'other'] as const;

/** Claim code alphabet — unambiguous, human-friendly. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CLAIM_CODE_PREFIX = 'LXG';

export const REGISTRY_DEFAULT: { campaigns: CampaignConfig[] } = { campaigns: [] };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}

/** Deterministic per (campaign, email) order number → DB-unique ⇒ atomic
 * one-per-email per campaign. Keeps the original GIFT-<hash(email)> shape so
 * existing legacy flagship claims remain dedupe-compatible. */
export function claimOrderNumber(campaignSlug: string, email: string): string {
  let h = 0;
  const s = `${normalizeEmail(campaignSlug)}::${normalizeEmail(email)}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `GIFT-${hex}`;
}

/** Legacy flagship order number — MUST reproduce the original gift-drop
 * algorithm byte-for-byte so a person who already claimed under the old code
 * is still blocked by the same order_number unique constraint. */
export function legacyGiftOrderNumber(email: string): string {
  let h = 0;
  const s = normalizeEmail(email);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `GIFT-${hex}`;
}

/** A secure, human-readable claim code: LXG-7K3P-92A. */
export function generateClaimCode(): string {
  const part = (n: number) => {
    let out = '';
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < n; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  };
  return `${CLAIM_CODE_PREFIX}-${part(4)}-${part(3)}`;
}

export function normalizeClaimCode(raw: string): string {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidClaimCodeShape(raw: string): boolean {
  return new RegExp(`^${CLAIM_CODE_PREFIX}-[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{3}$`).test(
    normalizeClaimCode(raw),
  );
}

export function normalizeHouse(line1: string, zip: string): string {
  return `${String(line1 || '').trim().toLowerCase()}|${String(zip || '').trim().toUpperCase()}`;
}

/** Current status for a config given `now` (ms). Window-aware. */
export function campaignStatusAt(cfg: CampaignConfig, now: number = Date.now()): CampaignStatus {
  if (cfg.status === 'archived' || cfg.status === 'ended' || cfg.status === 'paused') return cfg.status;
  if (cfg.status === 'draft') return cfg.status;
  const start = cfg.startsAt ? new Date(cfg.startsAt).getTime() : NaN;
  const end = cfg.endsAt ? new Date(cfg.endsAt).getTime() : NaN;
  const scheduled = Number.isFinite(start) && start > now;
  if (scheduled) return 'scheduled';
  if (Number.isFinite(end) && end < now) return 'ended';
  return 'live';
}

export function campaignIsAccepting(cfg: CampaignConfig, now: number = Date.now()): boolean {
  if (!cfg) return false;
  return campaignStatusAt(cfg, now) === 'live';
}

export function campaignPublicState(cfg: CampaignConfig, remaining: number): Record<string, unknown> {
  return {
    ok: true,
    slug: cfg.slug,
    kind: cfg.kind,
    status: cfg.status,
    title: cfg.title,
    subtitle: cfg.subtitle || '',
    message: cfg.message || '',
    giftName: cfg.giftName || cfg.title,
    giftValueCents: Math.max(Number(cfg.giftValueCents) || 0, 0),
    total: Math.max(Number(cfg.totalQuantity) || 0, 0),
    remaining,
    active: campaignIsAccepting(cfg),
    startsAt: cfg.startsAt || null,
    endsAt: cfg.endsAt || null,
    heroImage: cfg.heroImage || '',
    termsUrl: cfg.termsUrl || '',
    landingSlug: cfg.landingSlug || cfg.slug,
    freeThresholdCents: Math.max(Number(cfg.offer?.freeThresholdCents) || 0, 0),
    premiumPercentOff: Math.max(Number(cfg.offer?.premiumPercentOff) || 0, 0),
    maxDiscountCents: Math.max(Number(cfg.offer?.maxDiscountCents) || 0, 0),
    maxEligibleRetailCents: Math.max(Number(cfg.offer?.maxEligibleRetailCents) || 0, 0),
    freeShipping: !!cfg.offer?.freeShipping,
    petTypes: cfg.audience?.petTypes || [],
    popup: cfg.popup?.enabled ? { headline: cfg.popup.headline || '', subtext: cfg.popup.subtext || '' } : null,
    referralEnabled: !!cfg.referral?.enabled,
  };
}

/**
 * Engine pricing for one product against a campaign's offer rules.
 * Returns the gift price (what the customer pays) + the reason tier.
 *   'free'    → retail ≤ freeThresholdCents AND product eligible
 *   'premium' → retail ≤ maxEligibleRetailCents, discount = percent off,
 *               capped by the tighter of (campaign cap, product cap), never
 *               below $0
 *   'ineligible' → retail too high, excluded, or scope rules exclude it
 * The margin-protection rule: discount cannot exceed maxDiscountCents.
 */
export function engineProductPrice(
  cfg: CampaignConfig,
  retailCents: number,
  flag?: ProductCampaignFlag | null,
): { tier: 'free' | 'premium' | 'ineligible'; priceCents: number; discountCents: number } {
  const price = Math.max(Number(retailCents) || 0, 0);
  if (price <= 0) return { tier: 'ineligible', priceCents: price, discountCents: 0 };
  const offer = cfg.offer || {};
  const scope = (offer.productScope || 'all') as 'all' | 'included' | 'excluded';
  const giftFlag = !!flag?.giftEligible;

  // Scope rules: 'excluded' lists make flags opt-IN (only flagged products
  // participate); 'included' likewise restricts to flagged products. The
  // product picker writes flags + included ids together.
  const inScope =
    scope === 'all' || giftFlag || (scope === 'included' && !!flag);
  if (!inScope) return { tier: 'ineligible', priceCents: price, discountCents: 0 };

  // free tier
  const threshold = Math.max(Number(offer.freeThresholdCents) || 0, 0);
  const maxRetail = Math.max(Number(offer.maxEligibleRetailCents) || 0, 0);
  if (flag?.allowFree || (threshold > 0 && price <= threshold)) {
    if (maxRetail > 0 && price > maxRetail && !flag?.allowFree) {
      return { tier: 'ineligible', priceCents: price, discountCents: 0 };
    }
    return { tier: 'free', priceCents: 0, discountCents: price };
  }
  if (maxRetail > 0 && price > maxRetail) {
    return { tier: 'ineligible', priceCents: price, discountCents: 0 };
  }

  // premium tier
  const percent = Math.max(Number(offer.premiumPercentOff) || 0, 0);
  if (percent > 0) {
    const rawDiscount = Math.round((price * percent) / 100);
    const cap = Math.min(
      offer.maxDiscountCents !== undefined && offer.maxDiscountCents !== null
        ? Math.max(Number(offer.maxDiscountCents) || 0, 0)
        : Infinity,
      flag?.maxDiscountCents !== undefined && flag?.maxDiscountCents !== null
        ? Math.max(Number(flag.maxDiscountCents) || 0, 0)
        : Infinity,
    );
    const discount = Math.min(rawDiscount, cap, price);
    return { tier: 'premium', priceCents: Math.max(price - discount, 0), discountCents: discount };
  }
  return { tier: 'ineligible', priceCents: price, discountCents: 0 };
}

/** Promo-kind claim code value (percent/fixed/min-cart) for display + checkout. */
export function promoValueFor(cfg: CampaignConfig): { type: 'percent' | 'fixed'; valueCents?: number; minCartCents?: number } {
  const o = cfg.offer || {};
  if ((o.discountFixedCents || 0) > 0) {
    return { type: 'fixed', valueCents: Math.max(Number(o.discountFixedCents) || 0, 0), minCartCents: Math.max(Number(o.minCartValueCents) || 0, 0) };
  }
  return {
    type: 'percent',
    valueCents: Math.max(Number(o.discountPercentOff) || 0, 0),
    minCartCents: Math.max(Number(o.minCartValueCents) || 0, 0),
  };
}

// ---------------------------------------------------------------------------
// Templates — sensible, editable starting points for future campaigns.
// ---------------------------------------------------------------------------
function baseCfg(slug: string, kind: CampaignKind, partial: Partial<CampaignConfig>): CampaignConfig {
  return {
    slug,
    kind,
    templateKey: 'custom',
    status: 'draft',
    title: 'Untitled campaign',
    totalQuantity: 0,
    eligibility: { onePerEmail: true, onePerHousehold: true },
    popup: { enabled: false },
    referral: { enabled: false },
    email: { enabled: true },
    tracking: { channels: [] },
    updatedAt: null,
    ...partial,
    offer: { freeShipping: kind === 'gift', productScope: 'all', ...(partial.offer || {}) },
  };
}

export const TEMPLATES: Record<TemplateKey, (slug: string) => CampaignConfig> = {
  free_pet_gift: (slug) =>
    baseCfg(slug, 'gift', {
      templateKey: 'free_pet_gift',
      title: 'Luxedge Pet Gift Drop',
      subtitle: 'A limited real gift for real pet owners — no purchase required.',
      message: 'Tell us about your pet and claim an available complimentary Luxedge gift while supplies last.',
      giftValueCents: 1500,
      totalQuantity: 50,
      offer: { freeThresholdCents: 1500, freeShipping: true, productScope: 'all', maxDiscountCents: 1500 },
      audience: { petTypes: ['dog', 'cat'] },
    }),
  first_order: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'first_order',
      title: 'Welcome — your first order reward',
      subtitle: 'A little thank-you for your first Luxedge order.',
      offer: { discountPercentOff: 10, minCartValueCents: 0, maxDiscountCents: 1000, productScope: 'all', allowStacking: false },
      audience: { everyone: true },
      eligibility: { onePerEmail: true, limitPerCustomer: 1 },
    }),
  email_welcome: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'email_welcome',
      title: 'Join the Luxedge list',
      subtitle: 'Subscribe and get a welcome reward on your next order.',
      offer: { discountPercentOff: 10, minCartValueCents: 0, maxDiscountCents: 1000 },
      audience: { everyone: true },
      popup: { enabled: true, delayMs: 6000, frequencyDays: 30, headline: 'Join the Luxedge list', subtext: 'Get a welcome reward on your next order.' },
    }),
  flash_sale: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'flash_sale',
      title: 'Luxedge Flash Sale',
      subtitle: 'A short, real discount — while the sale is scheduled.',
      offer: { discountPercentOff: 25, minCartValueCents: 2500, maxDiscountCents: 5000, allowStacking: false },
      audience: { everyone: true },
    }),
  pet_birthday: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'pet_birthday',
      title: 'Pet Birthday Treat',
      subtitle: 'Celebrate your pet — enjoy a special Luxedge treat.',
      offer: { discountPercentOff: 15, minCartValueCents: 0, maxDiscountCents: 750 },
      audience: { everyone: true },
      eligibility: { onePerEmail: true },
    }),
  customer_appreciation: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'customer_appreciation',
      title: 'Thank you, Luxedge customer',
      subtitle: 'Our way of saying thanks.',
      offer: { discountFixedCents: 500, minCartValueCents: 2500, maxDiscountCents: 500, allowStacking: false },
      audience: { everyone: true },
      eligibility: { onePerEmail: true, limitPerCustomer: 1 },
    }),
  refer_a_friend: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'refer_a_friend',
      title: 'Refer a friend',
      subtitle: 'Share Luxedge — you and a friend both get a treat after their first order.',
      offer: { discountPercentOff: 10, minCartValueCents: 2500, maxDiscountCents: 1000 },
      audience: { everyone: true },
      referral: { enabled: true, shareHeadline: 'Share Luxedge with a pet-loving friend', rewardCopy: 'After their first order, you both get a reward.' },
      eligibility: { onePerEmail: true, limitPerCustomer: 1 },
    }),
  free_shipping: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'free_shipping',
      title: 'Free standard shipping',
      subtitle: 'Complimentary standard shipping on your Luxedge order.',
      offer: { freeShipping: true, minCartValueCents: 2500, allowStacking: false },
      audience: { everyone: true },
    }),
  seasonal_giveaway: (slug) =>
    baseCfg(slug, 'gift', {
      templateKey: 'seasonal_giveaway',
      title: 'Luxedge seasonal giveaway',
      subtitle: 'A real gift for a lucky few — no purchase required.',
      giftValueCents: 2000,
      totalQuantity: 25,
      offer: { freeThresholdCents: 2000, freeShipping: true, maxDiscountCents: 2000 },
      audience: { everyone: true },
    }),
  black_friday: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'black_friday',
      title: 'Luxedge Black Friday event',
      subtitle: 'Our biggest real discount of the season.',
      offer: { discountPercentOff: 40, minCartValueCents: 0, maxDiscountCents: 20000, allowStacking: false },
      audience: { everyone: true },
      priority: 100,
    }),
  christmas_pet_gift: (slug) =>
    baseCfg(slug, 'gift', {
      templateKey: 'christmas_pet_gift',
      title: 'Luxedge Christmas Pet Gift',
      subtitle: 'A complimentary holiday gift for your pet — while supplies last.',
      giftValueCents: 2000,
      totalQuantity: 75,
      offer: { freeThresholdCents: 2000, freeShipping: true, maxDiscountCents: 2000 },
      audience: { petTypes: ['dog', 'cat', 'horse', 'bird'] },
    }),
  cat_lovers: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'cat_lovers',
      title: 'For cat lovers',
      subtitle: 'A special offer on cat essentials.',
      offer: { discountPercentOff: 15, minCartValueCents: 2000, maxDiscountCents: 1500 },
      audience: { petTypes: ['cat'] },
    }),
  dog_lovers: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'dog_lovers',
      title: 'For dog lovers',
      subtitle: 'A special offer on dog essentials.',
      offer: { discountPercentOff: 15, minCartValueCents: 2000, maxDiscountCents: 1500 },
      audience: { petTypes: ['dog'] },
    }),
  horse_owner: (slug) =>
    baseCfg(slug, 'promo', {
      templateKey: 'horse_owner',
      title: 'For horse owners',
      subtitle: 'Premium equestrian essentials, at a thank-you price.',
      offer: { discountPercentOff: 12, minCartValueCents: 5000, maxDiscountCents: 3000 },
      audience: { petTypes: ['horse'] },
    }),
};

export function templateKeys(): TemplateKey[] {
  return Object.keys(TEMPLATES) as TemplateKey[];
}

export function campaignFromTemplate(key: string, slug: string): CampaignConfig | null {
  const k = key as TemplateKey;
  if (!TEMPLATES[k]) return null;
  return TEMPLATES[k](slug);
}

/** Sanitize an arbitrary slug for campaign routing. */
export function slugifyCampaign(slug: string): string {
  const s = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'campaign';
}

// ---------------------------------------------------------------------------
// Registry / flags — app_settings storage (server-only, service role)
// ---------------------------------------------------------------------------
export function supabaseEnv() {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, serviceRole };
}

export function supabaseHeadersFor(serviceRole: string, json = false): Record<string, string> {
  return json
    ? { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, 'Content-Type': 'application/json' }
    : { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` };
}

/** The two Campaign Manager documents that live in private D1 when the D1
 * backend is active. `gift_drop_campaign_v1` (Free Gift) is NOT one of them. */
const D1_CAMPAIGN_DOC_KEYS = new Set([CAMPAIGN_REGISTRY_KEY, CAMPAIGN_PRODUCT_FLAGS_KEY]);

function campaignD1(key: string): D1DatabaseLike | null {
  if (!D1_CAMPAIGN_DOC_KEYS.has(key)) return null;
  const runtime = getDataRuntime();
  return runtime.backend === 'd1' && runtime.db ? runtime.db : null;
}

/** Thrown by the strict loaders. Message is safe to show to an admin. */
export class CampaignStorageError extends Error {}

/** Read one doc, distinguishing failure from a genuinely absent value. */
async function readDocResult(key: string): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  const db = campaignD1(key);
  if (db) return readCampaignDoc(db, key);
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return { ok: false, error: 'Campaign storage is not configured.' };
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: supabaseHeadersFor(serviceRole),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Campaign storage unavailable (Supabase HTTP ${res.status}). No campaign changes were made.` };
    const rows = (await res.json()) as Array<{ value?: string }>;
    return { ok: true, value: rows[0]?.value || null };
  } catch {
    return { ok: false, error: 'Campaign storage is unreachable. No campaign changes were made.' };
  }
}

/** Admin-only health probe. Never mistake an unavailable registry for empty.
 * Does not change Gift Drop persistence.
 */
export async function campaignStorageHealth(): Promise<{ ok: boolean; error?: string }> {
  const db = campaignD1(CAMPAIGN_REGISTRY_KEY);
  if (db) {
    const r = await readCampaignDoc(db, CAMPAIGN_REGISTRY_KEY);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return { ok: false, error: 'Campaign storage is not configured.' };
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(CAMPAIGN_REGISTRY_KEY)}&select=key&limit=1`, {
      headers: supabaseHeadersFor(serviceRole), signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Campaign storage unavailable (Supabase HTTP ${res.status}). No campaign changes were made.` };
  } catch { return { ok: false, error: 'Campaign storage is unreachable. No campaign changes were made.' }; }
}

/** Admin-only probe of the claim ledger (Supabase luxedge_orders, unchanged).
 * Publishing a campaign that cannot record claims is refused while this fails. */
export async function claimStorageHealth(): Promise<{ ok: boolean; error?: string }> {
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return { ok: false, error: 'Claim storage is not configured.' };
  try {
    const res = await fetch(`${url}/rest/v1/luxedge_orders?select=id&coupon_code=eq.${encodeURIComponent(CLAIM_MARKER)}&limit=1`, {
      headers: supabaseHeadersFor(serviceRole), signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Claim storage unavailable (Supabase HTTP ${res.status}).` };
  } catch { return { ok: false, error: 'Claim storage is unreachable.' }; }
}

async function readDoc(key: string): Promise<string | null> {
  const r = await readDocResult(key);
  return r.ok ? r.value || null : null;
}

async function writeDoc(key: string, value: string): Promise<boolean> {
  const db = campaignD1(key);
  if (db) return writeCampaignDoc(db, key, value);
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return false;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings`, {
      method: 'POST',
      headers: { ...supabaseHeadersFor(serviceRole, true), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Read the whole campaign registry (defaults to empty). */
export async function loadRegistry(): Promise<CampaignConfig[]> {
  const raw = await readDoc(CAMPAIGN_REGISTRY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { campaigns?: CampaignConfig[] };
    return Array.isArray(parsed.campaigns) ? parsed.campaigns : [];
  } catch {
    return [];
  }
}

/** Strict registry read for admin reads-before-writes: throws instead of
 * returning [] so an unreadable registry can never be overwritten. */
export async function loadRegistryStrict(): Promise<CampaignConfig[]> {
  const r = await readDocResult(CAMPAIGN_REGISTRY_KEY);
  if (!r.ok) throw new CampaignStorageError(r.error);
  if (!r.value) return [];
  let parsed: { campaigns?: CampaignConfig[] };
  try { parsed = JSON.parse(r.value); } catch { throw new CampaignStorageError('Campaign registry is unreadable (invalid JSON). No campaign changes were made.'); }
  if (!parsed || !Array.isArray(parsed.campaigns)) throw new CampaignStorageError('Campaign registry is unreadable (unexpected shape). No campaign changes were made.');
  return parsed.campaigns;
}

/** Strict product-flag read (same fail-closed rule as loadRegistryStrict). */
export async function loadProductFlagsStrict(): Promise<Record<string, ProductCampaignFlag>> {
  const r = await readDocResult(CAMPAIGN_PRODUCT_FLAGS_KEY);
  if (!r.ok) throw new CampaignStorageError(r.error);
  if (!r.value) return {};
  try {
    const parsed = JSON.parse(r.value) as Record<string, ProductCampaignFlag>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  throw new CampaignStorageError('Campaign product flags are unreadable. No campaign changes were made.');
}

/** Save the whole registry (single doc — small cardinality by design). */
export async function saveRegistry(campaigns: CampaignConfig[]): Promise<boolean> {
  const dedup = campaigns.filter(Boolean);
  return writeDoc(CAMPAIGN_REGISTRY_KEY, JSON.stringify({ campaigns: dedup }));
}

/**
 * FLAGSHIP BRIDGE — the Pet Gift Drop predates the campaign registry, so its
 * config lives in the legacy `gift_drop_campaign_v1` document.
 *
 * This is a READ-ONLY mapping. The legacy document stays the single source of
 * truth (nothing here writes config, claims, inventory or the Free Gift flow),
 * and an unreadable/unavailable document returns null — never a fabricated
 * default — so the admin UI can distinguish "no flagship" from "cannot read".
 */
export async function flagshipLegacyConfig(): Promise<CampaignConfig | null> {
  const r = await readDocResult(LEGACY_GIFT_CAMPAIGN_KEY);
  if (!r.ok || !r.value) return null;
  let legacy: Record<string, unknown>;
  try {
    const parsed = JSON.parse(r.value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    legacy = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const active = legacy.active === undefined ? true : !!legacy.active;
  const endsAtRaw = typeof legacy.endsAt === 'string' && legacy.endsAt ? legacy.endsAt : null;
  const startsAtRaw = typeof legacy.startsAt === 'string' && legacy.startsAt ? legacy.startsAt : null;
  const end = endsAtRaw ? new Date(endsAtRaw).getTime() : NaN;
  const status: CampaignStatus = !active ? 'paused' : Number.isFinite(end) && end < Date.now() ? 'ended' : 'live';
  const valueCents = Math.max(Number(legacy.giftValueCents) || 0, 0);
  return {
    slug: FLAGSHIP_SLUG,
    kind: 'gift',
    templateKey: 'free_pet_gift',
    status,
    title: String(legacy.title || 'Luxedge Pet Gift Drop'),
    subtitle: '',
    message: String(legacy.message || ''),
    giftName: String(legacy.giftName || 'Complimentary Luxedge pet gift'),
    giftValueCents: valueCents,
    totalQuantity: Math.max(Number(legacy.totalQuantity) || 0, 0),
    startsAt: startsAtRaw,
    endsAt: endsAtRaw,
    audience: { petTypes: ['dog', 'cat'] },
    eligibility: { onePerEmail: true, onePerHousehold: true },
    offer: {
      freeThresholdCents: valueCents,
      premiumPercentOff: 0,
      maxDiscountCents: valueCents,
      maxEligibleRetailCents: valueCents,
      freeShipping: true,
      productScope: 'all',
    },
    popup: { enabled: true, delayMs: 4000, frequencyDays: 30, headline: 'Get Your Free Luxedge Gift', subtext: 'One free gift per person — choose an eligible item priced $15 or below. Enter your email to get your personal claim code. No credit card required.' },
    referral: { enabled: false },
    email: { enabled: true },
    tracking: {},
    updatedAt: typeof legacy.updatedAt === 'string' ? legacy.updatedAt : null,
  };
}

/**
 * Resolve one campaign by slug. The registry wins when it holds the slug (it
 * cannot legitimately hold the flagship — creating `pet-gift-drop` is rejected
 * and the flagship is edited from the Gift Drop page); otherwise the flagship
 * slug falls back to the legacy document bridge. Without that fallback the
 * Campaign Manager showed flagship = null whenever the registry had no
 * `pet-gift-drop` entry, independently of whether the legacy doc was readable.
 */
export async function loadCampaignBySlug(slug: string): Promise<CampaignConfig | null> {
  const s = String(slug || '').trim();
  if (!s) return null;
  const registry = await loadRegistry();
  const found = registry.find((c) => c.slug === s);
  if (found) return found;
  if (s === FLAGSHIP_SLUG) return flagshipLegacyConfig();
  return null;
}

/** Product flag map: productId → ProductCampaignFlag. */
export async function loadProductFlags(): Promise<Record<string, ProductCampaignFlag>> {
  const raw = await readDoc(CAMPAIGN_PRODUCT_FLAGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, ProductCampaignFlag>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveProductFlags(map: Record<string, ProductCampaignFlag>): Promise<boolean> {
  return writeDoc(CAMPAIGN_PRODUCT_FLAGS_KEY, JSON.stringify(map || {}));
}

/** Number of LIVE claimed gifts for a campaign (legacy rows → flagship).
 * Counts matching rows in JS because the campaign slug lives inside the
 * shipping_address JSON envelope (no DDL — no column to filter on server-side).
 * `isTest` toggles whether test claims are included (default: real claims). */
export async function liveClaimCount(campaignSlug: string, isTest = false): Promise<number> {
  const { url, serviceRole } = supabaseEnv();
  if (!url || !serviceRole) return -1;
  try {
    const res = await fetch(
      `${url}/rest/v1/luxedge_orders?select=shipping_address&coupon_code=eq.${encodeURIComponent(CLAIM_MARKER)}&status=not.in.(cancelled,failed)&limit=1000`,
      { headers: supabaseHeadersFor(serviceRole), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return -1;
    const rows = (await res.json()) as Array<{ shipping_address?: { _gift?: ClaimEnvelope } }>;
    if (!Array.isArray(rows)) return -1;
    return rows.filter((r) => {
      const g = r.shipping_address?._gift;
      const sameCampaign = (g?.campaignSlug || FLAGSHIP_SLUG) === campaignSlug;
      if (!sameCampaign) return false;
      return isTest ? !!g?.isTest : !g?.isTest;
    }).length;
  } catch {
    return -1;
  }
}

/** Real remaining gifts for a campaign config. */
export async function remainingFor(cfg: CampaignConfig): Promise<number> {
  const total = Math.max(Number(cfg.totalQuantity) || 0, 0);
  if (total <= 0) return 0;
  const count = await liveClaimCount(cfg.slug);
  return count < 0 ? -1 : Math.max(total - count, 0);
}
