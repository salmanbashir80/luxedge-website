// ============================================================================
// /api/admin/traffic — first-party traffic analytics on D1 (site_events).
//
// GET  ?days=N  -> aggregated dashboard data (admin-gated)
// POST          -> storefront event ingest (PUBLIC — cookie-less analytics)
//
// Why this route exists: the Admin "Traffic Overview" used to read `site_events`
// straight from Supabase PostgREST with the legacy admin JWT. Supabase answers
// 402 exceed_egress_quota on every surface, and the D1 admin session does not
// carry that JWT — so a signed-in admin saw "Traffic data unavailable / Sign in
// as admin". The D1 `site_events` table (migration 0006) plus this route is the
// Supabase-free replacement.
//
// SECURITY:
//   * GET requires an admin (sessionAdmin first, legacy JWT paths preserved).
//   * POST is public BY DESIGN — analytics with no cookies, no personal data.
//     It is rate-limited per IP (durable limiter) and every field is clamped:
//     lengths, enum device, known event names, capped item_ids, bounded value.
//     It can only ever INSERT; there is no read path without the admin gate.
//   * Unknown/malformed payloads are dropped silently with 204 (analytics must
//     never break the storefront) — but oversized bodies are rejected (413).
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';

import { adminAuth } from '../_lib/auth.js';
import { sendJson } from '../_lib/providers.js';
import { authDb, consumeRateLimit, stateChangingRequestAllowed, allowedOrigins } from '../../worker/auth/store';

/** 204 with no body — sendJson always emits a JSON payload. */
function sendNoContent(res: ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

const MAX_BODY_BYTES = 4_096;
const MAX_DAYS = 365;
const KNOWN_EVENTS = new Set([
  'page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase', 'search',
  'wishlist_add', 'wishlist_remove', 'view_cart', 'begin_signin', 'contact_submit',
]);

function clamp(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null); // signal: too large — caller answers 413
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return clamp(raw || 'unknown', 64);
}

// ---------------------------------------------------------------------------
// POST — public ingest
// ---------------------------------------------------------------------------

async function ingest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CSRF: a state-changing ingest from a foreign origin is refused, same as
  // every other auth route (origin allowlist + JSON content type).
  const verdict = stateChangingRequestAllowed(
    req.headers as Record<string, string | string[] | undefined>,
    allowedOrigins(),
  );
  if (!verdict.ok) {
    sendNoContent(res); // never an error page in the storefront
    return;
  }

  // Rate limit SECOND: 120 events / hour / IP is far above any real browsing
  // session but caps abuse (durable D1 limiter, same primitive as auth).
  const rl = await consumeRateLimit(`traffic-ingest:${clientIp(req)}`, 120, 3600);
  if (!rl.allowed) {
    sendNoContent(res);
    return;
  }

  const raw = await readBody(req);
  if (raw === null) {
    sendJson(res, 413, { error: 'Payload too large.' });
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    sendNoContent(res); // analytics: never an error page in the storefront
    return;
  }

  const event = clamp(parsed.event, 40).toLowerCase();
  if (!KNOWN_EVENTS.has(event)) {
    sendNoContent(res);
    return;
  }

  const itemIdsRaw = parsed.item_ids;
  const itemIds = Array.isArray(itemIdsRaw)
    ? JSON.stringify(itemIdsRaw.slice(0, 20).map((x) => clamp(x, 64)))
    : null;

  const valueNum = Number(parsed.value);
  const value = Number.isFinite(valueNum) && valueNum >= 0 && valueNum <= 1_000_000 ? valueNum : null;
  const currency = clamp(parsed.currency, 8).toUpperCase() || null;
  const device = ['mobile', 'tablet', 'desktop'].includes(clamp(parsed.device, 10))
    ? clamp(parsed.device, 10)
    : null;

  const db = authDb();
  if (!db) {
    // Same contract as auth: a missing binding answers 503 (never pretend).
    sendJson(res, 503, { error: 'Traffic analytics is not available on this deployment.' });
    return;
  }

  try {
    await db
      .prepare(
        `INSERT INTO site_events (id, event, path, referrer, visitor_id, session_id, device,
           utm_source, utm_medium, utm_campaign, item_ids, value, currency, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        event,
        clamp(parsed.path, 300) || '/',
        clamp(parsed.referrer, 300) || null,
        clamp(parsed.visitor_id, 64) || null,
        clamp(parsed.session_id, 64) || null,
        device,
        clamp(parsed.utm_source, 100) || null,
        clamp(parsed.utm_medium, 100) || null,
        clamp(parsed.utm_campaign, 100) || null,
        itemIds,
        value,
        currency,
        new Date().toISOString(),
      )
      .run?.();
    sendNoContent(res);
  } catch {
    sendNoContent(res); // analytics failures never surface to visitors
  }
}

// ---------------------------------------------------------------------------
// GET — admin dashboard aggregation
// ---------------------------------------------------------------------------

interface SiteEventRow {
  event: string;
  path: string;
  visitor_id: string | null;
  session_id: string | null;
  device: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  item_ids: string | null;
  value: number | null;
  currency: string | null;
  occurred_at: string;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'POST' || req.method === 'OPTIONS') {
    await ingest(req, res);
    return;
  }

  const auth = await adminAuth(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }

  const url = new URL(req.url || '/', 'https://luxedge.us');
  const daysRaw = Number(url.searchParams.get('days') || 30);
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 ? Math.min(Math.floor(daysRaw), MAX_DAYS) : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const db = authDb();
  if (!db) {
    sendJson(res, 503, { error: 'Traffic analytics is not available on this deployment.' });
    return;
  }

  try {
    const out = await db
      .prepare(
        `SELECT event, path, visitor_id, session_id, device, utm_source, utm_medium,
                utm_campaign, item_ids, value, currency, occurred_at
         FROM site_events
         WHERE occurred_at >= ?
         ORDER BY occurred_at DESC
         LIMIT 50000`,
      )
      .bind(since)
      .all<SiteEventRow>();
    const rows = (out?.results || []).map((r) => ({
      ...r,
      item_ids: r.item_ids ? JSON.parse(r.item_ids) : null,
    }));
    sendJson(res, 200, { rows, days, source: 'd1' });
  } catch {
    sendJson(res, 503, { error: 'Analytics table is not ready (apply D1 migration 0006).' });
  }
}
