import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight } from '@phosphor-icons/react';
import { BuyerGuidance } from './BuyerGuidance';
import { categoryContentFor } from '../content/categoryContent';

/**
 * CATEGORY HERO CONFIG — one source of truth for every catalog category header.
 * Vary only image, copy, and accent mood per category (per the design brief);
 * the CategoryHero component below renders all of them through the same
 * premium structure: breadcrumb → label → headline → rule → description →
 * CTA → subcategory chips, with the editorial pet image on the right.
 *
 * Mood mapping (per the brief):
 *   Dog    = warm, active, friendly
 *   Cat    = soft, elegant, calm
 *   Horse  = premium, powerful, refined
 *   Bird   = fresh, light, natural
 *   Cattle = strong, practical, trustworthy
 *
 * `tint` selects a subtle band background (classes in index.css); everything
 * else stays on Luxedge's existing luxe-gold / serif design system.
 */

export interface CategoryHeroConfig {
  label: string;          // eyebrow — e.g. "Dog Supplies"
  headline: string;       // strong H1 — e.g. "Gear That Keeps Up With Your Dog"
  desc: string;           // one-line value statement
  image: string;          // editorial pet/lifestyle photo
  imageAlt: string;
  mobileImage?: string;
  imagePosition?: string;
  badge?: string;
  tint: 'dog' | 'cat' | 'horse' | 'bird' | 'cattle' | 'neutral';
  ctaHref: string;        // primary action (scrolls to the product grid)
  ctaLabel: string;
  buyerNote: string;
  chips: { label: string; href: string }[]; // subcategory shortcuts (real links)
}

const FASHION_HERO_COPY: { name: string; headline: string; desc: string; ctaLabel: string; buyerNote: string; chips: string[] }[] = [
  { name: "Women's Clothing", headline: 'Everyday Pieces for Every Wardrobe', desc: 'Tops, layers and wardrobe staples chosen for comfort, fit and everyday wear.', ctaLabel: "Shop women's clothing", buyerNote: 'Start with the occasion or the layers you need, then compare the measurements and fabric details on each listing.', chips: ['Dresses and Tops', 'Jackets and Outerwear', 'Handbags and Wallets'] },
  { name: "Men's Clothing", headline: 'Easy Essentials for Everyday Style', desc: 'Shirts, knitwear and everyday staples for men, selected for fit and comfort.', ctaLabel: "Shop men's clothing", buyerNote: 'Begin with the occasion, then compare the chest, length and fabric details listed on each product.', chips: ['Jeans and Pants', 'Jackets and Outerwear', 'Sneakers and Shoes'] },
  { name: 'Dresses and Tops', headline: 'Light Layers and Easy Dresses', desc: 'Dresses, blouses and tees for work, weekends and occasions.', ctaLabel: 'Shop dresses and tops', buyerNote: 'Compare the listed measurements and fabric content, and match the length and neckline to the occasion.', chips: ["Women's Clothing", 'Jewelry', 'Sneakers and Shoes'] },
  { name: 'Jeans and Pants', headline: 'Denim and Trousers That Fit Your Day', desc: 'Jeans, trousers and chinos in a range of cuts and washes.', ctaLabel: 'Shop jeans and pants', buyerNote: 'Check the waist, rise and inseam on each listing, since cut and length vary between styles.', chips: ["Men's Clothing", "Women's Clothing", 'Jackets and Outerwear'] },
  { name: 'Jackets and Outerwear', headline: 'Layers for Cooler Days', desc: 'Denim jackets, lightweight coats and everyday outerwear.', ctaLabel: 'Shop jackets and outerwear', buyerNote: 'Compare the listed chest and length measurements, and consider what you will wear underneath.', chips: ["Men's Clothing", "Women's Clothing", 'Jeans and Pants'] },
  { name: 'Sneakers and Shoes', headline: 'Footwear for Every Step', desc: 'Sneakers, boots and dress shoes for every day of the week.', ctaLabel: 'Shop sneakers and shoes', buyerNote: 'Check the size chart on the listing, since shoe fit varies between brands and styles.', chips: ["Men's Clothing", "Women's Clothing", 'Sunglasses and Accessories'] },
  { name: 'Handbags and Wallets', headline: 'Carry Everything You Need', desc: 'Handbags, crossbody bags and wallets for work and everyday use.', ctaLabel: 'Shop handbags and wallets', buyerNote: 'Compare the listed dimensions and materials to be sure the bag fits your everyday essentials.', chips: ["Women's Clothing", 'Jewelry', 'Sunglasses and Accessories'] },
  { name: 'Jewelry', headline: 'Small Details, Everyday Shine', desc: 'Earrings, necklaces, bracelets and rings for everyday wear and gifts.', ctaLabel: 'Shop jewelry', buyerNote: 'Check the listed materials and dimensions, and read the care notes before you wear pieces daily.', chips: ['Watches', 'Dresses and Tops', 'Handbags and Wallets'] },
  { name: 'Watches', headline: 'Time Worn Well', desc: 'Wristwatches for work, weekends and gifting, with straps and dials to suit.', ctaLabel: 'Shop watches', buyerNote: 'Compare the case size, strap type and other details shown on each listing.', chips: ['Jewelry', "Men's Clothing", 'Sunglasses and Accessories'] },
  { name: 'Sunglasses and Accessories', headline: 'Finishing Touches for Every Outfit', desc: 'Sunglasses, belts, scarves and everyday small accessories.', ctaLabel: 'Shop sunglasses and accessories', buyerNote: 'Check the frame and lens details on each listing, and choose a size that suits your face and daily use.', chips: ['Handbags and Wallets', 'Jewelry', 'Watches'] },
];

const toHeroSlug = (name: string) => name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Temporary, replaceable sample photography (CC-licensed Wikimedia Commons files, see public/images/fashion/SOURCES.md).
// Served from this app's public folder; owner-supplied images can replace these files in place.
const FASHION_IMAGE_ORIGIN = '/images/fashion';
const FASHION_HERO_IMAGES: Record<string, { file: string; alt: string }> = {
  "Women's Clothing": { file: 'women-clothing.jpg', alt: 'Model walking the runway in a fashion show' },
  "Men's Clothing": { file: 'men-clothing.jpg', alt: 'Man in a green shirt-jacket, blue jeans and desert boots' },
  'Dresses and Tops': { file: 'dresses-tops.jpg', alt: 'Woman in a red gown at a fashion show' },
  'Jeans and Pants': { file: 'jeans-pants.jpg', alt: 'Pairs of blue jeans displayed together' },
  'Jackets and Outerwear': { file: 'jackets-outerwear.jpg', alt: 'Leather jacket on display' },
  'Sneakers and Shoes': { file: 'sneakers-shoes.jpg', alt: 'Pair of white sneakers' },
  'Handbags and Wallets': { file: 'handbags-wallets.jpg', alt: 'Black mini handbag styled with a minidress' },
  Jewelry: { file: 'jewelry.jpg', alt: 'Rings and necklaces displayed as jewelry' },
  Watches: { file: 'watches.jpg', alt: 'Wristwatch close-up' },
  'Sunglasses and Accessories': { file: 'sunglasses-accessories.jpg', alt: 'Pair of sunglasses for summer' },
};

export const CATEGORY_HERO_CONFIG: Record<string, CategoryHeroConfig> = Object.fromEntries(
  FASHION_HERO_COPY.map((c) => [c.name, {
    label: c.name,
    headline: c.headline,
    desc: c.desc,
    image: `${FASHION_IMAGE_ORIGIN}/${FASHION_HERO_IMAGES[c.name].file}`,
    imageAlt: FASHION_HERO_IMAGES[c.name].alt,
    tint: 'neutral' as const,
    ctaHref: '#product-grid',
    ctaLabel: c.ctaLabel,
    buyerNote: c.buyerNote,
    chips: c.chips.map((label) => ({ label, href: `/category/${toHeroSlug(label)}` })),
  }]),
);

/** Sized variants only for the existing image CDN; custom CMS sources pass through. */
export function categoryImageVariant(source: string, width: number): string {
  if (!source.startsWith('https://images.unsplash.com/')) return source;
  const url = new URL(source);
  url.searchParams.set('w', String(width));
  url.searchParams.set('h', String(Math.round(width * 0.9)));
  url.searchParams.set('q', '75');
  url.searchParams.set('auto', 'format');
  return url.toString();
}

// Unknown future categories remain usable without a fabricated photo or links.
const NEUTRAL_CONFIG: Omit<CategoryHeroConfig, 'label' | 'headline' | 'desc' | 'buyerNote'> = {
  image: '',
  imageAlt: '',
  tint: 'neutral',
  ctaHref: '#product-grid',
  ctaLabel: 'Browse all products',
  chips: [],
};

/** Resolve existing collections, with a neutral fallback for future categories. */
export function categoryHeroConfig(name: string, fallbackDesc: string): CategoryHeroConfig {
  return (
    CATEGORY_HERO_CONFIG[name] || {
      ...NEUTRAL_CONFIG,
      label: name,
      headline: name,
      desc: fallbackDesc,
      buyerNote: 'Start with the task you need to complete, then compare the details supplied on each product listing.',
    }
  );
}

interface Props {
  config: CategoryHeroConfig;
}

/**
 * Premium, reusable category-page hero: breadcrumb → eyebrow label → strong
 * headline → description → CTA → related collection links on the left,
 * editorial pet image on the right, all inside a subtle per-category tinted
 * band. Mobile presents the photo first and keeps collection links available;
 * lightweight — no carousel, no autoplay, no text baked into the image.
 */
export default function CategoryHero({ config }: Props): JSX.Element {
  const { label, headline, desc, image, imageAlt, tint, ctaHref, ctaLabel, buyerNote, chips, mobileImage, imagePosition, badge } = config;
  // Selection considerations and guide links come from the shared content the
  // crawl pre-render already emits for this collection, so both surfaces show
  // the same guidance.
  const shared = categoryContentFor(label);
  return (
    <div className={`category-hero category-hero--${tint}`}>
      <nav aria-label="Breadcrumb" className="category-hero__breadcrumb">
        <ol>
          <li><Link to="/">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link to="/shop">Shop</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{label}</li>
        </ol>
      </nav>
      <div className={`category-hero__body${image ? '' : ' category-hero__body--text'}`}>
        {image && (
          <picture className="category-hero__media">
            {mobileImage && <source media="(max-width: 599px)" srcSet={mobileImage} />}
            <img src={categoryImageVariant(image, 720)}
              srcSet={image.startsWith('https://images.unsplash.com/') ? [360, 540, 720, 1080].map(w => `${categoryImageVariant(image, w)} ${w}w`).join(', ') : undefined}
              sizes="(min-width: 1440px) 380px, (min-width: 1024px) 32vw, (min-width: 640px) 44vw, 100vw"
              alt={imageAlt} width="720" height="648" loading="eager" fetchPriority="high" decoding="async"
              style={{ objectPosition: imagePosition || '50% 50%' }} />
          </picture>
        )}
        <div className="category-hero__copy">
          <p className="category-hero__eyebrow">{label}{badge && <span>{badge}</span>}</p>
          <h1>{headline}</h1>
          <p className="category-hero__description">{desc}</p>
          <a href={ctaHref} className="category-hero__cta">{ctaLabel}<ArrowDown size={16} aria-hidden="true" /></a>
        </div>
      </div>
      <div className="px-5 pb-5 sm:px-7"><BuyerGuidance title={`Choosing ${label.toLowerCase()}`} note={buyerNote} topic={label.toLowerCase()} items={shared?.considerations} guides={shared?.guides} categoryHref={ctaHref === '#product-grid' ? '/shop' : ctaHref} /></div>
      {chips.length > 0 && <nav aria-label={`Explore related ${label.toLowerCase()} collections`} className="category-hero__browse">
        <p>Explore more</p>
        <ul>{chips.map(chip => <li key={chip.href}><Link to={chip.href}>{chip.label}<ArrowUpRight size={13} aria-hidden="true" /></Link></li>)}</ul>
      </nav>}
    </div>
  );
}
