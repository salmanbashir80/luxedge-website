#!/usr/bin/env node
// ============================================================================
// Luxedge × Salman OS — SEO execution engine (repo side of the bridge)
//
// Hermes (Salman OS) is research-only by design: it produces keyword/SEO
// intelligence as structured JSON. THIS script is the deterministic executor
// that applies that research to the real catalog — no AI needed, no guesses.
//
// Usage:
//   node scripts/salman-seo.mjs audit                      JSON report of SEO gaps
//   node scripts/salman-seo.mjs keywords --file k.json     bulk-apply seo_keywords/title/desc
//   node scripts/salman-seo.mjs sitemap                    regenerate public/sitemap.xml
//   node scripts/salman-seo.mjs verify                     live HTTP checks
//
// k.json shape (output of a Hermes keyword_research task, or hand-written):
//   [
//     { "slug": "cooling-pet-mat-ice-silk", "keywords": ["dog cooling mat","cooling pad for dogs"],
//       "focusKeyword": "dog cooling mat", "title": "…(≤60)", "description": "…(≤155)" }
//   ]
//   Matches by slug first, then by product name (case-insensitive substring).
//
// Only ACTIVE products are touched. Only fields provided are written.
// ============================================================================
import fs from 'fs';
import { execSync } from 'child_process';

const ENV = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = String(ENV.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error('env missing (need VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env)'); process.exit(1); }
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const cmd = process.argv[2] || 'audit';
const flag = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function fetchAll(table, query) {
  const out = [];
  let from = 0;
  for (;;) {
    let res = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`${BASE}/rest/v1/${table}?${query}&limit=1000&offset=${from}`, { headers: HEAD });
      if (res.ok) break;
      if (res.status === 401) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; } // transient JWT clock skew
      throw new Error(`${table} ${res.status}: ${(await res.text()).slice(0, 120)}`);
    }
    if (!res || !res.ok) throw new Error(`${table} failed after retries`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// AUDIT — report SEO gaps for every ACTIVE product (structured, Hermes-style)
// ---------------------------------------------------------------------------
async function audit() {
  // Sequential (not Promise.all) — avoids a Node-on-Windows crash with
  // concurrent undici fetch streams, and makes transient 401s retry cleanly.
  const prods = await fetchAll('products', 'select=id,slug,name,status,price,seo_title,seo_description,seo_keywords,category_id,delivery_min_days,delivery_max_days,supplier_product_ref');
  const imgs = await fetchAll('product_images', 'select=product_id,url');
  const cats = await fetchAll('categories', 'select=id,slug');
  const catName = new Map(cats.map((c) => [c.id, c.slug]));
  const imgCount = new Map();
  for (const im of imgs) imgCount.set(im.product_id, (imgCount.get(im.product_id) || 0) + 1);
  const active = prods.filter((p) => p.status === 'active');

  const findings = [];
  for (const p of active) {
    const add = (severity, issue, evidence) => findings.push({ id: `${severity}-${p.id}`, severity, category: 'onpage', entity: p.slug || p.id, name: p.name, issue, evidence });
    if (!p.slug) add('high', 'missing slug', 'product has no URL slug');
    const t = (p.seo_title || '').trim();
    if (!t) add('high', 'missing SEO title', 'seo_title is empty');
    else if (t.length > 60) add('medium', `SEO title too long (${t.length} chars)`, t);
    const d = (p.seo_description || '').trim();
    if (!d) add('high', 'missing meta description', 'seo_description is empty');
    else if (d.length < 70) add('medium', `meta description thin (${d.length} chars)`, d);
    const kws = Array.isArray(p.seo_keywords) ? p.seo_keywords : [];
    if (kws.length === 0) add('high', 'no keywords', 'seo_keywords is empty');
    else if (kws.length < 3) add('low', `only ${kws.length} keyword(s)`, kws.join(', '));
    if (!imgCount.get(p.id)) add('high', 'no product images', 'product_images is empty');
    if (!p.delivery_min_days || !p.delivery_max_days) add('medium', 'no delivery estimate', 'delivery_min/max_days missing');
    if (!p.supplier_product_ref) add('medium', 'no supplier reference', 'supplier_product_ref empty');
  }
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  const report = {
    generated_at: new Date().toISOString(),
    product_count: active.length,
    findings: findings.slice(0, 200),
    summary: bySeverity,
    source: 'live_production',
  };
  console.log(JSON.stringify(report, null, 2));
}

// ---------------------------------------------------------------------------
// KEYWORDS — apply Hermes-researched keywords to matching ACTIVE products
// ---------------------------------------------------------------------------
async function applyKeywords() {
  const file = flag('--file');
  if (!file) { console.error('usage: node scripts/salman-seo.mjs keywords --file k.json'); process.exit(1); }
  let input;
  try { input = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('bad JSON:', e.message); process.exit(1); }
  if (!Array.isArray(input)) { console.error('k.json must be an array'); process.exit(1); }

  const prods = (await fetchAll('products', 'select=id,slug,name,status')).filter((p) => p.status === 'active');
  const applied = []; const skipped = [];
  for (const item of input) {
    const match = item.slug
      ? prods.find((p) => p.slug === item.slug)
      : prods.find((p) => item.name && p.name.toLowerCase().includes(String(item.name).toLowerCase()));
    if (!match) { skipped.push({ input: item.slug || item.name, reason: 'no active product match' }); continue; }
    const patch = {};
    if (Array.isArray(item.keywords) && item.keywords.length) patch.seo_keywords = [...new Set(item.keywords.map(String).map((k) => k.trim()).filter(Boolean))].slice(0, 12);
    if (item.title) patch.seo_title = String(item.title).slice(0, 60);
    if (item.description) patch.seo_description = String(item.description).slice(0, 160);
    if (Object.keys(patch).length === 0) { skipped.push({ input: item.slug || item.name, reason: 'no fields to write' }); continue; }
    const res = await fetch(`${BASE}/rest/v1/products?id=eq.${match.id}`, { method: 'PATCH', headers: { ...HEAD, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    if (!res.ok) { skipped.push({ input: item.slug || item.name, reason: `HTTP ${res.status}` }); continue; }
    applied.push({ slug: match.slug, name: match.name, fields: Object.keys(patch), keywords: patch.seo_keywords || null });
  }
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), applied: applied.length, skipped, applied_items: applied }, null, 2));
}

// ---------------------------------------------------------------------------
// SITEMAP — regenerate from the live catalog (commerce-ready only)
// ---------------------------------------------------------------------------
function sitemap() {
  const out = execSync('node scripts/regenerate-sitemap.mjs', { encoding: 'utf8' }).trim();
  console.log(out);
}

// ---------------------------------------------------------------------------
// VERIFY — live HTTP checks on production
// ---------------------------------------------------------------------------
async function verify() {
  const urls = ['/', '/shop', '/blog', '/sitemap.xml', '/robots.txt', '/google-products.xml'];
  let sample = null;
  if (ENV.VITE_DATA_BACKEND === 'd1') {
    const res = await fetch(`https://luxedge.us/api/db/products?select=slug,status&status=in.(active,published)&limit=1`);
    if (res.ok) {
      const data = await res.json();
      sample = data[0];
    }
  } else {
    sample = (await fetchAll('products', 'select=slug,status')).find((p) => p.status === 'active' && p.slug);
  }
  if (sample) urls.push(`/product/${sample.slug}`);
  const results = [];
  for (const u of urls) {
    try {
      const r = await fetch(`https://luxedge.us${u}`, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
      results.push({ url: u, status: r.status, ok: r.ok });
    } catch { results.push({ url: u, status: null, ok: false }); }
  }
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
}

// ---------------------------------------------------------------------------
const run = { audit, keywords: applyKeywords, sitemap, verify }[cmd];
if (!run) { console.error(`unknown command "${cmd}" — use: audit | keywords --file k.json | sitemap | verify`); process.exit(1); }
Promise.resolve(run()).catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
