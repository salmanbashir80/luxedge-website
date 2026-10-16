import fs from 'node:fs';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/content/fashionSampleProducts.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});
const { FASHION_SAMPLE_PRODUCTS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const base = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: key,
  Authorization: 'Bearer ' + key,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

// 1. Fetch categories to map categorySlug -> category_id
const cRes = await fetch(`${base}/rest/v1/categories?select=id,slug`, { headers });
const cats = await cRes.json();
const catMap = new Map();
for (const c of cats) {
  if (c.slug) catMap.set(c.slug, c.id);
}

// 2. Fetch existing products by slug
const pRes = await fetch(`${base}/rest/v1/products?select=slug`, { headers });
const existingProds = await pRes.json();
const existingSlugs = new Set(existingProds.map((p) => p.slug));

let inserted = 0;
let updated = 0;

for (const p of FASHION_SAMPLE_PRODUCTS) {
  let catId = catMap.get(p.categorySlug);
  // Special mapping for lingerie items to lingerie-and-intimates if available
  if (['Bralettes', 'Shapewear', 'Satin Sleepwear', 'Lingerie Sets', 'Bodysuits', 'Slips', 'Bras'].includes(p.subcategory) && catMap.has('lingerie-and-intimates')) {
    catId = catMap.get('lingerie-and-intimates');
  }
  if (!catId) catId = catMap.get('womens-clothing');

  const row = {
    name: p.name,
    title: p.name,
    slug: p.slug,
    price: p.priceUsd,
    compare_at_price: Math.round(p.priceUsd * 1.35),
    short_description: p.description,
    description: p.description + ' Curated for the Luxedge luxury fashion collection. Shipped across the USA.',
    status: 'active',
    commerce_readiness: 'COMMERCE_READY',
    category_id: catId,
    image_url: p.image,
    inventory_qty: 35,
    featured: true,
    new_arrival: true,
    brand: 'Luxedge',
    tags: [p.categorySlug, p.subcategory.toLowerCase(), 'fashion', 'usa-ready'],
    free_shipping: true,
    us_inventory: true,
    stock_status: 'in_stock',
    delivery_min_days: 3,
    delivery_max_days: 6,
  };

  if (existingSlugs.has(p.slug)) {
    // Update existing
    const uRes = await fetch(`${base}/rest/v1/products?slug=eq.${encodeURIComponent(p.slug)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(row),
    });
    if (uRes.ok) updated++;
  } else {
    // Insert new
    const iRes = await fetch(`${base}/rest/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify(row),
    });
    if (iRes.ok) inserted++;
    else {
      console.error(`Failed to insert ${p.slug}:`, await iRes.text());
    }
  }
}

console.log(`Seeded to Supabase: ${inserted} inserted, ${updated} updated.`);
