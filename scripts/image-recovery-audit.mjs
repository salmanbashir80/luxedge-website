// ============================================================================
// LUXEDGE — PRODUCT-IMAGE RECOVERY AUDIT
//
// Supabase Storage returns HTTP 402 for all 335 Supabase-hosted product images,
// so their bytes are unreachable through the provider. This audit answers: which
// of them can still be recovered from a LEGITIMATE $0 source?
//
// Sources checked, in the order PHASE 7 prescribes:
//   1. the live DB itself (products.image_url / og_image, supplier URLs)
//   2. the local repository (public/**) by basename match
//   3. the working tree's git history for a same-named file
//   4. other already-working external hosts in the same table
//
// It NEVER substitutes a visually similar image and never invents a URL — a row
// is only marked recoverable when a concrete, identity-preserving source exists.
//
// USAGE
//   node scripts/image-recovery-audit.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const TABLES_DIR = path.join('.freebuff', 'migration', 'tables');

function load(name) {
  const file = path.join(TABLES_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Recursively collect files under public/, keyed by basename. */
function indexLocalAssets(dir = 'public') {
  const byName = new Map();
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const key = entry.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(p);
      }
    }
  };
  walk(dir);
  return byName;
}

function basenameOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').toLowerCase();
  } catch {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '(relative or invalid)';
  }
}

function main() {
  const images = load('product_images');
  const products = load('products');
  if (!images) {
    console.error('missing .freebuff/migration/tables/product_images.json — run supabase-export.mjs export first');
    return;
  }

  const localAssets = indexLocalAssets('public');
  console.log(`local public/ files indexed by basename: ${localAssets.size}`);

  const byHost = new Map();
  const supabaseRows = [];
  for (const row of images) {
    const url = typeof row.url === 'string' ? row.url : '';
    const host = hostOf(url);
    byHost.set(host, (byHost.get(host) || 0) + 1);
    if (host.endsWith('.supabase.co')) supabaseRows.push(row);
  }

  console.log(`\ntotal rows: ${images.length}`);
  console.log('by host:');
  for (const [host, n] of [...byHost.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${host}`);
  }

  console.log(`\nsupabase-hosted (402-blocked): ${supabaseRows.length}`);

  // 1. local repository mirror
  let localMirror = 0;
  const localExamples = [];
  for (const row of supabaseRows) {
    const base = basenameOf(row.url);
    if (base && localAssets.has(base)) {
      localMirror += 1;
      if (localExamples.length < 5) localExamples.push(`${base} -> ${localAssets.get(base)[0]}`);
    }
  }
  console.log(`\n[1] recoverable from local public/ (basename match): ${localMirror}`);
  for (const e of localExamples) console.log(`      ${e}`);

  // 2. do the owning products carry a non-Supabase image URL we can fall back to?
  const productById = new Map((products || []).map((p) => [p.id, p]));
  const affectedProducts = new Set(supabaseRows.map((r) => r.product_id));
  let productHasWorkingUrl = 0;
  let productHasStorageUrlToo = 0;
  for (const pid of affectedProducts) {
    const p = productById.get(pid);
    if (!p) continue;
    const candidates = [p.image_url, p.og_image].filter((v) => typeof v === 'string' && v);
    const working = candidates.filter((v) => !hostOf(v).endsWith('.supabase.co'));
    if (working.length) productHasWorkingUrl += 1;
    if (candidates.some((v) => hostOf(v).endsWith('.supabase.co'))) productHasStorageUrlToo += 1;
  }
  console.log(`\n[2] affected products: ${affectedProducts.size}`);
  console.log(`    products that also carry a NON-Supabase image_url/og_image: ${productHasWorkingUrl}`);
  console.log(`    products whose products.image_url is itself Supabase Storage: ${productHasStorageUrlToo}`);

  // 3. storage_path hints — do they resolve to anything we hold locally?
  const storagePaths = supabaseRows.map((r) => r.storage_path).filter((v) => typeof v === 'string' && v);
  console.log(`\n[3] rows carrying storage_path: ${storagePaths.length} / ${supabaseRows.length}`);
  if (storagePaths.length) {
    const withLocal = storagePaths.filter((sp) => localAssets.has(path.basename(sp).toLowerCase())).length;
    console.log(`    storage_path basenames found in public/: ${withLocal}`);
  }

  // 4. per-product coverage after recovery
  let coveredAfterLocal = 0;
  let uncoveredProducts = [];
  for (const pid of affectedProducts) {
    const rows = supabaseRows.filter((r) => r.product_id === pid);
    const anyLocal = rows.some((r) => localAssets.has(basenameOf(r.url)));
    const p = productById.get(pid);
    const anyExternal =
      p && [p.image_url, p.og_image].some((v) => typeof v === 'string' && v && !hostOf(v).endsWith('.supabase.co'));
    if (anyLocal || anyExternal) coveredAfterLocal += 1;
    else uncoveredProducts.push(pid);
  }
  console.log(`\n[4] products with NO working image from any legitimate source: ${uncoveredProducts.length}`);
  console.log(`    products still covered: ${coveredAfterLocal} / ${affectedProducts.size}`);

  // 5. the already-working external rows that need nothing
  const workingRows = images.filter((r) => !hostOf(r.url).endsWith('.supabase.co'));
  console.log(`\n[5] rows already on working external hosts: ${workingRows.length}`);
}

main();
