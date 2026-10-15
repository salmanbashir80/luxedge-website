// Retail price = (supplier cost + estimated US shipping) grossed up by the margin, rounded
// up to the next whole cent. Pure function: no network, no currency conversion.

export interface PricingInput {
  costUsd: number;
  shippingUsd: number;
  /** Fraction of the landed cost kept as margin, e.g. 0.6 means price = landed / (1 - 0.6). */
  marginRate: number;
}

export function calculateRetailPriceUsd({ costUsd, shippingUsd, marginRate }: PricingInput): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) throw new Error('costUsd must be a positive number');
  if (!Number.isFinite(shippingUsd) || shippingUsd < 0) throw new Error('shippingUsd must be zero or positive');
  if (!Number.isFinite(marginRate) || marginRate < 0 || marginRate >= 1) {
    throw new Error('marginRate must be at least 0 and below 1');
  }
  const landed = costUsd + shippingUsd;
  const cents = Math.ceil((landed / (1 - marginRate)) * 100 - 1e-9);
  return cents / 100;
}
