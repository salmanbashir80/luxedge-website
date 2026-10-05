// ============================================================================
// LUXEDGE — CAMPAIGN REGISTRY STORE (Cloudflare D1, server-only)
//
// WHY: the legacy registry lived in Supabase `app_settings`, whose PostgREST is
// hard-restricted (HTTP 402 exceed_egress_quota). Only the Campaign Manager's
// own two documents move here:
//   luxedge_campaigns_v1          (campaign configs)
//   luxedge_campaign_products_v1  (per-product campaign flags)
// The Free Gift / Pet Gift Drop doc (`gift_drop_campaign_v1`), claim rows,
// checkout, pricing, shipping, inventory and email are NOT touched.
//
// FAIL-CLOSED CONTRACT: migration 0008 seeds both rows explicitly, so
//   * row present            -> real value (possibly a genuinely empty registry)
//   * row missing            -> NOT initialized -> error (never "empty")
//   * query throws           -> error (never "empty")
// The table is private: absent from the public /api/db and admin /api/admin/db
// allowlists. Errors never echo SQL or stored values.
// ============================================================================
import type { D1DatabaseLike } from '../../worker/d1/runtime';

export const CAMPAIGN_DOC_TABLE = 'campaign_registry_docs';

export type CampaignDocRead =
  | { ok: true; value: string }
  | { ok: false; error: string };

export async function readCampaignDoc(db: D1DatabaseLike, key: string): Promise<CampaignDocRead> {
  try {
    const rows = await db
      .prepare(`SELECT value FROM ${CAMPAIGN_DOC_TABLE} WHERE key = ? LIMIT 1`)
      .bind(key)
      .all<{ value: string }>();
    const value = rows.results?.[0]?.value;
    if (typeof value !== 'string') {
      return { ok: false, error: 'Campaign storage is not initialized (D1). No campaign changes were made.' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: 'Campaign storage unavailable (D1 read failed). No campaign changes were made.' };
  }
}

/** Upsert + independent readback. Returns true only when the stored value matches. */
export async function writeCampaignDoc(db: D1DatabaseLike, key: string, value: string, updatedBy = 'campaign-manager'): Promise<boolean> {
  try {
    const statement = db
      .prepare(
        `INSERT INTO ${CAMPAIGN_DOC_TABLE} (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ` +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      )
      .bind(key, value, new Date().toISOString(), updatedBy);
    if (!statement.run) return false;
    await statement.run();
    const back = await readCampaignDoc(db, key);
    return back.ok && back.value === value;
  } catch {
    return false;
  }
}
