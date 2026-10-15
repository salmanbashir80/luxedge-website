// Sample Fashion products for storefront previews and staging layout checks.
//
// These are NOT supplier records and are NOT written to any database. Every
// entry is `sample: true` and `purchasable: false`, so nothing here can reach
// checkout. Prices are illustrative placeholders, not supplier quotes. Images
// are the category photographs in public/images/fashion (see SOURCES.md).
//
// Category slugs match CATEGORY_CONTENT keys in ./categoryContent.ts.

export interface FashionSampleProduct {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  /** Illustrative display price in USD. Not a supplier quote. */
  priceUsd: number;
  image: string;
  sample: true;
  purchasable: false;
}

const CATEGORY_IMAGES: Record<string, string> = {
  'womens-clothing': '/images/fashion/women-clothing.jpg',
  'mens-clothing': '/images/fashion/men-clothing.jpg',
  'dresses-and-tops': '/images/fashion/dresses-tops.jpg',
  'jeans-and-pants': '/images/fashion/jeans-pants.jpg',
  'jackets-and-outerwear': '/images/fashion/jackets-outerwear.jpg',
  'sneakers-and-shoes': '/images/fashion/sneakers-shoes.jpg',
  'handbags-and-wallets': '/images/fashion/handbags-wallets.jpg',
  jewelry: '/images/fashion/jewelry.jpg',
  watches: '/images/fashion/watches.jpg',
  'sunglasses-and-accessories': '/images/fashion/sunglasses-accessories.jpg',
};

const SAMPLE_NAMES: Record<string, Array<[string, number]>> = {
  'womens-clothing': [
    ['Everyday Knit Cardigan', 38],
    ['Relaxed Linen Blouse', 34],
    ['Ribbed Lounge Set', 46],
    ['Wrap Midi Skirt', 42],
  ],
  'mens-clothing': [
    ['Classic Oxford Shirt', 36],
    ['Lightweight Chino Shorts', 32],
    ['Crew-Neck Essential Tee', 18],
    ['Relaxed Denim Shirt', 44],
  ],
  'dresses-and-tops': [
    ['A-Line Midi Dress', 52],
    ['Satin Slip Dress', 48],
    ['Puff-Sleeve Top', 29],
    ['Wrap Maxi Dress', 58],
  ],
  'jeans-and-pants': [
    ['High-Rise Straight Jeans', 49],
    ['Wide-Leg Trousers', 54],
    ['Slim Stretch Jeans', 46],
    ['Tailored Jogger Pants', 39],
  ],
  'jackets-and-outerwear': [
    ['Faux-Leather Moto Jacket', 88],
    ['Quilted Puffer Vest', 62],
    ['Denim Trucker Jacket', 68],
    ['Lightweight Trench Coat', 96],
  ],
  'sneakers-and-shoes': [
    ['White Everyday Sneakers', 64],
    ['Suede Chelsea Boots', 92],
    ['Leather Loafers', 78],
    ['Canvas Slip-On Shoes', 42],
  ],
  'handbags-and-wallets': [
    ['Structured Tote Bag', 84],
    ['Quilted Crossbody Bag', 58],
    ['Bifold Leather Wallet', 46],
    ['Mini Shoulder Bag', 52],
  ],
  jewelry: [
    ['Gold-Tone Hoop Earrings', 24],
    ['Layered Chain Necklace', 32],
    ['Minimal Stacking Rings Set', 28],
    ['Pearl Drop Earrings', 36],
  ],
  watches: [
    ['Minimalist Quartz Watch', 72],
    ['Mesh-Band Analog Watch', 58],
    ['Leather-Strap Dress Watch', 84],
    ['Chronograph Sport Watch', 98],
  ],
  'sunglasses-and-accessories': [
    ['Polarized Aviator Sunglasses', 46],
    ['Oversized Square Sunglasses', 38],
    ['Silk Scarf', 26],
    ['Wide-Brim Sun Hat', 32],
  ],
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const FASHION_SAMPLE_PRODUCTS: FashionSampleProduct[] = Object.entries(SAMPLE_NAMES).flatMap(
  ([categorySlug, items]) =>
    items.map(([name, priceUsd]) => {
      const slug = `sample-${slugify(name)}`;
      return {
        id: slug,
        slug,
        name,
        categorySlug,
        priceUsd,
        image: CATEGORY_IMAGES[categorySlug],
        sample: true as const,
        purchasable: false as const,
      };
    }),
);
