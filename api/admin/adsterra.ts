// GET/POST /api/admin/adsterra
// Admin-only endpoint to verify and manage the Adsterra monetization network integration.
// Server-side only — API token is stored securely in environment or private settings.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, rateLimited, clientIp } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { upsertAppSetting, deleteAppSetting, supabaseAdmin, supabaseHeaders } from '../_lib/supabase.js';

const SETTING_KEY = 'ADSTERRA_API_TOKEN';
const DEFAULT_PUBLISHER_ID = '25409389';

function mask(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

async function readDbSetting(): Promise<string | null> {
  const cfg = supabaseAdmin();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/app_settings?key=eq.${encodeURIComponent(SETTING_KEY)}&select=value`, {
      headers: supabaseHeaders(cfg.serviceRole),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ value?: string }>;
    return rows[0]?.value?.trim() || null;
  } catch {
    return null;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  const envToken = (process.env.ADSTERRA_API_TOKEN || '').trim();
  const publisherId = (process.env.ADSTERRA_PUBLISHER_ID || DEFAULT_PUBLISHER_ID).trim();

  if (req.method === 'GET') {
    const dbVal = await readDbSetting();
    const activeToken = envToken || dbVal || '';
    sendJson(res, 200, {
      configured: !!activeToken,
      publisherId,
      source: envToken ? 'env' : dbVal ? 'attached' : 'none',
      masked: activeToken ? mask(activeToken) : '',
      active: true,
      units: [
        { id: 'social-bar', name: 'Social Bar / High-CPM Script Tag', active: true },
        { id: 'native-banner', name: 'Native Banner Unit (container-11967f6c35e05352ed496c96f6d8ddf4)', active: true },
      ],
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

  if (action === 'test') {
    const candidate = String(body.token || '').trim();
    const tokenToTest = candidate || envToken || (await readDbSetting()) || '';
    if (!tokenToTest) {
      sendJson(res, 400, { error: 'No Adsterra API Token provided or configured to test.' });
      return;
    }

    try {
      const today = new Date().toISOString().slice(0, 10);
      const testUrl = `https://api3.adsterratools.com/publisher/stats.json?start_date=${today}&finish_date=${today}`;
      const probe = await fetch(testUrl, {
        headers: { 'X-API-Key': tokenToTest },
        signal: AbortSignal.timeout(10_000),
      });

      if (probe.status === 200) {
        sendJson(res, 200, {
          ok: true,
          status: 200,
          message: 'Adsterra API Token verified and active (HTTP 200)',
          publisherId,
        });
        return;
      }

      if (probe.status === 403) {
        sendJson(res, 400, {
          ok: false,
          status: 403,
          error: 'Invalid Adsterra API Token provided. Please verify in Adsterra Publisher Dashboard.',
        });
        return;
      }

      const errText = await probe.text();
      sendJson(res, 400, {
        ok: false,
        status: probe.status,
        error: `Adsterra API answered with HTTP ${probe.status}: ${errText.slice(0, 120)}`,
      });
      return;
    } catch (e) {
      sendJson(res, 502, {
        ok: false,
        error: `Adsterra API connection error: ${(e as Error).message}`,
      });
      return;
    }
  }

  if (action === 'set') {
    const key = String(body.token || '').trim();
    if (key.length < 8 || key.length > 256) {
      sendJson(res, 400, { error: 'Adsterra token must contain between 8 and 256 characters.' });
      return;
    }
    const ok = await upsertAppSetting(SETTING_KEY, key);
    if (!ok) {
      sendJson(res, 502, { error: 'Could not save the Adsterra token to server storage.' });
      return;
    }
    sendJson(res, 200, { ok: true, masked: mask(key) });
    return;
  }

  if (action === 'clear') {
    await deleteAppSetting(SETTING_KEY);
    sendJson(res, 200, { ok: true, cleared: true });
    return;
  }

  sendJson(res, 400, { error: `Unknown action: ${action}` });
}
