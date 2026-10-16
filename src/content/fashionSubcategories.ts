// Fashion subcategory tree: main category slug -> groups -> leaf subcategories.
//
// Navigation taxonomy only. A subcategory is NOT a separate inventory record:
// every sample product belongs to exactly one main category and one leaf, and
// the tree is the single list that says which leaves are legitimate for it.
// Slugs are derived from the names so the tree and the sample data cannot drift.
//
// Main category slugs match the keys of CATEGORY_CONTENT in ./categoryContent.ts.

export interface FashionSubcategoryNode {
  slug: string;
  name: string;
  children: FashionSubcategoryNode[];
}

/** Lower-case hyphen slug for a display name ("Bras & Panties" -> "bras-and-panties"). */
export function fashionSubcategorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const leaves = (names: string[]): FashionSubcategoryNode[] =>
  names.map((name) => ({ slug: fashionSubcategorySlug(name), name, children: [] }));

const group = (name: string, names: string[]): FashionSubcategoryNode => ({
  slug: fashionSubcategorySlug(name),
  name,
  children: leaves(names),
});

export const FASHION_SUBCATEGORY_TREE: Record<string, FashionSubcategoryNode[]> = {
  'womens-clothing': [
    group('Dresses', ['Mini', 'Midi', 'Maxi', 'Bodycon', 'Evening', 'Party', 'Casual']),
    group('Tops', ['Blouses', 'Crop Tops', 'T-Shirts', 'Tank Tops', 'Bodysuits']),
    group("Women's Suits", ['Formal Suits', 'Business Suits', 'Blazer Sets', 'Two-Piece Sets', 'Three-Piece Sets']),
    group('Lingerie & Intimates', ['Bras', 'Panties', 'Bralettes', 'Lingerie Sets', 'Shapewear', 'Slips']),
    group('Swimwear', ['Bikinis', 'One-Piece Swimsuits', 'Tankinis', 'Cover-Ups', 'Resort Wear']),
    group('Nightwear', ['Pajamas', 'Satin Sleepwear', 'Nightgowns', 'Robes', 'Lounge Sets']),
    group("Women's Outerwear", ['Jackets', 'Coats', 'Trench Coats', 'Blazers', 'Hoodies', 'Cardigans']),
    group("Women's Bottoms", ['Jeans', 'Pants', 'Shorts', 'Skirts', 'Leggings']),
  ],
  "dresses-and-tops": [
    group('Dresses', ['Mini', 'Midi', 'Maxi', 'Bodycon', 'Evening', 'Party', 'Casual']),
    group('Tops', ['Blouses', 'Crop Tops', 'T-Shirts', 'Tank Tops', 'Bodysuits']),
  ],
  'mens-clothing': leaves([
    'Shirts', 'T-Shirts', 'Polo Shirts', 'Jeans', 'Pants', 'Suits', 'Blazers', 'Jackets',
    'Hoodies', 'Activewear', 'Underwear', 'Sleepwear',
  ]),
  'jeans-and-pants': leaves(['Jeans', 'Pants', 'Shorts', 'Skirts', 'Leggings']),
  'jackets-and-outerwear': leaves(['Jackets', 'Coats', 'Trench Coats', 'Blazers', 'Hoodies', 'Cardigans']),
  'sneakers-and-shoes': leaves([
    "Women's Sneakers", "Men's Sneakers", 'Heels', 'Sandals', 'Boots', 'Loafers', 'Formal Shoes',
  ]),
  'handbags-and-wallets': leaves([
    'Tote Bags', 'Shoulder Bags', 'Crossbody Bags', 'Clutches', 'Backpacks', 'Wallets',
  ]),
  jewelry: leaves(['Necklaces', 'Earrings', 'Rings', 'Bracelets', 'Anklets', 'Jewelry Sets']),
  watches: leaves(["Women's Watches", "Men's Watches", 'Fashion Watches', 'Watch Sets']),
  'sunglasses-and-accessories': leaves(['Sunglasses', 'Belts', 'Scarves', 'Hats', 'Hair Accessories']),
  'makeup-and-beauty': [
    group('Lips', ['Lipstick', 'Lip Gloss', 'Lip Liner']),
    group('Face', ['Foundation', 'Concealer', 'Blush', 'Highlighter', 'Powder']),
    group('Eyes', ['Eyeshadow', 'Eyeliner', 'Mascara']),
    group('Makeup Tools', ['Brushes', 'Sponges', 'Applicators']),
    group('Beauty Accessories', ['Makeup Bags', 'Organizers', 'Mirrors']),
  ],
};

/**
 * Leaf slugs covered by one navigation node (a group such as "Dresses", or a
 * leaf such as "Jeans") under a main category. Empty when the node is unknown,
 * so an unrecognised `?sub=` value filters everything out rather than nothing.
 */
export function fashionSubcategoryLeafSlugs(categorySlug: string, nodeSlug: string): Set<string> {
  const found = new Set<string>();
  const collect = (node: FashionSubcategoryNode) => {
    if (node.children.length === 0) found.add(node.slug);
    else node.children.forEach(collect);
  };
  const find = (nodes: FashionSubcategoryNode[]): boolean => {
    for (const n of nodes) {
      if (n.slug === nodeSlug) { collect(n); return true; }
      if (find(n.children)) return true;
    }
    return false;
  };
  find(FASHION_SUBCATEGORY_TREE[categorySlug] ?? []);
  return found;
}

/** Every leaf (subcategory) name under a main category, in tree order. */
export function fashionLeafNames(categorySlug: string): string[] {
  const out: string[] = [];
  const walk = (nodes: FashionSubcategoryNode[]) => {
    for (const n of nodes) {
      if (n.children.length === 0) out.push(n.name);
      else walk(n.children);
    }
  };
  walk(FASHION_SUBCATEGORY_TREE[categorySlug] ?? []);
  return out;
}
