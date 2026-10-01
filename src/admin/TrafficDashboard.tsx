// ============================================================================
// TRAFFIC OVERVIEW — first-party analytics dashboard (Admin)
//
// Reads `site_events` through the Worker's /api/admin/traffic route (D1,
// migration 0006) as a signed-in admin and shows real visitor traffic with
// charts: page views, visitors, sessions, funnel, daily trend, wishlist saves,
// top pages, traffic sources, devices, top products. This is independent of
// Google — data is what this site itself records.
//
// Supabase fallback: deployments that still run Supabase Auth (pre-D1
// rollback) read the legacy direct-PostgREST path when the route is missing.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { fetchTrafficEvents, type SiteEventRow } from '../services/traffic';
import { fetchSiteEvents } from '../services/siteEvents';

const DAY_OPTIONS = [7, 14, 30, 90];
const COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899', '#10b981', '#f43f5e'];
interface Metric {
  label: string;
  value: string | number;
  hint?: string;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TrafficDashboard() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<SiteEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async (): Promise<string> => {
      // D1 route first; only a genuinely missing route falls back to the
      // legacy direct-Supabase read (rollback deployments).
      const t = await fetchTrafficEvents(days);
      if (cancelled) return 'cancelled';
      if (t.source === 'd1') {
        setRows(t.rows);
        setError(t.error || null);
        return t.error || 'loaded';
      }
      if (t.error !== 'route-missing') {
        setRows([]);
        setError(t.error || 'Could not load analytics.');
        return 'error';
      }
      try {
        const legacy = await fetchSiteEvents(days);
        if (cancelled) return 'loaded';
        setRows(legacy);
        setError(null);
        return 'loaded';
      } catch (e) {
        if (cancelled) return 'error';
        setRows([]);
        setError((e as Error).message || 'Could not load analytics.');
        return 'error';
      }
    };
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const stats = useMemo(() => {
    const views = rows.filter((r) => r.event === 'page_view');
    const addToCart = rows.filter((r) => r.event === 'add_to_cart');
    const checkout = rows.filter((r) => r.event === 'begin_checkout');
    const purchases = rows.filter((r) => r.event === 'purchase');
    const searches = rows.filter((r) => r.event === 'search');
    const saves = rows.filter((r) => r.event === 'add_to_wishlist');
    const productClicks = rows.filter((r) => r.event === 'view_item' || r.event === 'select_item');
    const blogViews = views.filter((v) => v.path.startsWith('/blog'));

    // Real sales revenue from purchase events (migration 0024).
    const anyRevenue = purchases.some((p) => typeof p.value === 'number' && Number.isFinite(p.value));
    const salesRevenue = purchases.reduce((s, p) => s + (typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : 0), 0);
    const revenueCurrency = purchases.find((p) => p.currency)?.currency || 'USD';

    const visitors = new Set(views.map((v) => v.visitor_id ?? '')).size;
    const sessions = new Set(views.map((v) => v.session_id ?? '')).size;

    // Daily trend (page_view + unique sessions + wishlist saves per day) for the
    // whole selected window; the chart always shows every day (0-filled).
    const byDay = new Map<string, { day: string; views: number; sessions: number; saved: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      byDay.set(`${d.getMonth() + 1}/${d.getDate()}`, { day: dayKey(d.toISOString()), views: 0, sessions: 0, saved: 0 });
    }
    const sessionsOfDay = new Map<string, Set<string>>();
    for (const v of views) {
      const k = dayKey(v.occurred_at);
      const row = byDay.get(k);
      if (!row) continue;
      row.views += 1;
      let s = sessionsOfDay.get(k);
      if (!s) { s = new Set(); sessionsOfDay.set(k, s); }
      s.add(v.session_id ?? '');
    }
    for (const [k, s] of sessionsOfDay) {
      const row = byDay.get(k);
      if (row) row.sessions = s.size;
    }
    // Wishlist saves per day (add_to_wishlist only — removes are excluded).
    for (const s of saves) {
      const row = byDay.get(dayKey(s.occurred_at));
      if (row) row.saved += 1;
    }
    const trend = Array.from(byDay.values());

    // Top pages by page_view.
    const pageCount = new Map<string, number>();
    for (const v of views) {
      const p = v.path || '/';
      pageCount.set(p, (pageCount.get(p) || 0) + 1);
    }
    const topPages = Array.from(pageCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path: path.split('?')[0], count }));

    // Traffic sources.
    const sources = new Map<string, number>();
    for (const v of views) {
      const ref = v.referrer || '';
      let label = 'Direct';
      if (ref) {
        try { label = new URL(ref).hostname.replace(/^www\./, ''); }
        catch { label = ref; }
      }
      if (v.utm_source) label = `${v.utm_source} (campaign)`;
      sources.set(label, (sources.get(label) || 0) + 1);
    }
    const sourceData = Array.from(sources.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    // Device split.
    const devices = new Map<string, number>();
    for (const v of views) devices.set(v.device || 'unknown', (devices.get(v.device || 'unknown') || 0) + 1);
    const deviceData = Array.from(devices.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));

    // Top products referenced by commerce events.
    const prodCount = new Map<string, number>();
    for (const r of rows) {
      if (!['view_item', 'add_to_cart', 'purchase', 'begin_checkout'].includes(r.event)) continue;
      if (Array.isArray(r.item_ids)) (r.item_ids as string[]).forEach((id) => prodCount.set(id, (prodCount.get(id) || 0) + 1));
    }
    const topProducts = Array.from(prodCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

    return {
      metrics: [
        { label: 'Page Views', value: fmt(views.length) },
        { label: 'Visitors', value: fmt(visitors) },
        { label: 'Sessions', value: fmt(sessions) },
        { label: 'Pages / Session', value: sessions ? (views.length / sessions).toFixed(1) : '—' },
        { label: 'Add to Carts', value: fmt(addToCart.length) },
        { label: 'Checkouts', value: fmt(checkout.length) },
        { label: 'Purchases', value: fmt(purchases.length) },
        { label: 'Searches', value: fmt(searches.length), hint: 'buyer-intent signals' },
      ] as Metric[],
      trend,
      topPages,
      sourceData,
      deviceData,
      topProducts,
      purchaseCount: purchases.length,
      saves: saves.length,
      savedVisitors: new Set(saves.map((s) => s.visitor_id ?? '')).size,
      productClicks: productClicks.length,
      blogViews: blogViews.length,
      blogShare: views.length ? Math.round((blogViews.length / views.length) * 100) : 0,
      anyRevenue,
      salesRevenue,
      revenueCurrency,
    };
  }, [rows, days]);

  const metrics = stats.metrics.slice(0, 4);
  const commerce = stats.metrics.slice(4);
  if (loading && rows.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
        Loading traffic analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm">
        <p className="font-semibold mb-1">Traffic data unavailable</p>
        <p className="leading-relaxed">{error}</p>
        <p className="mt-2 text-xs text-amber-700">
          This dashboard needs the <code className="bg-amber-100 px-1 rounded">site_events</code> table and a signed-in admin. Once recording starts,
          views, sessions, funnel and charts appear here automatically — no deploy required.
        </p>
      </div>
    );
  }

  const hasData = rows.length > 0;
  const empty = !hasData;

  return (
    <div className="space-y-4">
      {/* Day range selector */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-500">
          First-party analytics from your own events (independent of Google).
          {rows.length > 0 && <span className="ml-1 font-semibold text-gray-700">{fmt(rows.length)} events · last {days} days</span>}
        </p>
        <div className="flex items-center gap-1">
          {DAY_OPTIONS.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${days === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {empty ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          No traffic recorded yet. Visit the storefront (or share your site link) and views will appear here within seconds.
        </div>
      ) : (
        <>
          {/* Sales revenue is backed by recorded purchases. AdSense reporting
              remains in the AdSense console; this dashboard never estimates it. */}
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-emerald-800 mb-3">💰 Sales &amp; Traffic — last {days} days</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Sales Revenue</p>
                <p className="text-2xl font-bold text-gray-900">{stats.anyRevenue ? money(stats.salesRevenue, stats.revenueCurrency) : '—'}</p>
                {stats.anyRevenue ? (
                  <p className="text-[10px] text-emerald-600 mt-0.5">Real {fmt(stats.purchaseCount)} purchases</p>
                ) : (
                  <p className="text-[10px] text-amber-600 mt-0.5">No purchase value yet (needs migration 0024)</p>
                )}
              </div>
              <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Blog Traffic</p>
                <p className="text-2xl font-bold text-gray-900">{fmt(stats.blogViews)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{stats.blogShare}% of all views · content engine</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Product Clicks</p>
                <p className="text-2xl font-bold text-gray-900">{fmt(stats.productClicks)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">view_item + select_item</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-gray-400">
              Sales revenue is real when purchase events contain a recorded value. For real AdSense earnings, impressions, clicks, and RPM, use the Google AdSense console.
            </p>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{m.label}</p>
                <p className="text-2xl font-bold text-gray-900">{m.value}</p>
                {m.hint && <p className="text-[10px] text-gray-400 mt-0.5">{m.hint}</p>}
              </div>
            ))}
          </div>

          {/* Commerce funnel */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {commerce.map((m) => (
              <div key={m.label} className="rounded-xl border border-gray-100 bg-blue-50/60 p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{m.label}</p>
                <p className="text-xl font-bold text-gray-900">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Daily trend */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-600 mb-2">Views &amp; Sessions — last {days} days</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="views" name="Page views" stroke="#2563eb" fill="#2563eb" fillOpacity={0.12} strokeWidth={2} />
                  <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.08} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Wishlist saves trend — real add_to_wishlist events from the
              storefront hearts (site_events). Removes are excluded. */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="text-xs font-semibold text-gray-600">Wishlist Saves — last {days} days</p>
                <p className="text-[10px] text-gray-400 mt-0.5">add_to_wishlist events per day · remove events excluded</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-rose-600 leading-none">{fmt(stats.saves)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{fmt(stats.savedVisitors)} unique visitors</p>
              </div>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="saved" name="Wishlist saves" fill="#e11d48" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Top pages */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-600 mb-3">Top Pages</p>
              {stats.topPages.length === 0 ? (
                <p className="text-sm text-gray-400">No page_view events yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {stats.topPages.map((p, i) => (
                    <li key={p.path} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-gray-700">
                        <span className="inline-block w-5 text-gray-300 font-medium">{i + 1}.</span>
                        {p.path === '/' ? 'Home' : p.path}
                      </span>
                      <span className="font-semibold text-gray-900 tabular-nums">{fmt(p.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Traffic sources */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-600 mb-2">Traffic Sources</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.sourceData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                      {stats.sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend fontSize={11} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Devices */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-600 mb-2">Devices</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.deviceData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" name="Visitors" radius={[6, 6, 0, 0]}>
                      {stats.deviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top products */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-600 mb-3">Top Product Views</p>
              {stats.topProducts.length === 0 ? (
                <p className="text-sm text-gray-400">No item-level views yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {stats.topProducts.map(([id, count]) => (
                    <li key={id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-gray-700">{id}</span>
                      <span className="font-semibold text-gray-900 tabular-nums">{fmt(count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-400">
            Data source: D1 <code className="px-1 rounded bg-gray-100">site_events</code> (events your storefront records via{' '}
            <code className="px-1 rounded bg-gray-100">recordSiteEvent</code>). Admin-only read; visitors can write events but never read them.
            GA4 still receives the same events separately.
          </p>
        </>
      )}
    </div>
  );
}
