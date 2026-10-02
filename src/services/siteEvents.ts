// ============================================================================
// SITE EVENTS — first-party traffic analytics
//
// The storefront records lightweight events (page_view, view_item, add_to_cart,
// begin_checkout, purchase, search, ...) into Supabase so the Admin "Traffic
// Overview" can show real visitor numbers and charts. This is independent of
// Google: GA4 still receives the same events via gtag, but our dashboard reads
// from this table.
//
// SECURITY (see supabase/migrations/0023_site_events.sql):
//   * Any visitor records events with the ANON key (INSERT only; RLS).
//   * Only an authenticated admin role may SELECT for the dashboard.
// Recording is fire-and-forget and must NEVER break the storefront.
// ============================================================================

import { getSupabaseConfig, getFreshAccessToken } from './supabase';
import { recordTrafficEvent } from './traffic';

const VID_KEY = 'luxedge_vid';
const SID_KEY = 'luxedge_sid';

// Schema-probe cache: the recorder/reader include revenue fields (value,
// currency) only when migration 0024 has been applied. null = unknown.
let supportsRevenue: boolean | null = null;

/** Test-only hook: reset the module-level schema-probe cache. */
export function __resetSiteEventsForTests(): void {
  supportsRevenue = null;
}

function isMissingColumnResponse(res: Response): Promise<boolean> {
  return res
    .clone()
    .text()
    .then((t) => /PGRST204/.test(t) || /42703/.test(t) || /schema cache/i.test(t) || /does not exist/i.test(t))
    .catch(() => false);
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to Math.random */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ids(): { visitor: string; session: string } {
  let visitor = '';
  let session = '';
  try {
    visitor = localStorage.getItem(VID_KEY) || '';
    if (!visitor) {
      visitor = makeId();
      localStorage.setItem(VID_KEY, visitor);
    }
    session = sessionStorage.getItem(SID_KEY) || '';
    if (!session) {
      session = makeId();
      sessionStorage.setItem(SID_KEY, session);
    }
  } catch {
    visitor = visitor || makeId();
    session = session || makeId();
  }
  return { visitor, session };
}

function detectDevice(ua: string): string {
  if (/(iPad|Tablet)/i.test(ua)) return 'tablet';
  if (/(Mobi|Android|iPhone|iPod)/i.test(ua)) return 'mobile';
  return 'desktop';
}

export interface TrackParams {
  [key: string]: unknown;
}

/**
 * Record an event for first-party analytics. Fire-and-forget: swallows every
 * error (network, storage, missing table) so analytics can never break the
 * storefront. Admin paths and the admin panel itself are never recorded.
 */
export function recordSiteEvent(name: string, params: TrackParams = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname + window.location.search;
    if (path.startsWith('/admin')) return; // keep public traffic honest

    const device = detectDevice(navigator.userAgent);
    const { visitor, session } = ids();

    let referrer = '';
    try {
      const raw = document.referrer || '';
      referrer = raw.startsWith(window.location.origin) ? '' : raw;
    } catch {
      /* ignore */
    }

    const items = params.items;
    let item_ids: string[] | null = null;
    if (Array.isArray(items)) {
      item_ids = items.map((i) => String((i as { item_id?: unknown; id?: unknown })?.item_id ?? (i as { id?: unknown })?.id ?? '')).filter(Boolean).slice(0, 20);
    }
    if (item_ids && item_ids.length === 0) item_ids = null;

    const numericValue = typeof params.value === 'number' && Number.isFinite(params.value) ? params.value
      : typeof params.value === 'string' && params.value.trim() !== '' ? Number(params.value) : NaN;
    const currency = typeof params.currency === 'string' && params.currency.trim() ? params.currency.trim() : null;

    // Mirror into the D1 ingest route (same-origin, cookie-less, rate-limited
    // server-side) AFTER the admin-path guard. The D1 table always carries the
    // revenue columns, so value/currency are not gated by the Supabase probe.
    // Supabase remains the primary sink below so a rollback deployment keeps
    // its original path; both sinks tolerate each other's absence and neither
    // can break the storefront.
    recordTrafficEvent({
      event: name,
      path,
      referrer: referrer || null,
      visitor_id: visitor,
      session_id: session,
      device,
      utm_source: params.campaign_source ? String(params.campaign_source) : null,
      utm_medium: params.campaign_medium ? String(params.campaign_medium) : null,
      utm_campaign: params.campaign_name ? String(params.campaign_name) : null,
      item_ids: item_ids || null,
      value: Number.isFinite(numericValue) ? numericValue : null,
      currency,
    });

    const cfg = getSupabaseConfig();
    if (!cfg) return;

    const body: Record<string, unknown> = {
      event: name,
      path,
      referrer: referrer || null,
      visitor_id: visitor,
      session_id: session,
      device,
      utm_source: params.campaign_source ? String(params.campaign_source) : null,
      utm_medium: params.campaign_medium ? String(params.campaign_medium) : null,
      utm_campaign: params.campaign_name ? String(params.campaign_name) : null,
      item_ids: item_ids || null,
    };

    // Revenue fields (migration 0024). Only sent once the columns exist;
    // if the first probe 400s, fall back to the base insert so analytics
    // recording NEVER stops just because a migration is pending.
    if (supportsRevenue !== false) {
      if (!Number.isNaN(numericValue)) body.value = numericValue;
      if (currency) body.currency = currency;
    }

    const send = (b: Record<string, unknown>) =>
      fetch(`${cfg.url}/rest/v1/site_events`, {
        method: 'POST',
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(b),
      }).catch(() => {
        /* ignore — best-effort analytics */
      });

    send(body).then((res) => {
      if (res && res.status === 400 && supportsRevenue !== false) {
        isMissingColumnResponse(res).then((missing) => {
          if (missing) {
            supportsRevenue = false;
            const base = { ...body };
            delete base.value;
            delete base.currency;
            send(base); // retry without revenue fields — never lose the event
          }
        });
      } else if (res && res.ok) {
        supportsRevenue = true;
      }
    });
  } catch {
    /* never throw, never break the storefront */
  }
}

export interface SiteEventRow {
  event: string;
  path: string;
  referrer: string | null;
  visitor_id: string | null;
  session_id: string | null;
  device: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  item_ids: unknown | null;
  value: number | null;
  currency: string | null;
  occurred_at: string;
}

/**
 * Fetch the last `days` of events as a signed-in admin. Throws on auth
 * failure or an unreadable response (e.g. the table is not migrated yet).
 */
export async function fetchSiteEvents(days = 30): Promise<SiteEventRow[]> {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Traffic analytics is not configured (Supabase missing).');
  const token = await getFreshAccessToken();
  if (!token) throw new Error('Sign in as admin to view traffic analytics.');

  const since = new Date(Date.now() - days * 86400000).toISOString();
  // Newest-first so the 50k cap keeps the most recent events (asc would keep
  // the OLDEST once a window exceeds 50k — stale dashboard).
  const select = supportsRevenue === false
    ? 'event,path,referrer,visitor_id,session_id,device,utm_source,utm_medium,utm_campaign,item_ids,occurred_at'
    : 'event,path,referrer,visitor_id,session_id,device,utm_source,utm_medium,utm_campaign,item_ids,value,currency,occurred_at';
  const url =
    `${cfg.url}/rest/v1/site_events?select=${encodeURIComponent(select)}` +
    `&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=50000`;

  const read = async (u: string): Promise<Response> =>
    fetch(u, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` } });

  let res = await read(url);
  // Migration 0024 not applied yet — every missing-column 400 falls back to the
  // base select so the dashboard still works (revenue shows as unavailable).
  // Deliberately NOT gated on `supportsRevenue !== false`: under concurrent
  // calls (day-range switches, remounts) one call can flip the module flag to
  // false while another in-flight FULL select is still pending; gating the
  // retry on the flag then makes that loser throw the raw 400. A 400 that is
  // a missing-column error must always recover.
  if (res.status === 400) {
    const missing = await isMissingColumnResponse(res);
    if (missing) {
      supportsRevenue = false;
      const baseSelect = 'event,path,referrer,visitor_id,session_id,device,utm_source,utm_medium,utm_campaign,item_ids,occurred_at';
      res = await read(
        `${cfg.url}/rest/v1/site_events?select=${encodeURIComponent(baseSelect)}` +
        `&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=50000`,
      );
    }
  }
  if (res.status === 404) {
    throw new Error('Analytics table is not ready (run migration 0023).');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Sign in as admin to view traffic analytics.');
  }
  if (!res.ok) throw new Error(`Could not load analytics (HTTP ${res.status}).`);
  const rows = (await res.json()) as SiteEventRow[];
  return rows.map((r) => ({ ...r, value: r.value ?? null, currency: r.currency ?? null }));
}