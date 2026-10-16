// ============================================================================
// LUXEDGE V2 — FLEXIBLE AI CONTROL (Phase 4B amendment)
//
// The owner decides how much control AI gets at any moment. Luxedge must work
// as 100% HUMAN CONTROL, HUMAN + AI COPILOT, or a GUARDED AUTONOMOUS SYSTEM
// without changing the underlying application architecture.
//
// Control plane (this module):
//   AI SERVICES        ON/OFF  — master switch. OFF = ZERO AI provider calls
//                                anywhere; deterministic scout still works.
//   CONTROL MODE       MANUAL / ASSISTED / AUTONOMOUS
//     MANUAL       — AI does nothing unless the owner explicitly requests it.
//     ASSISTED     — AI may research/analyze/recommend/draft/QA; important
//                    transitions wait for the owner.
//     AUTONOMOUS   — AI may execute allowed LOW-RISK steps per the autonomy
//                    policy. All hard gates/budgets/pause stay active.
//   EMERGENCY PAUSE   ACTIVE/INACTIVE — kill switch (shared with autonomy.ts).
//   COST STRATEGY     ECONOMY / BALANCED / QUALITY
//   SECOND OPINION    OFF / IMPORTANT ONLY / ALWAYS
//   PROVIDERS         per-provider ON/OFF + tasks + priority + daily limits
//   FEATURES          per-feature ON/OFF (market intel, discovery, listing…)
//   ROUTING           task → primary → fallback (configurable)
//
// Every AI invocation is recorded in the AI ROUTER DECISION LOG (task,
// provider, model, why selected, fallback used, fingerprint, time, result,
// control mode). NEVER logs secrets, prompts, or key material.
//
// SECURITY: provider calls remain SERVER-SIDE ONLY (via /api/ai/generate with
// the admin JWT). This module holds configuration + routing decisions only —
// no API keys ever reach the browser.
// ============================================================================

import { isEmergencyPaused, loadAutonomyConfig, saveAutonomyConfig } from './autonomy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ControlMode = 'MANUAL' | 'ASSISTED' | 'AUTONOMOUS';
export type CostStrategy = 'ECONOMY' | 'BALANCED' | 'QUALITY';
export type SecondOpinionMode = 'OFF' | 'IMPORTANT_ONLY' | 'ALWAYS';
export type ProviderId = 'deepseek' | 'anthropic' | 'openai' | 'openrouter' | 'gemini';

/** AI job/task types the router can be asked to perform. */
export type AiTask =
  | 'MARKET_INTELLIGENCE'
  | 'PRODUCT_DISCOVERY'
  | 'PRODUCT_ANALYSIS'
  | 'LISTING_GENERATE'
  | 'FACTUAL_QA'
  | 'SECOND_OPINION'
  | 'PRICING'
  | 'CREATIVE'
  | 'OPTIMIZATION';

export const AI_TASKS: AiTask[] = [
  'MARKET_INTELLIGENCE', 'PRODUCT_DISCOVERY', 'PRODUCT_ANALYSIS',
  'LISTING_GENERATE', 'FACTUAL_QA', 'SECOND_OPINION', 'PRICING', 'CREATIVE', 'OPTIMIZATION',
];

export const CONTROL_MODES: ControlMode[] = ['MANUAL', 'ASSISTED', 'AUTONOMOUS'];
export const COST_STRATEGIES: CostStrategy[] = ['ECONOMY', 'BALANCED', 'QUALITY'];
export const SECOND_OPINION_MODES: SecondOpinionMode[] = ['OFF', 'IMPORTANT_ONLY', 'ALWAYS'];

/** Per-provider control. Keys are never stored here — server-side only. */
export interface ProviderControl {
  id: ProviderId;
  name: string;
  /** Turning a provider OFF blocks ALL calls to it (config/key untouched). */
  enabled: boolean;
  /** Tasks this provider is allowed to handle. */
  tasks: AiTask[];
  /** Lower = preferred for ECONOMY routing (1 = cheapest). */
  costRank: number;
  /** 0 = unlimited. Enforced from the decision log (per day). */
  dailyCallLimit: number;
}

/** Feature-level AI switches — owner can keep parts on while others are off. */
export interface FeatureSwitch {
  marketIntelligence: boolean;
  discovery: boolean;
  analysis: boolean;
  listing: boolean;
  listingQa: boolean;
  pricing: boolean;
  creative: boolean;
  optimization: boolean;
}

export const FEATURE_KEYS: (keyof FeatureSwitch)[] = [
  'marketIntelligence', 'discovery', 'analysis', 'listing',
  'listingQa', 'pricing', 'creative', 'optimization',
];

export const FEATURE_LABELS: Record<keyof FeatureSwitch, string> = {
  marketIntelligence: 'Market Intelligence AI',
  discovery: 'Product Discovery AI',
  analysis: 'Product Analysis AI',
  listing: 'Listing Writer AI',
  listingQa: 'Listing QA AI',
  pricing: 'Pricing Intelligence AI',
  creative: 'Creative Planning AI',
  optimization: 'Sales Optimization AI',
};

/** Task → primary → fallback routing rule (configurable). */
export interface RoutingRule {
  task: AiTask;
  primary: ProviderId | null;
  fallback: ProviderId | null;
}

export interface AiControlConfig {
  /** MASTER AI SERVICES switch. OFF = zero AI provider calls. */
  aiServicesOn: boolean;
  controlMode: ControlMode;
  /** Shared kill switch — blocks ALL auto AI mutations. */
  emergencyPause: boolean;
  costStrategy: CostStrategy;
  secondOpinion: SecondOpinionMode;
  providers: ProviderControl[];
  features: FeatureSwitch;
  routing: RoutingRule[];
  /** Score-point difference at which a second opinion counts as disagreement. */
  disagreementThreshold: number;
}

/** One recorded AI router invocation (audit trail, no secrets). */
export interface AiRouterLogEntry {
  id: string;
  at: string;
  task: AiTask;
  controlMode: ControlMode;
  provider: string | null;
  model: string | null;
  /** Why this provider was selected (cost strategy, routing rule, fallback). */
  why: string;
  fallbackUsed: boolean;
  /** Evidence fingerprint when available (cost-control dedupe). */
  fingerprint: string | null;
  ok: boolean;
  /** Short result summary — never the full prompt or output. */
  resultSummary: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Defaults — SAFE STARTING CONFIGURATION (Phase 4B amendment §15)
// ---------------------------------------------------------------------------

export const DEFAULT_AI_CONTROL_CONFIG: AiControlConfig = {
  aiServicesOn: true,
  controlMode: 'ASSISTED',
  emergencyPause: false,
  costStrategy: 'BALANCED',
  secondOpinion: 'IMPORTANT_ONLY',
  providers: [
    { id: 'openrouter', name: 'OpenRouter', enabled: true, tasks: [...AI_TASKS], costRank: 1, dailyCallLimit: 0 },
    { id: 'deepseek', name: 'DeepSeek', enabled: false, tasks: [...AI_TASKS], costRank: 2, dailyCallLimit: 0 },
    { id: 'openai', name: 'OpenAI', enabled: false, tasks: [...AI_TASKS], costRank: 3, dailyCallLimit: 0 },
    { id: 'gemini', name: 'Google Gemini', enabled: false, tasks: [...AI_TASKS], costRank: 4, dailyCallLimit: 0 },
    { id: 'anthropic', name: 'Anthropic Claude', enabled: false, tasks: [...AI_TASKS], costRank: 5, dailyCallLimit: 0 },
  ],
  features: {
    marketIntelligence: true,
    discovery: true,
    analysis: true,
    listing: true,
    listingQa: true,
    pricing: true,
    creative: true,
    optimization: true,
  },
  routing: [
    { task: 'MARKET_INTELLIGENCE', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'PRODUCT_ANALYSIS', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'LISTING_GENERATE', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'FACTUAL_QA', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'SECOND_OPINION', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'PRODUCT_DISCOVERY', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'PRICING', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'CREATIVE', primary: 'openrouter', fallback: 'openrouter' },
    { task: 'OPTIMIZATION', primary: 'openrouter', fallback: 'openrouter' },
  ],
  disagreementThreshold: 10,
};

// ---------------------------------------------------------------------------
// Config persistence (localStorage, admin-only UI, no secrets)
// ---------------------------------------------------------------------------

const CONFIG_KEY = 'luxedge_ai_control';

export function loadAiControlConfig(storage?: Pick<Storage, 'getItem'>): AiControlConfig {
  const base: AiControlConfig = {
    ...DEFAULT_AI_CONTROL_CONFIG,
    providers: DEFAULT_AI_CONTROL_CONFIG.providers.map((p) => ({ ...p, tasks: [...p.tasks] })),
    features: { ...DEFAULT_AI_CONTROL_CONFIG.features },
    routing: DEFAULT_AI_CONTROL_CONFIG.routing.map((r) => ({ ...r })),
    emergencyPause: isEmergencyPaused(storage),
  };
  try {
    const raw = (storage || window.localStorage).getItem(CONFIG_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<AiControlConfig>;
    // Migrate the previous shipped default control (openrouter disabled,
    // deepseek primary) so Product Scout AI routes through OpenRouter after an
    // upgrade. Configs where the owner already enabled OpenRouter are kept as-is.
    const orCtl = Array.isArray(parsed.providers) ? parsed.providers.find((p) => p.id === 'openrouter') : undefined;
    const oldShippedDefault = !!orCtl && orCtl.enabled === false;
    const providers = Array.isArray(parsed.providers) && parsed.providers.length
      ? base.providers.map((def) => {
          const p = parsed.providers!.find((x) => x.id === def.id);
          if (!p) return def;
          const mergedP = { ...def, ...p, tasks: Array.isArray(p.tasks) && p.tasks.length ? p.tasks : [...def.tasks] };
          if (oldShippedDefault) {
            if (mergedP.id === 'openrouter') return { ...mergedP, enabled: true, costRank: 1 };
            if (mergedP.id === 'deepseek') return { ...mergedP, enabled: true, costRank: 2 };
          }
          return mergedP;
        })
      : base.providers;
    const routing = Array.isArray(parsed.routing) && parsed.routing.length
      ? (oldShippedDefault
          ? parsed.routing.map((r) => ({ task: r.task, primary: 'openrouter' as ProviderId, fallback: 'deepseek' as ProviderId }))
          : parsed.routing)
      : base.routing;
    return {
      ...base,
      ...parsed,
      emergencyPause: base.emergencyPause,
      providers,
      features: parsed.features ? { ...base.features, ...parsed.features } : base.features,
      routing,
    };
  } catch {
    return base;
  }
}

export function saveAiControlConfig(cfg: AiControlConfig, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage || window.localStorage).setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Owner override — TAKE MANUAL CONTROL / RESUME AI CONTROL (§7)
// ---------------------------------------------------------------------------

/**
 * TAKE MANUAL CONTROL: stop new autonomous actions, preserve all state and
 * evidence, block new AI-driven mutations, switch CONTROL MODE → MANUAL and
 * the autonomy policy → MANUAL. Safe in-flight read-only analysis may finish.
 */
export function takeManualControl(storage?: Pick<Storage, 'getItem' | 'setItem'>): AiControlConfig {
  const cfg = loadAiControlConfig(storage);
  const next = { ...cfg, controlMode: 'MANUAL' as ControlMode };
  saveAiControlConfig(next, storage);
  // Also drop the autonomy policy to MANUAL so no candidate auto-advances.
  try {
    saveAutonomyConfig({ ...loadAutonomyConfig(storage), mode: 'MANUAL' }, storage);
  } catch { /* ignore */ }
  return next;
}

/** RESUME AI CONTROL — owner returns to ASSISTED or AUTONOMOUS. */
export function resumeAiControl(mode: 'ASSISTED' | 'AUTONOMOUS', storage?: Pick<Storage, 'getItem' | 'setItem'>): AiControlConfig {
  const cfg = loadAiControlConfig(storage);
  const next = { ...cfg, controlMode: mode };
  saveAiControlConfig(next, storage);
  try {
    saveAutonomyConfig({ ...loadAutonomyConfig(storage), mode: mode === 'AUTONOMOUS' ? 'AUTO' : 'REVIEW' }, storage);
  } catch { /* ignore */ }
  return next;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/** Is the AI layer allowed to act for this task at all? */
export function aiGate(config: AiControlConfig, task: AiTask, opts?: { explicit?: boolean }): { allow: boolean; reason: string } {
  if (config.emergencyPause) return { allow: false, reason: 'EMERGENCY PAUSE ACTIVE — autonomous AI actions blocked' };
  if (!config.aiServicesOn) return { allow: false, reason: 'AI Services OFF — manual operation active' };
  const feature = FEATURE_TO_TASK[task];
  if (feature && !config.features[feature]) return { allow: false, reason: `Feature AI OFF: ${FEATURE_LABELS[feature]}` };
  if (config.controlMode === 'MANUAL' && !opts?.explicit) {
    return { allow: false, reason: 'Control mode MANUAL — AI acts only when explicitly requested' };
  }
  if (config.controlMode === 'AUTONOMOUS' && opts?.explicit === false) {
    // AUTONOMOUS allows implicit low-risk actions by design.
  }
  return { allow: true, reason: `Control mode ${config.controlMode}` };
}

const FEATURE_TO_TASK: Partial<Record<AiTask, keyof FeatureSwitch>> = {
  MARKET_INTELLIGENCE: 'marketIntelligence',
  PRODUCT_DISCOVERY: 'discovery',
  PRODUCT_ANALYSIS: 'analysis',
  LISTING_GENERATE: 'listing',
  FACTUAL_QA: 'listingQa',
  PRICING: 'pricing',
  CREATIVE: 'creative',
  OPTIMIZATION: 'optimization',
};

// ---------------------------------------------------------------------------
// Provider selection — cost-first routing (§5, §11, §12)
// ---------------------------------------------------------------------------

export interface ProviderSelection {
  provider: ProviderId;
  name: string;
  model: string;
  why: string;
  secondOpinion?: { provider: ProviderId; name: string; model: string; why: string };
}

/** Models used by the router (server validates them against the allowlist). */
export const DEFAULT_MODEL_HELP: Record<ProviderId, string> = {
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  openrouter: 'nvidia/nemotron-3-super-120b-a12b:free',
  gemini: 'gemini-3.5-flash',
};

/** Premium model used under QUALITY strategy for important decisions. */
const PREMIUM_MODEL: Record<ProviderId, string> = {
  deepseek: 'deepseek-reasoner',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  openrouter: 'openrouter/free',
  gemini: 'gemini-3.5-flash',
};

/** Count of AI calls a provider made today (from the decision log). */
export function callsToday(providerId: string, log?: AiRouterLogEntry[]): number {
  const entries = log || loadAiRouterLog();
  const today = new Date().toISOString().slice(0, 10);
  return entries.filter((e) => e.provider === providerId && e.at.slice(0, 10) === today).length;
}

/**
 * Select the provider for a task. Deterministic-first, then cheapest capable
 * provider (ECONOMY), routing matrix (BALANCED), or premium-for-important
 * (QUALITY). Skips providers that are disabled, unconfigured, not allowed for
 * the task, or over their daily call limit.
 */
export function selectProvider(
  config: AiControlConfig,
  task: AiTask,
  configured: string[],
  opts?: { important?: boolean; log?: AiRouterLogEntry[]; explicit?: boolean }
): ProviderSelection | null {
  const gate = aiGate(config, task, { explicit: opts?.explicit });
  if (!gate.allow) return null;

  const usable = config.providers.filter((p) =>
    p.enabled &&
    configured.includes(p.id) &&
    p.tasks.includes(task) &&
    (p.dailyCallLimit <= 0 || callsToday(p.id, opts?.log) < p.dailyCallLimit)
  );
  if (!usable.length) return null;

  const providerOf = (id: ProviderId | null): ProviderControl | null => usable.find((p) => p.id === id) || null;

  let chosen: ProviderControl | null = null;
  let why = '';

  if (config.costStrategy === 'ECONOMY') {
    chosen = [...usable].sort((a, b) => a.costRank - b.costRank)[0];
    why = `ECONOMY — cheapest capable provider (${chosen.name})`;
  } else {
    const rule = config.routing.find((r) => r.task === task);
    chosen = rule ? providerOf(rule.primary) || providerOf(rule.fallback) || usable[0] : usable[0];
    why = rule
      ? (providerOf(rule.primary) === chosen
          ? `BALANCED/QUALITY — routing primary ${chosen.name}`
          : providerOf(rule.fallback) === chosen
            ? `BALANCED/QUALITY — routing fallback ${chosen.name} (primary unavailable)`
            : `BALANCED/QUALITY — ${chosen.name} (no routing match)`)
      : `BALANCED/QUALITY — ${chosen.name}`;
  }
  if (!chosen) return null;

  const premium = config.costStrategy === 'QUALITY' && opts?.important === true;
  const model = premium ? PREMIUM_MODEL[chosen.id] : DEFAULT_MODEL_HELP[chosen.id];

  const sel: ProviderSelection = { provider: chosen.id, name: chosen.name, model, why };

  // SECOND OPINION (§6): an extra provider only when justified.
  const soMode = config.secondOpinion;
  if (opts?.important && (soMode === 'ALWAYS' || soMode === 'IMPORTANT_ONLY')) {
    const others = usable.filter((p) => p.id !== chosen!.id);
    // The second opinion must be a DIFFERENT provider than the primary — a
    // routing rule whose primary/fallback resolves to the chosen provider is
    // skipped so the extra opinion adds real signal instead of re-running the
    // same model.
    const soRule = config.routing.find((r) => r.task === 'SECOND_OPINION');
    const so = soRule
      ? (() => {
          const soPrimary = providerOf(soRule.primary);
          if (soPrimary && soPrimary.id !== chosen!.id) return soPrimary;
          const soFallback = providerOf(soRule.fallback);
          if (soFallback && soFallback.id !== chosen!.id) return soFallback;
          return others[0] || null;
        })()
      : others[0] || null;
    if (so) {
      sel.secondOpinion = {
        provider: so.id,
        name: so.name,
        model: DEFAULT_MODEL_HELP[so.id],
        why: `SECOND OPINION (${soMode}) — ${so.name} verifies the primary decision`,
      };
    }
  }

  return sel;
}

// ---------------------------------------------------------------------------
// AI ROUTER DECISION LOG (§10) — durable audit, NEVER secrets
// ---------------------------------------------------------------------------

const LOG_KEY = 'luxedge_ai_router_log';
const MAX_LOG = 200;

export function loadAiRouterLog(storage?: Pick<Storage, 'getItem'>): AiRouterLogEntry[] {
  try {
    const raw = (storage || window.localStorage).getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as AiRouterLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendAiRouterLog(entry: AiRouterLogEntry, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  try {
    const s = storage || window.localStorage;
    const cur = loadAiRouterLog(s);
    s.setItem(LOG_KEY, JSON.stringify([entry, ...cur].slice(0, MAX_LOG)));
  } catch { /* ignore */ }
}

export function clearAiRouterLog(storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  try {
    (storage || window.localStorage).setItem(LOG_KEY, JSON.stringify([]));
  } catch { /* ignore */ }
}

/** Per-provider health from the server's configured list + last router outcome. */
export type ProviderHealth = 'online' | 'offline' | 'error' | 'not_configured';

export function providerHealth(configured: string[], providerId: string, log?: AiRouterLogEntry[]): ProviderHealth {
  if (!configured.includes(providerId)) return 'not_configured';
  const entries = (log || loadAiRouterLog()).filter((e) => e.provider === providerId);
  if (!entries.length) return 'online';
  return entries[0].ok ? 'online' : 'error';
}

/**
 * Sanitize an error message before it enters the log — never allow anything
 * that looks like a key/token to be persisted.
 */
export function scrubLogError(err: string): string {
  return err
    .replace(/\b(sk|key|token|secret)[-_][A-Za-z0-9_\-]{6,}\b/gi, 'REDACTED')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+\b/gi, 'REDACTED')
    .replace(/\b(sk-[A-Za-z0-9]{8,})\b/gi, 'REDACTED')
    .slice(0, 200);
}
