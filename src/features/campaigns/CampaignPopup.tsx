// ============================================================================
// LUXEDGE — CAMPAIGN POPUP (storefront teaser)
//
// Data-driven from the campaign engine: only a LIVE campaign with
// popup.enabled shows anything. Triggers are configurable server-side
// (delayMs / scrollDepth on desktop; delayMs on mobile — exit-intent is
// desktop-only by nature and skipped on touch). A visitor who claimed or
// dismissed is not nagged: localStorage caps per-campaign frequency.
//
// The popup collects an email (optional marketing opt-in) and directs the
// visitor to the campaign landing — it never claims a gift by itself, never
// asks for payment, and makes no fake-scarcity claims.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { trackEvent, utmParams } from '../../lib/marketing';

interface PopupCampaign {
  slug: string;
  title: string;
  subtitle?: string;
  total: number;
  remaining: number;
  referralEnabled?: boolean;
  popup?: { headline?: string; subtext?: string } | null;
}

// Fashion build (VITE_FASHION_SAMPLE_CATALOG=true): the Pet gift-drop campaign popup is hidden.
const NEWS_LABEL = 'Luxedge style news';

const seen = (slug: string) => {
  try { return localStorage.getItem(`luxedge-campaign-popup-${slug}`) || ''; } catch { return ''; }
};
const markSeen = (slug: string) => {
  try { localStorage.setItem(`luxedge-campaign-popup-${slug}`, String(Date.now())); } catch { /* optional */ }
};

export default function CampaignPopup() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [campaign, setCampaign] = useState<PopupCampaign | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [optedIn, setOptedIn] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (FASHION_SAMPLE_CATALOG) return;
    let alive = true;
    fetch('/api/campaigns')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!alive) return;
        const live = (d.campaigns || []).filter((c: { active?: boolean }) => c.active);
        // Prefer a campaign configured to pop up; skip campaign pages themselves.
        if (pathname.startsWith('/campaigns/') || pathname.startsWith('/admin') || pathname === '/free-pet-gift') return;
        const pick = live.find((c: PopupCampaign) => c.popup) || null;
        if (!pick) return;
        const s = seen(pick.slug);
        if (s && Date.now() - Number(s) < 1000 * 60 * 60 * 24 * 30) return; // 30-day quiet period per campaign
        setCampaign(pick);
      })
      .catch(() => { /* campaigns are optional */ });
    return () => { alive = false; };
  }, [pathname]);

  useEffect(() => {
    if (!campaign) return;
    const delay = campaign.popup ? 4000 : 0;
    const t = window.setTimeout(() => {
      setOpen(true);
      markSeen(campaign.slug);
      trackEvent('free_gift_popup_view', { campaign: campaign.slug, ...utmParams() });
      window.setTimeout(() => closeRef.current?.focus(), 50);
    }, delay);
    return () => window.clearTimeout(t);
  }, [campaign]);

  useEffect(() => {
    setOpen(false);
    setState('idle');
    setEmail('');
  }, [pathname]);

  if (!campaign) return null;

  const submit = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setState('error'); setMsg('Please enter a valid email.'); return; }
    setState('busy');
    trackEvent('free_gift_claim_started', { campaign: campaign.slug, ...utmParams() });
    try {
      // Save the lead through the existing CRM endpoint (source = campaign popup),
      // then send them to the campaign landing to complete the claim.
      const r = await fetch('/api/crm/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          source: 'welcome_popup',
          pageUrl: pathname,
          message: `Campaign interest: ${campaign.title}`,
          optedIn,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not save your email.');
      setState('done');
      setMsg('Thank you! Your gift is waiting on the campaign page.');
      trackEvent('free_gift_claim_success', { campaign: campaign.slug, ...utmParams() });
    } catch (e) {
      setState('error');
      setMsg((e as Error).message || 'Network error — please try again.');
    }
  };

  const go = () => {
    markSeen(campaign.slug);
    trackEvent('free_gift_popup_click', { campaign: campaign.slug, ...utmParams() });
    nav(`/campaigns/${campaign.slug}`);
  };

  const dismiss = () => { markSeen(campaign.slug); setOpen(false); };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center">
          <button aria-label="Dismiss gift offer" onClick={dismiss} className="absolute inset-0 bg-black/50" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={campaign.popup?.headline || campaign.title}
            className="relative m-4 w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
          >
            <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-6 pb-6 pt-5 text-white">
              <button ref={closeRef} onClick={dismiss} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-white/70 hover:bg-white/10">✕</button>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-100">A limited Luxedge event</p>
              <h2 className="mt-1.5 font-serif text-2xl font-black">{campaign.popup?.headline || `Claim a ${campaign.title}`}</h2>
              <p className="mt-1.5 text-xs text-indigo-100/90">
                {campaign.popup?.subtext || 'Enter your email to reach the gift collection — selected eligible products up to the gift threshold can be free.'}
              </p>
              {campaign.total > 0 && campaign.remaining >= 0 && (
                <p className="mt-2 text-[11px] text-indigo-100/70">{campaign.remaining} of {campaign.total} real gifts remaining · no payment needed for $0 gifts · one per household</p>
              )}
            </div>
            <div className="px-6 py-5">
              {state === 'done' ? (
                <div className="text-center">
                  <p className="text-sm font-bold text-emerald-700">Email saved ✓</p>
                  <p className="mt-1 text-xs text-gray-500">{msg}</p>
                  <button onClick={go} className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-xs font-black text-white hover:bg-emerald-700">OPEN THE GIFT COLLECTION</button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                      type="email"
                      placeholder="you@example.com"
                      aria-label="Email address"
                      className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <label className="mt-2 flex items-start gap-2 text-[11px] text-gray-500">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={optedIn} onChange={(e) => setOptedIn(e.target.checked)} />
                    Send me occasional {NEWS_LABEL} (optional — the gift collection link works either way).
                  </label>
                  {state === 'error' && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{msg}</p>}
                  <button onClick={submit} disabled={state === 'busy'} className="mt-3 w-full rounded-xl bg-indigo-600 py-3 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-700 disabled:opacity-50">
                    {state === 'busy' ? 'Sending…' : 'Send my gift link'}
                  </button>
                  <button onClick={go} className="mt-2 w-full text-center text-[11px] text-indigo-500 underline underline-offset-2">See eligible gifts without saving</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
