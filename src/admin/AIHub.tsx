import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Key, Robot, Sparkle } from '@phosphor-icons/react';
import { getFreshAccessToken } from '../services/supabase';
import { serverTestProviderResult } from '../features/ai/client';
import { loadAIProviders, loadProviderSettings, resolveProviderChain, saveAIProviders, saveProviderSettings } from '../features/ai/providers';
import type { AIProvider } from '../features/ai/types';

interface KeyStatus { id: string; configured: boolean; source: 'env' | 'attached' | 'none' }
const input = 'w-full min-w-0 min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500';
const button = 'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';

export default function AIHub() {
  const [providers, setProviders] = useState(loadAIProviders);
  const [routing, setRouting] = useState(loadProviderSettings);
  const [selected, setSelected] = useState(() => loadProviderSettings().defaultProviderId);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<KeyStatus[] | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const provider = providers.find(p => p.id === selected) || providers[0];
  const current = resolveProviderChain(providers, routing).primary;
  const keyStatus = status?.find(p => p.id === provider.id);

  const request = async (body?: unknown) => {
    const token = await getFreshAccessToken();
    const r = await fetch('/api/admin/ai-keys', { method: body ? 'POST' : 'GET', headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'Could not read AI configuration. Sign in as admin.');
    return d;
  };
  const refresh = async () => {
    const d = await request();
    setStatus(Array.isArray(d.providers) ? d.providers.map((p: KeyStatus) => ({ id: p.id, configured: p.configured, source: p.source })) : []);
  };
  useEffect(() => { void refresh().catch(() => setError('Cannot verify provider configuration. Sign in as admin and refresh.')); }, []);

  const runTest = async () => {
    setBusy(true); setError(''); setNotice('Testing the selected model through the secure server…');
    try {
      await getFreshAccessToken();
      const result = await serverTestProviderResult(provider.id, provider.defaultModel);
      setTests(prev => ({ ...prev, [provider.id]: result }));
      setNotice(result.ok ? 'Test passed. You can now choose “Use across website”.' : '');
      if (!result.ok) setError(result.message || 'Provider test failed. Existing configuration is unchanged.');
      await refresh();
    } catch (e) { setError((e as Error).message); setNotice(''); }
    finally { setBusy(false); }
  };
  const attach = async () => {
    if (key.trim().length < 8) { setError('Enter a complete provider API key.'); return; }
    if (keyStatus?.configured && !window.confirm(`Save a new attached key for ${provider.name}? The existing deployment key is preserved and keeps priority.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const d = await request({ action: 'set', provider: provider.id, key: key.trim() });
      if (!d.ok) throw new Error('The server did not confirm the key was saved.');
      setKey(''); setTests(prev => { const next = { ...prev }; delete next[provider.id]; return next; });
      await refresh();
      setNotice(keyStatus?.source === 'env' ? 'Attached key saved as a fallback. Existing deployment key remains active. Test checks the active deployment key.' : 'Key saved securely. Press Test connection before using it.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const useProvider = () => {
    if (!tests[provider.id]?.ok) return;
    const next: AIProvider[] = providers.map(p => ({ ...p, enabled: p.id === provider.id ? true : p.enabled, isDefault: p.id === provider.id }));
    const settings = { ...routing, defaultProviderId: provider.id, fallbackProviderId: routing.fallbackProviderId === provider.id ? null : routing.fallbackProviderId };
    saveAIProviders(next); saveProviderSettings(settings);
    setProviders(next); setRouting(settings);
    setNotice(`${provider.name} selected for shared AI tools on this admin browser. Existing keys are unchanged.`);
  };
  const changeModel = (model: string) => {
    setProviders(prev => prev.map(p => p.id === provider.id ? { ...p, defaultModel: model } : p));
    setTests(prev => { const next = { ...prev }; delete next[provider.id]; return next; });
  };

  return <div className="max-w-4xl space-y-5">
    <header><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700"><Robot size={17} />Luxedge AI</p><h1 className="mt-2 text-2xl font-bold text-gray-950">One connection. Your AI tools.</h1><p className="mt-2 text-sm text-gray-600">Connect a provider, test it, then use it for product copy, SEO and campaign drafts. Your working keys stay untouched.</p></header>
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-gray-600">Selected shared provider</p><p className="mt-1 font-semibold text-gray-950">{current?.name || 'No provider selected'}</p><p className="mt-1 text-xs text-gray-600 break-all">{current?.defaultModel}</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800">{status === null ? 'Checking keys…' : `${status.filter(s => s.configured).length} providers configured`}</span></div>
      <p className="mt-3 text-xs text-gray-600">Configured means a key exists—not that its quota/model works. A successful test proves the connection.</p>
    </section>
    <section className="rounded-xl border border-indigo-200 bg-white p-5 space-y-4" aria-label="Connect AI provider">
      <h2 className="font-semibold text-gray-950">1. Choose provider & model</h2>
      <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-700">Provider<select className={input + ' mt-1'} value={provider.id} disabled={busy} onChange={e => { setSelected(e.target.value); setKey(''); setNotice(''); setError(''); }}>{providers.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label className="text-xs font-semibold text-gray-700">Model<select className={input + ' mt-1'} disabled={busy} value={provider.defaultModel} onChange={e => changeModel(e.target.value)}>{provider.models.map(m => <option value={m} key={m}>{m}</option>)}</select></label></div>
      <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700 flex items-start gap-2"><Key size={15} className="shrink-0" /><span>{keyStatus?.configured ? `Existing key configured (${keyStatus.source === 'env' ? 'deployment binding' : 'owner-attached'}). Leave the key field empty to keep it.` : status === null ? 'Connection status has not been verified yet.' : 'No key configured for this provider.'}</span></div>
      <h2 className="font-semibold text-gray-950">2. Add a key only if needed</h2>
      <label className="block text-xs font-semibold text-gray-700">Provider API key<input className={input + ' mt-1'} name="ai-provider-api-key" type="password" autoComplete="new-password" value={key} disabled={busy} onChange={e => setKey(e.target.value)} placeholder="Leave blank to preserve the existing key" /></label>
      <p className="text-xs text-gray-600">New keys travel only to Luxedge’s protected admin endpoint and are stored server-side. Never stored in localStorage or shown again. Deployment keys always keep priority.</p>
      <div className="flex flex-wrap gap-2"><button className={button + ' bg-gray-900 text-white hover:bg-gray-800'} disabled={busy || key.trim().length < 8} onClick={() => void attach()}>Save key securely</button><button className={button + ' border border-gray-300 hover:bg-gray-50'} disabled={busy} onClick={() => void runTest()}>Test connection</button><button className={button + ' bg-indigo-600 text-white hover:bg-indigo-700'} disabled={busy || !tests[provider.id]?.ok} onClick={useProvider}>Use across website</button></div>
      {notice && <p role="status" className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-950">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {tests[provider.id]?.ok && <p className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle size={17} />Connection verified in this session</p>}
      <details className="border-t border-gray-100 pt-3 text-sm"><summary className="cursor-pointer font-semibold text-gray-800">Advanced routing</summary><label className="block mt-3 text-xs font-semibold text-gray-700">Fallback provider (only when primary fails)<select className={input + ' mt-1'} value={routing.fallbackProviderId || ''} onChange={e => { const next = { ...routing, fallbackProviderId: e.target.value || null }; saveProviderSettings(next); setRouting(next); }}><option value="">None — do not enable extra providers automatically</option>{providers.filter(p => p.enabled && p.id !== routing.defaultProviderId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="mt-2 text-xs text-gray-600">Routing/model selection is saved on this admin browser. Provider keys are shared server-side.</p></details>
    </section>
    <section className="grid sm:grid-cols-3 gap-3" aria-label="AI tools">{[
      ['/admin/products', 'Product copy & SEO', 'Open a product → General or SEO → Optimize & Save.'],
      ['/admin/campaigns', 'Campaigns', 'Prepare campaign copy, preview, then publish manually.'],
      ['/admin/marketing', 'Marketing studio', 'Generate content using the same shared AI provider.'],
    ].map(([url, title, desc]) => <Link key={url} to={url} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500"><Sparkle size={18} className="text-indigo-600" /><h2 className="mt-3 font-semibold text-sm text-gray-950">{title}</h2><p className="mt-2 text-xs leading-relaxed text-gray-600">{desc}</p></Link>)}</section>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">AI generation and live SEO data are separate connections. SEO research shows actual search sources and available Google Ads/Trends evidence. Missing data stays unavailable; an AI key does not automatically unlock Google metrics. AI cannot guarantee rankings or AdSense approval.</p>
  </div>;
}
