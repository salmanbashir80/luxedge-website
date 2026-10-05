// Prepare exact-source public photos + conditional reference repair + rollback.
// Does NOT write the database. Reviewed SQL is applied separately with Wrangler.
import fs from 'node:fs';
import crypto from 'node:crypto';
const base = 'https://luxedge.us';
const plans = [
  { slug: 'cat-window-perch-suction-cup-hammock-seat-for-sunbathing', ref: '08B49D60-84C2-4967-A09A-646725121D04', sourcePage: 'https://cjdropshipping.com/product/cat-hammock-suction-cup-wall-mounted-window-hammock-p-08B49D60-84C2-4967-A09A-646725121D04.html', sources: ['https://cf.cjdropshipping.com/2056/2055103886328.jpg', 'https://cf.cjdropshipping.com/2056/46474973669274.jpg', 'https://cf.cjdropshipping.com/2056/4411991453292.jpg'] },
  { slug: 'usb-rechargeable-pet-nail-grinder-quiet-motor-for-dogs-cats', ref: 'C0175213-1A1D-4688-BC1D-179F5D5B1702', sourcePage: 'https://cjdropshipping.com/product/rechargeable-usb-pet-automatic-dog-nail-grinder-animal-clipper-p-C0175213-1A1D-4688-BC1D-179F5D5B1702.html', sources: ['https://cf.cjdropshipping.com/2059/1220259747825.jpg'] },
  { slug: 'stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs', ref: '1651788214971146240', sourcePage: 'https://cjdropshipping.com/product/pet-cat-dog-stainless-steel-automatic-circulation-water-dispenser-intelligent-fountain-pets-accessories-p-1651788214971146240.html', sources: ['https://cf.cjdropshipping.com/9b08b13c-ba80-4f33-ba4d-f300e2df2fda.jpg'] },
  { slug: 'retractable-dog-leash-5m-one-button-lock-with-anti-slip-grip', ref: '1650329494391508992', sourcePage: 'https://cjdropshipping.com/product/automatic-explore-retractable-dog-leash-pet-traction-rope-5m-dog-retractable-traction-rope-dog-leash-cat-puppy-harness-belt-automatic-flexible-small-medium-dogs-pet-products-p-1650329494391508992.html', sources: ['https://cc-west-usa.oss-accelerate.aliyuncs.com/a3c09cca-7a88-4f7f-88bc-7dd486edb786.jpg'] },
  { slug: 'horse-fly-mask-with-ears', ref: '1405339419183026176', sourcePage: 'https://cjdropshipping.com/product/horse-face-equestrian-universal-mosquito-cover-p-1405339419183026176.html', sources: ['https://cc-west-usa.cjdropshipping.com/1623893701102.jpg'] },
  { slug: 'foldable-pet-travel-carrier-backpack', ref: '1392428662283964416', sourcePage: 'https://cjdropshipping.com/product/portable-pet-cat-bag-breathable-dog-carrier-backpack-large-capacity-travel-pet-handbag-for-puppy-kitten-pets-outdoor-supplies-p-1392428662283964416.html', sources: ['https://cf.cjdropshipping.com/3a2511eb-e380-4716-9c83-c36c71c654d7.jpg'] },
];
const get = async path => {
  const response = await fetch(`${base}/api/db/${path}`);
  if (!response.ok) throw new Error(`Public database read HTTP ${response.status}`);
  return response.json();
};
const products = await get('products?select=id,slug,name,image_url,og_image,supplier_product_ref&status=in.(active,published)&limit=1000');
const images = await get('product_images?select=id,product_id,url,public_url,is_primary,sort_order,alt_text&limit=1000');
const quote = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const sql = [], rollback = [], backup = [], prepared = [];
fs.mkdirSync('public/product-media', { recursive: true });
for (const plan of plans) {
  const product = products.find(product => product.slug === plan.slug);
  if (!product || product.supplier_product_ref !== plan.ref) throw new Error(`Supplier reference mismatch: ${plan.slug}`);
  const originals = images.filter(image => image.product_id === product.id);
  const cover = originals.find(image => image.is_primary) || originals[0];
  if (!cover || originals.length !== 1) throw new Error(`Review gallery before repair: ${plan.slug}`);
  backup.push({ product, images: originals, sourcePage: plan.sourcePage });
  const paths = [];
  for (const source of plan.sources) {
    const supplier = new URL(source);
    const allowed = supplier.hostname === 'cf.cjdropshipping.com';
    const url = allowed ? `${base}/api/img-proxy?url=${encodeURIComponent(source)}&w=800` : source;
    const response = await fetch(url, { headers: { Accept: 'image/jpeg', 'User-Agent': 'Mozilla/5.0 Chrome/120' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Source photo HTTP ${response.status}: ${plan.slug}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length < 1000 || bytes.length > 2_000_000) throw new Error(`Invalid/oversized source photo: ${plan.slug}`);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const asset = `/product-media/${plan.slug}-${hash.slice(0, 12)}.jpg`;
    fs.writeFileSync(`public${asset}`, bytes);
    paths.push(asset);
    prepared.push({ slug: plan.slug, source, sourcePage: plan.sourcePage, asset, bytes: bytes.length, sha256: hash });
  }
  sql.push(`UPDATE products SET image_url=${quote(paths[0])}, og_image=CASE WHEN og_image IS ${quote(product.og_image)} THEN ${quote(paths[0])} ELSE og_image END WHERE id=${quote(product.id)} AND supplier_product_ref=${quote(plan.ref)} AND image_url=${quote(product.image_url)};`);
  sql.push(`UPDATE product_images SET url=${quote(paths[0])},public_url=${quote(paths[0])} WHERE id=${quote(cover.id)} AND product_id=${quote(product.id)} AND url=${quote(cover.url)};`);
  rollback.push(`UPDATE products SET image_url=${quote(product.image_url)},og_image=${quote(product.og_image)} WHERE id=${quote(product.id)} AND image_url=${quote(paths[0])};`);
  rollback.push(`UPDATE product_images SET url=${quote(cover.url)},public_url=${quote(cover.public_url)} WHERE id=${quote(cover.id)} AND url=${quote(paths[0])};`);
  for (let i = 1; i < paths.length; i++) {
    const id = crypto.randomUUID();
    sql.push(`INSERT INTO product_images (id,product_id,storage_path,public_url,url,alt_text,sort_order,kind,is_primary) SELECT ${quote(id)},${quote(product.id)},${quote(paths[i].slice(1))},${quote(paths[i])},${quote(paths[i])},${quote(`${product.name} — supplier design photo ${i + 1}`)},${i},'product',0 WHERE EXISTS(SELECT 1 FROM products WHERE id=${quote(product.id)} AND image_url=${quote(paths[0])});`);
    rollback.push(`DELETE FROM product_images WHERE id=${quote(id)} AND product_id=${quote(product.id)} AND url=${quote(paths[i])};`);
  }
}
fs.writeFileSync('.freebuff/verified-photo-backup.json', JSON.stringify(backup, null, 2));
fs.writeFileSync('.freebuff/verified-photo-manifest.json', JSON.stringify(prepared, null, 2));
fs.writeFileSync('.freebuff/verified-photo-repair.sql', sql.join('\n'));
fs.writeFileSync('.freebuff/verified-photo-rollback.sql', rollback.join('\n'));
fs.writeFileSync('.freebuff/verified-photo-preview.html', `<!doctype html><meta charset="utf-8"><title>Verified supplier photo preview</title><style>body{font:14px system-ui}main{display:grid;grid-template-columns:repeat(4,1fr);gap:15px}img{width:100%;height:220px;object-fit:contain}p{overflow-wrap:anywhere}</style><main>${prepared.map(photo => `<article><img src="../public${photo.asset}"><p>${photo.slug}</p></article>`).join('')}</main>`);
console.log(JSON.stringify({ productsPrepared: plans.length, photosPrepared: prepared.length, totalBytes: prepared.reduce((sum, photo) => sum + photo.bytes, 0), databaseChanged: false, sql: '.freebuff/verified-photo-repair.sql', rollback: '.freebuff/verified-photo-rollback.sql' }, null, 2));
