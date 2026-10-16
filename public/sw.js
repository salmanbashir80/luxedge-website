/* ============================================================================
 * LUXEDGE SERVICE WORKER — conservative by design.
 *
 * What it does:
 *   - Cache-first only for immutable hashed build assets (/assets/*-hash.*).
 *     This is the one truly safe long-lived cache: filenames change per build.
 *   - Network-first for storefront page navigations (HTML), with an offline
 *     fallback to the last cached shell. No stale page is ever served when
 *     the network works.
 *
 * What it deliberately NEVER touches (security / freshness):
 *   - Any /api/* request (checkout, orders, admin endpoints, ai, uploads).
 *   - Any cross-origin request (Supabase REST, image CDNs, ads, analytics).
 *   - Admin pages (/admin/*): always fetched from the network, never cached,
 *     never served offline — auth/session and private data stay live and are
 *     never written into the cache.
 *   - Non-GET requests.
 *
 * This worker is for app-shell installability + fast repeat loads. It makes
 * no assumption that a cached copy is the truth for anything dynamic.
 * ============================================================================
 */
const SHELL_CACHE = 'luxedge-shell-v3';
const ASSET_CACHE = 'luxedge-assets-v3';

self.addEventListener('install', (event) => {
  // Precache the root shell so offline fallback is ALWAYS available
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await cache.add(new Request('/', { cache: 'reload' }));
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => (k.startsWith('luxedge-') && k !== SHELL_CACHE && k !== ASSET_CACHE))
          .map((k) => caches.delete(k)),
      );
    } catch (_) {}
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept cross-origin traffic (Supabase, CDNs, ads, analytics).
  if (url.origin !== self.location.origin) return;

  // Never intercept www. subdomain navigations — let the browser natively
  // follow Cloudflare's 301 redirect to apex luxedge.us.
  if (url.hostname.startsWith('www.')) return;

  const path = url.pathname;

  // Admin + API + other private/dynamic endpoints: network only, never cached.
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/') || path.startsWith('/admin-manifest')) {
    return; // let the browser fetch normally — no interception, no caching
  }

  // Immutable hashed assets: cache-first (they are versioned by filename).
  if (path.startsWith('/assets/')) {
    event.respondWith(assetStrategy(req));
    return;
  }

  // Page navigations: network-first with resilient offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(navStrategy(req));
  }
});

async function assetStrategy(req) {
  let cache;
  try {
    cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
  } catch (_) {}

  try {
    const res = await fetch(req);
    if (res && res.ok && cache) {
      try {
        cache.put(req, res.clone()).catch(() => {});
      } catch (_) {}
    }
    return res;
  } catch (err) {
    if (cache) {
      try {
        const fallback = await cache.match(req);
        if (fallback) return fallback;
      } catch (_) {}
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reconnecting — Luxedge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #FAF7F2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1c1917;
      padding: 24px;
    }
    .card {
      background: #ffffff;
      border: 1px solid #ECE6DC;
      border-radius: 20px;
      padding: 40px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 30px rgba(28,25,23,0.06);
    }
    .brand {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.15em;
      color: #1E4636;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #ECE6DC;
      border-top-color: #1E4636;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #1c1917;
      margin-bottom: 10px;
    }
    p {
      font-size: 14px;
      color: #78716c;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 13px 24px;
      background: #1E4636;
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 9999px;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #153227;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">Luxedge</div>
    <div class="spinner"></div>
    <h1>Reconnecting to Luxedge</h1>
    <p>Please check your connection. We are automatically trying to reconnect you to the live store.</p>
    <button class="btn" onclick="window.location.reload()">Reload Store</button>
  </div>
  <script>
    window.addEventListener('online', function() { window.location.reload(); });
    setTimeout(function() { window.location.reload(); }, 2500);
  </script>
</body>
</html>`;

async function navStrategy(req) {
  let cache;
  try {
    cache = await caches.open(SHELL_CACHE);
  } catch (_) {}

  // 1. Try standard network fetch
  let res;
  try {
    res = await fetch(req);
  } catch (netErr) {
    // If req had redirect: 'manual' or cross-origin redirect glitch, retry cleanly
    try {
      res = await fetch(req.url, { redirect: 'follow' });
    } catch (_) {}
  }

  // If network answered, return it! Never let cache errors block network responses.
  if (res && (res.ok || res.type === 'opaqueredirect' || res.status < 400)) {
    if (res.ok && cache) {
      try {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
          cache.put(req, res.clone()).catch(() => {});
        }
      } catch (_) {}
    }
    return res;
  }

  // 2. If network completely failed, check offline cache
  if (cache) {
    try {
      const hit = (await cache.match(req)) || (await cache.match('/'));
      if (hit) return hit;
    } catch (_) {}
  }

  // 3. Fallback: Friendly auto-reconnecting recovery page (never raw 503 text)
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
