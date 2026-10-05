// Public-photo evidence sheet, not production content. No credentials required.
import fs from 'node:fs';
const response = await fetch('https://luxedge.us/api/db/products?select=id,slug,name,image_url,supplier_url,supplier_product_ref&status=in.(active,published)&limit=1000');
if (!response.ok) throw new Error(`Public catalog HTTP ${response.status}`);
const products = await response.json();
const escape = text => String(text || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const cards = products.map(product => {
  const source = /cjdropshipping\.com/.test(product.image_url) ? `https://luxedge.us/api/img-proxy?url=${encodeURIComponent(product.image_url)}&w=400` : new URL(product.image_url, 'https://luxedge.us').href;
  return `<article><img src="${escape(source)}" alt=""><h2>${escape(product.name)}</h2><p>${escape(product.slug)}</p></article>`;
}).join('');
fs.writeFileSync('.freebuff/product-photo-contact-sheet.html', `<!doctype html><meta charset="utf-8"><title>Luxedge public product photo audit</title><style>body{font:12px system-ui;margin:16px;background:#eee}main{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}article{padding:8px;background:white}img{width:100%;height:155px;object-fit:contain}h2{font-size:12px;margin:6px 0}p{font-size:10px;overflow-wrap:anywhere;margin:0;color:#666}</style><main>${cards}</main>`);
console.log(JSON.stringify({ products: products.length, artifact: '.freebuff/product-photo-contact-sheet.html' }));
