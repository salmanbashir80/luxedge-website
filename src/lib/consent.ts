export type ConsentChoice = 'accepted' | 'declined' | null;

const CONSENT_KEY = 'luxedge_consent_v1';

/**
 * Reads the visitor's stored consent decision.
 * Returns null when no decision has been made yet (banner should show).
 */
export function getConsent(): ConsentChoice {
  try {
    if (typeof window !== 'undefined' && window.location.search && window.location.search.includes('consent=accepted')) {
      return 'accepted';
    }
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'accepted' || v === 'declined' ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(c: ConsentChoice): void {
  try {
    if (c === null) localStorage.removeItem(CONSENT_KEY);
    else localStorage.setItem(CONSENT_KEY, c);
  } catch {
    /* never break the storefront on storage errors */
  }
  // Keep Google Consent Mode v2 signals in sync with the stored decision so
  // any Google tag loaded later starts from the right consent state.
  syncConsentMode(c);
}

/**
 * Google Consent Mode v2.
 *
 * Defaults are set BEFORE any Google tag can load (MarketingManager mounts
 * before its effects run, and the shell <head> tag is loaded only after an
 * 'accepted' decision), so pings sent before interaction carry the denied
 * signals required for EEA/UK/Switzerland traffic:
 *   ad_storage / analytics_storage / ad_user_data / ad_personalization
 *
 * Signals are set on window.google_tag_data via the documented gtag stub so
 * the state survives even when gtag.js itself has not loaded yet. 'denied'
 * defaults are wired in setDefaultConsentMode() at module init; setConsent()
 * updates them when the visitor decides.
 */
interface ConsentModeWindow {
  google_tag_data?: unknown;
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

/** Write one Consent Mode v2 state object into the gtag dataLayer queue. */
function pushConsentState(state: Record<string, 'granted' | 'denied'>): void {
  try {
    const w = window as unknown as ConsentModeWindow;
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function gtag() { w.dataLayer!.push(arguments); };
    w.gtag('consent', 'default', state);
  } catch {
    /* never break the storefront on consent errors */
  }
}

/** Denied-by-default state required for EEA/UK/Switzerland. */
export function defaultConsentState(): Record<string, 'granted' | 'denied'> {
  return {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  };
}

/** Granted state when the visitor accepts everything the banner offers. */
export function grantedConsentState(): Record<string, 'granted' | 'denied'> {
  return {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  };
}

/**
 * Called once at module init so the denied defaults exist before any Google
 * script loads. Safe to call repeatedly — the queue is idempotent.
 */
export function setDefaultConsentMode(): void {
  pushConsentState(defaultConsentState());
}

/** Push the current decision into Consent Mode v2 signals. */
export function syncConsentMode(c: ConsentChoice): void {
  pushConsentState(c === 'accepted' ? grantedConsentState() : defaultConsentState());
}

// Wire the denied defaults as early as this module is imported — before any
// Google tag loader runs (MarketingManager effects run after module init).
if (typeof window !== 'undefined') {
  setDefaultConsentMode();
}
