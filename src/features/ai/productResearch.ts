import { getFreshAccessToken } from '../../services/supabase';
import { decodeRedirectUrl } from '../scout/discover';

export interface SearchObservation { title: string; url: string }
export interface KeywordResearch {
  query: string;
  observedAt: string;
  search: { status: 'observed' | 'unavailable'; source: string; results: SearchObservation[] };
  googleAds: { status: string; results: unknown[] };
  googleTrends: { status: 'observed' | 'unavailable'; observedAt?: string; evidence?: unknown };
}

function plain(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseSearchObservations(raw: string): SearchObservation[] {
  if (/anomaly\.js|bots use DuckDuckGo|verify you are human|unusual traffic/i.test(raw)) return [];
  const out: SearchObservation[] = [];
  const add = (href: string, title: string) => {
    try {
      const absolute = new URL(href.replace(/&amp;/g, '&'), 'https://duckduckgo.com').href;
      const url = decodeRedirectUrl(absolute);
      if (!url) return;
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || /(^|\.)(duckduckgo|google|bing)\./i.test(u.hostname)) return;
      const name = plain(title).slice(0, 180);
      if (name.length < 5 || out.some((r) => r.url === u.href)) return;
      out.push({ title: name, url: u.href });
    } catch { /* malformed search result is not evidence */ }
  };
  for (const m of raw.matchAll(/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].match(/href=["']([^"']+)["']/i)?.[1];
    if (href) add(href, m[2]);
  }
  if (!out.length) {
    for (const m of raw.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g)) add(m[2], m[1]);
  }
  return out.slice(0, 6);
}

// Read-only research: no new credentials, no Hermes jobs, no campaigns or ads created.
export async function researchProductKeywords(query: string): Promise<KeywordResearch> {
  const token = await getFreshAccessToken();
  // The current admin session may be an HttpOnly D1 cookie, not a legacy JWT.
  // Same-origin fetch carries that cookie; every endpoint still enforces admin auth.
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const observedAt = new Date().toISOString();
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' pet supplies USA')}`;
  const [search, googleAds, googleTrends] = await Promise.all([
    (async (): Promise<KeywordResearch['search']> => {
      try {
        const r = await fetch(`/api/fetch-page?url=${encodeURIComponent(searchUrl)}`, { headers, signal: AbortSignal.timeout(25_000) });
        if (!r.ok) return { status: 'unavailable', source: 'DuckDuckGo', results: [] };
        const results = parseSearchObservations(await r.text());
        return { status: results.length ? 'observed' : 'unavailable', source: 'DuckDuckGo', results };
      } catch { return { status: 'unavailable', source: 'DuckDuckGo', results: [] }; }
    })(),
    (async (): Promise<KeywordResearch['googleAds']> => {
      try {
        const r = await fetch('/api/market-demand/google-ads?action=historical-metrics', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: [query], market: 'US', language: 'en' }), signal: AbortSignal.timeout(25_000),
        });
        if (!r.ok) return { status: 'unavailable', results: [] };
        const d = await r.json();
        return { status: d.status === 'success' ? 'observed' : 'unavailable', results: d.status === 'success' && Array.isArray(d.results) ? d.results : [] };
      } catch { return { status: 'unavailable', results: [] }; }
    })(),
    (async (): Promise<KeywordResearch['googleTrends']> => {
      try {
        const r = await fetch('/api/market-intel/trends/jobs', { headers, signal: AbortSignal.timeout(12_000) });
        if (!r.ok) return { status: 'unavailable' };
        const d = await r.json();
        const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
        const j = Array.isArray(d.jobs) ? d.jobs.find((j: Record<string, any>) => j.status === 'completed'
          && normalize(String(j.keyword || '')) === normalize(query)
          && Date.now() - Date.parse(j.finishedAt) >= 0 && Date.now() - Date.parse(j.finishedAt) < 7 * 86400_000
          && j.output?.trend?.status === 'AVAILABLE' && j.output?.trend?.direction !== 'INSUFFICIENT_DATA') : null;
        return j ? { status: 'observed', observedAt: j.finishedAt, evidence: j.output.trend } : { status: 'unavailable' };
      } catch { return { status: 'unavailable' }; }
    })(),
  ]);
  return { query, observedAt, search, googleAds, googleTrends };
}
