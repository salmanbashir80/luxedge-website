// ============================================================================
// LUXEDGE V2 — ADMIN · AI CONTROL CENTER (Phase 4B amendment)
//
// One compact page where the owner decides how much control AI gets:
//   TOP:      AI SERVICES ON/OFF · CONTROL MODE · EMERGENCY PAUSE ·
//             COST STRATEGY · SECOND OPINION · TAKE MANUAL CONTROL
//   PROVIDERS:per-provider ON/OFF + configured + health + calls/failures today
//   FEATURES: per-feature AI switches (market intel, discovery, listing…)
//   ROUTING:  task → primary → fallback matrix
//   ATTENTION: owner attention queue (exceptions only)
//
// No fabricated statistics — every number is real (server configured list,
// decision-log rows). No secrets: provider keys are never present client-side.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  Pulse, Warning, Robot, CheckCircle, Cpu, ListChecks, Power, ArrowClockwise, ShieldCheck, ShieldWarning, XCircle,
} from '@phosphor-icons/react';
import { useApp } from '../App';
import { serverProviderStatus } from '../features/ai/client';
import SalmanOsPanel from './SalmanOsPanel';
import {
  AI_TASKS, CONTROL_MODES, COST_STRATEGIES, DEFAULT_MODEL_HELP, SECOND_OPINION_MODES,
  FEATURE_KEYS, FEATURE_LABELS, loadAiControlConfig, saveAiControlConfig,
  takeManualControl, resumeAiControl, loadAiRouterLog, clearAiRouterLog,
  callsToday, providerHealth, type AiControlConfig, type AiTask, type ProviderId,
} from '../features/scout/aiControl';
import { loadAttentionItems, resolveAttentionItem, setEmergencyPause } from '../features/scout/autonomy';

export default function AiControlCenter() {
  const { notify } = useApp();
  const [cfg, setCfg] = useState<AiControlConfig>(() => loadAiControlConfig());
  const [configured, setConfigured] = useState<string[]>([]);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [logVer, setLogVer] = useState(0);

  useEffect(() => {
    let alive = true;
    serverProviderStatus()
      .then((st) => {
        if (!alive) return;
        setConfigured(Array.isArray(st.providers) ? st.providers.filter((p) => p.configured).map((p) => p.id) : []);
      })
      .catch(() => { /* server endpoints not deployed — treat as none configured */ })
      .finally(() => alive && setStatusLoaded(true));
    return () => { alive = false; };
  }, []);

  const log = useMemo(() => loadAiRouterLog(), [logVer, cfg]);
  const refresh = () => setLogVer((v) => v + 1);

  const save = (next: AiControlConfig) => {
    saveAiControlConfig(next);
    setCfg(next);
    notify('AI Control settings saved');
  };

  // Emergency Pause must also write the canonical pause key
  // (luxedge_scout_emergency_pause) that the runtime AI gate reads via
  // isEmergencyPaused() — writing only the control config left the gate
  // unpaused and made the toggle an illusion. Under pause the AI gate
  // (aiGate) denies every AI provider call and every autonomous mutation;
  // only deterministic read-only research/analysis continues (it makes no
  // AI calls and performs no mutations).
  const togglePause = () => {
    const next = !cfg.emergencyPause;
    setEmergencyPause(next);
    save({ ...cfg, emergencyPause: next });
    notify(next ? 'EMERGENCY PAUSE ACTIVE — autonomous mutations blocked (research may continue)' : 'Emergency pause released');
  };

  const setProvider = (id: ProviderId, patch: Partial<{ enabled: boolean; dailyCallLimit: number }>) =>
    save({ ...cfg, providers: cfg.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const setFeature = (k: keyof AiControlConfig['features'], v: boolean) =>
    save({ ...cfg, features: { ...cfg.features, [k]: v } });

  const setRouting = (task: AiTask, key: 'primary' | 'fallback', v: ProviderId | 'none') =>
    save({
      ...cfg,
      routing: cfg.routing.map((r) =>
        r.task === task ? { ...r, [key]: v === 'none' ? null : v } : r
      ),
    });

  const manual = () => { takeManualControl(); setCfg(loadAiControlConfig()); notify('MANUAL CONTROL ENGAGED — autonomous AI actions stopped'); };
  const resume = (m: 'ASSISTED' | 'AUTONOMOUS') => { resumeAiControl(m); setCfg(loadAiControlConfig()); notify(`AI control resumed — ${m}`); };

  const aiOn = cfg.aiServicesOn && !cfg.emergencyPause;

  const seg = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${active ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;

  const toggle = (on: boolean) =>
    `relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-gray-300'}`;

  const knob = 'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ' + '';

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">AI Control Center</h1>
          <p className="text-[11px] text-gray-500">Decide how much control AI gets — 100% human, copilot, or guarded autonomous.</p>
        </div>
        <button onClick={refresh} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50">
          <ArrowClockwise size={12} /> Refresh
        </button>
      </div>

      {/* Status banner */}
      <div className={`rounded-xl p-3 border flex items-center gap-3 ${aiOn ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        {aiOn ? <CheckCircle size={18} className="text-green-600" /> : <Warning size={18} className="text-amber-600" />}
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900">{aiOn ? 'AI Services: ON' : 'AI Services: OFF — Manual operation active'}</p>
          <p className="text-[11px] text-gray-600">
            Control Mode: <b>{cfg.controlMode}</b> · Cost Strategy: <b>{cfg.costStrategy}</b> · Second Opinion: <b>{cfg.secondOpinion}</b>
            {cfg.emergencyPause && <span className="text-red-600 font-bold"> · EMERGENCY PAUSE ACTIVE</span>}
            {!statusLoaded ? '' : configured.length === 0 ? ' · No AI providers configured on server' : ` · ${configured.length} provider(s) configured`}
          </p>
        </div>
        <button onClick={manual} className="px-3 py-2 rounded-lg text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 shadow-sm flex items-center gap-1.5">
          <ShieldWarning size={12} /> TAKE MANUAL CONTROL
        </button>
        <button onClick={() => resume('ASSISTED')} disabled={cfg.controlMode === 'ASSISTED'} className="px-3 py-2 rounded-lg text-[11px] font-bold text-white bg-blue-500 hover:bg-blue-600 shadow-sm disabled:opacity-40">
          RESUME AI (ASSISTED)
        </button>
        <button onClick={() => resume('AUTONOMOUS')} disabled={cfg.controlMode === 'AUTONOMOUS'} className="px-3 py-2 rounded-lg text-[11px] font-bold text-white bg-indigo-500 hover:bg-indigo-600 shadow-sm disabled:opacity-40">
          RESUME AI (AUTO)
        </button>
      </div>

      {/* TOP controls */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 card-lift">
          <h2 className="font-bold text-xs text-gray-800 mb-3 flex items-center gap-1.5"><Power size={12} className="text-blue-500" />Master Switches</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800">AI SERVICES</p>
                <p className="text-[10px] text-gray-500">OFF = ZERO AI provider calls; deterministic scout keeps working</p>
              </div>
              <button onClick={() => save({ ...cfg, aiServicesOn: !cfg.aiServicesOn })} className={toggle(cfg.aiServicesOn)}>
                <span className={`${knob} ${cfg.aiServicesOn ? 'translate-x-4' : ''}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-semibold text-gray-800">EMERGENCY PAUSE</p>
                <p className="text-[10px] text-gray-500">Kill switch — blocks auto approvals, drafts, publishing, marketing</p>
              </div>
              <button onClick={togglePause} className={toggle(cfg.emergencyPause)}>
                <span className={`${knob} ${cfg.emergencyPause ? 'translate-x-4 bg-red-400' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 card-lift">
          <h2 className="font-bold text-xs text-gray-800 mb-3 flex items-center gap-1.5"><Cpu size={12} className="text-blue-500" />Control Mode · Cost · Second Opinion</h2>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold text-gray-600 mb-1">CONTROL MODE</p>
              <div className="flex gap-1.5">
                {CONTROL_MODES.map((m) => (
                  <button key={m} onClick={() => save({ ...cfg, controlMode: m })} className={seg(cfg.controlMode === m)}>{m}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-600 mb-1">COST STRATEGY</p>
              <div className="flex gap-1.5">
                {COST_STRATEGIES.map((s) => (
                  <button key={s} onClick={() => save({ ...cfg, costStrategy: s })} className={seg(cfg.costStrategy === s)}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-600 mb-1">SECOND OPINION</p>
              <div className="flex gap-1.5">
                {SECOND_OPINION_MODES.map((s) => (
                  <button key={s} onClick={() => save({ ...cfg, secondOpinion: s })} className={seg(cfg.secondOpinion === s)}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PROVIDERS */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden card-lift">
        <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between">
          <h2 className="font-bold text-xs text-gray-800 flex items-center gap-1.5"><Robot size={12} className="text-blue-500" />AI Providers</h2>
          <span className="text-[10px] text-gray-400">Keys stay server-side — toggling OFF never deletes configuration</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-2 font-semibold">Provider</th>
                <th className="px-2 py-2 font-semibold">Enabled</th>
                <th className="px-2 py-2 font-semibold">API</th>
                <th className="px-2 py-2 font-semibold">Health</th>
                <th className="px-2 py-2 font-semibold">Model</th>
                <th className="px-2 py-2 font-semibold">Cost rank</th>
                <th className="px-2 py-2 font-semibold">Calls today</th>
                <th className="px-2 py-2 font-semibold">Failures today</th>
              </tr>
            </thead>
            <tbody>
              {cfg.providers.map((p) => {
                const isCfg = configured.includes(p.id);
                const health = providerHealth(configured, p.id, log);
                const fails = log.filter((e) => e.provider === p.id && !e.ok && e.at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
                return (
                  <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 font-semibold text-gray-800">{p.name}</td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => setProvider(p.id, { enabled: !p.enabled })} className={toggle(p.enabled)}>
                        <span className={`${knob} ${p.enabled ? 'translate-x-4' : ''}`} />
                      </button>
                    </td>
                    <td className="px-2 py-2.5">{isCfg ? <span className="text-green-600 font-semibold">CONFIGURED</span> : <span className="text-gray-400">NOT CONFIGURED</span>}</td>
                    <td className="px-2 py-2.5">
                      {health === 'online' && <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle size={11} />ONLINE</span>}
                      {health === 'error' && <span className="inline-flex items-center gap-1 text-red-600"><XCircle size={11} />ERROR</span>}
                      {health === 'not_configured' && <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-gray-500">{DEFAULT_MODEL_HELP[p.id] || '—'}</td>
                    <td className="px-2 py-2.5 text-gray-500">{p.costRank}</td>
                    <td className="px-2 py-2.5">{callsToday(p.id, log)}</td>
                    <td className="px-2 py-2.5">{fails}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SALMAN OS / HERMES — AI BACKEND */}
      <SalmanOsPanel />

      {/* FEATURES + ROUTING */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 card-lift">
          <h2 className="font-bold text-xs text-gray-800 mb-3 flex items-center gap-1.5"><Pulse size={12} className="text-blue-500" />Feature-Level AI Switches</h2>
          <div className="space-y-2">
            {FEATURE_KEYS.map((k) => (
              <div key={k} className="flex items-center justify-between">
                <p className="text-[12px] text-gray-700">{FEATURE_LABELS[k]}</p>
                <button onClick={() => setFeature(k, !cfg.features[k])} className={toggle(cfg.features[k])}>
                  <span className={`${knob} ${cfg.features[k] ? 'translate-x-4' : ''}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 card-lift">
          <h2 className="font-bold text-xs text-gray-800 mb-3 flex items-center gap-1.5"><ListChecks size={12} className="text-blue-500" />Task Routing Matrix</h2>
          <div className="space-y-1.5">
            {AI_TASKS.map((t) => {
              const rule = cfg.routing.find((r) => r.task === t);
              const sel = () =>
                'px-2 py-1 rounded-md text-[11px] border border-gray-200 bg-white text-gray-700';
              return (
                <div key={t} className="flex items-center gap-2">
                  <span className="w-44 text-[11px] font-semibold text-gray-700 truncate">{t}</span>
                  <select value={rule?.primary || 'none'} onChange={(e) => setRouting(t, 'primary', e.target.value as ProviderId | 'none')} className={sel()}>
                    {cfg.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="none">— none —</option>
                  </select>
                  <span className="text-gray-400 text-[10px]">→</span>
                  <select value={rule?.fallback || 'none'} onChange={(e) => setRouting(t, 'fallback', e.target.value as ProviderId | 'none')} className={sel()}>
                    {cfg.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="none">— none —</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* OWNER ATTENTION */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 card-lift">
        <h2 className="font-bold text-xs text-gray-800 mb-3 flex items-center gap-1.5"><ShieldCheck size={12} className="text-amber-500" />Owner Attention Queue</h2>
        {(() => {
          const items = loadAttentionItems().filter((i) => i.status === 'pending');
          if (!items.length) return <p className="text-[11px] text-gray-400">No pending decisions — the queue only surfaces exceptions.</p>;
          return (
            <div className="space-y-2">
              {items.slice(0, 8).map((i) => (
                <div key={i.id} className="border border-gray-100 rounded-lg p-3 bg-amber-50/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-semibold text-gray-800">{i.title} — {i.reason}</p>
                      <p className="text-[11px] text-gray-600 mt-0.5"><b>Recommended:</b> {i.recommendedAction}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5"><b>Risk if ignored:</b> {i.riskIfIgnored}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{i.evidence}</p>
                    </div>
                    <button onClick={() => { resolveAttentionItem(i.id); setLogVer((v) => v + 1); notify('Attention item resolved'); }}
                      className="shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-600">
                      Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => { clearAiRouterLog(); setLogVer((v) => v + 1); notify('Router log cleared'); }}
            className="text-[10px] text-gray-400 hover:text-red-500 underline">
            Clear router decision log
          </button>
          <span className="text-[10px] text-gray-400">· {log.length} invocation{log.length === 1 ? '' : 's'} recorded (browser-local audit; never contains secrets)</span>
        </div>
      </div>
    </div>
  );
}
