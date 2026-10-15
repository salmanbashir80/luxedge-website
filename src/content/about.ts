// ============================================================================
// LUXEDGE — shared /about copy (single source of truth)
//
// Used by BOTH the client AboutPage (src/App.tsx) and the worker pre-render
// (worker/seo-meta.ts) so the initial server HTML and the hydrated page can
// never drift. Every statement here is drawn from the live catalog or the
// published Luxedge policies — nothing invented.
// ============================================================================

export const ABOUT_QUOTE = 'A curated online store for premium everyday fashion, shipped across the United States.';

export const ABOUT_LEAD =
  'Luxedge is an online fashion store for thoughtfully selected clothing and accessories — women’s and ' +
  'men’s clothing, dresses and tops, jeans and pants, jackets and outerwear, sneakers and shoes, handbags ' +
  'and wallets, jewelry, watches, and sunglasses.';

export interface AboutSection {
  title: string;
  body: string;
}

export const ABOUT_SECTIONS: AboutSection[] = [
  {
    title: 'What we sell',
    body:
      'Our catalog covers everyday fashion across ten categories: women’s clothing, men’s clothing, dresses ' +
      'and tops, jeans and pants, jackets and outerwear, sneakers and shoes, handbags and wallets, jewelry, ' +
      'watches, and sunglasses and accessories. Each product page lists its size and color options, its ' +
      'price in US dollars, and its estimated US shipping cost.',
  },
  {
    title: 'How we source and curate',
    body:
      'Product listings use information supplied by manufacturers and suppliers. A listing is not a claim ' +
      'that Luxedge has independently verified fabric content or fit. Check the size chart, materials, care ' +
      'instructions and delivery information before ordering. Products marked as previews are not yet ' +
      'available to purchase.',
  },
  {
    title: 'Our buying guides',
    body:
      'Our guides explain how to choose fit, fabric and care for clothing and accessories. Luxedge Editorial ' +
      'Team is the site’s publishing byline. Luxedge sells products linked from its guides and may earn ' +
      'advertising revenue. For a correction or a source question, email hello@luxedge.us with the page URL ' +
      'and the passage concerned.',
  },
  {
    title: 'Who we are',
    body:
      'Luxedge.us is an independent US online store operated by Embani LLC. We are a retailer, not a ' +
      'manufacturer or a marketplace: we choose the items we list, write the descriptions and guides that ' +
      'accompany them, and answer the messages that come back. Luxedge is not affiliated with LuxEdge ' +
      'Furniture Co. (Canada) or LuxEdge Property (UK); those are unrelated businesses with similar names.',
  },
  {
    title: 'How our products reach you',
    body:
      'Luxedge holds no warehouse of its own. Orders are fulfilled through third-party suppliers and ' +
      'fulfilment partners. Orders ship only to US addresses, and the delivery window shown on a product page ' +
      'reflects how that item is stocked and shipped. The shipping policy explains how tracking and delays ' +
      'are handled. We would rather state that plainly than imply a domestic warehouse we do not have.',
  },
  {
    title: 'What you can expect from us',
    body:
      'Listings state what we can verify — size, color, material and care — and omit specifications we cannot ' +
      'confirm rather than guessing at them. Prices and availability are shown at checkout, delivery estimates ' +
      'are described as estimates, and returns follow the published returns policy. If something arrives ' +
      'damaged, defective, or different from its listing, email hello@luxedge.us and we will work through it ' +
      'with you.',
  },
  {
    title: 'Customer support',
    body:
      'Our team is available Monday to Friday, 9AM\u20136PM CT. Order processing takes about 1\u20133 business days, and ' +
      'orders ship only to addresses in the United States. We offer 30-day return and replacement support for ' +
      'damaged, defective, or incorrect items. Questions? Contact hello@luxedge.us or call (440) 941-8002.',
  },
];
