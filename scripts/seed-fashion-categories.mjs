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

const FASHION_CATEGORIES = [
  { name: "Women's Clothing", slug: 'womens-clothing', is_active: true, sort_order: 1 },
  { name: "Lingerie & Intimates", slug: 'lingerie-and-intimates', is_active: true, sort_order: 2 },
  { name: "Dresses and Tops", slug: 'dresses-and-tops', is_active: true, sort_order: 3 },
  { name: "Jeans and Pants", slug: 'jeans-and-pants', is_active: true, sort_order: 4 },
  { name: "Jackets and Outerwear", slug: 'jackets-and-outerwear', is_active: true, sort_order: 5 },
  { name: "Men's Clothing", slug: 'mens-clothing', is_active: true, sort_order: 6 },
  { name: "Sneakers and Shoes", slug: 'sneakers-and-shoes', is_active: true, sort_order: 7 },
  { name: "Handbags and Wallets", slug: 'handbags-and-wallets', is_active: true, sort_order: 8 },
  { name: "Jewelry", slug: 'jewelry', is_active: true, sort_order: 9 },
  { name: "Watches", slug: 'watches', is_active: true, sort_order: 10 },
  { name: "Sunglasses and Accessories", slug: 'sunglasses-and-accessories', is_active: true, sort_order: 11 },
  { name: "Makeup & Beauty", slug: 'makeup-and-beauty', is_active: true, sort_order: 12 },
];

async function seedCategories() {
  const existingRes = await fetch(`${URL}/rest/v1/categories?select=id,slug`, { headers: HEAD });
  const existing = await existingRes.json();
  const existingSlugs = new Set(existing.map((c) => c.slug));

  for (const cat of FASHION_CATEGORIES) {
    if (existingSlugs.has(cat.slug)) {
      console.log(`Category "${cat.name}" (${cat.slug}) already exists.`);
    } else {
      const createRes = await fetch(`${URL}/rest/v1/categories`, {
        method: 'POST',
        headers: HEAD,
        body: JSON.stringify(cat),
      });
      if (!createRes.ok) {
        console.error(`Failed to create "${cat.name}":`, createRes.status, await createRes.text());
      } else {
        const created = await createRes.json();
        console.log(`Created category: ${cat.name} (${cat.slug})`);
      }
    }
  }

  // Deactivate old pet categories
  const petSlugs = [
    'pet-toys', 'bird-supplies', 'aquarium', 'dog-supplies', 'cat-supplies',
    'pet-beds', 'feeding-water', 'grooming', 'pet-accessories', 'horse', 'cattle'
  ];
  const patchRes = await fetch(`${URL}/rest/v1/categories?slug=in.(${petSlugs.join(',')})`, {
    method: 'PATCH',
    headers: HEAD,
    body: JSON.stringify({ is_active: false }),
  });
  console.log('Deactivated old pet categories:', patchRes.status);
}

seedCategories().catch(console.error);
