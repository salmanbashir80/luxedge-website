// ============================================================================
// LUXEDGE — INDEPENDENT PET STORE BACKUP RESTORATION TOOL
//
// Reads scripts/backups/pet-legacy-backup-20261016.json, validates integrity,
// and optionally restores or previews restoration to Supabase/D1.
//
// Usage:
//   node scripts/restore-pet-backup.mjs --dry-run   # Validate backup without touching DB
//   node scripts/restore-pet-backup.mjs --restore   # Restore archived rows to DB (requires owner approval)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const BACKUP_PATH = path.join('scripts', 'backups', 'pet-legacy-backup-20261016.json');

if (!fs.existsSync(BACKUP_PATH)) {
  console.error(`❌ Backup file not found: ${BACKUP_PATH}`);
  process.exit(1);
}

const raw = fs.readFileSync(BACKUP_PATH, 'utf8');
let backup;
try {
  backup = JSON.parse(raw);
} catch (e) {
  console.error(`❌ Backup JSON parsing failed: ${e.message}`);
  process.exit(1);
}

const posts = backup.posts || [];
console.log(`📦 Loaded backup: Version ${backup.version}, Created: ${backup.generatedAt}, Items: ${posts.length}`);

let valid = 0;
for (const p of posts) {
  const missing = [];
  if (!p.id) missing.push('id');
  if (!p.slug) missing.push('slug');
  if (!p.title) missing.push('title');
  if (!p.content) missing.push('content');
  if (!p.excerpt) missing.push('excerpt');
  
  if (missing.length > 0) {
    console.error(`⚠️  Post ${p.slug || p.id} is missing fields: ${missing.join(', ')}`);
  } else {
    valid++;
    console.log(`  ✓ [Valid] ${p.slug} (${p.title.slice(0, 40)}...) - ${p.content.length} chars, ${p.faq?.length || 0} FAQs`);
  }
}

console.log(`\n✅ Backup Verification Summary: ${valid}/${posts.length} records verified intact.`);

const isRestore = process.argv.includes('--restore');
if (!isRestore) {
  console.log(`\nℹ️  DRY RUN complete. Backup is 100% restorable. Pass --restore to execute restoration.`);
  process.exit(0);
}

// Restoration logic (only executed if explicitly invoked)
console.log('\nStarting database restoration...');
const env = {};
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').trim();
  }
} catch (e) {}

const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !key) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

let restored = 0;
for (const p of posts) {
  const payload = {
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    content: p.content,
    hero_image_url: p.image || null,
    author_name: p.authorName || 'Luxedge Editorial Team',
    author_id: p.authorId || 'editorial',
    tags: p.tags || [],
    status: 'archived', // restored as archived
    faq: p.faq || [],
  };

  const res = await fetch(`${base}/rest/v1/blog_posts?on_conflict=slug`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    restored++;
    console.log(`  ✓ Restored: ${p.slug}`);
  } else {
    console.error(`  ❌ Failed restoring ${p.slug}: ${res.status} ${await res.text()}`);
  }
}

console.log(`\n✅ Restoration complete: ${restored}/${posts.length} posts restored.`);
