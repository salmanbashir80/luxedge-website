// ============================================================================
// LUXEDGE — Cloudflare Workers entry
//
// Runs the existing Vercel-style api/* handlers (`handler(req, res)` with
// `sendJson`/`sendText`/`readJsonBody` from api/_lib/providers.ts) on the
// Cloudflare runtime by adapting Request → a minimal IncomingMessage shim and
// building a Response from a minimal ServerResponse shim. Static assets (the
// Vite build in dist/) are served through the ASSETS binding with SPA
// fallback configured in wrangler.toml.
//
// No secret is ever handled here: handlers read process.env bindings exactly
// as they do on Vercel.
// ============================================================================
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import fetchPageHandler from '../api/fetch-page';
import aiStatusHandler from '../api/ai/status';
import aiGenerateHandler from '../api/ai/generate';
import aiTestHandler from '../api/ai/test';
import aiCreditsHandler from '../api/ai/openrouter-credits';
import importImagesHandler from '../api/import-images';
import uploadImageHandler from '../api/upload-image';
import checkoutHandler from '../api/checkout';
import checkoutOnsiteHandler, { verifyHandler as checkoutVerifyHandler } from '../api/checkout-onsite';
import webhookHandler from '../api/webhook';
import shippoHandler from '../api/shippo';
import salmanOsHandler from '../api/salman-os';
import cjHandler from '../api/suppliers/cj';
import adminProductsHandler from '../api/admin/products';
import hermesIngestHandler from '../api/hermes/ingest';
import marketIntelTrendsHandler from '../api/market-intel/trends';
import googleAdsHandler from '../api/market-demand/google-ads';
import omnisendStatusHandler from '../api/omnisend/status';
import emailSendHandler from '../api/email/send';
import emailStatusHandler from '../api/email/status';
import emailRoutesHandler from '../api/email/routes';
import emailContactHandler from '../api/email/contact';
import mediaGenerateHandler from '../api/media/generate';
import mediaSyncHandler, { runMediaSync } from '../api/media/sync';
import { runSitemapHealth } from './sitemap-health';
import mediaStatusHandler from '../api/media/status';
import crmWelcomeHandler from '../api/crm/welcome';
import crmSubscribeHandler from '../api/crm/subscribe';
import { withSecurityHeaders } from './seo-meta';
import { productSlugRedirects } from '../src/content/productSlugHistory';
import { isBlogPublic } from '../src/content/reviewHolds';
import { CATEGORY_CONTENT } from '../src/content/categoryContent';
import crmLeadHandler from '../api/crm/lead';
import crmListHandler from '../api/crm/list';
import crmAssistantHandler from '../api/crm/assistant';
import cjKeyHandler from '../api/admin/cj-key';
import paymentKeysHandler from '../api/admin/payment-keys';
import erpHandler from '../api/admin/erp';
import paymentsHandler from '../api/admin/payments';
import webhookSquareHandler from '../api/webhook-square';
import webhookPaypalHandler from '../api/webhook-paypal';
import webhookBraintreeHandler from '../api/webhook-braintree';
import productStatsHandler from '../api/admin/product-stats';
import blogStatsHandler from '../api/admin/blog-stats';
import mediaStatsHandler from '../api/admin/media-stats';
import autoListHandler from '../api/admin/auto-list';
import tableColumnsHandler from '../api/admin/table-columns';
import salesHandler from '../api/admin/sales';
import giftDropAdminHandler from '../api/admin/gift-drop';
import { stateHandler as giftDropStateHandler, claimHandler as giftDropClaimHandler } from '../api/gift-drop';
import campaignsAdminHandler from '../api/admin/campaigns';
import {
  listHandler as campaignsListHandler,
  stateHandler as campaignsStateHandler,
  claimHandler as campaignsClaimHandler,
} from '../api/campaigns';
import merchStatsHandler, { recomputeMerchStats } from '../api/merch-stats';
import aiKeysHandler from '../api/admin/ai-keys';
import googleFeedHandler from '../api/google-feed';
import imgProxyHandler from '../api/img-proxy';
import { maybeInjectSeo } from './seo-meta';
import { buildSitemap, buildEmergencyStaticSitemap } from './sitemap';
import { setDataRuntime } from './d1/runtime';
import buyerAuthHandler from '../api/auth/index';
import adminBuyersHandler from '../api/admin/buyers';
import { handleDbApi } from './db-api';
import blogAutomationHandler from '../api/blog-automation/index';
import adsenseHandler, { setAdSenseRuntimeBindings } from '../api/adsense/index';

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Shape of the ServerResponse shim produced by makeRes(). */
interface ShimRes extends ServerResponse {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
  _chunks: Uint8Array[];
}

interface Route {
  path: string;
  handler: NodeHandler;
}

const ROUTES: Route[] = [
  { path: '/api/ai/status', handler: aiStatusHandler },
  { path: '/api/ai/generate', handler: aiGenerateHandler },
  { path: '/api/ai/test', handler: aiTestHandler },
  { path: '/api/ai/openrouter-credits', handler: aiCreditsHandler },
  { path: '/api/fetch-page', handler: fetchPageHandler },
  { path: '/api/import-images', handler: importImagesHandler },
  { path: '/api/upload-image', handler: uploadImageHandler },
  { path: '/api/checkout', handler: checkoutHandler },
  { path: '/api/checkout/onsite', handler: checkoutOnsiteHandler },
  { path: '/api/checkout/verify', handler: checkoutVerifyHandler },
  { path: '/api/webhook', handler: webhookHandler },
  { path: '/api/shippo', handler: shippoHandler },
  { path: '/api/salman-os', handler: salmanOsHandler },
  { path: '/api/suppliers/cj', handler: cjHandler },
  { path: '/api/hermes/ingest', handler: hermesIngestHandler },
  { path: '/api/market-demand/google-ads', handler: googleAdsHandler },
  { path: '/api/omnisend/status', handler: omnisendStatusHandler },
  { path: '/api/email/send', handler: emailSendHandler },
  { path: '/api/email/status', handler: emailStatusHandler },
  { path: '/api/email/routes', handler: emailRoutesHandler },
  { path: '/api/email/contact', handler: emailContactHandler },
  { path: '/api/media/generate', handler: mediaGenerateHandler },
  { path: '/api/media/sync', handler: mediaSyncHandler },
  { path: '/api/media/status', handler: mediaStatusHandler },
  { path: '/api/crm/welcome', handler: crmWelcomeHandler },
  { path: '/api/crm/subscribe', handler: crmSubscribeHandler },
  { path: '/api/crm/lead', handler: crmLeadHandler },
  { path: '/api/crm/list', handler: crmListHandler },
  { path: '/api/crm/assistant', handler: crmAssistantHandler },
  { path: '/api/admin/cj-key', handler: cjKeyHandler },
  { path: '/api/admin/payment-keys', handler: paymentKeysHandler },
  { path: '/api/admin/erp', handler: erpHandler },
  { path: '/api/admin/payments', handler: paymentsHandler },
  { path: '/api/admin/product-stats', handler: productStatsHandler },
  { path: '/api/admin/ai-keys', handler: aiKeysHandler },
  { path: '/api/admin/blog-stats', handler: blogStatsHandler },
  { path: '/api/admin/media-stats', handler: mediaStatsHandler },
  { path: '/api/admin/auto-list', handler: autoListHandler },
  { path: '/api/admin/table-columns', handler: tableColumnsHandler },
  { path: '/api/admin/sales', handler: salesHandler },
  { path: '/api/merch-stats', handler: merchStatsHandler },
  { path: '/api/gift-drop/state', handler: giftDropStateHandler },
  { path: '/api/gift-drop/claim', handler: giftDropClaimHandler },
  { path: '/api/admin/gift-drop', handler: giftDropAdminHandler },
  { path: '/api/campaigns', handler: campaignsListHandler },
  { path: '/api/campaigns/state', handler: campaignsStateHandler },
  { path: '/api/campaigns/claim', handler: campaignsClaimHandler },
  { path: '/api/admin/campaigns', handler: campaignsAdminHandler },
  { path: '/api/webhook/square', handler: webhookSquareHandler },
  { path: '/api/webhook/paypal', handler: webhookPaypalHandler },
  { path: '/api/webhook/braintree', handler: webhookBraintreeHandler },
  { path: '/api/admin/products', handler: adminProductsHandler },
  { path: '/google-products.xml', handler: googleFeedHandler },
  { path: '/api/img-proxy', handler: imgProxyHandler },
];

/**
 * Minimal IncomingMessage shim: EventEmitter + method/url/headers/socket + body events.
 *
 * The body is buffered and delivered exactly like a Node stream in paused mode:
 * 'data' then 'end' are only emitted once a listener is attached. Handlers call
 * readJsonBody AFTER an await (e.g. requireAdmin does a network call), so the
 * body must not be emitted before the handler subscribes — otherwise the
 * pending readJsonBody never resolves and the Worker hangs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(request: Request, url: URL): IncomingMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req: any = new EventEmitter();
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.headers = {};
  request.headers.forEach((value, key) => {
    req.headers[key.toLowerCase()] = value;
  });
  req.socket = {
    remoteAddress: request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '',
  };
  req.destroy = () => undefined;

  let bodyReady = false;
  let bodyEmitted = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bodyBuffer: any = Buffer.alloc(0);
  const emitBody = () => {
    if (bodyEmitted) return;
    bodyEmitted = true;
    if (bodyBuffer.length > 0) req.emit('data', bodyBuffer);
    // Defer 'end' so listeners attached synchronously after 'data' (as
    // readJsonBody does) are registered before it fires — real Node streams
    // never emit 'end' before the consumer has subscribed.
    queueMicrotask(() => req.emit('end'));
  };
  request
    .arrayBuffer()
    .then((buf) => {
      bodyBuffer = Buffer.from(buf);
      bodyReady = true;
      // If the handler already subscribed (listener attached before the body
      // arrived), deliver now.
      if (req.listenerCount('data') > 0 || req.listenerCount('end') > 0) emitBody();
    })
    .catch((err) => req.emit('error', err));
  const origOn = req.on.bind(req);
  req.on = (event: string, fn: (...args: unknown[]) => void) => {
    const result = origOn(event, fn);
    if ((event === 'data' || event === 'end') && bodyReady) emitBody();
    return result;
  };
  return req as IncomingMessage;
}

/** Minimal ServerResponse shim capturing statusCode/headers/body. */
function makeRes(): ServerResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    _chunks: [] as Uint8Array[],
    statusCode: 200,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v);
        }
      }
    },
    setHeader(name: string, value: string) {
      res._headers[String(name).toLowerCase()] = String(value);
    },
    write(chunk: string | Uint8Array) {
      if (typeof chunk === 'string') res._body += chunk;
      else res._chunks.push(chunk);
    },
    end(chunk?: string | Uint8Array) {
      if (chunk !== undefined && chunk !== null) {
        if (typeof chunk === 'string') res._body += chunk;
        else res._chunks.push(chunk);
      }
    },
  };
  Object.defineProperty(res, 'statusCode', {
    get: () => res._status,
    set: (v: number) => {
      res._status = v;
    },
    enumerable: true,
    configurable: true,
  });
  return res as ServerResponse;
}

interface AssetsFetcher {
  fetch(input: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsFetcher;
  /** CJ supplier credential — a Cloudflare secret binding, never client-side. */
  CJ_API_KEY?: string;
  /** YouTube Data API key — a Cloudflare secret binding (wrangler secret put). */
  YOUTUBE_API_KEY?: string;
  /** Stripe keys — Cloudflare secret bindings (wrangler secret put). Never client-side. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Public Stripe publishable key (pk_…) — safe for the browser; needed by
   *  the on-site PaymentElement checkout. Cloudflare var, not a secret. */
  STRIPE_PUBLISHABLE_KEY?: string;
  /** Shippo token (server-only) + ship-from address for live rates. */
  SHIPPO_API_KEY?: string;
  SHIPPO_FROM_NAME?: string;
  SHIPPO_FROM_ADDRESS?: string;
  SHIPPO_FROM_CITY?: string;
  SHIPPO_FROM_STATE?: string;
  SHIPPO_FROM_ZIP?: string;
  GOOGLE_ADSENSE_CLIENT_ID?: string;
  GOOGLE_ADSENSE_CLIENT_SECRET?: string;
  SEND_MAIL?: {
    send: (msg: { from: string; to: string; subject: string; html?: string; text?: string; reply_to?: string }) => Promise<void>;
  };
  /** Alert recipient for the nightly sitemap health check (defaults to hello@luxedge.us). */
  SITEMAP_ALERT_EMAIL?: string;
}

/**
 * Retired public paths → the canonical URL that replaced them.
 *
 * These are legacy aliases that real traffic still uses (the storefront footer
 * linked /shipping before /shipping-policy became the canonical route, so Google
 * was recording a 404 for every footer click). Each entry gets a permanent
 * redirect so the old URL merges into the canonical one instead of dead-ending.
 * This is deliberately NOT a catch-all: only a path with a genuinely equivalent
 * replacement belongs here, and deleted content must keep returning 404/410.
 */
const LEGACY_PATH_REDIRECTS: Record<string, string> = {
  '/shipping': '/shipping-policy',
  // The owner-facing "shipping & returns" URL people type and link to. The
  // store publishes /shipping-policy and /returns as separate substantial
  // pages, so this is an alias into the returns policy rather than a third,
  // overlapping policy page.
  '/shipping-returns': '/returns',
  // Supplier-feed product slugs → the clean Luxedge slug that replaced them
  // (src/content/productSlugHistory.ts). These URLs were indexed and are in
  // bookmarks, so they must merge rather than 404 — and an internal link that
  // still points at one must resolve in a single hop, not show up in the crawl
  // audit as a redirected link.
  ...productSlugRedirects(),
};

/**
 * WordPress-era URL shapes this domain still gets crawled for. All of them 301
 * to the homepage: every target was retired with the old site, and answering
 * them with a 404 leaves them in the index as soft errors.
 *
 * /category is the one shape that needs care — the storefront publishes its
 * real categories under the same prefix, so ONLY a slug we do not publish is
 * treated as legacy. The live list comes from the category content module,
 * which is the same set the storefront and the sitemap render from.
 */
const LEGACY_WP_PREFIXES = ['/wp-content', '/wp-includes', '/wp-admin', '/tag', '/trendings'];
const LIVE_CATEGORY_SLUGS = new Set(Object.keys(CATEGORY_CONTENT));

function legacyWordPressRedirect(pathname: string, search: string): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (LEGACY_WP_PREFIXES.some((p) => clean === p || clean.startsWith(`${p}/`))) return '/';
  if (clean === '/category') return '/';
  if (clean.startsWith('/category/')) {
    const slug = clean.slice('/category/'.length);
    if (slug && !LIVE_CATEGORY_SLUGS.has(slug)) return '/';
  }
  // WordPress post/attachment permalinks: /?p=123, /index.php?page_id=9, /feed.
  if ((clean === '/' || clean === '/index.php') && /[?&](p|page_id|attachment_id)=\d+/.test(search)) return '/';
  if (clean === '/index.php' || clean === '/feed') return '/';
  return null;
}

/**
 * The API modules were originally written for a Node/Vercel runtime and read
 * configuration from process.env. Cloudflare provides bindings on `env` per
 * request, so expose string bindings to those compatible handlers without
 * replacing the process.env object or serialising non-string bindings.
 */
function populateProcessEnv(env: Env): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') process.env[key] ??= value;
  }
}

/** All routing logic — the exported fetch wraps this so every response
 * passes through withSecurityHeaders exactly once. */
async function handleRequest(request: Request, env: Env): Promise<Response> {
    populateProcessEnv(env);
    // Secret bindings are not guaranteed to be enumerable in every Worker
    // runtime. CJ/Stripe server handlers read process.env, so preserve these
    // explicitly instead of silently reporting configured keys as missing.
    if (env.CJ_API_KEY) process.env.CJ_API_KEY = env.CJ_API_KEY;
    if (env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
    if (env.STRIPE_WEBHOOK_SECRET) process.env.STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
    if (env.STRIPE_PUBLISHABLE_KEY) process.env.STRIPE_PUBLISHABLE_KEY = env.STRIPE_PUBLISHABLE_KEY;
    if (env.SHIPPO_API_KEY) process.env.SHIPPO_API_KEY = env.SHIPPO_API_KEY;
    if (env.SHIPPO_FROM_NAME) process.env.SHIPPO_FROM_NAME = env.SHIPPO_FROM_NAME;
    if (env.SHIPPO_FROM_ADDRESS) process.env.SHIPPO_FROM_ADDRESS = env.SHIPPO_FROM_ADDRESS;
    if (env.SHIPPO_FROM_CITY) process.env.SHIPPO_FROM_CITY = env.SHIPPO_FROM_CITY;
    if (env.SHIPPO_FROM_STATE) process.env.SHIPPO_FROM_STATE = env.SHIPPO_FROM_STATE;
    if (env.SHIPPO_FROM_ZIP) process.env.SHIPPO_FROM_ZIP = env.SHIPPO_FROM_ZIP;
    const url = new URL(request.url);
    // Canonical host + scheme: www and HTTP must permanently redirect to the
    // non-www HTTPS apex, preserving the full path+query. Prevents a
    // duplicate-host index (Google was indexing www.luxedge.us as a separate
    // site) and a mixed-content/HTTP duplicate.
    const host = (url.hostname || '').toLowerCase();
    const needsRedirect = host === 'www.luxedge.us' || url.protocol === 'http:';
    if (needsRedirect) {
      const target = new URL(url.pathname + url.search, 'https://luxedge.us');
      // Preserve the hash is not possible server-side (browsers strip it),
      // but path+query are fully retained.
      return Response.redirect(target.toString(), 301);
    }
    // Consolidate the duplicate /home homepage (Google has indexed both /
    // and /home/) into a single canonical URL with a permanent redirect.
    if (url.pathname === '/home' || url.pathname === '/home/') {
      return Response.redirect(new URL('/', url.origin).toString(), 301);
    }
    // Legacy path aliases (see LEGACY_PATH_REDIRECTS). Trailing slashes are
    // normalised first so /shipping and /shipping/ resolve identically.
    const legacyTarget = LEGACY_PATH_REDIRECTS[url.pathname.replace(/\/+$/, '') || '/'];
    if (legacyTarget) {
      return Response.redirect(new URL(legacyTarget + url.search, url.origin).toString(), 301);
    }
    // Legacy WordPress shapes (see legacyWordPressRedirect). The query string is
    // dropped deliberately: /?p=123 must land on / WITHOUT ?p=123, or the
    // redirect would match itself forever.
    const wpTarget = legacyWordPressRedirect(url.pathname, url.search);
    if (wpTarget) return Response.redirect(new URL(wpTarget, url.origin).toString(), 301);
    // Dynamic sitemap from the LIVE database (CMS blogs + products + categories)
    // so publishing updates sitemap.xml without a redeploy. Media is noindexed
    // and deliberately absent from all sitemap feeds.
    // A database outage must not resurrect stale/deleted URLs from a snapshot.
    if (url.pathname === '/sitemap.xml') {
      const sitemap = await buildSitemap();
      if (sitemap) {
        return new Response(sitemap, {
          status: 200,
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, max-age=300',
            // Diagnostic only — never secrets, never internal error detail.
            'x-luxedge-sitemap-mode': 'dynamic',
          },
        });
      }
      // Database unavailable (e.g. Supabase quota/pause). Fail open to a
      // MINIMAL, always-true feed instead of withdrawing the site from
      // crawling with a 503: only confirmed static, non-database pages ship
      // here — no /shop, no /blog, no /category/*, no /product/*, and never
      // the snapshot public/sitemap.xml (stale DB-derived URLs). Withheld
      // URLs stay unpublishable until the live feed recovers.
      return new Response(buildEmergencyStaticSitemap(), {
        status: 200,
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          // Emergency mode may flip back to dynamic (and grow) within minutes
          // of recovery — do not let caches pin the reduced feed.
          'cache-control': 'public, max-age=60',
          'x-luxedge-sitemap-mode': 'emergency',
        },
      });
    }
    if (url.pathname === '/video-sitemap.xml') {
      return new Response('Video sitemap retired.', { status: 410, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    }
    // Public allowlisted storefront reads served from D1 (see worker/db-api.ts).
    // Read-only, projection-limited and same-origin — the $0 replacement for the
    // browser's direct Supabase PostgREST calls.
    if (url.pathname.startsWith('/api/db/')) {
      return handleDbApi(request, url);
    }
    // Buyer authentication (Cloudflare/D1 native). Supabase Auth is restricted
    // by the project-wide HTTP 402, so sign-in was impossible; these routes are
    // routed by path prefix because there are several sub-routes and they must
    // be able to set (and clear) the HttpOnly session cookie. Admin auth is NOT
    // touched — it keeps its own verified-JWT guard.
    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await buyerAuthHandler(req, res);
      } catch {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    // Admin-issued one-time buyer activation/reset codes (requireAdmin-guarded).
    if (url.pathname === '/api/admin/buyers' || url.pathname.startsWith('/api/admin/buyers/')) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await adminBuyersHandler(req, res);
      } catch {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    // Google AdSense earnings API (server-side). Routed by path prefix
    // because it has multiple sub-routes (status/auth/oauth/sync/earnings).
    if (url.pathname.startsWith('/api/adsense')) {
      // Cloudflare bindings can be non-enumerable, so pass OAuth bindings
      // explicitly instead of relying on Object.entries(env).
      setAdSenseRuntimeBindings({
        GOOGLE_ADSENSE_CLIENT_ID: env.GOOGLE_ADSENSE_CLIENT_ID,
        GOOGLE_ADSENSE_CLIENT_SECRET: env.GOOGLE_ADSENSE_CLIENT_SECRET,
      });
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await adsenseHandler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    // Market intelligence API (server-side, admin-JWT). Routed by path prefix
    // because it has multiple sub-routes (trends jobs: list/claim/result).
    if (url.pathname.startsWith('/api/market-intel')) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await marketIntelTrendsHandler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    // Blog automation API (server-side, blog-scoped). Routed by path prefix
    // because it has multiple sub-routes (draft/publish/posts/check-slug/{id}).
    if (url.pathname.startsWith('/blog-automation')) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await blogAutomationHandler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType = res._headers['content-type'] || 'text/plain; charset=utf-8';
      return new Response(res._body || '', { status: res._status, headers: { ...res._headers, 'content-type': contentType } });
    }
    const route = ROUTES.find((r) => r.path === url.pathname);
    if (route) {
      const req = makeReq(request, url) as IncomingMessage & { env?: Env };
      // Attach runtime bindings so api/* handlers (Vercel-style, env-less)
      // can reach worker bindings such as the send_email SEND_MAIL binding.
      req.env = env;
      const res = makeRes() as ShimRes;
      try {
        await route.handler(req, res);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const contentType =
        res._headers['content-type'] || 'text/plain; charset=utf-8';
      // Binary payloads (image proxy) must be returned as bytes — the string
      // `_body` path corrupts them.
      let body: BodyInit = res._body || '';
      if (res._chunks.length > 0) {
        const total = res._chunks.reduce((n: number, c: Uint8Array) => n + c.byteLength, 0);
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of res._chunks) {
          buf.set(c, off);
          off += c.byteLength;
        }
        body = buf;
      }
      return new Response(body, {
        status: res._status,
        headers: { ...res._headers, 'content-type': contentType },
      });
    }
    // Everything else → static assets, with an explicit SPA fallback so
    // client-side routes (/admin, /product/:slug, …) serve index.html.
    // Crawlers get per-route server-side SEO meta injected into the shell
    // (title/description/canonical/JSON-LD) so Google can index each page
    // with its real title instead of the generic one.
    if (url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    const lastSeg = url.pathname.split('/').filter(Boolean).pop() || '';
    const isFileLike = lastSeg.includes('.');
    if (isFileLike) {
      const assetRes = await env.ASSETS.fetch(request);
      // Hashed chunks are versioned by filename, so a miss can only mean a
      // STALE shell is referencing a chunk that was removed in a deploy.
      // Never answer it with the SPA shell (200 + HTML) and never cache the
      // miss: a browser would try to parse HTML as a module, React never
      // boots, and the page hangs on the SSR article text. A real 404 makes
      // the stale load fail fast; the next fresh page load references live
      // chunks and recovers. no-store also stops Cloudflare from caching
      // HTML under a .js URL (observed: immutable 1-year HIT on old chunks).
      const assetContentType = assetRes.headers.get('content-type') || '';
      // A hashed /assets/* file is NEVER legitimately HTML. Cloudflare may
      // still serve the previously-poisoned edge cache entry (200 + HTML,
      // cached immutable) for an old chunk URL after a deploy, so guard on
      // content-type, not just status — HTML means "SPA fallback / stale",
      // and serving it under a .js URL would re-poison browsers.
      const htmlDisguisedAsAsset = url.pathname.startsWith('/assets/') && assetContentType.includes('text/html');
      if (url.pathname.startsWith('/assets/') && (!assetRes.ok || htmlDisguisedAsAsset)) {
        return new Response('Not Found', {
          status: 404,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex',
          },
        });
      }
      // Vite hashed subresources (/assets/*-hash.js|css) are immutable per
      // build — long-cache them so repeat visits don't revalidate ~1MB of
      // bundles on every page load. Unhashed public files keep ASSETS defaults.
      if (url.pathname.startsWith('/assets/') && assetRes.ok) {
        return new Response(assetRes.body, {
          status: assetRes.status,
          headers: {
            ...Object.fromEntries(assetRes.headers.entries()),
            'cache-control': 'public, max-age=31536000, immutable',
          },
        });
      }
      return assetRes;
    }
    const indexRes = await env.ASSETS.fetch(new Request(url.origin + '/', request));
    if (request.method === 'GET' && indexRes.ok) {
      // Read the shell once and ALWAYS return a fresh Response — the original
      // response body is consumed by text(), so returning it would 500.
      const html = await indexRes.text();
      const injected = await maybeInjectSeo(
        html,
        url.pathname,
        url.origin,
        env,
      );
      if (injected) {
        // Legacy /product/<uuid> → /product/<slug> consolidation (PR #35
        // residual): 301 with the query string preserved.
        if ('redirect' in injected) {
          return Response.redirect(new URL(injected.redirect + url.search, url.origin).toString(), 301);
        }
        return new Response(injected.html, {
          status: injected.status,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=60',
          },
        });
      }
      return new Response(html, {
        status: indexRes.status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    return indexRes;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    // Cloudflare bindings are only reachable per-request, and the sitemap/SEO
    // readers are called from deep inside handleRequest without an `env`, so the
    // data backend (D1 when DATA_BACKEND=d1, else Supabase) is published once
    // here — the same pattern already used for the AdSense OAuth bindings.
    setDataRuntime(env);
    const res = await handleRequest(request, env);
    // Single security-header owner: every response this Worker returns —
    // HTML shell, JSON APIs, sitemaps, redirects — gets the same header set
    // exactly once. Response.redirect objects are immutable, so wrap in a
    // try/catch: header-added redirects would throw; pass them through.
    try {
      const out = withSecurityHeaders(res);
      // The public blog is withdrawn from the index (src/content/reviewHolds.ts).
      // The meta tag covers the HTML we pre-render; this header is what a
      // crawler acts on for every response on these paths, including the 503
      // outage pages and anything the SPA shell itself answers.
      if (!isBlogPublic() && (pathname === '/blog' || pathname.startsWith('/blog/'))) {
        out.headers.set('x-robots-tag', 'noindex, nofollow');
      }
      return out;
    } catch {
      return res;
    }
  },

  /**
   * Scheduled tasks (wrangler.toml [triggers]):
   *   * `0 * * * *`   hourly — pull the official channel's uploads into
   *     media_videos so new videos appear on /media without a manual Sync
   *     click. Shares runMediaSync() with the admin endpoint — idempotent
   *     upsert, ~3 YouTube Data API quota units per run.
   *   * `0 3 * * *`   nightly — run the sitemap health check (crawl every
   *     sitemap URL, alert only if any returns non-200). See
   *     worker/sitemap-health.ts.
   * The two crons are disambiguated by the ScheduledEvent.cron expression.
   * The cron trigger itself is not externally invokable.
   */
  async scheduled(event: unknown, env: Env): Promise<void> {
    populateProcessEnv(env);
    setDataRuntime(env);
    if (env.YOUTUBE_API_KEY) process.env.YOUTUBE_API_KEY = env.YOUTUBE_API_KEY;

    const cron = (event as { cron?: string } | null)?.cron || '';
    if (cron === '0 3 * * *') {
      const h = await runSitemapHealth(env);
      if (!h.ok && h.broken.length) {
        console.error(`[sitemap-health] ${h.broken.length}/${h.checked} URLs broken`);
        for (const b of h.broken) console.error(`[sitemap-health]   ${b.status}  ${b.url}`);
      } else {
        console.log(`[sitemap-health] ok: ${h.checked} URLs checked, none broken`);
      }
      return;
    }

    // Pre-warm the merchandising stats cache (15-min TTL) so storefront ranking rarely pays the aggregation cost.
    try { await recomputeMerchStats(); } catch { /* best-effort */ }
    const result = await runMediaSync('cron');
    if (!result.ok) {
      console.error(`[media-cron] sync skipped: ${result.error || 'unknown error'}`);
      return;
    }
    console.log(`[media-cron] sync ok: synced=${result.synced ?? 0} created=${result.created ?? 0} updated=${result.updated ?? 0}`);
  },
};
