// ============================================================================
// D1-backed first-party traffic analytics (client).
//
// Replaces the dashboard's direct Supabase PostgREST read of `site_events`:
// Supabase answers 402 exceed_egress_quota on every surface, and the D1 admin
// session (lx_buyer cookie) is not a Supabase JWT — so the old reader showed
// "Sign in as admin" to a signed-in admin. This service talks to the Worker's
// /api/admin/traffic route instead (admin cookie -> server-side gate -> D1),
// keeping the same SiteEventRow shape the dashboard already renders.
//
// The Supabase direct read stays available as a fallback for deployments that
// still run Supabase Auth (rollback path), selected by explicit config.
// ============================================================================

import type { SiteEventRow } from './siteEvents';

export type { SiteEventRow };

export interface TrafficResult {
  rows: SiteEventRow[];
  source: 'd1' | 'supabase';
  error?: string;
}

/**
 * Fetch the last `days` of events for the Traffic dashboard.
 * Tries the D1 route first; falls back to the legacy Supabase read only when
 * the route is not deployed (404) — a 401/403 from the route means the admin
 * cookie is genuinely missing/insufficient and is surfaced, not swallowed.
 */
export async function fetchTrafficEvents(days = 30): Promise<TrafficResult> {
  try {
    const res = await fetch(`/api/admin/traffic?days=${encodeURIComponent(String(days))}`, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (res.status === 404) {
      // Worker predates the route — let the caller use the Supabase fallback.
      return { rows: [], source: 'supabase', error: 'route-missing' };
    }
    if (res.status === 401 || res.status === 403) {
      return { rows: [], source: 'd1', error: 'Sign in as admin to view traffic analytics.' };
    }
    if (res.status === 503) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { rows: [], source: 'd1', error: body.error || 'Traffic analytics is not available on this deployment.' };
    }
    if (!res.ok) {
      return { rows: [], source: 'd1', error: `Could not load analytics (HTTP ${res.status}).` };
    }
    const data = (await res.json()) as { rows?: SiteEventRow[]; source?: string };
    return { rows: Array.isArray(data.rows) ? data.rows : [], source: 'd1' };
  } catch (e) {
    return { rows: [], source: 'd1', error: (e as Error).message || 'Traffic analytics is unreachable.' };
  }
}

/**
 * Best-effort storefront ingest to the D1 table. Never throws, never blocks —
 * analytics must not break the storefront. Returns silently on any failure.
 */
export function recordTrafficEvent(event: {
  event: string;
  path: string;
  referrer?: string | null;
  visitor_id?: string | null;
  session_id?: string | null;
  device?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  item_ids?: string[] | null;
  value?: number | null;
  currency?: string | null;
}): void {
  const payload = JSON.stringify(event);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      // sendBeacon cannot set Origin-less requests; same-origin POSTs carry the
      // page origin, which is exactly what the CSRF guard expects.
      navigator.sendBeacon('/api/admin/traffic', blob);
      return;
    }
  } catch {
    /* fall through to fetch */
  }
  fetch('/api/admin/traffic', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    /* best-effort */
  });
}
