import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSearchObservations, researchProductKeywords } from '../productResearch';
vi.mock('../../../services/supabase', () => ({ getFreshAccessToken: async () => null }));
afterEach(() => vi.unstubAllGlobals());

describe('real search observation parsing', () => {
  it('only accepts actual result anchors with decoded URLs', () => {
    const raw = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcat">Cat Window Hammocks</a><a href="https://unrelated.com">Other navigation</a>';
    expect(parseSearchObservations(raw)).toEqual([{ title: 'Cat Window Hammocks', url: 'https://example.com/cat' }]);
  });
  it('accepts reader markdown and removes duplicates', () => {
    expect(parseSearchObservations('[Cat Hammocks](https://example.com/cat)\n[Cat Hammocks](https://example.com/cat)')).toHaveLength(1);
  });
  it('never treats a CAPTCHA or a search navigation link as research', () => {
    expect(parseSearchObservations('Verify you are human [Shop](https://example.com/shop)')).toEqual([]);
    expect(parseSearchObservations('[Search](https://duckduckgo.com/html)')).toEqual([]);
  });
  it('rejects embedded credentials and unsafe links', () => {
    expect(parseSearchObservations('[Bad link](https://secret@example.com/cat)')).toEqual([]);
  });
});

describe('research availability and cookie-session compatibility', () => {
  it('works without a legacy JWT and reports missing Google services honestly', async () => {
    const requests: { url: string; method?: string; headers?: HeadersInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method, headers: init.headers });
      if (url.startsWith('/api/fetch-page')) return new Response('<a class="result__a" href="https://example.com/cat">Cat window hammocks</a>');
      return new Response(JSON.stringify({ status: 'not_configured', results: [] }), { headers: { 'Content-Type': 'application/json' } });
    }));
    const result = await researchProductKeywords('Cat Window Hammock');
    expect(result.search.status).toBe('observed');
    expect(result.googleAds.status).toBe('unavailable');
    expect(result.googleTrends.status).toBe('unavailable');
    expect(requests.every(r => !JSON.stringify(r.headers).includes('Bearer null'))).toBe(true);
    expect(requests.find(r => r.url.includes('/trends/jobs'))?.method).toBeUndefined();
  });
  it('does not present failed requests as real keyword evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const result = await researchProductKeywords('Cat Tunnel');
    expect(result.search.results).toEqual([]);
    expect(result.googleAds.results).toEqual([]);
    expect(result.googleTrends.status).toBe('unavailable');
  });
  it('rejects stale or insufficient trend jobs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/trends/jobs') ? { jobs: [
      { keyword: 'Cat Tunnel', status: 'completed', finishedAt: new Date(Date.now() - 8 * 86400_000).toISOString(), output: { trend: { status: 'AVAILABLE', direction: 'RISING' } } },
      { keyword: 'Cat Tunnel', status: 'completed', finishedAt: new Date().toISOString(), output: { trend: { status: 'AVAILABLE', direction: 'INSUFFICIENT_DATA' } } },
    ] } : { status: 'not_configured' }))));
    expect((await researchProductKeywords('Cat Tunnel')).googleTrends.status).toBe('unavailable');
  });
});
