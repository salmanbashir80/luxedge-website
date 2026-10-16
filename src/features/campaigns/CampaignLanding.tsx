// ============================================================================
// LUXEDGE — CAMPAIGN ENGINE public landing (/campaigns/:slug)
//
// One data-driven landing for every live campaign in the engine:
//   * hero (title / subtitle / message from the campaign config),
//   * real remaining count from the server (never fake scarcity),
//   * a pet-type + email + (gift) claim form — for a $0 gift the server
//     creates the order directly with payment NOT_REQUIRED (no card),
//   * eligible product picker when the campaign exposes products,
//   * referral + UTM capture (utm params on the page URL are forwarded),
//   * a clean success state that shows the claim code.
// The flagship /free-pet-gift page stays as the original polished page; this
// component powers future campaigns (and /campaigns/pet-gift-drop too).
// ============================================================================
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';

interface EligibleProduct {
  id: string; name: string; priceCents: number; giftPriceCents: number;
  tier: 'free' | 'premium'; imageUrl: string | null; slug: string | null; stockStatus?: string | null;
}

interface CampaignState {
  active: boolean; status: string; title: string; subtitle?: string; message?: string;
  giftName: string; total: number; remaining: number; kind: string;
  freeThresholdCents: number; premiumPercentOff: number; maxDiscountCents: number;
  freeShipping: boolean; petTypes: string[]; referralEnabled: boolean;
  eligible?: EligibleProduct[];
}

type Phase = { phase: 'loading' } | { phase: 'open' | 'full' | 'closed' | 'error'; state: Partial<CampaignState> };

const inputCls = 'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 transition';
const labelCls = 'mb-1.5 block text-[13px] font-semibold text-gray-700';
// Fashion build (VITE_FASHION_SAMPLE_CATALOG=true) drops the Pet wording.
const NEWS_LABEL = import.meta.env.VITE_FASHION_SAMPLE_CATALOG === 'true' ? 'Luxedge news' : 'Luxedge pet news';

export default function CampaignLanding() {
  const { slug = '' } = useParams();
  const [sp] = useSearchParams();
  const [phase, setPhase] = useState<Phase>({ phase: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [petType, setPetType] = useState('');
  const [form, setForm] = useState({ firstName: '', email: '', marketing: false });
  const [success, setSuccess] = useState<{ claimCode: string; giftName: string; orderNumber: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());

  // UTM params → forwarded to the claim so the campaign analytics can show
  // which channel produced traffic, emails and claims.
  const utm = useRef<Record<string, string | undefined>>({
    source: sp.get('utm_source') || (sp.get('ref') ? 'referral' : undefined),
    medium: sp.get('utm_medium') || undefined,
    campaign: sp.get('utm_campaign') || undefined,
    content: sp.get('utm_content') || undefined,
    term: sp.get('utm_term') || undefined,
    referral: sp.get('ref') || undefined,
  });

  useEffect(() => {
    let alive = true;
    fetch(`/api/campaigns/state?slug=${encodeURIComponent(slug)}&eligible=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CampaignState) => {
        if (!alive) return;
        if (!d || !d.title) { setPhase({ phase: 'error', state: {} }); return; }
        if (!d.active) setPhase({ phase: 'closed', state: d });
        else if (d.total > 0 && d.remaining <= 0) setPhase({ phase: 'full', state: d });
        else setPhase({ phase: 'open', state: d });
      })
      .catch(() => alive && setPhase({ phase: 'error', state: {} }));
    return () => { alive = false; };
  }, [slug]);

  const st = (phase as { state: Partial<CampaignState> }).state || {};
  const petTypes: string[] = st.petTypes?.length ? st.petTypes : ['women', 'men', 'accessories'];
  const eligible = (st.eligible || []).filter((p) => p.tier === 'free' || p.tier === 'premium');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const g = st as Partial<CampaignState>;
    if (!petType) { setError('Please choose your style preference.'); return; }
    if (!form.firstName.trim() || !form.email.trim()) { setError('Please enter your name and email.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError('That email address does not look valid.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/campaigns/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          firstName: form.firstName.trim(),
          email: form.email.trim(),
          petType,
          productId: selected || undefined,
          marketingOptIn: form.marketing,
          source: 'welcome_popup',
          utm: utm.current,
          company: '', // honeypot
          formSeconds: Math.round((Date.now() - startedAt.current) / 1000),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setSuccess({ claimCode: d.claimCode, giftName: d.giftName || (g.giftName || 'your complimentary gift'), orderNumber: d.orderNumber });
      } else if (res.ok && d.premium) {
        setError(`This gift is priced at $${((d.giftPriceCents || 0) / 100).toFixed(2)} — ${d.message || 'premium gifts are completed at checkout.'}`);
      } else {
        setError(d.error || 'We could not complete your claim just now — please try again.');
      }
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ UI
  if (phase.phase === 'loading') {
    return <div className="flex min-h-[50vh] items-center justify-center bg-[#0b1120]"><p className="text-sm text-gray-400">Loading campaign…</p></div>;
  }
  if (phase.phase === 'error') {
    return <div className="flex min-h-[50vh] items-center justify-center bg-white"><p className="text-sm text-gray-500">Campaign unavailable right now.</p></div>;
  }

  const fullTitle = st.title || 'Luxedge campaign';
  const totalGifts = Number(st.total) || 0;
  const remainingGifts = Number(st.remaining ?? -1);

  return (
    <div className="min-h-screen bg-[#0b1120]">
      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0b1120]">
        <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#1E4636]/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-300">Luxedge · Real promotional campaign</p>
          <h1 className="mt-3 font-serif text-3xl font-black text-white sm:text-5xl">{fullTitle}</h1>
          {st.subtitle && <p className="mt-3 max-w-2xl text-[15px] text-blue-100/80">{st.subtitle}</p>}
          {st.message && <p className="mt-1.5 max-w-2xl text-[13px] text-blue-100/50">{st.message}</p>}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-16">
        {phase.phase === 'full' && (
          <div className="rounded-2xl bg-white/5 p-8 text-center ring-1 ring-white/10">
            <p className="text-lg font-black text-white">This gift drop has been fully claimed.</p>
            <p className="mt-1 text-sm text-blue-100/60">Real inventory only — no more gifts are available for this campaign.</p>
          </div>
        )}
        {phase.phase === 'closed' && (
          <div className="rounded-2xl bg-white/5 p-8 text-center ring-1 ring-white/10">
            <p className="text-lg font-black text-white">This campaign is not open right now.</p>
            <Link to="/shop" className="mt-4 inline-block rounded-full bg-[#1E4636] px-6 py-2.5 text-xs font-bold text-white">Browse the shop</Link>
          </div>
        )}

        {phase.phase === 'open' && success && (
          <div className="rounded-2xl bg-emerald-500/10 p-8 text-center ring-1 ring-emerald-400/30">
            <p className="text-3xl">🎁</p>
            <h2 className="mt-2 font-serif text-2xl font-black text-white">Your gift is reserved</h2>
            <p className="mt-2 text-sm text-emerald-100/90">{success.giftName}</p>
            <p className="mx-auto mt-4 max-w-sm rounded-xl bg-black/30 px-4 py-3 font-mono text-lg font-bold tracking-[0.25em] text-emerald-300">{success.claimCode}</p>
            <p className="mt-3 text-xs text-emerald-100/60">
              Reference {success.orderNumber}. Product and standard shipping are complimentary — no payment details were collected.
              We emailed your confirmation. Check your inbox (and spam folder).
            </p>
            {st.referralEnabled && (
              <div className="mx-auto mt-5 max-w-md">
                <p className="text-sm font-bold text-white">Share Luxedge with a stylish friend</p>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/campaigns/${slug}?ref=${encodeURIComponent(success.claimCode)}`;
                    if (navigator.share) navigator.share({ title: fullTitle, url }).catch(() => {});
                    else { navigator.clipboard.writeText(url).then(() => setError('')).catch(() => {}); }
                  }}
                  className="mt-2 rounded-full bg-white px-5 py-2 text-xs font-bold text-gray-900"
                >Share a referral link</button>
                {st.referralEnabled && <p className="mt-1.5 text-[11px] text-emerald-100/50">Share and both of you are eligible for the campaign reward.</p>}
              </div>
            )}
            <Link to="/shop" className="mt-6 inline-block rounded-full bg-[#1E4636] px-6 py-2.5 text-xs font-bold text-white">Continue shopping</Link>
          </div>
        )}

        {phase.phase === 'open' && !success && (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* Claim form */}
            <div className="rounded-2xl bg-white p-6 shadow-2xl lg:col-span-2">
              <h2 className="text-base font-black text-gray-900">Claim your gift</h2>
              <p className="mt-1 text-xs text-gray-500">
                One complimentary gift per eligible person/household · real limited inventory · no payment required for $0 gifts.
              </p>
              <form onSubmit={submit} className="mt-4 space-y-3">
                <div>
                  <span className={labelCls}>Style preference</span>
                  <div className="flex flex-wrap gap-2">
                    {petTypes.map((p) => (
                      <button key={p} type="button" onClick={() => setPetType(p)}
                        className={`rounded-full px-4 py-2 text-xs font-bold capitalize transition ${petType === p ? 'bg-[#1E4636] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {p === 'women' ? "Women's" : p === 'men' ? "Men's" : p === 'accessories' ? 'Accessories' : p}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls} htmlFor="camp-fn">First name</label>
                  <input id="camp-fn" className={inputCls} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} autoComplete="given-name" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="camp-em">Email</label>
                  <input id="camp-em" type="email" className={inputCls} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} autoComplete="email" />
                </div>
                <label className="flex items-start gap-2 text-[11px] text-gray-500">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={form.marketing} onChange={(e) => setForm((f) => ({ ...f, marketing: e.target.checked }))} />
                  Send me occasional {NEWS_LABEL} (optional — your claim confirmation is sent regardless).
                </label>
                {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
                <button disabled={busy} className="w-full rounded-xl bg-[#1E4636] py-3.5 text-sm font-black text-white hover:bg-[#143023] disabled:opacity-50">
                  {busy ? 'Reserving…' : selected ? 'CLAIM THIS GIFT' : 'CLAIM MY GIFT'}
                </button>
                <p className="text-center text-[10px] text-gray-400">
                  ✓ No purchase required &nbsp;·&nbsp; ✓ No credit card for free gifts &nbsp;·&nbsp; ✓ One gift per household
                </p>
              </form>
            </div>

            {/* Eligible gifts */}
            <div className="lg:col-span-3">
              {totalGifts > 0 && (
                <p className="mb-3 text-xs text-blue-100/70">
                  <b className="text-emerald-300">{remainingGifts >= 0 ? `${remainingGifts} real gift${remainingGifts === 1 ? '' : 's'} remaining` : 'Real inventory — check availability'}</b> of {totalGifts}.
                </p>
              )}
              {eligible.length === 0 && (
                <div className="rounded-2xl bg-white/5 p-8 text-center ring-1 ring-white/10">
                  <p className="text-sm text-blue-100/80">A complimentary {st.giftName || 'Luxedge gift'} is reserved for every eligible pet owner — tell us about your pet to claim it.</p>
                </div>
              )}
              {eligible.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {eligible.map((p) => (
                    <button key={p.id} type="button" onClick={() => setSelected(selected === p.id ? null : p.id)}
                      className={`rounded-2xl p-3 text-left transition ring-1 ${selected === p.id ? 'bg-emerald-500/15 ring-emerald-400/60' : 'bg-white/5 ring-white/10 hover:ring-white/30'}`}>
                      {p.imageUrl && <img src={p.imageUrl} alt="" className="h-32 w-full rounded-xl object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                      <p className="mt-2 text-sm font-bold text-white">{p.name}</p>
                      <p className="mt-1 text-xs text-blue-100/70">
                        {p.tier === 'free' ? (
                          <><span className="text-emerald-300">FREE WITH GIFT CLAIM</span>{Number(p.priceCents) > 0 && <span className="text-blue-100/40 line-through"> · ${(p.priceCents / 100).toFixed(2)}</span>}</>
                        ) : (
                          <><span className="text-blue-200">Gift price ${(p.giftPriceCents / 100).toFixed(2)}</span><span className="text-blue-100/40 line-through"> · ${(p.priceCents / 100).toFixed(2)}</span></>
                        )}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
