import { describe, it, expect, vi } from 'vitest';
import { generateValidatedOptimization, optimizationPrompt, parseOptimization, productFacts, previousOptimizationFields } from '../productOptimization';
import type { CatalogProduct } from '../../catalog/types';

const p = { name: 'Cat Window Hammock', brand: '', categoryName: 'Cat', shortDescription: 'A suction cup window hammock for cats.', description: 'A window-mounted hammock seat with suction cups. Check the window surface and attachment before each use.', features: ['Suction cups'], specifications: {}, ownerNotes: 'PRIVATE', price: 22, slug: 'keep-url' } as CatalogProduct;
const content = { name: 'Suction Cup Window Hammock for Cats', shortDescription: 'A window-mounted lounging seat for cats.', description: 'Give your cat a window-side place to lounge. This hammock uses suction cups to attach to the window. Check the attachment and window surface before use.' };

describe('factual product optimization', () => {
  it('accepts usable plain content and strips non-editable fields', () => {
    expect(parseOptimization(JSON.stringify({ ...content, slug: 'new', status: 'active', price: 99 }), 'content', p)).toEqual(content);
  });
  it('never sends private notes or costs to the model', () => {
    expect(JSON.stringify(productFacts(p))).not.toContain('PRIVATE');
    expect(optimizationPrompt(p, 'seo', 'Cat')).toContain('Do NOT change slug or canonical');
  });
  it.each(['medical treatment', 'clinically tested', 'guaranteed protection', '<script>bad</script>'])('rejects unsafe text %s', (claim) => {
    expect(() => parseOptimization(JSON.stringify({ ...content, description: content.description + claim }), 'content', p)).toThrow();
  });
  it('rejects invented dimensions', () => {
    expect(() => parseOptimization(JSON.stringify({ ...content, description: content.description + ' Supports 30 kg.' }), 'content', p)).toThrow(/numeric/);
  });
  it('rejects malformed and empty model output', () => {
    expect(() => parseOptimization('[]', 'content', p)).toThrow();
    expect(() => parseOptimization('{}', 'content', p)).toThrow();
  });
  it('accepts SEO without allowing canonical changes', () => {
    const out = parseOptimization(JSON.stringify({ seoTitle: 'Cat Window Hammock | Luxedge', metaDescription: 'Browse a suction cup cat window hammock for a window-side lounging spot. Check the mounting surface before use.', seoKeywords: ['cat window hammock', 'cat window hammock'], slug: 'bad' }), 'seo', p);
    expect(out.seoKeywords).toEqual(['cat window hammock']);
    expect(out).not.toHaveProperty('slug');
  });
  it('captures only affected fields for Undo', () => {
    expect(previousOptimizationFields(p, { name: content.name })).toEqual({ name: p.name });
  });
  it('restores missing SEO rather than saving display fallbacks', () => {
    const existing = { ...p, id: 'fixture', seoTitle: p.name, seoDescription: p.shortDescription, seoTitleStored: null, seoDescriptionStored: null };
    expect(previousOptimizationFields(existing, { seoTitle: 'New SEO', seoDescription: 'New description' })).toEqual({ seoTitle: '', seoDescription: '' });
    expect(previousOptimizationFields({ ...existing, seoTitle: 'Unsaved custom title' }, { seoTitle: 'New SEO' })).toEqual({ seoTitle: 'Unsaved custom title' });
  });
  it('repairs a rejected response once before returning validated fields', async () => {
    const generate = vi.fn().mockResolvedValueOnce('{"name":"invalid"}').mockResolvedValueOnce(JSON.stringify(content));
    const repair = vi.fn();
    expect(await generateValidatedOptimization(p, 'content', 'Cat', undefined, generate, repair)).toEqual(content);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(repair).toHaveBeenCalledOnce();
    expect(generate.mock.calls[1][0]).toContain('previous response failed validation');
    expect(generate.mock.calls[1][0]).not.toContain('{"name":"invalid"}');
  });
  it('stops after one failed repair; invalid output never becomes a save patch', async () => {
    const generate = vi.fn().mockResolvedValue('{}');
    await expect(generateValidatedOptimization(p, 'seo', 'Cat', undefined, generate)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('does not retry network/provider errors or valid responses', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('Provider unavailable'));
    await expect(generateValidatedOptimization(p, 'content', 'Cat', undefined, generate)).rejects.toThrow('Provider unavailable');
    expect(generate).toHaveBeenCalledOnce();
    generate.mockReset().mockResolvedValue(JSON.stringify(content));
    await generateValidatedOptimization(p, 'content', 'Cat', undefined, generate);
    expect(generate).toHaveBeenCalledOnce();
  });
});
