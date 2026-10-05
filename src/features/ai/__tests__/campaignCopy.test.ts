import { describe, expect, it, vi } from 'vitest';
import { parseCampaignCopy, campaignCopyPrompt, generateCampaignCopy } from '../campaignCopy';
const copy = { title: 'A little gift for your pet', subtitle: 'Discover the Luxedge pet gift drop', message: 'Explore the gift available through Luxedge. Check the campaign details and eligibility before claiming.' };
describe('campaign copy boundary', () => {
  it('removes internal QA identifiers but preserves legitimate numeric facts', () => {
    const prompt = campaignCopyPrompt({ title: 'QA Test Draft — D1 Persistence 20261005', kind: 'gift', message: 'A gift worth $15 for your pet', giftName: 'Pet item 2-pack' });
    expect(prompt).not.toContain('D1');
    expect(prompt).not.toContain('20261005');
    expect(prompt).toContain('$15');
    expect(prompt).toContain('2-pack');
    expect(campaignCopyPrompt({ title: '30-gallon trough, 12 x 18 inches', kind: 'gift' })).toContain('30-gallon trough, 12 x 18 inches');
  });
  it('retries rejected output once and accepts only validated copy', async () => {
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...copy, title: 'QA D1 20261005' })).mockResolvedValueOnce(JSON.stringify(copy));
    expect(await generateCampaignCopy({ title: 'QA D1', kind: 'gift' }, generate)).toEqual(copy);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toContain('failed validation');
  });
  it('does not retry valid output or provider errors', async () => {
    const valid = vi.fn().mockResolvedValue(JSON.stringify(copy));
    await expect(generateCampaignCopy({ title: 'Gift', kind: 'gift' }, valid)).resolves.toEqual(copy);
    expect(valid).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn().mockRejectedValue(new Error('Provider unavailable'));
    await expect(generateCampaignCopy({ title: 'Gift', kind: 'gift' }, unavailable)).rejects.toThrow('Provider unavailable');
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
  it.each(['Guaranteed results', 'Free shipping', 'Only a few left', 'Only 3 left'])('keeps rejecting unsafe retry output: %s', async message => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ ...copy, message }));
    await expect(generateCampaignCopy({ title: 'Promo', kind: 'promo' }, generate)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('drops changes to status and offer configuration', () => {
    expect(parseCampaignCopy(JSON.stringify({ ...copy, status: 'live', freeShipping: true }))).toEqual(copy);
  });
  it.each(['Only 3 left', 'Medical benefits', '<b>Gift</b>', 'Guaranteed results'])('rejects %s', (message) => {
    expect(() => parseCampaignCopy(JSON.stringify({ ...copy, message }))).toThrow();
  });
  it('does not claim free shipping without actual evidence', () => {
    expect(campaignCopyPrompt({ title: 'Promo', kind: 'promo' })).toContain('explicitly true');
    expect(campaignCopyPrompt({ title: 'Promo', kind: 'promo' })).toContain('Do not claim free products');
  });
  it('rejects invented offer and urgency even when JSON is valid', () => {
    for (const message of ['Free shipping on every order', 'Only a few left', 'Claim your free gift']) {
      expect(() => parseCampaignCopy(JSON.stringify({ ...copy, message }), { kind: 'promo' })).toThrow();
    }
    expect(parseCampaignCopy(JSON.stringify({ ...copy, message: 'Enjoy free shipping on your gift.' }), { kind: 'gift', freeShipping: true }).message).toContain('free shipping');
  });
});
