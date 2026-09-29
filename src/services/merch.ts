// ============================================================================
// LUXEDGE — MERCHANDISING STATS LOADER (client)
//
// Fetches the compact per-product stats feed from the worker endpoint
// /api/merch-stats (aggregated server-side from real site_events +
// luxedge_orders) and caches it for the session. The ranking engine
// (features/catalog/merchandising.ts) consumes the Map.
//
// Failure contract: the storefront must NEVER break or block when stats are
// unavailable (endpoint 404 in dev, worker outage, unconfigured DB). Returns
// an EMPTY Map → grids fall back to flag/availability/visual ordering.
// ============================================================================
import { MerchStats, emptyMerchStats } from '../features/catalog/merchandising';
import { isRemoteDb } from './db';

const CACHE_KEY = 'luxedge:merch-stats:v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface StatsCache {
  ts: number;
  map: Record<string, MerchStats>;
}

function readCache(): Record<string, MerchStats> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StatsCache;
    if (!parsed.ts || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.map ?? null;
  } catch {
    return null;
  }
}

function writeCache(map: Record<string, MerchStats>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), map }));
  } catch {
    /* storage unavailable — request already succeeded */
  }
}

/** Build a stats Map from the endpoint payload rows. */
export function statsFromPayload(rows: { id: string }[]): Map<string, MerchStats> {
  const map = new Map<string, MerchStats>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    const s = emptyMerchStats();
    const r = row as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      const v = r[key];
      if (typeof v === 'number' && Number.isFinite(v)) (s as unknown as Record<string, number>)[key] = v;
    }
    map.set(row.id, s);
  }
  return map;
}

/** Fetch merchandising stats once per session (with TTL). Never throws. */
export async function loadMerchStats(): Promise<Map<string, MerchStats>> {
  try {
    if (!isRemoteDb()) return new Map();
    const cached = readCache();
    if (cached) return statsFromPayload(Object.entries(cached).map(([id, s]) => ({ id, ...s })));
    const res = await fetch('/api/merch-stats', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as { ok?: boolean; products?: { id: string }[] };
    if (data?.ok !== true || !Array.isArray(data.products)) return new Map();
    const map = statsFromPayload(data.products);
    const record: Record<string, MerchStats> = {};
    map.forEach((s, id) => { record[id] = s; });
    writeCache(record);
    return map;
  } catch {
    return new Map();
  }
}
