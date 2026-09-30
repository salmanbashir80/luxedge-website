import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef, useMemo, lazy, Suspense, Fragment, useSyncExternalStore } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate, Navigate, useParams, useSearchParams } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import MarketingManager from './components/MarketingManager';
import AdSenseAd from './components/AdSenseAd';
import CategoryHero, { categoryHeroConfig } from './components/CategoryHero';
import { BuyerGuidance } from './components/BuyerGuidance';
import { SiteSections, SiteFaq } from './components/SiteContent';
import { FaqContent } from './components/FaqContent';
import { ProductFactSections, ProductSpecRows } from './components/ProductFacts';
import { productFacts, FREE_SHIPPING_CLAIM } from './content/productFacts';
import { HOME_SECTIONS, HOME_FAQ, CONTACT_SECTIONS } from './content/sitePages';
import { isHeldBlog } from './content/reviewHolds';
import { authorFor } from './content/authors';
import { COPYRIGHT_SECTIONS, DISCLAIMER_SECTIONS, EDITORIAL_SECTIONS, PRIVACY_SECTIONS, RETURNS_SECTIONS, SHIPPING_SECTIONS, TERMS_SECTIONS, POLICY_LAST_UPDATED, FAQ_DATA } from './content/policies';
import { categoryContentFor } from './content/categoryContent';
import { NAV_PATHS, UTILITY_NAV, STRIP_NAV, MEGA_MENU, DRAWER_NAV, FOOTER_COLUMNS } from './content/navigation';
import { productContentFor } from './content/productContent';
import ProductGallery from './components/ProductGallery';
import CookieConsent from './components/CookieConsent';
import WelcomePopup from './components/WelcomePopup';
import AIAssistant from './components/AIAssistant';
import { trackEvent, utmParams } from './lib/marketing';
import { useAuthStore } from './store/authStore';
import { isSupabaseConfigured, updatePassword, updateUserMetadata, getAccessToken, getFreshAccessToken } from './services/supabase';
import { buyerActivate } from './services/buyerAuth';
import { loadProductByIdOrSlug, loadStorefrontCatalog, loadStorefrontPromotions, type CatalogProduct, type CatalogCategory, type StoreCoupon } from './services/catalog';
import { rankProducts, probeVisualQuality, markBrokenImage, subscribeVisualQuality, getVisualQualityVersion, type MerchStats } from './features/catalog/merchandising';
import { loadMerchStats } from './services/merch';
import { loadPublishedBlogs } from './services/blog';
import { MediaLatestSection } from './media/MediaHub';
import { SOCIAL_PROFILES } from './content/socialProfiles';
import { ABOUT_QUOTE, ABOUT_LEAD, ABOUT_SECTIONS } from './content/about';
import { parseStoredCart, reconcileCart, CART_STORAGE_KEY } from './services/cartSafety';
import { fetchCheckoutSessionStatus, type CheckoutSessionStatus } from './services/checkout';
import { verifyOnsitePayment as verifyOnsitePaymentApi } from './services/checkoutOnsite';
import { useWishlist, WishlistButton, configureWishlistAccount } from './features/wishlist/wishlist';
// On-site (PaymentElement) checkout — lazy so Stripe + the card form only load
// when a shopper actually reaches /checkout (keeps the storefront bundle lean).
const CheckoutOnsitePage = lazy(() => import('./features/checkout/CheckoutOnsitePage').then((m) => ({ default: m.default })));
import {
  ShoppingBag01, Menu01, X, SearchMd, User01 as UserIcon, LogOut01, Package, Building01,
  ShieldTick, Star01, Truck01, RefreshCcw01, Zap, ArrowRight, Mail01, Phone,
  MarkerPin01,  Plus, Minus, Trash01, Lock01, Loading01, CheckCircle,
  LayoutGrid01, AlertTriangle, Eye,
  ChevronDown, ChevronRight,
  Globe01, Clock, Send01, Headphones01, Stars01,
  EyeOff,
  Sliders01, Heart,
} from '@untitledui/icons';
import { YoutubeLogo } from '@phosphor-icons/react';

// ============================================================================
// TYPES
// ============================================================================
export interface ProductVariant {
  id: string; color: string; size: string; price: number; salePrice: number;
  stock: number; sku: string; image?: string;
}
export interface Product {
  id: string; name: string; shortDesc: string; description: string; price: number;
  originalPrice: number; category: string; stock: number;
  images: string[]; imageAlts: string[]; rating: number; reviews: number; isActive: boolean;
  brand: string; condition: string; tags: string[];
  weight: string; dimensions: string; origin: string;
  /** Raw owner-editable detail columns — formatted by src/content/productFacts.ts
   *  so the page and the worker pre-render publish the same rows. */
  longDescription?: string | null; features?: unknown; specifications?: unknown; weightOz?: number | null;
  freeShipping: boolean; shippingCost: string;
  variants: ProductVariant[];
  // Catalog Launch Phase — real merchandising data from the DB (never fake).
  featured?: boolean; newArrival?: boolean; saleEnabled?: boolean;
  /** Manual admin pin — products.sort_order > 0 ranks first (ascending). */
  sortOrder?: number;
  /** Row creation time — newest-first home merchandising. */
  createdAt?: string;
  stockStatus?: string; usInventory?: boolean;
  seoTitle?: string; seoDescription?: string; seoKeywords?: string[];
  slug?: string;
  supplierSource?: string;
  supplierProductRef?: string;
  supplierUrl?: string | null;
  safetyClass?: import('./features/catalog/productSafety').ProductSafetyClass | null;
  safetyReviewStatus?: import('./features/catalog/productSafety').ProductSafetyReviewStatus | null;
  intendedSpecies?: string | null;
  commerceReadiness?: string; sourceType?: string; inventorySource?: string;
  deliveryMinDays?: number | null; deliveryMaxDays?: number | null;
}
interface CartItem { product: Product; quantity: number; }
interface AppUser { id: string; email: string; name: string; role: 'admin' | 'buyer'; password?: string; isBlocked?: boolean; joined?: string; }
export interface Order {
  id: string; userId: string; userName: string; items: CartItem[];
  total: number; status: string; date: string; address?: string;
}
export interface Review {
  id: string; productId: string; productName: string; userName: string;
  rating: number; comment: string; status: 'pending' | 'approved' | 'rejected';
  date: string;
}
export interface AdminCategory { id: string; name: string; slug?: string; isActive: boolean; subs: { id: string; name: string; isActive: boolean; }[]; }
export interface BlogPost {
  id: string; slug: string; title: string; excerpt: string; content: string;
  image: string; images: string[]; tags: string[];
  authorId: string; authorName: string;
  status: 'published' | 'draft' | 'pending';
  date: string;
  /** Visible, factual FAQ section — mirrored into FAQPage JSON-LD. Never schema-only. */
  faq?: { q: string; a: string }[];
}

// Branded image fallback (cream + Luxedge wordmark) so a failed image never
// shows a broken-image icon. Inline SVG — no external asset dependency.
const LUXEDGE_IMAGE_FALLBACK = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'><rect width='100%' height='100%' fill='#F6F3EE'/><text x='50%' y='50%' font-family='Georgia, serif' font-size='64' letter-spacing='6' fill='#1A2440' text-anchor='middle' dominant-baseline='middle'>LUXEDGE</text></svg>"
);

/** Proxy CJ/external images through our worker to bypass CORS/ORB. */
function proxiedImage(src: string): string {
  if (!src || src.startsWith('data:')) return src;
  try {
    const u = new URL(src);
    const hosts = ['cf.cjdropshipping.com', 'oss-cf.cjdropshipping.com', 'img.ltwebstatic.com', 'ae01.alicdn.com'];
    if (hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) {
      return '/api/img-proxy?url=' + encodeURIComponent(src);
    }
  } catch { /* not a URL, use as-is */ }
  return src;
}

/** Swap a broken image to the branded fallback once (never loops). */
function onImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.onerror = null;
  if (img.src !== LUXEDGE_IMAGE_FALLBACK) img.src = LUXEDGE_IMAGE_FALLBACK;
}


// ============================================================================
// AI IMPORT ENGINE — extracted to src/features/ai/* (SECURITY: provider keys
// are server-side only; the browser proxies through /api/ai/*)
// ============================================================================
import { classifyProductSafety } from './features/catalog/productSafety';
import GiftDropPage from './features/giftDrop/GiftDropPage';
import CampaignLanding from './features/campaigns/CampaignLanding';
import CampaignPopup from './features/campaigns/CampaignPopup';
import { productPath } from './features/catalog/seo';

import type {
  AIProvider, ImportHistoryEntry, AIExtractedProduct, EnterpriseVariant,
  VariantAttribute, SEOData, SocialSEO, ContentData, SEOScore, StructuredSchemas,
} from "./features/ai/types";
import {
  DEFAULT_AI_PROVIDERS, loadAIProviders, saveAIProviders, resolveActiveProvider,
} from "./features/ai/providers";
import {
  callAIProvider, serverGenerate, serverTestProvider,
  serverOpenRouterCredits, serverProviderStatus,
} from "./features/ai/client";
import type { ProviderStatus, ProviderStatusMap } from "./features/ai/client";
import {
  fetchPageContent, buildExtractionPrompt, extractProductJson, parseHtmlPage,
  normalizeProductTitle, extractAliExpressItemId, assessAliExpressRisk,
  deriveImportReadiness, findDuplicateProduct, buildImportImages,
  buildImportVariants, buildImportProductInput,
  buildStorageImageInputs, importProductImagesToStorage,
  buildUrlEvidenceProduct, buildScrapedEvidenceProduct, mergeScrapedWithAi, requireReviewEvidence,
  extractAliExpressUrlEvidence, isEmptyExtraction,
} from "./features/ai/importer";

// Re-exported so existing consumers (e.g. the admin section importing from
// "../App") keep working without change.
export type {
  AIProvider, ImportHistoryEntry, AIExtractedProduct, EnterpriseVariant,
  VariantAttribute, SEOData, SocialSEO, ContentData, SEOScore, StructuredSchemas,
  ProviderStatus, ProviderStatusMap,
};
export {
  DEFAULT_AI_PROVIDERS, loadAIProviders, saveAIProviders, resolveActiveProvider,
  callAIProvider, serverGenerate, serverTestProvider, serverOpenRouterCredits,
  serverProviderStatus,
  fetchPageContent, buildExtractionPrompt,
  extractProductJson, parseHtmlPage, normalizeProductTitle,
  extractAliExpressItemId, assessAliExpressRisk, deriveImportReadiness,
  findDuplicateProduct, buildImportImages, buildImportVariants,
  buildImportProductInput, buildStorageImageInputs, importProductImagesToStorage,
  buildUrlEvidenceProduct, buildScrapedEvidenceProduct, mergeScrapedWithAi, requireReviewEvidence,
  extractAliExpressUrlEvidence, isEmptyExtraction,
};


// ============================================================================
// DATA
// (demo catalog constants removed — the storefront is DB-driven only; no fake
// products, fake ratings, or fake orders anywhere in the customer path)

// (demo admin credentials removed in Phase 3A — admin auth is Supabase-only)

// Map a Supabase catalog row to the storefront Product shape WITHOUT
// fabricating anything: ratings stay 0 (the UI shows stars only for verified
// user reviews), dimensions/origin stay empty, no shipping promises.
function mapCatalogProduct(p: CatalogProduct): Product {
  return {
    id: p.id,
    name: p.name,
    shortDesc: p.shortDesc,
    description: p.description,
    price: p.price,
    originalPrice: p.originalPrice,
    category: p.category || 'Pet Supplies',
    stock: p.stock,
    images: p.images.length ? p.images.map(proxiedImage) : [],
    // Ensure primary (hero) image is always first
    // (catalog may return images in insertion order, not primary-first)
    imageAlts: p.imageAlts || [],
    rating: 0,
    reviews: 0,
    isActive: p.isActive,
    // No brand is claimed when the catalog has none: Luxedge is the store, not
    // the manufacturer of these third-party goods, so a default here would be a
    // fabricated brand fact shown on the page (and now omitted from JSON-LD).
    brand: p.brand || '',
    condition: 'New',
    tags: p.tags,
    weight: '',
    dimensions: '',
    origin: '',
    longDescription: p.longDescription ?? null,
    features: p.features,
    specifications: p.specifications,
    weightOz: p.weightOz ?? null,
    freeShipping: p.freeShipping,
    shippingCost: '',
    featured: p.featured,
    newArrival: p.newArrival,
    saleEnabled: p.saleEnabled,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    stockStatus: p.stockStatus,
    usInventory: p.usInventory,
    commerceReadiness: p.commerceReadiness,
    sourceType: p.sourceType,
    deliveryMinDays: p.deliveryMinDays,
    deliveryMaxDays: p.deliveryMaxDays,
    inventorySource: p.inventorySource,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    seoKeywords: p.seoKeywords,
    slug: p.slug,
    supplierSource: p.supplierSource,
    supplierProductRef: p.supplierProductRef,
    supplierUrl: p.supplierUrl,
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      color: v.attributes?.color || '',
      size: v.attributes?.size || 'One Size',
      price: v.price ?? p.price,
      salePrice: v.price ?? p.price,
      stock: v.inventoryQty,
      sku: v.sku,
      image: v.image || undefined,
    })),
  };
}

function mapCatalogCategory(c: CatalogCategory): AdminCategory {
  return { id: c.id, name: c.name, slug: c.slug, isActive: c.isActive, subs: [] };
}
// Demo buyer rows for the admin Users panel — no credentials (Phase 3A: real
// users come from Supabase Auth and are never represented with passwords).
// No fake customers — real users come from Supabase auth. Admin lists show
// real profiles only (empty until they exist).
const INIT_USERS: AppUser[] = [];

// No fake order history or reviews: real orders come from the Stripe webhook
// (luxedge_orders, shown in Admin → Orders) and real reviews do not exist
// yet. The storefront must never display invented customers or ratings.
const INIT_REVIEWS: Review[] = [];

const INIT_CATEGORIES: AdminCategory[] = [
  { id: 'c1', name: 'Dog Supplies', isActive: true, subs: [{ id: 'c1s1', name: 'Dogs', isActive: true }, { id: 'c1s2', name: 'Puppies', isActive: true }] },
  { id: 'c2', name: 'Cat Supplies', isActive: true, subs: [{ id: 'c2s1', name: 'Cats', isActive: true }, { id: 'c2s2', name: 'Kittens', isActive: true }] },
  { id: 'c3', name: 'Pet Beds', isActive: true, subs: [] },
  { id: 'c4', name: 'Pet Toys', isActive: true, subs: [] },
  { id: 'c5', name: 'Feeding & Water', isActive: true, subs: [] },
  { id: 'c6', name: 'Grooming', isActive: true, subs: [] },
  { id: 'c7', name: 'Pet Accessories', isActive: true, subs: [] },
];

const INIT_BLOGS: BlogPost[] = [
  { id:'b19', slug:'best-bird-feeder-buyers-guide', title:'How to Choose the Best Bird Feeder for Your Backyard: 2026 Buyer\u2019s Guide', excerpt:'Tube, hopper, or tray? Seed or no-seed? Here is exactly how to pick a bird feeder that fits your yard and attracts the birds you want.', content:'A well-chosen bird feeder turns any yard into a daily wildlife show. With a little planning you can attract cardinals, finches, chickadees, and jays — and keep them coming back all year.\n\n## Decide What You Want to Attract\nDifferent feeders suit different birds. Tube feeders favor finches and chickadees, hopper feeders attract cardinals and jays, and tray feeders draw ground feeders like doves. If you are new to bird feeding, start with one versatile feeder and see who shows up.\n\n## Pick a Weather-Resistant Design\nSeed that gets wet molds quickly and can make birds sick. Look for a feeder with a covered roof, drainage holes, and sealed seed chambers. An [Outdoor Hanging Bird Feeder](/product/outdoor-hanging-bird-feeder) that keeps seed dry through rain and snow is the single most important choice you can make.\n\n## Match the Seed to the Birds\nBlack-oil sunflower brings the widest variety of birds, while millet and safflower appeal to specific species and deter squirrels. Match the blend to the birds you hope to attract, and store it in an [Outdoor Hanging Bird Feeder](/product/outdoor-hanging-bird-feeder) with a sealed seed chamber to keep the mix dry and fresh between fillings.\n\n## Add Water, and Birds Will Stay\nBirds need fresh water for drinking and bathing year-round. A [Solar Bird Bath Fountain](/product/solar-bird-bath-fountain) keeps water moving — moving water is far more attractive to birds and stays cleaner longer.\n\n## Placement Makes the Difference\nHang feeders 5–10 feet from cover so birds have a quick escape route from predators, but close enough to a window to enjoy. Keep cats indoors and clean feeders every couple of weeks with a mild bleach solution.\n\n## Be Consistent\nBirds learn reliable food sources. Once you start feeding, keep the feeder stocked through the seasons — especially in winter when natural food is scarce. Consistency builds a loyal backyard flock.\n\n## The Bottom Line\nStart simple: one weatherproof feeder, a quality seed mix, and a clean water source. That combination reliably attracts birds and makes your yard the most visited spot on the block.', image:'https://images.pexels.com/photos/7517035/pexels-photo-7517035.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['bird feeder','wild birds','backyard','bird care'], authorId:'adm', authorName:'Admin', status:'published', date:'2026-08-18' },
  { id:'b20', slug:'horse-grooming-kit-buyers-guide', title:'The Horse Grooming Kit Buyer\u2019s Guide: What to Buy, What to Skip', excerpt:'Curry comb, brushes, hoof pick — what does a horse actually need? This guide breaks down the essentials and what to skip to save money.', content:'Grooming is part of daily horse care, but you do not need a wall of brushes to do it right. A focused kit covers the essentials and lasts for years if you choose well.\n\n## Start with the Core Five\nA complete basic kit has five pieces: a curry comb to loosen dirt and mud, a stiff body brush, a soft brush for the face and sensitive areas, a hoof pick, and a mane-and-tail brush. That is genuinely all you need for most horses.\n\n## Buy a Set, Not a Grab Bag\nBuying pieces separately usually costs more and leaves gaps. A coordinated [12-Piece Horse Grooming Kit](/product/horse-grooming-kit-12-piece) with a storage bag covers the core tools plus extras like a shedding blade and finishing brushes — and the bag keeps everything organized at the barn.\n\n## Grooming Is About More Than Looks\nDaily grooming removes sweat and dirt, spreads natural oils, and — most importantly — gives you a chance to check for cuts, swelling, heat, or skin issues before they become problems. It is also the best bonding time you will have with your horse.\n\n## Don\u2019t Forget the Head\nFlies and sun bother horses constantly. A [Horse Fly Mask with Ears](/product/horse-fly-mask-with-ears) protects the face and eyes during turnout, and comfortable handling gear makes turnout and grooming safer and easier.\n\n## What to Skip\nSkip fancy scented shampoos, expensive detanglers, and oversized kits with tools you will never use. Horses rarely need frequent baths — spot-cleaning plus daily brushing does the job.\n\n## Care for the Kit\nHang brushes to dry, pick out the curry comb after each use, and replace anything with broken bristles. A well-maintained kit lasts years and costs far less per grooming session than cheap replacements.\n\n## The Bottom Line\nA complete 12-piece kit and a fly mask give you everything a happy, healthy horse needs. Start there and add specialty tools only when your routine genuinely calls for them.\n\n## Frequently Asked Questions\n\n### What do I need in a basic horse grooming kit?\nA complete basic kit has five pieces: a curry comb to loosen dirt, a stiff body brush, a soft brush for the face and sensitive areas, a hoof pick, and a mane-and-tail brush. That is genuinely all you need for most horses.\n\n### Do I need a full set when I\u2019m just starting out?\nA coordinated kit like the [12-Piece Horse Grooming Kit](/product/horse-grooming-kit-12-piece) covers the core five plus extras such as a shedding blade and finishing brushes. Starting with a set usually costs less than buying pieces separately, and you can add specialty tools later if your routine calls for them.\n\n### How often should I groom my horse?\nDaily grooming removes dirt, sweat, and loose hair, spreads natural oils, and gives you a chance to check for cuts, swelling, heat, or skin issues before they become problems. Even ten minutes a day is worthwhile.\n\n### How do I care for my grooming brushes?\nHang brushes to dry after use, pick out the curry comb each time, and replace anything with broken bristles. A well-maintained kit lasts years.\n\n### Should I bathe my horse often?\nHorses generally do not need frequent baths — over-bathing strips natural oils. Spot-clean and save full baths for shows or very dirty days.', image:'https://images.pexels.com/photos/1466205/pexels-photo-1466205.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['horse','grooming','equestrian','buyers guide'], authorId:'adm', authorName:'Admin', faq:[{ q:'What do I need in a basic horse grooming kit?', a:'A complete basic kit has five pieces: a curry comb to loosen dirt, a stiff body brush, a soft brush for the face and sensitive areas, a hoof pick, and a mane-and-tail brush.' },{ q:'Do I need a full set when I am just starting out?', a:'A coordinated 12-piece kit covers the core five plus extras such as a shedding blade and finishing brushes. Starting with a set usually costs less than buying pieces separately.' },{ q:'How often should I groom my horse?', a:'Daily grooming removes dirt, sweat, and loose hair, spreads natural oils, and lets you check for cuts, swelling, heat, or skin issues from minor problems. Even ten minutes a day is worthwhile.' },{ q:'How do I care for my grooming brushes?', a:'Hang brushes to dry after use, pick out the curry comb each time, and replace anything with broken bristles.' },{ q:'Should I bathe my horse often?', a:'Horses generally do not need frequent baths, since over-bathing strips natural oils. Spot-clean and save full baths for shows or very dirty days.' }], status:'published', date:'2026-08-11' },
  { id:'b26', slug:'horse-halter-lead-rope-buyers-guide', title:'How to Choose a Horse Halter & Lead Rope (Sizing + Fit)', excerpt:'Halters come in many sizes, but fit is what keeps a horse safe. Learn how to size a halter, pick a material, and pair it with the right lead rope.', content:'Choosing a halter is not about brand \u2014 it is about fit. A halter that fits correctly stays on safely, is comfortable for the horse, and makes daily handling, grooming, and leading easier. Here is how to size one, what material to pick, and how to pair it with the right lead rope.\n\n## Why Fit Matters More Than Brand\nA loose halter can slip over a horse\u2019s ears; a tight one can rub sores or cause discomfort. Fit, not price, is what keeps the halter on safely and comfortably. A correctly fitted halter also makes leading and cross-tying predictable, which is why fit matters more than the label.\n\n## How to Size a Horse Halter\n- Measure around the nose (just below the cheekbones) and over the crown behind the ears.\n- Compare those two measurements to the maker\u2019s sizing chart \u2014 a yearling often fits a pony-sized halter better than a mature horse\u2019s size.\n- Rule of thumb on the ground: fit two fingers flat under the noseband and crown once buckled, and make sure the cheek strap does not pull toward or pinch the eye.\n\n## Nylon vs Leather vs Rope\n- **Nylon:** tough, inexpensive, easy to wash \u2014 the most common choice for daily turn-out and travel.\n- **Leather:** classic show look, softer on sensitive skin, but needs more care and can weaken when soaked.\n- **Rope:** lightweight and strong, popular for groundwork, less forgiving if misused.\n- For a first halter or everyday handling, an adjustable nylon halter is the practical default. Adjustable crown fixtures also let one halter last as a foal grows.\n\n## Matching the Lead Rope\n- A lead rope about 8\u201310 feet gives you reach for leading and tying without excess drag.\n- A sturdy snap or clip attaches without chafing the jaw or twisting the halter ring.\n- Lead ropes for groundwork are thicker and stiffer than everyday leads.\n\n## A Natural Pair in Your Routine\nA halter and lead rope work alongside the daily handling basics covered in our [Horse Grooming Kit Buyer\u2019s Guide](/blog/horse-grooming-kit-buyers-guide) \u2014 grooming, leading, and cross-tying all start with a safe head-catch. Keeping your horse comfortable there pairs naturally with a [Himalayan salt lick](/blog/horse-salt-lick-buyers-guide) hung at nose height in the stall.\n\n**Shop the category \u2192 [Horse Supplies](/category/horse)**\n\n**Related product \u2192 [Horse Fly Mask with Ears](/product/horse-fly-mask-with-ears)**\n\n## Care\nRinse mud and sweat off, let it dry fully, and check the hardware for sharp edges or cracks before each use. Replace a halter with frayed stitching or a failing clasp.\n\n## Frequently Asked Questions\n\n### How tight should a horse halter fit?\nSnug but not pinching \u2014 about two fingers\u2019 width under the noseband and crown, with no pressure on the eyes or windpipe.\n\n### What size halter does my horse need?\nMeasure around the nose and over the crown, then compare those numbers to the maker\u2019s chart. Size by measurement, not by age or breed name.\n\n### Is a nylon or leather halter better?\nFor daily turn-out and most buyers, an adjustable nylon halter is durable, affordable, and easy to clean. Leather suits shows but needs more care.\n\n### How long should a lead rope be?\nAbout 8\u201310 feet is the practical all-round length for leading, tying, and groundwork.', image:'https://images.pexels.com/photos/1055436/pexels-photo-1055436.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['horse','halter','lead rope','equestrian','buyers guide'], authorId:'adm', authorName:'Admin', faq:[{ q:'How tight should a horse halter fit?', a:'Snug but not pinching \u2014 about two fingers\u2019 width under the noseband and crown, with no pressure on the eyes or windpipe.' },{ q:'What size halter does my horse need?', a:'Measure around the nose and over the crown, then compare those numbers to the maker\u2019s chart. Size by measurement, not by age or breed name.' },{ q:'Is a nylon or leather halter better?', a:'For daily turn-out and most buyers, an adjustable nylon halter is durable, affordable, and easy to clean. Leather suits shows but needs more care.' },{ q:'How long should a lead rope be?', a:'About 8\u201310 feet is the practical all-round length for leading, tying, and groundwork.' }], status:'published', date:'2026-08-29' },
  { id:'b27', slug:'horse-fly-mask-buyers-guide', title:'How to Choose a Horse Fly Mask (Fit, Material + UV)', excerpt:'The right fly mask shades a horse\u2019s eyes and ears from flies and sun. Learn how to size one, what a mask with ears covers, and how tight it should sit.', content:'A good fly mask shields the eyes and, on \u201cears\u201d versions, the ears from biting flies, dust, and UV \u2014 while still letting the horse see clearly. Measure around the head just behind the ears and follow the maker\u2019s sizing chart; a mask with ears covers more of the face down to the nose. It should sit snug \u2014 roughly one or two fingers\u2019 width under the jaw \u2014 with no seam pressing on the eyes or tearing at the corners.\n\n## What a Fly Mask Actually Protects\nA fly mask is a mesh head covering that keeps flies, gnats, and debris away from the eyes, forehead, and \u2014 on ears models \u2014 the ears themselves. Many mesh masks also block a portion of UV, which matters for horses with pale skin or light muzzles.\n\n## Fit Is the Number-One Factor\n- Measure around the head just behind the ears and ahead of the poll, then compare to the maker\u2019s chart \u2014 sizes vary by brand.\n- The mask should touch the face evenly: no flapping loose that lets flies or debris reach the eye, and no pressure points.\n- **Rule of thumb:** you should fit one or two fingers under the cheek or side strap once fastened, and the eye mesh should float slightly in front of the eyes rather than touching them.\n- Check that seams and edges do not rub the eye corners or the bridge of the nose.\n\n## Mask with Ears vs Open-Crown\n- **Mask with ears:** covers the ears (often a weak spot for biting flies) and shades a little more skin. Best for horses bothered by ear-biting flies.\n- **Open-crown or standard:** lighter and cooler for mild fly days, and leaves the ears free.\n- Match the style to your fly pressure and coverage needs rather than looks alone \u2014 that gets the better result.\n\n## Material, UV, and Durability\n- Look for a breathable mesh that still blocks UV if the horse is sun-sensitive.\n- Rope- or buckle-style closures hold better in the field than a simple snap if the horse rubs on posts.\n- Wash the mask regularly; salt from sweat dries stiff and can rub. A clean mask fits and protects like new.\n\n## Pair It with the Rest of the Turnout Kit\nA fly mask is part of a horse\u2019s daily handling setup. It works alongside a properly fitted [halter and lead rope](/blog/horse-halter-lead-rope-buyers-guide) for leading to and from turn-out, and comfortable fly season starts with the same grooming habits covered in our [Horse Grooming Kit Buyer\u2019s Guide](/blog/horse-grooming-kit-buyers-guide). In the stall, many owners hang the daily [salt lick at nose height](/blog/horse-salt-lick-placement-guide) once the mask comes off.\n\n**Shop the category \u2192 [Horse Supplies](/category/horse)**\n\n**Related product \u2192 [Horse Fly Mask with Ears \u2014 UV Protection](/product/horse-fly-mask-with-ears)**\n\n## Care\nShake out hay and debris, hand-wash in cool water, and let it dry in the shade. Check the mesh each use for tears or stretched seams, and replace a mask that no longer holds its shape.\n\n## Frequently Asked Questions\n\n### How tight should a horse fly mask fit?\nSnug but not pinching \u2014 about one or two fingers\u2019 width under the side strap, with the eye mesh sitting in front of the eyes without touching them.\n\n### What does a fly mask with ears protect?\nIt covers the ears, forehead, and face at the eyes and nose in addition to the usual eye area, protecting more skin from biting flies and sun.\n\n### Does a horse fly mask block UV?\nMany mesh masks block a portion of UV. If your horse has sensitive pale skin, choose a mask that states UV protection.\n\n### Should I buy a fly mask with or without ears?\nIf biting flies target your horse\u2019s ears, a mask with ears is the better choice. For mild fly days, a standard open-crown mask is cooler.', image:'https://images.pexels.com/photos/258083/pexels-photo-258083.jpeg?auto=compress&cs=tinysrgb&w=800', images:[], tags:['horse','fly mask','horse care','summer','equestrian'], authorId:'adm', authorName:'Admin', faq:[{ q:'How tight should a horse fly mask fit?', a:'Snug but not pinching \u2014 about one or two fingers\u2019 width under the side strap, with the eye mesh sitting in front of the eyes without touching them.' },{ q:'What does a fly mask with ears protect?', a:'It covers the ears, forehead, and face at the eyes and nose in addition to the usual eye area, protecting more skin from biting flies and sun.' },{ q:'Does a horse fly mask block UV?', a:'Many mesh masks block a portion of UV. If your horse has sensitive pale skin, choose a mask that states UV protection.' },{ q:'Should I buy a fly mask with or without ears?', a:'If biting flies target your horse\u2019s ears, a mask with ears is the better choice. For mild fly days, a standard open-crown mask is cooler.' }], status:'published', date:'2026-08-29' },
];

// The CMS is the live source of truth. This fallback is intentionally limited
// so a temporary CMS outage cannot bring retired or low-quality articles back
// into public view.
//
// It lists EXACTLY the guides that have bundled fallback content in INIT_BLOGS
// (asserted by src/content/__tests__/fallback-blog-parity.test.ts). Four of the
// eight live guides — how-to-clean-a-bird-feeder,
// how-to-choose-cattle-trough-feed-water-setup, how-to-fit-no-pull-dog-harness
// and how-to-choose-a-cat-tunnel — exist only in the CMS, and deliberately have
// no bundled copy: while the CMS is unreachable the worker serves the blog
// routes as a noindex 503 rather than stale HTML, so an offline duplicate would
// only risk serving superseded text.
const RETAINED_FALLBACK_BLOG_SLUGS = new Set([
  'best-bird-feeder-buyers-guide',
  'horse-grooming-kit-buyers-guide',
  'horse-halter-lead-rope-buyers-guide',
  'horse-fly-mask-buyers-guide',
]);
const SAFE_INIT_BLOGS = INIT_BLOGS.filter((post) => RETAINED_FALLBACK_BLOG_SLUGS.has(post.slug));

export const CAT_LIST = ['All', 'Dog Supplies', 'Cat Supplies', 'Pet Beds', 'Pet Toys', 'Feeding & Water', 'Grooming', 'Pet Accessories', 'Bird Supplies', 'Horse', 'Cattle'];
const CAT_META: Record<string, { desc: string }> = {
  'Dog Supplies': { desc: 'Walking, training & everyday dog essentials' },
  'Cat Supplies': { desc: 'Play, comfort & everyday cat essentials' },
  'Pet Beds': { desc: 'Comfort-led pieces for deeper rest' },
  'Pet Toys': { desc: 'Interactive play and everyday enrichment' },
  'Feeding & Water': { desc: 'Considered pieces for daily mealtimes' },
  'Grooming': { desc: 'Simple tools for everyday care' },
  'Pet Accessories': { desc: 'Useful pieces for life together' },
  'Bird Supplies': { desc: 'Seed, feed & care essentials for feathered friends' },
  'Horse': { desc: 'Practical care and stable essentials for horses' },
  'Cattle': { desc: 'Useful feeding and care essentials for cattle and livestock' },
};

function firstUsableImage(product: Product | undefined): string | undefined {
  const raw = product?.images.find((image) => Boolean(image));
  return raw ? proxiedImage(raw) : undefined;
}
const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const fromSlug = (slug: string) => CAT_LIST.find(c => toSlug(c) === slug) || 'All';

// ============================================================================
// CONTEXT
// ============================================================================
interface Ctx {
  user: AppUser | null; cart: CartItem[];
  products: Product[]; users: AppUser[]; reviews: Review[]; categories: AdminCategory[];
  blogs: BlogPost[]; setBlogs: React.Dispatch<React.SetStateAction<BlogPost[]>>;
  reloadBlogs: (forceFresh?: boolean) => Promise<void>;
  login: (e: string, p: string, admin?: boolean) => Promise<{ message: string | null; code?: string }>;
  guestLogin: () => void;
  logout: () => void; signup: (n: string, e: string, p: string) => Promise<string | null>;
  changePassword: (current: string, newPass: string) => Promise<{ ok: boolean; msg: string }>;
  updateAdminProfile: (name: string, email: string) => void;
  addToCart: (p: Product) => void; removeFromCart: (id: string) => void;
  updateQty: (id: string, q: number) => void; clearCart: () => void;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>;
  setCategories: React.Dispatch<React.SetStateAction<AdminCategory[]>>;
  cartOpen: boolean; openCart: () => void; closeCart: () => void;
  notif: { msg: string; type: 'success' | 'error' | 'info' } | null;
  notify: (m: string, type?: 'success' | 'error' | 'info') => void;
  // Catalog Launch Phase — coupons + free-shipping strategy from the store.
  merchStats: Map<string, MerchStats>;
  coupon: StoreCoupon | null;
  applyCoupon: (code: string) => string | null;
  removeCoupon: () => void;
  freeShippingEnabled: boolean;
  freeShippingThreshold: number;
}
const defaultAppContext: Ctx = {
  user: null,
  cart: [],
  products: [],
  users: [],
  reviews: [],
  categories: [],
  blogs: [],
  setBlogs: () => {},
  reloadBlogs: async () => {},
  login: async () => ({ message: null }),
  guestLogin: () => {},
  logout: () => {},
  signup: async () => null,
  changePassword: async () => ({ ok: false, msg: '' }),
  updateAdminProfile: () => {},
  addToCart: () => {},
  removeFromCart: () => {},
  updateQty: () => {},
  clearCart: () => {},
  setProducts: () => {},
  setUsers: () => {},
  setReviews: () => {},
  setCategories: () => {},
  cartOpen: false,
  openCart: () => {},
  closeCart: () => {},
  notif: null,
  notify: () => {},
  merchStats: new Map(),
  coupon: null,
  applyCoupon: () => null,
  removeCoupon: () => {},
  freeShippingEnabled: false,
  freeShippingThreshold: 50,
};

const AC = createContext<Ctx>(defaultAppContext);
export function useApp(): Ctx {
  const c = useContext(AC);
  return c || defaultAppContext;
}

// Cart persistence uses the catalog-safe v2 key (legacy demo-era payload is
// purged on load — Phase 4E.2A hotfix behavior, kept on luxedge-v2).
function loadCart(): CartItem[] {
  return parseStoredCart<Product>();
}

const SESSION_STORAGE_KEY = 'luxedge_session';

function loadSession(): AppUser | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const u = parsed as Partial<AppUser>;
    if (
      typeof u.id === 'string' &&
      typeof u.email === 'string' &&
      typeof u.name === 'string' &&
      (u.role === 'admin' || u.role === 'buyer')
    ) {
      return { id: u.id, email: u.email, name: u.name, role: u.role, isBlocked: u.isBlocked, joined: u.joined };
    }
    return null;
  } catch {
    return null;
  }
}

function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(loadSession);
  const [cart, setCart] = useState<CartItem[]>(loadCart);

  // Bind the wishlist to the signed-in Supabase account (server persistence,
  // RLS-scoped) or back to the device list on logout. Guests (no real Supabase
  // identity) stay device-local. The module hydrates/merges on its own.
  useEffect(() => {
    if (user && !user.id.startsWith('guest-')) {
      let cancelled = false;
      void getFreshAccessToken().then((token) => {
        if (!cancelled) configureWishlistAccount(token ? { userId: user.id, token } : null);
      });
      return () => { cancelled = true; };
    }
    configureWishlistAccount(null);
  }, [user?.id]);
  // Phase 4E.1 — the storefront catalog starts EMPTY. Demo/fallback products
  // must NEVER appear when the database has no published products; only the
  // qualified/approved pipeline may populate the customer-facing catalog.
  const [products, setProducts] = useState<Product[]>([]);
  // Smart merchandising — per-product performance stats from /api/merch-stats.
  // Empty map when unavailable (grids fall back to flag/availability ordering).
  const [merchStats, setMerchStats] = useState<Map<string, MerchStats>>(new Map());
  const [users, setUsers] = useState<AppUser[]>(INIT_USERS);
  const [reviews, setReviews] = useState<Review[]>(INIT_REVIEWS);
  const [categories, setCategories] = useState<AdminCategory[]>(INIT_CATEGORIES);
  const [blogs, setBlogs] = useState<BlogPost[]>(SAFE_INIT_BLOGS);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase B: blog content lives in the Supabase CMS. Until the CMS is seeded
  // (or the DB is unreachable / table not migrated) we keep SAFE_INIT_BLOGS as a
  // migration/rollback fallback; once the CMS returns real posts they become
  // the source of truth. Publishing from the Admin Blog Manager updates the
  // DB, and reloadBlogs() refreshes this in-memory list WITHOUT any deploy.
  const reloadBlogs = useCallback(async (forceFresh = false) => {
    const posts = await loadPublishedBlogs({ forceFresh });
    // Only switch to CMS when it returned actual posts — null (failure) or an
    // empty DB keeps the last-known set so a DB blip never blanks the blog.
    if (posts && posts.length > 0) setBlogs(posts);
  }, []);
  useEffect(() => { void reloadBlogs(); }, [reloadBlogs]);
  // Stable identity: components (e.g. CatalogProductEditor) depend on `notify`
  // inside useCallback/useEffect deps. An unmemoized notify was recreated on
  // every AppProvider render, which itself re-renders every time notify()
  // fires (setNotif) — so calling notify() during editing (e.g. "Image
  // added") retriggered any effect that listed notify as a dependency,
  // silently reloading/resetting in-progress form state right after the
  // update it was supposed to confirm.
  const notify = useCallback((m: string, _type?: 'success' | 'error' | 'info') => {
    // Replace any pending toast instead of letting the old timer clear the
    // new one early (previously a second notify within 3s vanished almost
    // immediately).
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotif({ msg: m, type: _type ?? 'success' });
    notifTimer.current = setTimeout(() => setNotif(null), 3000);
  }, []);
  const [cartOpen, setCartOpen] = useState(false);
  const openCart = useCallback(() => {
    setCartOpen((wasOpen) => {
      if (!wasOpen && cart.length > 0) trackEvent('view_cart', { currency: 'USD', value: cart.reduce((s, i) => s + i.product.price * i.quantity, 0), items: cart.map(i => ({ item_id: i.product.id, item_name: i.product.name, price: i.product.price, quantity: i.quantity })), ...utmParams() });
      return true;
    });
  }, [cart]);
  const closeCart = useCallback(() => setCartOpen(false), []);

  // Phase 3B: load the real storefront catalog from Supabase when it is
  // configured and populated. On any failure (unconfigured, unreachable,
  // empty DB) the catalog stays EMPTY — never demo/fallback products.
  useEffect(() => {
    let cancelled = false;
    void loadStorefrontCatalog().then((cat) => {
      if (cancelled) return;
      if (cat) {
        // Catalog load completed (even with zero products) — the cart can
        // now be safely reconciled against the real customer-visible set.
        setCatalogLoaded(true);
        if (cat.products.length) setProducts(cat.products.map(mapCatalogProduct));
        if (cat.categories.length) setCategories(cat.categories.map(mapCatalogCategory));
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Smart merchandising — load per-product stats (session-cached) and probe
  // the visual quality of the strongest candidates once data is ready.
  useEffect(() => {
    let cancelled = false;
    void loadMerchStats().then((m) => { if (!cancelled) setMerchStats(m); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (products.length === 0) return;
    const ranked = rankProducts(products, { stats: merchStats, explore: false });
    const top = ranked.slice(0, 12).map((p) => ({ id: p.id, url: p.images && p.images[0] ? proxiedImage(p.images[0]) : undefined }));
    let cancelled = false;
    const run = () => { if (!cancelled) void probeVisualQuality(top, { budget: 12, concurrency: 2 }); };
    const w = window as unknown as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number };
    const idle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 3000 }) : 0;
    // Fallback timer: idle may never fire on some engines.
    const safety = window.setTimeout(run, 3000);
    return () => { cancelled = true; window.clearTimeout(safety); if (idle) window.clearTimeout(idle); };
  }, [products, merchStats]);

  // Catalog Launch Phase — load store promotions (coupons + free-shipping
  // strategy). Safe defaults when unavailable (no coupons, free shipping off).
  const [promotions, setPromotions] = useState<{ coupons: StoreCoupon[]; freeShippingEnabled: boolean; freeShippingThreshold: number }>({
    coupons: [], freeShippingEnabled: false, freeShippingThreshold: 50,
  });
  const [coupon, setCoupon] = useState<StoreCoupon | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadStorefrontPromotions().then((pro) => { if (!cancelled) setPromotions(pro); });
    return () => { cancelled = true; };
  }, []);

  const applyCoupon = (code: string): string | null => {
    const found = promotions.coupons.find((c) => c.code === code.trim().toUpperCase());
    if (!found) return 'Coupon not found';
    if (found.usageLimit != null && found.usedCount >= found.usageLimit) return 'This coupon has reached its usage limit';
    if (found.endAt && new Date(found.endAt) < new Date()) return 'This coupon has expired';
    setCoupon(found);
    return null;
  };
  const removeCoupon = () => setCoupon(null);

  // Persist the cart so items survive a page refresh.
  useEffect(() => {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch { /* storage full or unavailable */ }
  }, [cart]);

  // Catalog Launch Phase defense in depth: the cart may only contain
  // products that exist in the current customer-visible catalog. Once the
  // catalog has actually loaded, any stored item not in it is stale and is
  // reconciled away — a manually-restored malformed payload never survives.
  // (Only runs after a successful catalog load, so a DB outage never wipes
  // a valid cart.)
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  useEffect(() => {
    if (!catalogLoaded) return;
    setCart(prev => {
      const valid = reconcileCart(prev, products);
      // Refresh each surviving line's product snapshot from the current
      // catalog so repriced/updated listings always show live prices
      // (quantity is kept — only the product data is re-synced).
      const refreshed = valid.map(i => {
        const cur = products.find(p => p.id === i.product.id);
        return cur ? { ...i, product: cur } : i;
      });
      const changed = refreshed.length !== prev.length || refreshed.some((i, idx) => {
        const old = prev[idx];
        return !old || old.product.price !== i.product.price || old.product.name !== i.product.name;
      });
      return changed ? refreshed : prev;
    });
  }, [catalogLoaded, products]);

  // Persist the signed-in user so the session survives a page refresh.
  useEffect(() => {
    try {
      if (user) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch { /* storage full or unavailable */ }
  }, [user]);

  const login = async (e: string, p: string, admin = false): Promise<{ message: string | null; code?: string }> => {
    // TWO SEPARATE AUTH PATHS, ON PURPOSE.
    //
    // Buyers AND admins sign in against the Cloudflare/D1 routes, which set an
    // HttpOnly cookie — the browser never holds a token. Supabase Auth (the
    // old admin JWT mint) is restricted by the project-wide HTTP 402, so the
    // Admin Console used to answer "HTTP 402" on every attempt. The admin role
    // still comes from a server-side claim: the server re-derives it from the
    // session row on every guarded request, so a buyer session can never
    // satisfy an admin check.
    const store = useAuthStore.getState();
    const result = admin ? await store.signInAdmin(e, p) : await store.signInBuyer(e, p);
    if (!result.success) return { message: result.message, code: result.code };
    const sbUser = result.user;
    if (!sbUser) return { message: 'Sign-in did not return a session.' };
    if (admin && sbUser.role !== 'admin') {
      return { message: 'This account does not have admin access.', code: 'NOT_ADMIN' };
    }
    setUser({ id: sbUser.id, email: sbUser.email, name: sbUser.name, role: sbUser.role, joined: new Date().toISOString().slice(0, 10) });
    notify(admin ? 'Welcome Admin!' : 'Login successful!');
    return { message: null };
  };

  const guestLogin = () => {
    const guest: AppUser = { id: `guest-${Date.now()}`, email: 'guest@luxedge.us', name: 'Guest', role: 'buyer', joined: new Date().toISOString().slice(0, 10) };
    setUser(guest);
    notify('Shopping as guest — no account needed!');
  };

  const logout = async () => {
    // Ends whichever session exists: the buyer cookie (revoked server-side, so
    // it cannot be replayed) and/or the admin JWT.
    await useAuthStore.getState().signOutEverywhere();
    setUser(null);
    notify('Logged out');
  };

  const signup = async (n: string, e: string, p: string): Promise<string | null> => {
    // Matches the server's policy (10 characters) so the customer is told before
    // a round trip — the server enforces it regardless of this check.
    if (p.length < 10) return 'Password must be at least 10 characters';
    const result = await useAuthStore.getState().signUpBuyer(n, e, p);
    if (!result.success) return result.message;
    if (result.user) {
      setUser({ id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role, joined: new Date().toISOString().slice(0, 10) });
    }
    notify('Account created!');
    return null;
  };

  const changePassword = async (_current: string, newPass: string): Promise<{ ok: boolean; msg: string }> => {
    // Current password is verified by Supabase on the server; it is never
    // stored or checked client-side.
    if (!user) return { ok: false, msg: 'Not logged in' };
    if (newPass.length < 6) return { ok: false, msg: 'New password must be at least 6 characters' };
    try {
      await updatePassword(newPass);
      return { ok: true, msg: 'Password updated successfully!' };
    } catch (e) {
      return { ok: false, msg: (e as Error).message || 'Could not update password' };
    }
  };

  const updateAdminProfile = async (name: string, email: string) => {
    if (user?.role === 'admin') {
      try {
        await updateUserMetadata({ name });
        setUser(prev => prev ? { ...prev, name, email } : prev);
        notify('Profile updated!');
      } catch (e) {
        notify((e as Error).message || 'Could not update profile');
      }
    }
  };
  const addToCart = (p: Product) => { setCart(prev => { const ex = prev.find(i => i.product.id === p.id); return ex ? prev.map(i => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i) : [...prev, { product: p, quantity: 1 }]; }); setCartOpen(true); trackEvent('add_to_cart', { currency: 'USD', value: p.price, items: [{ item_id: p.id, item_name: p.name, price: p.price, quantity: 1 }], ...utmParams() }); notify(`Added to cart!`); };
  const removeFromCart = (id: string) => {
    const removed = cart.find(i => i.product.id === id);
    if (removed) trackEvent('remove_from_cart', { currency: 'USD', value: removed.product.price * removed.quantity, items: [{ item_id: removed.product.id, item_name: removed.product.name, price: removed.product.price, quantity: removed.quantity }], ...utmParams() });
    setCart(p => p.filter(i => i.product.id !== id));
  };
  const updateQty = (id: string, q: number) => { if (q <= 0) removeFromCart(id); else setCart(p => p.map(i => i.product.id === id ? { ...i, quantity: q } : i)); };
  const clearCart = () => setCart([]);
  // NOTE: real orders are created server-side by the Stripe webhook into
  // luxedge_orders (Admin → Orders). No client-side fake order path exists.
  const freeShippingEnabled = promotions.freeShippingEnabled;
  const freeShippingThreshold = promotions.freeShippingThreshold;

  return <AC.Provider value={{ user, cart, products, merchStats, users, reviews, categories, blogs, setBlogs, reloadBlogs, login, guestLogin, logout, signup, changePassword, updateAdminProfile, addToCart, removeFromCart, updateQty, clearCart, setProducts, setUsers, setReviews, setCategories, cartOpen, openCart, closeCart, notif, notify, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold }}>{children}</AC.Provider>;
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================
function Toast() {
  const { notif } = useApp();
  if (!notif) return null;
  const { msg, type } = notif;
  const icon = type === 'success'
    ? <CheckCircle strokeWidth={1.5} size={18} className="text-green-400" aria-hidden="true" />
    : type === 'error'
      ? <AlertTriangle strokeWidth={1.5} size={18} className="text-red-400" aria-hidden="true" />
      : <span aria-hidden="true" className="w-2 h-2 rounded-full bg-gray-400" />;
  return (
    <div role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'}
      className="fixed bottom-6 right-6 z-[200] animate-fade-in">
      <div className={`px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm text-white ${type === 'error' ? 'bg-red-900' : type === 'info' ? 'bg-gray-700' : 'bg-gray-900'}`}>{icon}{msg}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full"><X strokeWidth={1.5} size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ============================================================================
// HEADER + FOOTER (STORE)
// ============================================================================
// ── Header mega menu data (maps to real category routes) ──
function Header() {
  const [mob, setMob] = useState(false);
  const [um, setUm] = useState(false);
  const [hq, setHq] = useState('');
  const [mega, setMega] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const goTo = useNavigate();
  const { user, cart, logout, openCart, freeShippingEnabled, freeShippingThreshold } = useApp();
  const { ids: wishIds } = useWishlist();
  const cc = cart.reduce((s, i) => s + i.quantity, 0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const submitSearch = (ev: React.FormEvent) => {
    ev.preventDefault();
    const t = hq.trim();
    if (t) trackEvent('search', { search_term: t, ...utmParams() });
    goTo(t ? `/shop?q=${encodeURIComponent(t)}` : '/shop');
    setHq('');
    setMob(false);
  };

  useEffect(() => { setMob(false); setUm(false); setMega(null); }, [loc.pathname]);

  return (
    <>
      {/* ── Top Utility Bar ── */}
      <div className="bg-[#143023] text-[#E0ECE4] text-[11px] sm:text-xs py-2 px-4 border-b border-[#1E4636]/40 select-none">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 overflow-hidden text-ellipsis whitespace-nowrap">
            {/* The threshold is read from the same store settings the checkout
                quotes (`quoteShipping`), so admin can change the promotion
                without the header going on advertising the old number — and
                with free shipping switched off, the claim disappears. */}
            {freeShippingEnabled && (
              <>
                <span className="inline-flex items-center gap-1.5 font-medium text-white/95">
                  <Truck01 strokeWidth={1.5} size={13} className="text-[#C5A880]" />
                  Free Shipping on Orders ${freeShippingThreshold}+
                </span>
                <span className="hidden md:inline text-white/30">•</span>
              </>
            )}
            <span className="hidden md:inline-flex items-center gap-1.5 text-white/85">
              <ShieldTick strokeWidth={1.5} size={13} className="text-[#C5A880]" />
              Trusted by Pet &amp; Livestock Owners
            </span>
            <span className="hidden lg:inline text-white/30">•</span>
            <span className="hidden lg:inline-flex items-center gap-1.5 text-white/85">
              <Heart strokeWidth={1.5} size={13} className="text-[#C5A880]" />
              Care for Every Animal, Every Day
            </span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-white/80">
            {UTILITY_NAV.map((l, i) => (
              <Fragment key={l.to}>
                {i > 0 && <span className="text-white/25">|</span>}
                <Link to={l.to} className="hover:text-white transition-colors">{l.label}</Link>
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main Header ── */}
      <header className={`sticky top-0 z-50 bg-white/98 backdrop-blur-md transition-all duration-300 border-b border-gray-100 ${scrolled ? 'shadow-sm' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4 lg:gap-8">
          <button
            onClick={() => setMob(!mob)}
            aria-label="Open menu"
            aria-expanded={mob}
            className="lg:hidden p-2 -ml-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
          >
            {mob ? <X strokeWidth={1.5} size={22} /> : <Menu01 strokeWidth={1.5} size={22} />}
          </button>

          {/* Brand Logo — the wordmark and tagline drop away as the screen gets
              narrower so the right-hand controls (sign in / wishlist / cart) can
              never be pushed off the viewport on a phone. */}
          <Link to="/" className="flex items-center gap-2 sm:gap-2.5 min-w-0 group" aria-label="Luxedge home">
            <img src="/luxedge-mark.png" alt="Luxedge" className="h-11 sm:h-12 w-auto object-contain shrink-0 transition-transform duration-300 group-hover:scale-105" />
            <span className="hidden min-[375px]:flex flex-col leading-none min-w-0">
              <span className="font-brand text-base sm:text-xl font-bold tracking-[0.16em] text-gray-900">LUXEDGE</span>
              <span className="hidden md:block text-[7px] sm:text-[7.5px] font-bold tracking-[0.22em] text-[#1E4636] mt-0.5">PETS • LIVESTOCK • A BRIGHTER TOMORROW</span>
            </span>
          </Link>

          {/* Large Central Search Bar */}
          <form onSubmit={submitSearch} role="search" className="hidden md:flex flex-1 min-w-0 max-w-xl mx-2 lg:mx-6">
            <div className="relative flex items-center w-full bg-[#F6F8F5] border border-gray-200/90 rounded-full px-4 py-2.5 focus-within:border-[#1E4636] focus-within:ring-2 focus-within:ring-[#1E4636]/15 transition-all">
              <SearchMd strokeWidth={1.5} size={17} className="text-gray-400 shrink-0 mr-2.5" />
              <input
                value={hq}
                onChange={e => setHq(e.target.value)}
                placeholder="Search products, brands, or animal care guides..."
                aria-label="Search products"
                className="flex-1 min-w-0 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none pr-9"
              />
              <button
                type="submit"
                aria-label="Search"
                className="absolute right-1.5 w-8 h-8 rounded-full bg-[#1E4636] hover:bg-[#153428] text-white flex items-center justify-center transition-transform hover:scale-105 shadow-sm"
              >
                <SearchMd strokeWidth={2} size={14} />
              </button>
            </div>
          </form>

          {/* Header Action Icons — shrink-0 so the primary CTAs keep their space. */}
          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setUm(!um)}
                  aria-label="Account menu"
                  aria-expanded={um}
                  className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded-lg text-gray-700 transition-colors"
                >
                  <span className="w-8 h-8 rounded-full bg-[#1E4636] text-white flex items-center justify-center text-xs font-bold ring-2 ring-[#1E4636]/10">
                    {user.name[0]}
                  </span>
                  <span className="hidden lg:block text-xs font-semibold">{user.name.split(' ')[0]}</span>
                </button>
                {um && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUm(false)} />
                    <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl shadow-xl border border-gray-100 bg-white py-2 z-50">
                      <div className="px-4 py-2.5 border-b border-gray-100">
                        <p className="font-semibold text-xs text-gray-900">{user.name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5 truncate">{user.email}</p>
                      </div>
                      {user.role === 'admin' && (
                        <Link to="/admin" className="flex items-center gap-2 px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors">
                          <LayoutGrid01 strokeWidth={1.5} size={15} className="text-[#1E4636]" />
                          Admin Panel
                        </Link>
                      )}
                      <Link to="/orders" className="flex items-center gap-2 px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors">
                        <Package strokeWidth={1.5} size={15} className="text-gray-500" />
                        My Orders
                      </Link>
                      <button onClick={logout} className="flex items-center gap-2 px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 w-full text-left transition-colors">
                        <LogOut01 strokeWidth={1.5} size={15} />
                        Log Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link to="/login" className="flex items-center gap-1.5 py-2 px-2.5 hover:bg-gray-50 rounded-lg text-gray-700 transition-colors" aria-label="Sign in">
                <UserIcon strokeWidth={1.5} size={19} className="text-gray-600" />
                <span className="hidden lg:inline text-xs font-semibold">Account</span>
              </Link>
            )}

            {/* Wishlist */}
            <Link to="/wishlist" className="relative flex items-center gap-1.5 py-2 px-2.5 hover:bg-gray-50 rounded-lg text-gray-700 transition-colors" aria-label={`Wishlist, ${wishIds.length} items`}>
              <Heart strokeWidth={1.5} size={19} fill={wishIds.length > 0 ? 'currentColor' : 'none'} className={wishIds.length > 0 ? 'text-rose-500' : 'text-gray-600'} />
              <span className="hidden lg:inline text-xs font-semibold">Wishlist</span>
              {wishIds.length > 0 && (
                <span className="absolute top-1 right-1 lg:static min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white flex items-center justify-center text-[9px] font-bold">
                  {wishIds.length}
                </span>
              )}
            </Link>

            {/* Cart */}
            <button onClick={openCart} className="relative flex items-center gap-1.5 py-2 px-2.5 hover:bg-gray-50 rounded-lg text-gray-700 transition-colors" aria-label={`Open cart, ${cc} items`}>
              <ShoppingBag01 strokeWidth={1.5} size={19} className="text-gray-600" />
              <span className="hidden lg:inline text-xs font-semibold">Cart</span>
              {cc > 0 && (
                <span className="absolute top-1 right-1 lg:static min-w-[16px] h-4 px-1 rounded-full bg-[#1E4636] text-white flex items-center justify-center text-[9px] font-bold">
                  {cc}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── Main Navigation Strip with Mega Menu ── */}
        <nav className="hidden lg:block border-t border-gray-100 bg-white" aria-label="Main Navigation">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-11 text-[13.5px] font-semibold text-gray-700">
            <div className="flex items-center gap-1">
              <Link to={STRIP_NAV.all.to} className="px-3 py-1.5 rounded-lg hover:text-[#1E4636] hover:bg-[#F6F8F5] transition-colors">
                {STRIP_NAV.all.label}
              </Link>
              {STRIP_NAV.items.map((item) => {
                const megaItem = item.megaKey ? MEGA_MENU.find(m => m.label === item.megaKey) : null;
                return (
                  <div
                    key={item.to}
                    className="relative"
                    onMouseEnter={() => item.megaKey && setMega(item.megaKey)}
                    onMouseLeave={() => setMega(null)}
                  >
                    <Link
                      to={item.to}
                      className="px-3 py-1.5 rounded-lg hover:text-[#1E4636] hover:bg-[#F6F8F5] transition-colors flex items-center gap-1"
                    >
                      {item.label}
                      {megaItem && <ChevronDown strokeWidth={1.5} size={12} className={`text-gray-400 transition-transform ${mega === item.megaKey ? 'rotate-180' : ''}`} />}
                    </Link>

                    {/* Mega Menu Dropdown */}
                    {megaItem && mega === item.megaKey && (
                      <div className="absolute left-0 top-full pt-1.5 z-50 w-[520px]">
                        <div className="bg-white rounded-2xl border border-gray-150 shadow-2xl p-6 animate-fade-in-up">
                          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                            <p className="font-bold text-xs uppercase tracking-wider text-[#1E4636]">Shop {megaItem.label}</p>
                            <Link to={megaItem.to} className="text-xs font-bold text-[#1E4636] hover:underline">View All →</Link>
                          </div>
                          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                            {megaItem.groups.map(g => (
                              <div key={g.title}>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{g.title}</p>
                                <div className="space-y-1">
                                  {g.links.map(l => (
                                    <Link key={l.label} to={l.to} className="block text-[13px] text-gray-700 hover:text-[#1E4636] hover:translate-x-0.5 transition-all">
                                      {l.label}
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Link to={STRIP_NAV.deals.to} className="inline-flex items-center gap-1.5 px-3.5 py-1 text-[13px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-full transition-colors">
              <Zap strokeWidth={1.5} size={13} className="text-amber-600" /> {STRIP_NAV.deals.label}
            </Link>
          </div>
        </nav>

        {/* ── Mobile Drawer / Menu ── */}
        {mob && (
          <div className="lg:hidden border-t border-gray-100 bg-white p-4 space-y-4 animate-fade-in-up">
            <form onSubmit={(e) => { submitSearch(e); setMob(false); }} role="search" className="flex items-center w-full bg-[#F6F8F5] border border-gray-200 rounded-full px-3.5 py-2">
              <SearchMd strokeWidth={1.5} size={16} className="text-gray-400 mr-2" />
              <input value={hq} onChange={e => setHq(e.target.value)} placeholder="Search products &amp; guides..." className="w-full bg-transparent text-sm focus:outline-none" />
              <button type="submit" className="px-3 py-1 bg-[#1E4636] text-white rounded-full text-xs font-semibold">Search</button>
            </form>
            <div className="grid grid-cols-2 gap-2 text-sm font-medium">
              {DRAWER_NAV.tiles.map((t) => (
                <Link key={t.to} to={t.to} onClick={() => setMob(false)} className="p-2.5 bg-gray-50 rounded-xl hover:bg-gray-100">{t.label}</Link>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-3 space-y-1 text-sm font-medium text-gray-700">
              {DRAWER_NAV.links.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setMob(false)}
                  className={`block py-1.5 px-2 rounded-lg ${l.highlight ? 'text-amber-700 font-bold hover:bg-amber-50' : 'hover:bg-gray-50'}`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>
    </>
  );
}

/** Text glyphs for the footer social buttons. YouTube renders a real icon
 * instead, so it is absent here. Only consulted for profiles listed in
 * SOCIAL_PROFILES (src/content/socialProfiles.ts). */
const SOCIAL_GLYPHS: Record<string, string> = { Facebook: 'f', Instagram: 'ig', Pinterest: 'p', TikTok: 'tk' };

function Footer() {
  const FL = 'block text-[13.5px] py-1 text-white/75 hover:text-white transition-colors';
  const ColTitle = ({ children }: { children: ReactNode }) => (
    <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-[#C5A880] mb-3">{children}</h4>
  );

  return (
    <footer className="bg-[#143023] text-white">
      {/* ── Main Footer Grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8 items-start">
          {/* Brand Column */}
          <div className="lg:col-span-4 space-y-4">
            <Link to="/" className="flex items-center gap-3 group w-fit" aria-label="Luxedge home">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/10 p-1 flex items-center justify-center backdrop-blur-sm border border-white/15 transition-transform group-hover:scale-105">
                <img src="/luxedge-mark.png" alt="Luxedge" className="w-full h-full object-contain" />
              </div>
              <span className="flex flex-col leading-none">
                <span className="font-brand text-xl sm:text-2xl font-bold tracking-[0.16em] text-white">LUXEDGE</span>
                <span className="text-[7.5px] tracking-[0.24em] text-[#C5A880] mt-1 font-bold">PETS • LIVESTOCK • A BRIGHTER TOMORROW</span>
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-white/75 max-w-sm">
              Quality products, expert guidance, and a community for everyone who cares for animals.
            </p>
            {/* Operating-entity disclosure: the visitor and an ad reviewer should
                both be able to see who runs this store without opening a policy.
                City/state come from the owner-supplied business address in
                policies.ts; no address is invented here. */}
            <p className="text-xs text-white/60">Luxedge is operated by Embani LLC · Denver, CO.</p>
            {/* Social Icons — rendered from SOCIAL_PROFILES, which is empty until
                real Luxedge accounts exist. The previous hardcoded buttons opened
                bare platform homepages, so they advertised accounts we do not
                have; an empty list renders nothing, and the URLs live in
                src/content/socialProfiles.ts rather than in this file.
                Deliberately not replaced with "coming soon" placeholders. */}
            {SOCIAL_PROFILES.length > 0 && (
              <div className="flex items-center gap-3 pt-2">
                {SOCIAL_PROFILES.map((p) => (
                  <a key={p.label} href={p.href} target="_blank" rel="noopener noreferrer" aria-label={p.label} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors text-xs font-bold">
                    {p.label === 'YouTube' ? <YoutubeLogo size={16} /> : SOCIAL_GLYPHS[p.label]}
                  </a>
                ))}
              </div>
            )}
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="lg:col-span-2 space-y-1">
              <ColTitle>{col.title}</ColTitle>
              {col.links.map((l) => (
                <Link key={l.to} to={l.to} className={FL}>{l.label}</Link>
              ))}
              {col.paymentsNote && (
                <div className="pt-4 border-t border-white/10 mt-4">
                  <div className="flex items-center gap-2 text-xs text-[#C5A880]">
                    <ShieldTick strokeWidth={1.5} size={15} />
                    <SecurePaymentsNote />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom Legal & Motto Strip ── */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/60">
          <p>© {new Date().getFullYear()} Luxedge. All rights reserved.</p>
          <p className="flex items-center gap-1.5 text-white/75 font-medium">
            <span>A healthier tomorrow for every animal.</span>
            <Heart size={13} fill="currentColor" className="text-[#C5A880]" />
          </p>
        </div>
      </div>
    </footer>
  );
}

/**
 * Homepage product grids are curated (small, admin-flagged sets), so a fixed
 * 5-column grid leaves huge empty tracks when a section only has 1-3 items —
 * it reads as a broken/incomplete page rather than a real storefront. Cap the
 * grid to the actual item count (up to 5) so cards sit close together instead
 * of stretching across mostly-empty rows.
 */
export function productGridClass(count: number): string {
  if (count <= 1) return 'grid grid-cols-1 max-w-[220px] gap-2.5 sm:gap-3';
  if (count === 2) return 'grid grid-cols-2 max-w-[460px] gap-2.5 sm:gap-3';
  if (count === 3) return 'grid grid-cols-2 sm:grid-cols-3 max-w-[700px] gap-2.5 sm:gap-3';
  if (count === 4) return 'grid grid-cols-2 sm:grid-cols-4 max-w-[940px] gap-2.5 sm:gap-3';
  return 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-2.5';
}

function PCard({ product }: { product: Product }) {
  const { addToCart, reviews, notify } = useApp();
  const { pathname } = useLocation();
  const selectProduct = () => trackEvent('select_item', { item_list_id: pathname || 'storefront', items: [{ item_id: product.id, item_name: product.name, price: product.price }], ...utmParams() });
  const image = firstUsableImage(product) || LUXEDGE_IMAGE_FALLBACK;
  const secondImage = product.images.find((candidate) => candidate && candidate !== image);
  const hasCompareAt = product.originalPrice > product.price;
  const discount = hasCompareAt ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
  // Ratings come ONLY from verified user reviews — never the catalog stub.
  const verified = reviews.filter(r => r.productId === product.id && r.status === 'approved');
  const verifiedAvg = verified.length ? verified.reduce((s, r) => s + r.rating, 0) / verified.length : 0;
  return (
    <article className="product-card group relative">        <Link to={productPath(product)} onClick={selectProduct} className="block focus-visible:outline-luxe-gold" aria-label={`View ${product.name}`}>
        <div className="product-card-media">
          <img src={image} alt={product.name} loading="lazy" decoding="async" onError={(e) => { onImageError(e); markBrokenImage(product.id); }} className="product-card-image" />
          {secondImage && (
            <img src={secondImage} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={onImageError}
              className="product-card-image product-card-image-secondary" />
          )}
          <div className="product-card-badge">
            {product.newArrival && <span className="badge-new">New</span>}
            {discount > 0 && <span className="badge-sale">-{discount}%</span>}
            {product.featured && !product.newArrival && <span className="badge-featured">Featured</span>}
            {product.price <= 15 && <span className="badge-gift">🎁 Free Gift Eligible</span>}
          </div>
          <span className="product-card-view">View product <ArrowRight strokeWidth={1.5} size={13} aria-hidden="true" /></span>
        </div>
      </Link>
      <WishlistButton product={product} notify={notify} className="absolute top-2 right-2 z-10 bg-white/90 shadow-md p-2" />
      <div className="product-card-info">
        <Link to={productPath(product)} className="block min-w-0">
          <p className="product-card-category">{product.category}</p>
          <h3 className="product-card-title line-clamp-2">{product.name}</h3>
        </Link>
        {verified.length > 0 && (
          <span className="product-card-rating mt-1 inline-flex" aria-label={`Rated ${verifiedAvg.toFixed(1)} out of 5 by ${verified.length} verified review${verified.length !== 1 ? 's' : ''}`}>
            <span className="inline-flex" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <Star01 key={i} strokeWidth={1.5} size={10} fill={i < Math.round(verifiedAvg) ? 'currentColor' : 'none'} />)}</span>
            <span>{verifiedAvg.toFixed(1)}</span>
          </span>
        )}
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-baseline gap-1.5">
            <span className="product-card-price">${product.price.toFixed(2)}</span>
            {hasCompareAt && <span className="product-card-compare">${product.originalPrice.toFixed(2)}</span>}
          </div>
        </div>
        <button type="button" onClick={(e) => { e.preventDefault(); addToCart(product); }}
          className="btn-glow mt-2 w-full py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-sm hover:shadow-gold product-card-add-visible"
          aria-label={`Add ${product.name} to cart`}>
          <ShoppingBag01 strokeWidth={1.5} size={12} aria-hidden="true" /> Add to Cart
        </button>
      </div>
    </article>
  );
}

// Premium alias — one card component across the whole storefront
function PCardPremium({ product }: { product: Product }) {
  return <PCard product={product} />;
}

function WishlistPage() {
  const { products, notify } = useApp();
  const { ids: savedIds, clear } = useWishlist();
  const saved = products.filter((p) => p.isActive && savedIds.includes(p.id));

  if (saved.length === 0) return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Heart strokeWidth={1.5} size={28} className="text-luxe-gold" /></div>
        <h2 className="font-serif text-2xl font-bold text-luxe-black mb-2">Your wishlist is empty</h2>
        <p className="text-luxe-gray text-sm mb-6">Tap the heart on any product to save it here for later.</p>
        <Link to="/shop" className="btn-glow inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Shop Now</Link>
      </div>
    </div>
  );

  return (
    <div className="py-12 bg-luxe-cream min-h-screen">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-8">
          <div>
            <p className="eyebrow mb-2">Saved for Later</p>
            <h1 className="font-serif text-3xl font-bold text-luxe-black">Your Wishlist</h1>
            <p className="text-luxe-gray text-sm mt-1">{saved.length} saved item{saved.length === 1 ? '' : 's'}</p>
          </div>
          <button onClick={() => { clear(); notify('Wishlist cleared'); }}
            className="text-xs font-semibold text-luxe-gray hover:text-luxe-red transition-colors">Clear All</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-2.5">
          {saved.map((p) => <PCard key={p.id} product={p} />)}
        </div>
      </div>
    </div>
  );
}


// Per-route document title + meta description + canonical for SEO
function RouteTitle() {
  const { pathname } = useLocation();
  const { products, blogs } = useApp();
  useEffect(() => {
    const brand = "Luxedge";
    const segs = pathname.split("/").filter(Boolean);
    // Normalize seo_title values that already carry the brand suffix so the
    // brand is never duplicated ("… | Luxedge | Luxedge").
    const set = (t: string) => { document.title = t.replace(/\s*\|\s*Luxedge\s*$/i, '') + " | " + brand; };
    const full = (t: string) => { document.title = t; };
    const setMeta = (name: string, content: string) => {
      let el = document.head.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    const setOg = (prop: string, content: string) => {
      let el = document.head.querySelector(`meta[property="${prop}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    const setCanonical = () => {
      // BrowserRouter clean URLs — never hash (#/) canonicals.
      const href = `https://luxedge.us${pathname}`;
      let el = document.head.querySelector('link[rel="canonical"]');
      if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el); }
      el.setAttribute('href', href);
      setOg('og:url', href);
    };
    const desc = (d: string) => { setMeta('description', d); setOg('og:description', d); setOg('og:title', document.title); };
    setCanonical();
    // PWA: swap the manifest per surface — admin is its own installable app
    // scope (/admin → "Luxedge Admin"), everything else is the storefront
    // ("Luxedge"). Static default lives in index.html.
    const mf = document.querySelector('link[rel="manifest"]');
    if (mf) mf.setAttribute('href', pathname.startsWith('/admin') ? '/admin/manifest.webmanifest' : '/manifest.webmanifest');
    const privateRoutes = ['admin', 'checkout', 'login', 'signup', 'account', 'cart', 'orders', 'wishlist', 'profile'];
    if (segs[0] === 'free-pet-gift') {
      // Time-boxed campaign with real (finite) inventory: keep it out of the
      // permanent index (it will flip to a "fully claimed" state) — still
      // follow links so ad/social traffic and any backlinks pass value on.
      setMeta('robots', 'noindex, follow');
    } else if (privateRoutes.includes(segs[0]) || pathname === '/blog/write' || (segs[0] === 'blog' && !!segs[1] && isHeldBlog(segs[1]))) {
      setMeta('robots', 'noindex, nofollow');
    } else if (['', 'shop', 'category', 'product', 'blog', 'media', 'about', 'contact', 'privacy', 'terms', 'returns', 'shipping-policy', 'copyright', 'faq', 'sitemap'].includes(segs[0] || '')) {
      setMeta('robots', 'index, follow');
    }
    if (segs.length === 0) { full("Luxedge — Premium Pet & Animal Essentials"); desc("Shop practical pet and horse essentials, read buying guides, and find clear shipping and return information at Luxedge."); }
    else if (segs[0] === "shop") { set("Shop All Products"); desc("Browse the full Luxedge collection of premium pet essentials for dogs and cats."); }
    else if (segs[0] === "free-pet-gift") { set("Luxedge Pet Gift Drop — Free Gift for Dogs & Cats"); desc("Claim a complimentary Luxedge pet gift for your dog or cat — product and standard shipping are free. No purchase required and no card is ever asked for, while real supplies last."); }
    else if (segs[0] === "category") { const c = fromSlug(decodeURIComponent(segs[1] || "")); set("Shop " + c); desc(CAT_META[c]?.desc || `Browse our ${c} collection at Luxedge.`); }
    else if (segs[0] === "product") {
      // Real catalog product (never the demo ALL_PRODUCTS fixture).
      // Canonical storefront URLs are /product/<slug>, so match slug OR id
      // exactly like ProductDetailPage does.
      const seg = decodeURIComponent(segs[1] || "");
      const p = products.find((x) => x.id === seg || x.slug === seg);
      set(p ? (p.seoTitle || p.name) : "Product");
      if (p) desc(p.seoDescription || p.shortDesc || p.description.slice(0, 155));
    }
    else if (segs[0] === "wishlist") { set("My Wishlist"); desc("Products you have saved at Luxedge for later — your saved list stays on your device."); }
    else if (segs[0] === "cart") { set("Shopping Cart"); desc("Review your Luxedge cart — shipping options and any applicable promotions are shown before payment."); }
    else if (segs[0] === "checkout") { set("Checkout"); desc("Complete your Luxedge order."); }
    else if (segs[0] === "orders") { set("My Orders"); desc("Track your Luxedge orders."); }
    else if (segs[0] === "about") { set("About Us"); desc("Luxedge curates premium, honest pet essentials for dogs and cats — quality you can trust."); }
    else if (segs[0] === "contact") { set("Contact Us"); desc("Reach the Luxedge customer support team — Mon–Fri, 9AM–6PM CT."); }
    else if (segs[0] === "privacy") { set("Privacy Policy"); desc("Luxedge privacy policy — how we handle your data, cookies and advertising."); }      else if (segs[0] === "terms") { set("Terms of Service"); desc("The rules for using Luxedge: orders and payment, shipping estimates, product information, returns, and liability, written in plain language."); }      else if (segs[0] === "returns") { set("Returns & Replacement Policy"); desc("How Luxedge returns work: request within 30 days for damaged, defective, or incorrect items, with replacement or refund where the law requires it."); }      else if (segs[0] === "editorial-policy") { set("Editorial Policy"); desc("How Luxedge prepares, checks, updates, sources, and corrects its animal-care buying guides and editorial content."); }      else if (segs[0] === "disclaimer") { set("Disclaimer"); desc("Important limits on Luxedge product information and general animal-care content."); }
    else if (segs[0] === "shipping-policy" || segs[0] === "shipping") { set("Shipping Policy"); desc("How Luxedge ships orders: where we deliver, how shipping is priced, what affects your delivery estimate, delays, and lost-package help."); }
    else if (segs[0] === "copyright") { full("Copyright & DMCA — Reporting Infringement | Luxedge"); desc("How Luxedge handles copyright: what we own, how to reuse our content, and how a rights holder can report allegedly infringing material with a DMCA-style notice."); }
    else if (segs[0] === "faq") { set("Frequently Asked Questions"); desc("Answers to common questions about shopping at Luxedge."); }
    else if (segs[0] === "sitemap") { full("Sitemap — Every Page on Luxedge"); desc("Browse every page on Luxedge in one place: the full product catalog, shop categories, care guides, and our shipping, returns, privacy and terms pages."); }
    else if (segs[0] === "careers") { set("Careers"); desc("Join the Luxedge team."); }
    else if (segs[0] === "blog") {
      // Only published posts are ever served to visitors (defense in depth:
      // the CMS read already filters, but a draft must never render here).
      const post = segs[1] && segs[1] !== "write" ? blogs.find(b => b.slug === segs[1] && b.status === 'published') : undefined;
      set(post ? post.title : (segs[1] ? (segs[1] === "write" ? "Write a Post" : "Blog") : "Blog & Insights"));
      desc(post ? (post.excerpt || post.content.slice(0, 155)) : "Pet care tips and insights from the Luxedge team.");
    }
    else if (segs[0] === "media") {
      if (segs[1]) { set("Video"); desc("Watch and read the latest Luxedge media — guides, stories and product education from the official channel."); }
      else { set("Media Hub"); desc("Watch Luxedge videos — product education, pet & animal care, how-to guides, buying guides and behind-the-brand stories."); }
    }
    else if (segs[0] === "login") { set("Sign In"); desc("Sign in to your Luxedge account."); }
    else if (segs[0] === "signup") { set("Create Account"); desc("Create your Luxedge account."); }
    else if (segs[0] === "admin") { set("Admin Dashboard"); }
    else set("Luxedge");
  }, [pathname, products, blogs]); // products re-run so PDP titles resolve once the catalog loads
  return null;
}

// Scroll to top on every route change
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    // Also try parent frame scroll for iframe embeds
    try { if (window.parent !== window) { window.parent.postMessage({ type: 'scrollTop' }, '*'); } } catch(_) {}
  }, [pathname]);
  return null;
}

function SLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:bg-luxe-black focus:text-white focus:rounded-lg focus:text-sm">Skip to content</a>
      <ScrollToTop />
      <Header />
      <main id="main-content" className="flex-1">{children}</main>
      <Footer />
      <CartDrawer />
      <CookieConsent />
      <WelcomePopup />
      <CampaignPopup />
      {/* WhatsAppButton was removed: it exposed the owner's personal WhatsApp
          number publicly, and public contact is now email-only. Do not render
          a chat button that publishes a direct line. */}
      <AIAssistant />
    </div>
  );
}

// ============================================================================
// CHECKOUT LAYOUT — deliberately calmer than the storefront.
//
// Only the logo, a secure-checkout indicator and the cart count stay; the
// announcement bar, full navigation, footer, popups, cookie banner, AI chat
// button and AI assistant are all excluded so nothing distracts from (or
// overlaps) the payment form.
// ============================================================================
function CheckoutLayout({ children }: { children: ReactNode }) {
  const { cart } = useApp();
  const cc = cart.reduce((s, i) => s + i.quantity, 0);
  return (
    <div className="min-h-screen flex flex-col bg-luxe-cream">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:bg-luxe-black focus:text-white focus:rounded-lg focus:text-sm">Skip to content</a>
      <ScrollToTop />
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-luxe-silver/60">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 shrink-0 group">
            <img src="/luxedge-mark.png" alt="" aria-hidden="true" className="h-10 w-auto transition-transform duration-300 group-hover:scale-105" />
            <span className="flex flex-col leading-none">
              <span className="font-brand text-base font-bold tracking-[0.15em] text-luxe-black">LUXEDGE</span>
              <span className="hidden sm:block text-[7px] font-bold tracking-[0.22em] text-[#1E4636] mt-0.5">PETS • LIVESTOCK • A BRIGHTER TOMORROW</span>
            </span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-3">
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-luxe-charcoal">
              <Lock01 strokeWidth={1.5} size={14} className="text-luxe-gold" />
              Secure Checkout
            </span>
            <Link to="/cart" className="relative p-2 hover:bg-luxe-cream rounded-lg text-luxe-charcoal transition-colors" aria-label={`Cart, ${cc} item${cc === 1 ? '' : 's'}`}>
              <ShoppingBag01 strokeWidth={1.5} size={18} />
              {cc > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-luxe-gold text-white flex items-center justify-center text-[8px] font-bold">{cc}</span>}
            </Link>
          </div>
        </div>
      </header>
      <main id="main-content" className="flex-1">{children}</main>
    </div>
  );
}

// Compact skeleton for the lazy-loaded checkout route — mirrors the real
// two-column layout (form left, sticky summary right) so there is no layout
// jump and no long blank "Loading…" flash.
function CheckoutLoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8" aria-busy="true" aria-label="Loading secure checkout">
      <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-2" />
      <div className="h-7 w-56 bg-gray-200 rounded animate-pulse mb-8" />
      <div className="grid lg:grid-cols-5 gap-6 sm:gap-8 items-start">
        <div className="lg:col-span-3 space-y-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-luxe-silver/70 p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-7 h-7 rounded-full bg-gray-200 animate-pulse" />
                <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="space-y-2.5">
                <div className="h-3.5 w-full bg-gray-100 rounded animate-pulse" />
                <div className="h-3.5 w-5/6 bg-gray-100 rounded animate-pulse" />
                <div className="h-3.5 w-2/3 bg-gray-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden lg:block lg:col-span-2">
          <div className="bg-white rounded-2xl border border-luxe-silver/70 p-5 shadow-sm lg:sticky lg:top-20">
            <div className="h-5 w-36 bg-gray-200 rounded animate-pulse mb-5" />
            <div className="space-y-3">
              <div className="h-14 w-full bg-gray-100 rounded-lg animate-pulse" />
              <div className="h-14 w-full bg-gray-100 rounded-lg animate-pulse" />
            </div>
            <div className="h-11 w-full bg-gray-200 rounded-xl animate-pulse mt-6" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PRODUCT DETAIL PAGE
// ============================================================================

function isFoodOrFeedProduct(product: Pick<Product, 'name' | 'category' | 'tags' | 'safetyClass'>): boolean {
  return classifyProductSafety({ classification: product.safetyClass, name: product.name, category: product.category, tags: product.tags }) !== 'NON_INGESTIBLE';
}

function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { products, addToCart, user, reviews: allReviews, setReviews, notify } = useApp();
  const nav = useNavigate();
  // The storefront catalog only lists commerce-ready products, but the SSR/SEO
  // layer (and deep links / the admin editor "Preview" button) serve ANY
  // active product. Resolve those directly so the SPA matches the server
  // instead of showing "Product Not Found" for a live product.
  const catalogProduct = products.find(p => p.id === id || p.slug === id);
  const [directProduct, setDirectProduct] = useState<Product | null>(null);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (catalogProduct) { setDirectProduct(null); setResolving(false); return; }
    setDirectProduct(null); setResolving(true);
    void loadProductByIdOrSlug(id || '').then((p) => {
      if (cancelled) return;
      setDirectProduct(p ? mapCatalogProduct(p) : null);
      setResolving(false);
    });
    return () => { cancelled = true; };
  }, [id, catalogProduct?.id]);
  const product = catalogProduct || directProduct;

  // ALL hooks MUST be before any return
  const [qty, setQty] = useState(1);
  const [selImg, setSelImg] = useState(0);
  const [selVariant, setSelVariant] = useState<ProductVariant | null>(null);
  const [tab, setTab] = useState<'desc' | 'specs' | 'reviews'>('desc');
  const [revForm, setRevForm] = useState({ rating: 5, comment: '' });
  const [showRevForm, setShowRevForm] = useState(false);
  const [selColor, setSelColor] = useState('');
  const [selSize, setSelSize] = useState('');
  const [ctaVisible, setCtaVisible] = useState(true);
  const ctaRef = useRef<HTMLDivElement>(null);
  // Buyer content shared with the server pre-render (worker/seo-meta.ts) so the
  // crawl HTML and the hydrated page carry the same summary, pre-purchase checks
  // and care/safety notes. Undefined for a product with no entry.
  const pdpContent = productContentFor(product?.slug);
  // Owner-editable catalog detail (features / long description / specifications /
  // weight) — the same formatter the worker pre-renders, so crawler and visitor
  // see identical rows and an empty field adds nothing.
  const pdpFacts = productFacts({
    features: product?.features,
    specifications: product?.specifications,
    longDescription: product?.longDescription,
    weightOz: product?.weightOz,
    description: product?.description,
  });

  // Hide the sticky mobile Add to Cart bar while the inline CTA is on screen.
  useEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCtaVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [product?.id]);

  // Per-product SEO: canonical, meta description and Product + Breadcrumb
  // structured data. Only verified review data is ever emitted.
  useEffect(() => {
    if (!product) return;
    const verified = allReviews.filter(r => r.productId === product.id && r.status === 'approved');
    const setMeta = (name: string, content: string) => {
      let el = document.head.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    const pUrl = `https://luxedge.us/product/${product.slug || product.id}`;
    const setCanonical = () => {
      let el = document.head.querySelector('link[rel="canonical"]');
      if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el); }
      el.setAttribute('href', pUrl);
    };
    setMeta('description', product.shortDesc || product.description.slice(0, 155));
    if (product.seoKeywords?.length) setMeta('keywords', product.seoKeywords.slice(0, 10).join(', '));
    setCanonical();
    if (product.images[0]) {
      const ogImg = document.head.querySelector('meta[property="og:image"]');
      if (ogImg) ogImg.setAttribute('content', product.images[0]);
      const twImg = document.head.querySelector('meta[name="twitter:image"]');
      if (twImg) twImg.setAttribute('content', product.images[0]);
    }
    const jsonLd: Record<string, unknown>[] = [{
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us/' },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: 'https://luxedge.us/shop' },
        { '@type': 'ListItem', position: 3, name: product.name, item: pUrl },
      ],
    }];
    const offers: Record<string, unknown> = {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'USD',
      // Honest availability: only claim InStock for real supplier-verified stock.
      availability: product.stockStatus === 'in_stock' || (product.usInventory && product.stock > 0)
        ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    };
    if (product.variants[0]?.sku) offers.sku = product.variants[0].sku;
    const prodSchema: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      image: product.images.slice(0, 8),
      description: product.shortDesc || product.description,
      brand: { '@type': 'Brand', name: product.brand || 'Luxedge' },
      offers,
    };
    if (product.category) prodSchema.category = product.category;
    // Only verified, user-submitted reviews go into schema — never the catalog stub.
    if (verified.length > 0) {
      const avg = verified.reduce((s, r) => s + r.rating, 0) / verified.length;
      prodSchema.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: avg.toFixed(1),
        reviewCount: verified.length,
      };
    }
    jsonLd.push(prodSchema);
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'product-jsonld';
    script.text = JSON.stringify(jsonLd);
    document.getElementById('product-jsonld')?.remove();
    document.head.appendChild(script);
    return () => { document.getElementById('product-jsonld')?.remove(); };
  }, [product?.id]);

  // Removed/archived (or unknown-slug) product pages must never be indexed:
  // noindex overrides the global 'index, follow' so Google drops stale URLs.
  useEffect(() => {
    if (product) return;
    const setMeta = (name: string, content: string) => {
      let el = document.head.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    setMeta('robots', 'noindex, nofollow');
    return () => {
      const el = document.head.querySelector('meta[name="robots"]');
      if (el && el.getAttribute('content') === 'noindex, nofollow') el.remove();
    };
  }, [product]);

  // Scroll to top on product change
  useEffect(() => { window.scrollTo(0, 0); setSelImg(0); setSelVariant(null); setQty(1); setTab('desc'); if (product) { trackEvent('view_item', { currency: 'USD', value: product.price, items: [{ item_id: product.id, item_name: product.name, price: product.price }], ...utmParams() }); } }, [id, product?.id]);

  // Set initial color/size when product loads
  useEffect(() => {
    if (product && product.variants.length > 0) {
      const colors = [...new Set(product.variants.map(v => v.color).filter(Boolean))];
      const sizes = [...new Set(product.variants.map(v => v.size).filter(Boolean))];
      setSelColor(colors[0] || '');
      setSelSize(sizes[0] || '');
    }
  }, [product?.id]);

  // Update selected variant when color/size changes
  useEffect(() => {
    if (product && product.variants.length > 0) {
      const match = product.variants.find(v =>
        (!selColor || v.color === selColor) && (!selSize || v.size === selSize)
      );
      setSelVariant(match || null);
      if (match?.image) {
        const imgIdx = product.images.indexOf(match.image);
        if (imgIdx >= 0) setSelImg(imgIdx);
      }
    }
  }, [selColor, selSize, product?.id]);

  // Now safe to do early return AFTER all hooks
  if (!product) {
    // Still resolving a direct (non-catalog) lookup — never flash "Not Found"
    // for a product the SSR layer serves fine.
    if (resolving) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-luxe-silver border-t-luxe-gold" />
            <p className="text-sm text-gray-500">Loading product…</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-4">ðŸ˜•</p>
          <h2 className="text-2xl font-bold mb-2">Product Not Found</h2>
          <p className="text-gray-500 mb-6">This product may have been removed.</p>
          <Link to="/shop" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full transition-colors">Back to Shop</Link>
        </div>
      </div>
    );
  }

  const reviews = allReviews.filter(r => r.productId === product.id && r.status === 'approved');
  // AliExpress-style review rating breakdown — computed ONLY from verified
  // user reviews, never invented. Distribution bars sum to the real count.
  const reviewDist = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviews.filter(r => r.rating === star).length,
  }));
  const activePrice = selVariant ? selVariant.salePrice : product.price;
  const activeOriginal = selVariant ? selVariant.price : product.originalPrice;
  const activeStock = selVariant ? selVariant.stock : product.stock;
  const discount = activeOriginal > 0 ? Math.round((1 - activePrice / activeOriginal) * 100) : 0;
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const uniqueColors = [...new Set(product.variants.map(v => v.color).filter(Boolean))];
  const uniqueSizes = [...new Set(product.variants.map(v => v.size).filter(Boolean))];

  const handleAddToCart = () => {
    if (activeStock === 0) return;
    for (let i = 0; i < qty; i++) addToCart(product);
    notify(`${qty} × ${product.name} added to cart!`);
  };

  const handleBuyNow = () => {
    if (activeStock === 0) return;
    for (let i = 0; i < qty; i++) addToCart(product);
    nav('/checkout');
  };

  const submitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { nav('/login'); return; }
    setReviews(prev => [{ id: `r${Date.now()}`, productId: product.id, productName: product.name, userName: user.name, rating: revForm.rating, comment: revForm.comment, status: 'pending', date: new Date().toISOString() }, ...prev]);
    notify('Review submitted! It will appear after approval.');
    setRevForm({ rating: 5, comment: '' });
    setShowRevForm(false);
  };

  const related = products.filter(p => p.isActive && p.id !== product.id && p.category === product.category).slice(0, 4);
  const relatedFallback = related.length === 0 ? products.filter(p => p.isActive && p.id !== product.id).slice(0, 4) : [];

  return (
    <div className="pdp-shell w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
      {/* Breadcrumb */}
      <nav aria-label="Product breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 mb-5">
        <Link to="/" className="hover:text-luxe-gold transition-colors">Home</Link>
        <ChevronRight strokeWidth={1.5} size={11} />
        <Link to="/shop" className="hover:text-luxe-gold transition-colors">Shop</Link>
        <ChevronRight strokeWidth={1.5} size={11} />
        <Link to={`/category/${toSlug(product.category)}`} className="hover:text-luxe-gold transition-colors">{product.category}</Link>
        <ChevronRight strokeWidth={1.5} size={11} />
        <span aria-current="page" className="text-gray-700 truncate min-w-0 max-w-[220px] font-medium">{product.name}</span>
      </nav>

      <div className="pdp-grid grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 lg:gap-10 xl:gap-14">
        {/* Shared gallery: original catalog photos, desktop rail and mobile thumbnails. */}
        <div className="pdp-gallery min-w-0 lg:sticky lg:top-40 self-start">
          <ProductGallery key={product.id} name={product.name} images={product.images} imageAlts={product.imageAlts} selected={selImg} onSelect={setSelImg} />
        </div>

        {/* RIGHT: Product Info — AliExpress-style premium */}
        <div className="pdp-info min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {product.brand && <span className="text-[11px] font-bold text-luxe-gold uppercase tracking-wider">{product.brand}</span>}
            {product.condition !== 'New' && <span className="text-[11px] text-gray-400">| {product.condition}</span>}
            <span className="text-[11px] text-gray-500 px-2 py-0.5 bg-gray-100 rounded-full font-medium">{product.category}</span>
          </div>

          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-luxe-black tracking-tight mb-3">{product.name}</h1>

          {/* Rating — shown ONLY when verified user reviews exist */}
          {reviews.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="flex gap-0.5" aria-hidden="true">{[...Array(5)].map((_, i) => <Star01 strokeWidth={1.5} key={i} size={14} fill={i < Math.round(avgRating) ? 'currentColor' : 'none'} className={i < Math.round(avgRating) ? 'text-star' : 'text-gray-200'} />)}</div>
              <span className="text-xs font-semibold text-luxe-gold hover:underline cursor-pointer" onClick={() => setTab('reviews')}>{avgRating.toFixed(1)} ({reviews.length} verified review{reviews.length !== 1 ? 's' : ''})</span>
            </div>
          ) : (
            <p className="text-xs text-luxe-gray mb-4">No verified reviews yet.</p>
          )}

          {/* Price */}
          <div className="pdp-price-block rounded-2xl border border-luxe-silver p-5 mb-4">
            <p className="text-[10px] uppercase tracking-widest text-luxe-gray font-semibold mb-1">Your price · USD</p>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-serif text-3xl font-bold text-luxe-black">${activePrice.toFixed(2)}</span>
              {discount > 0 && <span className="text-sm text-luxe-gray line-through">${activeOriginal.toFixed(2)}</span>}
              {discount > 0 && <span className="px-2 py-0.5 bg-sale text-white text-[11px] font-bold rounded-full">Save ${(activeOriginal - activePrice).toFixed(2)}</span>}
            </div>
            {discount > 0 && <p className="text-[11px] text-luxe-gold-dark mt-2 font-semibold">{discount}% below the listed original price</p>}
          </div>

          {/* Stock + Shipping — honest: only real supplier-verified stock is
              presented as In Stock / Low Stock; otherwise availability is
              confirmed at checkout. No invented scarcity. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs">
            {product.usInventory && activeStock > 10 && <span className="text-green-600 font-medium"><CheckCircle strokeWidth={1.5} size={13} className="inline mr-1" />In Stock</span>}
            {product.usInventory && activeStock > 0 && activeStock <= 10 && <span className="text-luxe-gold font-medium"><AlertTriangle strokeWidth={1.5} size={13} className="inline mr-1" />Only {activeStock} left in stock</span>}
            {product.usInventory && activeStock === 0 && <span className="text-red-500 font-medium"><X strokeWidth={1.5} size={13} className="inline mr-1" />Out of Stock</span>}
            {!product.usInventory && activeStock > 0 && <span className="text-gray-500"><CheckCircle strokeWidth={1.5} size={13} className="inline mr-1" />Availability confirmed at checkout</span>}
            {product.stockStatus && !product.usInventory && (
              <span className={product.stockStatus === 'in_stock' ? 'text-green-600 font-medium' : product.stockStatus === 'out_of_stock' ? 'text-red-500 font-medium' : 'text-luxe-gold font-medium'}>
                <CheckCircle strokeWidth={1.5} size={13} className="inline mr-1" />
                {{ in_stock: 'In Stock', low_stock: 'Low Stock', out_of_stock: 'Out of Stock', on_backorder: 'On Backorder' }[product.stockStatus] || 'In Stock'}
              </span>
            )}
            {product.freeShipping
              ? <span className="text-green-700 font-medium"><Truck01 strokeWidth={1.5} size={13} className="inline mr-1" />{FREE_SHIPPING_CLAIM}</span>
              : product.shippingCost && parseFloat(product.shippingCost) > 0
                ? <span className="text-gray-500"><Truck01 strokeWidth={1.5} size={13} className="inline mr-1" />Shipping ${parseFloat(product.shippingCost).toFixed(2)}</span>
                : null}
            <span className="text-gray-500"><RefreshCcw01 strokeWidth={1.5} size={13} className="inline mr-1" />Return requests within 30 days</span>
          </div>

          {/* Short Desc */}
          {product.shortDesc && <p className="text-sm text-gray-600 mb-4 leading-relaxed">{product.shortDesc}</p>}

          {/* Color */}
          {uniqueColors.length > 0 && (
            <div className="mb-4">
              <span className="block text-xs font-semibold text-gray-700 mb-2">Color: <span className="text-gray-400 font-normal">{selColor}</span></span>
              <div className="flex gap-2">
                {uniqueColors.map(c => (
                  <button key={c} onClick={() => setSelColor(c)} title={c}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${selColor === c ? 'border-luxe-gold ring-2 ring-luxe-light' : 'border-gray-200 hover:border-gray-400'}`}
                    style={{ backgroundColor: ({ Black: '#000', White: '#fff', Blue: '#3b82f6', Red: '#ef4444', Silver: '#9ca3af', Brown: '#92400e', Green: '#16a34a', Gold: '#d97706', Pink: '#ec4899' })[c] || '#ccc' }} />
                ))}
              </div>
            </div>
          )}
          {/* Size */}
          {uniqueSizes.length > 0 && uniqueSizes[0] !== 'One Size' && (
            <div className="mb-5">
              <span className="block text-xs font-semibold text-gray-700 mb-2">Size: <span className="text-gray-400 font-normal">{selSize}</span></span>
              <div className="flex gap-2 flex-wrap">
                {uniqueSizes.map(s => (
                  <button key={s} onClick={() => setSelSize(s)}
                    className={`px-4 py-2 text-xs font-semibold border-2 rounded-lg transition-all ${selSize === s ? 'border-luxe-gold bg-luxe-light text-luxe-black' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* Free Gift eligibility banner (products $15 and below) */}
          {product.price <= 15 && (
            <div className="mb-4 rounded-xl border-2 border-violet-200 bg-violet-50 p-4">
              <p className="text-sm font-bold text-violet-900">🎁 Eligible for New Customer Free Gift</p>
              <p className="text-xs text-violet-700 mt-1">Have a Luxedge Free Gift code? This item can be claimed free with a valid code.</p>
              <Link to="/free-pet-gift" className="mt-2.5 inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition-colors">
                🎁 Claim as My Free Gift
              </Link>
            </div>
          )}

          {/* Buttons */}
          <div ref={ctaRef} className="pdp-purchase-actions mb-4">
            <WishlistButton product={product} size={20} notify={notify} className="px-4 bg-white border-2 border-gray-200 rounded-xl hover:border-rose-400" />
            <div className="flex items-center border-2 border-gray-200 rounded-xl">
              <button aria-label="Decrease quantity" onClick={() => setQty(Math.max(1, qty - 1))} className="px-3 py-2.5 hover:bg-gray-50 text-gray-500"><Minus strokeWidth={1.5} size={14} /></button>
              <span className="px-3 py-2.5 text-sm font-semibold border-x-2 border-gray-100 min-w-[2.25rem] text-center">{qty}</span>
              <button aria-label="Increase quantity" onClick={() => setQty(Math.min(activeStock || 1, qty + 1))} className="px-3 py-2.5 hover:bg-gray-50 text-gray-500"><Plus strokeWidth={1.5} size={14} /></button>
            </div>
            <button onClick={handleAddToCart} disabled={activeStock === 0}
              className="btn-glow flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray shadow-gold hover:shadow-luxe-gold/30 hover:scale-[1.02] bg-luxe-gold hover:bg-luxe-gold-dark">
              <ShoppingBag01 strokeWidth={1.5} size={15} /> {activeStock === 0 ? 'Out of Stock' : 'Add to Cart'}
            </button>
            <button onClick={handleBuyNow} disabled={activeStock === 0}
              className="btn-glow flex-1 py-3 bg-luxe-black hover:bg-luxe-charcoal disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray text-white text-sm font-bold rounded-xl transition-colors">
              Buy Now
            </button>
          </div>

          {/* Trust / commitments */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { icon: Truck01, t: 'Shipping shown at checkout' },
              { icon: RefreshCcw01, t: 'Return requests within 30 days' },
              { icon: ShieldTick, t: 'Thoughtfully curated' },
              { icon: Lock01, t: 'Encrypted connection' },
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 bg-luxe-cream rounded-xl border border-luxe-silver/70">
                <b.icon strokeWidth={1.5} size={14} className="text-luxe-gold shrink-0" />
                <span className="text-[10px] sm:text-[11px] text-luxe-gray font-medium leading-tight">{b.t}</span>
              </div>
            ))}
          </div>

          {/* Sold-by / store card — AliExpress-style, real Luxedge info only */}
          <div className="mt-4 rounded-2xl border border-luxe-silver/70 bg-white shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 shrink-0 rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center">
                <Building01 strokeWidth={1.5} size={20} className="text-luxe-gold-dark" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Sold by</p>
                {/* The seller is always the store — a product's brand is not its
                    seller, so this must not fall back to (or show) the brand. */}
                <p className="text-sm font-bold text-luxe-black">Luxedge</p>
                <p className="text-[11px] text-luxe-gray truncate">Curated pet essentials · Embani LLC</p>
              </div>
              <Link to="/contact" className="ml-auto shrink-0 px-3 py-2 text-[11px] font-bold text-luxe-gold border border-luxe-gold/40 rounded-lg hover:bg-luxe-gold-soft transition-colors">
                Message
              </Link>
            </div>
            {/* Review score from verified user reviews (never invented) */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-luxe-gray">
              {reviews.length > 0 ? (
                <span className="flex items-center gap-1">
                  <span className="font-bold text-gray-900">{avgRating.toFixed(1)}</span>
                  <span className="text-star">★</span> Positive feedback from {reviews.length} verified review{reviews.length !== 1 ? 's' : ''}
                </span>
              ) : (
                <span>No verified reviews yet — feedback builds as customers shop</span>
              )}
              <span className="flex items-center gap-1"><RefreshCcw01 strokeWidth={1.5} size={12} className="text-luxe-gold" /> Returns within 30 days</span>
            </div>
          </div>

          <p className="flex items-center gap-2 text-xs text-luxe-gray"><Truck01 strokeWidth={1.5} size={14} className="text-luxe-gold shrink-0" /> Delivery timing confirmed during order processing.</p>

          {isFoodOrFeedProduct(product) && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
              <p className="font-semibold">Pet food and feed safety notice</p>
              <p className="mt-1">This listing is for animal food or feed only. Check the product label, ingredients, warnings, intended species, and local requirements before use. Do not use it as human food. Luxedge provides general product information only; follow the label and contact an appropriate qualified professional if you have questions about use.</p>
              {product.supplierUrl && <p className="mt-2">Source information: <a className="underline" href={product.supplierUrl} target="_blank" rel="noopener noreferrer">view supplier listing</a>{product.supplierProductRef ? ` (${product.supplierProductRef})` : ''}</p>}
            </div>
          )}

        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mt-8 mb-5 border-b border-gray-100 overflow-x-auto">
        {([['desc', 'Description'], ['specs', 'Specifications'], ['reviews', `Reviews (${reviews.length})`]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === key ? 'border-luxe-gold text-luxe-black' : 'border-transparent text-luxe-gray hover:text-luxe-black'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Description */}
      {tab === 'desc' && (
        <div className="max-w-3xl">
          <p className="text-[15px] text-luxe-gray leading-relaxed whitespace-pre-line">{product.description || product.shortDesc || 'Please contact us for additional product information before ordering.'}</p>

          <ProductFactSections facts={pdpFacts} />

          {pdpContent && (
            <div className="mt-8 space-y-6 border-t border-gray-100 pt-6">
              <section>
                <h2 className="text-base font-bold text-luxe-black">About this product</h2>
                <p className="mt-2 text-[15px] text-luxe-gray leading-relaxed">{pdpContent.summary}</p>
              </section>
              {pdpContent.confirm.length > 0 && (
                <section>
                  <h2 className="text-base font-bold text-luxe-black">What to check before ordering</h2>
                  <ul className="mt-2 space-y-1.5 list-disc pl-5 text-[15px] text-luxe-gray leading-relaxed">
                    {pdpContent.confirm.map(c => <li key={c}>{c}</li>)}
                  </ul>
                </section>
              )}
              {pdpContent.care.length > 0 && (
                <section>
                  <h2 className="text-base font-bold text-luxe-black">Care and safety</h2>
                  <ul className="mt-2 space-y-1.5 list-disc pl-5 text-[15px] text-luxe-gray leading-relaxed">
                    {pdpContent.care.map(c => <li key={c}>{c}</li>)}
                  </ul>
                </section>
              )}
              {pdpContent.guide && (
                <p className="text-[15px] leading-relaxed">
                  <Link to={pdpContent.guide.href} className="text-luxe-gold font-semibold hover:underline">{pdpContent.guide.label}</Link>
                </p>
              )}
            </div>
          )}

          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
              {product.tags.map(t => <span key={t} className="text-xs text-luxe-gold hover:underline cursor-pointer">#{t}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Specs */}
      {tab === 'specs' && (
        <table className="w-full text-xs max-w-3xl">
          {/* Names the table for screen readers. Only when owner facts exist, so
              a product with empty fields keeps exactly the markup it had. */}
          {pdpFacts.specifications.length > 0 && <caption className="sr-only">Specifications</caption>}
          <tbody>
            {/* Owner facts first (weight + specifications), then the commerce
                rows the catalog genuinely holds. Condition is deliberately not
                listed: it was hardcoded "New" in this component with nothing in
                the catalog behind it. */}
            <ProductSpecRows facts={pdpFacts} />
            {[
              ['Brand', product.brand], ['Category', product.category],
              ['Shipping', product.freeShipping ? 'Free' : product.shippingCost ? `$${product.shippingCost}` : 'Shown at checkout'],
            ].filter(([, v]) => v).map(([k, v], i) => (
              <tr key={k} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                <td className="px-3 py-2.5 font-medium text-gray-600 w-1/3">{k}</td>
                <td className="px-3 py-2.5 text-gray-900">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Reviews — AliExpress-style: big score + star distribution bars */}
      {tab === 'reviews' && (
        <div className="max-w-3xl">
          {reviews.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-5 rounded-2xl border border-luxe-silver/70 bg-luxe-cream/50 p-5">
              {/* Big average score */}
              <div className="text-center">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold text-gray-900">{avgRating.toFixed(1)}</span>
                  <span className="text-lg text-gray-400">/5</span>
                </div>
                <div className="flex gap-0.5 justify-center mt-1">{[...Array(5)].map((_, i) => <Star01 strokeWidth={1.5} key={i} size={15} fill={i < Math.round(avgRating) ? 'currentColor' : 'none'} className={i < Math.round(avgRating) ? 'text-star' : 'text-gray-300'} />)}</div>
                <p className="text-[11px] text-gray-500 mt-1">{reviews.length} verified review{reviews.length !== 1 ? 's' : ''}</p>
              </div>
              {/* Star distribution bars */}
              <div className="flex-1 min-w-[220px] space-y-1.5">
                {reviewDist.map(({ star, count }) => {
                  const pct = reviews.length > 0 ? Math.round((count / reviews.length) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-[11px]">
                      <span className="w-6 text-gray-500 font-medium shrink-0">{star} star</span>
                      <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div className="h-full rounded-full bg-luxe-gold transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right text-gray-400 shrink-0">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {user ? (
            <button onClick={() => setShowRevForm(!showRevForm)} className="text-xs font-semibold text-luxe-gold hover:underline mb-4 block">{showRevForm ? 'Cancel' : 'Write a Review'}</button>
          ) : (
            <p className="text-xs text-gray-500 mb-4"><Link to="/login" className="text-luxe-gold font-semibold hover:underline">Sign in</Link> to review</p>
          )}

          {showRevForm && (
            <form onSubmit={submitReview} className="bg-luxe-cream rounded-xl p-4 mb-5 space-y-3 border border-luxe-silver/70">
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map(s => (
                <button key={s} type="button" onClick={() => setRevForm({ ...revForm, rating: s })}>
                  <Star01 strokeWidth={1.5} size={18} fill={s <= revForm.rating ? 'currentColor' : 'none'} className={s <= revForm.rating ? 'text-star' : 'text-gray-300'} />
                </button>
              ))}</div>
              <textarea required rows={3} value={revForm.comment} onChange={e => setRevForm({ ...revForm, comment: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-luxe-gold resize-none" placeholder="Write your review..." />
              <button type="submit" className="px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold rounded-lg transition-colors">Submit Review</button>
            </form>
          )}

          <div className="space-y-4">
            {reviews.length > 0 ? reviews.map(r => (
              <div key={r.id} className="border-b border-gray-100 pb-4 last:border-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-bold text-gray-800">{r.userName}</span>
                  <div className="flex gap-0.5">{[...Array(5)].map((_, i) => <Star01 strokeWidth={1.5} key={i} size={11} fill={i < r.rating ? 'currentColor' : 'none'} className={i < r.rating ? 'text-star' : 'text-gray-200'} />)}</div>
                  <span className="text-[11px] text-gray-400">- {new Date(r.date).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-gray-600">{r.comment}</p>
              </div>
            )) : <p className="text-sm text-gray-400">No reviews yet.</p>}
          </div>
        </div>
      )}

      {/* Related */}
      <div className="mt-10 pt-6 border-t border-gray-100">
        <h2 className="font-serif text-lg font-bold text-luxe-black mb-4">Related Products</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(related.length > 0 ? related : relatedFallback).map(p => <PCardPremium key={p.id} product={p} />)}
        </div>
      </div>

      {/* Advertisements live BELOW the full product flow (never inside the
          purchase column, never between the price/qty/Add-to-Cart controls) so
          they can never distract from or compete with the buy action. */}
      <AdSenseAd placement="product_below_info" />

      {/* ── Sticky mobile Add to Cart (hidden on desktop) ── */}
      <div className={`lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-luxe-silver/70 shadow-[0_-8px_30px_-12px_rgba(16,26,46,0.2)] transition-transform duration-300 luxe-safe-bottom ${ctaVisible ? 'translate-y-full' : 'translate-y-0'}`} aria-hidden={ctaVisible} inert={ctaVisible}>
        <div className="flex items-center gap-3 px-4 py-3 pr-20">
          <div className="min-w-0">
            <p className="text-sm font-bold text-luxe-black leading-tight">${activePrice.toFixed(2)}</p>
            {discount > 0 && <p className="text-[10px] text-luxe-gray line-through">${activeOriginal.toFixed(2)}</p>}
          </div>
          <button onClick={handleAddToCart} disabled={activeStock === 0}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 bg-luxe-gold hover:bg-luxe-gold-dark disabled:bg-luxe-silver disabled:cursor-not-allowed disabled:text-luxe-gray shadow-gold">
            <ShoppingBag01 strokeWidth={1.5} size={15} /> {activeStock === 0 ? 'Out of Stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    </div>
  );

}

// ============================================================================
// STORE PAGES
// ============================================================================
// Scroll-reveal wrapper — fades content in as it enters the viewport
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) { setShown(true); io.disconnect(); }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal-base ${shown ? 'reveal-show' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

export function SectionHeader({ eyebrow, title, to, linkLabel = 'View All' }: { eyebrow: string; title: string; to?: string; linkLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-5">
      <div>
        <p className="eyebrow mb-1.5">{eyebrow}</p>
        <h2 className="text-xl sm:text-2xl font-serif font-bold text-luxe-black tracking-tight">{title}</h2>
      </div>
      {to && <Link to={to} className="hidden sm:inline-flex items-center gap-1 text-[12px] font-bold text-luxe-gold hover:text-luxe-gold-dark transition-colors group">
        {linkLabel} <ArrowRight strokeWidth={1.5} size={13} className="transition-transform group-hover:translate-x-0.5" />
      </Link>}
    </div>
  );
}


// Rerenders consumers whenever the visual-quality store changes (e.g. a broken
// image is observed) so ranked grids can sink the broken product immediately.
function useMerchVisualVersion(): number {
  return useSyncExternalStore(subscribeVisualQuality, getVisualQualityVersion, () => 0);
}

// Honest payments footnote — never claims Stripe unless the live checkout
// config actually reports a configured, usable provider (server-side truth,
// not a build-time env guess). Falls back to a neutral secure-checkout note.
function SecurePaymentsNote() {
  const [ready, setReady] = useState<'checking' | 'ready' | 'no'>('checking');
  useEffect(() => {
    let live = true;
    fetch('/api/checkout/onsite', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
      .then((r) => r.json())
      .then((d) => { if (live) setReady(d && (d.stripeConfigured || d.anyProviderReady) ? 'ready' : 'no'); })
      .catch(() => { if (live) setReady('no'); });
    return () => { live = false; };
  }, []);
  if (ready === 'checking') {
    return <span>Secure checkout · card details never stored</span>;
  }
  return ready === 'ready'
    ? <span>Secure payments powered by Stripe.</span>
    : <span>Secure checkout · card details never stored</span>;
}

function HomePage() {
  const { products, addToCart, notify } = useApp();
  const [nlEmail, setNlEmail] = useState('');
  const [nlDone, setNlDone] = useState(false);
  const [nlSaved, setNlSaved] = useState(false);

  // No head writes here: the route head owner (AppRoutes) sets the homepage
  // title and meta description, and its strings are byte-identical to the ones
  // the worker pre-renders. This component used to overwrite both on mount with
  // different copy, so after hydration the title and description a visitor (and
  // a JS-rendering crawler) saw were no longer the ones served in the HTML.

  // GA4: fire view_item_list for homepage
  useEffect(() => {
    trackEvent('view_item_list', {
      item_list_id: 'homepage-bestsellers',
      items: products.slice(0, 5).map(p => ({ item_id: p.id, item_name: p.name, price: p.price })),
      ...utmParams(),
    });
  }, [products]);

  // Initial curated bestsellers so the section renders immediately on SSR/first paint with 0ms delay
  const defaultBestsellers = [
    {
      id: 'b4578bca-f04b-4b15-9a84-0a377755ae24',
      slug: 'stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs',
      name: 'Stainless Steel Pet Water Fountain — Filtered Running Water',
      price: 51.95,
      originalPrice: 59.95,
      image: '/images/redesign/products/dog-fountain.jpg',
      badge: 'Bestseller'
    },
    {
      id: 'cozy-cat-nest-bed-round-plush-mat',
      slug: 'cozy-cat-nest-bed-round-plush-mat',
      name: 'Cozy Round Plush Cat Bed & Sleeping Cushion',
      price: 29.95,
      originalPrice: 36.95,
      image: '/images/redesign/products/cat-bed.jpg',
      badge: 'Popular'
    },
    {
      id: 'f8e12ff5-b9f1-4db5-b82b-8ef94e43e264',
      slug: 'outdoor-hanging-bird-feeder',
      name: 'Outdoor Hanging Bird Feeder — Weather-Resistant Seed Station',
      price: 39.95,
      originalPrice: 44.95,
      image: '/images/redesign/products/bird-feeder.jpg',
      badge: 'Wild Bird'
    },
    {
      id: 'f6859ec4-b5a5-4250-8f5b-7957c9a810dd',
      slug: 'himalayan-pink-salt-licks-for-horses',
      name: 'Himalayan Pink Salt Licks for Horses — Essential Trace Minerals',
      price: 18.95,
      originalPrice: 24.95,
      image: '/images/redesign/products/horse-salt-lick.jpg',
      badge: 'Equine Choice'
    },
    {
      id: 'himalayan-salt-rock-for-cattle',
      slug: 'himalayan-salt-rock-for-cattle',
      name: 'Himalayan Pink Salt Block for Cattle — 30 lb Essential Minerals',
      price: 49.95,
      originalPrice: 59.95,
      image: '/images/redesign/products/cattle-salt-block.jpg',
      badge: 'Farm Choice'
    }
  ];

  // Map to live products when catalog data is present
  const bestSellers = useMemo(() => {
    const active = products.filter(p => p.isActive);
    if (active.length === 0) return defaultBestsellers;

    const findBySlug = (slug: string) => active.find(p => p.slug === slug);
    const findByCat = (catName: string) => active.find(p => p.category?.toLowerCase().includes(catName.toLowerCase()) && p.images?.length > 0);

    const dog = findBySlug('stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs') || findByCat('dog') || active[0];
    const cat = findBySlug('collapsible-cat-tunnel-with-crinkle-peek-hole-3-way-play-tube') || findByCat('cat') || active[1];
    const bird = findBySlug('outdoor-hanging-bird-feeder') || findByCat('bird') || active[2];
    const horse = findBySlug('himalayan-pink-salt-licks-for-horses') || findByCat('horse') || active[3];
    const livestock = findBySlug('heavy-duty-cattle-feed-trough') || findByCat('cattle') || active[4];

    return [
      {
        id: dog?.id || defaultBestsellers[0].id,
        slug: dog?.slug || defaultBestsellers[0].slug,
        name: dog?.name || defaultBestsellers[0].name,
        price: dog?.price || defaultBestsellers[0].price,
        originalPrice: dog?.originalPrice || defaultBestsellers[0].originalPrice,
        image: (dog && firstUsableImage(dog)) || defaultBestsellers[0].image,
        badge: 'Bestseller',
        rawProduct: dog
      },
      {
        id: cat?.id || defaultBestsellers[1].id,
        slug: cat?.slug || defaultBestsellers[1].slug,
        name: cat?.name || defaultBestsellers[1].name,
        price: cat?.price || defaultBestsellers[1].price,
        originalPrice: cat?.originalPrice || defaultBestsellers[1].originalPrice,
        image: (cat && firstUsableImage(cat)) || defaultBestsellers[1].image,
        badge: 'Popular',
        rawProduct: cat
      },
      {
        id: bird?.id || defaultBestsellers[2].id,
        slug: bird?.slug || defaultBestsellers[2].slug,
        name: bird?.name || defaultBestsellers[2].name,
        price: bird?.price || defaultBestsellers[2].price,
        originalPrice: bird?.originalPrice || defaultBestsellers[2].originalPrice,
        image: (bird && firstUsableImage(bird)) || defaultBestsellers[2].image,
        badge: 'Wild Bird',
        rawProduct: bird
      },
      {
        id: horse?.id || defaultBestsellers[3].id,
        slug: horse?.slug || defaultBestsellers[3].slug,
        name: horse?.name || defaultBestsellers[3].name,
        price: horse?.price || defaultBestsellers[3].price,
        originalPrice: horse?.originalPrice || defaultBestsellers[3].originalPrice,
        image: (horse && firstUsableImage(horse)) || defaultBestsellers[3].image,
        badge: 'Equine Choice',
        rawProduct: horse
      },
      {
        id: livestock?.id || defaultBestsellers[4].id,
        slug: livestock?.slug || defaultBestsellers[4].slug,
        name: livestock?.name || defaultBestsellers[4].name,
        price: livestock?.price || defaultBestsellers[4].price,
        originalPrice: livestock?.originalPrice || defaultBestsellers[4].originalPrice,
        image: (livestock && firstUsableImage(livestock)) || defaultBestsellers[4].image,
        badge: 'Farm Choice',
        rawProduct: livestock
      }
    ];
  }, [products]);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlEmail.trim()) return;
    const em = nlEmail.trim();
    fetch('/api/crm/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: em, pageUrl: window.location.href })
    })
      .then(r => r.json())
      .then((d: { ok?: boolean; leadSaved?: boolean }) => {
        setNlSaved(!!(d && d.ok && d.leadSaved));
      })
      .catch(() => setNlSaved(true))
      .finally(() => setNlDone(true));
  };

  return (
    <div className="bg-white text-gray-900 selection:bg-[#1E4636] selection:text-white">

      {/* ══════════════════════════════════════════════════════════
          1. MASTER HERO SECTION
      ══════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-[#FAF8F5] border-b border-gray-100 py-12 sm:py-16 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            
            {/* Left Column: Story & Actions */}
            <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1E4636]/10 text-[#1E4636] text-[11px] sm:text-xs font-bold uppercase tracking-[0.2em]">
                <ShieldTick strokeWidth={2} size={14} />
                For Every Animal. A Brighter Tomorrow.
              </div>

              <h1 className="font-serif text-4xl sm:text-5xl lg:text-[56px] font-bold text-[#111827] leading-[1.12] tracking-tight">
                Better Care<br />
                for <span className="text-[#1E4636]">Every Animal.</span>
              </h1>

              <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-xl mx-auto lg:mx-0">
                Premium pet supplies, livestock solutions, and expert guides — all in one place. Trusted by animal lovers who care.
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 pt-2">
                <Link
                  to="/shop"
                  className="inline-flex items-center gap-2.5 px-8 py-4 bg-[#1E4636] hover:bg-[#153428] text-white rounded-full font-bold text-sm sm:text-base transition-all shadow-lg hover:shadow-xl hover:scale-[1.02]"
                >
                  Shop Now <ArrowRight strokeWidth={2} size={16} />
                </Link>
                <a
                  href="#shop-by-animal"
                  className="inline-flex items-center gap-2 px-7 py-4 bg-white hover:bg-gray-50 text-[#1E4636] border-2 border-[#1E4636]/30 hover:border-[#1E4636] rounded-full font-bold text-sm sm:text-base transition-all"
                >
                  Explore by Animal
                </a>
              </div>

              {/* Truthful Trust Points Row */}
              <div className="pt-6 border-t border-gray-200/70 grid grid-cols-3 gap-3 text-left">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-emerald-50 text-[#1E4636] flex items-center justify-center shrink-0">
                    <ShieldTick strokeWidth={1.5} size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900">Quality Products</p>
                    <p className="text-[11px] text-gray-500">Carefully selected</p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-emerald-50 text-[#1E4636] flex items-center justify-center shrink-0">
                    <Truck01 strokeWidth={1.5} size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900">Reliable Shipping</p>
                    <p className="text-[11px] text-gray-500">Fast &amp; trackable</p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-emerald-50 text-[#1E4636] flex items-center justify-center shrink-0">
                    <Lock01 strokeWidth={1.5} size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900">Secure Checkout</p>
                    <p className="text-[11px] text-gray-500">Shop with confidence</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Hero Visual Lineup */}
            <div className="lg:col-span-6 relative">
              <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-black/5 bg-white aspect-[16/10] sm:aspect-[16/10]">
                <img
                  src="/images/redesign/hero-animals.jpg"
                  alt="Healthy dog, cat, parrot, horse, and livestock together in natural farm meadow"
                  loading="eager"
                  fetchPriority="high"
                  className="w-full h-full object-cover object-center transition-transform duration-700 hover:scale-105"
                />
                
                {/* Floating Brand Mission Badge */}
                <div className="absolute bottom-4 right-4 max-w-xs bg-[#143023]/92 backdrop-blur-md text-white p-3.5 sm:p-4 rounded-2xl shadow-xl border border-white/20 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#C5A880] text-[#143023] flex items-center justify-center shrink-0 font-bold">
                    <Heart size={16} fill="currentColor" />
                  </div>
                  <p className="text-xs font-medium leading-snug text-white/95">
                    Care for Pets. Support Livestock. Build a Kinder World.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          2. SHOP BY ANIMAL (6 Clean Category Cards)
      ══════════════════════════════════════════════════════════ */}
      <section id="shop-by-animal" className="py-14 sm:py-18 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#111827]">Shop by Animal</h2>
              <p className="text-sm text-gray-500 mt-1">Find exactly what they need. Tailored care for every kind of companion.</p>
            </div>
            <Link
              to="/shop"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1E4636] hover:text-[#153428] transition-colors group"
            >
              View All Categories <ArrowRight strokeWidth={2} size={15} className="transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {/* 6 Category Cards Responsive Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5">
            {[
              { name: 'Dog Supplies', to: '/category/dog-supplies', img: '/images/redesign/cat-dog.jpg' },
              { name: 'Cat Supplies', to: '/category/cat-supplies', img: '/images/redesign/cat-cat.jpg' },
              { name: 'Bird Supplies', to: '/category/bird-supplies', img: '/images/redesign/cat-bird.jpg' },
              { name: 'Horse Supplies', to: '/category/horse', img: '/images/redesign/cat-horse.jpg' },
              { name: 'Livestock Supplies', to: '/category/cattle', img: '/images/redesign/cat-livestock.jpg' },
              { name: 'Accessories', to: '/category/pet-accessories', img: '/images/redesign/cat-accessories.jpg' },
            ].map((cat) => (
              <Link
                key={cat.name}
                to={cat.to}
                className="group flex flex-col rounded-2xl overflow-hidden bg-white border border-gray-150 hover:border-[#1E4636]/40 shadow-sm hover:shadow-lg transition-all duration-300"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-gray-100">
                  <img
                    src={cat.img}
                    alt={cat.name}
                    loading="lazy"
                    className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-3.5 sm:p-4 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-gray-900 group-hover:text-[#1E4636] transition-colors leading-tight">
                      {cat.name}
                    </h3>
                    <p className="text-[11px] font-medium text-gray-500 mt-0.5">Shop Now</p>
                  </div>
                  <span className="w-7 h-7 rounded-full bg-[#1E4636]/10 text-[#1E4636] group-hover:bg-[#1E4636] group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                    <ArrowRight strokeWidth={2} size={13} />
                  </span>
                </div>
              </Link>
            ))}
          </div>

        </div>
      </section>

      <section className="bg-[#FAF8F5] py-8 sm:py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <BuyerGuidance
            title="Shop with the details in view"
            note="Start with the animal and everyday task you are shopping for, then use each listing’s stated size, materials, price, and availability to narrow the options."
          />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          3. VALUE & ASSURANCE STRIP
      ══════════════════════════════════════════════════════════ */}
      <section className="bg-[#FAF8F5] py-8 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center sm:text-left">
            
            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <div className="w-11 h-11 rounded-2xl bg-white border border-gray-200/80 shadow-sm flex items-center justify-center text-[#1E4636] shrink-0">
                <Truck01 strokeWidth={1.5} size={20} />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-gray-900">Fast &amp; Reliable Shipping</h4>
                <p className="text-[11px] text-gray-500">Get your orders delivered safely</p>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <div className="w-11 h-11 rounded-2xl bg-white border border-gray-200/80 shadow-sm flex items-center justify-center text-[#1E4636] shrink-0">
                <ShieldTick strokeWidth={1.5} size={20} />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-gray-900">Safe &amp; Secure Payments</h4>
                <p className="text-[11px] text-gray-500">Shop with peace of mind</p>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <div className="w-11 h-11 rounded-2xl bg-white border border-gray-200/80 shadow-sm flex items-center justify-center text-[#1E4636] shrink-0">
                <Package strokeWidth={1.5} size={20} />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-gray-900">Carefully Curated</h4>
                <p className="text-[11px] text-gray-500">Quality you can rely on</p>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <div className="w-11 h-11 rounded-2xl bg-white border border-gray-200/80 shadow-sm flex items-center justify-center text-[#1E4636] shrink-0">
                <Headphones01 strokeWidth={1.5} size={20} />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-gray-900">Support for Every Animal</h4>
                <p className="text-[11px] text-gray-500">Pets, livestock and beyond</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          4. BEST SELLERS (5 Real Curated Products)
      ══════════════════════════════════════════════════════════ */}
      <section className="py-14 sm:py-18 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#111827]">Best Sellers</h2>
              <p className="text-sm text-gray-500 mt-1">Popular products loved by pet and animal owners.</p>
            </div>
            <Link
              to="/shop"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1E4636] hover:text-[#153428] transition-colors group"
            >
              View All Products <ArrowRight strokeWidth={2} size={15} className="transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

          {/* 5 Product Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5">
            {bestSellers.map((item) => {
              const pSlug = item.slug;
              const pImage = item.image || LUXEDGE_IMAGE_FALLBACK;
              const targetProduct = (item as any).rawProduct || {
                id: item.id,
                name: item.name,
                price: item.price,
                originalPrice: item.originalPrice,
                slug: item.slug,
                images: [item.image],
                isActive: true,
                rating: 5,
                reviews: 12,
                category: item.badge
              };

              return (
                <div
                  key={item.id}
                  className="group flex flex-col justify-between rounded-2xl border border-gray-150 bg-white p-3 sm:p-4 shadow-sm hover:shadow-lg transition-all relative"
                >
                  {/* Top Badges & Wishlist */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900">
                      {item.badge}
                    </span>
                    <WishlistButton product={targetProduct as any} notify={notify} className="p-1 rounded-full hover:bg-gray-100" />
                  </div>

                  {/* Product Image */}
                  <Link to={`/product/${pSlug}`} className="block aspect-square rounded-xl overflow-hidden bg-gray-50 mb-3">
                    <img
                      src={pImage}
                      alt={item.name}
                      loading="lazy"
                      onError={onImageError}
                      className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                    />
                  </Link>

                  {/* Product Info */}
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <Link to={`/product/${pSlug}`}>
                        <h3 className="text-xs sm:text-sm font-semibold text-gray-900 hover:text-[#1E4636] transition-colors line-clamp-2 leading-snug">
                          {item.name}
                        </h3>
                      </Link>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-bold text-sm sm:text-base text-gray-900">
                          ${Number(item.price).toFixed(2)}
                        </span>
                        {item.originalPrice > item.price && (
                          <span className="text-xs text-gray-400 line-through">
                            ${Number(item.originalPrice).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Add to Cart Button */}
                    <button
                      onClick={() => {
                        addToCart(targetProduct as any);
                        notify(`Added ${item.name.slice(0, 25)}... to cart`);
                      }}
                      className="mt-3 w-full py-2.5 bg-[#1E4636] hover:bg-[#153428] text-white rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm hover:shadow"
                    >
                      <ShoppingBag01 size={14} /> Add to Cart
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          5. EDITORIAL & COMMUNITY 3-GRID (from Reference B)
      ══════════════════════════════════════════════════════════ */}
      <section className="py-14 sm:py-20 bg-[#FAF8F5] border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            
            {/* Block 1: A Community of Animal Lovers */}
            <div className="rounded-3xl overflow-hidden bg-white border border-gray-150 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between">
              <div className="aspect-[16/10] w-full overflow-hidden bg-gray-100">
                <img
                  src="/images/redesign/editorial-community.jpg"
                  alt="Smiling owner hugging golden retriever outdoors"
                  className="w-full h-full object-cover object-[center_20%] transition-transform duration-500 hover:scale-105"
                />
              </div>
              <div className="p-6 sm:p-7 flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1E4636] mb-1.5">More Than a Store</p>
                  <h3 className="font-serif text-xl sm:text-2xl font-bold text-gray-900 mb-2.5">
                    A Community of Animal Lovers
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Helpful guides, real advice, and curated products — because caring for animals is a way of life.
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <Link
                    to="/about"
                    className="inline-flex items-center gap-2 text-sm font-bold text-[#1E4636] hover:text-[#153428] transition-colors"
                  >
                    Our Story <ArrowRight strokeWidth={2} size={15} />
                  </Link>
                </div>
              </div>
            </div>

            {/* Block 2: Expert Guides & Tips */}
            <div className="rounded-3xl overflow-hidden bg-white border border-gray-150 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between">
              <div className="aspect-[16/10] w-full overflow-hidden bg-gray-100">
                <img
                  src="/images/redesign/cat-cat.jpg"
                  alt="Gentle domestic cat"
                  className="w-full h-full object-cover object-center transition-transform duration-500 hover:scale-105"
                />
              </div>
              <div className="p-6 sm:p-7 flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1E4636] mb-1.5">Care Knowledge</p>
                  <h3 className="font-serif text-xl sm:text-2xl font-bold text-gray-900 mb-2.5">
                    Expert Guides &amp; Tips
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Practical buying guides, product setup, and everyday care routines for the animals you look after.
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <Link
                    to="/blog"
                    className="inline-flex items-center gap-2 text-sm font-bold text-[#1E4636] hover:text-[#153428] transition-colors"
                  >
                    Visit the Blog <ArrowRight strokeWidth={2} size={15} />
                  </Link>
                </div>
              </div>
            </div>

            {/* Block 3: Livestock & Equine Solutions */}
            <div className="rounded-3xl overflow-hidden bg-white border border-gray-150 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between">
              <div className="aspect-[16/10] w-full overflow-hidden bg-gray-100">
                <img
                  src="/images/redesign/editorial-livestock.jpg"
                  alt="Cattle grazing in open farm pasture"
                  className="w-full h-full object-cover object-[center_60%] transition-transform duration-500 hover:scale-105"
                />
              </div>
              <div className="p-6 sm:p-7 flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1E4636] mb-1.5">Farm &amp; Stable Care</p>
                  <h3 className="font-serif text-xl sm:text-2xl font-bold text-gray-900 mb-2.5">
                    Livestock Solutions
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Essential trace mineral salt blocks, feeders, and grooming supplies for healthier farms and animals.
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <Link
                    to="/category/cattle"
                    className="inline-flex items-center gap-2 text-sm font-bold text-[#1E4636] hover:text-[#153428] transition-colors"
                  >
                    Explore Now <ArrowRight strokeWidth={2} size={15} />
                  </Link>
                </div>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          6. EDUCATIONAL MEDIA HUB SPOTLIGHT
      ══════════════════════════════════════════════════════════ */}
      <MediaLatestSection />

      {/* Shared site copy (src/content/sitePages.ts) — the worker pre-renders
          these same strings, so the crawler and the visitor see one page. */}
      <SiteSections sections={HOME_SECTIONS} />
      <SiteFaq items={HOME_FAQ} />

      {/* ══════════════════════════════════════════════════════════
          7. NEWSLETTER (Warm Botanical Sign-Up)
      ══════════════════════════════════════════════════════════ */}
      <section className="py-14 sm:py-16 bg-[#F6F8F5] relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Join the Luxedge Family
          </h2>
          <p className="text-sm sm:text-base text-gray-600 max-w-md mx-auto mb-6">
            Get exclusive offers, animal-care tips, and new arrivals delivered to your inbox.
          </p>

          {nlDone ? (
            <div className="max-w-md mx-auto p-4 rounded-2xl bg-white border border-[#1E4636]/20 text-center shadow-sm">
              <p className="text-sm font-bold text-[#1E4636] mb-1">You're on the list! 🎉</p>
              <p className="text-xs text-gray-600">
                {nlSaved
                  ? <>We saved <span className="font-semibold text-[#1E4636]">{nlEmail}</span> to our subscriber list. You'll hear from us soon with seasonal care tips!</>
                  : <>Thank you for joining. You'll hear from us soon with seasonal care tips and special subscriber perks!</>}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                required
                value={nlEmail}
                onChange={e => setNlEmail(e.target.value)}
                placeholder="Enter your email address"
                aria-label="Email address"
                className="flex-1 px-5 py-3.5 bg-white border border-gray-300 rounded-full text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1E4636] focus:ring-2 focus:ring-[#1E4636]/15 shadow-sm"
              />
              <button
                type="submit"
                className="px-8 py-3.5 bg-[#1E4636] hover:bg-[#153428] text-white font-bold rounded-full text-sm transition-all shadow-md hover:shadow-lg"
              >
                Subscribe
              </button>
            </form>
          )}
        </div>
      </section>

    </div>
  );
}

function ShopPage() {
  const { slug } = useParams<{ slug?: string }>();
  const { products, merchStats } = useApp();
  // Subscribe so quality-store changes (broken images) re-rank the grid.
  useMerchVisualVersion();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const initialCat = slug ? fromSlug(slug) : 'All';
  const [cat, setCat] = useState(initialCat);
  const [q, setQ] = useState(params.get('q') || '');
  const [sort, setSort] = useState('recommended');
  const [maxPrice, setMaxPrice] = useState(() => { const m = params.get('max'); return m ? +m : 0; }); // 0 = no limit
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [onlyFreeShipping, setOnlyFreeShipping] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDeals = q.toLowerCase() === 'deal';
  const hasRealDeals = products.some(p => p.isActive && (p.saleEnabled || p.originalPrice > p.price));
  const dealFallbackIds = new Set(
    hasRealDeals ? [] : products
      .filter(p => p.isActive && p.images.length > 0 && (p.featured || p.newArrival))
      .slice(0, 12)
      .map(p => p.id)
  );

  // Sync when URL slug or query changes
  useEffect(() => { setCat(slug ? fromSlug(slug) : 'All'); }, [slug]);
  useEffect(() => { const qp = params.get('q'); if (qp) trackEvent('search', { search_term: qp, ...utmParams() }); setQ(qp || ''); }, [params]);
  useEffect(() => { const m = params.get('max'); if (m !== null) setMaxPrice(+m); }, [params]);

  const base = products.filter(p => p.isActive)
    .filter(p => {
      if (cat === 'All') return true;
      if (p.category === cat) return true;
      if (cat === 'Cat Supplies') {
        const slug = (p.id || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        const tags = Array.isArray(p.tags) ? p.tags.map(t => String(t).toLowerCase()) : [];
        if (tags.some(t => t.includes('cat'))) return true;
        if (slug.includes('cat-') || slug.includes('-cat') || /\bcat\b|\bcats\b/i.test(name)) return true;
      }
      return false;
    })
    .filter(p => isDeals
      ? (p.saleEnabled || p.originalPrice > p.price || dealFallbackIds.has(p.id))
      : p.name.toLowerCase().includes(q.toLowerCase()))
    .filter(p => maxPrice === 0 || p.price <= maxPrice)
    .filter(p => !onlyInStock || p.stock > 0)
    .filter(p => !onlyFreeShipping || p.freeShipping)
    .filter(p => !onlyNew || p.newArrival);
  // Recommended (default) = smart adaptive merchandising — real stats when
  // available, otherwise visual/availability/freshness. Category relevance is
  // guaranteed because the category filter above runs first (a high global
  // scorer can never cross into a category it does not belong to).
  const f = sort === 'recommended'
    ? rankProducts(base, { stats: merchStats, explore: true })
    : base.slice().sort((a, b) => {
        if (sort === 'price-low') return a.price - b.price;
        if (sort === 'price-high') return b.price - a.price;
        if (sort === 'newest') return (b.newArrival ? 1 : 0) - (a.newArrival ? 1 : 0);
        if (sort === 'featured') return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
        return 0;
      });

  // GA4: fire view_item_list whenever the visible filtered set changes (max 20 rows).
  useEffect(() => {
    if (f.length === 0) return;
    trackEvent('view_item_list', {
      item_list_id: isDeals ? 'shop-deals' : `shop-${cat.toLowerCase().replace(/\s+/g, '-')}`,
      items: f.slice(0, 20).map(p => ({ item_id: p.id, item_name: p.name, price: p.price })),
      ...utmParams(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, q, sort, maxPrice, onlyInStock, onlyFreeShipping, onlyNew]);

  const handleCatChange = (newCat: string) => {
    if (newCat === 'All') nav('/shop');
    else nav(`/category/${toSlug(newCat)}`);
  };

  const pageTitle = isDeals ? 'Deals' : (cat === 'All' ? 'Shop All Products' : cat);
  const pageDesc = isDeals
    ? (hasRealDeals ? 'Real catalog offers and sale picks, updated as new deals land.' : 'Featured pet essentials selected from the current collection.')
    : (cat === 'All' ? 'Handpicked for quality, comfort, and value.'
      : categoryContentFor(cat)?.desc || CAT_META[cat]?.desc || `Browse our ${cat} collection`);
  // Per-category buying guidance, shared with the worker's pre-rendered category
  // page (src/content/categoryContent.ts) so both surfaces show the same copy.
  const catContent = cat === 'All' || isDeals ? null : categoryContentFor(cat);
  const activeFilters = (cat !== 'All' ? 1 : 0) + (maxPrice > 0 ? 1 : 0) + (onlyInStock ? 1 : 0) + (onlyFreeShipping ? 1 : 0) + (onlyNew ? 1 : 0);

  const clearAll = () => { setCat('All'); setQ(''); setMaxPrice(0); setOnlyInStock(false); setOnlyFreeShipping(false); setOnlyNew(false); nav('/shop'); };

  // Reusable sidebar filter block (desktop sidebar + mobile drawer)
  const FilterBlock = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Category</h3>
        <div className="space-y-1">
          {CAT_LIST.map(c => (
            <button key={c} onClick={() => handleCatChange(c)}
              className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors ${
                cat === c ? 'bg-luxe-gold-soft text-luxe-gold-dark font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Price</h3>
        <select value={maxPrice} onChange={e => setMaxPrice(+e.target.value)}
          className="w-full text-[13px] px-3 py-2.5 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20">
          <option value={0}>Any price</option>
          <option value={25}>Under $25</option>
          <option value={50}>Under $50</option>
          <option value={100}>Under $100</option>
          <option value={200}>Under $200</option>
        </select>
      </div>
      <div>
        <h3 className="text-xs font-bold text-luxe-black uppercase tracking-wider mb-3">Availability</h3>
        <div className="space-y-1">
          {[['in-stock', 'In stock', onlyInStock, setOnlyInStock] as const, ['free-shipping', 'Free shipping', onlyFreeShipping, setOnlyFreeShipping] as const, ['new', 'New arrivals', onlyNew, setOnlyNew] as const].map(([id, label, active, setter]) => (
            <button key={id} onClick={() => setter(!active)}
              className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors ${
                active ? 'bg-luxe-gold-soft text-luxe-gold-dark font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              <span className="flex items-center gap-1"><CheckCircle strokeWidth={1.5} size={12} className={active ? 'text-luxe-gold' : 'text-gray-300'} /> {label}</span>
            </button>
          ))}
        </div>
      </div>
      {activeFilters > 0 && (
        <button onClick={clearAll} className="w-full text-center text-[12px] font-semibold text-luxe-gold hover:text-luxe-gold-dark hover:underline">Clear all filters ({activeFilters})</button>
      )}
    </div>
  );

  return (
    <div>
      {/* Page Header — premium CategoryHero (breadcrumb → headline → desc →
          CTA → chips + pet image) on category pages. General/All/Deals pages
          keep the simpler branded header. */}
      <section className="bg-gradient-to-b from-luxe-cream to-white border-b border-luxe-silver/60">
        {!isDeals && cat !== 'All' ? (
          <div className="max-w-[1440px] mx-auto px-4 py-8 sm:py-10">
            <CategoryHero config={categoryHeroConfig(cat, pageDesc)} />
          </div>
        ) : (
          <div className="max-w-[1440px] mx-auto px-4 py-10 sm:py-12">
            <div className="max-w-xl">
              <p className="eyebrow mb-2">{isDeals ? 'Savings' : 'Our Collection'}</p>
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-extrabold text-luxe-black tracking-tight leading-[1.05]">{pageTitle}</h1>
              <div className="h-1 w-14 bg-luxe-gold rounded-full mt-3" aria-hidden="true" />
              <p className="text-luxe-gray text-xs sm:text-sm mt-3">{pageDesc}</p>
            </div>
            {catContent && catContent.considerations.length > 0 && (
              <div className="mt-6 max-w-3xl">
                <h2 className="font-serif text-lg font-bold text-luxe-black">What to look for in {cat.toLowerCase()}</h2>
                <ul className="mt-3 space-y-2 list-disc pl-5 text-xs sm:text-sm text-luxe-gray leading-relaxed">
                  {catContent.considerations.map((c) => (<li key={c}>{c}</li>))}
                </ul>
                {catContent.guides.length > 0 && (
                  <p className="mt-4 text-xs sm:text-sm text-luxe-gray">
                    Related guides:{' '}
                    {catContent.guides.map((g, i) => (
                      <Fragment key={g.href}>
                        {i > 0 && ' · '}
                        <Link to={g.href} className="text-luxe-gold-dark font-semibold underline decoration-luxe-gold/40 underline-offset-2 hover:text-luxe-gold">{g.label}</Link>
                      </Fragment>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Toolbar: mobile Filter button + search + sort — sticks below the header */}
      <div className="bg-white/90 backdrop-blur-md border-b border-luxe-silver/70 sticky top-16 lg:top-[7.1rem] z-30 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="max-w-[1440px] mx-auto px-3 py-2.5 flex items-center gap-2">
          <button onClick={() => setDrawerOpen(true)}
            className="lg:hidden shrink-0 flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-2 border border-luxe-silver rounded-lg text-luxe-charcoal hover:border-luxe-gold/60 hover:text-luxe-gold transition-colors">
            <Sliders01 strokeWidth={1.5} size={14} /> Filter{activeFilters > 0 && <span className="w-4 h-4 rounded-full bg-luxe-gold text-white text-[9px] font-bold flex items-center justify-center">{activeFilters}</span>}
          </button>
          <div className="relative flex-1 min-w-0">
            <SearchMd strokeWidth={1.5} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-luxe-gray" />
            <input placeholder="Search products..." value={q} onChange={e => setQ(e.target.value)} aria-label="Search products"
              className="w-full pl-9 pr-3 py-2 border border-luxe-silver rounded-lg text-[13px] focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 bg-luxe-cream/60" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="shrink-0 text-[12px] bg-transparent border-0 focus:outline-none text-luxe-gray font-medium">
            <option value="recommended">Recommended</option>
            <option value="featured">Featured</option>
            <option value="newest">Newest</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
          </select>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-luxe-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[290px] max-w-[85vw] bg-white shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-luxe-silver/70">
              <h2 className="font-serif text-base font-bold text-luxe-black">Filters</h2>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close filters"
                className="p-1.5 rounded-lg text-luxe-gray hover:bg-luxe-cream"><X strokeWidth={1.5} size={16} /></button>
            </div>
            <div className="p-4">
              <FilterBlock />
              <button onClick={() => setDrawerOpen(false)}
                className="mt-6 w-full py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-sm font-bold rounded-xl transition-colors">
                Show {f.length} products
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content: sidebar + grid */}
      <div className="max-w-[1440px] mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-56 shrink-0 bg-white border border-luxe-silver/70 rounded-2xl p-5 h-fit sticky top-16 shadow-sm">
            <FilterBlock />
          </aside>

          <div id="product-grid" className="flex-1 min-w-0 scroll-mt-40">
            <p className="text-[12px] text-luxe-gray mb-3">{f.length} product{f.length !== 1 ? 's' : ''}{cat !== 'All' ? ` in ${cat}` : ''}</p>

            {f.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                {f.map(p => <PCard key={p.id} product={p} />)}
              </div>
            ) : products.length === 0 ? (
              /* Phase 4E.1 — genuinely empty catalog (no published DB products):
                 premium curation notice, never fake cards or fake counts. */
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Stars01 strokeWidth={1.5} size={22} className="text-luxe-gold" /></div>
                <p className="font-serif text-lg font-bold text-luxe-black mb-1">New premium pet essentials are being curated</p>
                <p className="text-sm text-luxe-gray mb-5">Every product is verified before it reaches your door. Please check back soon.</p>
                <Link to="/" className="inline-block px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">Back to home</Link>
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><SearchMd strokeWidth={1.5} size={22} className="text-luxe-gold" /></div>
                <p className="font-serif text-lg font-bold text-luxe-black mb-1">No products found</p>
                <p className="text-sm text-luxe-gray mb-5">Try adjusting your search or filters.</p>
                <button onClick={clearAll} className="px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">Clear all filters</button>
              </div>
            )}
            {/* Ad: After Product Row */}
            <AdSenseAd placement="shop_after_row" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CartDrawer() {
  const { cart, cartOpen, closeCart, updateQty, removeFromCart, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold, notify } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [codeInput, setCodeInput] = useState('');

  // Close the drawer whenever the route changes (e.g. Proceed to Checkout).
  useEffect(() => { closeCart(); }, [loc.pathname, closeCart]);

  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const sh = freeShippingEnabled && sub >= freeShippingThreshold ? 0 : 4.99;
  const discount = coupon ? (coupon.discountType === 'percent' ? Math.round(sub * (coupon.discountValue / 100) * 100) / 100 : Math.min(sub, coupon.discountValue)) : 0;
  const tot = Math.max(0, sub - discount) + sh;
  const remaining = freeShippingEnabled ? freeShippingThreshold - sub : 0;
  const applyCode = () => {
    const err = applyCoupon(codeInput);
    if (err) notify(err, 'error'); else { notify('Coupon applied'); setCodeInput(''); }
  };

  const checkout = () => {
    closeCart();
    nav('/checkout');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={closeCart}
        className={`fixed inset-0 bg-black/40 z-[90] transition-opacity duration-300 ${cartOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Shopping cart"
        aria-hidden={!cartOpen}
        inert={!cartOpen}
        className={`fixed top-0 right-0 h-[100dvh] w-full max-w-md bg-white z-[95] shadow-2xl transform transition-transform duration-300 ease-out ${cartOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex min-h-0 h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <ShoppingBag01 strokeWidth={1.5} size={20} className="text-luxe-gold" />
              <h2 className="text-lg font-semibold text-luxe-black">Your Cart ({cart.length})</h2>
            </div>
            <button onClick={closeCart} aria-label="Close cart" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <X strokeWidth={1.5} size={18} />
            </button>
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center"><ShoppingBag01 strokeWidth={1.5} size={28} className="text-luxe-gold" /></div>
              <p className="text-luxe-black text-sm font-semibold">Your cart is empty</p>
              <p className="text-luxe-gray text-xs">Add some handpicked essentials to get started.</p>
              <button onClick={() => { closeCart(); nav('/shop'); }} className="btn-glow mt-2 px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white text-xs font-bold uppercase tracking-wider rounded-full transition-colors">
                Shop Now
              </button>
            </div>
          ) : (
            <>
              {/* Items */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {freeShippingEnabled ? (sub < freeShippingThreshold ? (
                  <div className="rounded-lg bg-luxe-light border border-luxe-silver px-3 py-2.5">
                    <p className="text-[11px] text-gray-600">You're <span className="font-bold text-luxe-gold">${remaining.toFixed(2)}</span> away from free shipping</p>
                    <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-luxe-gold rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (sub / freeShippingThreshold) * 100)}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 flex items-center gap-2">
                    <CheckCircle strokeWidth={1.5} size={14} className="text-green-600 shrink-0" />
                    <p className="text-[11px] font-semibold text-green-700">You've unlocked FREE shipping!</p>
                  </div>
                )) : null}

                {/* Coupon (real active store coupons only) */}
                <div className="rounded-lg border border-luxe-silver px-3 py-2.5">
                  {coupon ? (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-green-700"><CheckCircle strokeWidth={1.5} size={12} className="inline mr-1" />{coupon.code} applied (−${discount.toFixed(2)})</span>
                      <button onClick={removeCoupon} className="text-[11px] text-gray-400 hover:text-red-500">Remove</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code"
                        className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-luxe-gold"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } }} />
                      <button onClick={applyCode} className="px-3 py-2 bg-luxe-black hover:bg-luxe-gold text-white text-xs font-semibold rounded-lg transition-colors">Apply</button>
                    </div>
                  )}
                </div>

                {cart.map(item => {
                  // Defensive rendering: a cart item may never crash the
                  // drawer. Fall back to the branded placeholder image, safe
                  // text, and a $0 price for any missing field.
                  const img = (Array.isArray(item.product.images) && item.product.images[0]) || LUXEDGE_IMAGE_FALLBACK;
                  const nm = item.product.name || 'Product';
                  const cat = item.product.category || '';
                  const pr = typeof item.product.price === 'number' && Number.isFinite(item.product.price) ? item.product.price : 0;
                  return (
                  <div key={item.product.id} className="flex gap-3 p-3 bg-luxe-cream rounded-xl border border-luxe-silver/50">
                    <img src={img} alt={nm} onError={onImageError} className="w-20 h-20 object-cover rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-luxe-black truncate">{nm}</h4>
                      <p className="text-[11px] text-gray-400 truncate">{cat}</p>
                      <p className="text-sm font-bold text-luxe-gold mt-0.5">${pr.toFixed(2)}</p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200">
                          <button onClick={() => updateQty(item.product.id, item.quantity - 1)} aria-label="Decrease quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Minus strokeWidth={1.5} size={12} /></button>
                          <input type="text" inputMode="numeric" defaultValue={item.quantity} key={item.quantity}
                            onBlur={(e) => { const v = parseInt(e.target.value, 10); if (Number.isNaN(v)) { e.target.value = String(item.quantity); return; } const max = Math.max(1, item.product.stock || 99); updateQty(item.product.id, Math.min(max, Math.max(1, v))); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            aria-label="Quantity — type a number"
                            className="w-8 text-center text-xs font-semibold bg-transparent border-x border-gray-200 py-1 focus:outline-none focus:ring-1 focus:ring-luxe-gold/40" />
                          <button onClick={() => updateQty(item.product.id, item.quantity + 1)} aria-label="Increase quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Plus strokeWidth={1.5} size={12} /></button>
                        </div>
                        <button onClick={() => removeFromCart(item.product.id)} aria-label="Remove item" className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"><Trash01 strokeWidth={1.5} size={14} /></button>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-luxe-black shrink-0">${(pr * item.quantity).toFixed(2)}</p>
                  </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-100 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3">
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-semibold text-luxe-black">${sub.toFixed(2)}</span></div>
                  {discount > 0 && <div className="flex justify-between"><span className="text-gray-500">Coupon ({coupon?.code})</span><span className="font-semibold text-green-600">−${discount.toFixed(2)}</span></div>}
                  <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={`font-semibold ${sh === 0 ? 'text-green-600' : 'text-luxe-black'}`}>{sh === 0 ? 'FREE' : `$${sh.toFixed(2)}`}</span></div>
                  <div className="flex justify-between pt-2 border-t border-gray-100 text-base"><span className="font-semibold text-luxe-black">Total</span><span className="font-bold text-luxe-black">${tot.toFixed(2)}</span></div>
                </div>
                <button onClick={checkout} className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl transition-colors uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-gold">
                  <Lock01 strokeWidth={1.5} size={14} /> Proceed to Checkout
                </button>
                <button onClick={() => { closeCart(); nav('/cart'); }} className="w-full py-2.5 text-xs text-gray-500 hover:text-luxe-black transition-colors">
                  View Full Cart
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function CartPage() {
  const { cart, updateQty, removeFromCart } = useApp(); const nav = useNavigate();
  const sub = cart.reduce((s, i) => s + i.product.price * i.quantity, 0); const sh = sub >= 50 ? 0 : 4.99; const tot = sub + sh;
  const remaining = 50 - sub;

  if (cart.length === 0) return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><ShoppingBag01 strokeWidth={1.5} size={28} className="text-luxe-gold" /></div>
        <h1 className="font-serif text-2xl font-bold text-luxe-black mb-2">Your cart is empty</h1>
        <p className="text-luxe-gray text-sm mb-6">Discover handpicked essentials your pet will love.</p>
        <Link to="/shop" className="btn-glow inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Shop Now</Link>
      </div>
    </div>
  );

  return (
    <div className="py-12 bg-luxe-cream min-h-screen">
      <div className="max-w-5xl mx-auto px-4">
        <p className="eyebrow mb-2">Your Selection</p>
        <h1 className="font-serif text-3xl font-bold text-luxe-black mb-8">Shopping Cart</h1>
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Items */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-luxe-silver/70 shadow-sm divide-y divide-luxe-silver/60">
            {cart.map(i => {
              const img = (Array.isArray(i.product.images) && i.product.images[0]) || LUXEDGE_IMAGE_FALLBACK;
              return (
              <div key={i.product.id} className="flex gap-4 p-5">
                <img src={img} alt={i.product.name || 'Product'} onError={onImageError} className="w-20 h-20 object-cover rounded-xl border border-luxe-silver/60" />
                <div className="flex-1 min-w-0">
                  <Link to={productPath(i.product)} className="font-semibold text-luxe-black hover:text-luxe-gold-dark transition-colors line-clamp-1">{i.product.name}</Link>
                  <p className="text-luxe-gray text-xs mt-0.5">{i.product.category}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-1 bg-luxe-cream border border-luxe-silver rounded-lg">
                      <button onClick={() => updateQty(i.product.id, i.quantity - 1)} aria-label="Decrease quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Minus strokeWidth={1.5} size={13} /></button>
                      <input type="text" inputMode="numeric" defaultValue={i.quantity} key={i.quantity}
                        onBlur={(e) => { const v = parseInt(e.target.value, 10); if (Number.isNaN(v)) { e.target.value = String(i.quantity); return; } const max = Math.max(1, i.product.stock || 99); updateQty(i.product.id, Math.min(max, Math.max(1, v))); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        aria-label="Quantity — type a number"
                        className="w-9 text-center text-xs font-semibold bg-transparent border-x border-luxe-silver py-1.5 focus:outline-none focus:ring-1 focus:ring-luxe-gold/40" />
                      <button onClick={() => updateQty(i.product.id, i.quantity + 1)} aria-label="Increase quantity" className="p-1.5 hover:text-luxe-gold transition-colors"><Plus strokeWidth={1.5} size={13} /></button>
                    </div>
                    <button onClick={() => removeFromCart(i.product.id)} aria-label="Remove item" className="p-1.5 text-luxe-gray hover:text-luxe-red transition-colors"><Trash01 strokeWidth={1.5} size={15} /></button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-luxe-black">${((i.product.price || 0) * i.quantity).toFixed(2)}</p>
                  <p className="text-xs text-luxe-gray">${(i.product.price || 0).toFixed(2)} each</p>
                </div>
              </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="h-fit lg:sticky lg:top-20 bg-white rounded-2xl border border-luxe-silver/70 shadow-sm p-6">
            <h2 className="font-serif text-lg font-bold text-luxe-black mb-5">Order Summary</h2>
            {sub < 50 && (
              <div className="rounded-xl bg-luxe-gold-soft/70 border border-luxe-gold/20 px-4 py-3 mb-5">
                <p className="text-[11px] text-luxe-gray">Add <span className="font-bold text-luxe-gold-dark">${remaining.toFixed(2)}</span> more for free shipping</p>
                <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden">
                  <div className="h-full bg-luxe-gold rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (sub / 50) * 100)}%` }} />
                </div>
              </div>
            )}
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between"><span className="text-luxe-gray">Subtotal</span><span className="font-medium text-luxe-black">${sub.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-luxe-gray">Shipping</span><span className={`font-medium ${sh === 0 ? 'text-luxe-success' : 'text-luxe-black'}`}>{sh === 0 ? 'FREE' : `$${sh.toFixed(2)}`}</span></div>
              <div className="flex justify-between text-lg font-bold pt-3 border-t border-luxe-silver/70"><span className="text-luxe-black">Total</span><span className="text-luxe-black">${tot.toFixed(2)}</span></div>
            </div>
            <button onClick={() => nav('/checkout')} className="mt-5 w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-xl text-sm transition-colors shadow-gold flex items-center justify-center gap-2">
              <Lock01 strokeWidth={1.5} size={14} /> Proceed to Checkout
            </button>
            <Link to="/shop" className="mt-3 block w-full py-2.5 text-center text-xs text-luxe-gray hover:text-luxe-gold transition-colors">Continue Shopping</Link>
            {/* Delivery reassurance — concise, honest (rates shown at checkout). */}
            <div className="mt-4 pt-4 border-t border-luxe-silver/60 text-[11px] text-luxe-gray space-y-1.5">
              <p className="flex items-center gap-1.5"><Truck01 strokeWidth={1.5} size={13} className="text-luxe-gold shrink-0" /> Delivery options and live rates shown at checkout</p>
              <Link to={NAV_PATHS.returns} className="flex items-center gap-1.5 hover:text-luxe-gold transition-colors"><RefreshCcw01 strokeWidth={1.5} size={13} className="text-luxe-gold shrink-0" /> Easy returns — see our return policy</Link>
              <p className="flex items-center gap-1.5"><Lock01 strokeWidth={1.5} size={13} className="text-luxe-gold shrink-0" /> Secure checkout — card details never stored</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// GA4 purchase — the cart is cleared when the Stripe-hosted checkout returns,
// so we snapshot the order client-side at submit and fire a real `purchase`
// event once on the verified paid success page. `transaction_id` (order number
// or Stripe session id) lets GA4 de-duplicate if the page is ever revisited.
// ============================================================================
const firedPurchases = new Set<string>();
/**
 * Fire the GA4 purchase for a verified paid checkout return. `order.total` is
 * stored in dollars while Stripe's `session.amountTotal` is in cents — both
 * are normalized to dollars for the event `value` (the final charged total).
 */
function firePurchaseEvent(r: CheckoutSessionStatus): void {
  const orderDollars = typeof r.order?.total === 'number' ? r.order.total : null;
  const sessionDollars = r.session?.amountTotal != null ? r.session.amountTotal / 100 : null;
  const items: never[] = [];
  trackEvent('purchase', {
    transaction_id: r.order?.orderNumber || r.session?.id || '',
    value: orderDollars ?? sessionDollars ?? 0,
    currency: r.order?.currency || r.session?.currency || 'USD',
    ...(items.length ? { items } : {}),
    ...utmParams(),
  });
}


// ============================================================================
// PAYMENT RESULT (real status from Stripe — never a fake success)
//
// Two flows land here:
//   • legacy hosted-checkout: /checkout/success?session_id=cs_…
//   • on-site PaymentElement: /checkout/success?source=onsite&intent=pi_…&order=LX-…
// Both verify against the server/Stripe before showing success.
// ============================================================================
function CheckoutSuccessPage() {
  const { clearCart, removeCoupon } = useApp();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id') || '';
  const intentId = searchParams.get('intent') || '';
  const orderNumberParam = searchParams.get('order') || '';
  const onsite = searchParams.get('source') === 'onsite';
  const [status, setStatus] = useState<'loading' | 'paid' | 'unpaid' | 'error'>('loading');
  const [info, setInfo] = useState<{ orderNumber: string | null; total: number | null; currency: string | null; email: string | null }>({ orderNumber: null, total: null, currency: null, email: null });

  useEffect(() => {
    if (!onsite && !sessionId) { setStatus('error'); return; }
    let active = true;
    (async () => {
      try {
        if (onsite) {
          if (!intentId || !orderNumberParam) { setStatus('error'); return; }
          // Real verification — the server checks the PaymentIntent status and
          // promotes the pending order only when payment truly succeeded.
          const v = await verifyOnsitePaymentApi(orderNumberParam, intentId);
          if (!active) return;
          if (v.paid) {
            setInfo({ orderNumber: orderNumberParam, total: null, currency: null, email: null });
            setStatus('paid');
            clearCart(); removeCoupon();
            if (!firedPurchases.has(intentId)) {
              firedPurchases.add(intentId);
              // GA4 purchase — the on-site page already snapshots nothing;
              // fire a lightweight purchase keyed on the stable order number.
              trackEvent('purchase', { transaction_id: orderNumberParam, currency: 'USD', ...utmParams() });
            }
          } else {
            setStatus('unpaid');
          }
          return;
        }
        const r = await fetchCheckoutSessionStatus(sessionId);
        if (!active) return;
        // `order.total` is stored in dollars while Stripe's `amountTotal` is in
        // cents — normalize both to dollars for a consistent display/total.
        const orderDollars = typeof r.order?.total === 'number' ? r.order.total : null;
        const sessionDollars = r.session?.amountTotal != null ? r.session.amountTotal / 100 : null;
        setInfo({ orderNumber: r.order?.orderNumber ?? null, total: orderDollars ?? sessionDollars, currency: r.order?.currency ?? r.session?.currency ?? null, email: r.session?.customerEmail ?? null });
        setStatus(r.session?.paymentStatus === 'paid' ? 'paid' : 'unpaid');
        if (r.session?.paymentStatus === 'paid') {
          clearCart(); removeCoupon();
          if (!firedPurchases.has(sessionId)) {
            firedPurchases.add(sessionId);
            firePurchaseEvent(r);
          }
        }
      } catch {
        if (active) setStatus('error');
      }
    })();
    return () => { active = false; };
  }, [onsite, sessionId, intentId, orderNumberParam, clearCart, removeCoupon]);

  if (status === 'loading') return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <Loading01 strokeWidth={1.5} size={36} className="text-luxe-gold animate-spin mx-auto mb-4" />
        <p className="text-sm text-luxe-gray">Verifying your payment with Stripe…</p>
      </div>
    </div>
  );

  if (status === 'error' || status === 'unpaid') {
    const unpaid = status === 'unpaid';
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${unpaid ? 'bg-amber-100' : 'bg-gray-100'}`}>
            {unpaid ? <Clock strokeWidth={1.5} size={38} className="text-amber-500" /> : <AlertTriangle strokeWidth={1.5} size={38} className="text-gray-400" />}
          </div>
          <h1 className="font-serif text-2xl font-bold text-luxe-black mb-2">{unpaid ? 'Payment not completed' : 'Could not verify payment'}</h1>
          <p className="text-sm text-luxe-gray mb-6">{unpaid ? 'Your payment has not been completed yet. If you were charged, the order will be confirmed shortly.' : 'We could not confirm your payment status right now. Check your email for a receipt.'}</p>
          <div className="flex gap-3 justify-center">
            <Link to="/cart" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Back to Cart</Link>
            <Link to="/shop" className="px-6 py-3 border border-gray-200 hover:bg-gray-50 font-semibold rounded-full text-sm">Continue Shopping</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle strokeWidth={1.5} size={40} className="text-green-600" /></div>
        <h1 className="font-serif text-2xl font-bold text-luxe-black mb-2">Thank you for your order!</h1>
        {info.orderNumber && <p className="text-gray-600 mb-1">Order <span className="font-mono font-semibold text-gray-800">{info.orderNumber}</span></p>}
        <p className="text-sm text-gray-400 mb-6">{info.email ? `A receipt is on its way to ${info.email}.` : 'Your payment was confirmed by Stripe.'}</p>
        <div className="flex gap-3 justify-center">
          <Link to="/orders" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">View Orders</Link>
          <Link to="/shop" className="px-6 py-3 border border-gray-200 hover:bg-gray-50 font-semibold rounded-full text-sm">Continue Shopping</Link>
        </div>
      </div>
    </div>
  );
}

interface RealOrderRow { id: string; order_number: string; customer_email: string | null; total: number | null; currency: string | null; status: string; created_at: string; }

function OrdersPage() {
  const { user } = useApp();
  const nav = useNavigate();
  const [realOrders, setRealOrders] = useState<RealOrderRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (!user) nav('/login'); }, [user, nav]);
  // Real orders only: created server-side by the Stripe webhook. Buyers have
  // no customer-orders endpoint yet — the honest state is "No Orders Yet".
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin') { setLoaded(true); return; }
    const token = getAccessToken();
    if (!token) { setLoaded(true); return; }
    fetch('/api/checkout?action=orders', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: { orders?: RealOrderRow[] }) => setRealOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => setRealOrders([]))
      .finally(() => setLoaded(true));
  }, [user]);

  const empty = <div className="min-h-[60vh] flex items-center justify-center px-4"><div className="text-center"><div className="w-16 h-16 mx-auto rounded-full bg-luxe-gold-soft ring-1 ring-luxe-gold/20 flex items-center justify-center mb-4"><Package strokeWidth={1.5} size={28} className="text-luxe-gold" /></div><h2 className="font-serif text-2xl font-bold text-luxe-black mb-2">No Orders Yet</h2><p className="text-sm text-luxe-gray mb-6">When you place an order, it will appear here.</p><Link to="/shop" className="inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm transition-colors">Shop Now</Link></div></div>;
  if (!user) return null;
  if (user.role !== 'admin') return empty;
  if (!loaded) return <div className="min-h-[60vh] flex items-center justify-center text-sm text-luxe-gray">Loading orders…</div>;
  if (realOrders.length === 0) return empty;
  return (
    <div className="py-12 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-serif font-bold mb-2">Orders</h1>
        <p className="text-sm text-luxe-gray mb-8">Real payment records persisted by the Stripe webhook.</p>
        {realOrders.map(o => (
          <div key={o.id} className="bg-white rounded-xl border p-6 mb-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
              <div className="min-w-0"><p className="font-semibold break-words">{o.order_number}</p><p className="text-sm text-gray-500">{new Date(o.created_at).toLocaleString()}</p></div>
              <span className="self-start shrink-0 px-3 py-1 bg-luxe-gold-soft text-luxe-gold-dark rounded-full text-sm capitalize">{o.status.replace('_', ' ')}</span>
            </div>
            <div className="pt-4 mt-4 border-t flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-all font-semibold text-sm text-gray-500">{o.customer_email || '—'}</span>
              <span className="shrink-0 font-semibold">Total <span className="text-lg font-bold text-luxe-gold">${Number(o.total || 0).toFixed(2)}</span></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoginPage() {
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, guestLogin, cart } = useApp();
  const nav = useNavigate();

  const sub = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const res = await login(e, p);
    if (res.message) { setErr(res.message); setLoading(false); return; }
    // Admin accounts go straight to the admin dashboard; customers go home.
    nav(useAuthStore.getState().isAdmin ? '/admin' : '/');
  };

  const asGuest = () => { guestLogin(); nav(cart.length ? '/checkout' : '/'); };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-12 overflow-hidden bg-gradient-to-br from-luxe-light via-white to-white">
      {/* Ambient glows — soft blue, light theme */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-luxe-gold/10 blur-[120px]" />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-luxe-gold/10 blur-[140px]" />
      <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #1E4636 1px, transparent 0)', backgroundSize: '30px 30px' }} />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Logo — perfectly centered above card */}
        <div className="flex justify-center mb-7">
          <Link to="/" className="inline-flex items-center gap-3 group" aria-label="Luxedge home">
            <img src="/luxedge-mark.png" alt="Luxedge" className="h-12 sm:h-14 w-auto object-contain transition-transform duration-300 group-hover:scale-105" />
            <span className="flex flex-col leading-none text-left">
              <span className="font-brand text-2xl font-bold tracking-[0.16em] text-gray-900">LUXEDGE</span>
              <span className="text-[8px] font-bold tracking-[0.22em] text-[#1E4636] mt-1">PETS • LIVESTOCK • A BRIGHTER TOMORROW</span>
            </span>
          </Link>
        </div>

        {/* Card — light glass */}
        <div className="bg-white rounded-3xl border border-luxe-silver p-8 shadow-[0_20px_60px_-20px_rgba(23,32,51,0.15)]">
          <h1 className="text-2xl font-bold text-luxe-black mb-1.5">Welcome Back</h1>
          <p className="text-sm text-gray-500 mb-8">Sign in to your account to continue</p>

          {err && <div className="mb-5 p-3 bg-sale-bg border border-sale/30 rounded-xl text-sale text-sm text-center animate-scale-in">{err}</div>}
          {!isSupabaseConfigured() && (
            <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
              Account sign-in is not configured yet (Supabase env vars missing). You can still shop as a guest — no account needed.
            </div>
          )}

          <form onSubmit={sub} className="space-y-5">
            <div className="relative">
              <Mail01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={e} onChange={ev => setE(ev.target.value)} placeholder="Email address"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Lock01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password"
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff strokeWidth={1.5} size={18} /> : <Eye strokeWidth={1.5} size={18} />}
              </button>
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer text-gray-600">
                <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-luxe-gold" defaultChecked />
                Remember me
              </label>
              <Link to="/contact" className="text-luxe-gold hover:text-luxe-gold-dark transition-colors">Need help signing in?</Link>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-gold">
              {loading ? <Loading01 strokeWidth={1.5} size={18} className="animate-spin" /> : <>{'Sign In'}<ArrowRight strokeWidth={1.5} size={16} /></>}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-luxe-silver" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">or continue as</span>
            <div className="flex-1 h-px bg-luxe-silver" />
          </div>

          {/* Guest Login */}
          <button onClick={asGuest}
            className="w-full py-3.5 border border-luxe-silver hover:border-luxe-gold/60 bg-luxe-cream hover:bg-luxe-light text-luxe-black font-semibold rounded-xl transition-all flex flex-wrap items-center justify-center gap-2 group">
            <UserIcon strokeWidth={1.5} size={16} className="text-luxe-gold" />
            Continue as Guest
            <span className="text-[10px] uppercase tracking-wider text-gray-400 group-hover:text-luxe-gold transition-colors">No account needed</span>
          </button>

          <p className="mt-5 text-center text-sm text-gray-500">
            No account?{' '}
            <Link to="/signup" className="text-luxe-gold font-semibold hover:text-luxe-gold-dark transition-colors">Create one</Link>
          </p>

          {/* Go to store — browse without an account */}
          <Link to="/shop"
            className="mt-4 w-full py-2.5 rounded-xl border border-luxe-silver bg-white hover:bg-luxe-cream hover:border-luxe-gold/50 text-gray-600 hover:text-luxe-gold text-sm font-medium transition-all flex items-center justify-center gap-2">
            <ShoppingBag01 strokeWidth={1.5} size={15} className="text-luxe-gold" />
            Go to store
          </Link>
        </div>

        {/* Trust line */}
        <div className="mt-8 flex items-center justify-center gap-6 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><ShieldTick strokeWidth={1.5} size={13} className="text-luxe-gold" /> Clear checkout terms</span>
          <span className="flex items-center gap-1.5"><Truck01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> Shipping shown at checkout</span>
          <Link to={NAV_PATHS.returns} className="flex items-center gap-1.5 hover:text-luxe-gold transition-colors"><RefreshCcw01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> Easy returns — see our return policy</Link>
        </div>

        {/* Admin link */}
        <p className="mt-6 text-center text-xs text-gray-500">
          Admin? <Link to="/admin/login" className="text-luxe-gold/80 hover:text-luxe-gold transition-colors">Go to Admin Login</Link>
        </p>
      </div>
    </div>
  );
}

function SignupPage() {
  const [n, setN] = useState('');
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useApp();
  const nav = useNavigate();

  const sub = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    setLoading(true);
    const errMsg = await signup(n, e, p);
    if (errMsg) { setErr(errMsg); setLoading(false); return; }
    nav('/');
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-12 overflow-hidden bg-gradient-to-br from-luxe-light via-white to-white">
      {/* Ambient glows — soft blue, light theme */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-luxe-gold/10 blur-[120px]" />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-luxe-gold/10 blur-[140px]" />
      <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #1E4636 1px, transparent 0)', backgroundSize: '30px 30px' }} />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Logo — perfectly centered above card */}
        <div className="flex justify-center mb-7">
          <Link to="/" className="inline-flex items-center gap-3 group" aria-label="Luxedge home">
            <img src="/luxedge-mark.png" alt="Luxedge" className="h-12 sm:h-14 w-auto object-contain transition-transform duration-300 group-hover:scale-105" />
            <span className="flex flex-col leading-none text-left">
              <span className="font-brand text-2xl font-bold tracking-[0.16em] text-gray-900">LUXEDGE</span>
              <span className="text-[8px] font-bold tracking-[0.22em] text-[#1E4636] mt-1">PETS • LIVESTOCK • A BRIGHTER TOMORROW</span>
            </span>
          </Link>
        </div>

        {/* Card — light glass */}
        <div className="bg-white rounded-3xl border border-luxe-silver p-8 shadow-[0_20px_60px_-20px_rgba(23,32,51,0.15)]">
          <h1 className="text-2xl font-bold text-luxe-black mb-1.5">Join Luxedge</h1>
          <p className="text-sm text-gray-500 mb-8">Create your account to start shopping</p>

          {err && <div className="mb-5 p-3 bg-sale-bg border border-sale/30 rounded-xl text-sale text-sm text-center animate-scale-in">{err}</div>}
          {!isSupabaseConfigured() && (
            <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
              Account creation is not configured yet (Supabase env vars missing). You can still shop as a guest — no account needed.
            </div>
          )}

          <form onSubmit={sub} className="space-y-5">
            <div className="relative">
              <UserIcon strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" required value={n} onChange={ev => setN(ev.target.value)} placeholder="Full Name"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Mail01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={e} onChange={ev => setE(ev.target.value)} placeholder="Email address"
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
            </div>
            <div className="relative">
              <Lock01 strokeWidth={1.5} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPw ? 'text' : 'password'} required value={p} onChange={ev => setP(ev.target.value)} placeholder="Password (6+ characters)" minLength={6}
                className="w-full pl-12 pr-12 py-3.5 bg-white border border-luxe-silver rounded-xl text-sm text-luxe-black placeholder-gray-400 focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-luxe-gold transition-colors">
                {showPw ? <EyeOff strokeWidth={1.5} size={18} /> : <Eye strokeWidth={1.5} size={18} />}
              </button>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 shadow-gold">
              {loading ? <Loading01 strokeWidth={1.5} size={18} className="animate-spin" /> : <>{'Create Account'}<ArrowRight strokeWidth={1.5} size={16} /></>}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            Have an account?{' '}
            <Link to="/login" className="text-luxe-gold font-semibold hover:text-luxe-gold-dark transition-colors">Sign In</Link>
          </p>

          {/* Go to store — browse without an account */}
          <Link to="/shop"
            className="mt-4 w-full py-2.5 rounded-xl border border-luxe-silver bg-white hover:bg-luxe-cream hover:border-luxe-gold/50 text-gray-600 hover:text-luxe-gold text-sm font-medium transition-all flex items-center justify-center gap-2">
            <ShoppingBag01 strokeWidth={1.5} size={15} className="text-luxe-gold" />
            Go to store
          </Link>
        </div>

        {/* Trust line */}
        <div className="mt-8 flex items-center justify-center gap-6 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><ShieldTick strokeWidth={1.5} size={13} className="text-luxe-gold" /> Clear checkout terms</span>
          <span className="flex items-center gap-1.5"><Truck01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> Shipping shown at checkout</span>
          <Link to={NAV_PATHS.returns} className="flex items-center gap-1.5 hover:text-luxe-gold transition-colors"><RefreshCcw01 strokeWidth={1.5} size={13} className="text-luxe-gold" /> Easy returns — see our return policy</Link>
        </div>
      </div>
    </div>
  );
}

function AdminLoginPage() {
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  // 'activate' = redeem the admin-issued one-time code and choose the first
  // password. There is no transactional email at $0, so the code is handed over
  // out-of-band and the form never pretends a message was sent.
  const [mode, setMode] = useState<'login' | 'activate'>('login');
  const [code, setCode] = useState('');
  const [newPass, setNewPass] = useState('');
  const { login } = useApp();
  const nav = useNavigate();

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    setLoading(true);
    const res = await login(e, p, true);
    setLoading(false);
    if (res.message) {
      setErr(res.message);
      // The server told us this account has not chosen a password yet: reveal
      // the one-time activation-code form instead of leaving a dead end.
      if (res.code === 'ACTIVATION_REQUIRED') setMode('activate');
      return;
    }
    nav('/admin');
  };

  const handleActivate = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    if (newPass.length < 10) { setErr('Your password must be at least 10 characters.'); return; }
    setLoading(true);
    const result = await buyerActivate(e.trim(), code.trim(), newPass);
    if (!result.ok) {
      setLoading(false);
      setErr(result.message || 'Activation failed. Please check the code and try again.');
      return;
    }
    // The account now has a password: sign in with it and enter the console.
    const res = await login(e, newPass, true);
    setLoading(false);
    if (res.message) { setErr(res.message); return; }
    nav('/admin');
  };

  return (
    <div className="min-h-screen bg-[#0F231B] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 border border-[#1E4636]/10">
        <div className="flex flex-col items-center justify-center mb-6 text-center">
          <Link to="/" className="flex items-center gap-2.5 mb-4 group" aria-label="Luxedge home">
            <img src="/luxedge-mark.png" alt="Luxedge" className="h-11 w-auto object-contain transition-transform duration-300 group-hover:scale-105" />
            <span className="flex flex-col leading-none text-left">
              <span className="font-brand text-xl font-bold tracking-[0.16em] text-gray-900">LUXEDGE</span>
              <span className="text-[7.5px] font-bold tracking-[0.22em] text-[#1E4636] mt-0.5">PETS • LIVESTOCK • A BRIGHTER TOMORROW</span>
            </span>
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EBF3EE] text-[#1E4636] text-xs font-semibold mb-1">
            <ShieldTick strokeWidth={1.5} size={15} />
            <span>Admin Console</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Authorized store management access</p>
        </div>

        {err && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            <AlertTriangle strokeWidth={1.5} size={16} />{err}
          </div>
        )}

        {mode === 'activate' ? (
          <form onSubmit={handleActivate} className="space-y-4">
            <div className="p-3 bg-[#EBF3EE] border border-[#1E4636]/10 rounded-xl text-[#1E4636] text-xs leading-relaxed">
              Enter the one-time activation code issued for this account, then choose a new password. The code works once and expires after 14 days.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" placeholder="Enter admin email" value={e} onChange={ev => setE(ev.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Activation code</label>
              <input type="text" placeholder="XXXX-XXXX-XX" value={code} onChange={ev => setCode(ev.target.value)} autoComplete="one-time-code" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm uppercase tracking-widest focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">New password</label>
              <input type="password" placeholder="At least 10 characters" value={newPass} onChange={ev => setNewPass(ev.target.value)} minLength={10} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20" required />
            </div>
            <button type="submit" disabled={loading} className="w-full py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-gold disabled:opacity-70">
              {loading ? <Loading01 strokeWidth={1.5} size={16} className="animate-spin" /> : <Lock01 strokeWidth={1.5} size={16} />} {loading ? 'Activating…' : 'Activate & sign in'}
            </button>
            <button type="button" onClick={() => { setMode('login'); setErr(''); }} className="w-full text-center text-xs text-gray-500 hover:text-gray-700">
              ← Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" placeholder="Enter admin email" value={e} onChange={ev => setE(ev.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Password</label>
              <input type="password" placeholder="Enter password" value={p} onChange={ev => setP(ev.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20" required />
            </div>
            <button type="submit" disabled={loading} className="w-full py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-gold disabled:opacity-70">
              {loading ? <Loading01 strokeWidth={1.5} size={16} className="animate-spin" /> : <Lock01 strokeWidth={1.5} size={16} />} {loading ? 'Signing in…' : 'Access Dashboard'}
            </button>
            <button type="button" onClick={() => { setMode('activate'); setErr(''); }} className="w-full text-center text-xs text-gray-500 hover:text-gray-700">
              Have an activation code? Use it →
            </button>
          </form>
        )}

        <div className="mt-6 flex items-center gap-2 text-xs text-gray-400 justify-center">
          <ShieldTick strokeWidth={1.5} size={12} /> Protected admin area
        </div>

        <Link to="/" className="block text-center text-sm text-gray-500 mt-4 hover:text-gray-700">← Back to Store</Link>
      </div>
    </div>
  );
}

// ============================================================================
// LEGAL + SUPPORT + BRAND PAGES
// ============================================================================
function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-luxe-silver/60 py-12"><div className="max-w-4xl mx-auto px-4 text-center"><h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black">{title}</h1></div></section>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl border p-6 sm:p-10">
          <p className="text-xs text-gray-400 mb-8">Last updated: {updated}</p>
          <div className="space-y-8 text-sm text-gray-600 leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
function LS({ t, children }: { t: string; children: ReactNode }) { return <div><h2 className="text-base font-bold text-gray-900 mb-2">{t}</h2>{children}</div>; }

function AboutPage() {
  return (<div>
    <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-16"><div className="max-w-4xl mx-auto px-4 text-center">
      <p className="text-luxe-gold text-xs font-semibold uppercase tracking-wider mb-3">About</p>
      <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-3">About Luxedge</h1>
      <p className="text-gray-500 max-w-xl mx-auto">{ABOUT_QUOTE}</p>
    </div></section>
    <section className="py-14"><div className="max-w-3xl mx-auto px-4 space-y-6">
      <p className="text-lg text-gray-700 leading-relaxed">{ABOUT_LEAD}</p>
      {ABOUT_SECTIONS.map((s) => (
        <Fragment key={s.title}>
          <h2 className="text-xl font-bold text-gray-900 pt-4">{s.title}</h2>
          <p className="text-gray-600 leading-relaxed">{s.body}</p>
        </Fragment>
      ))}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-10 pt-8 border-t">
        {[{v:'Eligible',l:'Shipping Options'},{v:'30-Day',l:'Return Requests'},{v:'1-3 days',l:'Order Processing'},{v:'Mon–Fri',l:'Support 9AM–6PM CT'}].map((s,i)=>
          <div key={i} className="text-center"><p className="text-2xl font-bold text-luxe-gold">{s.v}</p><p className="text-xs text-gray-500 mt-1">{s.l}</p></div>
        )}
      </div>
    </div></section>
  </div>);
}

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={POLICY_LAST_UPDATED['/privacy']}>
      {/* Same PRIVACY_SECTIONS the worker pre-renders (src/content/policies.ts),
          so the crawl HTML and the hydrated page cannot publish different terms.
          policy-source.test.ts pins the parity. */}
      {PRIVACY_SECTIONS.map((s) => (
        <LS key={s.title} t={s.title}>
          {s.body.split('\n').map((line, i) => (<p key={i} className={i ? 'mt-2' : undefined}>{line}</p>))}
        </LS>
      ))}
    </LegalPage>
  );
}
function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={POLICY_LAST_UPDATED['/terms']}>
      {/* Same TERMS_SECTIONS the worker pre-renders (src/content/policies.ts). */}
      {TERMS_SECTIONS.map((s) => (
        <LS key={s.title} t={s.title}>
          {s.body.split('\n').map((line, i) => (<p key={i} className={i ? 'mt-2' : undefined}>{line}</p>))}
        </LS>
      ))}
    </LegalPage>
  );
}
function ReturnsPage() {
  return (
    <LegalPage title="Returns & Replacement Policy" updated={POLICY_LAST_UPDATED['/returns']}>
      {/* Same RETURNS_SECTIONS the worker pre-renders (src/content/policies.ts). */}
      {RETURNS_SECTIONS.map((s) => (
        <LS key={s.title} t={s.title}>
          {s.body.split('\n').map((line, i) => (<p key={i} className={i ? 'mt-2' : undefined}>{line}</p>))}
        </LS>
      ))}
    </LegalPage>
  );
}
function ShippingPolicyPage() {
  return (
    <LegalPage title="Shipping Policy" updated={POLICY_LAST_UPDATED['/shipping-policy']}>
      {/* Rendered from the same SHIPPING_SECTIONS the worker pre-renders, so the
          crawl HTML and the hydrated page cannot drift apart. The table and the
          in-page links below are the only React-only extras; a parity test keeps
          the two section lists identical. */}
      {SHIPPING_SECTIONS.map((s) => (
        <LS key={s.title} t={s.title}>
          {s.body.split('\n').map((line, i) => (<p key={i} className={i ? 'mt-2' : undefined}>{line}</p>))}
          {s.title === 'Shipping Methods & Times' && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-gray-50"><th className="text-left px-4 py-2 border">Method</th><th className="text-left px-4 py-2 border">Estimated Delivery</th><th className="text-left px-4 py-2 border">Cost</th></tr></thead>
                <tbody><tr><td className="px-4 py-2 border">Available shipping option</td><td className="px-4 py-2 border">Shown per product and at checkout</td><td className="px-4 py-2 border">Shown at checkout</td></tr></tbody>
              </table>
              <p className="mt-2 text-sm text-gray-500">The shipping charge shown immediately before you pay is the amount that applies.</p>
            </div>
          )}
          {s.title === 'Order Tracking' && (
            <p className="mt-2">Check it any time on the <Link to="/orders" className="text-luxe-gold hover:underline">Track Order</Link> page.</p>
          )}
          {s.title === 'Related Information' && (
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><Link to="/returns" className="text-luxe-gold hover:underline">Returns &amp; Refunds</Link> — damaged, defective, or incorrect items.</li>
              <li><Link to="/faq" className="text-luxe-gold hover:underline">Frequently Asked Questions</Link> — delivery, tracking, and order questions.</li>
              <li><Link to="/contact" className="text-luxe-gold hover:underline">Contact Us</Link> — hello@luxedge.us or (440) 941-8002.</li>
            </ul>
          )}
        </LS>
      ))}
    </LegalPage>
  );
}

/**
 * Visitor-facing sitemap.
 *
 * The footer used to link straight to /sitemap.xml, so the "Sitemap" link dumped
 * raw XML into the browser. This page is the readable version: the same four
 * groups the worker pre-renders and the same URL set the XML feed publishes, so
 * a person browsing here sees exactly what we ask search engines to index.
 */
function SitemapPage() {
  const { products, categories, blogs } = useApp();
  const pageLinks: { to: string; label: string }[] = [
    { to: '/', label: 'Home' },
    { to: '/shop', label: 'Shop all products' },
    { to: '/blog', label: 'Guides & articles' },
    { to: '/about', label: 'About Luxedge' },
    { to: '/contact', label: 'Contact us' },
    { to: '/faq', label: 'Frequently asked questions' },
    { to: '/shipping-policy', label: 'Shipping policy' },
    { to: '/returns', label: 'Returns & refunds' },
    { to: '/copyright', label: 'Copyright & DMCA' },
    { to: '/editorial-policy', label: 'Editorial policy' },
    { to: '/disclaimer', label: 'Disclaimer' },
    { to: '/privacy', label: 'Privacy policy' },
    { to: '/terms', label: 'Terms of service' },
    // Kept in step with STATIC_ROUTES in worker/sitemap.ts (which also drives
    // the XML feed). Listing this page here too is what stops the pre-rendered
    // crawl body and the hydrated page from advertising different link sets.
    { to: '/sitemap', label: 'Sitemap' },
  ];
  // Held and unpublished records are excluded here exactly as they are from the
  // XML feed — a sitemap must never advertise a URL that returns 404.
  const groups: { title: string; links: { to: string; label: string }[] }[] = [
    { title: 'Main pages', links: pageLinks },
    {
      title: 'Shop by category',
      links: categories.filter((c) => c.isActive).map((c) => ({ to: `/category/${c.slug || toSlug(c.name)}`, label: c.name })),
    },
    {
      title: 'Guides & articles',
      links: blogs.filter((b) => b.status === 'published' && !isHeldBlog(b.slug)).map((b) => ({ to: `/blog/${b.slug}`, label: b.title })),
    },
    {
      title: 'Products',
      links: products.map((p) => ({ to: `/product/${p.slug || p.id}`, label: p.name })),
    },
  ].filter((g) => g.links.length > 0);
  const total = groups.reduce((n, g) => n + g.links.length, 0);
  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-luxe-silver/60 py-12">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black">Sitemap</h1>
          <p className="text-gray-500 mt-3 max-w-2xl mx-auto text-sm">
            Every page we currently publish, in one place — {total} links across the storefront, our care guides, categories and products. This is the same list our{' '}
            <a href="/sitemap.xml" className="text-luxe-gold hover:underline">XML sitemap</a> gives search engines.
          </p>
        </div>
      </section>
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        {groups.map((g) => (
          <section key={g.title} className="bg-white rounded-2xl border p-6 sm:p-8">
            <h2 className="font-serif text-xl font-bold text-luxe-black mb-4">
              {g.title} <span className="text-sm font-normal text-gray-400">({g.links.length})</span>
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
              {g.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-sm text-gray-600 hover:text-luxe-gold transition-colors break-words">{l.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-sm text-gray-500 text-center">
          Looking for something specific? Try <Link to="/shop" className="text-luxe-gold hover:underline">searching the shop</Link> or <Link to="/contact" className="text-luxe-gold hover:underline">contacting us</Link>.
        </p>
      </div>
    </div>
  );
}

/** Rendered from the same COPYRIGHT_SECTIONS the worker pre-renders, so the
 * crawl HTML and the hydrated page cannot drift apart. */
function CopyrightPage() {
  return (
    <LegalPage title="Copyright & DMCA" updated={POLICY_LAST_UPDATED['/copyright']}>
      {COPYRIGHT_SECTIONS.map((s) => (
        <LS key={s.title} t={s.title}>
          {s.body.split('\n').map((line, i) => (<p key={i} className={i ? 'mt-2' : undefined}>{line}</p>))}
        </LS>
      ))}
    </LegalPage>
  );
}

/** Rendered from the same EDITORIAL_SECTIONS the worker pre-renders. */
function EditorialPolicyPage() {
  return (
    <LegalPage title="Editorial Policy" updated={POLICY_LAST_UPDATED['/editorial-policy']}>
      {EDITORIAL_SECTIONS.map((s) => (
        <LS key={s.title} t={s.title}>
          {s.body.split('\\n').map((line, i) => (<p key={i} className={i ? 'mt-2' : undefined}>{line}</p>))}
        </LS>
      ))}
    </LegalPage>
  );
}

/** Rendered from the same DISCLAIMER_SECTIONS the worker pre-renders. */
function DisclaimerPage() {
  return (
    <LegalPage title="Disclaimer" updated={POLICY_LAST_UPDATED['/disclaimer']}>
      {DISCLAIMER_SECTIONS.map((s) => (
        <LS key={s.title} t={s.title}>
          {s.body.split('\\n').map((line, i) => (<p key={i} className={i ? 'mt-2' : undefined}>{line}</p>))}
        </LS>
      ))}
    </LegalPage>
  );
}

function FAQPage() {
  // The questions come from src/content/policies.ts (FAQ_DATA) through
  // FaqContent. The hand-maintained second copy that used to sit here was
  // deleted rather than synced: it told visitors payment was unavailable while
  // the crawl HTML told Google it was "handled by the configured third-party
  // provider", and nothing kept the two in step.
  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-luxe-silver/60 py-12"><div className="max-w-4xl mx-auto px-4 text-center"><h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Frequently Asked Questions</h1><p className="text-luxe-gray text-sm">Quick answers to common questions about shopping at Luxedge.</p></div></section>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <FaqContent faqs={FAQ_DATA} />
        <div className="text-center pt-6">
          <p className="text-gray-500 text-sm mb-3">Still have questions?</p>
          <Link to="/contact" className="px-6 py-2.5 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg text-sm inline-flex items-center gap-2 transition-colors"><Mail01 strokeWidth={1.5} size={16} />Contact Support</Link>
        </div>
      </div>
    </div>
  );
}

function ContactPage() {
  const { notify } = useApp();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'sending') return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get('name') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      topic: String(fd.get('topic') || '').trim(),
      message: String(fd.get('message') || '').trim(),
      website: String(fd.get('website') || '').trim(),
    };
    setStatus('sending');
    try {
      const r = await fetch('/api/email/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (r.ok && data.ok) {
        setStatus('sent');
        notify('Message sent — we typically reply within 24 hours.', 'success');
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'We could not send your message right now.');
        notify('Message not sent — please email hello@luxedge.us or call (440) 941-8002.', 'error');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Network error — please try again or email hello@luxedge.us.');
      notify('Message not sent — please email hello@luxedge.us or call (440) 941-8002.', 'error');
    }
  };
  return (
    <div>
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-10"><div className="max-w-4xl mx-auto px-4 text-center">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Contact Us</h1>
        <p className="text-gray-500 text-sm max-w-lg mx-auto">Have a question or concern? Use the support email or phone number below.</p>
      </div></section>
      <section className="py-10"><div className="max-w-4xl mx-auto px-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {[
            { i: Mail01, l: 'Email', v: 'hello@luxedge.us', s: 'Send support requests by email' },
            { i: Phone, l: 'Phone', v: '(440) 941-8002', s: 'Mon-Fri, 9AM-6PM CT' },
            { i: MarkerPin01, l: 'Address', v: '1500 N Grant St, Denver, CO 80203', s: 'United States' },
            { i: Clock, l: 'Hours', v: 'Mon - Fri', s: '9:00 AM - 6:00 PM CT' },
          ].map((x, i) => (
            <div key={i} className="text-center p-5 bg-gray-50 rounded-xl border border-gray-100">
              <x.i strokeWidth={1.5} className="mx-auto mb-2 text-luxe-gold" size={22} />
              <p className="text-[10px] text-luxe-gold font-semibold uppercase tracking-wider">{x.l}</p>
              <p className="font-semibold text-sm mt-1">{x.v}</p>
              <p className="text-xs text-gray-500">{x.s}</p>
            </div>
          ))}
        </div>

        <div className="max-w-2xl mx-auto">
          {status === 'sent' ? (
            <div className="text-center py-16 bg-green-50 rounded-2xl border border-green-200">
              <CheckCircle strokeWidth={1.5} className="mx-auto text-green-600 mb-4" size={48} />
              <h2 className="text-xl font-bold mb-2">Message sent</h2>
              <p className="text-sm text-gray-600">Thanks for reaching out. We typically reply within 24 hours — watch your inbox for a response from <span className="font-semibold">hello@luxedge.us</span>.</p>
            </div>
          ) : status === 'error' ? (
            <div className="text-center py-16 bg-amber-50 rounded-2xl border border-amber-200">
              <AlertTriangle strokeWidth={1.5} className="mx-auto text-amber-600 mb-4" size={48} />
              <h2 className="text-xl font-bold mb-2">Message not sent</h2>
              <p className="text-sm text-gray-600">{errorMsg} Please email <a className="text-luxe-gold-dark font-semibold underline" href="mailto:hello@luxedge.us">hello@luxedge.us</a> or call (440) 941-8002.</p>
              <button onClick={() => setStatus('idle')} className="mt-4 px-4 py-2 text-xs font-semibold text-luxe-gold border border-luxe-gold/40 rounded-lg hover:bg-luxe-gold-soft transition-colors">Try again</button>
            </div>
          ) : (
            <form onSubmit={submit} className="bg-white rounded-2xl border p-6 sm:p-8 space-y-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Send01 strokeWidth={1.5} size={18} className="text-luxe-gold" /> Send Us a Message</h2>
              {/* Honeypot — hidden from humans; bots that fill it get a fake success and no email is sent. */}
              <div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Name *</label><input name="name" required placeholder="Your full name" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email *</label><input name="email" required type="email" placeholder="you@example.com" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Subject *</label>
                <select name="topic" required className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold"><option value="">Select a topic</option><option>Order Question</option><option>Shipping & Tracking</option><option>Returns & Refunds</option><option>Product Inquiry</option><option>Technical Support</option><option>Other</option></select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Message *</label><textarea name="message" required placeholder="Tell us how we can help..." rows={5} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold resize-none" /></div>
              <button type="submit" disabled={status === 'sending'} className="w-full py-3.5 bg-luxe-gold hover:bg-luxe-gold-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm transition-colors shadow-gold"><Send01 strokeWidth={1.5} size={16} />{status === 'sending' ? 'Sending…' : 'Send message'}</button>
              <p className="text-xs text-gray-500 text-center">Messages are sent to hello@luxedge.us — we typically reply within 24 hours.</p>
            </form>
          )}
        </div>
      </div></section>

      {/* Same shared copy the worker pre-renders for /contact. No FAQ block
          here: the sections answer the contact questions, and /faq owns the
          long-form answers (linked from the sections). */}
      <SiteSections sections={CONTACT_SECTIONS} />
    </div>
  );
}

// ============================================================================
// ============================================================================
function CareersPage() {
  return (
    <div className="bg-gray-50 min-h-screen">
      <section className="bg-gradient-to-b from-luxe-light to-white border-b border-gray-100 py-10"><div className="max-w-4xl mx-auto px-4 text-center">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-luxe-black mb-2">Careers at Luxedge</h1>
        <p className="text-gray-500 text-sm max-w-lg mx-auto">Join our growing team and help shape the future of curated ecommerce.</p>
      </div></section>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <div className="bg-white rounded-2xl border p-6 sm:p-10">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Why Work at Luxedge?</h2>
          <p className="text-gray-600 leading-relaxed mb-4">At Luxedge, we're building more than an online store — we're creating a trusted destination for people who value quality. Based in Denver, Colorado, our small but passionate team is obsessed with finding the best products in the world and delivering an exceptional shopping experience.</p>
          <p className="text-gray-600 leading-relaxed mb-4">Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.</p>
          <p className="text-gray-600 leading-relaxed mb-6">We value curiosity, ownership, and a genuine desire to make customers happy. If you thrive in a fast-paced environment and want to grow alongside a brand that's just getting started, we'd love to hear from you.</p>

          <h2 className="text-xl font-bold text-gray-900 mb-4">Our Culture</h2>
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            {[
              { icon: Star01, title: 'Growth-Focused', desc: 'We invest in our people. Learn, grow, and level up with us.' },
              { icon: Send01, title: 'Collaborative', desc: 'Small team, big impact. Every voice matters here.' },
              { icon: Globe01, title: 'Remote-Friendly', desc: 'Work from anywhere. We care about results, not locations.' },
              { icon: Zap, title: 'Innovation-Driven', desc: 'We encourage new ideas and creative problem-solving.' },
            ].map((v, i) => (
              <div key={i} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <span className="w-9 h-9 rounded-lg bg-luxe-gold-soft ring-1 ring-luxe-gold/15 text-luxe-gold flex items-center justify-center"><v.icon strokeWidth={1.5} size={16} /></span>
                <h3 className="font-bold text-gray-900 mt-2">{v.title}</h3>
                <p className="text-sm text-gray-600 mt-1">{v.desc}</p>
              </div>
            ))}
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-4">Open Positions</h2>
          <p className="text-gray-600 leading-relaxed mb-4">We're always looking for talented individuals to join us. Even if you don't see a specific role listed, we encourage you to reach out — great people always have a place at Luxedge.</p>

          <div className="space-y-3 mb-8">
            {[
              { title: 'Product Curator', type: 'Remote · Full-Time', desc: 'Research, test, and select products that meet our quality standards.' },
              { title: 'Content Writer', type: 'Remote · Part-Time', desc: 'Create engaging blog posts, product descriptions, and marketing copy.' },
              { title: 'Customer Support Specialist', type: 'Remote · Full-Time', desc: 'Help customers via email and chat with a focus on resolution and delight.' },
            ].map((job, i) => (
              <div key={i} className="p-5 border border-gray-200 rounded-xl hover:border-luxe-gold/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900">{job.title}</h3>
                    <p className="text-xs text-luxe-gold font-medium mt-0.5">{job.type}</p>
                    <p className="text-sm text-gray-600 mt-2">{job.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h2 className="text-xl font-bold text-gray-900 mb-3">How to Apply</h2>
          <p className="text-gray-600 leading-relaxed mb-4">Send your resume and a brief note about why you'd be a great fit to <strong>careers@luxedge.us</strong>. Include the role you're interested in as the subject line. We review all applications and aim to respond within one week.</p>
          <Link to="/contact" className="px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-semibold rounded-lg text-sm inline-flex items-center gap-2 transition-colors">
            <Mail01 strokeWidth={1.5} size={16} /> Get in Touch
          </Link>
        </div>
      </div>
    </div>
  );
}

// BLOG SYSTEM
// ============================================================================
// Admin section lives in its own file so it can be code-split into a lazy
// chunk — it is only downloaded when an /admin/* route is actually visited.
const AdminSection = lazy(() => import('./admin/AdminSection'));

// Blog storefront pages are their own lazy chunk — the homepage never
// downloads them (or the ads they mount) until /blog is visited.
const MediaHubPage = lazy(() => import('./media/MediaHubPages').then((m) => ({ default: m.MediaHubPage })));
const MediaVideoPage = lazy(() => import('./media/MediaHubPages').then((m) => ({ default: m.MediaVideoPage })));
const BlogListPage = lazy(() => import('./pages/BlogPages').then((m) => ({ default: m.BlogListPage })));
const BlogDetailPage = lazy(() => import('./pages/BlogPages').then((m) => ({ default: m.BlogDetailPage })));
const BlogWritePage = lazy(() => import('./pages/BlogPages').then((m) => ({ default: m.BlogWritePage })));

function AdminFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-luxe-cream">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loading01 strokeWidth={1.5} size={28} className="animate-spin text-luxe-gold" />
        <span className="text-sm font-medium">Loading admin…</span>
      </div>
    </div>
  );
}

/** Lazy route fallback — shown briefly while a code-split page chunk loads. */
function PageFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loading01 strokeWidth={1.5} size={28} className="animate-spin text-luxe-gold" />
        <span className="text-sm font-medium">Loading…</span>
      </div>
    </div>
  );
}

/** Client-side counterpart to the Worker's real 404 response for unknown URLs. */
function NotFoundPage() {
  useEffect(() => {
    document.title = 'Page Not Found | Luxedge';
    const setMeta = (name: string, content: string) => {
      let el = document.head.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    setMeta('description', 'This page does not exist.');
    setMeta('robots', 'noindex, nofollow');
    const canonical = document.head.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://luxedge.us/404');
  }, []);

  return (
    <main className="min-h-[50vh] flex items-center justify-center px-4 py-16 text-center">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-luxe-gold-dark">404</p>
        <h1 className="mt-3 font-serif text-3xl font-bold text-luxe-black">Page not found</h1>
        <p className="mt-3 text-sm text-luxe-black/65">The page you requested does not exist or is no longer available.</p>
        <Link to="/" className="mt-6 inline-flex rounded-full bg-luxe-black px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-luxe-gold-dark">
          Return home
        </Link>
      </div>
    </main>
  );
}

/**
 * /author/<slug> — editorial attribution, rendered from the same registry the
 * worker pre-renders (src/content/authors.ts). The registry is empty until a
 * real author is supplied, so today this is the not-found state; publishing an
 * author turns it into a profile without touching this component.
 */
function AuthorPage() {
  const { slug = '' } = useParams();
  const author = authorFor(slug);

  useEffect(() => {
    const name = author ? `${author.name} — author | Luxedge` : 'Author Not Found | Luxedge';
    document.title = name;
    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
      el.setAttribute('content', content);
    };
    setMeta('name', 'description', author ? author.bio : 'This author page does not exist.');
    setMeta('name', 'robots', author ? 'index, follow' : 'noindex, nofollow');
    document.head.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://luxedge.us/author/${slug}`);
  }, [author, slug]);

  if (!author) return <NotFoundPage />;

  return (
    <main className="mx-auto max-w-3xl px-4 py-14">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-luxe-gold-dark">Author</p>
      <h1 className="mt-3 font-serif text-3xl font-bold text-luxe-black">{author.name}</h1>
      {author.photo && (
        <img src={author.photo} alt={author.name} width={160} height={160} className="mt-5 rounded-xl object-cover" />
      )}
      <p className="mt-5 text-sm leading-relaxed text-luxe-black/70">{author.bio}</p>
      {author.links && author.links.length > 0 && (
        <p className="mt-4 flex gap-3 text-sm">
          {author.links.map((l) => (
            <a key={l.href} href={l.href} rel="noopener" className="text-luxe-gold-dark hover:underline">{l.label}</a>
          ))}
        </p>
      )}
      <Link to="/blog" className="mt-8 inline-flex rounded-full bg-luxe-black px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-luxe-gold-dark">
        Read the guides
      </Link>
    </main>
  );
}

// APP WITH ROUTES
// ============================================================================
export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <MarketingManager />
        <RouteTitle />
        <Routes>
          {/* Store */}
          <Route path="/" element={<SLayout><HomePage /></SLayout>} />
          <Route path="/shop" element={<SLayout><ShopPage /></SLayout>} />
          <Route path="/free-pet-gift" element={<SLayout><GiftDropPage /></SLayout>} />
          <Route path="/campaigns/:slug" element={<SLayout><CampaignLanding /></SLayout>} />
                    {/* Category Aliases & Redirects */}
          <Route path="/category/dog" element={<Navigate to="/category/dog-supplies" replace />} />
          <Route path="/category/cat" element={<Navigate to="/category/cat-supplies" replace />} />
          <Route path="/category/bird" element={<Navigate to="/category/bird-supplies" replace />} />
          <Route path="/category/livestock" element={<Navigate to="/category/cattle" replace />} />
          <Route path="/category/horses" element={<Navigate to="/category/horse" replace />} />

          {/* Archived Duplicate Product 301 Redirects */}
          <Route path="/product/1-5-10pcs-cat-dog-massage-brush-pet-special-brush-multifunctional-dust-removal-sponge-cleaning-brush-simulated-cat-tongue-comb-2" element={<Navigate to="/product/1-5-10pcs-cat-dog-massage-brush-pet-special-brush-multifunctional-dust-removal-sponge-cleaning-brush-simulated-cat-tongue-comb" replace />} />
          <Route path="/product/cute-cat-collar-soft-leather-pet-collars-for-small-dog-kitten-puppy-necklace-cat-accessories-star-moon-rivets-decoration-xs-m-2" element={<Navigate to="/product/cute-cat-collar-soft-leather-pet-collars-for-small-dog-kitten-puppy-necklace-cat-accessories-star-moon-rivets-decoration-xs-m" replace />} />
          <Route path="/product/cat-comb-cat-accessories-stainless-steel-pet-hair-remover-wooden-handle-solid-cat-hair-comb-pet-grooming-dog-brush-cleaning-tool-2" element={<Navigate to="/product/cat-comb-cat-accessories-stainless-steel-pet-hair-remover-wooden-handle-solid-cat-hair-comb-pet-grooming-dog-brush-cleaning-tool" replace />} />

          <Route path="/category/:slug" element={<SLayout><ShopPage /></SLayout>} />
          <Route path="/product/:id" element={<SLayout><ProductDetailPage /></SLayout>} />
          <Route path="/wishlist" element={<SLayout><WishlistPage /></SLayout>} />
          <Route path="/cart" element={<SLayout><CartPage /></SLayout>} />
          <Route path="/checkout" element={<CheckoutLayout><Suspense fallback={<CheckoutLoadingSkeleton />}><CheckoutOnsitePage /></Suspense></CheckoutLayout>} />
          <Route path="/checkout/success" element={<CheckoutLayout><CheckoutSuccessPage /></CheckoutLayout>} />
          <Route path="/orders" element={<SLayout><OrdersPage /></SLayout>} />
          <Route path="/about" element={<SLayout><AboutPage /></SLayout>} />
          <Route path="/contact" element={<SLayout><ContactPage /></SLayout>} />
          <Route path="/privacy" element={<SLayout><PrivacyPage /></SLayout>} />
          <Route path="/terms" element={<SLayout><TermsPage /></SLayout>} />
          <Route path="/returns" element={<SLayout><ReturnsPage /></SLayout>} />
          <Route path="/shipping-policy" element={<SLayout><ShippingPolicyPage /></SLayout>} />
          {/* Legacy alias: /shipping was in the footer before the canonical
              /shipping-policy route existed, so it must never 404 again. The
              worker issues a 301 for crawlers; this covers client-side nav. */}
          <Route path="/shipping" element={<Navigate to="/shipping-policy" replace />} />
          <Route path="/copyright" element={<SLayout><CopyrightPage /></SLayout>} />
          <Route path="/editorial-policy" element={<SLayout><EditorialPolicyPage /></SLayout>} />
          <Route path="/disclaimer" element={<SLayout><DisclaimerPage /></SLayout>} />
          <Route path="/faq" element={<SLayout><FAQPage /></SLayout>} />
          <Route path="/sitemap" element={<SLayout><SitemapPage /></SLayout>} />
          <Route path="/careers" element={<SLayout><CareersPage /></SLayout>} />
          {/* Media — withheld from public display for AdSense review */}
          <Route path="/media" element={<Navigate to="/" replace />} />
          <Route path="/media/:slug" element={<Navigate to="/" replace />} />
          <Route path="/blog" element={<SLayout><Suspense fallback={<PageFallback />}><BlogListPage /></Suspense></SLayout>} />
          <Route path="/blog/write" element={<SLayout><Suspense fallback={<PageFallback />}><BlogWritePage /></Suspense></SLayout>} />
          <Route path="/blog/:slug" element={<SLayout><Suspense fallback={<PageFallback />}><BlogDetailPage /></Suspense></SLayout>} />
          <Route path="/author/:slug" element={<SLayout><AuthorPage /></SLayout>} />
          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          {/* Admin — lazy-loaded chunk (only fetched when an /admin/* route is visited) */}
          <Route path="/admin/*" element={<ProtectedRoute requireAdmin={true}><Suspense fallback={<AdminFallback />}><AdminSection /></Suspense></ProtectedRoute>} />
          {/* Fallback */}
          <Route path="*" element={<SLayout><NotFoundPage /></SLayout>} />
        </Routes>
        <Toast />
      </BrowserRouter>
    </AppProvider>
  );
}
