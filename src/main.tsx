import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { scrubLegacySecrets } from "./features/ai/providers";
import { useAuthStore } from "./store/authStore";

// Remove any legacy provider keys / scraping tokens that older builds may
// have left in localStorage. Runs before the app renders.
scrubLegacySecrets();

// Hydrate the Supabase session (access/refresh tokens persisted in
// localStorage) so a page refresh keeps the admin/customer signed in.
void useAuthStore.getState().init();

// Installable-app service worker — production/https only, and deliberately
// conservative (see public/sw.js): hashed assets cache-first, page
// navigations network-first, and /admin + /api/* are NEVER intercepted or
// cached so private/authenticated data stays live.
if (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  import.meta.env.PROD &&
  window.location.protocol.startsWith('https')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => { /* offline installability only — never fatal */ });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
