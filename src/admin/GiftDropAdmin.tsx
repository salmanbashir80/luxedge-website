// ============================================================================
// LUXEDGE ADMIN — Pet Gift Drop
//
// Manages the real $0 giveaway: campaign configuration, live inventory, and
// every claim (same luxedge_orders rows the public flow creates). Actions
// persist server-side through /api/admin/gift-drop (same-origin session
// cookie; a localStorage bearer token is optional).
// ============================================================================
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getAccessToken } from '../services/supabase';
import { GIFT_STORAGE_UNAVAILABLE, giftStorageUnreadable } from '../services/adminReadouts';

interface ClaimView {
  id: string;
  orderNumber: string;
  email: string;
  name: string;
  status: string;
  createdAt: string;
  address: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string };
  petType: string;
  petName: string;
  petSize: string;
  petInterest: string;
  giftName: string;
  payment: string;
  isTest: boolean;
  emailSent: boolean;
  emailNote: string;
  tracking: { carrier?: string; number?: string } | null;
  totalCents?: number;
  marketingOptIn?: boolean;
}

interface CampaignView {
  title: string;
  message: string;
  giftName: string;
  giftValueCents: number;
  totalQuantity: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const STATUS_UI: Record<string, { label: string; chip: string }> = {
  pending: { label: 'Claimed', chip: 'bg-amber-100 text-amber-800' },
  processing: { label: 'Confirmed · Preparing', chip: 'bg-blue-100 text-blue-800' },
  shipped: { label: 'Shipped', chip: 'bg-sky-100 text-sky-800' },
  delivered: { label: 'Delivered', chip: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelled', chip: 'bg-gray-200 text-gray-600' },
};
const NEXT_LABEL: Record<string, string> = {
  pending: 'Confirm & prepare',
  processing: 'Mark shipped',
  shipped: 'Mark delivered',
};

const chip = (s: string) => {
  const c = STATUS_UI[s];
  return c ? `${c.chip} text-[11px] font-bold px-2 py-0.5 rounded-full capitalize` : 'bg-gray-100 text-gray-600 text-[11px] px-2 py-0.5 rounded-full capitalize';
};

export default function GiftDropAdmin() {
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [remaining, setRemaining] = useState<number>(-1);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTests, setShowTests] = useState(true);
  const [trackingDraft, setTrackingDraft] = useState<Record<string, { carrier: string; number: string }>>({});
  const [cfgDraft, setCfgDraft] = useState<CampaignView | null>(null);
  // The server reports remaining = -1 when the gift ledger could not be read
  // (Supabase outage/quota). That is NOT an empty campaign — say so instead of
  // telling the owner to seed a row that already exists.
  const [storageDown, setStorageDown] = useState(false);

  // The admin gate is the same-origin session COOKIE (see api/_lib/auth.ts);
  // a localStorage bearer token is optional. Never bail out when it is absent,
  // otherwise the page stays on its empty skeleton forever.
  const authHeader = (): Record<string, string> => {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const load = () => {
    setErr('');
    fetch('/api/admin/gift-drop', { headers: authHeader(), credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setCampaign(d.campaign || null);
        setCfgDraft(d.campaign || null);
        setClaims(Array.isArray(d.claims) ? d.claims : []);
        const remaining = typeof d.stats?.remaining === 'number' ? d.stats.remaining : -1;
        setRemaining(remaining);
        setStorageDown(giftStorageUnreadable(d.campaign, remaining));
      })
      .catch((e: Error) => setErr(e.message === 'HTTP 401'
        ? 'Could not load the Pet Gift Drop — sign in as admin again.'
        : `Could not load the Pet Gift Drop (${e.message}).`))
      .finally(() => setLoaded(true));
  };

  useEffect(load, []);

  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/gift-drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        credentials: 'same-origin',
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCfg = async () => {
    if (!cfgDraft) return;
    await post('campaign', { ...cfgDraft, totalQuantity: Math.max(Math.trunc(Number(cfgDraft.totalQuantity)) || 0, 0) });
  };

  const setField = (k: keyof CampaignView, v: string | number | boolean) =>
    setCfgDraft((c) => (c ? { ...c, [k]: v } : c));

  const live = claims.filter((c) => c.status !== 'cancelled' && c.status !== 'failed' && !c.isTest);
  const visible = showTests ? claims : claims.filter((c) => !c.isTest);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Pet Gift Drop</h1>
          <p className="text-xs text-gray-500">
            Real $0 giveaway — claims live in the same order table as sales, marked <code className="rounded bg-gray-100 px-1">PET-GIFT-DROP</code>.
            No payment method is ever collected.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={load} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50">Refresh</button>
          {campaign && (
            <span className={`rounded-full px-3 py-1 font-bold ${campaign.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
              {campaign.active ? '● Live' : '○ Paused'}
            </span>
          )}
        </div>
      </div>

      {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>}

      {/* Campaign config */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-wider text-gray-400">Campaign configuration</h2>
        {campaign && cfgDraft && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-gray-600">
              Title
              <input className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm" value={cfgDraft.title} onChange={(e) => setField('title', e.target.value)} />
            </label>
            <label className="block text-xs font-semibold text-gray-600">
              Gift description (shown on the landing page)
              <input className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm" value={cfgDraft.giftName} onChange={(e) => setField('giftName', e.target.value)} />
            </label>
            <label className="block text-xs font-semibold text-gray-600">
              Total real gifts
              <input type="number" min={0} className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm" value={cfgDraft.totalQuantity} onChange={(e) => setField('totalQuantity', e.target.value)} />
            </label>
            <label className="block text-xs font-semibold text-gray-600">
              Gift value (cents, for reporting)
              <input type="number" min={0} className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm" value={cfgDraft.giftValueCents} onChange={(e) => setField('giftValueCents', e.target.value)} />
            </label>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600">
                Message
                <textarea className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm" rows={2} value={cfgDraft.message} onChange={(e) => setField('message', e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-700">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={cfgDraft.active} onChange={(e) => setField('active', e.target.checked)} />
                Accepting claims (active)
              </label>
              <button onClick={saveCfg} disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-gray-700 disabled:opacity-50">
                Save campaign
              </button>
            </div>
          </div>
        )}
        {loaded && !campaign && (
          <div className={storageDown
            ? 'mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800'
            : 'mt-3 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500'}>
            {storageDown
              ? GIFT_STORAGE_UNAVAILABLE
              : <>No campaign configured yet — seed the app_settings row <code className="bg-gray-100 px-1">gift_drop_campaign_v1</code>.</>}
          </div>
        )}
      </div>

      {/* Inventory + claims */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-xl bg-gray-900 px-3 py-1.5 font-black text-white">{campaign ? live.length : 0}<span className="font-medium text-gray-300"> claimed</span></span>
          <span className="rounded-xl bg-emerald-50 px-3 py-1.5 font-black text-emerald-700">{remaining >= 0 ? remaining : '…'}<span className="font-medium text-emerald-500"> real gifts left</span></span>
          <span className="text-xs text-gray-400">of {campaign?.totalQuantity ?? 0} total (real inventory, from live claims)</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-500">
          <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} />
          Show TEST claims
        </label>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 lg:hidden">
        {visible.map((c) => (
          <div key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gray-900">{c.name} <span className="font-mono text-[10px] font-normal text-gray-400">#{c.orderNumber}</span></p>
                <p className="truncate text-xs text-gray-500">{c.email}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${c.isTest ? 'bg-orange-100 text-orange-700' : chip(c.status)}`}>{c.isTest ? 'TEST' : STATUS_UI[c.status]?.label || c.status}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-gray-500">
              <span>🐾 {c.petType || '—'}{c.petName ? ` · ${c.petName}` : ''}</span>
              <span>🎁 {(c.giftName || '').slice(0, 32)}</span>
              <span className="col-span-2">📍 {[c.address.line1, c.address.city, c.address.zip].filter(Boolean).join(', ')}</span>
              <span className="col-span-2">💵 {c.payment} · ${Number(c.totalCents ?? 0) / 100}</span>
            </div>
            <GiftActions claim={c} busy={busy} post={post} trackingDraft={trackingDraft} setTrackingDraft={setTrackingDraft} />
          </div>
        ))}
        {loaded && !visible.length && <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No gift-drop claims yet — share /free-pet-gift.</p>}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm lg:block">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] uppercase tracking-wider text-gray-400">
              <th className="px-3 py-2.5">Customer</th>
              <th className="px-3 py-2.5">Pet</th>
              <th className="px-3 py-2.5">Gift</th>
              <th className="px-3 py-2.5">Ship to</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Claimed</th>
              <th className="px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id} className="border-b border-gray-50 align-top">
                <td className="px-3 py-2.5">
                  <p className="font-semibold text-gray-800">{c.name}{c.isTest && <span className="ml-1.5 rounded bg-orange-100 px-1 py-0.5 text-[9px] font-black text-orange-700">TEST</span>}</p>
                  <p className="text-gray-400">{c.email}</p>
                  <p className="font-mono text-[10px] text-gray-300">#{c.orderNumber}</p>
                </td>
                <td className="px-3 py-2.5">
                  <p className="capitalize text-gray-700">{c.petType || '—'}{c.petName ? ` (${c.petName})` : ''}</p>
                  <p className="text-gray-400">{[c.petSize, c.petInterest].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="max-w-[180px] px-3 py-2.5">
                  <p className="text-gray-700">{c.giftName || 'Complimentary gift'}</p>
                  <p className="text-[10px] text-emerald-600">${Number(c.totalCents ?? 0) / 100} · {c.payment}</p>
                </td>
                <td className="max-w-[190px] px-3 py-2.5 text-gray-500">
                  {c.address.line1}{c.address.line2 ? `, ${c.address.line2}` : ''}, {c.address.city} {c.address.state} {c.address.zip}
                </td>
                <td className="px-3 py-2.5"><span className={chip(c.status)}>{STATUS_UI[c.status]?.label || c.status}</span></td>
                <td className="px-3 py-2.5 text-gray-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2.5">
                  <GiftActions claim={c} busy={busy} post={post} trackingDraft={trackingDraft} setTrackingDraft={setTrackingDraft} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GiftActions({
  claim,
  busy,
  post,
  trackingDraft,
  setTrackingDraft,
}: {
  claim: ClaimView;
  busy: boolean;
  post: (a: string, e?: Record<string, unknown>) => Promise<void>;
  trackingDraft: Record<string, { carrier: string; number: string }>;
  setTrackingDraft: Dispatch<SetStateAction<Record<string, { carrier: string; number: string }>>>;
}) {
  const td = trackingDraft[claim.id] || { carrier: '', number: '' };
  const setTd = (patch: Partial<{ carrier: string; number: string }>) =>
    setTrackingDraft((m) => ({ ...m, [claim.id]: { ...td, ...patch } }));
  const next = NEXT_LABEL[claim.status];
  if (claim.status === 'cancelled' || claim.status === 'delivered') {
    return (
      <div className="flex flex-wrap items-center gap-2 pt-1.5 text-[10px] text-gray-400">
        {claim.tracking?.number && <span>Tracking: {claim.tracking.carrier ? `${claim.tracking.carrier} · ` : ''}{claim.tracking.number}</span>}
        {claim.status === 'delivered' && <span className="font-semibold text-emerald-600">Done ✓</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      {next && (
        <button
          disabled={busy}
          onClick={() => post('update-status', { id: claim.id, status: claim.status === 'pending' ? 'processing' : claim.status === 'processing' ? 'shipped' : 'delivered' })}
          className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {next}
        </button>
      )}
      {claim.status === 'pending' && (
        <button
          disabled={busy}
          onClick={() => { if (window.confirm(`Cancel claim ${claim.orderNumber}? Its gift slot goes back to the pool.`)) post('cancel', { id: claim.id }); }}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      )}
      <div className="flex items-center gap-1">
        <input placeholder="Carrier" value={td.carrier} onChange={(e) => setTd({ carrier: e.target.value })} className="w-20 rounded-md border border-gray-200 px-1.5 py-1 text-[11px]" />
        <input placeholder="Tracking #" value={td.number} onChange={(e) => setTd({ number: e.target.value })} className="w-28 rounded-md border border-gray-200 px-1.5 py-1 text-[11px]" />
        <button
          disabled={busy || !td.number}
          onClick={() => post('tracking', { id: claim.id, carrier: td.carrier, number: td.number })}
          className="rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
