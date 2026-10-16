import { isLinkablePublicPath } from './reviewHolds';

// Shared category content — ONE source for the category name, the category
// intro, the selection considerations and the related guides.
//
// The worker's server-rendered category page, the client collection page and
// the admin product form all read this module, so the crawl HTML, the hydrated
// DOM and the category dropdown always agree.
//
// Fashion branch: the storefront sells USA-only apparel and accessories. The
// considerations are practical, evidence-free fit, care and selection guidance
// a shopper can verify against the listing itself. Nothing here states a
// fabric certification, a performance figure or a medical or safety claim.
//
// Keys are category slugs (see toSlug in src/App.tsx, which strips apostrophes
// so "Women's Clothing" becomes "womens-clothing").
export interface CategoryContent {
  /** Display name, as shown in navigation, the admin dropdown and the page header. */
  name: string;
  /** One-line intro shown under the category title. */
  desc: string;
  /** 4–6 genuine selection considerations for this category. */
  considerations: string[];
  /** Related published guides — only guides that exist and are indexable. */
  guides: { label: string; href: string }[];
}

/** The eleven USA Fashion categories, in storefront order. */
export const CATEGORY_CONTENT: Record<string, CategoryContent> = {
  'womens-clothing': {
    name: "Women's Clothing",
    desc: 'Everyday tops, layers and wardrobe staples for women',
    considerations: [
      'Check the listed bust, waist and hip measurements rather than relying on the size label alone, since cuts differ between brands and styles.',
      'Think about the occasion and the layers you will wear with it, so a piece earns its place in more than one outfit.',
      'Read the fabric content on the listing. Blends behave differently from natural fibres when washed, dried and worn through a long day.',
      'For fitted pieces, look at stretch and seam placement. A little give through the shoulders and hips usually makes a garment more comfortable to wear.',
      'Follow the care label before the first wash, and wash darker and lighter pieces separately to keep colour looking fresh.',
    ],
    guides: [
      { label: "Women's Outfit Styling Guide", href: '/blog/womens-outfit-styling-guide-everyday-elevated' },
    ],
  },
  'mens-clothing': {
    name: "Men's Clothing",
    desc: 'Core shirts, knits and everyday layers for men',
    considerations: [
      'Compare the chest, waist and sleeve measurements on the listing with a garment you already own that fits well.',
      'Choose a fit that suits your build: a regular cut sits more loosely through the body, while a slim cut follows the line of the shoulders and torso.',
      'Look at the fabric content and weight. A heavier knit holds its shape better, while a lighter weave is easier to layer in warmer weather.',
      'Check how the collar, cuffs and hem are finished, since these areas show wear first and matter most for everyday use.',
      'Wash with like colours and dry flat or on a low setting to keep shape and fit consistent over time.',
    ],
    guides: [
      { label: "Men's Capsule Wardrobe Essentials", href: '/blog/mens-capsule-wardrobe-essentials' },
    ],
  },
  'dresses-and-tops': {
    name: 'Dresses and Tops',
    desc: 'Dresses, blouses and tees for work, weekends and occasions',
    considerations: [
      'Measure from shoulder to hem for dresses and compare the length with the listing, since a hemline can change the whole look of a piece.',
      'Check the neckline and armhole depth before buying, so the top sits comfortably when you sit, reach or lift your arms.',
      'Consider lining and opacity for lighter fabrics, especially for pale colours or any piece worn in bright daylight.',
      'Look at how the fabric drapes in the listing photos. Flowing materials move differently from structured cotton, so choose for the way you want it to fall.',
      'Hand wash delicate dresses and hang them to dry, which protects the seams and keeps print detail sharp after many wears.',
    ],
    guides: [
      { label: 'Evening Dresses & Occasion Styling', href: '/blog/evening-dresses-and-occasion-styling-guide' },
      { label: 'How to Choose a Midi Dress', href: '/blog/how-to-choose-a-midi-dress' },
    ],
  },
  'jeans-and-pants': {
    name: 'Jeans and Pants',
    desc: 'Denim, chinos and trousers cut for everyday wear',
    considerations: [
      'Use your waist and inseam measurements rather than a single size number, because rise and leg shape vary considerably between cuts.',
      'Pick a rise that suits how you wear them. A higher rise sits at the natural waist, while a mid or low rise sits lower on the hip.',
      'Check the stretch percentage on denim. Stretch makes movement easier, but a higher share can soften and lose shape faster with wear.',
      'Compare the leg opening and taper with the shoes you plan to wear, so the hem sits correctly over the footwear.',
      'Wash denim inside out in cold water and air dry it, which protects the colour and reduces fading across the seams.',
    ],
    guides: [],
  },
  'jackets-and-outerwear': {
    name: 'Jackets and Outerwear',
    desc: 'Layers, coats and jackets for changing weather',
    considerations: [
      'Choose a size that leaves room for the layer underneath, and try the jacket on with a knit or shirt you would normally wear with it.',
      'Check the length and how it sits at the hip, since outerwear that is too short or too long can feel awkward when you sit or walk.',
      'Look at the closures and linings. Zips, buttons and snaps should move smoothly, and a clean lining makes a jacket easier to layer.',
      'Think about the climate you dress for. A lighter shell suits mild days, while a heavier insulated coat suits colder, drier conditions.',
      'Follow the care label closely, as technical fabrics and coated finishes often need a gentle cycle and a cool or low-heat dry.',
    ],
    guides: [
      { label: 'How to Care for a Leather Jacket', href: '/blog/how-to-care-for-a-leather-jacket' },
    ],
  },
  'sneakers-and-shoes': {
    name: 'Sneakers and Shoes',
    desc: 'Sneakers, boots and dress shoes for every day of the week',
    considerations: [
      'Measure your foot length and width, and compare with the listed size chart, because shoe lasts and widths vary between brands.',
      'Try the shoe with the socks you plan to wear. Toe room and heel hold matter more than the size label when you walk for a long time.',
      'Check the sole and tread for the surfaces you walk on most. A smooth dress sole and a grippy rubber outsole suit very different routines.',
      'Look at the upper material and the insole. Leather, knit and synthetic uppers break in differently, and a removable insole can be swapped for extra support.',
      'Clean the uppers with a soft brush and let them air dry away from direct heat, which keeps the material flexible and the shape intact.',
    ],
    guides: [],
  },
  'handbags-and-wallets': {
    name: 'Handbags and Wallets',
    desc: 'Totes, crossbodies, clutches and wallets for daily carry',
    considerations: [
      'Measure the strap drop and the body of the bag, and check how it sits on your shoulder or across the body before you decide.',
      'Think about what you carry every day. Compare the interior pockets and the internal dimensions with your phone, keys and wallet.',
      'Look at the hardware and the zip or closure. Metal fittings and sturdy zips are the parts that take the most daily wear and tear.',
      'For wallets, check the number of card slots and whether a note section and coin pocket suit how you pay and organise cash.',
      'Store bags stuffed with paper or tissue to hold their shape, and keep them away from prolonged sun and damp conditions.',
    ],
    guides: [
      { label: 'Handbag Selection & Wardrobe Matching', href: '/blog/handbag-selection-wardrobe-matching-guide' },
    ],
  },
  jewelry: {
    name: 'Jewelry',
    desc: 'Everyday necklaces, earrings, bracelets and rings',
    considerations: [
      'Check the length of necklaces and bracelets on the listing, since a chain that sits well on one neckline can look too long or short on another.',
      'Look at the metal and plating description. Plated pieces and solid metals wear differently, so read the finish details before choosing.',
      'For earrings, consider the post or hook type and how the piece weighs on the ear, especially for longer or heavier designs worn all day.',
      'Store pieces separately in a soft pouch or box, so chains do not tangle and delicate finishes do not rub against harder stones or metal.',
      'Remove jewellery before showering, swimming or exercising, and wipe it dry after wear to keep the finish looking its best for longer.',
    ],
    guides: [
      { label: 'Jewelry Layering & Accessories Styling', href: '/blog/jewelry-layering-and-accessories-styling' },
    ],
  },
  watches: {
    name: 'Watches',
    desc: 'Everyday watches with clear dials and comfortable straps',
    considerations: [
      'Measure your wrist and compare with the case diameter and lug width on the listing, since a watch that is too large can slide around.',
      'Choose a strap material for your routine. Leather suits dress wear, while metal bracelets and silicone straps handle more daily activity.',
      'Check the strap length and the clasp or buckle, so the watch fits snugly without pinching when your wrist moves.',
      'Look at the dial layout and legibility in the listing photos, especially if you plan to read the time quickly in a busy setting.',
      'Keep the watch away from strong magnets and remove it before water exposure unless the listing states the specific water resistance.',
    ],
    guides: [],
  },
  'sunglasses-and-accessories': {
    name: 'Sunglasses and Accessories',
    desc: 'Sunglasses, belts, scarves and everyday small accessories',
    considerations: [
      'Compare the frame width and temple length with a pair you already wear, since a fit that is too narrow or too wide will sit poorly on the face.',
      'Check the lens description on the listing and read the stated specification, rather than assuming a lens does any particular job.',
      'For belts and scarves, look at the width, length and material, and match them to the trousers, coats or outfits you plan to pair them with.',
      'Store sunglasses in a case and keep them off the dashboard, since heat and pressure can warp frames and loosen hinges over time.',
      'Clean lenses with a soft microfibre cloth and mild soap, and avoid paper towels or harsh solvents that can scratch the surface.',
    ],
    guides: [],
  },
  'lingerie-and-intimates': {
    name: 'Lingerie and Intimates',
    desc: 'Bras, bodysuits, sleepwear and delicate undergarments',
    considerations: [
      'Measure your underbust and fullest bust points with a soft tape to determine accurate band and cup size rather than guessing from older garments.',
      'Check the cup style and underwire construction on the listing. Soft bralettes offer relaxed support, while molded underwire cups provide defined lift.',
      'Look at the fabric blend and stretch properties: sheer lace, satin, and mesh provide different levels of elasticity and breathability.',
      'Examine the closure and strap adjustability: multi-row hook closures and adjustable sliders ensure a snug, customized fit over time.',
      'Hand wash delicate lace and satin intimates in cold water using gentle detergent, and lay flat to dry to preserve elasticity and fine embroidery.',
    ],
    guides: [
      { label: 'Lingerie Sizing and Fit Guide', href: '/blog/lingerie-sizing-and-fit-guide' },
      { label: 'Delicate Fabric Care: Satin, Lace & Silk', href: '/blog/delicate-fabric-care-satin-lace-silk' },
    ],
  },
  'makeup-and-beauty': {
    name: 'Makeup and Beauty',
    desc: 'Lips, face, eyes and makeup tools for everyday routines',
    considerations: [
      'Read the shade names on the listing and compare them with a product you already know, since shade names are not standardised between brands.',
      'Check the full ingredient list and the product label on the supplier listing before ordering, and keep the labelling you receive with the product.',
      'For foundation and concealer, consider the finish described on the listing, such as matte, satin or dewy, and choose the one that suits your skin type.',
      'Look at the size and format of the product, and compare the quantity with how often you expect to use it.',
      'Store cosmetics closed and away from heat and direct sunlight, and stop using any product that changes colour, smell or texture.',
    ],
    guides: [
      { label: 'Essential Makeup & Beauty Routine', href: '/blog/essential-makeup-and-beauty-routine-guide' },
    ],
  },
};

/** Ordered display names: the single list the navigation, admin and filters use. */
export const CATEGORY_NAMES: string[] = Object.values(CATEGORY_CONTENT).map((c) => c.name);

/** The route slug for a display name, or null when the name is not a known category. */
export function categorySlugFor(name: string): string | null {
  if (name === 'Lingerie & Intimates' || name === 'Luxury Lingerie' || name === 'Lingerie and Intimates') return 'lingerie-and-intimates';
  return Object.keys(CATEGORY_CONTENT).find((slug) => CATEGORY_CONTENT[slug].name === name) ?? null;
}

/**
 * Storefront allowlist: only these category slugs may appear on the public
 * catalog. Pet-store categories are not in CATEGORY_CONTENT, so products that
 * still carry them (historical Pet rows) stay in the database but are hidden.
 */
export const FASHION_CATEGORY_SLUGS: ReadonlySet<string> = new Set(Object.keys(CATEGORY_CONTENT));

/** Lookup by slug, tolerant of a display name ("Women's Clothing"). */
export function categoryContentFor(slugOrName: string): CategoryContent | null {
  if (slugOrName === 'lingerie-and-intimates' || slugOrName === 'lingerie-intimates' || slugOrName === 'Lingerie & Intimates' || slugOrName === 'Lingerie and Intimates') {
    const entry = CATEGORY_CONTENT['lingerie-and-intimates'];
    return { ...entry, guides: entry.guides.filter((g) => isLinkablePublicPath(g.href)) };
  }
  const slug = String(slugOrName || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const entry = CATEGORY_CONTENT[slug];
  if (!entry) return null;
  // Guide links are filtered here, at the one lookup both render paths and the
  // category hero already share, so a category page can never advertise a guide
  // whose URL is retired (or held). Nothing else needs to know the rule.
  return { ...entry, guides: entry.guides.filter((g) => isLinkablePublicPath(g.href)) };
}
