import { describe, expect, it } from 'vitest';
import { parseCampaignCopy, campaignCopyPrompt } from '../campaignCopy';
const copy = { title: 'A little gift for your pet', subtitle: 'Discover the Luxedge pet gift drop', message: 'Explore the gift available through Luxedge. Check the campaign details and eligibility before claiming.' };
describe('campaign copy boundary', () => {
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
