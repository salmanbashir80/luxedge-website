// ============================================================================
// LUXEDGE — /api/admin/erp  (Embani ERP sync — server-side only)
//
// The admin browser NEVER talks to the ERP webhook directly. This endpoint is
// the only component that holds the webhook URL + API token (env vars win,
// app_settings as the owner-attachable fallback), calls Embani ERP, and
// records each order's sync state so we always know which Luxedge orders were
// transmitted. State lives on the luxedge_orders row (erp_sync_status /
// erp_synced_at / erp_sync_error — migration 0029) once those columns exist,
// with an automatic fallback to the ERP_SYNC_STATUS app_settings doc before
// the migration is applied (auto-detected, 5-min probe cache).
//
//   GET /api/admin/erp
//       → { webhook: { configured, masked, source }, token: {...},
//           sync: { [order_number]: { status, synced_at, error? } },
//           syncLog: [{ order_number, status, at, error? }...] (history, newest first) }
//       NEVER returns the raw token or the full webhook URL.
//
//   On any push that ends with failures, the owner is emailed (SEND_MAIL
//   binding) a list of the failed order numbers so they can re-push those.
//   The alert is best-effort and never affects the push result.
//
//   POST /api/admin/erp
//       { action: 'set',   field: 'webhook'|'token', value }  → store server-side
//       { action: 'clear', field: 'webhook'|'token' }         → remove attached value
//       { action: 'test' }                                    → harmless ERP probe
//       { action: 'push', orderNumbers?: string[] }           → sync real orders (or a subset for retry)//   { action: 'clear-failed' }                            → clear failed sync state
//
// PUSH CONTRACT (Luxedge → Embani ERP webhook):
//   POST <webhook>  Authorization: Bearer <token>
//   { app: 'luxedge', event: 'orders.sync', sent_at, orders: [Order...] }
//
//   Order normalization (stable, never re-created):
//     source, order_id, order_number (STABLE — reused on retry so ERP can
//     reconcile instead of duplicating), order_type ('paid' | 'free_gift'),
//     payment_required, payment_provider (identity only — 'stripe' for paid
//     orders carrying a Stripe reference, 'none' for gifts), stripe_session_id,
//     stripe_payment_intent, created_at, currency, subtotal, shipping, tax,
//     discount, total, payment_status, fulfillment_status, coupon_code,
//     customer { name, email }, shipping_address, items[{ product_id, sku,
//     name, quantity, unit_price, line_total }]
//
//   ORDER TYPES (mapped 1:1 from the source rows):
//     - Paid sale       → order_type 'paid',  payment_status 'paid' — books
//                          revenue on the ERP side.
//     - Awaiting/unpaid → payment_status 'awaiting_payment' (or 'failed' /
//                          'cancelled') — receipt-only, the ERP books nothing.
//     - Gift Drop claim → coupon_code PET-GIFT-DROP → order_type 'free_gift',
//                          payment_required false, payment_provider 'none',
//                          payment_status 'not_required', all amounts $0. The
//                          ERP books it as a $0 promotional claim — NEVER as
//                          sale revenue.
//
//   Response parsing (lenient — handles several ERP shapes):
//     { created: 9, updated: 3 } | { created: [...], updated: [...] } |
//     { ok: true, orders_synced: N } | { failed: [{order_number, reason}] }
//
// SECURITY:
//   - Secrets live only in server env / app_settings. The GET response masks
//     everything; set/clear never echo values.
//   - The webhook target is SSRF-guarded (validateFetchTarget) like fetch-page.
//   - Only genuinely persisted rows are pushed — the demo order (LX-1001)
//     lives only in the browser UI and can never reach ERP. Test-mode gift
//     claims (shipping_address._gift.isTest) are never forwarded.
//   - 12s timeout, sanitized errors (never include the token or full URL).
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, rateLimited, clientIp } from '../_lib/providers.js';
import { upsertAppSetting, deleteAppSetting } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';
import { validateFetchTarget } from '../_lib/ssrf.js';
import { commerceFetch, commerceDbActive } from '../../worker/d1/commerce';

const ERP_WEBHOOK_KEY = 'ERP_WEBHOOK_URL';
const ERP_TOKEN_KEY = 'ERP_API_TOKEN';
const ERP_SYNC_LEDGER_KEY = 'ERP_SYNC_STATUS';
const ERP_SYNC_LOG_KEY = 'ERP_SYNC_LOG';
/** Cap the append-only sync history so the doc can never grow unbounded. */
const ERP_SYNC_LOG_CAP = 2000;

const ERP_TIMEOUT_MS = 12_000;

type SyncStatus = 'created' | 'updated' | 'sent' | 'failed';

interface SyncEntry {
  status: SyncStatus;
  synced_at?: string;
  error?: string;
}

/** One row of the append-only sync history (never overwritten — the ledger keeps
 *  the latest status per order, this keeps every attempt with its timestamp). */
interface SyncLogEntry {
  order_number: string;
  status: SyncStatus;
  at: string;
  error?: string;
}

function envWebhook(): string {
  return (process.env.EMBANI_ERP_WEBHOOK_URL || '').trim();
}
function envToken(): string {
  return (process.env.EMBANI_ERP_API_TOKEN || '').trim();
}

function maskToken(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** Mask a webhook URL: keep the scheme+host (so the admin can identify it), mask the rest. */
function maskWebhook(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/••••••`;
  } catch {
    return '••••••••';
  }
}

function statusOf(configured: boolean, masked: string, source: 'env' | 'attached' | 'none') {
  return { configured, masked, source };
}

async function readSetting(key: string): Promise<string | null> {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRole) return null;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ value?: string }>;
    return rows[0]?.value?.trim() || null;
  } catch {
    return null;
  }
}

/** Effective config: env wins over the attached (DB) value. */
async function effectiveConfig(): Promise<{ webhook: string; token: string; webhookSource: 'env' | 'attached' | 'none'; tokenSource: 'env' | 'attached' | 'none' }> {
  const [dbWebhook, dbToken] = await Promise.all([readSetting(ERP_WEBHOOK_KEY), readSetting(ERP_TOKEN_KEY)]);
  const wh = envWebhook() || dbWebhook || '';
  const tk = envToken() || dbToken || '';
  return {
    webhook: wh,
    token: tk,
    webhookSource: envWebhook() ? 'env' : dbWebhook ? 'attached' : 'none',
    tokenSource: envToken() ? 'env' : dbToken ? 'attached' : 'none',
  };
}

// ============================================================================
// SYNC-STATE STORAGE — per-row columns (migration 0029) vs app_settings ledger
//
// The endpoint auto-detects the erp_sync_* columns on luxedge_orders (5-minute
// probe cache) and stores each order's ERP state ON its own row when present —
// state can never be lost by concurrent paid orders again. Until migration
// 0029 is applied it transparently falls back to the single ERP_SYNC_STATUS
// app_settings doc, so the two modes never mix and NO deploy is required when
// the owner applies the migration.
// ============================================================================
const ERP_SYNC_COLUMNS = ['erp_sync_status', 'erp_synced_at', 'erp_sync_error'];
let erpColumnsProbeAt = 0;
let erpColumnsProbe = false;
/** Test seam — force a storage mode without probing the live schema. */
let erpColumnsOverride: boolean | null = null;
export function __setErpColumnsModeForTests(mode: boolean | null): void {
  erpColumnsOverride = mode;
}
export function __resetErpColumnsProbeForTests(): void {
  erpColumnsOverride = null;
  erpColumnsProbeAt = 0;
}

function supabaseCfg(): { url: string; serviceRole: string } | null {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && serviceRole ? { url, serviceRole } : null;
}

/** True when luxedge_orders carries the erp_sync_* columns (migration 0029). */
async function erpColumnsAvailable(): Promise<boolean> {
  if (erpColumnsOverride !== null) return erpColumnsOverride;
  // On Cloudflare D1 the columns are part of migration 0002, so the ledger lives
  // on the order row unconditionally — no probe, and no dependency on a schema
  // probe that would need Supabase (which is 402-restricted).
  if (commerceDbActive()) {
    erpColumnsProbe = true;
    erpColumnsProbeAt = Date.now();
    return true;
  }
  const now = Date.now();
  if (now - erpColumnsProbeAt < 5 * 60_000) return erpColumnsProbe;
  const cfg = supabaseCfg();
  erpColumnsProbe = false;
  if (cfg) {
    try {
      const res = await fetch(`${cfg.url}/rest/v1/luxedge_orders?select=order_number,${ERP_SYNC_COLUMNS.join(',')}&limit=1`, {
        headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
        signal: AbortSignal.timeout(6_000),
      });
      erpColumnsProbe = res.status === 200;
    } catch {
      erpColumnsProbe = false;
    }
  }
  erpColumnsProbeAt = now;
  return erpColumnsProbe;
}

function parseLedgerDoc(raw: string | null): Record<string, SyncEntry> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SyncEntry>) : {};
  } catch {
    return {};
  }
}

/** Read the sync-state map keyed by order_number (columns when available, else ledger). */
async function readErpSync(): Promise<Record<string, SyncEntry>> {
  if (await erpColumnsAvailable()) {
    const cfg = supabaseCfg();
    if (!cfg) return {};
    try {
      const res = await fetch(`${cfg.url}/rest/v1/luxedge_orders?erp_sync_status=not.is.null&select=order_number,${ERP_SYNC_COLUMNS.join(',')}`, {
        headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return {};
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const map: Record<string, SyncEntry> = {};
      for (const r of rows) {
        const orderNumber = String(r.order_number || '');
        const status = String(r.erp_sync_status || '');
        if (!orderNumber || !status) continue;
        map[orderNumber] = {
          status: status as SyncStatus,
          synced_at: r.erp_synced_at ? String(r.erp_synced_at) : undefined,
          error: r.erp_sync_error ? String(r.erp_sync_error) : undefined,
        };
      }
      return map;
    } catch {
      return {};
    }
  }
  return parseLedgerDoc(await readSetting(ERP_SYNC_LEDGER_KEY));
}

/** Write sync entries for the given order numbers (one PATCH per row in column mode). */
async function writeErpSyncEntries(entries: Record<string, SyncEntry>): Promise<boolean> {
  const keys = Object.keys(entries);
  if (!keys.length) return true;
  // Append to the history log on EVERY outcome write — manual push, per-order
  // retry, auto-forward, and whole-batch failures all leave a timestamped row.
  await appendErpSyncLog(entries);
  if (await erpColumnsAvailable()) {
    const cfg = supabaseCfg();
    const d1Active = commerceDbActive();
    if (!cfg && !d1Active) return false;
    try {
      await Promise.all(keys.map(async (orderNumber) => {
        const e = entries[orderNumber];
        const body = { erp_sync_status: e.status, erp_synced_at: e.synced_at ?? null, erp_sync_error: e.error ?? null };
        const d1 = await commerceFetch('luxedge_orders', `?order_number=eq.${encodeURIComponent(orderNumber)}`, {
          method: 'PATCH',
          body,
          prefer: 'return=minimal',
        });
        if (d1) return;
        if (!cfg) return;
        await fetch(`${cfg.url}/rest/v1/luxedge_orders?order_number=eq.${encodeURIComponent(orderNumber)}`, {
          method: 'PATCH',
          headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
      }));
      return true;
    } catch {
      return false;
    }
  }
  // Ledger fallback — merge into the doc so untouched orders keep their state.
  const ledger = parseLedgerDoc(await readSetting(ERP_SYNC_LEDGER_KEY));
  for (const k of keys) ledger[k] = entries[k];
  return upsertAppSetting(ERP_SYNC_LEDGER_KEY, JSON.stringify(ledger));
}

// ---------------------------------------------------------------------------
// SYNC HISTORY — append-only log of every attempt (created/updated/failed with
// timestamps). Lives in the ERP_SYNC_LOG app_settings doc so it works in BOTH
// storage modes (before and after migration 0029) with no schema dependency.
// Appends use a read-modify-write guarded by the row's updated_at stamp so two
// concurrent paid orders cannot lose each other's history rows.
// ---------------------------------------------------------------------------
function parseSyncLogDoc(raw: string | null): SyncLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncLogEntry[]) : [];
  } catch {
    return [];
  }
}

/** Read the full sync history, newest attempt first (capped for the response). */
async function readErpSyncLog(): Promise<SyncLogEntry[]> {
  const cfg = supabaseCfg();
  if (!cfg) return [];
  try {
    const res = await fetch(`${cfg.url}/rest/v1/app_settings?key=eq.${encodeURIComponent(ERP_SYNC_LOG_KEY)}&select=value`, {
      headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ value?: string }>;
    return parseSyncLogDoc(rows[0]?.value ?? null)
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, 1000);
  } catch {
    return [];
  }
}

/** Append history entries (order_number → outcome). Best-effort, never throws.
 *  Concurrency-safe: retries up to 3 times when the stamp moved between read
 *  and write. Creates the doc on first use. */
async function appendErpSyncLog(entries: Record<string, SyncEntry>): Promise<void> {
  const cfg = supabaseCfg();
  const list = Object.entries(entries);
  if (!cfg || !list.length) return;
  const now = new Date().toISOString();
  const incoming: SyncLogEntry[] = list.map(([order_number, e]) => ({
    order_number,
    status: e.status,
    at: e.synced_at || now,
    ...(e.error ? { error: e.error } : {}),
  }));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const get = await fetch(`${cfg.url}/rest/v1/app_settings?key=eq.${encodeURIComponent(ERP_SYNC_LOG_KEY)}&select=value,updated_at`, {
        headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
        signal: AbortSignal.timeout(6_000),
      });
      if (!get.ok) return;
      const rows = (await get.json()) as Array<{ value?: string; updated_at?: string }>;
      const current = parseSyncLogDoc(rows[0]?.value ?? null);
      const merged = [...incoming, ...current].slice(0, ERP_SYNC_LOG_CAP);
      const stamp = rows[0]?.updated_at;
      const newValue = JSON.stringify(merged);

      if (!stamp) {
        // No row yet — create it (upsert; the first-ever append cannot race).
        const post = await fetch(`${cfg.url}/rest/v1/app_settings`, {
          method: 'POST',
          headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ key: ERP_SYNC_LOG_KEY, value: newValue, updated_at: new Date().toISOString() }),
          signal: AbortSignal.timeout(6_000),
        });
        if (post.ok) return;
        continue;
      }

      // Conditional write — if the stamp moved, 0 rows update and we retry on
      // the fresher copy instead of clobbering a concurrent append.
      const patch = await fetch(`${cfg.url}/rest/v1/app_settings?key=eq.${encodeURIComponent(ERP_SYNC_LOG_KEY)}&updated_at=eq.${encodeURIComponent(stamp)}`, {
        method: 'PATCH',
        headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ value: newValue, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(6_000),
      });
      if (!patch.ok) return;
      const body = await patch.text().catch(() => '');
      let affected = -1;
      try {
        const parsed = body ? JSON.parse(body) : null;
        affected = Array.isArray(parsed) ? parsed.length : -1;
      } catch {
        affected = -1;
      }
      if (affected === 0) continue; // stale stamp → re-read and retry
      return;
    } catch {
      return;
    }
  }
}

/** Clear every failed sync entry; returns how many were cleared. */
async function clearErpFailed(): Promise<number> {
  if (await erpColumnsAvailable()) {
    const cfg = supabaseCfg();
    const d1Active = commerceDbActive();
    if (!cfg && !d1Active) return 0;
    try {
      const clearBody = { erp_sync_status: null, erp_synced_at: null, erp_sync_error: null };
      if (d1Active) {
        const list = await commerceFetch('luxedge_orders', '?erp_sync_status=eq.failed&select=id');
        const rows = (list?.ok && Array.isArray(list.data) ? list.data : []) as Array<{ id?: string }>;
        const ids = rows.map((r) => r.id).filter((x): x is string => Boolean(x));
        if (!ids.length) return 0;
        const patch = await commerceFetch('luxedge_orders', `?id=in.(${ids.join(',')})`, {
          method: 'PATCH',
          body: clearBody,
          prefer: 'return=minimal',
        });
        return patch?.ok ? ids.length : 0;
      }
      const list = await fetch(`${cfg!.url}/rest/v1/luxedge_orders?erp_sync_status=eq.failed&select=id`, {
        headers: { apikey: cfg!.serviceRole, Authorization: `Bearer ${cfg!.serviceRole}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!list.ok) return 0;
      const rows = (await list.json()) as Array<{ id?: string }>;
      const ids = rows.map((r) => r.id).filter((x): x is string => Boolean(x));
      if (!ids.length) return 0;
      // ids come from the uuid column — plain (unquoted) values keep the URL
      // valid for fetch; PostgREST parses id=in.(a,b,c) natively.
      const patch = await fetch(`${cfg!.url}/rest/v1/luxedge_orders?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: { apikey: cfg!.serviceRole, Authorization: `Bearer ${cfg!.serviceRole}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(clearBody),
        signal: AbortSignal.timeout(10_000),
      });
      return patch.ok ? ids.length : 0;
    } catch {
      return 0;
    }
  }
  const ledger = parseLedgerDoc(await readSetting(ERP_SYNC_LEDGER_KEY));
  const failed = Object.entries(ledger).filter(([, e]) => e.status === 'failed');
  if (!failed.length) return 0;
  for (const [number] of failed) delete ledger[number];
  return (await upsertAppSetting(ERP_SYNC_LEDGER_KEY, JSON.stringify(ledger))) ? failed.length : 0;
}

/** Make one ERP call (default 12s timeout); sanitized on failure. */
async function callErp(webhook: string, token: string, body: Record<string, unknown>, timeoutMs: number = ERP_TIMEOUT_MS): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    const msg = (e as Error).message || 'network error';
    // Timeout / network failure — do not leak URL or token details.
    return { ok: false, status: 0, body: '', error: msg.includes('timeout') ? 'ERP request timed out' : 'Could not reach the ERP server' };
  }
}

/** The owner's email for operational alerts. Overridable via env; defaults to
 *  the store owner address used across the app (email routing forward target). */
function ownerAlertEmail(): string {
  return (process.env.ERP_ALERT_EMAIL || process.env.OWNER_EMAIL || '8002salman@gmail.com').trim().toLowerCase();
}

/** Send the owner an email (via the SEND_MAIL binding) when an ERP push batch
 *  ended with failures. Best-effort and NEVER throws — the push response must
 *  not be affected by email availability. Lists the failed order numbers so
 *  the owner can re-push exactly those from Admin → Orders. */
async function sendErpFailureAlert(
  req: IncomingMessage,
  failed: Array<{ order_number?: string; reason?: string }>,
): Promise<void> {
  if (!failed || !failed.length) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (req as any)?.env as { SEND_MAIL?: { send: (msg: { from: string; to: string; subject: string; text?: string; html?: string; reply_to?: string }) => Promise<void> } } | undefined;
    const binding = env?.SEND_MAIL;
    const to = ownerAlertEmail();
    if (!binding || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;
    const lines = failed
      .map((f) => `  • ${f.order_number || '(unknown order)'}${f.reason ? ` — ${f.reason}` : ''}`)
      .join('\n');
    const subject = `ERP Sync failed for ${failed.length} order${failed.length === 1 ? '' : 's'}`;
    const text = [
      'Hi,',
      '',
      `${failed.length} order(s) failed to sync to the Embani ERP:`, '',
      lines, '',
      'Fix the cause and re-push exactly those orders from Admin → Orders → ERP Sync, or use the per-order Retry.',
      '',
      '— Luxedge',
    ].join('\n');
    await binding.send({ from: 'sales@luxedge.us', to, subject, text });
  } catch {
    // Never let an email failure surface — the ERP push result is authoritative.
  }
}

function derivePaymentStatus(status: string): string {
  const s = String(status || '').toLowerCase();
  // Unpaid / failed / cancelled must NEVER reach the ERP as revenue — they
  // map to receipt-only statuses so the ERP books nothing for them.
  if (s === 'awaiting_payment' || s === 'pending') return 'awaiting_payment';
  if (s === 'failed') return 'failed';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'paid' || s === 'processing' || s === 'shipped' || s === 'delivered') return 'paid';
  if (s === 'refunded') return 'refunded';
  return s || 'unknown';
}

export interface OrderRow {
  id?: string | null;
  order_number: string;
  customer_email?: string | null;
  customer_name?: string | null;
  shipping_address?: unknown;
  items?: unknown[];
  coupon_code?: string | null;
  subtotal?: number | string | null;
  discount?: number | string | null;
  shipping?: number | string | null;
  tax?: number | string | null;
  total?: number | string | null;
  currency?: string | null;
  status?: string | null;
  stripe_session_id?: string | null;
  stripe_payment_intent?: string | null;
  created_at?: string | null;
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Normalize one authoritative Luxedge order into the ERP contract. */
function normalizeOrder(row: OrderRow): Record<string, unknown> {
  // Gift Drop claims are identified by their campaign marker exactly as every
  // other part of the app identifies them — never by guessing from amounts.
  const isGift = row.coupon_code === 'PET-GIFT-DROP';
  const items = (Array.isArray(row.items) ? row.items : []).map((it) => {
    const r = (it || {}) as Record<string, unknown>;
    const quantity = Math.max(Number(r.quantity || 1), 0);
    const unitPrice = typeof r.unitPrice === 'number' ? r.unitPrice : Number(r.unitPrice || r.price || 0);
    return {
      product_id: r.id || null,
      sku: r.sku || r.variantSku || null,
      name: String(r.name || r.title || 'Item'),
      quantity,
      unit_price: unitPrice,
      line_total: Math.round(quantity * unitPrice * 100) / 100,
    };
  });
  // The storefront stores the address with `zip`; the ERP expects `postal_code`.
  const rawAddr = row.shipping_address && typeof row.shipping_address === 'object'
    ? (row.shipping_address as Record<string, unknown>)
    : null;
  const shipping_address = rawAddr
    ? { ...rawAddr, postal_code: rawAddr.postal_code ?? rawAddr.zip ?? null }
    : null;
  return {
    source: 'luxedge',
    order_id: row.id ?? null,
    order_number: row.order_number, // STABLE — preserved across retries for ERP reconciliation
    // Order type + provider-neutral payment identity: a Gift Drop claim is a
    // promotional $0 order (no payment, no provider), a normal order is a
    // paid sale carrying its payment provider as identity only.
    order_type: isGift ? 'free_gift' : 'paid',
    payment_required: isGift ? false : true,
    payment_provider: isGift ? 'none' : (row.stripe_payment_intent || row.stripe_session_id ? 'stripe' : undefined),
    stripe_session_id: row.stripe_session_id || null,
    stripe_payment_intent: row.stripe_payment_intent || null,
    created_at: row.created_at || null,
    currency: row.currency || 'USD',
    subtotal: num(row.subtotal),
    shipping: num(row.shipping),
    tax: num(row.tax),
    discount: num(row.discount),
    total: num(row.total),
    payment_status: isGift ? 'not_required' : derivePaymentStatus(row.status || ''),
    fulfillment_status: row.status || 'unknown',
    coupon_code: row.coupon_code || null,
    customer: {
      name: row.customer_name || null,
      email: row.customer_email || null,
    },
    shipping_address,
    items,
  };
}

interface ParsedErpResult {
  created: number | null;
  updated: number | null;
  failed: { order_number?: string; reason?: string }[];
}

/** Lenient parsing of the ERP webhook response. */
function parseErpResponse(body: string): ParsedErpResult {
  let data: unknown = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }
  const out: ParsedErpResult = { created: null, updated: null, failed: [] };
  if (!data || typeof data !== 'object') return out;

  const pick = (keys: string[]): number | null => {
    for (const k of keys) {
      const v = (data as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };
  out.created = pick(['created', 'created_count', 'createdOrderNumbers', 'created_order_numbers', 'inserted']);
  out.updated = pick(['updated', 'updated_count', 'updatedOrderNumbers', 'updated_order_numbers', 'reconciled']);

  for (const k of ['failed', 'errors', 'failures']) {
    const list = (data as Record<string, unknown>)[k];
    if (Array.isArray(list)) {
      for (const f of list) {
        if (!f || typeof f !== 'object') continue;
        const fr = f as Record<string, unknown>;
        out.failed.push({
          order_number: String(fr.order_number || fr.orderNumber || fr.reference || fr.id || ''),
          reason: String(fr.reason || fr.error || fr.message || 'ERP rejected order').slice(0, 200),
        });
      }
      break;
    }
  }
  return out;
}

/** Authoritative persisted rows — the demo order never exists in the DB, and
 *  Gift Drop claims ARE real rows: they sync as $0 free_gift orders, never as
 *  sales. The LX-1001 defensive exclusion stays in the push filter. */
async function fetchRealOrders(): Promise<{ ok: boolean; status: number; orders: OrderRow[]; error?: string }> {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const select = 'id,order_number,customer_email,customer_name,shipping_address,items,coupon_code,subtotal,discount,shipping,tax,total,currency,status,stripe_session_id,stripe_payment_intent,created_at';
  // Cloudflare D1 is authoritative once active: Admin → Orders → ERP Sync must
  // read the same ledger the webhook writes, or every paid order would show as
  // unsynced. (Supabase is 402-restricted, so the legacy path cannot answer.)
  if (commerceDbActive()) {
    const rows = await commerceFetch('luxedge_orders', `?order=created_at.asc&select=${encodeURIComponent(select)}`);
    if (!rows?.ok) return { ok: false, status: rows?.status || 503, orders: [], error: 'database request rejected' };
    return { ok: true, status: 200, orders: Array.isArray(rows.data) ? (rows.data as OrderRow[]) : [] };
  }
  if (!url || !key) return { ok: false, status: 503, orders: [], error: 'Database is not configured on this deployment.' };
  try {
    const res = await fetch(
      `${url}/rest/v1/luxedge_orders?order=created_at.asc&select=${encodeURIComponent(select)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) },
    );
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) return { ok: false, status: res.status, orders: [], error: 'database request rejected' };
    return { ok: true, status: res.status, orders: Array.isArray(data) ? (data as OrderRow[]) : [] };
  } catch {
    return { ok: false, status: 502, orders: [], error: 'Database is unreachable right now.' };
  }
}

/**
 * Auto-forward ONE order to the configured ERP webhook — the shared forward
 * used by the just-paid Stripe path AND the Gift Drop claim path. Same
 * normalization, payload contract, idempotency (stable order_number) and
 * per-row ERP_SYNC_STATUS state as the manual Push. Best-effort and NEVER
 * throws: when ERP is not configured the order is skipped silently; when the
 * ERP call fails the row is marked failed, where Admin → Orders lists it with
 * a Retry button (the push path now includes gift claims).
 */
export interface AutoForwardResult {
  attempted: boolean;
  ok: boolean;
  status: SyncStatus | 'skipped';
  reason?: string;
}

/** The actual ERP call + status write, shared by both forwarders. */
async function forwardOrderToErp(row: OrderRow, timeoutMs: number): Promise<AutoForwardResult> {
  const cfg = await effectiveConfig();
  if (!cfg.webhook) {
    return { attempted: false, ok: true, status: 'skipped', reason: 'ERP webhook not configured' };
  }
  const guard = await validateFetchTarget(cfg.webhook).catch(() => null);
  if (guard) {
    return { attempted: true, ok: false, status: 'failed', reason: `Webhook URL rejected: ${guard}` };
  }

  const orders = [normalizeOrder(row)];
  const r = await callErp(cfg.webhook, cfg.token, {
    app: 'luxedge',
    event: 'orders.sync',
    sent_at: new Date().toISOString(),
    orders,
  }, timeoutMs);

  const now = new Date().toISOString();
  if (r.ok) {
    const parsed = parseErpResponse(r.body);
    const failedEntry = parsed.failed.find((f) => f.order_number === row.order_number);
    if (failedEntry) {
      await writeErpSyncEntries({ [row.order_number]: { status: 'failed', synced_at: now, error: failedEntry.reason || 'ERP rejected order' } });
      return { attempted: true, ok: false, status: 'failed', reason: failedEntry.reason };
    }
    const status: SyncStatus =
      parsed.created !== null ? 'created'
      : parsed.updated !== null ? 'updated'
      : 'sent';
    await writeErpSyncEntries({ [row.order_number]: { status, synced_at: now } });
    return { attempted: true, ok: true, status };
  }

  let reason = 'ERP request failed';
  if (r.status === 401 || r.status === 403) reason = 'ERP rejected request — HTTP ' + r.status + ' (unauthorized). Check the API token.';
  else if (r.status === 0) reason = 'ERP request failed — ' + (r.error || 'unreachable');
  else if (r.status >= 400 && r.status < 600) reason = 'ERP returned HTTP ' + r.status;
  await writeErpSyncEntries({ [row.order_number]: { status: 'failed', synced_at: now, error: reason } });
  return { attempted: true, ok: false, status: 'failed', reason };
}

/**
 * Auto-forward ONE just-paid order — called by /api/webhook the moment a
 * Stripe payment is confirmed (fresh insert or awaiting_payment → paid
 * promotion). Bounded to 8s because it runs inside the Stripe webhook
 * response. Gift Drop claims never come through this path (they are never
 * "paid"); they use autoForwardGiftClaim instead.
 */
export async function autoForwardPaidOrder(row: OrderRow): Promise<AutoForwardResult> {
  try {
    // Defensive: the demo order never exists in the DB, and gift claims use
    // their own forwarder — a gift must never arrive as a "paid sale".
    if (row.coupon_code === 'PET-GIFT-DROP' || row.order_number === 'LX-1001') {
      return { attempted: false, ok: true, status: 'skipped', reason: 'not a paid Luxedge sale' };
    }
    return await forwardOrderToErp(row, 8_000);
  } catch {
    // Never let ERP forwarding break the payment webhook.
    return { attempted: true, ok: false, status: 'failed', reason: 'ERP auto-forward error' };
  }
}

/**
 * Auto-forward ONE confirmed Gift Drop claim — called by /api/gift-drop the
 * moment a claim is durably created. The claim is normalized as a $0
 * free_gift order (no payment, no provider, revenue $0) and forwarded to the
 * ERP. Bounded to 4s so ERP/DB trouble adds at most a couple of seconds to
 * the claim response; the claim itself is already stored and is NEVER revoked
 * by an ERP failure — the row is simply marked failed and Admin → Orders can
 * re-push it. Test claims are never forwarded.
 */
export async function autoForwardGiftClaim(row: OrderRow, opts?: { timeoutMs?: number }): Promise<AutoForwardResult> {
  try {
    // Demo order (never in the DB) and test-mode claims stay local.
    if (row.order_number === 'LX-1001') {
      return { attempted: false, ok: true, status: 'skipped', reason: 'demo order — not forwarded' };
    }
    const addr = row.shipping_address && typeof row.shipping_address === 'object'
      ? (row.shipping_address as Record<string, unknown>)
      : null;
    const isTest = !!(addr && typeof addr._gift === 'object' && (addr._gift as Record<string, unknown>).isTest === true);
    if (isTest) {
      return { attempted: false, ok: true, status: 'skipped', reason: 'test claim — not forwarded to ERP' };
    }
    return await forwardOrderToErp(row, opts?.timeoutMs ?? 4_000);
  } catch {
    // Never let ERP forwarding affect the claim outcome.
    return { attempted: true, ok: false, status: 'failed', reason: 'ERP auto-forward error' };
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'GET') {
    const [cfg, sync, syncLog] = await Promise.all([effectiveConfig(), readErpSync(), readErpSyncLog()]);
    sendJson(res, 200, {
      webhook: statusOf(!!cfg.webhook, maskWebhook(cfg.webhook), cfg.webhookSource),
      token: statusOf(!!cfg.token, maskToken(cfg.token), cfg.tokenSource),
      sync,
      syncLog,
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const action = String(body.action || '');

  // ── SET — store webhook/token server-side (app_settings). Env wins at read time. ──
  if (action === 'set') {
    const field = String(body.field || '');
    const value = String(body.value || '').trim();
    if (field !== 'webhook' && field !== 'token') {
      sendJson(res, 400, { error: 'field must be webhook or token' });
      return;
    }
    if (field === 'webhook') {
      if (!/^https?:\/\//.test(value)) {
        sendJson(res, 400, { error: 'Webhook URL must start with http:// or https://' });
        return;
      }
      const guard = await validateFetchTarget(value).catch(() => null);
      if (guard) {
        sendJson(res, 400, { error: `Webhook URL rejected: ${guard}` });
        return;
      }
      if (envWebhook()) {
        sendJson(res, 400, { error: 'The webhook URL is configured in the server environment — edit it there, not in the UI.' });
        return;
      }
    } else if (value.length < 8) {
      sendJson(res, 400, { error: 'Token too short — paste the full token.' });
      return;
    }
    const ok = await upsertAppSetting(field === 'webhook' ? ERP_WEBHOOK_KEY : ERP_TOKEN_KEY, value);
    if (!ok) {
      sendJson(res, 502, { error: 'Could not save to the server (app_settings unavailable).' });
      return;
    }
    sendJson(res, 200, { ok: true, masked: field === 'webhook' ? maskWebhook(value) : maskToken(value) });
    return;
  }

  // ── CLEAR — remove the attached value (env values cannot be cleared via UI). ──
  if (action === 'clear') {
    const field = String(body.field || '');
    if (field !== 'webhook' && field !== 'token') {
      sendJson(res, 400, { error: 'field must be webhook or token' });
      return;
    }
    const key = field === 'webhook' ? ERP_WEBHOOK_KEY : ERP_TOKEN_KEY;
    if (field === 'webhook' && envWebhook()) {
      sendJson(res, 400, { error: 'The webhook URL is configured in the server environment — edit it there, not in the UI.' });
      return;
    }
    await deleteAppSetting(key);
    // Re-read effective config so the response reflects env fallbacks.
    const cfg = await effectiveConfig();
    sendJson(res, 200, {
      ok: true,
      configured: cfg.webhook || cfg.token ? true : false,
      masked: field === 'webhook' ? maskWebhook(cfg.webhook) : maskToken(cfg.token),
      source: field === 'webhook' ? cfg.webhookSource : cfg.tokenSource,
    });
    return;
  }

  // ── TEST — harmless ERP probe. Never creates orders or revenue records. ──
  if (action === 'test') {
    const cfg = await effectiveConfig();
    if (!cfg.webhook) {
      sendJson(res, 400, { error: 'ERP webhook URL is not configured yet — set it first.' });
      return;
    }
    const guard = await validateFetchTarget(cfg.webhook).catch(() => null);
    if (guard) {
      sendJson(res, 400, { error: `Webhook URL rejected: ${guard}` });
      return;
    }
    const started = Date.now();
    const r = await callErp(cfg.webhook, cfg.token, {
      app: 'luxedge',
      event: 'test',
      test: true,
      sent_at: new Date().toISOString(),
      message: 'Luxedge ERP connection test — no order data, nothing to record.',
    });
    const latencyMs = Date.now() - started;
    if (r.ok) {
      sendJson(res, 200, { ok: true, status: r.status, latencyMs, message: 'ERP connection successful' });
      return;
    }
    if (r.status === 401 || r.status === 403) {
      sendJson(res, 200, { ok: false, status: r.status, latencyMs, message: `ERP connection failed — HTTP ${r.status} (unauthorized). Check the API token.` });
      return;
    }
    if (r.status === 0) {
      sendJson(res, 200, { ok: false, status: 0, latencyMs, message: `ERP connection failed — ${r.error}` });
      return;
    }
    const detail = r.body.slice(0, 160).replace(/\s+/g, ' ').trim();
    sendJson(res, 200, { ok: false, status: r.status, latencyMs, message: `ERP connection failed — HTTP ${r.status}${detail ? `: ${detail}` : ''}` });
    return;
  }

  // ── PUSH — sync real orders to ERP, record the ledger, report per-order failures.
  //    Optional orderNumbers restricts the push to a subset (per-order Retry).
  //    The same stable order_number is always sent, so retries reconcile.
  if (action === 'push') {
    const cfg = await effectiveConfig();
    if (!cfg.webhook) {
      sendJson(res, 400, { error: 'ERP webhook URL is not configured yet — set it first.' });
      return;
    }
    const guard = await validateFetchTarget(cfg.webhook).catch(() => null);
    if (guard) {
      sendJson(res, 400, { error: `Webhook URL rejected: ${guard}` });
      return;
    }
    // Optional subset for retries — e.g. { orderNumbers: ['LX-ABCD1234'] }.
    let requested: Set<string> | null = null;
    if (body.orderNumbers !== undefined && body.orderNumbers !== null) {
      const list = body.orderNumbers;
      if (!Array.isArray(list) || !list.every((n) => typeof n === 'string' && n.trim().length > 0)) {
        sendJson(res, 400, { error: 'orderNumbers must be an array of order numbers.' });
        return;
      }
      requested = new Set(list.map((n) => String(n).trim()));
    }
    const db = await fetchRealOrders();
    if (!db.ok) {
      sendJson(res, db.status, { error: db.error });
      return;
    }
    // Defensive filter — only the demo LX-1001 order (which never exists in
    // the DB) is excluded here; Gift Drop claims ARE pushed, normalized as $0
    // free_gift orders. Requested numbers that don't match a real order are
    // dropped (never fabricated).
    const realOrders = db.orders.filter((o) => o.order_number !== 'LX-1001' && (!requested || requested.has(o.order_number)));
    if (realOrders.length === 0) {
      sendJson(res, 200, { ok: true, sent: 0, created: 0, updated: 0, failed: [], message: requested ? 'ERP Retry — no matching real order to push for the requested order numbers.' : 'ERP Sync complete — no orders to push yet.' });
      return;
    }

    const orders = realOrders.map(normalizeOrder);
    const started = Date.now();
    const r = await callErp(cfg.webhook, cfg.token, {
      app: 'luxedge',
      event: 'orders.sync',
      sent_at: new Date().toISOString(),
      orders,
    });
    const latencyMs = Date.now() - started;

    const failedByNumber: Record<string, string> = {};
    const syncEntries: Record<string, SyncEntry> = {};
    if (r.ok) {
      const parsed = parseErpResponse(r.body);
      for (const f of parsed.failed) {
        if (f.order_number) failedByNumber[f.order_number] = f.reason || 'ERP rejected order';
      }
      const now = new Date().toISOString();
      for (const o of realOrders) {
        syncEntries[o.order_number] = failedByNumber[o.order_number]
          ? { status: 'failed', synced_at: now, error: failedByNumber[o.order_number] }
          : (() => {
              const status: SyncStatus =
                parsed.created !== null && parsed.updated !== null ? (parsed.created > 0 ? 'created' : 'updated')
                : parsed.created !== null ? 'created'
                : parsed.updated !== null ? 'updated'
                : 'sent';
              return { status, synced_at: now };
            })();
      }
      await writeErpSyncEntries(syncEntries);

      const created = parsed.created;
      const updated = parsed.updated;
      const failed = realOrders
        .filter((o) => failedByNumber[o.order_number])
        .map((o) => ({ order_number: o.order_number, reason: failedByNumber[o.order_number] }));
      // Alert the owner whenever this batch ended with failures.
      await sendErpFailureAlert(req, failed);
      const parts = [`ERP Sync complete`, `Sent: ${realOrders.length}`];
      if (created !== null) parts.push(`Created: ${created}`);
      if (updated !== null) parts.push(`Updated: ${updated}`);
      parts.push(`Failed: ${failed.length}`);
      sendJson(res, 200, {
        ok: true,
        sent: realOrders.length,
        created,
        updated,
        failed,
        latencyMs,
        message: `${parts.join(' · ')}${created === null && updated === null ? ' (ERP response did not report created/updated counts)' : ''}`,
      });
      return;
    }

    // Whole batch failed — mark every order failed (sanitized reason only).
    const now = new Date().toISOString();
    let reason = `ERP request failed`;
    if (r.status === 401 || r.status === 403) reason = `ERP rejected request — HTTP ${r.status} (unauthorized). Check the API token.`;
    else if (r.status === 0) reason = `ERP request failed — ${r.error}`;
    else if (r.status >= 400 && r.status < 600) reason = `ERP returned HTTP ${r.status}`;
    const failedEntries: Record<string, SyncEntry> = {};
    for (const o of realOrders) {
      failedEntries[o.order_number] = { status: 'failed', synced_at: now, error: reason };
    }
    await writeErpSyncEntries(failedEntries);
    const failedOrders = realOrders.map((o) => ({ order_number: o.order_number, reason }));
    // Alert the owner — the whole batch failed.
    await sendErpFailureAlert(req, failedOrders);
    sendJson(res, 200, {
      ok: false,
      sent: realOrders.length,
      created: 0,
      updated: 0,
      failed: failedOrders,
      latencyMs,
      message: `ERP Sync failed — ${reason}. No orders were confirmed.`,
    });
    return;
  }

  // ── CLEAR-FAILED — remove failed sync state (errors that were fixed outside
  //    the ERP push, e.g. an order cancelled in Luxedge). Synced orders are
  //    never touched. ──
  if (action === 'clear-failed') {
    const cleared = await clearErpFailed();
    if (cleared === 0) {
      sendJson(res, 200, { ok: true, cleared: 0, message: 'No failed ERP syncs to clear.' });
      return;
    }
    sendJson(res, 200, { ok: true, cleared, message: `Cleared ${cleared} failed ERP sync${cleared === 1 ? '' : 's'}.` });
    return;
  }

  sendJson(res, 400, { error: 'Unknown action — use set, clear, test, push or clear-failed.' });
}