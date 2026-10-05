/** Product photo widths, shared by the browser and image proxy. */
export const DEFAULT_PRODUCT_IMAGE_WIDTH = 800;

export function normalizeImageWidth(value?: number | string | null): number {
  const width = typeof value === 'string' ? Number(value) : value;
  // Array.map passes 0, 1, 2… as its second argument. Never turn a gallery
  // photo into a one-pixel image, even if a caller accidentally passes an index.
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 64) {
    return DEFAULT_PRODUCT_IMAGE_WIDTH;
  }
  return Math.min(Math.round(width), 1600);
}

const PROXY_HOSTS = ['cf.cjdropshipping.com', 'oss-cf.cjdropshipping.com', 'img.ltwebstatic.com', 'ae01.alicdn.com'];

/** Resize real supplier photos; leave local/storage/unrelated URLs untouched. */
export function proxiedImage(src: string, width?: number): string {
  if (!src || src.startsWith('data:')) return src;
  const safeWidth = normalizeImageWidth(width);
  try {
    // Catalog images may already be proxied. Update the width instead of
    // keeping the original 800px rendition on small cards (or a legacy w=0).
    if (src.startsWith('/api/img-proxy?')) {
      const url = new URL(src, 'https://luxedge.us');
      url.searchParams.set('w', String(safeWidth));
      return `${url.pathname}${url.search}`;
    }
    const url = new URL(src);
    if (PROXY_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
      return `/api/img-proxy?url=${encodeURIComponent(src)}&w=${safeWidth}`;
    }
  } catch { /* Local relative asset: use it unchanged. */ }
  return src;
}
