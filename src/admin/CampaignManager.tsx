// ============================================================================
// LUXEDGE ADMIN — Campaign Manager
//
// The reusable campaign engine console. Evolves the single Pet Gift Drop into
// a multi-campaign manager:
//   * every campaign = one config row in the registry (server-side),
//   * create from a template → edit → publish (live) / pause / end / archive,
//   * product-level gift eligibility flags + margin caps,
//   * a claims ledger per campaign (same luxedge_orders rows the public flow
//     creates), with a TEST filter and the full fulfilment action set.
// The flagship Pet Gift Drop stays bridged to the legacy config + page.
// ============================================================================
import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getAccessToken, getFreshAccessToken } from '../services/supabase';
import { callAIProvider } from '../features/ai/client';
import { loadAIProviders } from '../features/ai/providers';
import { campaignCopyPrompt, parseCampaignCopy } from '../features/ai/campaignCopy';

type Status = 'draft' | 'scheduled' | 'live' | 'paused' | 'ended' | 'archived';

interface ClaimView {
  id: string;
  orderNumber: string;
  email: string;
  name: string;
  status: string;
  createdAt: string;
  address: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string };
  campaignSlug: string;
  campaignTitle: string;
  claimCode: string;
  petType: string;
  petName: string;
  giftName: string;
  giftValueCents: number;
  giftPriceCents: number;
  payment: string;
  source: string;
  marketingOptIn: boolean;
  isTest: boolean;
  emailSent: boolean;
  emailNote: string;
  utm: Record<string, unknown> | null;
  tracking: { carrier?: string; number?: string } | null;
  totalCents: number;
}

interface OfferCfg {
  freeThresholdCents?: number;
  premiumPercentOff?: number;
  maxDiscountCents?: number;
  maxEligibleRetailCents?: number;
  freeShipping?: boolean;
  productScope?: 'all' | 'included' | 'excluded';
  minCartValueCents?: number;
  discountPercentOff?: number;
  discountFixedCents?: number;
  allowStacking?: boolean;
}

interface PopupCfg { enabled?: boolean; delayMs?: number; scrollDepth?: number; exitIntent?: boolean; frequencyDays?: number; headline?: string; subtext?: string; }
interface ReferralCfg { enabled?: boolean; shareHeadline?: string; shareSubtext?: string; rewardCopy?: string; }
interface EmailCfg { enabled?: boolean; subject?: string; }

interface CampaignView {
  slug: string;
  kind: 'gift' | 'promo';
  templateKey: string;
  status: Status;
  title: string;
  subtitle?: string;
  message?: string;
  giftName?: string;
  giftValueCents?: number;
  totalQuantity?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  landingSlug?: string;
  audience?: { everyone?: boolean; petTypes?: string[] };
  eligibility?: { onePerEmail?: boolean; onePerHousehold?: boolean; limitPerCustomer?: number };
  offer?: OfferCfg;
  popup?: PopupCfg;
  referral?: ReferralCfg;
  email?: EmailCfg;
}

const STATUS_UI: Record<string, { label: string; chip: string }> = {
  draft: { label: 'Draft', chip: 'bg-gray-100 text-gray-600' },
  scheduled: { label: 'Scheduled', chip: 'bg-indigo-100 text-indigo-700' },
  live: { label: '● Live', chip: 'bg-emerald-100 text-emerald-700' },
  paused: { label: 'Paused', chip: 'bg-amber-100 text-amber-800' },
  ended: { label: 'Ended', chip: 'bg-gray-200 text-gray-500' },
  archived: { label: 'Archived', chip: 'bg-gray-100 text-gray-400' },
};
const CLAIM_STATUS_UI: Record<string, { label: string; chip: string }> = {
  pending: { label: 'Claimed', chip: 'bg-amber-100 text-amber-800' },
  processing: { label: 'Confirmed · Preparing', chip: 'bg-blue-100 text-blue-800' },
  shipped: { label: 'Shipped', chip: 'bg-sky-100 text-sky-800' },
  delivered: { label: 'Delivered', chip: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelled', chip: 'bg-gray-200 text-gray-600' },
};
const NEXT_LABEL: Record<string, string> = { pending: 'Confirm & prepare', processing: 'Mark shipped', shipped: 'Mark delivered' };
const inputCls = 'mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200';
const labelCls = 'block text-xs font-semibold text-gray-600';
const num = (v: unknown) => Math.max(Math.trunc(Number(v)) || 0, 0);

interface FlagsMap { [productId: string]: { giftEligible: boolean; allowFree?: boolean; maxDiscountCents?: number; freeShipping?: boolean } }
interface ProdRow { id: string; slug?: string | null; name?: string | null; price?: number | null; image_url?: string | null; status?: string | null; }

export default function CampaignManager() {
  const [loaded, setLoaded] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState<Array<{ config: CampaignView; state: Record<string, unknown>; stats: Record<string, unknown> }>>([]);
  const [flagship, setFlagship] = useState<{ config: CampaignView; claims: ClaimView[] } | null>(null);
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [flags, setFlags] = useState<FlagsMap>({});
  const [templates, setTemplates] = useState<Array<{ key: string; title: string }>>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [showTests, setShowTests] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState({ templateKey: 'free_pet_gift', slug: '' });
  const [editing, setEditing] = useState<CampaignView | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<string>('pet-gift-drop');
  const [showFlags, setShowFlags] = useState(false);
  const [prodQuery, setProdQuery] = useState('');
  const [prodResults, setProdResults] = useState<ProdRow[]>([]);
  const [flagsDraft, setFlagsDraft] = useState<FlagsMap>({});
  const [campaignQuery, setCampaignQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const [copyUndo, setCopyUndo] = useState<Pick<CampaignView, 'title' | 'subtitle' | 'message'> | null>(null);
  const editingRef = useRef(editing);
  const editDialog = useRef<HTMLDialogElement>(null);
  editingRef.current = editing;
  useEffect(() => {
    const dialog = editDialog.current;
    if (editing && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [editing?.slug]);

  const token = getAccessToken();
  const authHeaders = (): Record<string, string> => token ? { Authorization: `Bearer ${token}` } : {};

  const load = () => {
    setLoaded(false); setStorageReady(false); setErr('');
    fetch('/api/admin/campaigns', { headers: authHeaders(), credentials: 'same-origin', cache: 'no-store' })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Campaign Manager unavailable (HTTP ${r.status}).`);
        return d;
      })
      .then((d) => {
        setStorageReady(true);
        setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []);
        setFlagship(d.flagship || null);
        setClaims(Array.isArray(d.claims) ? d.claims : []);
        setFlags((d.flags as FlagsMap) || {});
        setFlagsDraft((d.flags as FlagsMap) || {});
        setTemplates(Array.isArray(d.templates) ? d.templates : []);
        setStatuses(Array.isArray(d.statuses) ? d.statuses : []);
      })
      .catch(e => setErr((e as Error).message || 'Could not load the Campaign Manager.'))
      .finally(() => setLoaded(true));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const post = async (payload: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    if (!storageReady) { setErr('Campaign storage is not ready. Refresh after its connection is restored.'); return null; }
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      return d;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const d = await post({ action: 'create', templateKey: createDraft.templateKey, slug: createDraft.slug });
    if (d) { setShowCreate(false); setCreateDraft({ templateKey: 'free_pet_gift', slug: '' }); load(); }
  };

  const setStatus = async (slug: string, status: Status) => {
    if (slug === 'pet-gift-drop') { setErr('The flagship Pet Gift Drop status is controlled on the Gift Drop page.'); return; }
    const d = await post({ action: 'status', slug, status });
    if (d) load();
  };

  const duplicate = async (slug: string) => {
    const newSlug = window.prompt(`Duplicate "${slug}" as new slug:`, `${slug}-copy`);
    if (!newSlug) return;
    const d = await post({ action: 'duplicate', slug, newSlug });
    if (d) load();
  };

  const archive = async (slug: string) => {
    if (!window.confirm(`Archive "${slug}"? It will disappear from the manager (claims are kept).`)) return;
    const d = await post({ action: 'archive', slug });
    if (d) load();
  };

  const saveFlags = async () => {
    const d = await post({ action: 'flags', map: flagsDraft });
    if (d) { setShowFlags(false); setFlags(JSON.parse(JSON.stringify(flagsDraft))); load(); }
  };

  const searchProducts = async (q: string) => {
    setProdQuery(q);
    const r = await fetch(`/api/admin/campaigns?view=products&q=${encodeURIComponent(q)}`, { headers: authHeaders(), credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    setProdResults(Array.isArray(d.products) ? d.products : []);
  };

  const claimsFor = (slug: string) => claims.filter((c) => c.campaignSlug === slug || (slug === 'pet-gift-drop' && !c.campaignSlug));
  const visibleClaims = (slug: string) => {
    const rows = claimsFor(slug);
    return showTests ? rows : rows.filter((c) => !c.isTest);
  };

  const setEditingFrom = (slug: string) => {
    const cfg = (campaigns.find((c) => c.config.slug === slug)?.config) || null;
    if (!cfg) { setErr('Only registry campaigns can be edited here (the flagship is edited on the Gift Drop page).'); return; }
    setEditing(JSON.parse(JSON.stringify(cfg)));
    setCopyNote(''); setCopyUndo(null);
  };

  const setField = (k: keyof CampaignView, v: unknown) => setEditing((e) => (e ? { ...e, [k]: v } : e));
  const setOffer = (k: keyof OfferCfg, v: unknown) => setEditing((e) => (e ? { ...e, offer: { ...(e.offer || {}), [k]: v } } : e));

  const saveEdit = async () => {
    if (!editing) return;
    if (editing.startsAt && !Number.isFinite(Date.parse(editing.startsAt))) { setCopyNote('Enter a valid start date.'); return; }
    if (editing.endsAt && !Number.isFinite(Date.parse(editing.endsAt))) { setCopyNote('Enter a valid end date.'); return; }
    if (editing.startsAt && editing.endsAt && Date.parse(editing.endsAt) <= Date.parse(editing.startsAt)) { setCopyNote('Campaign end must be after its start.'); return; }
    if (editing.status === 'live' && !window.confirm('Save these changes to a LIVE campaign? Review the preview and offer details first.')) return;
    const d = await post({ action: 'save', config: editing });
    if (d) { setEditing(null); load(); }
  };

  const draftCopy = async () => {
    if (!editing || copyBusy) return;
    const snapshot = structuredClone(editing);
    setCopyBusy(true); setCopyNote('Generating a draft with your shared AI provider…');
    try {
      await getFreshAccessToken();
      const raw = await callAIProvider(campaignCopyPrompt({ title: snapshot.title, subtitle: snapshot.subtitle, message: snapshot.message, kind: snapshot.kind, giftName: snapshot.giftName, freeShipping: snapshot.offer?.freeShipping }), loadAIProviders());
      const copy = parseCampaignCopy(raw, { kind: snapshot.kind, freeShipping: snapshot.offer?.freeShipping });
      if (!editingRef.current || JSON.stringify(editingRef.current) !== JSON.stringify(snapshot)) throw new Error('Campaign changed while AI was working. Draft not applied; try again.');
      setCopyUndo({ title: snapshot.title, subtitle: snapshot.subtitle, message: snapshot.message });
      setEditing(prev => prev?.slug === snapshot.slug ? { ...prev, ...copy } : prev);
      setCopyNote('AI draft applied to this form only. Review the preview, then save manually. Nothing has been published or emailed.');
    } catch (e) { setCopyNote((e as Error).message); }
    finally { setCopyBusy(false); }
  };

  const filteredCampaigns = campaigns.filter(({ config: c }) => (statusFilter === 'all' || c.status === statusFilter)
    && `${c.title} ${c.slug}`.toLowerCase().includes(campaignQuery.toLowerCase()));
  const formatDate = (date?: string | null) => date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString() : 'Not set';

  const totalClaims = (slug: string) => {
    const rows = claimsFor(slug);
    return rows.filter((r) => !['cancelled', 'failed'].includes(r.status) && !r.isTest).length;
  };

  // Claims actions
  const claimPost = async (action: string, id: string, extra: Record<string, unknown> = {}) => {
    const d = await post({ action, id, ...extra });
    if (d) load();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Campaign Manager</h1>
          <p className="mt-1 text-sm text-gray-600">Plan an offer, prepare the copy, review the preview, then publish when ready. Gift claims remain separate from paid orders.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={load} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50">Refresh</button>
          <button onClick={() => setShowCreate(true)} disabled={!storageReady || busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-bold text-white hover:bg-indigo-700 disabled:opacity-40">+ Create campaign</button>
        </div>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Campaign overview">
        {[['Registry live campaigns', campaigns.filter(c => c.config.status === 'live').length], ['Drafts', campaigns.filter(c => c.config.status === 'draft').length], ['Scheduled', campaigns.filter(c => c.config.status === 'scheduled').length], ['Real gift claims', claims.filter(c => !c.isTest && !['cancelled', 'failed'].includes(c.status)).length]].map(([label, count]) => <div key={label} className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-600">{label}</p><p className="mt-2 text-2xl font-bold text-gray-950">{loaded && storageReady ? count : '—'}</p></div>)}
      </section>
      <div className="flex flex-col sm:flex-row gap-3"><label className="flex-1 text-xs font-semibold text-gray-700">Find a campaign<input className={inputCls} value={campaignQuery} onChange={e => setCampaignQuery(e.target.value)} placeholder="Search title or URL slug" /></label><label className="text-xs font-semibold text-gray-700">Status<select className={inputCls} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(STATUS_UI).map(([id, ui]) => <option key={id} value={id}>{ui.label}</option>)}</select></label><Link to="/admin/ai" className="self-end min-h-11 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-indigo-700">AI connection →</Link></div>
      {err && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Create campaign">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-sm font-black text-gray-900">Create a campaign</h2>
            <p className="mt-1 text-xs text-gray-500">Pick a template, give it a URL slug, then publish it from the Draft state when ready.</p>
            <label className={`${labelCls} mt-4`}>Template
              <select className={inputCls} value={createDraft.templateKey} onChange={(e) => setCreateDraft((d) => ({ ...d, templateKey: e.target.value }))}>
                {templates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
              </select>
            </label>
            <label className={`${labelCls} mt-3`}>Slug (public URL: /campaigns/{createDraft.slug || 'your-campaign'})
              <input className={inputCls} value={createDraft.slug} onChange={(e) => setCreateDraft((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') }))} placeholder="dog-summer-event" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">Cancel</button>
              <button onClick={create} disabled={busy || !createDraft.slug} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40">Create draft</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <dialog ref={editDialog} onCancel={e => { e.preventDefault(); if (!copyBusy && !busy) setEditing(null); }} className="m-auto w-[calc(100%_-_1.5rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl border-0 p-0 shadow-2xl backdrop:bg-black/40" aria-label={`Edit ${editing.title}`}>
          <div className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-gray-900">Edit — {editing.slug}</h2>
              <button onClick={() => setEditing(null)} disabled={copyBusy || busy} className="min-h-11 rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50">Close</button>
            </div>
            <section className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950 space-y-2"><p className="font-semibold">AI copy assistance — drafts only</p><p>Uses the same provider as product SEO. Does not change your offer, dates, inventory, campaign status or email recipients.</p><div className="flex flex-wrap gap-2"><button onClick={() => void draftCopy()} disabled={copyBusy || busy || !editing.title.trim()} className="min-h-11 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{copyBusy ? 'Generating…' : 'Draft copy with AI'}</button>{copyUndo && <button className="min-h-11 px-3 text-sm underline" disabled={copyBusy || busy} onClick={() => { setEditing(prev => prev ? { ...prev, ...copyUndo } : prev); setCopyUndo(null); setCopyNote('Previous copy restored in the form.'); }}>Undo AI copy</button>}</div>{copyNote && <p role="status">{copyNote}</p>}</section>
            <fieldset disabled={copyBusy || busy} className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>Title
                <input className={inputCls} value={editing.title} onChange={(e) => setField('title', e.target.value)} /></label>
              <label className={labelCls}>Status
                <select className={inputCls} value={editing.status} onChange={(e) => setField('status', e.target.value as Status)}>
                  {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select></label>
              <label className={labelCls}>Subtitle
                <input className={inputCls} value={editing.subtitle || ''} onChange={(e) => setField('subtitle', e.target.value)} /></label>
              <label className={labelCls}>Landing slug (public path segment)
                <input className={inputCls} value={editing.landingSlug || editing.slug} onChange={(e) => setField('landingSlug', e.target.value)} /></label>
              <label className={labelCls}>Total real gifts (0 = unlimited)
                <input type="number" min={0} className={inputCls} value={editing.totalQuantity ?? 0} onChange={(e) => setField('totalQuantity', num(e.target.value))} /></label>
              <label className={labelCls}>Gift value (cents, for reporting)
                <input type="number" min={0} className={inputCls} value={editing.giftValueCents ?? 0} onChange={(e) => setField('giftValueCents', num(e.target.value))} /></label>
              <label className={labelCls}>Free-gift retail threshold (cents) — at/below this an eligible product is $0
                <input type="number" min={0} className={inputCls} value={editing.offer?.freeThresholdCents ?? 0} onChange={(e) => setOffer('freeThresholdCents', num(e.target.value))} /></label>
              <label className={labelCls}>Premium % off (above threshold)
                <input type="number" min={0} max={100} className={inputCls} value={editing.offer?.premiumPercentOff ?? 0} onChange={(e) => setOffer('premiumPercentOff', num(e.target.value))} /></label>
              <label className={labelCls}>Margin cap — max discount per gift (cents)
                <input type="number" min={0} className={inputCls} value={editing.offer?.maxDiscountCents ?? 0} onChange={(e) => setOffer('maxDiscountCents', num(e.target.value))} /></label>
              <label className={labelCls}>Max eligible retail price (cents)
                <input type="number" min={0} className={inputCls} value={editing.offer?.maxEligibleRetailCents ?? 0} onChange={(e) => setOffer('maxEligibleRetailCents', num(e.target.value))} /></label>
              <label className={labelCls}>Audience pet types (comma separated)
                <input className={inputCls} value={(editing.audience?.petTypes || []).join(', ')} onChange={(e) => setField('audience', { ...(editing.audience || {}), petTypes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
              <label className={labelCls}>Starts at (ISO)
                <input className={inputCls} value={editing.startsAt || ''} placeholder="2026-06-01T00:00:00Z" onChange={(e) => setField('startsAt', e.target.value || null)} /></label>
              <label className={labelCls}>Ends at (ISO)
                <input className={inputCls} value={editing.endsAt || ''} placeholder="2026-06-30T23:59:59Z" onChange={(e) => setField('endsAt', e.target.value || null)} /></label>
              <div className="sm:col-span-2">
                <label className={labelCls}>Message (shown on the landing page)
                  <textarea className={inputCls} rows={2} value={editing.message || ''} onChange={(e) => setField('message', e.target.value)} /></label>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-700">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={editing.offer?.freeShipping !== false} onChange={(e) => setOffer('freeShipping', e.target.checked)} />
                Campaign pays standard shipping
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-700">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={!!editing.popup?.enabled} onChange={(e) => setField('popup', { ...(editing.popup || {}), enabled: e.target.checked })} />
                Enable storefront popup (email capture)
              </label>
            </fieldset>
            <section className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4" aria-label="Campaign copy preview"><p className="text-xs font-semibold uppercase text-gray-600">Preview · not published</p><h3 className="mt-2 text-lg font-bold text-gray-950 break-words">{editing.title}</h3><p className="mt-1 text-sm text-gray-700 break-words">{editing.subtitle}</p><p className="mt-3 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap break-words">{editing.message}</p><p className="mt-3 text-xs text-gray-600">Starts: {formatDate(editing.startsAt)} · Ends: {formatDate(editing.endsAt)}</p></section>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} disabled={busy || copyBusy} className="min-h-11 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">Cancel</button>
              <button onClick={saveEdit} disabled={busy || copyBusy} className="min-h-11 rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50">Save campaign</button>
            </div>
          </div>
        </dialog>
      )}

      {/* Product flags modal */}
      {showFlags && (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Gift-eligible products">
          <div className="mx-auto w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-gray-900">Gift-eligible products</h2>
              <button onClick={() => setShowFlags(false)} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-100">Close</button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Products flagged <b>Gift eligible</b> may be claimed in campaigns (subject to each campaign's retail threshold and margin cap).
              You can set a per-product discount cap that is tighter than a campaign's cap.
            </p>
            <div className="mt-3 flex gap-2">
              <input className={inputCls} placeholder="Search products…" value={prodQuery} onChange={(e) => searchProducts(e.target.value)} />
            </div>
            {prodResults.length > 0 && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-gray-200">
                {prodResults.map((p) => {
                  const f = flagsDraft[p.id] || {};
                  const setF = (patch: Partial<FlagsMap[string]>) => setFlagsDraft((m) => ({ ...m, [p.id]: { ...f, ...patch } }));
                  return (
                    <div key={p.id} className="flex items-center gap-3 border-b border-gray-100 px-3 py-2">
                      {p.image_url && <img src={p.image_url} alt="" className="h-9 w-9 rounded-lg object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-gray-800">{p.name}</p>
                        <p className="text-[10px] text-gray-400">${(Number(p.price) || 0).toFixed(2)}</p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                        <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!f.giftEligible} onChange={(e) => setF({ giftEligible: e.target.checked })} /> Eligible
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                        <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={!!f.allowFree} onChange={(e) => setF({ allowFree: e.target.checked })} /> Free override
                      </label>
                      <input type="number" min={0} placeholder="Cap ¢" title="Per-product max discount (cents)" className="w-20 rounded-md border border-gray-200 px-1.5 py-1 text-[11px]"
                        value={f.maxDiscountCents ?? ''} onChange={(e) => setF({ maxDiscountCents: e.target.value === '' ? undefined : num(e.target.value) })} />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Currently flagged</p>
              {Object.entries(flagsDraft).filter(([, f]) => f.giftEligible).length === 0 && <p className="mt-1 text-[11px] text-gray-400">None yet — search above and mark products.</p>}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(flagsDraft).filter(([, f]) => f.giftEligible).map(([id, f]) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">
                    {id.slice(0, 8)}…{f.allowFree ? ' · FREE' : ''}{f.maxDiscountCents ? ` · ≤$${(f.maxDiscountCents / 100).toFixed(2)}` : ''}
                    <button onClick={() => setFlagsDraft((m) => { const n = { ...m }; delete n[id]; return n; })} className="text-indigo-400 hover:text-red-500">✕</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setFlagsDraft(JSON.parse(JSON.stringify(flags))); setShowFlags(false); }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">Cancel</button>
              <button onClick={saveFlags} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50">Save flags</button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign cards */}
      {!loaded && <p role="status" className="text-sm text-gray-500">Checking campaign storage…</p>}
      {storageReady && <>
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Flagship card */}
        <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-600">Flagship · Pet Gift Drop</p>
              <h2 className="mt-0.5 text-sm font-bold text-gray-900">Luxedge Pet Gift Drop</h2>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">Managed on Gift Drop page</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white p-2"><p className="text-lg font-black text-gray-900">{totalClaims('pet-gift-drop')}</p><p className="text-[10px] text-gray-400">claimed</p></div>
            <div className="rounded-xl bg-white p-2"><p className="text-lg font-black text-emerald-600">{flagship ? flagship.claims.filter((c) => !['cancelled', 'failed'].includes(c.status) && !c.isTest).length : totalClaims('pet-gift-drop')}</p><p className="text-[10px] text-gray-400">live</p></div>
            <div className="rounded-xl bg-white p-2"><p className="text-lg font-black text-indigo-600">{flags ? Object.values(flags).filter((f) => f.giftEligible).length : 0}</p><p className="text-[10px] text-gray-400">eligible products</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <button onClick={() => { setShowFlags(true); if (!prodResults.length) searchProducts(''); }} className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-white hover:bg-amber-600">Gift-eligible products</button>
          </div>
        </div>

        {filteredCampaigns.map(({ config: c, stats }) => {
          const ui = STATUS_UI[c.status] || STATUS_UI.draft;
          const claimed = Number((stats as { claimed?: number })?.claimed ?? 0);
          return (
            <div key={c.slug} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-gray-900">{c.title}</p>
                  <p className="text-[10px] text-gray-400">/{c.landingSlug || c.slug} · {c.kind}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ui.chip}`}>{ui.label}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                <span>🎁 {claimed} claimed</span>
                <span>✉️ {(stats as { emails?: number })?.emails ?? 0} emails</span>
                <span>🧪 {(stats as { tests?: number })?.tests ?? 0} tests</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Link to={`/campaigns/${c.landingSlug || c.slug}`} target="_blank" className="min-h-11 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700">View page ↗</Link>
                <button onClick={() => setEditingFrom(c.slug)} className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-gray-700">Edit</button>
                <button onClick={() => duplicate(c.slug)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">Duplicate</button>
                {c.status !== 'live' && c.status !== 'ended' && <button onClick={() => setStatus(c.slug, 'live')} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700">Activate</button>}
                {c.status === 'live' && <button onClick={() => setStatus(c.slug, 'paused')} className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600">Pause</button>}
                {['live', 'paused'].includes(c.status) && <button onClick={() => setStatus(c.slug, 'ended')} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50">End</button>}
                <button onClick={() => archive(c.slug)} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-medium text-rose-500 hover:bg-rose-50">Archive</button>
              </div>
            </div>
          );
        })}
        {loaded && filteredCampaigns.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-600">No matching registry campaigns. Create a draft to get started; the existing Gift Drop stays managed separately.</p>}
        {!loaded && <p className="text-sm text-gray-400">Loading campaigns…</p>}
      </div>

      {/* Claims ledger for the selected campaign */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-gray-400">Claims ledger</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium" value={activeCampaign} onChange={(e) => setActiveCampaign(e.target.value)}>
              <option value="pet-gift-drop">Pet Gift Drop (flagship)</option>
              {campaigns.map(({ config: c }) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-500">
              <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} /> Show TEST claims
            </label>
          </div>
        </div>
        {visibleClaims(activeCampaign).length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-gray-200 p-5 text-center text-xs text-gray-400">
            No claims for this campaign yet. Share the public campaign page to start collecting.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {visibleClaims(activeCampaign).map((c) => <ClaimRow key={c.id} claim={c} busy={busy} post={claimPost} />)}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}

function ClaimRow({ claim: c, busy, post }: { claim: ClaimView; busy: boolean; post: (a: string, id: string, extra?: Record<string, unknown>) => Promise<void> }) {
  const [tracking, setTracking] = useState<{ carrier: string; number: string }>({ carrier: '', number: '' });
  const chip = CLAIM_STATUS_UI[c.status]?.chip || 'bg-gray-100 text-gray-600';
  const next = NEXT_LABEL[c.status];
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-gray-900">{c.name}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${chip}`}>{c.isTest ? 'TEST' : CLAIM_STATUS_UI[c.status]?.label || c.status}</span>
          </p>
          <p className="text-xs text-gray-500">{c.email} · <span className="font-mono text-[10px]">{c.orderNumber}</span>{c.claimCode ? ` · code ${c.claimCode}` : ''}</p>
        </div>
        <p className="text-[11px] text-gray-400">{new Date(c.createdAt).toLocaleDateString()}</p>
      </div>
      <div className="mt-1.5 grid gap-1 text-[11px] text-gray-500 sm:grid-cols-3">
        <span>🐾 {c.petType || '—'}{c.petName ? ` · ${c.petName}` : ''}</span>
        <span>🎁 {(c.giftName || '').slice(0, 36)} · {c.giftPriceCents ? `$${(c.giftPriceCents / 100).toFixed(2)}` : '$0'}</span>
        <span>📍 {[c.address.line1, c.address.city, c.address.zip].filter(Boolean).join(', ') || 'no address'}</span>
        <span>💳 {c.payment}</span>
        {Boolean(c.utm?.source) && <span>📣 {String((c.utm as Record<string, unknown>)?.source ?? '')}{c.utm?.medium ? ` / ${String(c.utm.medium)}` : ''}</span>}
        {c.emailSent ? <span className="text-emerald-600">✓ email sent</span> : c.emailNote ? <span className="text-rose-500" title={c.emailNote}>✗ email failed</span> : <span>email pending</span>}
      </div>
      {['pending', 'processing', 'shipped'].includes(c.status) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {next && (
            <button disabled={busy} onClick={() => post('claim-status', c.id, { status: c.status === 'pending' ? 'processing' : c.status === 'processing' ? 'shipped' : 'delivered' })}
              className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">{next}</button>
          )}
          {c.status === 'pending' && (
            <button disabled={busy} onClick={() => { if (window.confirm(`Cancel claim ${c.orderNumber}? Its gift slot goes back to the pool.`)) post('cancel-claim', c.id); }}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          )}
          <input placeholder="Carrier" value={tracking.carrier} onChange={(e) => setTracking((t) => ({ ...t, carrier: e.target.value }))} className="w-20 rounded-md border border-gray-200 px-1.5 py-1 text-[11px]" />
          <input placeholder="Tracking #" value={tracking.number} onChange={(e) => setTracking((t) => ({ ...t, number: e.target.value }))} className="w-28 rounded-md border border-gray-200 px-1.5 py-1 text-[11px]" />
          <button disabled={busy || !tracking.number} onClick={() => post('tracking', c.id, tracking)}
            className="rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-gray-700 disabled:opacity-40">Save tracking</button>
        </div>
      )}
      {c.tracking?.number && <p className="mt-1 text-[10px] text-gray-400">Tracking: {c.tracking.carrier ? `${c.tracking.carrier} · ` : ''}{c.tracking.number}</p>}
    </div>
  );
}
