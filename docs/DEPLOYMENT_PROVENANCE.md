# Deployment Provenance

Maps each **live production artifact** back to the exact commit that produced it.

Why this file exists: production is served by a Cloudflare Worker built from a *working tree*, not
from a tag or CI pipeline. A Worker version ID (e.g. `2b90d11b-…`) therefore says nothing on its own
about which code is running. Each deploy that matters gets an entry here so the question
"*what commit is live right now?*" has a written, checkable answer.

**Production host:** `https://luxedge.us`
**Worker:** `luxedge-production` (`wrangler.toml`: `main = "worker/index.ts"`, assets from `dist/`)
**Account:** `f542683e97458480452b0b8ef37a898a`
**Deploy command:** `WRANGLER_SEND_METRICS=false npx wrangler deploy --name luxedge-production`
(see `docs/SALMAN_OS_SEO_BRIDGE.md`)

---

## Ledger

### Entry 1 — Luxedge Sales & Profit Management

| Field | Value |
| --- | --- |
| Feature | Luxedge Sales & Profit Management module (`/admin/sales`) |
| **Live Worker version** | `2b90d11b-12bf-4f38-9a81-c5147d110ac8` |
| Worker version created | `2026-09-24T20:16:22.038Z` |
| Deploy author | `8002salman@gmail.com` |
| **Commit that is live** | `2a2a14cc769b0aabd45d9fe6a938d4bb989ec8a8` |
| Commit subject | `feat(sales): add Luxedge Sales & Profit Management admin module` |
| Base (parent) commit | `d6a851654e7cdb08bd676a4af04277ba5b7097e8` |
| Commit date | `2026-09-25` |

**Important ordering note:** the Worker was deployed *before* the commit existed — the deploy came
from the uncommitted working tree. Commit `2a2a14c` was created afterwards from that same tree and
is byte-for-byte the code that was deployed, which is why this entry records a commit that is newer
than the deploy.

**Evidence that `2a2a14c` == the live artifact**

| Check | Result |
| --- | --- |
| Fresh `npm run build` of `2a2a14c` vs live `/assets/index-D8mU0Fu2.js` | byte-identical, sha256 `640914db172ba0b33a8acaf4b0b709dd9ac1525747b23d7807dd1ccf0353865c` (632,763 bytes) |
| Fresh build vs live `/assets/AdminSection-CJfT5f7f.js` | byte-identical, sha256 `1fc54277db19cc20c05e38a410b9eed79b91de295fff3065ec4594c9a7c313da` (1,696,270 bytes) |
| `GET /api/admin/sales` with no session | `401` (admin-gated route is live; was `404` before the deploy) |
| Authenticated production click-through | all 5 tabs (Overview / Orders / Expenses / Reports / Export-Sheets) rendered real content; every `/api/admin/sales` call `200`; console clean; no writes |
| Test suite | 1617 passed, 8 skipped |
| Migration | `0032_sales_management.sql` applied and live-verified |

---

### Entry 2 — Safe sitemap fallback + egress reduction (issue #138)

| Field | Value |
| --- | --- |
| Fix | `/sitemap.xml` degrades to a minimal static emergency feed when the DB is unavailable; `product_images` reads gain the server-side `url=not.like.data:*` egress filter |
| **Live Worker version** | `d18b84bb-5a21-486e-80d1-9742271d0f80` |
| Worker version created | `2026-09-29` |
| Deploy author | `8002salman@gmail.com` |
| **Commit that is live** | `476a492779d50e13de4f9c0d8742ba321b5cb946` |
| Commit subject | `fix(seo): add safe sitemap fallback and reduce Supabase egress` |
| Base (parent) commit | `e7ea2d1` |

**Context:** Supabase `eidujmfbcfrjjleitaqp` is API-restricted (HTTP 402 `exceed_egress_quota`), so the previous fail-closed sitemap returned 503 (issue #138). This deploy serves a valid 12-URL static emergency feed (`X-Luxedge-Sitemap-Mode: emergency`) until the quota resets; dynamic mode resumes automatically on recovery.

**Evidence that `476a492` == the live artifact**

| Check | Result |
| --- | --- |
| `GET /sitemap.xml` | `200`, `application/xml; charset=utf-8`, `x-luxedge-sitemap-mode: emergency` (the replaced code path cannot emit that header) |
| Emergency body | valid XML, exactly 12 static URLs, zero `/product/`, `/category/`, `/blog`, `/shop` paths |
| `GET /robots.txt` | `200`, still references `https://luxedge.us/sitemap.xml` |
| `/`, `/about`, `/privacy`, `/shop` | all `200` |
| `GET /google-products.xml` | `502` — expected while the DB is 402-restricted; no fabricated feed data |
| Assets | upload reported no changed asset files; SPA hashes match Entry 1 (`index-D8mU0Fu2.js`) |
| Test suite | 1629 passed, 8 skipped; `tsc --noEmit` at the 6-error baseline; `npm run build` green |

---

## Adding an entry

1. Note the Worker version `npx wrangler deployments list` reports for the deploy (with
   `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID` if a stray API token shadows your login).
2. Commit the deployed tree.
3. Add a row here with the Worker version, the commit SHA, and at least one hash-level comparison
   between a fresh build and the live asset.

## Verifying an entry

```bash
# 1. which Worker versions exist, newest first
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler deployments list --name luxedge-production

# 2. rebuild the recorded commit in a throwaway worktree, so your own checkout is never touched
git worktree add --detach /tmp/luxedge-provenance <commit>
(cd /tmp/luxedge-provenance && npm ci && npm run build)
sha256sum /tmp/luxedge-provenance/dist/assets/index-D8mU0Fu2.js
curl -fsS https://luxedge.us/assets/index-D8mU0Fu2.js | sha256sum
git worktree remove /tmp/luxedge-provenance
```

Equal hashes mean the recorded commit is what production is serving. A mismatch means something was
deployed that was never committed — add an entry documenting the uncommitted delta rather than
silently rewriting this one.
