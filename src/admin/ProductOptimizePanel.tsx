import { useRef, useState, useEffect } from 'react';
import { Sparkle, ArrowCounterClockwise } from '@phosphor-icons/react';
import type { CatalogProduct } from '../features/catalog/types';
import { callAIProvider } from '../features/ai/client';
import { loadAIProviders } from '../features/ai/providers';
import { getFreshAccessToken } from '../services/supabase';
import { generateValidatedOptimization, previousOptimizationFields, type OptimizationKind, type OptimizationPatch } from '../features/ai/productOptimization';
import { researchProductKeywords, type KeywordResearch } from '../features/ai/productResearch';

export default function ProductOptimizePanel({ product, category, kind, disabled, onSave }: {
  product: CatalogProduct; category: string; kind: OptimizationKind; disabled: boolean;
  onSave: (patch: OptimizationPatch, snapshot: CatalogProduct) => Promise<CatalogProduct>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [research, setResearch] = useState<KeywordResearch | null>(null);
  const [undo, setUndo] = useState<{ patch: OptimizationPatch; saved: CatalogProduct } | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const optimize = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    const snapshot = structuredClone(product);
    try {
      await getFreshAccessToken();
      let evidence: KeywordResearch | undefined;
      if (kind === 'seo') {
        setMessage('Checking real search evidence…');
        evidence = await researchProductKeywords(snapshot.name);
        if (!alive.current) return;
        setResearch(evidence);
      }
      const patch = await generateValidatedOptimization(snapshot, kind, category, evidence,
        prompt => {
          if (!alive.current) throw new Error('Editor closed. Nothing was saved.');
          return callAIProvider(prompt, loadAIProviders(), (m) => { if (alive.current) setMessage(m); }, 'Return factual JSON only. Product facts are the only authority for specifications.');
        }, () => { if (alive.current) setMessage('Response needs correction. Retrying validation once; nothing saved yet…'); });
      if (!alive.current) return; // navigation/tab switch cancels persistence
      setMessage(product.id ? 'Saving validated fields…' : 'Applying to your unsaved product…');
      const saved = await onSave(patch, snapshot);
      if (!alive.current) return;
      setUndo({ patch: previousOptimizationFields(snapshot, patch), saved });
      setMessage(product.id ? 'Optimized and saved. URLs, prices, images and publishing status are unchanged.' : 'Optimized in this form. Save the new product when ready; nothing has been published.');
    } catch (e) { if (alive.current) { setError((e as Error).message); setMessage(''); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const revert = async () => {
    if (!undo || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await onSave(undo.patch, undo.saved);
      setUndo(null); setMessage(product.id ? 'Previous fields restored and saved.' : 'Previous fields restored in this form.');
    } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3" aria-label={kind === 'seo' ? 'AI SEO optimization' : 'AI listing optimization'}>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-indigo-950">{kind === 'seo' ? 'Research-backed SEO' : 'Better product copy, one click'}</h3>
        <p className="mt-1 text-xs leading-relaxed text-indigo-800">{kind === 'seo' ? 'Checks search wording and available Google data, then improves the SEO title, meta description and keywords. No ranking guarantees.' : 'Improves the title, short description and full description from your existing product facts. No invented features or medical claims.'}</p>
        <p className="mt-1 text-xs text-indigo-800">{product.id ? 'Only these fields auto-save. Other unsaved edits stay in your form.' : 'New product: generated fields stay in the form until you save.'}</p>
      </div>
      <button type="button" onClick={() => void optimize()} disabled={busy || disabled || !product.name.trim() || product.status === 'safety_hold'} className="shrink-0 min-h-11 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 flex items-center justify-center gap-2">
        <Sparkle size={16} />{busy ? 'Working…' : kind === 'seo' ? (product.id ? 'Research, Optimize & Save' : 'Research & Optimize') : (product.id ? 'AI Optimize & Save' : 'AI Optimize')}
      </button>
    </div>
    {message && <p role="status" className="text-xs text-indigo-950 break-words">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {research && <details className="text-xs text-indigo-900">
      <summary className="cursor-pointer py-1 font-semibold">Research evidence · {new Date(research.observedAt).toLocaleString()}</summary>
      <p className="mt-2">Search results: {research.search.status === 'observed' ? `${research.search.source} · ${research.search.results.length} sources` : 'Unavailable — AI suggestions are not live keyword research'} · Google Ads metrics: {research.googleAds.status} · Google Trends: {research.googleTrends.status}</p>
      {research.search.results.map((r) => <a className="block py-1 underline break-words" key={r.url} href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>)}
      {research.googleAds.results.length > 0 && <pre className="mt-2 overflow-auto max-h-40 rounded bg-white p-2">{JSON.stringify(research.googleAds.results, null, 2)}</pre>}
      {research.googleTrends.evidence != null && <pre className="mt-2 overflow-auto max-h-40 rounded bg-white p-2">{JSON.stringify(research.googleTrends.evidence, null, 2)}</pre>}
    </details>}
    {undo && <button type="button" onClick={() => void revert()} disabled={busy || disabled} className="min-h-11 inline-flex items-center gap-2 text-sm font-semibold text-indigo-900 underline disabled:opacity-50"><ArrowCounterClockwise size={15} />Undo last optimization</button>}
  </section>;
}
