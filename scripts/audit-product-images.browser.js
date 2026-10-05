// Read-only browser audit. Run on luxedge.us with agent-browser eval --stdin.
(async () => {
  const productsResponse = await fetch('/api/db/products?select=id,slug,name,image_url,status&status=in.(active,published)&limit=1000');
  const imagesResponse = await fetch('/api/db/product_images?select=product_id,url,public_url,is_primary,sort_order&limit=1000');
  if (!productsResponse.ok || !imagesResponse.ok) throw new Error('Public catalog API unavailable');
  const products = await productsResponse.json();
  const rows = await imagesResponse.json();
  const sources = new Map();
  const pages = [];
  for (const product of products) {
    const photos = rows.filter(row => row.product_id === product.id).map(row => row.url || row.public_url).filter(Boolean);
    if (product.image_url) photos.push(product.image_url);
    for (const photo of new Set(photos)) {
      if (!sources.has(photo)) sources.set(photo, []);
      sources.get(photo).push(product.slug);
    }
  }
  const checks = [];
  const queue = [...sources.entries()];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const [source, slugs] = queue.shift();
      const url = /(^|\/\/)([^/]*\.)?(cjdropshipping\.com|alicdn\.com|ltwebstatic\.com)\//.test(source)
        ? `/api/img-proxy?url=${encodeURIComponent(source)}&w=800` : source;
      const image = new Image();
      const result = await new Promise(resolve => {
        const timer = setTimeout(() => resolve({ pass: false, reason: 'timeout' }), 15000);
        image.onload = () => { clearTimeout(timer); resolve({ pass: image.naturalWidth >= 64 && image.naturalHeight >= 64, width: image.naturalWidth, height: image.naturalHeight }); };
        image.onerror = () => { clearTimeout(timer); resolve({ pass: false, reason: 'load-error' }); };
        image.src = url;
      });
      checks.push({ source, slugs, ...result });
    }
  }));
  const pageQueue = [...products];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (pageQueue.length) {
      const product = pageQueue.shift();
      const response = await fetch(`/product/${product.slug}`);
      const html = await response.text();
      const dom = new DOMParser().parseFromString(html, 'text/html');
      pages.push({ slug: product.slug, status: response.status, canonical: dom.querySelector('link[rel="canonical"]')?.href, pass: response.ok && html.includes(product.slug) });
    }
  }));
  return {
    checkedAt: new Date().toISOString(), products: products.length, uniqueImageSources: checks.length,
    imagesPassed: checks.filter(check => check.pass).length, imageFailures: checks.filter(check => !check.pass),
    pagesPassed: pages.filter(page => page.pass).length, pageFailures: pages.filter(page => !page.pass),
    allImageChecks: checks, allPageChecks: pages,
  };
})()
