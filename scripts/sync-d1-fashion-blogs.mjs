import fs from 'fs';
import { execSync } from 'child_process';
import { FASHION_BLOGS } from './seed-fashion-blogs.mjs';

// Escape SQL string
function esc(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

const petSlugs = [
  'best-bird-feeder-buyers-guide',
  'how-to-choose-a-cat-tunnel',
  'how-to-clean-a-bird-feeder',
  'how-to-choose-cattle-trough-feed-water-setup',
  'horse-fly-mask-buyers-guide',
  'horse-grooming-kit-buyers-guide',
  'dog-car-safety-seat-belt-guide',
  'how-to-fit-no-pull-dog-harness',
  'horse-halter-lead-rope-buyers-guide',
  'grooming-routine-long-haired-pets'
];

let sql = `-- Archive pet blogs in D1\n`;
for (const slug of petSlugs) {
  sql += `UPDATE blog_posts SET status = 'archived' WHERE slug = ${esc(slug)};\n`;
}

sql += `\n-- Insert or update fashion blogs in D1\n`;
for (const b of FASHION_BLOGS) {
  const tagsJson = JSON.stringify(b.tags || []);
  const faqJson = JSON.stringify(b.faq || []);
  const secKeywordsJson = JSON.stringify([]);
  const internalLinksJson = JSON.stringify([]);
  
  sql += `INSERT INTO blog_posts (
    id, slug, title, excerpt, content, hero_image_url, hero_image_alt,
    tags, author_name, author_id, status, created_at, updated_at,
    published_at, faq, secondary_keywords, internal_links
  ) VALUES (
    ${esc(b.id)}, ${esc(b.slug)}, ${esc(b.title)}, ${esc(b.excerpt)}, ${esc(b.content)},
    ${esc(b.image)}, ${esc(b.title)}, ${esc(tagsJson)}, ${esc(b.author_name)},
    ${esc(b.author_id)}, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
    ${esc(b.published_at || '2026-10-15T12:00:00Z')}, ${esc(faqJson)},
    ${esc(secKeywordsJson)}, ${esc(internalLinksJson)}
  ) ON CONFLICT (id) DO UPDATE SET
    slug = excluded.slug,
    title = excluded.title,
    excerpt = excluded.excerpt,
    content = excluded.content,
    hero_image_url = excluded.hero_image_url,
    hero_image_alt = excluded.hero_image_alt,
    tags = excluded.tags,
    status = 'published',
    published_at = excluded.published_at,
    faq = excluded.faq,
    updated_at = CURRENT_TIMESTAMP;\n`;
}

const outPath = 'scripts/backups/sync-d1-fashion-blogs.sql';
fs.writeFileSync(outPath, sql, 'utf8');
console.log('Generated SQL file:', outPath, 'Bytes:', sql.length);
