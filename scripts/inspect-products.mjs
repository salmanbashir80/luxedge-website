import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function run() {
  const catsRes = await fetch(`${URL}/rest/v1/categories?select=id,name,slug`, { headers: HEAD });
  const cats = await catsRes.json();
  console.log('Categories:', cats);

  const prodsRes = await fetch(`${URL}/rest/v1/products?select=id,name,title,status,category_id&limit=200`, { headers: HEAD });
  const prods = await prodsRes.json();
  console.log(`Total products fetched: ${prods.length}`);
  const statusCounts = {};
  for (const p of prods) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  }
  console.log('Status breakdown:', statusCounts);
  if (prods.length > 0) {
    console.log('Sample product keys:', Object.keys(prods[0]));
  }
}

run().catch(console.error);
