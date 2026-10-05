import { describe, expect, it } from 'vitest';
import { normalizeImageWidth, proxiedImage } from '../product-images';

const supplier = 'https://oss-cf.cjdropshipping.com/product/cat-perch.jpg';

describe('product image sizing', () => {
  it.each([undefined, null, '', 'junk', '800oops', 0, 1, 2, 63, -50, NaN, Infinity])('defaults unsafe width %s to a real photo', width => {
    expect(normalizeImageWidth(width)).toBe(800);
  });
  it.each([64, 200, 400, 500, 800, 1200, 1600])('preserves intended width %s', width => {
    expect(normalizeImageWidth(width)).toBe(width);
  });
  it('caps oversized renditions and accepts numeric query parameters', () => {
    expect(normalizeImageWidth('400')).toBe(400);
    expect(normalizeImageWidth('10000')).toBe(1600);
  });
  it('keeps every gallery image useful, including accidental Array.map indices', () => {
    const photos = [supplier, supplier + '?v=2', supplier + '?v=3'];
    expect(photos.map(src => proxiedImage(src)).every(src => src.endsWith('&w=800'))).toBe(true);
    expect(photos.map(proxiedImage).every(src => src.endsWith('&w=800'))).toBe(true);
  });
  it('resizes already-proxied card photos and repairs legacy zero-width URLs', () => {
    expect(proxiedImage(proxiedImage(supplier), 400)).toBe(proxiedImage(supplier, 400));
    expect(proxiedImage(`/api/img-proxy?url=${encodeURIComponent(supplier)}&w=0`)).toBe(proxiedImage(supplier));
  });
  it.each(['/img/hk/hk-salt-gallery.jpg', 'https://images.pexels.com/photo.jpg', 'data:image/svg+xml,test', ''])('preserves non-supplier source %s', src => {
    expect(proxiedImage(src)).toBe(src);
  });
});
