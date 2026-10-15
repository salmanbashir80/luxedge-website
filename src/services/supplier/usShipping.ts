// USA-only shipping eligibility. The state list mirrors the one in
// src/features/checkout/CheckoutOnsitePage.tsx so catalog eligibility and checkout agree.

export const US_SHIP_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;

const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

export interface UsAddress {
  country: string;
  state: string;
  zip: string;
}

export type ShippingEligibility = { eligible: true } | { eligible: false; reason: string };

export function checkUsShippingEligibility(address: UsAddress): ShippingEligibility {
  if (address.country.trim().toUpperCase() !== 'US') {
    return { eligible: false, reason: 'Luxedge ships only to United States addresses.' };
  }
  if (!(US_SHIP_STATES as readonly string[]).includes(address.state.trim().toUpperCase())) {
    return { eligible: false, reason: 'Select a valid US state we ship to.' };
  }
  if (!ZIP_PATTERN.test(address.zip.trim())) {
    return { eligible: false, reason: 'Enter a valid 5-digit or ZIP+4 US ZIP code.' };
  }
  return { eligible: true };
}
