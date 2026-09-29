// ============================================================================
// LUXEDGE V2 — AUTH STORE (Supabase-backed)
//
// Single source of truth for the signed-in user. Sessions come from Supabase
// Auth (src/services/supabase.ts): access/refresh tokens persist in
// localStorage and survive refresh; expiry + refresh are handled there.
//
// SECURITY:
//  - No plaintext passwords anywhere. Passwords are sent once to Supabase and
//    never stored.
//  - The role claim comes from the signed JWT (app_metadata.role) — never
//    accepted from a user-supplied field.
//  - When Supabase is not configured, sign-in fails with an honest message;
//    there is NO demo admin password fallback.
// ============================================================================

import { create } from 'zustand';
import {
  type SbUser,
  signInWithPassword,
  signUp as sbSignUp,
  signOut as sbSignOut,
  getSession,
  onAuthStateChange,
  isSupabaseConfigured,
} from '../services/supabase';
import {
  buyerSignIn,
  buyerSignOut,
  buyerSignUp,
  buyerMe,
  buyerSignInMessage,
  type BuyerUser,
} from '../services/buyerAuth';
import { ensureCustomerProfile } from '../services/customer';

/** Map a Cloudflare/D1 buyer onto the store's user shape (role is never buyer-supplied). */
function toSbUser(user: BuyerUser): SbUser {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName || user.email.split('@')[0] || 'Customer',
    role: 'buyer',
  };
}

/** Fire-and-forget: keep a customers row in sync with the auth user. */
function syncCustomerProfile(user: SbUser | null): void {
  if (!user) return;
  void ensureCustomerProfile({ id: user.id, email: user.email, name: user.name }).then((r) => {
    if (!r.ok && r.reason !== 'not-provisioned') {
      // Honest, non-fatal: profile sync issues must never break sign-in.
      console.warn('[customer-sync]', r.reason, r.detail || '');
    }
  });
}

export interface AuthResult {
  success: boolean;
  message: string;
  user: SbUser | null;
}

interface AuthStore {
  user: SbUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** True once the initial session hydration finished (avoids flash-redirects). */
  ready: boolean;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  /** Buyer sign-in via the Cloudflare/D1 routes (cookie session, no JS token). */
  signInBuyer: (email: string, password: string) => Promise<AuthResult>;
  /** Buyer registration via the Cloudflare/D1 routes. */
  signUpBuyer: (name: string, email: string, password: string) => Promise<AuthResult>;
  /** Ends BOTH session kinds; each is a no-op when it does not apply. */
  signOutEverywhere: () => Promise<void>;
  signOut: () => Promise<void>;
  setSessionUser: (user: SbUser | null) => void;
}

let initialized = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(expiresAt?: number): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!expiresAt) return;
  // Refresh 2 minutes before expiry, or in 10s if already within 2 minutes
  const delay = Math.max(10_000, expiresAt - Date.now() - 120_000);
  refreshTimer = setTimeout(async () => {
    try {
      const refreshed = await getSession();
      if (refreshed) scheduleRefresh(refreshed.expiresAt);
    } catch {
      /* handled inside getSession */
    }
  }, delay);
}

export const useAuthStore = create<AuthStore>()((set) => ({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  ready: false,

  init: async () => {
    if (initialized) return;
    initialized = true;
    onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
        set({ user: null, isAuthenticated: false, isAdmin: false });
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const u = getSessionUserSync();
        applyUser(set, u);
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem('luxedge_sb_session') : null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { expiresAt?: number };
            if (parsed.expiresAt) scheduleRefresh(parsed.expiresAt);
          } catch { /* ignore */ }
        }
      }
    });

    if (typeof window !== 'undefined') {
      const onActivity = () => {
        if (document.visibilityState === 'visible') {
          void getSession().then((s) => {
            if (s) scheduleRefresh(s.expiresAt);
          });
        }
      };
      window.addEventListener('focus', onActivity);
      document.addEventListener('visibilitychange', onActivity);
    }

    const session = await getSession();
    applyUser(set, session?.user || null);
    if (session) {
      scheduleRefresh(session.expiresAt);
    } else {
      // No Supabase session (the admin path) — then this may be a buyer, whose
      // session is an HttpOnly cookie the page cannot read. The server is asked
      // who it is rather than the client guessing from storage.
      const buyer = await buyerMe();
      if (buyer) applyUser(set, toSbUser(buyer));
    }
    set({ ready: true });
  },

  signIn: async (email, password) => {
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        message: 'Sign-in is not configured yet (add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY). Guest checkout still works.',
        user: null,
      };
    }
    try {
      const session = await signInWithPassword(email.trim(), password);
      applyUser(set, session.user);
      scheduleRefresh(session.expiresAt);
      syncCustomerProfile(session.user);
      return { success: true, message: 'Signed in successfully.', user: session.user };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Sign-in failed.', user: null };
    }
  },

  signUp: async (name, email, password) => {
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        message: 'Account creation is not configured yet (add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY). Guest checkout still works.',
        user: null,
      };
    }
    try {
      const { session } = await sbSignUp(name.trim(), email.trim(), password);
      if (session) {
        applyUser(set, session.user);
        scheduleRefresh(session.expiresAt);
        syncCustomerProfile(session.user);
      }
      return {
        success: true,
        message: session ? 'Account created — you are signed in.' : 'Account created — check your email to confirm.',
        user: session?.user || null,
      };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Account creation failed.', user: null };
    }
  },

  /**
   * BUYER SIGN-IN — separate from admin sign-in on purpose.
   *
   * Buyers authenticate against the Cloudflare/D1 routes, which set an HttpOnly
   * cookie; the browser never sees a token and the password is never stored.
   * Admin sign-in keeps its existing verified-JWT path (signIn above) because
   * the admin role must keep coming from a verified server-side claim. The two
   * are never mixed, so a buyer session can never satisfy an admin check.
   */
  signInBuyer: async (email, password) => {
    try {
      const result = await buyerSignIn(email.trim(), password);
      if (!result.ok || !result.user) {
        return { success: false, message: buyerSignInMessage(result), user: null };
      }
      const buyer = toSbUser(result.user);
      applyUser(set, buyer);
      syncCustomerProfile(buyer);
      return { success: true, message: 'Signed in successfully.', user: buyer };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Sign-in failed.', user: null };
    }
  },

  signUpBuyer: async (name, email, password) => {
    try {
      const result = await buyerSignUp(email.trim(), password, name.trim());
      if (!result.ok || !result.user) {
        return { success: false, message: result.message || 'Account creation failed.', user: null };
      }
      const buyer = toSbUser(result.user);
      applyUser(set, buyer);
      syncCustomerProfile(buyer);
      // Stated honestly: no verification email is sent (there is no transactional
      // email provider), so the message must not claim one was.
      return {
        success: true,
        message: result.user.emailVerified
          ? 'Account created — you are signed in.'
          : 'Account created — you are signed in. We could not send a verification email, so your email is not yet confirmed.',
        user: buyer,
      };
    } catch (e) {
      return { success: false, message: (e as Error).message || 'Account creation failed.', user: null };
    }
  },

  signOut: async () => {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    await sbSignOut();
    set({ user: null, isAuthenticated: false, isAdmin: false });
  },

  signOutEverywhere: async () => {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    // Both are attempted: a buyer has no Supabase session and an admin has no
    // buyer cookie, and a failure in one must not leave the other alive.
    await Promise.all([
      buyerSignOut().catch(() => null),
      sbSignOut().catch(() => null),
    ]);
    set({ user: null, isAuthenticated: false, isAdmin: false });
  },

  setSessionUser: (user) => applyUser(set, user),
}));

function getSessionUserSync(): SbUser | null {
  // Avoid a circular import: read the raw stored session directly here.
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem('luxedge_sb_session') : null;
    if (!raw) return null;
    const s = JSON.parse(raw) as { user?: SbUser };
    return s.user || null;
  } catch {
    return null;
  }
}

function applyUser(
  set: (partial: Partial<AuthStore>) => void,
  user: SbUser | null
): void {
  set({
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
  });
}
