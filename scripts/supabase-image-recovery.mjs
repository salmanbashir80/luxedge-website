// ============================================================================
// LUXEDGE — SUPABASE STORAGE PRODUCT-IMAGE RECOVERY (safe, manual, idempotent)
//
// THE SITUATION IT ADDRESSES
//   335 of 427 product_images rows point at Supabase Storage. The whole project
//   returns HTTP 402 `exceed_egress_quota`, so those files cannot be fetched —
//   and the bytes exist ONLY behind that service (verified 2026-09-29: no local
//   backup, no mirror, no supplier URL, no Storage download endpoint that is
//   not itself restricted). Nothing can be recovered while that is true, and
//   replacing them with stock lookalikes would be fabricating product data.
//
// WHAT THIS SCRIPT DOES — in the ONLY safe order:
//   1. probe    ONE small known object. If it is still restricted (402/403/5xx)
//               it exits 0 having changed NOTHING, and says so plainly.
//   2. export   Only once Storage answers 200: downloads the referenced
//               objects, verifies each one (status, content-type, non-zero
//               size, real image signature), deduplicates by content hash, and
//               writes them to public/product-media/<hash>.<ext> (Cloudflare
//               static assets — R2 is FORBIDDEN here, it needs a card).
//   3. sql      Emits the D1 statements that repoint product_images at the new
//               static paths. It does NOT apply them: the owner runs
//               `wrangler d1 execute` deliberately.
//
// SAFETY CONTRACT
//   * Read-only against Supabase. Put verbs are never sent.
//   * No destructive step: existing files are never overwritten unless the
//     content hash differs, and nothing is ever deleted.
//   * Rate: one object at a time with a fixed delay, so a recovery can never
//     re-trigger the egress problem it is recovering from.
//   * Deterministic filenames (content hash) mean re-running is a no-op and
//     identical images are stored exactly once.
//
// USAGE
//   node scripts/supabase-image-recovery.mjs check      # probe only (safe anywhere)
//   node scripts/supabase-image-recovery.mjs export     # download + verify + dedupe
//   node scripts/supabase-image-recovery.mjs export --limit 20
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXPORT_DIR = path.join('.freebuff', 'migration', 'tables');
const OUT_DIR = path.join('public', 'product-media');
const SQL_DIR = path.join('.freebuff', 'migration', 'sql');
const REPORT_FILE = path.join('.freebuff', 'migration', 'image-recovery-report.json');

/** One in-flight request at a time: recovery must not re-burn the egress quota. */
const DELAY_MS = 250;
/** Storage objects are images; anything larger is not one of ours. */
const MAX_BYTES = 12 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isSupabaseStorageUrl(url) {
  try {
    const u = new URL(String(url));
    return u.hostname.endsWith('.supabase.co') && u.pathname.includes('/storage/v1/object/');
  } catch {
    return false;
  }
}

/** True only for bytes that really are an image (extension is not trusted). */
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return { ext: 'gif', type: 'image/gif' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (buf.slice(4, 12).toString('ascii').startsWith('ftyp')) return { ext: 'avif', type: 'image/avif' };
  // SVG is text and has no fixed header.
  const head = buf.slice(0, 400).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return { ext: 'svg', type: 'image/svg+xml' };
  return null;
}

function loadProductImages() {
  const file = path.join(EXPORT_DIR, 'product_images.json');
  if (!fs.existsSync(file)) throw new Error(`missing ${file} (run: node scripts/supabase-export.mjs export product_images)`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function storageTargets(rows) {
  const out = [];
  for (const row of rows) {
    for (const key of ['public_url', 'url', 'storage_path']) {
      const value = row?.[key];
      if (typeof value === 'string' && isSupabaseStorageUrl(value)) {
        out.push({ id: row.id, productId: row.product_id, source: value, key });
        break;
      }
    }
  }
  return out;
}

async function probeOnce(url) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-63' }, signal: AbortSignal.timeout(15_000) });
    const body = await res.text().catch(() => '');
    return { status: res.status, body: body.slice(0, 300) };
  } catch (err) {
    return { status: 0, body: String(err?.message || err).slice(0, 200) };
  }
}

/** 402/403/5xx => still restricted. 200/206 => recovery is possible. */
export function classifyProbe(status) {
  if (status === 200 || status === 206) return 'available';
  if (status === 402) return 'restricted';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'missing';
  return 'unavailable';
}

async function main() {
  const [cmd = 'check', ...args] = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const limit = limitArg === -1 ? Infinity : Math.max(1, Number(args[limitArg + 1]) || 1);

  const rows = loadProductImages();
  const targets = storageTargets(rows);
  console.log(`product_images rows: ${rows.length}`);
  console.log(`Supabase Storage URLs: ${targets.length}`);
  if (!targets.length) {
    console.log('nothing to recover.');
    return;
  }

  // Step 1 — ONE small object decides everything. Never act before probing.
  const probe = targets[0];
  const result = await probeOnce(probe.source);
  const verdict = classifyProbe(result.status);
  console.log(`probe ${probe.id}: HTTP ${result.status} -> ${verdict}`);
  if (verdict !== 'available') {
    console.log('');
    console.log('Supabase Storage is still not serving objects, so NOTHING was downloaded');
    console.log('and NOTHING was changed. This is the expected state while the project is');
    console.log('restricted (HTTP 402 exceed_egress_quota). Re-run this script later.');
    if (result.body) console.log(`response: ${result.body}`);
    return;
  }

  if (cmd === 'check') {
    console.log('Storage is AVAILABLE — run `export` to download and verify the images.');
    return;
  }

  // Step 2 — controlled download, verify, dedupe.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SQL_DIR, { recursive: true });
  const byHash = new Map();
  const recovered = [];
  const failed = [];
  let bytes = 0;

  for (const target of targets.slice(0, limit)) {
    try {
      const res = await fetch(target.source, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { failed.push({ ...target, reason: `HTTP ${res.status}` }); await sleep(DELAY_MS); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) { failed.push({ ...target, reason: 'empty body' }); await sleep(DELAY_MS); continue; }
      if (buf.length > MAX_BYTES) { failed.push({ ...target, reason: `too large (${buf.length} bytes)` }); await sleep(DELAY_MS); continue; }
      const sniffed = sniffImage(buf);
      if (!sniffed) { failed.push({ ...target, reason: 'not a decodable image' }); await sleep(DELAY_MS); continue; }

      const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
      const filename = `${hash}.${sniffed.ext}`;
      const dest = path.join(OUT_DIR, filename);
      // Content-addressed: writing the same bytes twice is a no-op.
      if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, buf);
        bytes += buf.length;
      }
      byHash.set(filename, true);
      recovered.push({ id: target.id, productId: target.productId, source: target.source, filename, mediaPath: `/product-media/${filename}`, contentType: sniffed.type, bytes: buf.length, hash });
    } catch (err) {
      failed.push({ ...target, reason: String(err?.message || err).slice(0, 120) });
    }
    await sleep(DELAY_MS);
  }

  // Step 3 — emit (but do not apply) the D1 repointing statements.
  const statements = recovered.map(
    (r) => `UPDATE product_images SET public_url = '${r.mediaPath}', url = '${r.mediaPath}' WHERE id = '${r.id}';`,
  );
  const sqlFile = path.join(SQL_DIR, 'product-images-static.sql');
  fs.writeFileSync(sqlFile, `-- Generated by scripts/supabase-image-recovery.mjs on ${new Date().toISOString()}\n-- Review, then apply deliberately with:\n--   npx wrangler d1 execute luxedge-production-db --remote --file=${sqlFile}\n${statements.join('\n')}\n`);

  const report = {
    checkedAt: new Date().toISOString(),
    totals: { rows: rows.length, storageUrls: targets.length, recovered: recovered.length, deduplicated: byHash.size, failed: failed.length, newBytes: bytes },
    recovered,
    failed,
    sqlFile,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));

  console.log('');
  console.log(`recovered ${recovered.length} / ${targets.length} (${byHash.size} unique files, ${(bytes / 1024 / 1024).toFixed(1)} MB new)`);
  console.log(`assets written to ${OUT_DIR}`);
  console.log(`D1 statements -> ${sqlFile} (NOT applied)`);
  console.log(`report -> ${REPORT_FILE}`);
  if (failed.length) console.log(`failed: ${failed.length} (see the report; no placeholder was substituted)`);
}

if (process.argv[1]?.endsWith('supabase-image-recovery.mjs')) {
  try {
    await main();
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
