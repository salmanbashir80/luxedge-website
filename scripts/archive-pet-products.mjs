import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const HEAD = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function archivePetProducts(apply = false) {
  // Fetch all active or draft products
  const res = await fetch(`${URL}/rest/v1/products?select=id,name,title,status,category_id&status=in.(active,draft)`, {
    headers: HEAD,
  });
  if (!res.ok) {
    console.error('Failed to fetch products:', res.status, await res.text());
    return;
  }
  const products = await res.json();
  console.log(`Found ${products.length} active/draft pet products to archive.`);

  for (const p of products) {
    console.log(`- [${p.status}] ${p.id}: ${p.name || p.title}`);
  }

  if (!apply) {
    console.log('\nDRY RUN ONLY. Pass --apply to execute the update.');
    return;
  }

  // Update in batches of 20
  for (let i = 0; i < products.length; i += 20) {
    const chunk = products.slice(i, i + 20);
    const ids = chunk.map((c) => c.id);
    const patchRes = await fetch(`${URL}/rest/v1/products?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: HEAD,
      body: JSON.stringify({ status: 'archived' }),
    });
    if (!patchRes.ok) {
      console.error(`Failed to patch chunk ${i}:`, patchRes.status, await patchRes.text());
    } else {
      const patched = await patchRes.json();
      console.log(`Successfully archived ${patched.length} products.`);
    }
  }

  console.log('\nAll pet products have been archived!');
}

const applyFlag = process.argv.includes('--apply');
archivePetProducts(applyFlag).catch(console.error);
