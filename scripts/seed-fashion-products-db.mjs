import fs from 'fs';
import crypto from 'crypto';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const HEAD = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function seedFashionCatalog() {
  // 1. Get category mapping
  const catsRes = await fetch(`${URL}/rest/v1/categories?select=id,slug,name`, { headers: HEAD });
  const cats = await catsRes.json();
  const catMap = new Map(cats.map((c) => [c.slug, c.id]));

  const lingerieCatId = catMap.get('lingerie-and-intimates') || catMap.get('womens-clothing');
  const dressesCatId = catMap.get('dresses-and-tops') || catMap.get('womens-clothing');
  const womensCatId = catMap.get('womens-clothing');
  const mensCatId = catMap.get('mens-clothing');
  const outerwearCatId = catMap.get('jackets-and-outerwear');
  const shoesCatId = catMap.get('sneakers-and-shoes');
  const bagsCatId = catMap.get('handbags-and-wallets');
  const jewelryCatId = catMap.get('jewelry');
  const watchesCatId = catMap.get('watches');
  const accessoriesCatId = catMap.get('sunglasses-and-accessories');
  const beautyCatId = catMap.get('makeup-and-beauty');
  const pantsCatId = catMap.get('jeans-and-pants') || catMap.get('womens-clothing');

  const productsToSeed = [
    // ─── LINGERIE & INTIMATES (HOT SHOWCASE) ───
    {
      name: 'Silk Charmeuse Chemise Nightdress',
      slug: 'silk-charmeuse-chemise-nightdress',
      category_id: lingerieCatId,
      price: 68.0,
      compare_at_price: 95.0,
      image_url: '/images/fashion/samples/sample-satin-camisole-sleep-set.svg',
      short_description: 'Pure 19mm mulberry silk slip with delicate cowl neckline and adjustable criss-cross back straps.',
      description: 'Designed for effortless sensuality and luxurious comfort, this pure silk charmeuse chemise drapes like liquid across the body. Featuring an elegant bias cut, seductive low back, and adjustable silk-covered straps. Handcrafted from premium grade 6A mulberry silk with hypoallergenic breathability.',
      tags: ['lingerie', 'silk', 'sleepwear', 'luxury-intimates', 'nightdress', 'sensual'],
      featured: true,
      new_arrival: true,
    },
    {
      name: 'Lace Bralette and Brief Set',
      slug: 'lace-bralette-and-brief-set',
      category_id: lingerieCatId,
      price: 38.0,
      compare_at_price: 52.0,
      image_url: '/images/fashion/samples/sample-lace-bralette-and-brief-set.svg',
      short_description: 'Floral eyelash lace triangle bralette with matching scalloped high-waist cheeky brief.',
      description: 'Sophisticated yet alluring, this matching two-piece set pairs an unlined scalloped lace bralette with soft microfiber cups and an ultra-flattering cheeky brief. Non-wired construction provides natural shaping and all-day comfort with pure Parisian allure.',
      tags: ['lingerie', 'lace', 'bralette', 'intimates', 'two-piece'],
      featured: true,
      new_arrival: true,
    },
    {
      name: 'Floral Lace Corset Bodysuit',
      slug: 'floral-lace-corset-bodysuit',
      category_id: lingerieCatId,
      price: 58.0,
      compare_at_price: 82.0,
      image_url: '/images/fashion/samples/sample-lace-bralette-and-brief-set.svg',
      short_description: 'Underwire lace corset bodysuit with sheer mesh panels and boned waist contouring.',
      description: 'Make an unforgettable impression with this showstopping corset bodysuit. Sculpted with supportive underwire cups, flexible architectural boning, and sheer scalloped lace panels. Wear it as an intimate statement piece or layered seductively beneath a tailored blazer.',
      tags: ['lingerie', 'corset', 'bodysuit', 'lace', 'evening', 'hot'],
      featured: true,
      new_arrival: true,
    },
    {
      name: 'Satin Camisole and Shorts Sleep Set',
      slug: 'satin-camisole-sleep-set',
      category_id: lingerieCatId,
      price: 44.0,
      compare_at_price: 62.0,
      image_url: '/images/fashion/samples/sample-satin-camisole-sleep-set.svg',
      short_description: 'Silky satin pajama set with V-neck camisole top and flirty elasticated flutter shorts.',
      description: 'Sink into evening bliss with our signature satin sleep set. Cut from ultra-soft stretch satin with French seam finishing, adjustable straps, and playful ruffled hem shorts. Lightweight, breathable, and irresistibly soft against bare skin.',
      tags: ['lingerie', 'satin', 'sleepwear', 'camisole', 'loungewear'],
      featured: true,
      new_arrival: false,
    },
    {
      name: 'Seamless High-Waist Sculpting Shapewear',
      slug: 'seamless-high-waist-shapewear',
      category_id: lingerieCatId,
      price: 34.0,
      compare_at_price: 48.0,
      image_url: '/images/fashion/samples/sample-seamless-high-waist-shapewear.svg',
      short_description: 'Targeted core compression shorts with silicone stay-put waistband and invisible edges.',
      description: 'Flawlessly sculpt your silhouette under any evening dress or bodycon gown. Engineered with 360-degree targeted midsection compression, zero-show laser-cut leg openings, and an anti-slip silicone lining that never rolls down.',
      tags: ['lingerie', 'shapewear', 'sculpting', 'seamless', 'essentials'],
      featured: false,
      new_arrival: false,
    },
    {
      name: 'Luxury Satin Kimono Robe with Lace Trim',
      slug: 'luxury-satin-kimono-robe',
      category_id: lingerieCatId,
      price: 74.0,
      compare_at_price: 98.0,
      image_url: '/images/fashion/samples/sample-satin-camisole-sleep-set.svg',
      short_description: 'Mid-length satin kimono wrap with delicate chantilly lace sleeves and detachable silk tie sash.',
      description: 'The ultimate lounge essential. Crafted with cascading wide kimono sleeves edged in sheer eyelash lace, an internal security tie, and a matching wide waist sash. An exquisite layer over your favorite lingerie.',
      tags: ['lingerie', 'robe', 'kimono', 'satin', 'luxury'],
      featured: true,
      new_arrival: true,
    },

    // ─── DRESSES & TOPS ───
    {
      name: 'Satin Evening Maxi Dress',
      slug: 'satin-evening-maxi-dress',
      category_id: dressesCatId,
      price: 88.0,
      compare_at_price: 120.0,
      image_url: '/images/fashion/samples/sample-satin-evening-maxi-dress.svg',
      short_description: 'Floor-length liquid satin gown with cowl neck, thigh-high slit, and open back detailing.',
      description: 'Turn heads at every gala, dinner, or premiere. This dramatic evening maxi gown is cut on the bias in heavyweight luminous satin, featuring a sweeping train and an alluring open back with criss-cross lace-up ties.',
      tags: ['dresses', 'evening', 'maxi', 'satin', 'glamour'],
      featured: true,
      new_arrival: true,
    },
    {
      name: 'Ribbed Knit Bodycon Mini Dress',
      slug: 'ribbed-knit-bodycon-mini-dress',
      category_id: dressesCatId,
      price: 42.0,
      compare_at_price: 58.0,
      image_url: '/images/fashion/samples/sample-ribbed-knit-bodycon-mini-dress.svg',
      short_description: 'Sculpting ribbed knit mini dress with square neckline and body-hugging silhouette.',
      description: 'A contemporary wardrobe icon that hugs every curve with figure-flattering compression knit. Ideal for transitioning from daytime chic with sneakers to cocktail hour with stiletto heels.',
      tags: ['dresses', 'mini', 'bodycon', 'knit', 'party'],
      featured: true,
      new_arrival: false,
    },
    {
      name: 'Floral Chiffon Midi Dress',
      slug: 'floral-midi-dress',
      category_id: dressesCatId,
      price: 64.0,
      compare_at_price: 85.0,
      image_url: '/images/fashion/samples/sample-floral-midi-dress.svg',
      short_description: 'Airy floral chiffon midi with smocked bodice, flutter cap sleeves, and tiered skirt.',
      description: 'Romantic botanical prints dance across sheer tiered chiffon. Complete with a stretch-smocked bodice that adapts comfortably to your silhouette and a graceful breezy midi hemline.',
      tags: ['dresses', 'midi', 'floral', 'summer', 'resort'],
      featured: false,
      new_arrival: true,
    },
    {
      name: "Women's Classic Silk-Touch Blouse",
      slug: 'womens-classic-button-up-blouse',
      category_id: dressesCatId,
      price: 46.0,
      compare_at_price: 65.0,
      image_url: '/images/fashion/samples/sample-women-s-classic-button-up-blouse.svg',
      short_description: 'Refined button-front blouse with pointed collar and subtle mother-of-pearl buttons.',
      description: 'The foundation of power dressing. Silky drape fabric with tailored French cuffs and a sharp collar that elevates denim, tailored trousers, or pencil skirts.',
      tags: ['tops', 'blouse', 'workwear', 'classic'],
      featured: false,
      new_arrival: false,
    },
    {
      name: "Women's Basic Cotton Crop Top",
      slug: 'womens-basic-cotton-crop-top',
      category_id: dressesCatId,
      price: 22.0,
      compare_at_price: 30.0,
      image_url: '/images/fashion/samples/sample-women-s-basic-cotton-crop-top.svg',
      short_description: 'Double-lined organic cotton ribbed crew neck crop top with stretch hold.',
      description: 'A premium staple with zero sheer show-through. Double-layered Peruvian cotton blend with optimal recovery.',
      tags: ['tops', 'crop-top', 'cotton', 'basics'],
      featured: false,
      new_arrival: false,
    },

    // ─── WOMEN'S CLOTHING & SUITS ───
    {
      name: "Women's Tailored Blazer & Trouser Set",
      slug: 'womens-tailored-blazer-and-trouser-set',
      category_id: womensCatId,
      price: 138.0,
      compare_at_price: 185.0,
      image_url: '/images/fashion/samples/sample-women-s-tailored-blazer-and-trouser-set.svg',
      short_description: 'Two-piece power suit with sharp single-breasted blazer and high-waisted pleated wide-leg pants.',
      description: 'Command the room in this meticulously tailored two-piece set. Features structured shoulder padding, notched lapels, horn buttons, and fluid pleated trousers with deep side pockets.',
      tags: ['suits', 'blazer', 'trousers', 'workwear', 'set'],
      featured: true,
      new_arrival: true,
    },
    {
      name: "Women's Casual Two-Piece Co-ord Set",
      slug: 'womens-casual-two-piece-co-ord-set',
      category_id: womensCatId,
      price: 68.0,
      compare_at_price: 92.0,
      image_url: '/images/fashion/samples/sample-women-s-casual-two-piece-co-ord-set.svg',
      short_description: 'Relaxed linen-blend button-down shirt paired with high-rise elastic drawstring shorts.',
      description: 'Effortless vacation vibes for sunny afternoons and weekend escapes. Breathable linen-cotton weave that keeps you cool in summer heat.',
      tags: ['co-ord', 'set', 'linen', 'casual', 'vacation'],
      featured: false,
      new_arrival: true,
    },
    {
      name: 'Two-Piece Bandeau Bikini Set',
      slug: 'two-piece-bikini-set',
      category_id: womensCatId,
      price: 48.0,
      compare_at_price: 65.0,
      image_url: '/images/fashion/samples/sample-two-piece-bikini-set.svg',
      short_description: 'Ribbed textured bandeau bikini top with detachable straps and high-leg bikini bottoms.',
      description: 'Sun-drenched luxury swimwear crafted with quick-drying Italian fabric, full lining, and gold-tone hardware accents.',
      tags: ['swimwear', 'bikini', 'beachwear', 'summer'],
      featured: false,
      new_arrival: true,
    },
    {
      name: 'One-Piece Sculpting Ruched Swimsuit',
      slug: 'one-piece-ruched-swimsuit',
      category_id: womensCatId,
      price: 56.0,
      compare_at_price: 78.0,
      image_url: '/images/fashion/samples/sample-one-piece-ruched-swimsuit.svg',
      short_description: 'Tummy-control ruched one-piece with removable soft cups and supportive cross-back straps.',
      description: 'Timeless poolside glamour. Strategically ruched along the bodice to flatter every angle with built-in UPF 50+ sun protection.',
      tags: ['swimwear', 'one-piece', 'resort', 'beach'],
      featured: false,
      new_arrival: false,
    },

    // ─── OUTERWEAR ───
    {
      name: "Women's Double-Breasted Long Trench Coat",
      slug: 'womens-long-trench-coat',
      category_id: outerwearCatId,
      price: 148.0,
      compare_at_price: 195.0,
      image_url: '/images/fashion/samples/sample-women-s-long-trench-coat.svg',
      short_description: 'Water-resistant heritage trench coat with storm flap, epaulettes, and buckled belt.',
      description: 'The epitome of cosmopolitan sophistication. Crafted from water-repellent cotton gabardine with tortoiseshell buttons and signature checked inner lining.',
      tags: ['outerwear', 'trench-coat', 'coat', 'classic'],
      featured: true,
      new_arrival: true,
    },
    {
      name: "Women's Cropped Faux-Leather Moto Jacket",
      slug: 'womens-cropped-denim-jacket',
      category_id: outerwearCatId,
      price: 88.0,
      compare_at_price: 125.0,
      image_url: '/images/fashion/samples/sample-women-s-cropped-denim-jacket.svg',
      short_description: 'Edgy moto jacket with asymmetrical front zipper, notch collar, and brushed silver hardware.',
      description: 'Inject instant attitude into any ensemble. Buttery-soft vegan leather with quilted shoulder accents and an adjustable buckle belt at the waist.',
      tags: ['outerwear', 'jacket', 'moto', 'edgy', 'leather'],
      featured: false,
      new_arrival: false,
    },

    // ─── JEANS & PANTS ───
    {
      name: "Men's Slim-Fit Stretch Chino Pants",
      slug: 'mens-slim-fit-chino-pants',
      category_id: pantsCatId,
      price: 58.0,
      compare_at_price: 78.0,
      image_url: '/images/fashion/samples/sample-men-s-slim-fit-chino-pants.svg',
      short_description: 'Tailored four-pocket chinos cut from cotton twill with added stretch comfort.',
      description: 'The ultimate versatile trouser for modern men. Clean lines through the seat and thigh with a slight taper below the knee.',
      tags: ['pants', 'chinos', 'menswear', 'tailored'],
      featured: false,
      new_arrival: false,
    },

    // ─── MEN'S CLOTHING ───
    {
      name: "Men's Casual Oxford Cotton Shirt",
      slug: 'mens-casual-oxford-shirt',
      category_id: mensCatId,
      price: 52.0,
      compare_at_price: 70.0,
      image_url: '/images/fashion/samples/sample-men-s-casual-oxford-shirt.svg',
      short_description: 'Garment-washed oxford cloth button-down with chest pocket and box pleat.',
      description: 'Classic American casual style. 100% long-staple combed cotton woven for durable texture that grows softer with every wash.',
      tags: ['menswear', 'shirt', 'oxford', 'casual'],
      featured: false,
      new_arrival: false,
    },
    {
      name: "Men's Heavyweight Crew Neck T-Shirt",
      slug: 'mens-essential-crew-neck-t-shirt',
      category_id: mensCatId,
      price: 26.0,
      compare_at_price: 36.0,
      image_url: '/images/fashion/samples/sample-men-s-essential-crew-neck-t-shirt.svg',
      short_description: '280 GSM heavyweight cotton tee with reinforced ribbed neckband and relaxed drop shoulder.',
      description: 'The definitive luxury heavyweight tee. Structured drape that never clings, pre-shrunk for an enduring boxy fit.',
      tags: ['menswear', 't-shirt', 'heavyweight', 'basics'],
      featured: false,
      new_arrival: false,
    },
    {
      name: "Men's Premium French Terry Zip Hoodie",
      slug: 'mens-zip-up-hoodie',
      category_id: mensCatId,
      price: 68.0,
      compare_at_price: 90.0,
      image_url: '/images/fashion/samples/sample-men-s-zip-up-hoodie.svg',
      short_description: 'Heavyweight organic French terry hoodie with two-way metal zipper and kangaroo pockets.',
      description: 'Cozy luxury for active lifestyles. Double-layered hood, flatlock stitching, and custom nickel-free metal hardware.',
      tags: ['menswear', 'hoodie', 'outerwear', 'streetwear'],
      featured: false,
      new_arrival: false,
    },

    // ─── SHOES & SNEAKERS ───
    {
      name: "Women's Classic Minimalist Leather Sneakers",
      slug: 'womens-classic-white-sneakers',
      category_id: shoesCatId,
      price: 88.0,
      compare_at_price: 120.0,
      image_url: '/images/fashion/samples/sample-women-s-classic-white-sneakers.svg',
      short_description: 'Crisp white low-top sneakers in supple calfskin leather with memory foam footbeds.',
      description: 'A timeless silhouette engineered for all-day city walks. Smooth leather upper, breathable lining, and durable stitched cupsole.',
      tags: ['shoes', 'sneakers', 'leather', 'white-sneakers', 'street-style'],
      featured: true,
      new_arrival: true,
    },
    {
      name: "Women's Strappy Block-Heel Sandals",
      slug: 'womens-block-heel-sandals',
      category_id: shoesCatId,
      price: 72.0,
      compare_at_price: 98.0,
      image_url: '/images/fashion/samples/sample-women-s-block-heel-sandals.svg',
      short_description: 'Mid-height block heel sandals with delicate criss-cross ankle straps and cushioned sole.',
      description: 'Graceful height without the fatigue. 2.5-inch block heel wrapped in matching leather with an adjustable delicate buckle strap.',
      tags: ['shoes', 'sandals', 'heels', 'evening', 'summer'],
      featured: false,
      new_arrival: true,
    },
    {
      name: "Men's Casual Suede Lace-Up Sneakers",
      slug: 'mens-casual-lace-up-sneakers',
      category_id: shoesCatId,
      price: 94.0,
      compare_at_price: 130.0,
      image_url: '/images/fashion/samples/sample-men-s-casual-lace-up-sneakers.svg',
      short_description: 'Hand-burnished suede low-tops with contrast gum rubber outsole and padded leather collar.',
      description: 'Italian-inspired sneaker aesthetics for discerning gentlemen. Soft kid suede and shock-absorbing ergonomic insoles.',
      tags: ['shoes', 'mens-shoes', 'sneakers', 'suede'],
      featured: false,
      new_arrival: false,
    },

    // ─── HANDBAGS & WALLETS ───
    {
      name: 'Structured Leather Tote Handbag',
      slug: 'structured-tote-handbag',
      category_id: bagsCatId,
      price: 128.0,
      compare_at_price: 175.0,
      image_url: '/images/fashion/samples/sample-structured-tote-handbag.svg',
      short_description: 'Spacious saffiano leather tote with dedicated 14-inch laptop compartment and top zip closure.',
      description: 'The quintessential everyday carry. Scratch-resistant textured leather, protective metal base feet, and multiple organization pockets.',
      tags: ['handbags', 'tote', 'leather', 'workbag'],
      featured: true,
      new_arrival: false,
    },
    {
      name: 'Mini Quilted Crossbody Bag with Chain Strap',
      slug: 'mini-crossbody-bag',
      category_id: bagsCatId,
      price: 76.0,
      compare_at_price: 105.0,
      image_url: '/images/fashion/samples/sample-mini-crossbody-bag.svg',
      short_description: 'Chevron quilted faux-leather camera bag with polished gold-tone turn-lock and chain strap.',
      description: 'Chic, compact, and effortlessly stylish for day-to-night adventures. Fits your smartphone, cardholder, and lip gloss with ease.',
      tags: ['handbags', 'crossbody', 'quilted', 'chain-bag'],
      featured: false,
      new_arrival: true,
    },

    // ─── JEWELRY & WATCHES ───
    {
      name: '18K Gold-Tone Layered Herringbone Necklace',
      slug: 'gold-tone-layered-necklace',
      category_id: jewelryCatId,
      price: 48.0,
      compare_at_price: 68.0,
      image_url: '/images/fashion/samples/sample-gold-tone-layered-necklace.svg',
      short_description: 'Dual-strand snake and herringbone chain necklace with secure lobster clasp and extender.',
      description: 'Luminous gold layering made effortless. High-polish waterproof plating over stainless steel that resists tarnishing and sweat.',
      tags: ['jewelry', 'necklace', 'gold', 'accessories'],
      featured: true,
      new_arrival: true,
    },
    {
      name: 'Freshwater Pearl Drop Earrings',
      slug: 'pearl-drop-earrings',
      category_id: jewelryCatId,
      price: 36.0,
      compare_at_price: 50.0,
      image_url: '/images/fashion/samples/sample-pearl-drop-earrings.svg',
      short_description: 'Baroque freshwater cultured pearls suspended from hypoallergenic 14K gold-plated huggie hoops.',
      description: 'Organic luxury. Each natural pearl carries a unique organic silhouette and soft iridescent luster.',
      tags: ['jewelry', 'earrings', 'pearls', 'gold'],
      featured: false,
      new_arrival: false,
    },
    {
      name: 'Sparkling Tennis Bracelet in White Gold Tone',
      slug: 'adjustable-tennis-bracelet',
      category_id: jewelryCatId,
      price: 52.0,
      compare_at_price: 75.0,
      image_url: '/images/fashion/samples/sample-adjustable-tennis-bracelet.svg',
      short_description: 'Continuous strand of AAA cubic zirconia stones with double-safety box clasp closure.',
      description: 'The quintessential fine jewelry staple that sparkles in every beam of light. Precision prong-set stones with diamond-rivaling brilliance.',
      tags: ['jewelry', 'bracelet', 'tennis-bracelet', 'sparkle'],
      featured: true,
      new_arrival: true,
    },
    {
      name: "Women's Emerald Dial Minimalist Watch",
      slug: 'womens-minimalist-watch',
      category_id: watchesCatId,
      price: 98.0,
      compare_at_price: 135.0,
      image_url: '/images/fashion/samples/sample-women-s-minimalist-watch.svg',
      short_description: 'Sunburst emerald green dial with rose gold mesh bracelet and Japanese quartz movement.',
      description: 'An understated statement of luxury. 32mm ultra-slim case with scratch-resistant mineral crystal glass and quick-release mesh strap.',
      tags: ['watches', 'emerald', 'luxury', 'accessories'],
      featured: true,
      new_arrival: false,
    },

    // ─── SUNGLASSES & ACCESSORIES ───
    {
      name: "Women's Vintage Cat-Eye Sunglasses",
      slug: 'womens-cat-eye-sunglasses',
      category_id: accessoriesCatId,
      price: 45.0,
      compare_at_price: 65.0,
      image_url: '/images/fashion/samples/sample-women-s-cat-eye-sunglasses.svg',
      short_description: 'Bold acetate cat-eye sunglasses with UV400 polarized gradient lenses and gold temple rivets.',
      description: 'Channel iconic Hollywood glamour. Sculpted acetate frame with 100% UVA/UVB protection and reinforced optical barrel hinges.',
      tags: ['sunglasses', 'accessories', 'eyewear', 'cat-eye'],
      featured: false,
      new_arrival: true,
    },

    // ─── BEAUTY ───
    {
      name: 'Velvet Matte Liquid Lipstick Trio',
      slug: 'velvet-matte-lipstick',
      category_id: beautyCatId,
      price: 28.0,
      compare_at_price: 38.0,
      image_url: '/images/fashion/samples/sample-velvet-matte-lipstick.svg',
      short_description: 'Long-wearing non-drying matte liquid lipsticks infused with hydrating hyaluronic acid and vitamin E.',
      description: 'Rich, transfer-proof pigment that feels weightless on the lips. High-fashion shades: Crimson Noir, Nude Silk, and Rosewood.',
      tags: ['beauty', 'makeup', 'lipstick', 'matte'],
      featured: false,
      new_arrival: false,
    },
  ];

  console.log(`Starting to seed ${productsToSeed.length} Fashion & Lingerie products into Supabase...`);

  let seededCount = 0;
  for (const item of productsToSeed) {
    const id = crypto.randomUUID();
    const productRow = {
      id,
      slug: item.slug,
      name: item.name,
      title: item.name,
      short_description: item.short_description,
      description: item.description,
      price: item.price,
      compare_at_price: item.compare_at_price,
      category_id: item.category_id,
      inventory_qty: 25,
      status: 'active',
      brand: 'Luxedge Studio',
      tags: item.tags,
      featured: item.featured,
      new_arrival: item.new_arrival,
      free_shipping: true,
      us_inventory: true,
      stock_status: 'in_stock',
      delivery_min_days: 2,
      delivery_max_days: 5,
      commerce_readiness: 'COMMERCE_READY',
      source_type: 'OWNER_STOCK',
      inventory_source: 'INTERNAL_STOCK',
      supplier_source: 'Luxedge Studio Direct',
      cost_price: Math.round(item.price * 0.45 * 100) / 100,
      landed_cost: Math.round(item.price * 0.5 * 100) / 100,
      sku: `LX-${item.slug.slice(0, 15).toUpperCase()}`,
      image_url: item.image_url,
      created_at: new Date().toISOString(),
    };

    const res = await fetch(`${URL}/rest/v1/products`, {
      method: 'POST',
      headers: HEAD,
      body: JSON.stringify(productRow),
    });

    if (!res.ok) {
      console.error(`Error inserting ${item.name}:`, res.status, await res.text());
    } else {
      seededCount++;
      console.log(`[${seededCount}/${productsToSeed.length}] Inserted: ${item.name} ($${item.price})`);
    }
  }

  console.log(`\nDONE! Seeded ${seededCount} active Fashion & Lingerie products.`);
}

seedFashionCatalog().catch(console.error);
