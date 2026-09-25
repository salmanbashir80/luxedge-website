// ============================================================================
// ADMIN SECTION — extracted from the App.tsx monolith into its own
// lazy-loaded chunk. It is only fetched when the user visits /admin/*,
// which keeps the storefront bundle small and fast.
// ============================================================================
import { useState, useEffect, useCallback, ReactNode, Component, Fragment } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
import { useApp, Modal, CAT_LIST, loadAIProviders, saveAIProviders, callAIProvider, fetchPageContent, serverTestProvider, serverOpenRouterCredits, serverProviderStatus } from '../App';
import { SOCIAL_PROFILES } from '../content/socialProfiles';
import { useAuthStore } from '../store/authStore';
import { getAccessToken } from '../services/supabase';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { listCategories, createCategory, updateCategory, deleteCategory, listProducts, setDbToken } from '../features/catalog/repository';
import type { CatalogProduct } from '../features/catalog/types';
import { AIImportPanel } from './AIImportPanel';
import { loadProviderSettings, saveProviderSettings } from '../features/ai/providers';
import { loadPricingRules, savePricingRules, computePricing, DEFAULT_PRICING_RULES } from '../features/ai/pricing';
import ProductScout from './ProductScout';
import ProductResearch from './ProductResearch';
import CJSetup from './CJSetup';
import PaymentsSetup from './PaymentsSetup';
import GiftDropAdmin from './GiftDropAdmin';
import ShippingSetup from './ShippingSetup';
import CampaignManager from './CampaignManager';
import AiControlCenter from './AiControlCenter';
import { CatalogProductsPage, CatalogProductEditor, CatalogPromotionsPage } from './CatalogAdmin';
import HermesIntel from './HermesIntel';
import BlogManager from './BlogManager';
import MediaManager from './MediaManager';
import LuxedgeSales from './LuxedgeSales';
import type {
  Product, ProductVariant, AdminCategory,
  AIProvider, EnterpriseVariant, VariantAttribute,
  SEOData, SocialSEO, ContentData, SEOScore, StructuredSchemas,
  ProviderStatus, ProviderStatusMap,
} from '../App';
import {
  activeModeLabel, AD_SLOT_RE, clearPreviewConfig, CLIENT_ID_RE, fetchGlobalConfig,
  getCachedPreview, hasPreviewConfig, PLACEMENT_KEYS, PLACEMENT_LABELS,
  savePreviewConfig, validateConfig, MarketingConfig, PlacementKey, DEFAULT_CONFIG,
} from '../lib/marketing';
import TrafficDashboard from './TrafficDashboard';
import AdSenseEarnings from './AdSenseEarnings';
import { ListingPlaybookAdmin } from './ListingPlaybookAdmin';
import { ListingTaskAdmin } from './ListingTaskAdmin';
import {
  Warning, ArrowLeft, Robot, CheckCircle, CaretDown, CaretRight, CaretUp,
  Clipboard, Code, Cpu, CurrencyDollar, Download, Info, Key, PencilSimple, Eye, FileText, TreeStructure, Globe,
  Image as ImageIcon, Camera, Stack, SquaresFour, LinkSimple, SpinnerGap, Lock, SignOut, Megaphone, List,
  Monitor, Package, Plus, ArrowClockwise, ArrowCounterClockwise, FloppyDisk, MagnifyingGlass, PaperPlaneRight, GearSix,
  ShareNetwork, ShieldCheck, ShoppingCart, Shuffle, Sliders, DeviceMobile, Sparkle, Star, Table, Tag,
  Target, ToggleLeft, ToggleRight, Trash, TrendUp, UploadSimple, User as UserIcon,
  Users as UsersIcon, MagicWand, X, Lightning, Truck, Printer, Barcode, MapPin,
  Receipt, CloudArrowUp, YoutubeLogo, CreditCard, Gift, Clock, BookBookmark,
} from '@phosphor-icons/react';

// ADMIN PANEL - FULL WORKING SYSTEM
// ============================================================================
function AdminLayout({ children }: { children: ReactNode }) {
  const { user, isAdmin, ready, signOut } = useAuthStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobSide, setMobSide] = useState(false);

  // Admin access is derived from the verified Supabase JWT (app_metadata.role
  // = 'admin'), never from a browser-supplied flag. Redirect until hydrated.
  useEffect(() => { if (ready && (!user || !isAdmin)) nav('/admin/login'); }, [user, isAdmin, ready, nav]);
  useEffect(() => { setMobSide(false); }, [loc.pathname]);
  if (!ready || !user || !isAdmin) return null;

  // Premium sidebar: grouped sections, each item gets its own gradient icon
  // tile, and the active item glows with the Luxedge blue→violet gradient.
  // Phosphor icons type their weight prop strictly (IconWeight); type the nav
  // icon loosely so any Phosphor icon works cleanly in the gradient tile.
  type NavIcon = React.ComponentType<Record<string, unknown>>;
  type NavItem = { to: string; icon: NavIcon; label: string; g: string; dot: string };
  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Overview',
      items: [
        { to: '/admin', icon: SquaresFour, label: 'Dashboard', g: 'linear-gradient(135deg,#3b82f6,#22d3ee)', dot: '#38bdf8' },
      ],
    },
    {
      title: 'Catalog',
      items: [
        { to: '/admin/products', icon: Package, label: 'Products', g: 'linear-gradient(135deg,#8b5cf6,#a855f7)', dot: '#a78bfa' },
        { to: '/admin/promotions', icon: Tag, label: 'Promotions', g: 'linear-gradient(135deg,#ec4899,#f43f5e)', dot: '#f472b6' },
        { to: '/admin/gift-drop', icon: Gift, label: 'Gift Drop', g: 'linear-gradient(135deg,#f59e0b,#fbbf24)', dot: '#fbbf24' },
        { to: '/admin/campaigns', icon: Gift, label: 'Campaigns', g: 'linear-gradient(135deg,#f472b6,#e879f9)', dot: '#f9a8d4' },
        { to: '/admin/orders', icon: ShoppingCart, label: 'Orders', g: 'linear-gradient(135deg,#10b981,#14b8a6)', dot: '#34d399' },
        { to: '/admin/users', icon: UsersIcon, label: 'Users', g: 'linear-gradient(135deg,#6366f1,#3b82f6)', dot: '#818cf8' },
        { to: '/admin/categories', icon: TreeStructure, label: 'Categories', g: 'linear-gradient(135deg,#f59e0b,#f97316)', dot: '#fbbf24' },
        { to: '/admin/reviews', icon: Star, label: 'Reviews', g: 'linear-gradient(135deg,#eab308,#f59e0b)', dot: '#facc15' },
        { to: '/admin/blogs', icon: FileText, label: 'Blog Posts', g: 'linear-gradient(135deg,#0ea5e9,#06b6d4)', dot: '#38bdf8' },
      ],
    },
    {
      title: 'Media',
      items: [
        { to: '/admin/media', icon: YoutubeLogo, label: 'Media Hub', g: 'linear-gradient(135deg,#ef4444,#f97316)', dot: '#f87171' },
      ],
    },
    {
      title: 'Marketing',
      items: [
        { to: '/admin/seo-engine', icon: MagnifyingGlass, label: 'SEO Engine', g: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', dot: '#818cf8' },
        { to: '/admin/marketing', icon: Megaphone, label: 'Marketing Gen', g: 'linear-gradient(135deg,#d946ef,#ec4899)', dot: '#e879f9' },
        { to: '/admin/marketing-traffic', icon: TrendUp, label: 'Marketing & Traffic', g: 'linear-gradient(135deg,#06b6d4,#2563eb)', dot: '#22d3ee' },
        { to: '/admin/email-marketing', icon: PaperPlaneRight, label: 'Email Marketing', g: 'linear-gradient(135deg,#38bdf8,#6366f1)', dot: '#60a5fa' },
        { to: '/admin/crm', icon: UsersIcon, label: 'CRM (Leads)', g: 'linear-gradient(135deg,#22c55e,#84cc16)', dot: '#4ade80' },
      ],
    },
    {
      title: 'AI Studio',
      items: [
        { to: '/admin/variant-gen', icon: Stack, label: 'Variant Gen', g: 'linear-gradient(135deg,#8b5cf6,#d946ef)', dot: '#c084fc' },
        { to: '/admin/ai', icon: Robot, label: 'AI Hub', g: 'linear-gradient(135deg,#4f46e5,#7c3aed)', dot: '#818cf8' },
        { to: '/admin/ai-import', icon: Robot, label: 'AI Import', g: 'linear-gradient(135deg,#9333ea,#c026d3)', dot: '#c084fc' },
        { to: '/admin/listing-task', icon: List, label: 'Listing Task', g: 'linear-gradient(135deg,#2563eb,#0ea5e9)', dot: '#60a5fa' },
        { to: '/admin/scout', icon: Target, label: 'Product Scout', g: 'linear-gradient(135deg,#f43f5e,#fb923c)', dot: '#fb7185' },
        { to: '/admin/product-research', icon: TrendUp, label: 'Product Research', g: 'linear-gradient(135deg,#0d9488,#0891b2)', dot: '#2dd4bf' },
        { to: '/admin/ai-control', icon: Cpu, label: 'AI Control', g: 'linear-gradient(135deg,#0ea5e9,#8b5cf6)', dot: '#60a5fa' },
        { to: '/admin/hermes-intel', icon: Sparkle, label: 'AI Intelligence', g: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', dot: '#a78bfa' },
      ],
    },
    {
      title: 'System',
      items: [
        { to: '/admin/cj-setup', icon: Package, label: 'CJ Supplier', g: 'linear-gradient(135deg,#10b981,#06b6d4)', dot: '#34d399' },
        { to: '/admin/payments', icon: CreditCard, label: 'Payments', g: 'linear-gradient(135deg,#635bff,#8b5cf6)', dot: '#a78bfa' },
        { to: '/admin/sales', icon: CurrencyDollar, label: 'Luxedge Sales', g: 'linear-gradient(135deg,#C5A880,#9a6f16)', dot: '#C5A880' },
        { to: '/admin/settings', icon: GearSix, label: 'Settings', g: 'linear-gradient(135deg,#94a3b8,#64748b)', dot: '#cbd5e1' },
        { to: '/admin/settings/listing-playbook', icon: BookBookmark, label: 'Listing Playbook', g: 'linear-gradient(135deg,#0ea5e9,#6366f1)', dot: '#60a5fa' },
      ],
    },
  ];

  // Mobile quick navigation (bottom bar, lg+ hidden): the four everyday seller
  // destinations plus "More" which opens the full sidebar drawer. eBay-style
  // seller apps keep list/create/orders one tap away — this mirrors that.
  const MOBILE_NAV: { key: 'home' | 'products' | 'add' | 'orders' | 'more'; label: string; to?: string; icon: React.ComponentType<Record<string, unknown>> }[] = [
    { key: 'home', label: 'Home', to: '/admin', icon: SquaresFour },
    { key: 'products', label: 'Listings', to: '/admin/products', icon: Package },
    { key: 'add', label: 'Add', to: '/admin/products/new', icon: Plus },
    { key: 'orders', label: 'Orders', to: '/admin/orders', icon: ShoppingCart },
    { key: 'more', label: 'More', icon: List },
  ];

  const Sidebar = ({ mobile }: { mobile?: boolean }) => (
    <aside className={`flex flex-col shrink-0 ${mobile ? 'w-full h-full' : 'w-60 h-screen sticky top-0 hidden lg:flex'}`}
      style={{ background: 'linear-gradient(180deg, #0f231b 0%, #173629 55%, #0f231b 100%)', boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.05)' }}>
      {/* Brand */}
      <div className="px-3.5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
        <img src="/luxedge-mark.png" alt="Luxedge" className="w-9 h-9 rounded-lg object-contain shadow-lg shadow-emerald-950/40" />
        <div className="leading-tight">
          <span className="font-bold text-sm text-white tracking-tight block">Luxedge</span>
          <span className="text-[9px] uppercase tracking-[0.2em] text-slate-500 font-medium">Admin Console</span>
        </div>
        {mobile && <button onClick={() => setMobSide(false)} className="ml-auto p-1.5 hover:bg-white/10 rounded-lg"><X size={14} className="text-slate-400" /></button>}
      </div>

      <nav className="flex-1 p-2 space-y-4 overflow-y-auto">
        {sections.map(sec => (
          <div key={sec.title}>
            <p className="px-2.5 mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">{sec.title}</p>
            <div className="space-y-0.5">
              {sec.items.map(l => {
                const isActive = loc.pathname === l.to;
                const Icon = l.icon;
                return (
                  <Link key={l.to} to={l.to}
                    className={`group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12px] font-medium transition-all duration-200 ${
                      isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                    }`}
                    style={isActive ? { background: 'linear-gradient(90deg, rgba(30,70,54,0.55), rgba(46,95,73,0.30))', boxShadow: 'inset 0 0 0 1px rgba(197,168,128,0.35)' } : undefined}>
                    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ background: 'linear-gradient(180deg,#34d399,#C5A880)' }} />}
                    <span className={`w-6.5 h-6.5 min-w-[26px] min-h-[26px] w-[26px] h-[26px] rounded-md flex items-center justify-center text-white transition-all duration-200 ${isActive ? 'scale-105' : 'opacity-90 group-hover:scale-105 group-hover:opacity-100'}`}
                      style={{ background: l.g, boxShadow: isActive ? `0 2px 10px ${l.dot}40` : '0 1px 4px rgba(0,0,0,0.3)' }}>
                      <Icon size={13} weight="bold" />
                    </span>
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-2 border-t border-white/[0.06] space-y-0.5">
        <Link to="/" className="flex items-center gap-2 text-[11px] text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
          <span className="w-[26px] h-[26px] rounded-md bg-white/5 flex items-center justify-center"><ArrowLeft size={12} /></span>Store
        </Link>
        <button onClick={() => { void signOut().then(() => nav('/admin/login')); }}
          className="flex items-center gap-2 text-[11px] text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 w-full transition-colors">
          <span className="w-[26px] h-[26px] rounded-md bg-red-500/10 flex items-center justify-center"><SignOut size={12} /></span>Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="h-screen bg-gray-100 flex overflow-hidden">

      <Sidebar />
      {mobSide && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-black/50" onClick={() => setMobSide(false)} /><div className="absolute left-0 top-0 h-full w-64"><Sidebar mobile /></div></div>}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center justify-between gap-3 px-4 lg:px-6 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobSide(true)} className="lg:hidden p-1.5 hover:bg-gray-100 rounded-lg"><List size={18} /></button>
            <div className="hidden md:flex items-center gap-2 bg-gray-100/80 border border-gray-200 rounded-lg px-3 py-1.5 w-64">
              <MagnifyingGlass size={13} className="text-gray-400" />
              <input placeholder="Search…" className="bg-transparent text-xs outline-none w-full placeholder:text-gray-400" />
              <span className="text-[9px] text-gray-400 border border-gray-300 rounded px-1 py-px font-medium">⌘K</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
            </span>
            <button className="relative p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 transition-colors">
              <ShieldCheck size={16} />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: 'linear-gradient(135deg,#1E4636,#C5A880)' }} />
            </button>
            <div className="flex items-center gap-2 pl-1.5 border-l border-gray-200">
              <span className="text-xs font-medium text-gray-700 hidden sm:block">{user?.name || 'Admin'}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-md shadow-emerald-950/20 ring-2 ring-white"
                style={{ background: 'linear-gradient(135deg, #1E4636, #2d634d)' }}>{String(user?.name || 'A').charAt(0).toUpperCase()}</div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto min-w-0 p-3 pb-24 lg:p-5" style={{ background: 'linear-gradient(180deg, #FAF8F5 0%, #F5F2EC 100%)' }}>{children}</main>

        {/* Mobile bottom navigation — the everyday seller tasks stay one tap
            away; the full menu lives behind "More" (drawer). ≥52px tap
            targets, safe-area aware. Desktop (lg+) keeps the full sidebar. */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-4px_20px_rgba(15,23,42,0.08)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Admin quick navigation"
        >
          <div className="grid grid-cols-5 max-w-lg mx-auto">
            {MOBILE_NAV.map((it) => {
              if (it.key === 'more') {
                return (
                  <button key="more" type="button" onClick={() => setMobSide(true)}
                    className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-gray-500 hover:text-gray-800 min-h-[52px]">
                    <span className="p-1.5"><List size={20} /></span>
                    More
                  </button>
                );
              }
              const on =
                it.key === 'home' ? loc.pathname === '/admin'
                : it.key === 'products' ? (loc.pathname.startsWith('/admin/products') && !loc.pathname.startsWith('/admin/products/new'))
                : it.key === 'add' ? loc.pathname.startsWith('/admin/products/new')
                : it.key === 'orders' ? loc.pathname.startsWith('/admin/orders')
                : false;
              const Icon = it.icon;
              return (
                <Link key={it.key} to={it.to || '/admin'}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[52px] ${on ? 'text-blue-600 font-semibold' : 'text-gray-500 font-medium hover:text-gray-700'}`}>
                  <span className={`px-3 py-1 rounded-xl ${on ? 'bg-blue-50' : ''}`}><Icon size={20} weight={on ? 'bold' : 'regular'} /></span>
                  {it.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

interface DashOrderRow { id: string; order_number: string; customer_email: string | null; total: number | null; currency: string | null; status: string; created_at: string; }

interface DashStats { revenue: number; paidCount: number; aov: number; days: { label: string; total: number }[]; }

export function ADashboard() {
  const { users } = useApp();
  const [realOrders, setRealOrders] = useState<DashOrderRow[]>([]);
  const [stats, setStats] = useState<DashStats | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [gift, setGift] = useState<{ active: boolean; remaining: number; total: number; claimsToday: number } | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [range, setRange] = useState<7 | 30 | 90>(7);

  // REAL data only (Stripe webhook orders + the DB catalog + Gift Drop ledger).
  // No demo numbers. Orders stats come from the server (paid-only, full order
  // set, refunds subtracted) and refresh near-real-time on focus + interval.
  const loadOrders = useCallback(() => {
    const token = getAccessToken();
    if (!token) return Promise.resolve();
    setDbToken(token);
    // Gift Drop live status — claims ledger + remaining inventory.
    fetch('/api/admin/gift-drop', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: { campaign?: { active?: boolean }; stats?: { total?: number; remaining?: number }; claims?: Array<{ createdAt?: string; isTest?: boolean }> }) => {
        if (!d || !d.stats) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const claimsToday = Array.isArray(d.claims)
          ? d.claims.filter((c) => !c.isTest && new Date(c.createdAt || 0) >= today).length
          : 0;
        setGift({ active: !!d.campaign?.active, remaining: Number(d.stats.remaining) || 0, total: Number(d.stats.total) || 0, claimsToday });
      })
      .catch(() => setGift(null));
    return fetch('/api/checkout?action=orders', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: { orders?: DashOrderRow[]; stats?: DashStats | null }) => {
        setRealOrders(Array.isArray(d.orders) ? d.orders : []);
        setStats(d.stats && typeof d.stats.revenue === 'number' ? d.stats : null);
      })
      .catch(() => { setRealOrders([]); setStats(null); })
      .finally(() => setLoadedAt(new Date()));
  }, []);
  const refresh = useAutoRefresh(loadOrders);
  useEffect(() => { refresh(); listProducts().then(setCatalog).catch(() => setCatalog([])); }, [refresh]);

  // Server-aggregated, paid-only metrics (refunds subtracted, no page cap).
  const rev = stats ? stats.revenue : 0;
  const paidCount = stats ? stats.paidCount : 0;
  const aov = stats ? stats.aov : 0;
  const serverDays = stats && Array.isArray(stats.days) && stats.days.length === 7 ? stats.days : null;

  // Catalog overview (full DB, not just storefront-active)
  const totalProducts = catalog.length;
  const activeProducts = catalog.filter(p => p.status === 'active').length;
  const drafts = catalog.filter(p => p.status === 'draft').length;
  const commerceReady = catalog.filter(p => p.commerceReadiness === 'COMMERCE_READY').length;
  const lowStockList = catalog
    .filter(p => Number(p.inventoryQty ?? 0) <= 10)
    .sort((a, b) => Number(a.inventoryQty ?? 0) - Number(b.inventoryQty ?? 0));
  const lowStock = lowStockList.length;

  // Daily revenue + order counts for the last 90 days (paid-only rows).
  const isPaidRow = (o: DashOrderRow) => ['paid', 'processing', 'shipped', 'delivered', 'partially_refunded'].includes(String(o.status || ''));
  const netRowTotal = (o: DashOrderRow) => Math.max(0, Number(o.total || 0) - Number((o as unknown as { refunded_amount?: number | null }).refunded_amount || 0));
  const buildSeries = (n: number): { label: string; total: number; orders: number }[] => {
    const out: { label: string; total: number; orders: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const day = realOrders.filter(o => { const t = new Date(o.created_at); return t >= d && t < next; });
      out.push({
        label: d.toLocaleDateString(undefined, n <= 7 ? { weekday: 'narrow' } : { month: 'short', day: 'numeric' }),
        total: day.filter(isPaidRow).reduce((s, o) => s + netRowTotal(o), 0),
        orders: day.filter(isPaidRow).length,
      });
    }
    return out;
  };
  const series90 = buildSeries(90);
  // 7-day buckets come from the server (paid-only, full set); 30/90 use the
  // paid-only client series for display.
  const activeSeries = range === 7 && serverDays
    ? serverDays.map(d => ({ label: d.label, total: d.total, orders: 0 }))
    : (range === 7 ? series90.slice(-7) : range === 30 ? series90.slice(-30) : series90);
  const rangeRev = activeSeries.reduce((s, d) => s + d.total, 0);
  const rangeOrders = activeSeries.reduce((s, d) => s + d.orders, 0);
  const maxDay = Math.max(...activeSeries.map(d => d.total), 1);
  const weekRev = serverDays ? serverDays.reduce((s, d) => s + d.total, 0) : series90.slice(-7).reduce((s, d) => s + d.total, 0);
  const prevWeekRev = series90.slice(-14, -7).reduce((s, d) => s + d.total, 0);
  const revTrend = prevWeekRev > 0 ? ((weekRev - prevWeekRev) / prevWeekRev) * 100 : null;

  // Order status breakdown
  const statusMeta: { s: string; color: string; bg: string }[] = [
    { s: 'paid', color: 'bg-emerald-500', bg: 'bg-emerald-100 text-emerald-700' },
    { s: 'processing', color: 'bg-blue-500', bg: 'bg-blue-100 text-blue-700' },
    { s: 'shipped', color: 'bg-sky-500', bg: 'bg-sky-100 text-sky-700' },
    { s: 'delivered', color: 'bg-teal-500', bg: 'bg-teal-100 text-teal-700' },
    { s: 'refunded', color: 'bg-amber-500', bg: 'bg-amber-100 text-amber-700' },
    { s: 'pending', color: 'bg-gray-400', bg: 'bg-gray-100 text-gray-600' },
  ];
  const statusCounts = statusMeta.map(m => ({ ...m, n: realOrders.filter(o => String(o.status || '') === m.s).length }));
  const statusTotal = statusCounts.reduce((a, b) => a + b.n, 0);

  const kpis = [
    { l: 'Revenue (7 days)', v: `$${weekRev.toFixed(2)}`, sub: weekRev > 0 ? (revTrend === null ? '— vs prior week' : `${revTrend >= 0 ? '▲' : '▼'} ${Math.abs(revTrend).toFixed(0)}% vs prior week`) : 'No paid orders yet', i: CurrencyDollar, to: '/admin/orders', iconCls: 'bg-[#f6efdd] text-[#9a6f16]' },
    { l: 'Orders', v: paidCount, sub: paidCount ? `${rev.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} all-time` : 'No paid orders yet', i: ShoppingCart, to: '/admin/orders', iconCls: 'bg-[#f6efdd] text-[#9a6f16]' },
    { l: 'Avg order value', v: paidCount ? `$${aov.toFixed(2)}` : '—', sub: paidCount ? 'per paid order' : 'No paid orders yet', i: TrendUp, to: '/admin/orders', iconCls: 'bg-[#f6efdd] text-[#9a6f16]' },
    { l: 'Customers', v: users.length, sub: users.length ? 'registered accounts' : 'No customers yet', i: UsersIcon, to: '/admin/users', iconCls: 'bg-[#f6efdd] text-[#9a6f16]' },
    { l: 'Active products', v: activeProducts, sub: `${totalProducts} total · ${commerceReady} commerce-ready`, i: Package, to: '/admin/products', iconCls: 'bg-[#f6efdd] text-[#9a6f16]' },
    { l: 'Low-stock products', v: lowStock, sub: lowStock ? 'need restock' : 'All stocked', i: Warning, to: '/admin/products', iconCls: 'bg-amber-50 text-amber-600' },
  ];

  const quickActions = [
    { to: '/admin/ai-import', icon: MagicWand, label: 'Import Product', desc: 'Paste a product URL — AI researches & builds the listing' },
    { to: '/admin/products/new?mode=detail', icon: Plus, label: 'Add Product Manually', desc: 'Full editor — images, variants, SEO, pricing and promotions' },
    { to: '/admin/marketing', icon: Megaphone, label: 'Generate Product Content', desc: 'AI copy, SEO and descriptions for your catalog' },
    { to: '/admin/variant-gen', icon: Stack, label: 'Create Variants', desc: 'Generate color/size combinations in one pass' },
    { to: '/admin/seo-engine', icon: MagnifyingGlass, label: 'SEO Optimize', desc: 'Meta, schema and keyword suggestions for pages' },
    { to: '/admin/hermes-intel', icon: Sparkle, label: 'Open AI Intelligence', desc: 'Hermes insights across catalog, media and traffic' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-semibold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Store performance and catalog overview.
            {loadedAt && <span className="text-gray-400"> · Updated {loadedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/" target="_blank" className="px-3.5 py-2 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 border border-gray-200 flex items-center gap-1.5 transition-colors"><Eye size={13} /> View store</Link>
          <Link to="/admin/ai-import" className="px-3.5 py-2 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 border border-gray-200 flex items-center gap-1.5 transition-colors"><MagicWand size={13} /> AI Import</Link>
          <Link to="/admin/products/new?mode=detail" className="px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-[#1b1f27] hover:bg-[#2b3140] flex items-center gap-1.5 shadow-sm transition-colors"><Plus size={13} weight="bold" /> Add to Catalog</Link>
        </div>
      </div>

      {/* KPI row — real dashboard data only */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {kpis.map((k, i) => (
          <Link key={i} to={k.to} className="group bg-white rounded-xl border border-gray-100 p-3.5 hover:shadow-md hover:border-gray-200 transition-all">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${k.iconCls}`}><k.i size={15} /></div>
            <p className="mt-2.5 text-lg font-bold text-gray-900 leading-none truncate">{k.v}</p>
            <p className="text-[10px] font-medium text-gray-500 mt-1">{k.l}</p>
            <p className="text-[9px] text-gray-400 mt-0.5 truncate">{k.sub}</p>
          </Link>
        ))}
      </div>

      {/* Main grid — left: performance + orders, right: operations */}
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          {/* Revenue & orders performance chart with range selector */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#f6efdd] flex items-center justify-center"><TrendUp size={14} className="text-[#9a6f16]" /></div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900 leading-tight">Revenue & Orders</h2>
                  <p className="text-[10px] text-gray-400">{rangeOrders} order{rangeOrders !== 1 ? 's' : ''} · ${rangeRev.toFixed(2)} in range</p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 p-0.5">
                {([7, 30, 90] as const).map(r => (
                  <button key={r} onClick={() => setRange(r)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${range === r ? 'bg-[#1b1f27] text-white' : 'text-gray-500 hover:text-gray-800'}`}>
                    {r}D
                  </button>
                ))}
              </div>
            </div>
            {rangeOrders === 0 ? (
              <div className="py-12 text-center">
                <div className="mx-auto w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3"><TrendUp size={16} className="text-gray-300" /></div>
                <p className="text-xs text-gray-500">No orders yet — share your store or run a campaign.</p>
                <Link to="/" target="_blank" className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors"><Eye size={12} /> View store</Link>
              </div>
            ) : (
              <div className="px-4 py-3.5">
                <div className="flex items-end gap-1 h-24">
                  {activeSeries.map((d, i) => {
                    const step = range === 7 ? 1 : range === 30 ? 5 : 15;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.label}: $${d.total.toFixed(2)} (${d.orders} order${d.orders !== 1 ? 's' : ''})`}>
                        <div className="w-full rounded-t bg-gradient-to-t from-[#9a6f16] to-[#c9a44c] transition-all"
                          style={{ height: `${Math.max((d.total / maxDay) * 80, d.total > 0 ? 6 : 2)}px`, opacity: d.total > 0 ? 1 : 0.25 }} />
                        <span className="text-[8px] text-gray-400 font-medium uppercase">{i % step === 0 || i === activeSeries.length - 1 ? d.label : ''}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Recent orders — max 5 rows */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
              <h2 className="font-bold text-xs text-gray-800">Recent Orders</h2>
              <Link to="/admin/orders" className="text-[10px] font-semibold text-[#9a6f16] hover:text-[#7c5a10]">View all orders →</Link>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-gray-400 border-b border-gray-50">
                  <th className="px-4 py-2 font-semibold">Order</th>
                  <th className="px-2 py-2 font-semibold hidden sm:table-cell">Customer</th>
                  <th className="px-2 py-2 font-semibold hidden md:table-cell">Date</th>
                  <th className="px-2 py-2 font-semibold text-right">Total</th>
                  <th className="px-4 py-2 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {realOrders.slice(0, 5).map(o => (
                  <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-colors">
                    <td className="px-4 py-2"><span className="font-mono font-semibold text-[11px] text-gray-900">{o.order_number}</span></td>
                    <td className="px-2 py-2 text-[11px] text-gray-600 hidden sm:table-cell">{o.customer_email || '—'}</td>
                    <td className="px-2 py-2 text-[11px] text-gray-500 hidden md:table-cell">{new Date(o.created_at).toLocaleDateString()}</td>
                    <td className="px-2 py-2 text-[11px] font-bold text-gray-900 text-right">${Number(o.total || 0).toFixed(2)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold capitalize ${
                        o.status === 'paid' ? 'bg-green-100 text-green-700' :
                        String(o.status || '').includes('refund') ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{String(o.status || '').replace('_', ' ')}</span>
                    </td>
                  </tr>
                ))}
                {realOrders.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-[11px] text-gray-400">No orders yet — share your store or run a campaign.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column — operational cards */}
        <div className="space-y-4">
          {/* Order status breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 p-3.5">
            <h3 className="font-bold text-[11px] text-gray-800 mb-2.5 flex items-center gap-1.5"><Receipt size={11} className="text-[#9a6f16]" />Order Status</h3>
            {statusTotal === 0 ? (
              <p className="text-[11px] text-gray-400 py-4 text-center">No order-status data yet.</p>
            ) : (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
                  {statusCounts.filter(x => x.n > 0).map((x, i) => (
                    <div key={i} className={x.color} style={{ width: `${(x.n / statusTotal) * 100}%` }} title={`${x.s}: ${x.n}`} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
                  {statusCounts.map((x, i) => (
                    <span key={i} className="text-[10px] text-gray-600 flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${x.color}`} />{x.s} · <b>{x.n}</b></span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Low stock — priority items */}
          <div className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="font-bold text-[11px] text-gray-800 flex items-center gap-1.5"><Warning size={11} className="text-amber-500" />Low Stock</h3>
              <Link to="/admin/products" className="text-[10px] font-semibold text-[#9a6f16] hover:text-[#7c5a10]">View inventory →</Link>
            </div>
            {lowStockList.length === 0 ? (
              <p className="text-[11px] text-gray-400 py-3 text-center">All products well stocked ✓</p>
            ) : (
              <ul className="space-y-2">
                {lowStockList.slice(0, 4).map(p => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-700 truncate">{p.name}</span>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${Number(p.inventoryQty ?? 0) <= 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{p.inventoryQty ?? 0} left</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Gift Drop live card */}
          <div className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-[11px] text-gray-800 flex items-center gap-1.5"><Gift size={11} className="text-[#9a6f16]" />Gift Drop</h3>
              {gift?.active && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-[9px] font-bold"><span className="h-1 w-1 rounded-full bg-emerald-500" />LIVE</span>
              )}
            </div>
            {gift ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-gray-50 p-2.5">
                  <p className="text-lg font-bold text-gray-900 leading-none">{gift.claimsToday}</p>
                  <p className="text-[9px] text-gray-500 mt-1">claims today</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2.5">
                  <p className="text-lg font-bold text-gray-900 leading-none">{gift.remaining}<span className="text-[10px] font-semibold text-gray-400">/{gift.total}</span></p>
                  <p className="text-[9px] text-gray-500 mt-1">gifts remaining</p>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 py-3 text-center">Gift Drop data unavailable.</p>
            )}
            <Link to="/admin/gift-drop" className="mt-2.5 block text-center text-[10px] font-semibold text-[#9a6f16] hover:text-[#7c5a10] py-1.5 rounded-lg border border-[#e5d9b6] hover:bg-[#fbf7ee] transition-colors">Open Gift Drop admin →</Link>
          </div>

          {/* Drafts / publishing queue */}
          <div className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="font-bold text-[11px] text-gray-800 flex items-center gap-1.5"><FileText size={11} className="text-[#9a6f16]" />Publishing Queue</h3>
              <Link to="/admin/products" className="text-[10px] font-semibold text-[#9a6f16] hover:text-[#7c5a10]">Manage →</Link>
            </div>
            {drafts === 0 ? (
              <p className="text-[11px] text-gray-400 py-3 text-center">No drafts waiting for review.</p>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#f6efdd] flex items-center justify-center"><FileText size={16} className="text-[#9a6f16]" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 leading-none">{drafts} draft{drafts !== 1 ? 's' : ''} awaiting review</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Ready to review and publish to the storefront.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick actions — 2x3 compact grid */}
      <div className="bg-white rounded-xl border border-gray-100 p-3.5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-xs text-gray-800 flex items-center gap-1.5"><Lightning size={12} className="text-[#9a6f16]" />Quick Actions</h2>
          <Link to="/admin/ai-import" className="text-[10px] font-semibold text-[#9a6f16] hover:text-[#7c5a10]">AI Import →</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {quickActions.map(a => (
            <Link key={a.to} to={a.to} className="group flex items-start gap-2.5 rounded-lg border border-gray-100 hover:border-[#e5d9b6] hover:bg-[#fbf7ee] p-3 transition-colors">
              <div className="w-8 h-8 shrink-0 rounded-lg bg-[#f6efdd] text-[#9a6f16] flex items-center justify-center group-hover:bg-[#f1e5c8] transition-colors"><a.icon size={15} /></div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-gray-800 leading-tight">{a.label}</p>
                <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{a.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function _AProducts() { // superseded by CatalogAdmin.CatalogProductsPage (DB-backed)
  const { products, setProducts, notify } = useApp();
  const nav = useNavigate();
  const [delId, setDelId] = useState<string | null>(null);
  const toggle = (id: string) => { setProducts(p => p.map(x => x.id === id ? { ...x, isActive: !x.isActive } : x)); notify('Status updated!'); };
  const del = () => { if (delId) { setProducts(p => p.filter(x => x.id !== delId)); notify('Deleted!'); setDelId(null); } };

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Products</h1><button onClick={() => nav('/admin/products/new')} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Add Product</button></div>
    <div className="bg-white rounded-xl shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full">
      <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr><th className="px-6 py-4">Product</th><th className="px-6 py-4">Brand</th><th className="px-6 py-4">Category</th><th className="px-6 py-4">Price</th><th className="px-6 py-4">Stock</th><th className="px-6 py-4">Variants</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Actions</th></tr></thead>
      <tbody>{products.map(p => <tr key={p.id} className="border-t hover:bg-gray-50">
        <td className="px-6 py-4"><div className="flex items-center gap-3"><img src={p.images[0]} alt="" className="w-10 h-10 rounded object-cover" /><div><span className="font-medium text-sm block">{p.name}</span>{p.shortDesc && <span className="text-xs text-gray-400">{p.shortDesc}</span>}</div></div></td>
        <td className="px-6 py-4 text-xs text-gray-500">{p.brand}</td>
        <td className="px-6 py-4 text-sm">{p.category}</td>
        <td className="px-6 py-4"><span className="font-semibold">${p.price}</span>{p.originalPrice > p.price && <span className="text-xs text-gray-400 line-through ml-1">${p.originalPrice}</span>}</td>
        <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${p.stock <= 10 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{p.stock}</span></td>
        <td className="px-6 py-4 text-sm">{p.variants.length > 0 ? <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">{p.variants.length}</span> : <span className="text-gray-400 text-xs">—</span>}</td>
        <td className="px-6 py-4"><button onClick={() => toggle(p.id)}>{p.isActive ? <ToggleRight size={22} className="text-green-500" /> : <ToggleLeft size={22} className="text-gray-400" />}</button></td>
        <td className="px-6 py-4 flex gap-1"><button onClick={() => nav(`/admin/products/edit/${p.id}`)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><PencilSimple size={16} /></button><button onClick={() => setDelId(p.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash size={16} /></button></td>
      </tr>)}</tbody>
    </table></div></div>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Product"><p className="text-gray-600 mb-6">Delete this product permanently?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

// ============================================================================
// ADVANCED PRODUCT EDITOR (eBay-style)
// ============================================================================
const EMPTY_PRODUCT: Product = { id:'',name:'',shortDesc:'',description:'',price:0,originalPrice:0,category:'Dog Supplies',stock:0,images:[],imageAlts:[],rating:0,reviews:0,isActive:true,brand:'',condition:'New',tags:[],weight:'',dimensions:'',origin:'China',freeShipping:true,shippingCost:'0',variants:[] };

export function _AProductEdit() { // superseded by CatalogAdmin.CatalogProductEditor (DB-backed)
  const { id: paramId } = useParams<{ id: string }>();
  const isNew = !paramId;
  const { products, setProducts, notify } = useApp();
  const nav = useNavigate();

  const existing = paramId ? products.find(p => p.id === paramId) : null;
  const [p, setP] = useState<Product>(existing ? { ...existing } : { ...EMPTY_PRODUCT, id: `p${Date.now()}` });
  const [tab, setTab] = useState('basic');
  const [tagInput, setTagInput] = useState('');

  // Image upload
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    Array.from(files).slice(0, 5 - p.images.length).forEach(f => {
      if (!f.type.startsWith('image/') || f.size > 5*1024*1024) return;
      const r = new FileReader();
      r.onload = ev => { const res = ev.target?.result as string; if (res) setP(prev => ({ ...prev, images: prev.images.length < 5 ? [...prev.images, res] : prev.images })); };
      r.readAsDataURL(f);
    });
    e.target.value = '';
  };
  const removeImg = (i: number) => setP(prev => ({ ...prev, images: prev.images.filter((_, idx) => idx !== i) }));
  const setMainImg = (i: number) => setP(prev => { const imgs = [...prev.images]; const [m] = imgs.splice(i, 1); return { ...prev, images: [m, ...imgs] }; });

  // Tags
  const addTag = () => { if (tagInput.trim() && !p.tags.includes(tagInput.trim())) { setP(prev => ({ ...prev, tags: [...prev.tags, tagInput.trim()] })); setTagInput(''); } };
  const removeTag = (t: string) => setP(prev => ({ ...prev, tags: prev.tags.filter(x => x !== t) }));

  // Variants
  const [vColor, setVColor] = useState(''); const [vSize, setVSize] = useState('');
  const addVariant = () => {
    if (!vColor && !vSize) { notify('Enter color or size'); return; }
    setP(prev => ({ ...prev, variants: [...prev.variants, { id: `v${Date.now()}`, color: vColor, size: vSize, price: prev.price, salePrice: prev.price, stock: 0, sku: '' }] }));
    setVColor(''); setVSize('');
  };
  const updateVariant = (vid: string, updates: Partial<ProductVariant>) => { setP(prev => ({ ...prev, variants: prev.variants.map(v => v.id === vid ? { ...v, ...updates } : v) })); };
  const removeVariant = (vid: string) => setP(prev => ({ ...prev, variants: prev.variants.filter(v => v.id !== vid) }));

  // Auto-generate variants
  const [genColors, setGenColors] = useState('');
  const [genSizes, setGenSizes] = useState('');
  const autoGenerate = () => {
    const colors = genColors.split(',').map(s => s.trim()).filter(Boolean);
    const sizes = genSizes.split(',').map(s => s.trim()).filter(Boolean);
    if (colors.length === 0 && sizes.length === 0) { notify('Enter colors or sizes'); return; }
    const newVars: ProductVariant[] = [];
    if (colors.length > 0 && sizes.length > 0) {
      colors.forEach(c => sizes.forEach(s => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: c, size: s, price: p.price, salePrice: p.price, stock: 0, sku: '' })));
    } else if (colors.length > 0) {
      colors.forEach(c => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: c, size: 'One Size', price: p.price, salePrice: p.price, stock: 0, sku: '' }));
    } else {
      sizes.forEach(s => newVars.push({ id: `v${Date.now()}${Math.random()}`, color: 'Default', size: s, price: p.price, salePrice: p.price, stock: 0, sku: '' }));
    }
    setP(prev => ({ ...prev, variants: [...prev.variants, ...newVars] }));
    setGenColors(''); setGenSizes('');
    notify(`${newVars.length} variants created!`);
  };

  // FloppyDisk
  const handleSave = () => {
    if (!p.name) { notify('Product name required'); return; }
    if (p.images.length === 0) { notify('At least 1 image required'); return; }
    if (p.price <= 0) { notify('Price must be greater than 0'); return; }
    const totalVarStock = p.variants.reduce((s, v) => s + v.stock, 0);
    const finalProduct = { ...p, stock: p.variants.length > 0 ? totalVarStock : p.stock };
    if (isNew) {
      setProducts(prev => [...prev, finalProduct]);
      notify('Product created!');
    } else {
      setProducts(prev => prev.map(x => x.id === p.id ? finalProduct : x));
      notify('Product saved!');
    }
    nav('/admin/products');
  };

  const discount = p.originalPrice > 0 && p.price > 0 ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  const I = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const tabs = ['basic','pricing','images','variants','details','shipping'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/admin/products')} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div><h1 className="text-2xl font-bold">{isNew ? 'Add New Product' : 'Edit Product'}</h1><p className="text-sm text-gray-500">{isNew ? 'Create a new product listing' : p.name}</p></div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => nav('/admin/products')} className="px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><FloppyDisk size={16} />{isNew ? 'Create Product' : 'FloppyDisk Changes'}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-5 py-3 text-sm font-medium capitalize whitespace-nowrap border-b-2 transition-colors ${tab === t ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
              {t === 'basic' ? '📋 Basic Info' : t === 'pricing' ? '💰 Pricing' : t === 'images' ? '🖼️ Images' : t === 'variants' ? '🎨 Variants' : t === 'details' ? '📦 Details' : '🚚 Shipping'}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* BASIC INFO TAB */}
          {tab === 'basic' && (
            <div className="space-y-5 max-w-3xl">
              <div><label className={L}>Product Name *</label><input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} className={I} placeholder="e.g. Orthopedic Memory Foam Dog Bed" /></div>
              <div><label className={L}>Short Description</label><input value={p.shortDesc} onChange={e => setP({ ...p, shortDesc: e.target.value })} className={I} placeholder="Brief tagline for product cards" maxLength={100} /><p className="text-xs text-gray-400 mt-1">{p.shortDesc.length}/100</p></div>
              <div><label className={L}>Full Description *</label><textarea value={p.description} onChange={e => setP({ ...p, description: e.target.value })} className={I + ' resize-none'} rows={6} placeholder="Detailed product description. Use line breaks for formatting." /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Category *</label><select value={p.category} onChange={e => setP({ ...p, category: e.target.value })} className={I}>{CAT_LIST.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}</select></div>
                <div><label className={L}>Brand</label><input value={p.brand} onChange={e => setP({ ...p, brand: e.target.value })} className={I} placeholder="Brand name" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Condition</label><select value={p.condition} onChange={e => setP({ ...p, condition: e.target.value })} className={I}><option>New</option><option>Used</option><option>Refurbished</option><option>Open Box</option></select></div>
                <div className="flex items-end gap-3 pb-1"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.isActive} onChange={e => setP({ ...p, isActive: e.target.checked })} className="w-4 h-4 text-blue-500 rounded" /><span className="text-sm text-gray-700">Active (visible in store)</span></label></div>
              </div>
              <div>
                <label className={L}>Tags / Keywords</label>
                <div className="flex flex-wrap gap-2 mb-2">{p.tags.map(t => <span key={t} className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"><span>{t}</span><button type="button" onClick={() => removeTag(t)} className="text-gray-400 hover:text-red-500">×</button></span>)}</div>
                <div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className={I} placeholder="Type tag & press Enter" /><button type="button" onClick={addTag} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium">Add</button></div>
              </div>
            </div>
          )}

          {/* PRICING TAB */}
          {tab === 'pricing' && (
            <div className="space-y-5 max-w-3xl">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Sale Price (USD) *</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.price || ''} onChange={e => setP({ ...p, price: +e.target.value })} className={I + ' pl-7'} placeholder="0.00" /></div></div>
                <div><label className={L}>Compare / Original Price</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.originalPrice || ''} onChange={e => setP({ ...p, originalPrice: +e.target.value })} className={I + ' pl-7'} placeholder="0.00" /></div></div>
              </div>
              {discount > 0 && <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl"><CurrencyDollar size={20} className="text-green-600" /><div><p className="font-semibold text-green-700">Discount: {discount}% OFF</p><p className="text-sm text-green-600">Customer saves ${(p.originalPrice - p.price).toFixed(2)}</p></div></div>}
              <div><label className={L}>Global Stock (if no variants) *</label><input type="number" value={p.stock || ''} onChange={e => setP({ ...p, stock: +e.target.value })} className={I} placeholder="0" />{p.stock > 0 && p.stock <= 10 && <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><Warning size={12} />Low stock warning will appear</p>}</div>
            </div>
          )}

          {/* IMAGES TAB */}
          {tab === 'images' && (
            <div className="space-y-5 max-w-3xl">
              <p className="text-sm text-gray-500">UploadSimple up to 5 images. First image is the main product image. Click to set as main.</p>
              {p.images.length > 0 && <div className="grid grid-cols-5 gap-4">{p.images.map((img, i) => (
                <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border-2 border-gray-200 hover:border-blue-400 transition-all cursor-pointer" onClick={() => setMainImg(i)}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  {i === 0 && <div className="absolute top-2 left-2 px-2 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full">MAIN</div>}
                  <button type="button" onClick={e => { e.stopPropagation(); removeImg(i); }} className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600">✕</button>
                  {i !== 0 && <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-end justify-center pb-2"><span className="text-[10px] text-white bg-black/50 px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">Click = Main</span></div>}
                </div>
              ))}</div>}
              {p.images.length < 5 && (
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all">
                  <UploadSimple size={28} className="text-gray-400 mb-2" />
                  <span className="text-sm font-medium text-gray-600">Click to upload from PC</span>
                  <span className="text-xs text-gray-400 mt-1">PNG, JPG, WebP · Max 5MB each · {5 - p.images.length} slot{5 - p.images.length !== 1 ? 's' : ''} remaining</span>
                  <input type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" />
                </label>
              )}
              {p.images.length === 0 && <p className="text-xs text-red-500 flex items-center gap-1"><ImageIcon size={12} />At least 1 image is required</p>}
            </div>
          )}

          {/* VARIANTS TAB */}
          {tab === 'variants' && (
            <div className="space-y-6">
              {/* Auto-generate */}
              <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl">
                <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2"><Lightning size={16} />Auto-Generate Combinations</h3>
                <p className="text-xs text-blue-600 mb-3">Enter comma-separated values. All combinations will be created automatically.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div><label className="text-xs font-medium text-blue-700 mb-1 block">Colors</label><input value={genColors} onChange={e => setGenColors(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white" placeholder="Black, White, Blue" /></div>
                  <div><label className="text-xs font-medium text-blue-700 mb-1 block">Sizes</label><input value={genSizes} onChange={e => setGenSizes(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white" placeholder="S, M, L, XL" /></div>
                </div>
                <button type="button" onClick={autoGenerate} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg font-medium flex items-center gap-2"><Lightning size={14} />Generate Variants</button>
              </div>

              {/* Manual add */}
              <div className="p-5 bg-gray-50 border border-gray-200 rounded-xl">
                <h3 className="font-semibold text-gray-700 mb-3">Or Add Manually</h3>
                <div className="flex gap-3 items-end">
                  <div className="flex-1"><label className="text-xs font-medium text-gray-600 mb-1 block">Color</label><input value={vColor} onChange={e => setVColor(e.target.value)} className={I} placeholder="e.g. Black" /></div>
                  <div className="flex-1"><label className="text-xs font-medium text-gray-600 mb-1 block">Size</label><input value={vSize} onChange={e => setVSize(e.target.value)} className={I} placeholder="e.g. Large" /></div>
                  <button type="button" onClick={addVariant} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-sm rounded-lg font-medium flex items-center gap-2"><Plus size={14} />Add</button>
                </div>
              </div>

              {/* Variants table */}
              {p.variants.length > 0 && (
                <div className="border rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between"><span className="font-semibold text-sm">{p.variants.length} Variant{p.variants.length !== 1 ? 's' : ''}</span><span className="text-xs text-gray-500">Total stock: {p.variants.reduce((s, v) => s + v.stock, 0)}</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr><th className="px-4 py-3 text-left">Color</th><th className="px-4 py-3 text-left">Size</th><th className="px-4 py-3 text-left">Price</th><th className="px-4 py-3 text-left">Sale</th><th className="px-4 py-3 text-left">Stock</th><th className="px-4 py-3 text-left">SKU</th><th className="px-4 py-3"></th></tr></thead>
                      <tbody>{p.variants.map(v => (
                        <tr key={v.id} className="border-t">
                          <td className="px-4 py-2"><input value={v.color} onChange={e => updateVariant(v.id, { color: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input value={v.size} onChange={e => updateVariant(v.id, { size: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" step="0.01" value={v.price||''} onChange={e => updateVariant(v.id, { price: +e.target.value })} className="w-20 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" step="0.01" value={v.salePrice||''} onChange={e => updateVariant(v.id, { salePrice: +e.target.value })} className="w-20 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input type="number" value={v.stock||''} onChange={e => updateVariant(v.id, { stock: +e.target.value })} className="w-16 px-2 py-1.5 border rounded text-sm" /></td>
                          <td className="px-4 py-2"><input value={v.sku} onChange={e => updateVariant(v.id, { sku: e.target.value })} className="w-24 px-2 py-1.5 border rounded text-sm" placeholder="SKU" /></td>
                          <td className="px-4 py-2"><button type="button" onClick={() => removeVariant(v.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash size={14} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {p.variants.length === 0 && <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed"><p className="text-gray-400 text-sm">No variants yet. Use auto-generate or add manually above.</p></div>}
            </div>
          )}

          {/* DETAILS TAB */}
          {tab === 'details' && (
            <div className="space-y-5 max-w-3xl">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={L}>Weight</label><input value={p.weight} onChange={e => setP({ ...p, weight: e.target.value })} className={I} placeholder="e.g. 0.5 lbs" /></div>
                <div><label className={L}>Dimensions</label><input value={p.dimensions} onChange={e => setP({ ...p, dimensions: e.target.value })} className={I} placeholder="e.g. 6 × 4 × 2 in" /></div>
              </div>
              <div><label className={L}>Country of Origin</label><select value={p.origin} onChange={e => setP({ ...p, origin: e.target.value })} className={I}>{['China','USA','India','Japan','South Korea','Germany','Vietnam','Taiwan','UK','Italy','Other'].map(c => <option key={c}>{c}</option>)}</select></div>
            </div>
          )}

          {/* SHIPPING TAB */}
          {tab === 'shipping' && (
            <div className="space-y-5 max-w-3xl">
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border">
                <input type="checkbox" checked={p.freeShipping} onChange={e => setP({ ...p, freeShipping: e.target.checked, shippingCost: e.target.checked ? '0' : p.shippingCost })} className="w-5 h-5 text-blue-500 rounded" id="fship" />
                <label htmlFor="fship" className="cursor-pointer"><p className="font-semibold text-sm">Free Shipping</p><p className="text-xs text-gray-500">Offer free shipping on this product</p></label>
              </div>
              {!p.freeShipping && <div><label className={L}>Shipping Cost (USD)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span><input type="number" step="0.01" value={p.shippingCost} onChange={e => setP({ ...p, shippingCost: e.target.value })} className={I + ' pl-7'} placeholder="4.99" /></div></div>}
              <div><label className={L}>Weight (for shipping calc)</label><input value={p.weight} onChange={e => setP({ ...p, weight: e.target.value })} className={I} placeholder="e.g. 0.5 lbs" /></div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom FloppyDisk Bar */}
      <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between sticky bottom-0">
        <p className="text-sm text-gray-500">
          {p.images.length} image{p.images.length !== 1 ? 's' : ''} · {p.variants.length} variant{p.variants.length !== 1 ? 's' : ''} · {p.tags.length} tag{p.tags.length !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-3">
          <button onClick={() => nav('/admin/products')} className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50">Discard</button>
          <button onClick={handleSave} className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><FloppyDisk size={16} />{isNew ? 'Create Product' : 'FloppyDisk Changes'}</button>
        </div>
      </div>
    </div>
  );
}

interface StripeOrderRow { id: string; order_number: string; customer_email: string | null; customer_name?: string | null; total: number | null; currency: string | null; status: string; stripe_session_id: string | null; stripe_payment_intent?: string | null; created_at: string; items?: unknown[]; shipping_address?: { name?: string; line1?: string; city?: string; state?: string; zip?: string } | null; }

// ERP (Embani LLC) sync — server-side only. The browser never sees the webhook
// token: /api/admin/erp stores it server-side and calls the ERP webhook. GET
// returns masked values + a per-order sync ledger.
interface ErpKeyStatus { configured: boolean; masked: string; source: 'env' | 'attached' | 'none' }
interface ErpSyncEntry { status: string; synced_at?: string; error?: string }
interface ErpSyncLogEntry { order_number: string; status: string; at: string; error?: string }
interface ErpConfig { webhook: ErpKeyStatus; token: ErpKeyStatus; sync: Record<string, ErpSyncEntry>; syncLog?: ErpSyncLogEntry[] }

export function AOrders() {
  const { notify } = useApp();
  const [stripeOrders, setStripeOrders] = useState<StripeOrderRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string, { carrier: string; number: string }>>({});
  const [labelOrder, setLabelOrder] = useState<StripeOrderRow | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<StripeOrderRow | null>(null);
  const [showDemo, setShowDemo] = useState(true);
  // Per-order invoice extras (shipping / tax rate / discount) — admin-recorded,
  // persisted locally like tracking. Defaults are honest: 0 = not recorded.
  const [orderExtras, setOrderExtras] = useState<Record<string, { shipping: number; taxRate: number; discount: number }>>({});
  // ERP (Embani LLC) sync — webhook URL + token live server-side (env wins,
  // app_settings fallback). This UI only ever sees masked values.
  const [erpCfg, setErpCfg] = useState<ErpConfig | null>(null);
  const [erpWebhookInput, setErpWebhookInput] = useState('');
  const [erpTokenInput, setErpTokenInput] = useState('');
  const [erpBusy, setErpBusy] = useState(false);
  const [erpResult, setErpResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showErpLog, setShowErpLog] = useState(false);
  // Provider filter for orders
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [includeGifts, setIncludeGifts] = useState(false);

  // Authoritative persisted orders ONLY (created by the Stripe webhook or gift-drop). No
  // fake order history — the legacy demo table was removed for truthfulness.
  // Paid-only stats come from the server (full order set); refresh near-real-time.
  const [orderStats, setOrderStats] = useState<DashStats | null>(null);
  const loadOrders = useCallback(() => {
    const token = getAccessToken();
    if (!token) { setLoaded(true); return Promise.resolve(); }
    const params = new URLSearchParams({ action: 'orders' });
    if (providerFilter !== 'all') params.set('provider', providerFilter);
    if (includeGifts) params.set('includeGifts', 'true');
    return fetch(`/api/checkout?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: { orders?: StripeOrderRow[]; stats?: DashStats | null }) => {
        setStripeOrders(Array.isArray(d.orders) ? d.orders : []);
        setOrderStats(d.stats && typeof d.stats.revenue === 'number' ? d.stats : null);
      })
      .catch(() => { setStripeOrders([]); setOrderStats(null); })
      .finally(() => setLoaded(true));
  }, [providerFilter, includeGifts]);
  const refreshOrders = useAutoRefresh(loadOrders);
  useEffect(() => { refreshOrders(); }, [refreshOrders, providerFilter, includeGifts]);
  useEffect(() => {
    try { const raw = localStorage.getItem('luxedge-tracking'); if (raw) setTracking(JSON.parse(raw)); } catch { /* ignore */ }
    try { const raw = localStorage.getItem('luxedge-order-extras'); if (raw) setOrderExtras(JSON.parse(raw)); } catch { /* ignore */ }
    // Purge legacy plaintext ERP settings that older builds stored locally.
    try { localStorage.removeItem('luxedge-erp-webhook'); localStorage.removeItem('luxedge-erp-token'); } catch { /* ignore */ }
    loadErpCfg();
  }, []);

  // ── ERP config + sync ledger (masked, from the server) ──
  const loadErpCfg = () => {
    const token = getAccessToken();
    if (!token) return;
    fetch('/api/admin/erp', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: ErpConfig | null) => { if (d) setErpCfg(d); })
      .catch(() => { /* keep last known state */ });
  };

  const erpSyncFor = (orderNumber: string): ErpSyncEntry | undefined => erpCfg?.sync?.[orderNumber];

  const saveTracking = (id: string, t: { carrier: string; number: string }) => {
    const next = { ...tracking, [id]: t };
    setTracking(next);
    try { localStorage.setItem('luxedge-tracking', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const extrasFor = (o: StripeOrderRow) => {
    const e = orderExtras[o.id] || (o.id === 'demo-order-001' ? { shipping: 6.99, taxRate: 8.25, discount: 0 } : { shipping: 0, taxRate: 0, discount: 0 });
    // Round defensively — stale localStorage values may carry float artifacts.
    return { shipping: Math.round(e.shipping * 100) / 100, taxRate: Math.round(e.taxRate * 100) / 100, discount: Math.round(e.discount * 100) / 100 };
  };

  const saveExtras = (id: string, e: { shipping: number; taxRate: number; discount: number }) => {
    const next = { ...orderExtras, [id]: e };
    setOrderExtras(next);
    try { localStorage.setItem('luxedge-order-extras', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const subtotalOf = (o: StripeOrderRow) => fmtItems(o.items).reduce((s, it) => s + it.qty * it.price, 0);

  // Invoice totals — subtotal + shipping − discount, then tax on the net.
  const totalsOf = (o: StripeOrderRow) => {
    const subtotal = subtotalOf(o);
    const ex = extrasFor(o);
    const discount = Math.min(ex.discount, subtotal);
    const taxable = Math.max(subtotal - discount, 0);
    const tax = taxable * (ex.taxRate / 100);
    const grand = taxable + tax + ex.shipping;
    return { subtotal, shipping: ex.shipping, discount, taxRate: ex.taxRate, tax, grand };
  };

  // Expand behaviour with many orders: accordion (one open at a time) + auto
  // scroll so the opened detail is never lost below the fold.
  useEffect(() => {
    if (!expanded) return;
    const el = document.getElementById(`order-detail-${expanded}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [expanded]);

  // ── Invoice download — opens a clean printable invoice in a new tab (Save as PDF). ──
  const downloadInvoice = (o: StripeOrderRow) => {
    const t = totalsOf(o);
    const addr = (o as { shipping_address?: { name?: string; line1?: string; city?: string; state?: string; zip?: string } | null }).shipping_address;
    const items = fmtItems(o.items);
    const rows = items.map(it => `<tr>
      <td>${String(it.name).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">$${it.price.toFixed(2)}</td>
      <td style="text-align:right">$${(it.qty * it.price).toFixed(2)}</td></tr>`).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${o.order_number}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 24px}
        h1{font-size:20px;margin:0}.muted{color:#666;font-size:12px}
        .head{display:flex;justify-content:space-between;border-bottom:2px solid #1e3a8a;padding-bottom:14px;margin-bottom:18px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{background:#f1f5f9;text-align:left;padding:8px;font-size:11px;text-transform:uppercase;color:#475569}
        td{padding:8px;border-bottom:1px solid #e2e8f0}
        .totals{margin-top:16px;margin-left:auto;width:260px;font-size:13px}
        .totals div{display:flex;justify-content:space-between;padding:3px 0}
        .grand{font-weight:bold;border-top:2px solid #1e3a8a;margin-top:4px;padding-top:8px;font-size:15px}
        .foot{margin-top:26px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px}
      </style></head><body>
      <div class="head"><div><h1>LUXEDGE — INVOICE</h1><p class="muted">Luxedge.us · Houston, TX · hello@luxedge.us</p></div>
      <div style="text-align:right"><p><strong>${o.order_number}</strong></p><p class="muted">${new Date(o.created_at).toLocaleDateString()}</p><p class="muted">Status: ${String(o.status || 'unknown')}</p></div></div>
      <div class="muted" style="margin-bottom:14px"><strong style="color:#111">Bill To:</strong> ${String(o.customer_email || '—')}<br>${addr ? `${String(addr.line1 || '')}, ${String(addr.city || '')} ${String(addr.state || '')} ${String(addr.zip || '')}` : 'Address not recorded'}</div>
      <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Line Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No line items recorded.</td></tr>'}</tbody></table>
      <div class="totals">
        <div><span>Subtotal</span><span>$${t.subtotal.toFixed(2)}</span></div>
        ${t.shipping > 0 ? `<div><span>Shipping</span><span>$${t.shipping.toFixed(2)}</span></div>` : ''}
        ${t.discount > 0 ? `<div><span>Discount</span><span>−$${t.discount.toFixed(2)}</span></div>` : ''}
        ${t.tax > 0 ? `<div><span>Tax (${t.taxRate.toFixed(2)}%)</span><span>$${t.tax.toFixed(2)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>$${t.grand.toFixed(2)}</span></div>
      </div>
      <p class="foot">Thank you for shopping with Luxedge. ${Number(o.total || 0) > 0 && Math.abs(t.grand - Number(o.total || 0)) > 0.01 ? `Stripe-recorded total: $${Number(o.total).toFixed(2)}. ` : ''}This is a Luxedge-generated invoice.</p>
    </body></html>`;
    const win = window.open('', '_blank', 'width=820,height=1000');
    if (!win) { notify('Popup blocked — allow popups to download the invoice', 'error'); return; }
    win.document.write(html); win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* user prints manually */ } }, 400);
  };

  // ── CSV export (real orders only, accounting-friendly columns for the Embani
  //    Excel workbook — the demo LX-1001 order and gift-drop rows never appear). ──
  const downloadCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['order_id', 'order_number', 'date', 'customer_name', 'customer_email', 'sku', 'item', 'quantity', 'unit_price', 'subtotal', 'shipping', 'tax', 'discount', 'total', 'currency', 'payment_status', 'fulfillment_status', 'stripe_payment_id', 'tracking_number'];
    const rows: string[] = [];
    for (const o of stripeOrders) {
      const rawItems = (Array.isArray(o.items) ? o.items : []) as Array<Record<string, unknown>>;
      const t = totalsOf(o);
      const tr = tracking[o.id];
      const common = [o.id, o.order_number, new Date(o.created_at).toISOString(), o.customer_name || '', o.customer_email || '', '', '', '', '', t.subtotal.toFixed(2), t.shipping.toFixed(2), t.tax.toFixed(2), t.discount.toFixed(2), t.grand.toFixed(2), o.currency || 'USD', payStatus(String(o.status || '')), String(o.status || ''), o.stripe_payment_intent || o.stripe_session_id || '', tr?.number || ''];
      if (rawItems.length === 0) {
        rows.push([...common.slice(0, 5), '', 'No line items', '', '', ...common.slice(9)].map(esc).join(','));
        continue;
      }
      for (const it of rawItems) {
        const qty = Number(it.quantity || 1);
        const unit = Number(it.unitPrice ?? it.price ?? 0);
        rows.push([o.id, o.order_number, new Date(o.created_at).toISOString(), o.customer_name || '', o.customer_email || '', String(it.sku || it.variantSku || ''), String(it.name || it.title || 'Item'), String(qty), unit.toFixed(2), t.subtotal.toFixed(2), t.shipping.toFixed(2), t.tax.toFixed(2), t.discount.toFixed(2), t.grand.toFixed(2), o.currency || 'USD', payStatus(String(o.status || '')), String(o.status || ''), o.stripe_payment_intent || o.stripe_session_id || '', tr?.number || ''].map(esc).join(','));
      }
    }
    if (rows.length === 0) { notify('No real orders to export yet.', 'error'); return; }
    const csv = [header.map(esc).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `luxedge-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    notify(`CSV exported — ${stripeOrders.length} real order(s). Import it into your Embani ERP workbook.`);
  };

  // ── ERP actions — the browser talks ONLY to /api/admin/erp. The webhook URL
  //    and Bearer token never leave the server, so they can't appear in the
  //    bundle, page source, or client network requests. ──
  const saveErpSettings = async () => {
    const token = getAccessToken();
    const fields: { field: 'webhook' | 'token'; value: string }[] = [];
    if (erpWebhookInput.trim()) fields.push({ field: 'webhook', value: erpWebhookInput.trim() });
    if (erpTokenInput.trim()) fields.push({ field: 'token', value: erpTokenInput.trim() });
    if (!fields.length) { setErpResult({ ok: false, msg: 'Enter a webhook URL or token to save.' }); return; }
    setErpBusy(true); setErpResult(null);
    try {
      for (const f of fields) {
        const res = await fetch('/api/admin/erp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: 'set', field: f.field, value: f.value }),
        });
        const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !data?.ok) {
          setErpResult({ ok: false, msg: `Could not save ${f.field}: ${(data as { error?: string })?.error || `HTTP ${res.status}`}` });
          return;
        }
      }
      setErpWebhookInput(''); setErpTokenInput('');
      loadErpCfg();
      setErpResult({ ok: true, msg: '✓ ERP settings saved server-side.' });
    } catch {
      setErpResult({ ok: false, msg: 'Network error — could not save ERP settings.' });
    } finally { setErpBusy(false); }
  };

  const clearErpField = async (field: 'webhook' | 'token') => {
    const token = getAccessToken();
    setErpBusy(true); setErpResult(null);
    try {
      const res = await fetch('/api/admin/erp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'clear', field }),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setErpResult({ ok: false, msg: (data as { error?: string })?.error || `Could not clear — HTTP ${res.status}` });
        return;
      }
      loadErpCfg();
      setErpResult({ ok: true, msg: `✓ ${field === 'webhook' ? 'Webhook URL' : 'API token'} cleared.` });
    } catch {
      setErpResult({ ok: false, msg: 'Network error — could not clear setting.' });
    } finally { setErpBusy(false); }
  };

  const pushToErp = async (testOnly = false, orderNumbers?: string[]) => {
    if (erpBusy) return;
    const token = getAccessToken();
    if (!token) { setErpResult({ ok: false, msg: 'Not signed in.' }); return; }
    setErpBusy(true); setErpResult(null);
    try {
      const res = await fetch('/api/admin/erp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(orderNumbers && orderNumbers.length ? { action: testOnly ? 'test' : 'push', orderNumbers } : { action: testOnly ? 'test' : 'push' }),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; message?: string; sent?: number; created?: number | null; updated?: number | null; failed?: { order_number?: string; reason?: string }[]; error?: string } | null;
      if (!data) { setErpResult({ ok: false, msg: `ERP request failed — HTTP ${res.status}` }); return; }
      if (!res.ok) { setErpResult({ ok: false, msg: data.error || `ERP request failed — HTTP ${res.status}` }); return; }
      if (data.ok === false) {
        setErpResult({ ok: false, msg: data.message || 'ERP sync failed' });
        if (!testOnly) loadErpCfg(); // refresh the failed ledger badges
        return;
      }
      if (!testOnly) loadErpCfg(); // refresh created/updated badges
      setErpResult({ ok: true, msg: data.message || (testOnly ? 'ERP connection successful' : 'ERP Sync complete') });
      if (testOnly) notify('ERP connection OK');
    } catch {
      setErpResult({ ok: false, msg: 'ERP request failed — could not reach the Luxedge server.' });
    } finally { setErpBusy(false); }
  };

  // Failed ERP syncs from the server-side ledger — retry one, retry all, or
  // clear the recorded errors after they have been resolved another way.
  const failedErpSyncs = erpCfg ? Object.entries(erpCfg.sync).filter(([, e]) => e.status === 'failed') : [];

  const clearFailedErp = async () => {
    if (erpBusy || failedErpSyncs.length === 0) return;
    const token = getAccessToken();
    setErpBusy(true); setErpResult(null);
    try {
      const res = await fetch('/api/admin/erp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'clear-failed' }),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; message?: string; cleared?: number; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setErpResult({ ok: false, msg: (data as { error?: string })?.error || `Could not clear — HTTP ${res.status}` });
        return;
      }
      loadErpCfg();
      setErpResult({ ok: true, msg: data.message || '✓ Failed ERP syncs cleared.' });
    } catch {
      setErpResult({ ok: false, msg: 'Network error — could not clear failed ERP syncs.' });
    } finally { setErpBusy(false); }
  };

  // DEMO order — clearly marked, only shown for UI preview until the first
  // real Stripe payment arrives. Never treated as a real sale.
  const demoOrder: StripeOrderRow = {
    id: 'demo-order-001', order_number: 'LX-1001', customer_email: 'sarah@example.com', total: 74.97,
    currency: 'USD', status: 'shipped', stripe_session_id: 'cs_demo_preview', created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    items: [
      { id: 'i1', name: 'Interactive Squeaky Enrichment Toy for Dogs', quantity: 1, price: 19.99 },
      { id: 'i2', name: 'Orthopedic Memory Foam Pet Bed — Large', quantity: 1, price: 54.98 },
    ],
  };
  const demoTracking = { carrier: 'USPS', number: '9405510200888822222222' };

  const visibleOrders = [
    ...(showDemo ? [{ order: demoOrder, isDemo: true, tr: demoTracking }] : []),
    ...stripeOrders.map(o => ({ order: o, isDemo: false, tr: tracking[o.id] || null })),
  ];

  const stats = {
    // Paid-only counts/revenue from the server (refunds subtracted, no page cap).
    total: orderStats ? orderStats.paidCount : stripeOrders.length,
    revenue: orderStats ? orderStats.revenue : 0,
    pending: stripeOrders.filter(o => ['pending', 'awaiting_payment', 'paid', 'processing'].includes(String(o.status || ''))).length,
    shipped: stripeOrders.filter(o => ['shipped', 'delivered'].includes(String(o.status || ''))).length,
  };

  const statusColor = (s: string) =>
    s === 'paid' || s === 'delivered' ? 'bg-green-100 text-green-700' :
    s === 'shipped' || s === 'processing' ? 'bg-blue-100 text-blue-700' :
    s?.includes('refund') || s === 'cancelled' || s === 'failed' ? 'bg-red-100 text-red-600' :
    'bg-gray-100 text-gray-600';

  // Payment status derived from the order lifecycle (matches the ERP contract).
  const payStatus = (s: string) =>
    ['awaiting_payment', 'pending'].includes(s) ? 'pending' :
    ['paid', 'processing', 'shipped', 'delivered'].includes(s) ? 'paid' :
    s === 'refunded' ? 'refunded' :
    s === 'cancelled' ? 'cancelled' : s || 'unknown';

  const fmtItems = (items: unknown[] | undefined) =>
    (Array.isArray(items) ? items : []).map((it: unknown) => {
      const r = (it || {}) as Record<string, unknown>;
      return { name: String(r.name || r.title || 'Item'), qty: Number(r.quantity || 1), price: Number(r.price || 0) };
    });

  // ── Shared row helpers (used by both the desktop table and mobile cards) ──
  const copyText = (v: string, label: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(v).then(() => notify(`${label} copied`)).catch(() => notify('Copy failed', 'error'));
      } else {
        const ta = document.createElement('textarea');
        ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        notify(`${label} copied`);
      }
    } catch { notify('Copy failed', 'error'); }
  };

  const orderBadges = (o: StripeOrderRow, isDemo: boolean) => {
    const pp = String((o as unknown as Record<string, unknown>).payment_provider || '');
    const ot = String((o as unknown as Record<string, unknown>).order_type || 'paid');
    const s = erpSyncFor(o.order_number);
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {isDemo && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded-full">DEMO</span>}
        {!isDemo && (ot === 'free_gift' || pp === 'none') && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">🎁 FREE GIFT</span>
        )}
        {!isDemo && pp && pp !== 'stripe' && pp !== 'none' && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full capitalize">{pp}</span>
        )}
        {!isDemo && s && (s.status === 'failed'
          ? <span title={s.error || 'ERP sync failed'} className="text-[9px] font-bold px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">ERP ✗</span>
          : <span title={`Synced to ERP ${s.synced_at ? new Date(s.synced_at).toLocaleString() : ''}`} className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">ERP ✓</span>)}
      </div>
    );
  };

  const orderActions = (o: StripeOrderRow) => (
    <div className="flex flex-wrap gap-1.5">
      <button onClick={(e) => { e.stopPropagation(); setInvoiceOrder(o); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold transition-colors"><Receipt size={12} /> Invoice</button>
      <button onClick={(e) => { e.stopPropagation(); setLabelOrder(o); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-[10px] font-semibold transition-colors"><Printer size={12} /> Label</button>
      <button onClick={(e) => { e.stopPropagation(); setExpanded(expanded === o.id ? null : o.id); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[10px] font-semibold text-gray-700 transition-colors">{expanded === o.id ? <CaretUp size={12} /> : <CaretDown size={12} />} Detail</button>
    </div>
  );

  const orderDetail = (o: StripeOrderRow, isDemo: boolean, tr: { carrier: string; number: string } | null) => (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Items */}
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Items</p>
        <div className="space-y-2">
          {fmtItems(o.items).map((it, i) => (
            <div key={i} className="flex justify-between gap-3 bg-white rounded-lg border p-2.5 text-xs">
              <div className="min-w-0">
                <p className="font-medium text-gray-800 break-words">{it.name}</p>
                <p className="text-gray-400">Qty {it.qty} · ${it.price.toFixed(2)}</p>
              </div>
              <p className="font-semibold shrink-0">${(it.qty * it.price).toFixed(2)}</p>
            </div>
          ))}
          {fmtItems(o.items).length === 0 && <p className="text-xs text-gray-300">No line items recorded.</p>}
        </div>
      </div>
      {/* Shipping + tracking */}
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Shipping & Tracking</p>
        <div className="space-y-2">
          <div className="bg-white rounded-lg border p-2.5 text-xs">
            <p className="text-gray-400 mb-1 flex items-center gap-1"><MapPin size={12} /> Address</p>
            <p className="text-gray-600 break-words">{(o as { shipping_address?: { name?: string; line1?: string; city?: string; state?: string; zip?: string } | null }).shipping_address ? `${(o as { shipping_address: { name?: string; line1?: string; city?: string; state?: string; zip?: string } }).shipping_address.name || ''} · ${(o as { shipping_address: { line1?: string; city?: string; state?: string; zip?: string } }).shipping_address.line1 || ''}, ${(o as { shipping_address: { city?: string; state?: string; zip?: string } }).shipping_address.city || ''} ${(o as { shipping_address: { state?: string; zip?: string } }).shipping_address.state || ''} ${(o as { shipping_address: { zip?: string } }).shipping_address.zip || ''}` : 'Not recorded'}</p>
          </div>
          <div className="bg-white rounded-lg border p-2.5 text-xs space-y-2">
            <p className="text-gray-400">Tracking number</p>
            <div className="flex gap-1.5">
              <select value={(tr || tracking[o.id] || { carrier: 'USPS', number: '' }).carrier} onChange={(e) => saveTracking(o.id, { carrier: e.target.value, number: (tr || tracking[o.id] || { number: '' }).number })} className="text-[11px] border border-gray-200 rounded px-1.5 py-1">
                <option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>Other</option>
              </select>
              <input value={(tr || tracking[o.id] || { number: '' }).number} onChange={(e) => saveTracking(o.id, { carrier: (tr || tracking[o.id] || { carrier: 'USPS' }).carrier, number: e.target.value })} placeholder="e.g. 9400…" className="flex-1 min-w-0 text-[11px] border border-gray-200 rounded px-2 py-1" />
            </div>
            {tr && tr.number && (
              <a href={`https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tr.number)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-[11px] font-medium"><Truck size={12} /> Track on {tr.carrier} →</a>
            )}
          </div>
        </div>
      </div>
      {/* Payment */}
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Payment</p>
        <div className="bg-white rounded-lg border p-2.5 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-gray-400">Subtotal</span><span>${subtotalOf(o).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Shipping</span><span>${extrasFor(o).shipping.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Tax</span><span>${totalsOf(o).tax.toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-gray-100 pt-1"><span className="text-gray-400">Total</span><span className="font-semibold">${totalsOf(o).grand.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Currency</span><span>{o.currency || 'USD'}</span></div>
          <div className="flex justify-between items-start gap-2"><span className="text-gray-400">Stripe</span><span className="font-mono text-[10px] text-gray-500 break-all">{o.stripe_session_id || '—'}</span></div>
          {isDemo && <p className="text-[10px] text-amber-600 pt-1">Demo record — payment not real.</p>}
        </div>
        <div className="flex gap-1.5 mt-2">
          <button onClick={() => setInvoiceOrder(o)} className="btn-glow flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"><Receipt size={14} /> Invoice</button>
          <button onClick={() => setLabelOrder(o)} className="btn-glow flex-1 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"><Barcode size={14} /> Label</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header — fluid: inline on desktop, stacked on tablet/mobile */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2"><ShoppingCart size={20} className="text-[#9a6f16]" /> Orders</h1>
          <p className="text-xs text-gray-500 mt-0.5">Track, fulfil and sync orders to your ERP.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showDemo && <button onClick={() => setShowDemo(false)} className="text-xs text-gray-400 hover:text-gray-600 underline whitespace-nowrap">Hide demo order</button>}
          <button onClick={refreshOrders} className="btn-glow inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-xs font-semibold transition-colors"><ArrowClockwise size={13} /> Refresh</button>
        </div>
      </div>

      {/* KPI row — 4-across desktop, 2x2 tablet, single column mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: 'Total Orders', v: String(stats.total), icon: ShoppingCart, tint: 'bg-[#f6efdd] text-[#9a6f16]', sub: stats.total ? 'real orders' : 'No orders yet' },
          { l: 'Revenue', v: `$${stats.revenue.toFixed(2)}`, icon: CurrencyDollar, tint: 'bg-[#f6efdd] text-[#9a6f16]', sub: stats.total ? 'from real orders' : 'No revenue yet' },
          { l: 'Needs Fulfilment', v: String(stats.pending), icon: Warning, tint: 'bg-amber-50 text-amber-600', sub: stats.pending ? 'awaiting fulfilment' : 'All fulfilled' },
          { l: 'Shipped / Delivered', v: String(stats.shipped), icon: Truck, tint: 'bg-emerald-50 text-emerald-600', sub: stats.shipped ? 'on the way or delivered' : 'Nothing shipped yet' },
        ].map((k, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-3.5 shadow-[0_1px_2px_rgba(27,31,39,0.04)]">
            <div className="flex items-center justify-between">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${k.tint}`}><k.icon size={15} /></div>
            </div>
            <p className="mt-2 text-xl font-bold text-gray-900 leading-none truncate">{k.v}</p>
            <p className="text-[10px] font-medium text-gray-500 mt-1">{k.l}</p>
            <p className="text-[9px] text-gray-400 mt-0.5 truncate">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ERP Sync — Embani LLC (server-side webhook push + CSV for the Excel workbook) */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(27,31,39,0.04)]">
        {/* Header: status + Export CSV */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#f6efdd] flex items-center justify-center shrink-0"><CloudArrowUp size={15} className="text-[#9a6f16]" /></div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 leading-tight">ERP Sync — Embani LLC</p>
              <p className="text-[11px] text-gray-500">Orders are pushed to your ERP webhook from the server — the API token never touches this browser.</p>
            </div>
          </div>
          <button onClick={downloadCsv} className="btn-glow inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors"><Download size={13} /> Export CSV (Excel)</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Connection summary */}
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">Webhook</p>
              {erpCfg?.webhook.configured ? (
                <button onClick={() => copyText(erpCfg.webhook.masked, 'Webhook URL')} title="Copy masked webhook URL" className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700 min-w-0 max-w-full">
                  <span className="truncate">{erpCfg.webhook.masked}</span>
                  <Clipboard size={11} className="text-gray-400 shrink-0" />
                  <span className="text-[9px] text-gray-400 shrink-0">({erpCfg.webhook.source === 'env' ? 'env' : 'attached'})</span>
                </button>
              ) : <p className="text-[11px] text-gray-400">Not configured</p>}
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">Token</p>
              {erpCfg?.token.configured ? (
                <button onClick={() => copyText(erpCfg.token.masked, 'API token')} title="Copy masked API token" className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700 min-w-0 max-w-full">
                  <span className="truncate font-mono">••••••••••</span>
                  <Clipboard size={11} className="text-gray-400 shrink-0" />
                  <span className="text-[9px] text-gray-400 shrink-0">({erpCfg.token.source === 'env' ? 'env' : 'attached'})</span>
                </button>
              ) : <p className="text-[11px] text-gray-400">Not configured</p>}
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">Sync count</p>
              {erpCfg && Object.keys(erpCfg.sync).length > 0 ? (() => {
                const entries = Object.values(erpCfg.sync);
                const failed = entries.filter(e => e.status === 'failed').length;
                return (
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700">
                    <ShieldCheck size={12} className={failed ? 'text-amber-500 shrink-0' : 'text-emerald-600 shrink-0'} />
                    {entries.length - failed} synced · {failed} failed
                  </p>
                );
              })() : <p className="text-[11px] text-gray-400">Nothing synced yet</p>}
            </div>
          </div>

          {/* Settings fields + actions — side-by-side on desktop, stacked below */}
          <div className="grid gap-2 lg:grid-cols-2">
            <div className="min-w-0">
              <input value={erpWebhookInput} onChange={(e) => setErpWebhookInput(e.target.value)} placeholder={erpCfg?.webhook.configured ? (erpCfg.webhook.source === 'env' ? 'Webhook is set in the server environment (••••)' : `Update webhook (currently ${erpCfg.webhook.masked})`) : 'ERP webhook URL — e.g. https://erp.example.com/api/luxedge/orders'} className="w-full min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:border-[#9a6f16] focus:ring-2 focus:ring-[#9a6f16]/15" />
              {erpCfg?.webhook.configured && erpCfg.webhook.source === 'attached' && <button onClick={() => clearErpField('webhook')} disabled={erpBusy} className="mt-1 text-[10px] text-gray-400 hover:text-red-500 underline disabled:opacity-50">Remove webhook URL</button>}
            </div>
            <div className="min-w-0">
              <input value={erpTokenInput} onChange={(e) => setErpTokenInput(e.target.value)} type="password" autoComplete="new-password" placeholder={erpCfg?.token.configured ? `Token is set${erpCfg.token.source === 'env' ? ' in the server environment' : ''} (••••) — leave blank to keep` : 'ERP API token (optional)'} className="w-full min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:border-[#9a6f16] focus:ring-2 focus:ring-[#9a6f16]/15" />
              {erpCfg?.token.configured && erpCfg.token.source === 'attached' && <button onClick={() => clearErpField('token')} disabled={erpBusy} className="mt-1 text-[10px] text-gray-400 hover:text-red-500 underline disabled:opacity-50">Remove token</button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={saveErpSettings} disabled={erpBusy} className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors"><FloppyDisk size={13} /> Save settings</button>
            <button onClick={() => pushToErp(true)} disabled={erpBusy} className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors">{erpBusy ? <ArrowClockwise size={13} className="animate-spin" /> : <Shuffle size={13} />}{erpBusy ? 'Working…' : 'Test'}</button>
            <button onClick={() => pushToErp(false)} disabled={erpBusy} className="btn-glow inline-flex items-center gap-1.5 px-3 py-2 bg-[#1b1f27] hover:bg-[#2b3140] text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors"><CloudArrowUp size={13} /> Push orders</button>
          </div>

          {/* Failed ERP syncs — compact red error card; stacks on small screens */}
          {failedErpSyncs.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/50 overflow-hidden">
              <div className="px-3 py-2 bg-red-50 border-b border-red-100 flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5"><Warning size={13} /> {failedErpSyncs.length} failed ERP sync{failedErpSyncs.length !== 1 ? 's' : ''}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => pushToErp(false, failedErpSyncs.map(([n]) => n))} disabled={erpBusy} className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-semibold disabled:opacity-50 flex items-center gap-1"><ArrowClockwise size={11} /> Retry all</button>
                  <button onClick={clearFailedErp} disabled={erpBusy} className="px-2.5 py-1 border border-red-300 text-red-600 rounded-lg text-[10px] font-semibold hover:bg-red-100 disabled:opacity-50">Clear all errors</button>
                </div>
              </div>
              <div className="divide-y divide-red-100/70">
                {failedErpSyncs.map(([orderNumber, e]) => (
                  <div key={orderNumber} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                    <p className="font-mono text-[11px] font-semibold text-gray-800 shrink-0">{orderNumber}</p>
                    <p className="text-[10px] text-red-600/90 break-words min-w-0 flex-1" title={e.error || ''}>{e.error || 'ERP sync failed'}</p>
                    <span className="text-[9px] text-gray-400 shrink-0">{e.synced_at ? new Date(e.synced_at).toLocaleString() : ''}</span>
                    <button onClick={() => pushToErp(false, [orderNumber])} disabled={erpBusy} className="self-start sm:self-auto px-2.5 py-1 bg-white border border-red-300 text-red-600 hover:bg-red-100 rounded-lg text-[10px] font-semibold disabled:opacity-50 flex items-center gap-1"><ArrowClockwise size={11} /> Retry</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full ERP sync history — every attempt (created/updated/failed) with timestamps */}
          {erpCfg?.syncLog?.length ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <button onClick={() => setShowErpLog(!showErpLog)} className="text-xs font-semibold text-gray-800 flex items-center gap-1.5 hover:text-gray-950">
                  <Clock size={13} className="text-[#9a6f16]" /> Sync history ({erpCfg.syncLog.length}) {showErpLog ? <CaretUp size={12} /> : <CaretDown size={12} />}
                </button>
                <div className="flex gap-1.5 text-[10px]">
                  {(() => {
                    const c = erpCfg.syncLog!.filter(e => e.status === 'created').length;
                    const u = erpCfg.syncLog!.filter(e => e.status === 'updated' || e.status === 'sent').length;
                    const f = erpCfg.syncLog!.filter(e => e.status === 'failed').length;
                    return (<>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">{c} created</span>
                      <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">{u} updated</span>
                      <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-semibold">{f} failed</span>
                    </>);
                  })()}
                </div>
              </div>
              {showErpLog && (
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100/80">
                  {erpCfg.syncLog.slice(0, 300).map((e, i) => (
                    <div key={i} className="px-3 py-1.5 flex items-start gap-2 min-w-0">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${e.status === 'created' ? 'bg-emerald-100 text-emerald-700' : e.status === 'updated' || e.status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'}`}>{e.status}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] font-semibold text-gray-800 break-words">{e.order_number}</p>
                        {e.error && <p className="text-[9px] text-red-500/90 break-words" title={e.error}>{e.error}</p>}
                      </div>
                      <span className="text-[9px] text-gray-400 shrink-0">{e.at ? new Date(e.at).toLocaleString() : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {erpResult && (
            <p className={`text-[11px] break-words ${erpResult.ok ? 'text-green-700' : 'text-red-600'}`}>{erpResult.ok ? '✓ ' : '✗ '}{erpResult.msg}</p>
          )}
          <p className="text-[10px] text-gray-400">Only genuine Stripe-webhook orders are pushed — the demo LX-1001 order and $0 gift-drop claims are never sent. Every order keeps its original order number, so re-pushing reconciles in the ERP instead of duplicating.</p>
        </div>
      </div>

    {/* Demo banner */}
    {showDemo && (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-800 flex items-center gap-2">
        <Lightning size={14} /> Demo order (LX-1001) shown below so you can preview the tracking + label UI — it is NOT a real sale. Hide it any time, and it never appears on the storefront.
      </div>
    )}

{/* Orders table — responsive: full table on desktop (container scrolls on tablet), stacked cards on mobile */}
    <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-emerald-100">
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm text-gray-800">Orders <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full ml-1">AUTHORITATIVE</span></h2>
          <p className="text-[11px] text-gray-400">Real records from the Stripe webhook + gift drops. Filter by provider or type.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white font-medium text-gray-600">
            <option value="all">All providers</option>
            <option value="none">🎁 Free Gift</option>
            <option value="stripe">Stripe</option>
            <option value="square">Square</option>
            <option value="paypal">PayPal</option>
            <option value="braintree">Braintree</option>
            <option value="authorize_net">Authorize.Net</option>
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
            <input type="checkbox" checked={includeGifts} onChange={(e) => setIncludeGifts(e.target.checked)} className="w-3.5 h-3.5 rounded" />
            Include gifts
          </label>
        </div>
      </div>
      {!loaded ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">Loading orders…</div>
      ) : visibleOrders.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-gray-500 mb-1">No orders yet</p>
          <p className="text-xs text-gray-400">Completed Stripe payments will appear here automatically. A demo order is hidden — press "Show demo" to preview the UI.</p>
        </div>
      ) : (
        <>
          {/* Desktop table (md+) — the table container scrolls on tablet; the page never overflows */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr>
                <th className="px-6 py-3 w-[190px]">Order</th>
                <th className="px-6 py-3 w-[200px]">Customer</th>
                <th className="px-6 py-3 w-[80px]">Items</th>
                <th className="px-6 py-3 w-[90px]">Total</th>
                <th className="px-6 py-3 w-[140px]">Status</th>
                <th className="px-6 py-3 w-[160px]">Tracking</th>
                <th className="px-6 py-3">Actions</th>
              </tr></thead>
              <tbody>{visibleOrders.map(({ order: o, isDemo, tr }) => (
                <Fragment key={o.id}>
                  <tr className={`border-t hover:bg-gray-50 cursor-pointer ${isDemo ? 'bg-amber-50/40' : ''}`} onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                    <td className="px-6 py-3 align-top">
                      <p className="font-mono text-xs font-semibold text-gray-800">{o.order_number}</p>
                      <div className="mt-1">{orderBadges(o, isDemo)}</div>
                      <p className="text-[10px] text-gray-400 mt-1">{new Date(o.created_at).toLocaleString()}</p>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-600 align-top break-words">{o.customer_email || '—'}</td>
                    <td className="px-6 py-3 text-xs text-gray-500 align-top">{fmtItems(o.items).length} item(s)</td>
                    <td className="px-6 py-3 font-semibold align-top">${Number(o.total || 0).toFixed(2)}</td>
                    <td className="px-6 py-3 align-top">
                      <select value={String(o.status || '')} onChange={(e) => { const s = e.target.value; if (isDemo) return; setStripeOrders(prev => prev.map(x => x.id === o.id ? { ...x, status: s } : x)); notify(`Order ${o.order_number} → ${s}`); }} className={`text-xs font-semibold px-2 py-1 rounded-full border-0 capitalize cursor-pointer max-w-full ${statusColor(String(o.status || ''))}`}>
                        {['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-6 py-3 align-top">
                      {tr && tr.number ? (
                        <div className="flex items-center gap-1.5 min-w-0"><Truck size={13} className="text-blue-500 shrink-0" /><div className="min-w-0"><p className="font-mono text-[10px] text-gray-700 truncate">{tr.number}</p><p className="text-[9px] text-gray-400 uppercase">{tr.carrier}</p></div></div>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-3 align-top">{orderActions(o)}</td>
                  </tr>
                  {expanded === o.id && (
                    <tr id={`order-detail-${o.id}`} className="border-t bg-gray-50/60">
                      <td colSpan={7} className="px-6 py-5">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] uppercase tracking-wider text-gray-400">Order detail — {o.order_number}</p>
                          <button onClick={() => setInvoiceOrder(o)} className="btn-glow px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1.5"><Receipt size={13} /> Maximize — Full Invoice</button>
                        </div>
                        {orderDetail(o, isDemo, tr)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </div>

          {/* Mobile stacked cards (< md) — order number/status top, customer/items/total middle, tracking + actions bottom */}
          <div className="md:hidden divide-y divide-gray-100">
            {visibleOrders.map(({ order: o, isDemo, tr }) => (
              <div key={o.id} className={`p-4 ${isDemo ? 'bg-amber-50/40' : ''}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-gray-800">{o.order_number}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{new Date(o.created_at).toLocaleString()}</p>
                  </div>
                  <div className="shrink-0">{orderBadges(o, isDemo)}</div>
                </div>
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-2"><span className="text-gray-400 shrink-0">Customer</span><span className="text-gray-700 text-right break-words min-w-0">{o.customer_email || '—'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Items</span><span className="text-gray-700">{fmtItems(o.items).length} item(s)</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Total</span><span className="font-semibold text-gray-900">${Number(o.total || 0).toFixed(2)}</span></div>
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
                    <span className="text-gray-400 shrink-0">Status</span>
                    <select value={String(o.status || '')} onChange={(e) => { const s = e.target.value; if (isDemo) return; setStripeOrders(prev => prev.map(x => x.id === o.id ? { ...x, status: s } : x)); notify(`Order ${o.order_number} → ${s}`); }} className={`text-xs font-semibold px-2 py-1 rounded-full border-0 capitalize cursor-pointer max-w-full ${statusColor(String(o.status || ''))}`}>
                      {['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-400 shrink-0">Tracking</span>
                    {tr && tr.number ? (
                      <span className="flex items-center gap-1 min-w-0"><Truck size={12} className="text-blue-500 shrink-0" /><span className="font-mono text-[10px] text-gray-700 truncate">{tr.number}</span></span>
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </div>
                </div>
                <div className="mt-3">{orderActions(o)}</div>
                {expanded === o.id && (
                  <div id={`order-detail-${o.id}`} className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                    {orderDetail(o, isDemo, tr)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>

    {/* Invoice modal — complete invoice with tax + shipping + download */}
    <Modal open={!!invoiceOrder} onClose={() => setInvoiceOrder(null)} title={`Invoice ${invoiceOrder?.order_number || ''}`}>
      {invoiceOrder && (() => {
        const o = invoiceOrder;
        const t = totalsOf(o);
        const ex = extrasFor(o);
        const addr = (o as { shipping_address?: { name?: string; line1?: string; city?: string; state?: string; zip?: string } | null }).shipping_address;
        return (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 p-5 bg-white text-sm" id="luxedge-invoice">
              <div className="flex items-start justify-between border-b-2 border-blue-800 pb-3">
                <div>
                  <p className="text-lg font-bold text-gray-900">LUXEDGE</p>
                  <p className="text-[11px] text-gray-400">Luxedge.us · Houston, TX · hello@luxedge.us</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{o.order_number}</p>
                  <p className="text-[11px] text-gray-400">{new Date(o.created_at).toLocaleString()}</p>
                  <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColor(String(o.status || ''))}`}>{o.status}</span>
                </div>
              </div>
              <div className="py-3 text-xs text-gray-600">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Bill To</p>
                <p className="font-medium text-gray-800">{o.customer_email || '—'}</p>
                <p className="text-gray-400">{addr ? `${addr.line1 || ''}, ${addr.city || ''} ${addr.state || ''} ${addr.zip || ''}` : 'Address not recorded'}</p>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-50 text-left text-[10px] uppercase text-gray-500"><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-center">Qty</th><th className="px-3 py-2 text-right">Unit</th><th className="px-3 py-2 text-right">Line Total</th></tr></thead>
                <tbody>
                  {fmtItems(o.items).map((it, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-3 py-2">{it.name}</td>
                      <td className="px-3 py-2 text-center">{it.qty}</td>
                      <td className="px-3 py-2 text-right">${it.price.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-medium">${(it.qty * it.price).toFixed(2)}</td>
                    </tr>
                  ))}
                  {fmtItems(o.items).length === 0 && <tr><td colSpan={4} className="px-3 py-2 text-gray-400">No line items recorded.</td></tr>}
                </tbody>
              </table>
              <div className="mt-3 flex justify-end">
                <div className="w-64 space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${t.subtotal.toFixed(2)}</span></div>
                  <div className="flex justify-between items-center"><span className="text-gray-500">Shipping ($)</span>
                    <input type="number" min={0} step="0.01" value={Math.round(ex.shipping * 100) / 100} onChange={(e) => saveExtras(o.id, { ...ex, shipping: Math.round((Number(e.target.value) || 0) * 100) / 100 })} className="w-20 text-right border border-gray-200 rounded px-1.5 py-0.5" /></div>
                  <div className="flex justify-between items-center"><span className="text-gray-500">Tax rate (%)</span>
                    <input type="number" min={0} step="0.01" value={Math.round(ex.taxRate * 100) / 100} onChange={(e) => saveExtras(o.id, { ...ex, taxRate: Math.round((Number(e.target.value) || 0) * 100) / 100 })} className="w-20 text-right border border-gray-200 rounded px-1.5 py-0.5" /></div>
                  <div className="flex justify-between items-center"><span className="text-gray-500">Discount ($)</span>
                    <input type="number" min={0} step="0.01" value={Math.round(ex.discount * 100) / 100} onChange={(e) => saveExtras(o.id, { ...ex, discount: Math.round((Number(e.target.value) || 0) * 100) / 100 })} className="w-20 text-right border border-gray-200 rounded px-1.5 py-0.5" /></div>
                  {t.tax > 0 && <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>${t.tax.toFixed(2)}</span></div>}
                  <div className="flex justify-between font-bold border-t border-gray-200 pt-1.5 text-sm"><span>Total</span><span>${t.grand.toFixed(2)}</span></div>
                  {Number(o.total || 0) > 0 && Math.abs(t.grand - Number(o.total || 0)) > 0.01 && (
                    <p className="text-[10px] text-amber-600 pt-1">Stripe-recorded total: ${Number(o.total).toFixed(2)} — update shipping/tax to reconcile.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => downloadInvoice(o)} className="btn-glow flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2"><Download size={15} /> Download Invoice (PDF)</button>
              <button onClick={() => setInvoiceOrder(null)} className="px-6 py-2.5 border border-gray-200 rounded-lg text-sm">Close</button>
            </div>
            <p className="text-[10px] text-gray-400 text-center">Shipping / tax / discount are admin-recorded per order. Download opens a clean printable invoice — choose “Save as PDF” in the print dialog. CSV export (Excel) is on the Orders page.</p>
          </div>
        );
      })()}
    </Modal>

    {/* Shipping label modal */}
    <Modal open={!!labelOrder} onClose={() => setLabelOrder(null)} title={`Shipping Label — ${labelOrder?.order_number || ''}`}>
      {labelOrder && (
        <div className="space-y-4">
          <div className="border border-gray-300 rounded-xl p-5 bg-white text-sm">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-3">
              <p className="font-bold text-gray-900 text-base">LUXEDGE</p>
              <span className="text-[10px] text-gray-400">USPS PRIORITY · PREVIEW</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">From</p>
                <p className="text-xs font-medium text-gray-800">Luxedge Fulfillment<br />Houston, TX 77001<br />US</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Ship To</p>
                <p className="text-xs font-medium text-gray-800">{labelOrder.customer_email || 'Customer'}<br />{((labelOrder as { shipping_address?: { line1?: string; city?: string; state?: string; zip?: string } }).shipping_address?.line1) || '123 Main St'}<br />{((labelOrder as { shipping_address?: { city?: string; state?: string; zip?: string } }).shipping_address?.city) || 'Austin'}, {((labelOrder as { shipping_address?: { state?: string; zip?: string } }).shipping_address?.state) || 'TX'} {((labelOrder as { shipping_address?: { zip?: string } }).shipping_address?.zip) || '78701'}<br />US</p>
              </div>
            </div>
            <div className="mt-4 border-t border-dashed border-gray-300 pt-3">
              <div className="flex items-center justify-center gap-2 text-gray-700">
                <Barcode size={60} />
                <div className="font-mono text-[10px] text-gray-400">{(tracking[labelOrder.id] || demoTracking).number || 'TRACKING-PENDING'}</div>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { window.print(); }} className="btn-glow flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2"><Printer size={15} /> Print Label</button>
            <button onClick={() => setLabelOrder(null)} className="px-6 py-2.5 border border-gray-200 rounded-lg text-sm">Close</button>
          </div>
          <p className="text-[10px] text-gray-400 text-center">Preview label — connect a shipping carrier (e.g. ShipStation, Shippo) to generate real, paid labels.</p>
        </div>
      )}
    </Modal>
  </div>
  );
}

function AUsers() {
  const { users, setUsers, notify } = useApp();
  const [delId, setDelId] = useState<string | null>(null);
  const toggleBlock = (id: string) => { setUsers(prev => prev.map(u => u.id === id ? { ...u, isBlocked: !u.isBlocked } : u)); notify('User updated!'); };
  const del = () => { if (delId) { setUsers(prev => prev.filter(u => u.id !== delId)); notify('User deleted!'); setDelId(null); } };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Users</h1>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{users.map(u => <div key={u.id} className={`bg-white rounded-xl border p-5 ${u.isBlocked ? 'border-red-200 bg-red-50/30' : ''}`}>
      <div className="flex items-center gap-3 mb-4"><div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${u.isBlocked ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{u.name[0]}</div><div><p className="font-semibold">{u.name}</p><p className="text-xs text-gray-500">{u.email}</p></div>{u.isBlocked && <span className="ml-auto text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">Blocked</span>}</div>
      {u.joined && <p className="text-xs text-gray-400 mb-4">Joined: {u.joined}</p>}
      <div className="flex gap-2"><button onClick={() => toggleBlock(u.id)} className={`flex-1 py-2 rounded-lg text-xs font-medium ${u.isBlocked ? 'bg-green-50 text-green-600' : 'bg-sky-50 text-blue-600'}`}>{u.isBlocked ? 'Unblock' : 'Block'}</button><button onClick={() => setDelId(u.id)} className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium">Delete</button></div>
    </div>)}</div>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete User"><p className="text-gray-600 mb-6">Delete this user?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

function ACategories() {
  const { categories, setCategories, notify } = useApp();
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState<AdminCategory | null>(null);
  const [form, setForm] = useState({ name: '', isActive: true, parentId: '' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [delId, setDelId] = useState<string | null>(null);
  const [subModal, setSubModal] = useState<string | null>(null);
  const [subName, setSubName] = useState('');
  const [busy, setBusy] = useState(false);

  // Categories live in Supabase (the Add Product dropdown reads the same
  // table) — never only in memory. Reload from the DB on mount.
  const reload = useCallback(async () => {
    try {
      const cs = await listCategories();
      setCategories(cs.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, subs: [] })));
    } catch (e) {
      notify(`Could not load categories: ${(e as Error).message}`, 'error');
    }
  }, [setCategories, notify]);
  useEffect(() => { void reload(); }, [reload]);

  const toggle = (id: string) => { const n = new Set(expanded); n.has(id) ? n.delete(id) : n.add(id); setExpanded(n); };
  const openAdd = () => { setEdit(null); setForm({ name: '', isActive: true, parentId: '' }); setModal(true); };
  const openEdit = (c: AdminCategory) => { setEdit(c); setForm({ name: c.name, isActive: c.isActive, parentId: '' }); setModal(true); };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      if (edit) {
        await updateCategory(edit.id, { name: form.name, isActive: form.isActive });
        notify('Category updated!');
      } else {
        await createCategory({ name: form.name, isActive: form.isActive });
        notify('Category added!');
      }
      await reload();
      setModal(false);
    } catch (err) {
      notify(`Could not save category: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!delId) return;
    setBusy(true);
    try {
      await deleteCategory(delId);
      await reload();
      notify('Category deleted!');
      setDelId(null);
    } catch (err) {
      notify(`Could not delete category: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggleStatus = async (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    try {
      await updateCategory(id, { isActive: !c.isActive });
      await reload();
      notify('Status updated!');
    } catch (err) {
      notify(`Could not update category: ${(err as Error).message}`, 'error');
    }
  };
  const addSub = (e: React.FormEvent) => { e.preventDefault(); if (subModal && subName) { setCategories(prev => prev.map(c => c.id === subModal ? { ...c, subs: [...c.subs, { id: `s${Date.now()}`, name: subName, isActive: true }] } : c)); setSubName(''); setSubModal(null); notify('Subcategory added!'); } };
  const delSub = (catId: string, subId: string) => { setCategories(prev => prev.map(c => c.id === catId ? { ...c, subs: c.subs.filter(s => s.id !== subId) } : c)); notify('Subcategory deleted!'); };
  const toggleSub = (catId: string, subId: string) => { setCategories(prev => prev.map(c => c.id === catId ? { ...c, subs: c.subs.map(s => s.id === subId ? { ...s, isActive: !s.isActive } : s) } : c)); notify('Updated!'); };

  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Categories</h1><button onClick={openAdd} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus size={16} />Add Category</button></div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold">{categories.length}</p><p className="text-sm text-gray-500">Main Categories</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold">{categories.reduce((s, c) => s + c.subs.length, 0)}</p><p className="text-sm text-gray-500">Subcategories</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold text-green-600">{categories.filter(c => c.isActive).length}</p><p className="text-sm text-gray-500">Active</p></div>
      <div className="bg-white rounded-xl border p-4"><p className="text-2xl font-bold text-gray-400">{categories.filter(c => !c.isActive).length}</p><p className="text-sm text-gray-500">Inactive</p></div>
    </div>
    <div className="bg-white rounded-xl shadow-sm">
      {categories.map(c => <div key={c.id}>
        <div className="flex items-center gap-3 p-4 border-b hover:bg-gray-50">
          <button onClick={() => toggle(c.id)} className="p-1">{c.subs.length > 0 ? (expanded.has(c.id) ? <CaretDown size={16} /> : <CaretRight size={16} className="text-gray-400" />) : <span className="w-4" />}</button>
          <TreeStructure size={18} className={c.isActive ? 'text-blue-500' : 'text-gray-400'} />
          <div className="flex-1"><p className={`font-medium ${c.isActive ? '' : 'text-gray-400'}`}>{c.name}</p>{c.subs.length > 0 && <p className="text-xs text-gray-500">{c.subs.length} sub</p>}</div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.isActive ? 'Active' : 'Inactive'}</span>
          <button onClick={() => setSubModal(c.id)} className="p-2 hover:bg-blue-50 rounded text-blue-600" title="Add Sub"><Plus size={16} /></button>
          <button onClick={() => toggleStatus(c.id)} className="p-2 hover:bg-gray-100 rounded">{c.isActive ? <ToggleRight size={20} className="text-green-500" /> : <ToggleLeft size={20} className="text-gray-400" />}</button>
          <button onClick={() => openEdit(c)} className="p-2 hover:bg-blue-50 rounded text-blue-600"><PencilSimple size={16} /></button>
          <button onClick={() => setDelId(c.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash size={16} /></button>
        </div>
        {expanded.has(c.id) && c.subs.map(s => <div key={s.id} className="flex items-center gap-3 p-3 pl-14 border-b bg-gray-50/50">
          <span className="text-gray-400">└</span><p className={`flex-1 text-sm ${s.isActive ? '' : 'text-gray-400'}`}>{s.name}</p>
          <button onClick={() => toggleSub(c.id, s.id)} className="p-1">{s.isActive ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} className="text-gray-400" />}</button>
          <button onClick={() => delSub(c.id, s.id)} className="p-1 text-red-500"><Trash size={14} /></button>
        </div>)}
      </div>)}
    </div>
    <Modal open={modal} onClose={() => setModal(false)} title={edit ? 'Edit Category' : 'Add Category'}>
      <form onSubmit={save} className="space-y-4"><input required placeholder="Category Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 border rounded-lg" /><label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />Active</label><div className="flex gap-3"><button type="submit" disabled={busy} className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium disabled:opacity-50">{busy ? 'Saving…' : (edit ? 'Save' : 'Add')}</button><button type="button" onClick={() => setModal(false)} className="px-6 py-2.5 border rounded-lg">Cancel</button></div></form>
    </Modal>
    <Modal open={!!subModal} onClose={() => setSubModal(null)} title="Add Subcategory">
      <form onSubmit={addSub} className="space-y-4"><input required placeholder="Subcategory Name" value={subName} onChange={e => setSubName(e.target.value)} className="w-full px-4 py-2.5 border rounded-lg" /><div className="flex gap-3"><button type="submit" className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium">Add</button><button type="button" onClick={() => setSubModal(null)} className="px-6 py-2.5 border rounded-lg">Cancel</button></div></form>
    </Modal>
    <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete Category"><p className="text-gray-600 mb-6">Delete this category and all subcategories?</p><div className="flex gap-3"><button onClick={del} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg">Delete</button><button onClick={() => setDelId(null)} className="flex-1 py-2.5 border rounded-lg">Cancel</button></div></Modal>
  </div>;
}

function AReviews() {
  const { reviews, setReviews, notify } = useApp();
  const approve = (id: string) => { setReviews(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r)); notify('Review approved!'); };
  const reject = (id: string) => { setReviews(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r)); notify('Review rejected!'); };
  const del = (id: string) => { setReviews(prev => prev.filter(r => r.id !== id)); notify('Review deleted!'); };
  const sColor: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">Reviews</h1>
    {reviews.length === 0 ? <div className="bg-white rounded-xl border p-12 text-center text-gray-500">No reviews yet</div> :
    <div className="space-y-4">{reviews.map(r => <div key={r.id} className={`bg-white rounded-xl border p-5 ${r.status === 'pending' ? 'border-yellow-200' : ''}`}>
      <div className="flex items-start justify-between mb-3"><div><p className="font-semibold">{r.userName}</p><p className="text-xs text-gray-500">on <span className="text-blue-600">{r.productName}</span></p></div><span className={`text-xs px-3 py-1 rounded-full font-medium capitalize ${sColor[r.status]}`}>{r.status}</span></div>
      <div className="flex gap-0.5 mb-2">{[...Array(5)].map((_, i) => <Star key={i} size={14} className={i < r.rating ? 'text-sky-400 fill-sky-400' : 'text-gray-200'} />)}</div>
      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg mb-4">{r.comment}</p>
      <div className="flex gap-2">{r.status === 'pending' && <><button onClick={() => approve(r.id)} className="px-4 py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100">✓ Approve</button><button onClick={() => reject(r.id)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100">✕ Reject</button></>}<button onClick={() => del(r.id)} className="px-4 py-2 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 ml-auto">Delete</button></div>
    </div>)}</div>}
  </div>;
}

// Defined at MODULE scope (not inside ASettings). Previously these lived inside
// the component, so every keystroke recreated them as brand-new component types —
// React then unmounted/remounted each input and stole focus after every character,
// which made it feel like the API keys "wouldn't save".
const SETTINGS_INPUT = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const SETTINGS_LABEL = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

// NOTE: Secret-field inputs (scrape.do, OpenAI, Supabase, Stripe, Google keys)
// were removed in Luxedge V2. Keys now live server-side only (see .env.example
// and /api/ai/*). Public config (Supabase URL/anon key, Stripe publishable key,
// Google OAuth client id) belongs in src/store/settingsStore.ts.

function Accordion({ id, title, icon, borderClass, children, open, toggle }: {
  id: string; title: string; icon: React.ReactNode; borderClass?: string; children: React.ReactNode;
  open: Record<string, boolean>; toggle: (k: string) => void;
}) {
  return (
    <div className={`bg-white rounded-xl border ${borderClass || ''}`}>
      <button type="button" onClick={() => toggle(id)} className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 rounded-xl transition-colors">
        <span className="font-semibold flex items-center gap-2">{icon}{title}</span>
        {open[id] ? <CaretUp size={18} className="text-gray-400" /> : <CaretDown size={18} className="text-gray-400" />}
      </button>
      {open[id] && <div className="px-5 pb-6 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function ASettings() {
  const { user, changePassword, updateAdminProfile, notify } = useApp();
  const navigate = useNavigate();
  const L = SETTINGS_LABEL;
  const I = SETTINGS_INPUT;

    const [envStatus, setEnvStatus] = useState<ProviderStatusMap | null>(null);
  useEffect(() => {
    serverProviderStatus().then(setEnvStatus).catch(() => setEnvStatus({ backend: 'missing', providers: [] }));
  }, []);

  // AdSense & ads.txt — read the live site config (same source as Marketing & Traffic).
  const [cfg, setCfg] = useState<MarketingConfig>(() => JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  const [adsTxtStatus, setAdsTxtStatus] = useState<'checking' | 'configured' | 'missing' | 'invalid'>('checking');
  useEffect(() => {
    fetchGlobalConfig().then(g => { setCfg(JSON.parse(JSON.stringify(g))); }).catch(() => {});
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/ads.txt');
        if (!r.ok) { setAdsTxtStatus('missing'); return; }
        const txt = (await r.text()).trim();
        const expected = (cfg.adsTxtRecord || DEFAULT_CONFIG.adsTxtRecord).trim();
        if (txt === expected) setAdsTxtStatus('configured');
        else if (txt.includes('pub-')) setAdsTxtStatus('invalid');
        else setAdsTxtStatus('missing');
      } catch { setAdsTxtStatus('missing'); }
    })();
  }, [cfg.adsTxtRecord]);
  const adsenseOk = cfg.adsenseEnabled && CLIENT_ID_RE.test(cfg.adsenseClientId.trim());
  const copyAdsTxt = async () => {
    try { await navigator.clipboard.writeText(cfg.adsTxtRecord); notify('ads.txt entry copied'); }
    catch { notify('Copy failed — select the text manually', 'error'); }
  };

const [open, setOpen] = useState<Record<string, boolean>>({ ai: false, pricing: false, api: true, store: false, profile: false, password: false, adsense: true, integrations: false });
  const toggle = (k: string) => setOpen(s => ({ ...s, [k]: !s[k] }));

  const [pricingRules, setPricingRules] = useState(loadPricingRules());
  const [providerSettings, setProviderSettings] = useState(loadProviderSettings());
  const allProviders = loadAIProviders();

  const [profName, setProfName] = useState(user?.name || '');
  const [profEmail, setProfEmail] = useState(user?.email || '');

  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confPass, setConfPass] = useState('');
  const [passError, setPassError] = useState('');
  const [passOk, setPassOk] = useState(false);

  const handleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profName.trim() || !profEmail.trim()) { notify('Name and email required'); return; }
    await updateAdminProfile(profName.trim(), profEmail.trim());
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(''); setPassOk(false);
    if (newPass !== confPass) { setPassError('New passwords do not match'); return; }
    if (newPass.length < 6) { setPassError('Password must be at least 6 characters'); return; }
    if (curPass === newPass) { setPassError('New password must differ from current'); return; }
    const result = await changePassword(curPass, newPass);
    if (result.ok) {
      setPassOk(true);
      setCurPass(''); setNewPass(''); setConfPass('');
      notify(result.msg);
      setTimeout(() => setPassOk(false), 5000);
    } else { setPassError(result.msg); }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">GearSix</h1>

      {/* ── AI Providers ── */}
      <Accordion id="ai" title="AI Providers" icon={<Robot size={18} className="text-purple-600" />} borderClass="border-purple-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-4">
          <p className="text-sm text-gray-500">Choose which provider runs AI product listing work first, and which one the system fails over to when the first fails. API keys are managed server-side only.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={L}>Default provider</label>
              <select value={providerSettings.defaultProviderId} onChange={e => setProviderSettings(s => ({ ...s, defaultProviderId: e.target.value }))} className={I}>
                {allProviders.filter(p => p.enabled).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={L}>Fallback provider</label>
              <select value={providerSettings.fallbackProviderId || ''} onChange={e => setProviderSettings(s => ({ ...s, fallbackProviderId: e.target.value || null }))} className={I}>
                <option value="">None</option>
                {allProviders.filter(p => p.enabled && p.id !== providerSettings.defaultProviderId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400">Recommended: DeepSeek (deepseek-v4-flash) for fast research + Codex for complex reasoning/fallback. Neither provider key is ever stored or shown in the browser.</p>
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => { saveProviderSettings(providerSettings); notify('Provider routing saved.'); }}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <FloppyDisk size={16} /> Save routing
            </button>
            <button type="button" onClick={() => navigate('/admin/ai')}
              className="px-5 py-2.5 border border-purple-300 text-purple-700 hover:bg-purple-50 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Robot size={16} /> Open AI Hub (keys + test)
            </button>
          </div>
        </div>
      </Accordion>

      {/* ── Pricing Rules ── */}
      <Accordion id="pricing" title="Pricing Rules" icon={<CurrencyDollar size={18} className="text-emerald-600" />} borderClass="border-emerald-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-4">
          <p className="text-sm text-gray-500">Determines the suggested selling price for AI-imported products. Prices below the minimum margin are flagged for manual approval — never auto-published.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className={L}>Payment fee %</label>
              <input type="number" step="0.1" min="0" max="99" value={Math.round(pricingRules.paymentFeeRate * 1000) / 10}
                onChange={e => setPricingRules(r => ({ ...r, paymentFeeRate: Number(e.target.value) / 100 }))} className={I} />
            </div>
            <div>
              <label className={L}>Desired margin %</label>
              <input type="number" step="1" min="0" max="99" value={Math.round(pricingRules.desiredMarginRate * 100)}
                onChange={e => setPricingRules(r => ({ ...r, desiredMarginRate: Number(e.target.value) / 100 }))} className={I} />
            </div>
            <div>
              <label className={L}>Min margin %</label>
              <input type="number" step="1" min="0" max="99" value={Math.round(pricingRules.minMarginRate * 100)}
                onChange={e => setPricingRules(r => ({ ...r, minMarginRate: Number(e.target.value) / 100 }))} className={I} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={pricingRules.psychologicalPricing} onChange={e => setPricingRules(r => ({ ...r, psychologicalPricing: e.target.checked }))} />
            Psychological pricing (round to .99)
          </label>
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 space-y-1">
            <p className="font-semibold">Example — supplier $10.00 + shipping $5.00:</p>
            {(() => { const ex = computePricing(10, 5, pricingRules); return ex.suggestedPrice === null
              ? <p>Landed cost ${ex.landedCost?.toFixed(2) ?? '—'} — pricing UNKNOWN (adjust rules so fee + margin &lt; 100%).</p>
              : <p>Landed ${ex.landedCost?.toFixed(2)} → Suggested ${ex.suggestedPrice.toFixed(2)} · profit ${ex.grossProfit?.toFixed(2)} · margin {ex.grossMarginRate === null ? '—' : `${(ex.grossMarginRate * 100).toFixed(0)}%`}{ex.belowMinMargin ? ' · ⚠ below minimum margin' : ''}</p>; })()}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => { savePricingRules(pricingRules); notify('Pricing rules saved.'); }}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <FloppyDisk size={16} /> Save pricing rules
            </button>
            <button type="button" onClick={() => { setPricingRules({ ...DEFAULT_PRICING_RULES }); savePricingRules({ ...DEFAULT_PRICING_RULES }); notify('Pricing rules reset to defaults.'); }}
              className="px-5 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-semibold transition-colors">
              Reset to defaults
            </button>
          </div>
        </div>
      </Accordion>

      {/* ── API Keys ── */}
      <Accordion id="api" title="API Keys — Server-Side" icon={<Globe size={18} className="text-green-600" />} borderClass="border-green-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-4">
          <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800">
            <p className="font-semibold mb-1">🔒 Luxedge V2: keys live on the server, never in the browser</p>
            <p>AI provider keys and scraping tokens are read from environment variables by the /api serverless functions. They are never stored in localStorage, never shipped in the bundle, and never logged.</p>
          </div>
          <p className="text-sm text-gray-500">Set these env vars in your hosting dashboard (Vercel → Project → GearSix → Environment Variables) and redeploy. Variable names: <code className="font-mono text-xs">OPENAI_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, SCRAPE_DO_TOKEN</code> — see <code className="font-mono text-xs">.env.example</code>.</p>
          {envStatus ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Server status</p>
              {envStatus.providers.map(p => (
                <div key={p.id} className={"flex items-center justify-between p-3 rounded-xl border " + (p.configured ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50')}>
                  <span className="text-sm font-medium text-gray-700">{p.name}</span>
                  <span className={"text-xs font-semibold " + (p.configured ? 'text-green-700' : 'text-amber-700')}>
                    {p.configured ? '✓ Configured on server' : 'Not configured'}
                  </span>
                </div>
              ))}
              {!envStatus.providers.length && <p className="text-xs text-gray-400">No providers reported by server.</p>}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Checking server configuration… (requires the /api functions deployed)</p>
          )}
        </div>
      </Accordion>

      {/* ── Store Information ── */}
      <Accordion id="store" title="Store Information" icon={<GearSix size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          <form onSubmit={e => { e.preventDefault(); notify('Store settings saved!'); }} className="grid sm:grid-cols-2 gap-4">
            <div><label className={L}>Store Name</label><input defaultValue="Luxedge" className={I} /></div>
            <div><label className={L}>Contact Email</label><input defaultValue="hello@luxedge.us" className={I} /></div>
            <div><label className={L}>Phone</label><input defaultValue="(440) 941-8002" className={I} /></div>
            <div><label className={L}>Address</label><input defaultValue="1500 N Grant St, Denver, CO 80203" className={I} /></div>
            <div className="sm:col-span-2">
              <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
                <FloppyDisk size={16} />FloppyDisk Store GearSix
              </button>
            </div>
          </form>
        </div>
      </Accordion>

      {/* ── Admin Profile ── */}
      <Accordion id="profile" title="Admin Profile" icon={<UserIcon size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          <form onSubmit={handleProfile} className="space-y-4">
            <div><label className={L}>Name</label><input value={profName} onChange={e => setProfName(e.target.value)} className={I} placeholder="Admin name" /></div>
            <div><label className={L}>Email</label><input type="email" value={profEmail} onChange={e => setProfEmail(e.target.value)} className={I} placeholder="admin email" /></div>
            <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"><FloppyDisk size={16} />FloppyDisk Profile</button>
          </form>
        </div>
      </Accordion>

      {/* ── Change Password ── */}
      <Accordion id="password" title="Change Password" icon={<Lock size={18} className="text-blue-500" />} open={open} toggle={toggle}>
        <div className="pt-5">
          {passOk && <div className="flex items-center gap-2 p-3 mb-4 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm"><CheckCircle size={16} /> Password updated! Use your new password next login.</div>}
          {passError && <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><Warning size={16} /> {passError}</div>}
          <form onSubmit={handlePassword} className="space-y-4">
            <div><label className={L}>Current Password *</label><input type="password" value={curPass} onChange={e => setCurPass(e.target.value)} className={I} placeholder="Enter current password" required /></div>
            <div><label className={L}>New Password *</label><input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className={I} placeholder="Minimum 6 characters" required minLength={6} /></div>
            <div><label className={L}>Confirm New Password *</label><input type="password" value={confPass} onChange={e => setConfPass(e.target.value)} className={I} placeholder="Re-enter new password" required minLength={6} /></div>
            <button type="submit" className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"><Lock size={16} />Update Password</button>
          </form>
        </div>
      </Accordion>

      {/* ── AdSense & ads.txt ── */}
      <Accordion id="adsense" title="Google AdSense & ads.txt" icon={<Megaphone size={18} className="text-blue-500" />} borderClass="border-blue-300" open={open} toggle={toggle}>
        <div className="pt-5 space-y-4">
          <p className="text-sm text-gray-500">AdSense is already configured for this site. ads.txt tells Google who is authorized to sell your ad inventory — it is served at <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">/ads.txt</code>.</p>

          {/* Live status */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/50">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Google AdSense</p>
              <p className="font-semibold text-gray-800">{adsenseOk ? 'Configured' : cfg.adsenseEnabled ? 'Invalid config' : 'Disabled'}</p>
              {cfg.adsenseClientId && <p className="text-xs text-gray-500 mt-1 font-mono">{cfg.adsenseClientId}</p>}
            </div>
            <div className="p-4 rounded-xl border border-green-100 bg-green-50/50">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">ads.txt</p>
              <p className="font-semibold text-gray-800">{adsTxtStatus === 'configured' ? 'Live on site ✓' : adsTxtStatus === 'checking' ? 'Checking…' : adsTxtStatus === 'invalid' ? 'Present but mismatch' : 'Not found on /ads.txt'}</p>
              <button type="button" onClick={copyAdsTxt} className="text-xs text-blue-600 hover:text-blue-800 mt-1 underline">Copy ads.txt line</button>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Current /ads.txt content</p>
            <code className="block text-xs font-mono text-gray-700 whitespace-pre-wrap break-all">{cfg.adsTxtRecord}</code>
          </div>

          <p className="text-xs text-gray-400">AdSense on/off, client ID, auto ads, placements and the ads.txt record are managed in <button type="button" onClick={() => navigate('/admin/marketing-traffic')} className="text-blue-600 hover:text-blue-800 font-medium underline">Marketing &amp; Traffic</button>.</p>
        </div>
      </Accordion>

      {/* Integrations — optional external assistance (Hermes / Salman OS) */}
      <Accordion id="integrations" title="Integrations" icon={<ShareNetwork size={18} className="text-purple-500" />} open={open} toggle={toggle}>
        <div className="pt-5 space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl border border-purple-100 bg-purple-50/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center"><Robot size={20} className="text-purple-600" /></div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Hermes / Salman OS</p>
                <p className="text-xs text-gray-500">Future external research assistance — optional, completely disconnected now.</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-200 text-gray-600">DISCONNECTED · OPTIONAL</span>
          </div>
          <ul className="text-xs text-gray-500 space-y-1 list-disc pl-5">
            <li>Purpose: future external research assistance only.</li>
            <li>Cannot write Luxedge data, control publishing, block the catalog, or access the repository through this feature.</li>
            <li>Connection requires a future owner-approved setup — nothing to configure yet.</li>
          </ul>
        </div>
      </Accordion>
    </div>
  );
}

// ============================================================================
// ENTERPRISE MARKETING GENERATOR
// ============================================================================
type MktTab = 'google'|'meta'|'social'|'email'|'video'|'media'|'vault';
type MktTone = 'luxury'|'urgent'|'friendly'|'professional';
const MKT_TONES: MktTone[] = ['luxury','urgent','friendly','professional'];

interface GoogleAd {
  headlines: string[];
  descriptions: string[];
  displayUrl: string;
  finalUrl: string;
  callouts: string[];
  sitelinks: { title: string; desc: string; url: string }[];
}
interface MetaAd {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  audience: string;
  interests: string[];
}
interface SocialPosts {
  instagram: string;
  hashtags: string[];
  facebook: string;
  twitter: string[];
  linkedin: string;
  pinterest: string;
  tiktokScript: string;
}
interface EmailDraft {
  subjectA: string;
  subjectB: string;
  preheader: string;
  heroHeadline: string;
  body: string;
  ctaText: string;
  urgency: string;
}
interface VideoScript {
  youtubeTitle: string;
  youtubeDesc: string;
  youtubeTags: string[];
  tiktokScript: string;
  reelHook: string;
}
interface MktVaultItem {
  id: string;
  type: string;
  productName: string;
  content: string;
  createdAt: string;
}

const EMPTY_GOOGLE: GoogleAd = { headlines: ['','','','','',''], descriptions: ['',''], displayUrl: '', finalUrl: '', callouts: [], sitelinks: [] };
const EMPTY_META: MetaAd = { primaryText: '', headline: '', description: '', cta: 'Shop Now', audience: '', interests: [] };
const EMPTY_SOCIAL: SocialPosts = { instagram: '', hashtags: [], facebook: '', twitter: [], linkedin: '', pinterest: '', tiktokScript: '' };
const EMPTY_EMAIL: EmailDraft = { subjectA: '', subjectB: '', preheader: '', heroHeadline: '', body: '', ctaText: '', urgency: '' };
const EMPTY_VIDEO: VideoScript = { youtubeTitle: '', youtubeDesc: '', youtubeTags: [], tiktokScript: '', reelHook: '' };

const META_CTA_OPTIONS = ['Shop Now','Learn More','Get Offer','Order Now','Sign Up','Book Now','Contact Us','Download'];

function AMarketingGen() {
  const { products, notify } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState<MktTab>('google');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [aiProvider, setAiProvider] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [tone, setTone] = useState<MktTone>('luxury');
  const [generating, setGenerating] = useState(false);
  const [genSection, setGenSection] = useState('');
  const [googleAd, setGoogleAd] = useState<GoogleAd>(EMPTY_GOOGLE);
  const [metaAd, setMetaAd] = useState<MetaAd>(EMPTY_META);
  const [social, setSocial] = useState<SocialPosts>(EMPTY_SOCIAL);
  const [email, setEmail] = useState<EmailDraft>(EMPTY_EMAIL);
  const [video, setVideo] = useState<VideoScript>(EMPTY_VIDEO);
  const [vault, setVault] = useState<MktVaultItem[]>([]);
  const [copied, setCopied] = useState('');
  const [newInterest, setNewInterest] = useState('');
  const [newCallout, setNewCallout] = useState('');

  // ── Media Studio (real AI image/video generation) ──
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [mediaProvider, setMediaProvider] = useState<'openai' | 'gemini'>('openai');
  const [mediaPrompt, setMediaPrompt] = useState('');
  const [mediaGenerating, setMediaGenerating] = useState(false);
  const [mediaResult, setMediaResult] = useState<{ ok: boolean; msg: string; url?: string } | null>(null);

  const mediaPromptFromProduct = () => {
    const p = selectedProduct;
    if (!p) return '';
    return `Professional product photo of ${p.name}${p.category ? ` (${p.category})` : ''}, luxury e-commerce style, clean studio lighting, soft shadows, high detail, no text overlay`;
  };

  const generateMedia = async () => {
    const prompt = mediaPrompt.trim();
    if (!prompt) { notify('Describe the image/video you want first.'); return; }
    setMediaGenerating(true);
    setMediaResult(null);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ type: mediaType, provider: mediaProvider, prompt }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; url?: string; contentType?: string };
      if (!res.ok || d.ok === false) {
        setMediaResult({ ok: false, msg: d.error || `Generation failed (HTTP ${res.status})` });
        notify(`Generation failed: ${d.error || 'unknown error'}`);
      } else {
        setMediaResult({ ok: true, msg: `${mediaType === 'image' ? 'Image' : 'Video'} ready`, url: d.url });
        notify(`${mediaType === 'image' ? 'Image' : 'Video'} generated and stored`);
      }
    } catch (e: any) {
      setMediaResult({ ok: false, msg: `Generation failed: ${e.message}` });
    } finally {
      setMediaGenerating(false);
    }
  };

  // ── Email sending (test send + CRM leads campaign) ──
  const [sendSubjectChoice, setSendSubjectChoice] = useState<'A' | 'B'>('A');
  const [sendTo, setSendTo] = useState('');
  const [sendTarget, setSendTarget] = useState<'test' | 'leads'>('leads');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const emailSubject = sendSubjectChoice === 'A' ? email.subjectA : email.subjectB;

  /** Build a simple HTML email from the generated draft. */
  const buildEmailHtml = () => {
    const p = selectedProduct;
    const productLine = p
      ? `<p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.6">Featured product: <strong>${p.name}</strong> — $${p.price ?? ''}</p>`
      : '';
    return `
      <div style="background:#f4f4f6;padding:32px 16px">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
          <div style="background:linear-gradient(135deg,#7c3aed,#db2777);padding:32px 24px;text-align:center">
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold">${email.heroHeadline || 'Luxedge'}</p>
          </div>
          <div style="padding:24px">
            <p style="margin:0;color:#374151;font-size:15px;line-height:1.7;white-space:pre-wrap">${(email.body || '').replace(/\n/g, '<br/>')}</p>
            ${productLine}
            ${email.urgency ? `<p style="margin:16px 0 0;color:#2563eb;font-weight:600;font-size:14px">${email.urgency}</p>` : ''}
            <p style="text-align:center;margin:24px 0 0"><a href="https://luxedge.us/shop" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#db2777);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:14px">${email.ctaText || 'Shop Now →'}</a></p>
            <p style="margin:24px 0 0;color:#9ca3af;font-size:11px;line-height:1.5">You are receiving this because you opted in at luxedge.us. Unsubscribe anytime by replying with "unsubscribe".<br/>Luxedge — 8002salman@gmail.com</p>
          </div>
        </div>
      </div>`;
  };

  /** Send the generated email (test send or CRM-leads campaign). */
  const sendEmail = async () => {
    const subject = emailSubject.trim();
    if (!subject) { notify('Generate (or write) a subject line first — version A or B.'); return; }
    if (!email.body.trim()) { notify('Email body is empty — generate content first.'); return; }
    if (sendTarget === 'test' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sendTo.trim())) {
      notify('Enter a valid test recipient email.');
      return;
    }
    setSendingEmail(true);
    setSendResult(null);
    try {
      const token = getAccessToken();
      const body = sendTarget === 'leads'
        ? { audience: 'leads', subject, text: `${email.preheader ? email.preheader + '\n\n' : ''}${email.heroHeadline ? email.heroHeadline + '\n\n' : ''}${email.body}\n\n${email.ctaText || 'Shop Now'} → https://luxedge.us/shop${email.urgency ? '\n\n' + email.urgency : ''}`, html: buildEmailHtml() }
        : { to: sendTo.trim(), subject, text: `${email.preheader ? email.preheader + '\n\n' : ''}${email.heroHeadline ? email.heroHeadline + '\n\n' : ''}${email.body}\n\n${email.ctaText || 'Shop Now'} → https://luxedge.us/shop${email.urgency ? '\n\n' + email.urgency : ''}`, html: buildEmailHtml() };
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string; sent?: number; failed?: number; total?: number };
      if (!res.ok || d.ok === false) {
        setSendResult({ ok: false, msg: d.error || d.message || `Send failed (HTTP ${res.status})` });
        notify(`Send failed: ${d.error || d.message || 'unknown error'}`);
      } else {
        const msg = sendTarget === 'leads'
          ? `Sent to ${d.sent ?? 0} of ${d.total ?? 0} opted-in leads${d.failed ? ` (${d.failed} failed)` : ''}`
          : `Test email sent to ${sendTo.trim()}`;
        setSendResult({ ok: true, msg });
        notify(msg);
      }
    } catch (e: any) {
      setSendResult({ ok: false, msg: `Send failed: ${e.message}` });
    } finally {
      setSendingEmail(false);
    }
  };

  const allProviders: AIProvider[] = loadAIProviders();
  const activeProviders = allProviders.filter(p => p.enabled);
  const selectedProduct = products.find(p => p.id === selectedProductId);
  const [serverCfg, setServerCfg] = useState<Record<string, ProviderStatus> | null>(null);

  useEffect(() => {
    try { setVault(JSON.parse(localStorage.getItem('luxedge_mkt_vault') || '[]')); } catch { setVault([]); }
  }, []);

  // Which providers actually have keys on the server? Used to auto-select a
  // working provider instead of defaulting to one that 501s (e.g. Codex with
  // no CODEX_API_KEY) and to label the dropdown honestly.
  useEffect(() => {
    serverProviderStatus().then(s => {
      const m: Record<string, ProviderStatus> = {};
      s.providers.forEach(p => { m[p.id] = p; });
      setServerCfg(m);
    }).catch(() => setServerCfg({}));
  }, []);

  useEffect(() => {
    if (activeProviders.length && !aiProvider) {
      // Prefer a provider the server reports as configured; fall back to the
      // client default only when no server status is known yet.
      const configured = activeProviders.find(p => serverCfg?.[p.id]?.configured);
      const def = configured || activeProviders.find(p => p.isDefault) || activeProviders[0];
      setAiProvider(def.id);
      setAiModel(def.defaultModel);
    }
  }, [activeProviders.length, aiProvider, serverCfg]);

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  function saveVault(type: MktTab, content: string) {
    const item: MktVaultItem = { id: Date.now().toString(), type, productName: selectedProduct?.name || '', content, createdAt: new Date().toISOString() };
    const updated = [item, ...vault].slice(0, 100);
    setVault(updated);
    localStorage.setItem('luxedge_mkt_vault', JSON.stringify(updated));
  }

    async function callAI(prompt: string): Promise<string> {
    const prov = activeProviders.find(p => p.id === aiProvider) || activeProviders[0];
    if (!prov) throw new Error('No AI provider enabled. Enable one in AI Hub → AI Provider Configuration.');
    return callAIProvider(prompt, [{ ...prov, defaultModel: aiModel || prov.defaultModel }], undefined, 'You are an expert luxury e-commerce marketing copywriter. Return only valid JSON.');
  }

function parseJ<T>(raw: string, fb: T): T {
    try { const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/(\{[\s\S]*\})/); return JSON.parse(m ? m[1] : raw); }
    catch { return fb; }
  }

  function buildPrompt(section: string): string {
    const p = selectedProduct;
    if (!p) return '';
    const base = `Product: "${p.name}" | Price: $${p.price} | Category: ${p.category||'Luxury'} | Tone: ${tone.toUpperCase()}\nDescription: ${p.description?.slice(0,300)||'Premium luxury product'}`;
    if (section === 'all') return `${base}\n\nGenerate comprehensive marketing copy. Return ONLY valid JSON:\n{\n  "google": {\n    "headlines": ["h1 ≤30ch","h2","h3","h4","h5","h6"],\n    "descriptions": ["desc1 ≤90ch","desc2"],\n    "displayUrl": "luxedge.com/shop",\n    "finalUrl": "https://luxedge.com/products/${p.name.toLowerCase().replace(/\s+/g,'-')}",\n    "callouts": ["Eligible Shipping Promotions","Luxury Quality","See Return Policy","Payment Options Shown at Checkout"],\n    "sitelinks": [{"title":"Shop Now","desc":"View all luxury items","url":"/products"},{"title":"About Us","desc":"Our story","url":"/about"}]\n  },\n  "meta": {\n    "primaryText": "compelling 125-char primary ad text with emoji; avoid unsupported shipping, return, payment, or safety claims",\n    "headline": "40-char headline",\n    "description": "30-char description",\n    "cta": "Shop Now",\n    "audience": "US adults 25-55 interested in luxury goods, high income",\n    "interests": ["Luxury Brands","Premium Shopping","Interior Design","High-End Fashion"]\n  },\n  "social": {\n    "instagram": "engaging Instagram caption with emojis 2200 chars max",\n    "hashtags": ["luxuryliving","premiumquality","luxedge","shopnow","luxury"],\n    "facebook": "Facebook post 400-500 chars",\n    "twitter": ["tweet1 ≤280ch","tweet2 continuation","tweet3 CTA"],\n    "linkedin": "professional LinkedIn post 500-700 chars",\n    "pinterest": "Pinterest pin description 500 chars",\n    "tiktokScript": "30-second TikTok script with hook/body/CTA"\n  },\n  "email": {\n    "subjectA": "email subject A ≤50ch",\n    "subjectB": "A/B variant subject ≤50ch",\n    "preheader": "preheader text ≤90ch",\n    "heroHeadline": "bold hero headline",\n    "body": "email body with benefit paragraphs",\n    "ctaText": "Shop Now →",\n    "urgency": "limited time urgency line"\n  },\n  "video": {\n    "youtubeTitle": "YouTube title ≤60ch",\n    "youtubeDesc": "YouTube description with timestamps",\n    "youtubeTags": ["luxury","premium","review","unboxing"],\n    "tiktokScript": "60-sec TikTok script with hook/demo/CTA",\n    "reelHook": "First 3-second Reels hook line"\n  }\n}`;
    if (section === 'google') return `${base}\n\nGenerate Google RSA ad copy. Return ONLY valid JSON:\n{"headlines":["h1 ≤30ch","h2","h3","h4","h5","h6"],"descriptions":["desc1 ≤90ch","desc2"],"displayUrl":"luxedge.com/shop","finalUrl":"https://luxedge.com/products/slug","callouts":["Eligible Shipping Promotions","See Return Policy"],"sitelinks":[{"title":"Shop Now","desc":"All products","url":"/products"}]}`;
    if (section === 'meta') return `${base}\n\nGenerate Meta/Facebook ad copy. Return ONLY valid JSON:\n{"primaryText":"125ch primary text","headline":"40ch headline","description":"30ch description","cta":"Shop Now","audience":"target audience description","interests":["interest1","interest2"]}`;
    if (section === 'social') return `${base}\n\nGenerate social media posts. Return ONLY valid JSON:\n{"instagram":"caption","hashtags":["tag1","tag2"],"facebook":"fb post","twitter":["tweet1","tweet2"],"linkedin":"linkedin post","pinterest":"pin desc","tiktokScript":"script"}`;
    if (section === 'email') return `${base}\n\nGenerate email marketing copy. Return ONLY valid JSON:\n{"subjectA":"subject A","subjectB":"subject B","preheader":"preheader","heroHeadline":"hero","body":"body text","ctaText":"Shop Now →","urgency":"urgency line"}`;
    if (section === 'video') return `${base}\n\nGenerate video marketing scripts. Return ONLY valid JSON:\n{"youtubeTitle":"title","youtubeDesc":"description","youtubeTags":["tag1"],"tiktokScript":"script","reelHook":"hook"}`;
    return base;
  }

  async function generateAll() {
    if (!selectedProduct) { notify('Select a product first — every piece of copy is tailored to it.'); return; }
    if (!activeProviders.length) { notify('No AI provider key yet — open AI Hub and attach one first.'); return; }
    setGenerating(true); setGenSection('all');
    try {
      const raw = await callAI(buildPrompt('all'));
      const d = parseJ<Record<string,unknown>>(raw, {});
      if (d.google) setGoogleAd(d.google as GoogleAd);
      if (d.meta) setMetaAd(d.meta as MetaAd);
      if (d.social) setSocial(d.social as SocialPosts);
      if (d.email) setEmail(d.email as EmailDraft);
      if (d.video) setVideo(d.video as VideoScript);
    } catch(e) { notify(`AI Error: ${e instanceof Error ? e.message : String(e)}`); }
    setGenerating(false); setGenSection('');
  }

  async function regenSection(section: MktTab) {
    if (!selectedProduct) return;
    setGenerating(true); setGenSection(section);
    try {
      const raw = await callAI(buildPrompt(section));
      if (section === 'google') setGoogleAd(parseJ(raw, googleAd));
      else if (section === 'meta') setMetaAd(parseJ(raw, metaAd));
      else if (section === 'social') setSocial(parseJ(raw, social));
      else if (section === 'email') setEmail(parseJ(raw, email));
      else if (section === 'video') setVideo(parseJ(raw, video));
    } catch(e) { notify(`AI Error: ${e instanceof Error ? e.message : String(e)}`); }
    setGenerating(false); setGenSection('');
  }

  const MKT_TABS: { key: MktTab; label: string; icon: typeof MagnifyingGlass }[] = [
    { key: 'google', label: 'Google Ads', icon: MagnifyingGlass },
    { key: 'meta', label: 'Meta Ads', icon: Megaphone },
    { key: 'social', label: 'Social Posts', icon: ShareNetwork },
    { key: 'email', label: 'Email', icon: PaperPlaneRight },
    { key: 'video', label: 'Video', icon: DeviceMobile },
    { key: 'media', label: 'Media Studio', icon: Camera },
    { key: 'vault', label: 'Vault', icon: Star },
  ];

  const CopyBtn = ({ text, k }: { text: string; k: string }) => (
    <button onClick={() => copyText(text, k)} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Copy">
      {copied === k ? <CheckCircle size={14} className="text-green-500" /> : <Clipboard size={14} className="text-gray-400" />}
    </button>
  );

  const RegenBtn = ({ section, loading }: { section: MktTab; loading: boolean }) => (
    <button onClick={() => regenSection(section)} disabled={generating || !selectedProduct} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg font-medium disabled:opacity-50 transition-colors">
      {loading ? <SpinnerGap size={12} className="animate-spin" /> : <ArrowClockwise size={12} />}
      {loading ? 'Generating…' : 'Regenerate'}
    </button>
  );

  const CharBadge = ({ text, max, warn }: { text: string; max: number; warn?: number }) => {
    const n = text.length; const w = warn ?? Math.floor(max * 0.85);
    return <span className={`text-xs font-mono ${n > max ? 'text-red-500 font-bold' : n > w ? 'text-blue-500' : 'text-gray-400'}`}>{n}/{max}</span>;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone size={24} className="text-purple-600" /> Marketing Generator
          </h1>
          <p className="text-gray-500 text-sm mt-1">AI-powered ads, social posts, email &amp; video scripts</p>
        </div>
        <button onClick={generateAll} disabled={generating || !selectedProductId} className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50 hover:shadow-lg transition-all">
          {generating && genSection === 'all' ? <SpinnerGap size={16} className="animate-spin" /> : <Sparkle size={16} />}
          {generating && genSection === 'all' ? 'Generating All…' : '✨ Generate All'}
        </button>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Product</label>
          <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            <option value="">— Select product —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">AI Provider</label>
          <select value={aiProvider} onChange={e => { setAiProvider(e.target.value); setAiModel(''); }} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {activeProviders.length === 0 && <option value="">No providers configured</option>}
            {activeProviders.map(p => {
              const cfg = serverCfg?.[p.id];
              const label = cfg ? (cfg.configured ? `${p.name} ✓` : `${p.name} (no key)`) : p.name;
              return <option key={p.id} value={p.id}>{label}</option>;
            })}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Model</label>
          <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {(activeProviders.find(p => p.id === aiProvider)?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value as MktTone)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400">
            {MKT_TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* First-run guidance — why the controls are locked */}
      {!selectedProductId && (
        <div className="mb-6 -mt-2 flex items-center gap-1.5 text-xs text-gray-400">
          <Info size={13} className="shrink-0" /> Select a product above to unlock generation — copy is tailored to its name, price and description.
        </div>
      )}

      {/* Honest provider state — never fake AI output */}
      {activeProviders.length === 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm">
          <p className="font-semibold text-amber-800 mb-1 flex items-center gap-2"><Cpu size={15} /> No AI provider configured</p>
          <p className="text-amber-700">Marketing Generator needs an AI provider to create copy — nothing will be generated until one is set up. Open{' '}
            <button onClick={() => nav('/admin/ai-control')} className="underline font-medium text-amber-800">AI Control</button>
            {' '}or{' '}
            <button onClick={() => nav('/admin/ai')} className="underline font-medium text-amber-800">AI Hub</button>
            {' '}to configure a provider (settings are stored server-side, never in the browser).
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {MKT_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-1.5 ${tab === t.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── GOOGLE ADS TAB ── */}
      {tab === 'google' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><MagnifyingGlass size={18} className="text-blue-600" /> Google MagnifyingGlass Ads (RSA)</h2>
            <div className="flex gap-2">
              <button onClick={() => { saveVault('google', JSON.stringify(googleAd, null, 2)); }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><FloppyDisk size={12} /> FloppyDisk</button>
              <RegenBtn section="google" loading={generating && genSection === 'google'} />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Headlines <span className="text-gray-400 font-normal">(max 30 chars each, use at least 5)</span></h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {googleAd.headlines.map((h, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400 w-4">{i+1}</span>
                  <input value={h} onChange={e => { const hs = [...googleAd.headlines]; hs[i] = e.target.value.slice(0,30); setGoogleAd({...googleAd, headlines: hs}); }} placeholder={`Headline ${i+1}`} className="flex-1 text-sm bg-transparent focus:outline-none" />
                  <CharBadge text={h} max={30} />
                  <CopyBtn text={h} k={`gh${i}`} />
                </div>
              ))}
            </div>
            <button onClick={() => setGoogleAd({...googleAd, headlines: [...googleAd.headlines, '']})} className="mt-2 text-xs text-purple-600 hover:underline">+ Add headline</button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Descriptions <span className="text-gray-400 font-normal">(max 90 chars each)</span></h3>
            <div className="space-y-2">
              {googleAd.descriptions.map((d, i) => (
                <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400 w-4 mt-1">{i+1}</span>
                  <textarea value={d} onChange={e => { const ds = [...googleAd.descriptions]; ds[i] = e.target.value.slice(0,90); setGoogleAd({...googleAd, descriptions: ds}); }} placeholder={`Description ${i+1}`} rows={2} className="flex-1 text-sm bg-transparent focus:outline-none resize-none" />
                  <div className="flex flex-col items-end gap-1">
                    <CharBadge text={d} max={90} />
                    <CopyBtn text={d} k={`gd${i}`} />
                  </div>
                </div>
              ))}
              {googleAd.descriptions.length < 4 && <button onClick={() => setGoogleAd({...googleAd, descriptions: [...googleAd.descriptions, '']})} className="text-xs text-purple-600 hover:underline">+ Add description</button>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Display URL</h3>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <Globe size={14} className="text-gray-400 flex-shrink-0" />
                <input value={googleAd.displayUrl} onChange={e => setGoogleAd({...googleAd, displayUrl: e.target.value})} placeholder="luxedge.com/shop/product-name" className="flex-1 text-sm bg-transparent focus:outline-none" />
                <CopyBtn text={googleAd.displayUrl} k="gdurl" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Shown in ad — must match final URL domain</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Final URL</h3>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <LinkSimple size={14} className="text-gray-400 flex-shrink-0" />
                <input value={googleAd.finalUrl} onChange={e => setGoogleAd({...googleAd, finalUrl: e.target.value})} placeholder="https://luxedge.com/products/..." className="flex-1 text-sm bg-transparent focus:outline-none" />
                <CopyBtn text={googleAd.finalUrl} k="gfurl" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Callout Extensions</h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {googleAd.callouts.map((c, i) => (
                  <span key={i} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                    {c}
                    <button onClick={() => setGoogleAd({...googleAd, callouts: googleAd.callouts.filter((_,j) => j !== i)})} className="hover:text-red-500">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newCallout} onChange={e => setNewCallout(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newCallout.trim()) { setGoogleAd({...googleAd, callouts: [...googleAd.callouts, newCallout.trim()]}); setNewCallout(''); } }} placeholder="Add callout…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <button onClick={() => { if (newCallout.trim()) { setGoogleAd({...googleAd, callouts: [...googleAd.callouts, newCallout.trim()]}); setNewCallout(''); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">+</button>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Sitelink Extensions</h3>
              <div className="space-y-2">
                {googleAd.sitelinks.map((sl, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{sl.title}</p>
                      <p className="text-gray-500 truncate">{sl.desc}</p>
                    </div>
                    <button onClick={() => setGoogleAd({...googleAd, sitelinks: googleAd.sitelinks.filter((_,j) => j !== i)})} className="text-gray-400 hover:text-red-500">×</button>
                  </div>
                ))}
                <button onClick={() => setGoogleAd({...googleAd, sitelinks: [...googleAd.sitelinks, {title:'',desc:'',url:''}]})} className="text-xs text-blue-600 hover:underline">+ Add sitelink</button>
              </div>
            </div>
          </div>

          {/* Google Ad Preview */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Monitor size={14} /> Ad Preview</h3>
            <div className="border border-gray-100 rounded-lg p-4 bg-gray-50 max-w-lg">
              <div className="flex items-center gap-1 mb-1"><span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">Ad</span><span className="text-xs text-gray-500 truncate">{googleAd.displayUrl || 'luxedge.com'}</span></div>
              <p className="text-blue-600 text-base font-medium leading-tight mb-0.5">{[googleAd.headlines[0], googleAd.headlines[1], googleAd.headlines[2]].filter(Boolean).join(' | ') || 'Your Ad Headlines Here'}</p>
              <p className="text-sm text-gray-700 leading-snug">{googleAd.descriptions[0] || 'Your compelling description that drives clicks and conversions.'}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── META ADS TAB ── */}
      {tab === 'meta' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Target size={18} className="text-blue-700" /> Meta Ads (Facebook &amp; Instagram)</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('meta', JSON.stringify(metaAd, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><FloppyDisk size={12} /> FloppyDisk</button>
              <RegenBtn section="meta" loading={generating && genSection === 'meta'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Primary Text <span className="text-gray-400 font-normal">(≤125 chars recommended)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={metaAd.primaryText} max={500} warn={125} /><CopyBtn text={metaAd.primaryText} k="mpt" /></div>
                </div>
                <textarea value={metaAd.primaryText} onChange={e => setMetaAd({...metaAd, primaryText: e.target.value})} placeholder="Engaging primary text that appears above your image…" rows={4} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Headline <span className="text-gray-400 text-xs">(≤40)</span></label>
                    <div className="flex items-center gap-1"><CharBadge text={metaAd.headline} max={40} /><CopyBtn text={metaAd.headline} k="mh" /></div>
                  </div>
                  <input value={metaAd.headline} onChange={e => setMetaAd({...metaAd, headline: e.target.value.slice(0,40)})} placeholder="Bold headline" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Description <span className="text-gray-400 text-xs">(≤30)</span></label>
                    <div className="flex items-center gap-1"><CharBadge text={metaAd.description} max={30} /><CopyBtn text={metaAd.description} k="md" /></div>
                  </div>
                  <input value={metaAd.description} onChange={e => setMetaAd({...metaAd, description: e.target.value.slice(0,30)})} placeholder="Short description" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Call to Action</label>
                <select value={metaAd.cta} onChange={e => setMetaAd({...metaAd, cta: e.target.value})} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300">
                  {META_CTA_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Target Audience</label>
                <textarea value={metaAd.audience} onChange={e => setMetaAd({...metaAd, audience: e.target.value})} placeholder="e.g. US adults 25-55, high income, interested in luxury goods…" rows={2} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <label className="text-sm font-semibold text-gray-700 block mb-2">Interests to Target</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {metaAd.interests.map((interest, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full">
                      {interest}
                      <button onClick={() => setMetaAd({...metaAd, interests: metaAd.interests.filter((_,j) => j !== i)})} className="hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newInterest} onChange={e => setNewInterest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newInterest.trim()) { setMetaAd({...metaAd, interests: [...metaAd.interests, newInterest.trim()]}); setNewInterest(''); } }} placeholder="Add interest…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <button onClick={() => { if (newInterest.trim()) { setMetaAd({...metaAd, interests: [...metaAd.interests, newInterest.trim()]}); setNewInterest(''); } }} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">+</button>
                </div>
              </div>
            </div>

            {/* Meta Ad Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm h-fit">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><ShareNetwork size={14} /> Facebook Ad Preview</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden max-w-sm">
                <div className="p-3 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">L</div>
                  <div><p className="text-xs font-semibold text-gray-900">Luxedge</p><p className="text-xs text-gray-400">Sponsored · <Globe size={10} className="inline" /></p></div>
                </div>
                <p className="px-3 pb-3 text-xs text-gray-800 leading-relaxed">{metaAd.primaryText || 'Your primary ad text will appear here.'}</p>
                <div className="bg-gray-100 h-32 flex items-center justify-center text-gray-400 text-xs">
                  <ImageIcon size={24} className="text-gray-300" />
                </div>
                <div className="p-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                  <div><p className="text-xs font-semibold text-gray-900">{metaAd.headline || 'Your Headline'}</p><p className="text-xs text-gray-500">{metaAd.description || 'Your description'}</p></div>
                  <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex-shrink-0">{metaAd.cta}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SOCIAL POSTS TAB ── */}
      {tab === 'social' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><ShareNetwork size={18} className="text-pink-600" /> Social Media Posts</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('social', JSON.stringify(social, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><FloppyDisk size={12} /> FloppyDisk</button>
              <RegenBtn section="social" loading={generating && genSection === 'social'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Instagram */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📸 Instagram Caption</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.instagram} max={2200} warn={1000} /><CopyBtn text={social.instagram + '\n\n' + social.hashtags.map(h => '#'+h).join(' ')} k="ig" /></div>
              </div>
              <textarea value={social.instagram} onChange={e => setSocial({...social, instagram: e.target.value})} placeholder="Write an engaging Instagram caption with emojis…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-600 mb-1"># Hashtags</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {social.hashtags.map((h, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-pink-50 text-pink-700 text-xs rounded-full">
                      #{h}
                      <button onClick={() => setSocial({...social, hashtags: social.hashtags.filter((_,j) => j !== i)})} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input placeholder="hashtag (no #)" onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim().replace(/^#/,''); if (v) { setSocial({...social, hashtags: [...social.hashtags, v]}); (e.target as HTMLInputElement).value = ''; } } }} className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-pink-300" />
                </div>
              </div>
            </div>

            {/* Facebook */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📘 Facebook Post</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.facebook} max={5000} warn={400} /><CopyBtn text={social.facebook} k="fb" /></div>
              </div>
              <textarea value={social.facebook} onChange={e => setSocial({...social, facebook: e.target.value})} placeholder="Write an engaging Facebook post…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none" />
              <p className="text-xs text-gray-400 mt-1">Optimal length: 40–80 words</p>
            </div>

            {/* Twitter/X Thread */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">𝕏 Twitter/X Thread</h3>
                <div className="flex gap-2">
                  <CopyBtn text={social.twitter.join('\n\n')} k="tw" />
                  <button onClick={() => setSocial({...social, twitter: [...social.twitter, '']})} className="text-xs text-blue-500 hover:underline">+ Add tweet</button>
                </div>
              </div>
              <div className="space-y-2">
                {social.twitter.map((tw, i) => (
                  <div key={i} className="relative">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-2 w-4 flex-shrink-0">{i+1}/</span>
                      <textarea value={tw} onChange={e => { const t = [...social.twitter]; t[i] = e.target.value.slice(0,280); setSocial({...social, twitter: t}); }} placeholder={`Tweet ${i+1}`} rows={2} className="flex-1 text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none" />
                      <div className="flex flex-col items-end gap-1">
                        <CharBadge text={tw} max={280} warn={240} />
                        <button onClick={() => setSocial({...social, twitter: social.twitter.filter((_,j) => j !== i)})} className="text-gray-300 hover:text-red-400 text-xs">×</button>
                      </div>
                    </div>
                  </div>
                ))}
                {social.twitter.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No tweets yet. Click "Generate All" or add manually.</p>}
              </div>
            </div>

            {/* LinkedIn */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">💼 LinkedIn Post</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.linkedin} max={3000} warn={700} /><CopyBtn text={social.linkedin} k="li" /></div>
              </div>
              <textarea value={social.linkedin} onChange={e => setSocial({...social, linkedin: e.target.value})} placeholder="Professional LinkedIn post…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
            </div>

            {/* Pinterest */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">📌 Pinterest Pin</h3>
                <div className="flex items-center gap-1"><CharBadge text={social.pinterest} max={500} /><CopyBtn text={social.pinterest} k="pin" /></div>
              </div>
              <textarea value={social.pinterest} onChange={e => setSocial({...social, pinterest: e.target.value.slice(0,500)})} placeholder="Pinterest pin description optimized for discovery…" rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
            </div>

            {/* TikTok Script */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">🎵 TikTok Script</h3>
                <CopyBtn text={social.tiktokScript} k="tt" />
              </div>
              <textarea value={social.tiktokScript} onChange={e => setSocial({...social, tiktokScript: e.target.value})} placeholder="Write a 30-60 second TikTok script with hook/demo/CTA…" rows={6} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL TAB ── */}
      {tab === 'email' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><PaperPlaneRight size={18} className="text-green-600" /> Email Marketing</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('email', JSON.stringify(email, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><FloppyDisk size={12} /> FloppyDisk</button>
              <RegenBtn section="email" loading={generating && genSection === 'email'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">A/B Subject Lines</h3>
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-600 font-medium">Version A</label>
                      <div className="flex items-center gap-1"><CharBadge text={email.subjectA} max={50} /><CopyBtn text={email.subjectA} k="esa" /></div>
                    </div>
                    <input value={email.subjectA} onChange={e => setEmail({...email, subjectA: e.target.value})} placeholder="Subject line A — curiosity/benefit driven" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-600 font-medium">Version B</label>
                      <div className="flex items-center gap-1"><CharBadge text={email.subjectB} max={50} /><CopyBtn text={email.subjectB} k="esb" /></div>
                    </div>
                    <input value={email.subjectB} onChange={e => setEmail({...email, subjectB: e.target.value})} placeholder="Subject line B — urgency/FOMO driven" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Preheader <span className="text-gray-400 text-xs">(≤90 chars)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={email.preheader} max={90} /><CopyBtn text={email.preheader} k="epre" /></div>
                </div>
                <input value={email.preheader} onChange={e => setEmail({...email, preheader: e.target.value.slice(0,90)})} placeholder="Preview text shown after subject line…" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Hero Headline</label>
                  <CopyBtn text={email.heroHeadline} k="ehero" />
                </div>
                <input value={email.heroHeadline} onChange={e => setEmail({...email, heroHeadline: e.target.value})} placeholder="Bold, attention-grabbing hero headline" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Email Body</label>
                  <CopyBtn text={email.body} k="ebody" />
                </div>
                <textarea value={email.body} onChange={e => setEmail({...email, body: e.target.value})} placeholder="Email body with paragraphs covering benefits, features, social proof…" rows={6} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-green-300 resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">CTA Button Text</label>
                    <CopyBtn text={email.ctaText} k="ecta" />
                  </div>
                  <input value={email.ctaText} onChange={e => setEmail({...email, ctaText: e.target.value})} placeholder="Shop Now →" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-gray-700">Urgency Line</label>
                    <CopyBtn text={email.urgency} k="eur" />
                  </div>
                  <input value={email.urgency} onChange={e => setEmail({...email, urgency: e.target.value})} placeholder="⏰ Offer ends midnight Friday!" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
              </div>
            </div>

            {/* Email Preview */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Monitor size={14} /> Email Preview</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                <div className="bg-gray-50 p-3 border-b border-gray-200">
                  <p className="text-gray-600"><span className="font-semibold text-gray-800">From:</span> Luxedge &lt;hello@luxedge.com&gt;</p>
                  <p className="text-gray-600"><span className="font-semibold text-gray-800">Subject:</span> {email.subjectA || '(no subject yet)'}</p>
                  <p className="text-gray-400 text-xs italic">{email.preheader || '(preheader)'}</p>
                </div>
                <div className="bg-white p-4 space-y-3 max-h-80 overflow-y-auto">
                  <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg p-4 text-center">
                    <p className="font-bold text-base">{email.heroHeadline || 'Your Hero Headline'}</p>
                  </div>
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{email.body || 'Your email body will appear here.'}</p>
                  {email.urgency && <p className="text-blue-600 font-semibold">{email.urgency}</p>}
                  <div className="text-center">
                    <button className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold text-sm">{email.ctaText || 'Shop Now →'}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Send Email — test send + CRM-leads campaign */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><PaperPlaneRight size={14} className="text-green-600" /> Send This Email</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Subject (A/B pick)</label>
                <div className="flex gap-2">
                  {(['A', 'B'] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setSendSubjectChoice(v)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${sendSubjectChoice === v ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {v}: {(v === 'A' ? email.subjectA : email.subjectB) || '(empty)'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Recipients</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSendTarget('leads')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${sendTarget === 'leads' ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    CRM leads (opted-in)
                  </button>
                  <button type="button" onClick={() => setSendTarget('test')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${sendTarget === 'test' ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    Test email
                  </button>
                </div>
                {sendTarget === 'test' && (
                  <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="your@email.com"
                    className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                )}
                {sendTarget === 'leads' && (
                  <p className="mt-2 text-[11px] text-gray-400">Sends to every opted-in CRM lead (welcome popup / AI chat / manual signups) from sales@luxedge.us. Store-account users are not emailed — only the marketing opt-in list.</p>
                )}
              </div>
            </div>
            {sendTarget === 'leads' && (
              <p className="mt-3 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ This sends real emails to every opted-in lead. Check the preview above first, then confirm.
              </p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <button type="button" onClick={() => { if (sendTarget === 'leads' && !window.confirm('Send this email to ALL opted-in CRM leads now? This cannot be undone.')) return; void sendEmail(); }}
                disabled={sendingEmail}
                className="px-5 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                {sendingEmail ? <SpinnerGap size={14} className="animate-spin" /> : <PaperPlaneRight size={14} />}
                {sendingEmail ? 'Sending…' : sendTarget === 'leads' ? 'Send to CRM Leads' : 'Send Test Email'}
              </button>
              {sendResult && (
                <span className={`text-xs font-medium ${sendResult.ok ? 'text-green-600' : 'text-red-600'}`}>{sendResult.msg}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── VIDEO TAB ── */}
      {tab === 'video' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Lightning size={18} className="text-red-600" /> Video Scripts &amp; YouTube</h2>
            <div className="flex gap-2">
              <button onClick={() => saveVault('video', JSON.stringify(video, null, 2))} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><FloppyDisk size={12} /> FloppyDisk</button>
              <RegenBtn section="video" loading={generating && genSection === 'video'} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">▶️ YouTube Title <span className="text-gray-400 text-xs">(≤60 chars)</span></label>
                  <div className="flex items-center gap-1"><CharBadge text={video.youtubeTitle} max={60} /><CopyBtn text={video.youtubeTitle} k="yt" /></div>
                </div>
                <input value={video.youtubeTitle} onChange={e => setVideo({...video, youtubeTitle: e.target.value.slice(0,60)})} placeholder="Engaging YouTube video title" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">YouTube Description</label>
                  <CopyBtn text={video.youtubeDesc} k="ydesc" />
                </div>
                <textarea value={video.youtubeDesc} onChange={e => setVideo({...video, youtubeDesc: e.target.value})} placeholder="YouTube description with timestamps, links, keywords…" rows={5} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">YouTube Tags</label>
                  <CopyBtn text={video.youtubeTags.join(', ')} k="ytags" />
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {video.youtubeTags.map((t, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-full">
                      {t}
                      <button onClick={() => setVideo({...video, youtubeTags: video.youtubeTags.filter((_,j) => j !== i)})} className="hover:text-red-600">×</button>
                    </span>
                  ))}
                </div>
                <input onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) { setVideo({...video, youtubeTags: [...video.youtubeTags, v]}); (e.target as HTMLInputElement).value = ''; } } }} placeholder="Add tag, press Enter" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">⚡ Reels / TikTok Hook</label>
                  <CopyBtn text={video.reelHook} k="rhook" />
                </div>
                <textarea value={video.reelHook} onChange={e => setVideo({...video, reelHook: e.target.value})} placeholder="First 3-second hook line — must stop the scroll…" rows={3} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
                <p className="text-xs text-gray-400 mt-1">This is the most critical line — it determines if viewers keep watching</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">🎵 TikTok / Reels Full Script</label>
                  <CopyBtn text={video.tiktokScript} k="tts" />
                </div>
                <textarea value={video.tiktokScript} onChange={e => setVideo({...video, tiktokScript: e.target.value})} placeholder="60-second script:\n[0:00] Hook\n[0:05] Problem\n[0:15] Solution demo\n[0:45] CTA" rows={10} className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none font-mono" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MEDIA STUDIO TAB — real AI image/video generation ── */}
      {tab === 'media' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Camera size={18} className="text-pink-600" /> Media Studio — generate real images &amp; videos</h2>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Type</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMediaType('image')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${mediaType === 'image' ? 'bg-pink-600 text-white border-pink-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    <ImageIcon size={12} className="inline mr-1" />Image
                  </button>
                  <button type="button" onClick={() => setMediaType('video')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${mediaType === 'video' ? 'bg-pink-600 text-white border-pink-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    <DeviceMobile size={12} className="inline mr-1" />Video (Veo)
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">AI Provider</label>
                <select value={mediaProvider} onChange={e => setMediaProvider(e.target.value as 'openai' | 'gemini')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300">
                  <option value="openai">OpenAI (gpt-image-1) — images</option>
                  <option value="gemini">Google Gemini (Imagen / Veo) — images &amp; video</option>
                </select>
              </div>
              <div className="flex items-end">
                <button type="button" onClick={() => setMediaPrompt(mediaPromptFromProduct())}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                  ✨ Build prompt from selected product
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Prompt {mediaType === 'video' && <span className="text-gray-400 font-normal">— keep it short (Veo takes ~1-2 min)</span>}</label>
              <textarea value={mediaPrompt} onChange={e => setMediaPrompt(e.target.value)} rows={3}
                placeholder="e.g. Professional product photo of a Himalayan salt block on a wooden table, luxury studio lighting…"
                className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
            </div>

            <div className="flex items-center gap-3">
              <button type="button" onClick={() => void generateMedia()} disabled={mediaGenerating || (serverCfg !== null && !!serverCfg[mediaProvider] && !serverCfg[mediaProvider].configured)}
                className="px-5 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                {mediaGenerating ? <SpinnerGap size={14} className="animate-spin" /> : <Sparkle size={14} />}
                {mediaGenerating ? (mediaType === 'video' ? 'Generating video (1-2 min)…' : 'Generating image…') : `Generate ${mediaType}`}
              </button>
              {mediaResult && (
                <span className={`text-xs font-medium ${mediaResult.ok ? 'text-green-600' : 'text-red-600'}`}>{mediaResult.msg}</span>
              )}
            </div>
            {serverCfg !== null && !!serverCfg[mediaProvider] && !serverCfg[mediaProvider].configured && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <Warning size={13} className="shrink-0 mt-0.5" />
                No {mediaProvider === 'openai' ? 'OpenAI' : 'Gemini'} key on the server yet — attach one in{' '}
                <button type="button" onClick={() => nav('/admin/ai')} className="underline font-medium text-amber-800">AI Hub → Attach Key</button>
                {' '}to unlock real {mediaType === 'video' ? 'videos' : 'images'}.
              </p>
            )}
            <p className="text-[11px] text-gray-400">Needs an API key on the server: <strong>OpenAI</strong> (gpt-image-1) ya <strong>Google Gemini</strong> (Imagen for images, Veo for video). DeepSeek/Codex sirf text banate hain — media ke liye nahi. Gemini Plus/Pro membership consumer app ka hai — API ke liye alag key chahiye (AI Hub → Attach Key).</p>
          </div>

          {mediaResult?.ok && mediaResult.url && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Result — stored on luxedge.us ✓</h3>
              {mediaType === 'image' ? (
                <img src={mediaResult.url} alt="Generated media" className="max-h-96 rounded-xl border border-gray-200" />
              ) : (
                <video src={mediaResult.url} controls className="max-h-96 rounded-xl border border-gray-200" />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { navigator.clipboard.writeText(mediaResult.url || ''); notify('URL copied'); }}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <LinkSimple size={12} /> Copy URL
                </button>
                <button type="button" onClick={() => { saveVault('media', mediaResult.url || ''); notify('Saved to Vault'); }}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                  <FloppyDisk size={12} /> Save to Vault
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── VAULT TAB ── */}
      {tab === 'vault' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><MagicWand size={18} className="text-gray-600" /> Copy Vault ({vault.length})</h2>
            <div className="flex gap-2">
              <button onClick={() => { const blob = new Blob([JSON.stringify(vault, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'luxedge-marketing-vault.json'; a.click(); }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"><UploadSimple size={12} /> Export JSON</button>
              {vault.length > 0 && <button onClick={() => { if (confirm('Clear all saved copies?')) { setVault([]); localStorage.removeItem('luxedge_mkt_vault'); } }} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium"><Trash size={12} /> Clear All</button>}
            </div>
          </div>

          {vault.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-gray-200 rounded-xl">
              <Megaphone size={40} className="text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No saved copies yet</p>
              <p className="text-gray-400 text-sm">Click FloppyDisk on any tab — or Save to Vault in Media Studio — to keep your best work here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {vault.map(item => (
                <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">{item.type}</span>
                      <span className="text-sm font-medium text-gray-800">{item.productName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</span>
                      <CopyBtn text={item.content} k={`v${item.id}`} />
                      <button onClick={() => { const updated = vault.filter(v => v.id !== item.id); setVault(updated); localStorage.setItem('luxedge_mkt_vault', JSON.stringify(updated)); }} className="p-1 text-gray-300 hover:text-red-400 transition-colors"><Trash size={12} /></button>
                    </div>
                  </div>
                  <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 overflow-auto max-h-32 whitespace-pre-wrap">{item.content.slice(0, 300)}{item.content.length > 300 ? '…' : ''}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ENTERPRISE SEO & CONTENT ENGINE
// ============================================================================
type SEOTab = 'seo'|'schema'|'social'|'content'|'analysis'|'preview';
type ToneOption = 'Luxury'|'Premium'|'Friendly'|'Professional'|'Technical'|'Luxury Brand'|'Minimalist';
const SEO_TONES: ToneOption[] = ['Luxury','Premium','Friendly','Professional','Technical','Luxury Brand','Minimalist'];
const SEO_SCHEMA_KEYS = ['product','breadcrumb','organization','website','faq'] as const;
type SchemaKey = typeof SEO_SCHEMA_KEYS[number];

function _scoreColor(n: number): string {
  return n >= 70 ? 'text-green-600' : n >= 45 ? 'text-blue-500' : 'text-red-500';
}
function _scoreBg(n: number): string {
  return n >= 70 ? 'bg-green-50 border-green-200' : n >= 45 ? 'bg-sky-50 border-sky-200' : 'bg-red-50 border-red-200';
}
function _issueIcon(t: 'good'|'warning'|'error'): string {
  return t === 'good' ? '✅' : t === 'warning' ? '⚠️' : '❌';
}

function _computeSEO(seo: SEOData, content: ContentData): SEOScore {
  const issues: SEOScore['issues'] = [];
  let score = 100;

  const tl = seo.title.length;
  if (tl >= 50 && tl <= 60) issues.push({ type: 'good', msg: `Title: ${tl} chars (ideal 50–60)` });
  else if (tl >= 30 && tl <= 70) { score -= 7; issues.push({ type: 'warning', msg: `Title: ${tl} chars (ideal: 50–60)` }); }
  else if (tl > 0) { score -= 18; issues.push({ type: 'error', msg: `Title: ${tl} chars (${tl < 30 ? 'too short' : 'too long — truncated in SERPs'})` }); }
  else { score -= 25; issues.push({ type: 'error', msg: 'SEO title is empty' }); }

  const ml = seo.metaDescription.length;
  if (ml >= 120 && ml <= 160) issues.push({ type: 'good', msg: `Meta: ${ml} chars (ideal 120–160)` });
  else if (ml >= 80 && ml <= 200) { score -= 8; issues.push({ type: 'warning', msg: `Meta: ${ml} chars (ideal: 120–160)` }); }
  else if (ml > 0) { score -= 18; issues.push({ type: 'error', msg: `Meta: ${ml} chars (${ml < 80 ? 'too short' : 'too long'})` }); }
  else { score -= 25; issues.push({ type: 'error', msg: 'Meta description is empty' }); }

  const fk = seo.focusKeyword.toLowerCase().trim();
  if (fk) {
    if (seo.title.toLowerCase().includes(fk)) issues.push({ type: 'good', msg: 'Focus keyword in title ✓' });
    else { score -= 12; issues.push({ type: 'error', msg: 'Focus keyword missing from title' }); }
    if (seo.metaDescription.toLowerCase().includes(fk)) issues.push({ type: 'good', msg: 'Focus keyword in meta ✓' });
    else { score -= 6; issues.push({ type: 'warning', msg: 'Focus keyword missing from meta description' }); }
    if (seo.slug.toLowerCase().includes(fk.replace(/\s+/g, '-'))) issues.push({ type: 'good', msg: 'Focus keyword in URL slug ✓' });
    else { score -= 4; issues.push({ type: 'warning', msg: 'Focus keyword not in URL slug' }); }
  } else {
    score -= 15; issues.push({ type: 'error', msg: 'Focus keyword not set' });
  }

  if (seo.imageAlt.trim()) issues.push({ type: 'good', msg: 'Image ALT text set ✓' });
  else { score -= 8; issues.push({ type: 'error', msg: 'Image ALT text is missing' }); }

  if (seo.slug.trim()) issues.push({ type: 'good', msg: 'URL slug defined ✓' });
  else { score -= 8; issues.push({ type: 'error', msg: 'URL slug not set' }); }

  if (seo.keywords.length >= 5) issues.push({ type: 'good', msg: `${seo.keywords.length} SEO keywords defined ✓` });
  else if (seo.keywords.length >= 3) { score -= 4; issues.push({ type: 'warning', msg: `${seo.keywords.length} keywords — aim for 5+` }); }
  else { score -= 10; issues.push({ type: 'error', msg: 'Too few keywords (add at least 5)' }); }

  const desc = content.luxuryDescription || '';
  const words = desc.split(/\s+/).filter(Boolean);
  const wc = words.length;
  if (wc >= 200) issues.push({ type: 'good', msg: `Description: ${wc} words ✓` });
  else if (wc >= 100) { score -= 6; issues.push({ type: 'warning', msg: `Description: ${wc} words (aim for 200+)` }); }
  else if (wc > 0) { score -= 14; issues.push({ type: 'error', msg: `Description: ${wc} words (thin content)` }); }
  else { score -= 20; issues.push({ type: 'error', msg: 'Luxury description is empty' }); }

  const sentences = desc.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgWPS = sentences.length > 0 ? wc / sentences.length : 0;
  let readability = 100;
  if (avgWPS > 30) { readability = 35; issues.push({ type: 'error', msg: `Sentences too long (avg ${avgWPS.toFixed(0)} words)` }); }
  else if (avgWPS > 20) { readability = 65; issues.push({ type: 'warning', msg: `Sentences a bit long (avg ${avgWPS.toFixed(0)} words)` }); }
  else if (avgWPS > 5) { issues.push({ type: 'good', msg: `Readability good (avg ${avgWPS.toFixed(0)} words/sentence)` }); }

  const kwCount = fk ? words.filter(w => w.toLowerCase().includes(fk)).length : 0;
  const density = wc > 0 ? (kwCount / wc) * 100 : 0;
  if (fk) {
    if (density >= 1 && density <= 3) issues.push({ type: 'good', msg: `Keyword density: ${density.toFixed(1)}% (ideal 1–3%)` });
    else if (density > 0) { score -= 4; issues.push({ type: 'warning', msg: `Keyword density: ${density.toFixed(1)}% (ideal: 1–3%)` }); }
    else { score -= 8; issues.push({ type: 'warning', msg: 'Keyword not found in description' }); }
  }

  if (content.bulletFeatures.length >= 4) issues.push({ type: 'good', msg: `${content.bulletFeatures.length} bullet features ✓` });
  else if (content.bulletFeatures.length > 0) { score -= 3; issues.push({ type: 'warning', msg: `Only ${content.bulletFeatures.length} features listed (aim for 6+)` }); }

  return {
    overall: Math.max(0, Math.min(100, score)),
    readability: Math.max(0, Math.min(100, readability)),
    keywordDensity: density,
    metaLength: ml,
    titleLength: tl,
    missingAlt: seo.imageAlt ? 0 : 1,
    issues,
  };
}

function _genProductSchema(p: Product, seo: SEOData, c: ContentData): string {
  return JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": seo.title || p.name,
    "description": c.shortDescription || p.shortDesc,
    "image": p.images?.length ? [p.images[0]] : [],
    "sku": p.id,
    "brand": { "@type": "Brand", "name": p.brand || "Luxedge" },
    "offers": {
      "@type": "Offer",
      "url": `https://luxedge.us/#/products/${p.id}`,
      "priceCurrency": "USD",
      "price": p.price.toFixed(2),
      "priceValidUntil": new Date(Date.now() + 86400000 * 90).toISOString().split('T')[0],
      "availability": p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": { "@type": "Organization", "name": "Luxedge" }
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": p.rating.toString(),
      "reviewCount": p.reviews.toString(),
      "bestRating": "5",
      "worstRating": "1"
    }
  }, null, 2);
}

function _genBreadcrumbSchema(p: Product, seo: SEOData): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://luxedge.us" },
      { "@type": "ListItem", "position": 2, "name": p.category, "item": `https://luxedge.us/#/category/${p.category.toLowerCase().replace(/\s+/g,'-')}` },
      { "@type": "ListItem", "position": 3, "name": seo.title || p.name, "item": `https://luxedge.us/#/products/${seo.slug || p.id}` }
    ]
  }, null, 2);
}

function _genOrgSchema(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Luxedge",
    "url": "https://luxedge.us",
    "logo": { "@type": "ImageObject", "url": "https://luxedge.us/logo.png" },
    "contactPoint": { "@type": "ContactPoint", "contactType": "customer service", "email": "support@luxedge.us", "availableLanguage": "English" },
    "address": { "@type": "PostalAddress", "addressCountry": "US" },
    // sameAs is emitted ONLY for profiles that actually exist. This helper used
    // to hardcode three invented Luxedge handles on Twitter, Facebook and
    // Instagram — none of which is a real account, so copying this schema
    // published a false claim about the business. It now reads the single list
    // in src/content/socialProfiles.ts and omits the key entirely when empty.
    ...(SOCIAL_PROFILES.length > 0 ? { "sameAs": SOCIAL_PROFILES.map((p) => p.href) } : {}),
  }, null, 2);
}

function _genWebsiteSchema(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Luxedge",
    "url": "https://luxedge.us",
    "description": "Premium pet essentials for dogs and cats",
    "potentialAction": {
      "@type": "SearchAction",
      "target": { "@type": "EntryPoint", "urlTemplate": "https://luxedge.us/#/search?q={search_term_string}" },
      "query-input": "required name=search_term_string"
    }
  }, null, 2);
}

function _genFAQSchema(faqs: { q: string; a: string }[]): string {
  if (!faqs.length) return '';
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a }
    }))
  }, null, 2);
}

function _tryValidate(json: string): boolean {
  if (!json.trim()) return false;
  try { JSON.parse(json); return true; } catch { return false; }
}

function ASEOEngine() {
  const { products, setProducts, notify } = useApp();
  const navigate = useNavigate();

  const [selId, setSelId] = useState('');
  const [tab, setTab] = useState<SEOTab>('seo');
  const [tone, setTone] = useState<ToneOption>('Luxury');
  const [previewMode, setPreviewMode] = useState<'desktop'|'mobile'|'facebook'|'twitter'>('desktop');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSection, setAiSection] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [newKw, setNewKw] = useState('');
  const [newSecKw, setNewSecKw] = useState('');
  const [copied, setCopied] = useState('');
  const [schemaValid, setSchemaValid] = useState<Record<SchemaKey, boolean>>({ product: false, breadcrumb: false, organization: false, website: false, faq: false });
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  const [seo, setSeo] = useState<SEOData>({
    title: '', metaDescription: '', keywords: [], slug: '', canonicalUrl: '',
    focusKeyword: '', secondaryKeywords: [], imageAlt: '', imageTitle: '', imageCaption: '',
  });
  const [social, setSocial] = useState<SocialSEO>({
    ogTitle: '', ogDescription: '', ogImage: '',
    twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '',
    pinterestDescription: '', pinterestImage: '',
  });
  const [content, setContent] = useState<ContentData>({
    premiumTitle: '', luxuryDescription: '', shortDescription: '',
    bulletFeatures: [], specifications: {}, benefits: [],
    useCases: [], careInstructions: '', packageContents: [],
    warrantyText: '', shippingInfo: '', focusKeyword: '', faqs: [],
  });
  const [schemas, setSchemas] = useState<StructuredSchemas>({
    product: '', breadcrumb: '', organization: _genOrgSchema(), website: _genWebsiteSchema(), faq: '',
  });
  const [score, setScore] = useState<SEOScore>({
    overall: 0, readability: 0, keywordDensity: 0, metaLength: 0, titleLength: 0, missingAlt: 0, issues: [],
  });

  const selProduct = products.find(p => p.id === selId);

  // Auto-populate from product
  useEffect(() => {
    const p = products.find(x => x.id === selId);
    if (!p) return;
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    setSeo(prev => ({
      ...prev,
      title: prev.title || p.name,
      slug: prev.slug || slug,
      canonicalUrl: `https://luxedge.us/#/products/${slug}`,
      imageAlt: prev.imageAlt || (p.name + ' product image'),
      imageTitle: prev.imageTitle || p.name,
    }));
    setSocial(prev => ({
      ...prev,
      ogTitle: prev.ogTitle || p.name,
      ogDescription: prev.ogDescription || p.shortDesc,
      ogImage: prev.ogImage || (p.images?.[0] || ''),
      twitterTitle: prev.twitterTitle || p.name,
      twitterDescription: prev.twitterDescription || p.shortDesc,
      pinterestImage: prev.pinterestImage || (p.images?.[0] || ''),
    }));
    setContent(prev => ({
      ...prev,
      premiumTitle: prev.premiumTitle || p.name,
      shortDescription: prev.shortDescription || p.shortDesc,
    }));
  }, [selId, products]);

  // Live SEO score
  useEffect(() => {
    setScore(_computeSEO(seo, content));
  }, [seo, content]);

  function generateSchemas() {
    if (!selProduct) return;
    const faqJson = _genFAQSchema(content.faqs);
    const next: StructuredSchemas = {
      product: _genProductSchema(selProduct, seo, content),
      breadcrumb: _genBreadcrumbSchema(selProduct, seo),
      organization: _genOrgSchema(),
      website: _genWebsiteSchema(),
      faq: faqJson,
    };
    setSchemas(next);
    const valid: Record<SchemaKey, boolean> = { product: false, breadcrumb: false, organization: false, website: false, faq: false };
    SEO_SCHEMA_KEYS.forEach(k => { valid[k] = _tryValidate(next[k]); });
    setSchemaValid(valid);
    notify('Schemas generated & validated', 'success');
  }

  async function generateAll() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const prompt = `You are a luxury e-commerce SEO expert for Luxedge (premium US dropshipping brand).

Generate complete SEO content for this product:
Name: ${selProduct.name}
Category: ${selProduct.category}
Price: $${selProduct.price} (was $${selProduct.originalPrice})
Description: ${selProduct.shortDesc}
Brand: ${selProduct.brand}
Rating: ${selProduct.rating}/5 (${selProduct.reviews} reviews)
Writing Tone: ${tone}

Return ONLY valid JSON (no markdown):
{
  "premiumTitle": "...",
  "luxuryDescription": "...",
  "shortDescription": "...",
  "bulletFeatures": ["feature 1","feature 2","feature 3","feature 4","feature 5","feature 6"],
  "specifications": {"Spec Name":"Value"},
  "benefits": ["benefit 1","benefit 2","benefit 3","benefit 4"],
  "useCases": ["use case 1","use case 2","use case 3"],
  "careInstructions": "...",
  "packageContents": ["item 1","item 2"],
  "warrantyText": "...",
  "shippingInfo": "...",
  "faqs": [{"q":"question?","a":"answer."},{"q":"question?","a":"answer."},{"q":"question?","a":"answer."}],
  "seoTitle": "...",
  "metaDescription": "...",
  "keywords": ["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8"],
  "slug": "url-friendly-slug",
  "focusKeyword": "primary keyword",
  "secondaryKeywords": ["secondary1","secondary2","secondary3"],
  "imageAlt": "...",
  "imageTitle": "...",
  "imageCaption": "...",
  "ogTitle": "...",
  "ogDescription": "...",
  "twitterTitle": "...",
  "twitterDescription": "...",
  "pinterestDescription": "..."
}

Rules:
- Tone: ${tone}
- luxuryDescription: 200+ words, compelling, conversion-focused, ${tone} voice
- seoTitle: 50-60 chars, include focus keyword near start
- metaDescription: 120-160 chars, include CTA
- All copy must target US market
- Return ONLY the JSON`;

    setAiLoading(true); setAiSection('all'); setAiStatus('Generating all SEO content…');
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const d = JSON.parse(cleaned) as Record<string, unknown>;
      const arr = (k: string): string[] => Array.isArray(d[k]) ? (d[k] as string[]) : [];
      const str = (k: string): string => typeof d[k] === 'string' ? d[k] as string : '';
      const obj = (k: string): Record<string,string> => (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) ? d[k] as Record<string,string> : {};
      const faqArr = (d['faqs'] as {q:string;a:string}[] | undefined) || [];

      setContent({
        premiumTitle: str('premiumTitle'), luxuryDescription: str('luxuryDescription'),
        shortDescription: str('shortDescription'), bulletFeatures: arr('bulletFeatures'),
        specifications: obj('specifications'), benefits: arr('benefits'),
        useCases: arr('useCases'), careInstructions: str('careInstructions'),
        packageContents: arr('packageContents'), warrantyText: str('warrantyText'),
        shippingInfo: str('shippingInfo'), focusKeyword: str('focusKeyword'), faqs: faqArr,
      });
      setSeo(prev => ({
        ...prev,
        title: str('seoTitle') || prev.title,
        metaDescription: str('metaDescription') || prev.metaDescription,
        keywords: arr('keywords').length ? arr('keywords') : prev.keywords,
        slug: str('slug') || prev.slug,
        focusKeyword: str('focusKeyword') || prev.focusKeyword,
        secondaryKeywords: arr('secondaryKeywords').length ? arr('secondaryKeywords') : prev.secondaryKeywords,
        imageAlt: str('imageAlt') || prev.imageAlt,
        imageTitle: str('imageTitle') || prev.imageTitle,
        imageCaption: str('imageCaption') || prev.imageCaption,
        canonicalUrl: `https://luxedge.us/#/products/${str('slug') || prev.slug}`,
      }));
      setSocial(prev => ({
        ...prev,
        ogTitle: str('ogTitle') || prev.ogTitle,
        ogDescription: str('ogDescription') || prev.ogDescription,
        twitterTitle: str('twitterTitle') || prev.twitterTitle,
        twitterDescription: str('twitterDescription') || prev.twitterDescription,
        pinterestDescription: str('pinterestDescription') || prev.pinterestDescription,
      }));
      notify('All SEO content generated!', 'success');
    } catch (e: any) {
      notify(`AI error: ${e.message}`, 'error');
    } finally {
      setAiLoading(false); setAiSection(''); setAiStatus('');
    }
  }

  async function regenSection(section: string, fieldHint: string) {
    if (!selProduct) return;
    const prompt = `You are a luxury e-commerce copywriter. Rewrite only the ${section} for this product in ${tone} tone.
Product: ${selProduct.name} ($${selProduct.price})
Category: ${selProduct.category}
${content.focusKeyword ? `Focus keyword: ${seo.focusKeyword}` : ''}

Return ONLY a JSON object with a single key "${fieldHint}".
Example: {"${fieldHint}": "your content here"}`;
    setAiLoading(true); setAiSection(section); setAiStatus(`Regenerating ${section}…`);
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const d = JSON.parse(cleaned) as Record<string, unknown>;
      const val = d[fieldHint];
      if (fieldHint === 'bulletFeatures' || fieldHint === 'benefits' || fieldHint === 'useCases' || fieldHint === 'packageContents') {
        setContent(prev => ({ ...prev, [fieldHint]: Array.isArray(val) ? val : prev[fieldHint as keyof ContentData] }));
      } else {
        setContent(prev => ({ ...prev, [fieldHint]: typeof val === 'string' ? val : prev[fieldHint as keyof ContentData] }));
      }
      notify(`${section} regenerated`, 'success');
    } catch (e: any) { notify(`AI error: ${e.message}`, 'error'); }
    finally { setAiLoading(false); setAiSection(''); setAiStatus(''); }
  }

  function copySchema(key: SchemaKey) {
    const text = schemas[key];
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => notify('Copy failed — use Ctrl+A in the text area', 'error'));
  }

  function saveToProduct() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const updates: Partial<Product> = {};
    if (content.premiumTitle) updates.name = content.premiumTitle;
    if (content.luxuryDescription) updates.description = content.luxuryDescription;
    if (content.shortDescription) updates.shortDesc = content.shortDescription;
    setProducts(prev => prev.map(p => p.id === selProduct.id ? { ...p, ...updates } : p));
    localStorage.setItem(`luxedge_seo_${selProduct.id}`, JSON.stringify({ seo, social, schemas, content }));
    notify(`SEO data saved to "${selProduct.name}"`, 'success');
  }

  // ── Reusable UI pieces ───────────────────────────────────────────────────
  const RegenBtn = ({ section, field }: { section: string; field: string }) => (
    <button onClick={() => regenSection(section, field)} disabled={aiLoading}
      className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 px-2 py-1 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-40 transition-colors">
      {aiLoading && aiSection === section ? <SpinnerGap size={11} className="animate-spin" /> : <ArrowClockwise size={11} />}
      Regen
    </button>
  );

  const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );

  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none';
  const ta = inp + ' resize-none';

  const ScoreCircle = ({ label, value, unit = '' }: { label: string; value: number; unit?: string }) => (
    <div className={`rounded-xl border p-3 text-center ${_scoreBg(value)}`}>
      <p className={`text-2xl font-bold ${_scoreColor(value)}`}>{Math.round(value)}{unit}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );

  const TAB_ITEMS: { key: SEOTab; label: string }[] = [
    { key: 'seo', label: '🔍 SEO' },
    { key: 'schema', label: '{ } Schema' },
    { key: 'social', label: '📱 Social' },
    { key: 'content', label: '✍️ Content' },
    { key: 'analysis', label: '📊 Analysis' },
    { key: 'preview', label: '👁 Preview' },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MagnifyingGlass size={24} className="text-purple-600" /> Enterprise SEO & Content Engine
          </h1>
          <p className="text-gray-500 text-sm mt-1">AI-powered SEO · Structured Data · Social SEO · Content · Live Analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveToProduct} disabled={!selId}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <FloppyDisk size={15} /> FloppyDisk to Product
          </button>
          <button onClick={() => navigate('/admin/products')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 px-3 py-2 border border-gray-200 rounded-xl transition-colors">
            <ArrowLeft size={15} /> Back
          </button>
        </div>
      </div>

      {/* Product selector + AI generate bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Product</label>
          <select value={selId} onChange={e => setSelId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
            <option value="">-- Select a product --</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} · ${p.price}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI Tone</label>
          <select value={tone} onChange={e => setTone(e.target.value as ToneOption)}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
            {SEO_TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={generateAll} disabled={aiLoading || !selId}
          className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-colors whitespace-nowrap">
          {aiLoading && aiSection === 'all' ? <SpinnerGap size={16} className="animate-spin" /> : <MagicWand size={16} />}
          {aiLoading && aiSection === 'all' ? aiStatus || 'Generating…' : 'Generate All with AI'}
        </button>
        {selProduct && (
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-xl border border-purple-100 text-xs">
            {selProduct.images?.[0] && <img src={selProduct.images[0]} alt="" className="w-8 h-8 object-cover rounded-lg" />}
            <div>
              <p className="font-semibold text-gray-900 max-w-32 truncate">{selProduct.name}</p>
              <p className="text-purple-600">${selProduct.price} · {selProduct.category}</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl flex-wrap">
        {TAB_ITEMS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 min-w-fit px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === t.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Product SEO ──────────────────────────────────────────────── */}
      {tab === 'seo' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Globe size={18} className="text-purple-600" /> Product SEO Fields</h2>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${_scoreBg(score.overall)} ${_scoreColor(score.overall)}`}>
              SEO Score: {score.overall}/100
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="SEO Title (50–60 chars)">
              <div className="relative">
                <input value={seo.title} onChange={e => setSeo(p => ({...p, title: e.target.value}))} className={inp} placeholder="Enter SEO title…" maxLength={80} />
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold ${seo.title.length >= 50 && seo.title.length <= 60 ? 'text-green-600' : seo.title.length > 0 ? 'text-blue-500' : 'text-gray-400'}`}>{seo.title.length}</span>
              </div>
            </FieldRow>
            <FieldRow label="URL Slug">
              <input value={seo.slug} onChange={e => setSeo(p => ({...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')}))} className={inp} placeholder="url-friendly-slug" />
            </FieldRow>
            <FieldRow label="Meta Description (120–160 chars)">
              <div className="relative">
                <textarea value={seo.metaDescription} onChange={e => setSeo(p => ({...p, metaDescription: e.target.value}))} rows={3} className={ta} placeholder="Compelling meta description with CTA…" />
                <span className={`absolute right-3 bottom-3 text-xs font-bold ${seo.metaDescription.length >= 120 && seo.metaDescription.length <= 160 ? 'text-green-600' : seo.metaDescription.length > 0 ? 'text-blue-500' : 'text-gray-400'}`}>{seo.metaDescription.length}/160</span>
              </div>
            </FieldRow>
            <FieldRow label="Canonical URL">
              <input value={seo.canonicalUrl} onChange={e => setSeo(p => ({...p, canonicalUrl: e.target.value}))} className={inp} placeholder="https://luxedge.us/#/products/…" />
            </FieldRow>
            <FieldRow label="Focus Keyword">
              <input value={seo.focusKeyword} onChange={e => setSeo(p => ({...p, focusKeyword: e.target.value}))} className={inp} placeholder="Primary SEO keyword" />
            </FieldRow>
            <FieldRow label="Image ALT Text">
              <input value={seo.imageAlt} onChange={e => setSeo(p => ({...p, imageAlt: e.target.value}))} className={inp} placeholder="Descriptive ALT text for main image" />
            </FieldRow>
            <FieldRow label="Image Title">
              <input value={seo.imageTitle} onChange={e => setSeo(p => ({...p, imageTitle: e.target.value}))} className={inp} placeholder="Image title attribute" />
            </FieldRow>
            <FieldRow label="Image Caption">
              <input value={seo.imageCaption} onChange={e => setSeo(p => ({...p, imageCaption: e.target.value}))} className={inp} placeholder="Optional image caption" />
            </FieldRow>
          </div>
          {/* Keywords */}
          <FieldRow label="SEO Keywords">
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-8">
              {seo.keywords.map(k => (
                <span key={k} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full border border-purple-100">
                  {k}<button onClick={() => setSeo(p => ({...p, keywords: p.keywords.filter(x => x !== k)}))} className="hover:text-red-500"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newKw.trim()) { setSeo(p => ({...p, keywords: [...p.keywords, newKw.trim()]})); setNewKw(''); e.preventDefault(); }}} placeholder="Add keyword…" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={() => { if (newKw.trim()) { setSeo(p => ({...p, keywords: [...p.keywords, newKw.trim()]})); setNewKw(''); }}} className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm hover:bg-purple-700"><Plus size={14} /></button>
            </div>
          </FieldRow>
          {/* Secondary Keywords */}
          <FieldRow label="Secondary Keywords">
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-8">
              {seo.secondaryKeywords.map(k => (
                <span key={k} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs px-2.5 py-1 rounded-full border border-indigo-100">
                  {k}<button onClick={() => setSeo(p => ({...p, secondaryKeywords: p.secondaryKeywords.filter(x => x !== k)}))} className="hover:text-red-500"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newSecKw} onChange={e => setNewSecKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newSecKw.trim()) { setSeo(p => ({...p, secondaryKeywords: [...p.secondaryKeywords, newSecKw.trim()]})); setNewSecKw(''); e.preventDefault(); }}} placeholder="Add secondary keyword…" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={() => { if (newSecKw.trim()) { setSeo(p => ({...p, secondaryKeywords: [...p.secondaryKeywords, newSecKw.trim()]})); setNewSecKw(''); }}} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm hover:bg-indigo-700"><Plus size={14} /></button>
            </div>
          </FieldRow>
        </div>
      )}

      {/* ── TAB: Structured Data ─────────────────────────────────────────── */}
      {tab === 'schema' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Code size={18} className="text-purple-600" /> JSON-LD Structured Data</h2>
            <button onClick={generateSchemas} disabled={!selId}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50">
              <ArrowClockwise size={14} /> Generate All Schemas
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {SEO_SCHEMA_KEYS.map(key => (
              <div key={key} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 capitalize">{key === 'faq' ? 'FAQ' : key} Schema</span>
                    {schemas[key] && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${schemaValid[key] ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {schemaValid[key] ? '✓ Valid' : '✗ Invalid'}
                      </span>
                    )}
                    {key === 'faq' && !content.faqs.length && <span className="text-xs text-gray-400 italic">(no FAQs — generate AI content first)</span>}
                  </div>
                  <button onClick={() => copySchema(key)} disabled={!schemas[key]}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40">
                    <Clipboard size={12} /> {copied === key ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre className="p-4 text-xs text-gray-700 bg-gray-50 overflow-x-auto max-h-56 font-mono leading-relaxed">
                  {schemas[key] || <span className="text-gray-400 italic">Not generated yet — click "Generate All Schemas"</span>}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: Social SEO ──────────────────────────────────────────────── */}
      {tab === 'social' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><ShareNetwork size={18} className="text-purple-600" /> Social SEO</h2>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Open Graph (Facebook / LinkedIn)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="OG Title (60–90 chars)"><input value={social.ogTitle} onChange={e => setSocial(p => ({...p, ogTitle: e.target.value}))} className={inp} placeholder="Open Graph title" /></FieldRow>
              <FieldRow label="OG Image URL"><input value={social.ogImage} onChange={e => setSocial(p => ({...p, ogImage: e.target.value}))} className={inp} placeholder="https://…" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="OG Description (100–200 chars)"><textarea value={social.ogDescription} onChange={e => setSocial(p => ({...p, ogDescription: e.target.value}))} rows={2} className={ta} placeholder="Engaging social description" /></FieldRow>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Twitter / X Card</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="Card Type">
                <select value={social.twitterCard} onChange={e => setSocial(p => ({...p, twitterCard: e.target.value}))} className={inp + ' bg-white'}>
                  <option value="summary_large_image">Summary Large Image</option>
                  <option value="summary">Summary</option>
                  <option value="product">Product</option>
                </select>
              </FieldRow>
              <FieldRow label="Twitter Title"><input value={social.twitterTitle} onChange={e => setSocial(p => ({...p, twitterTitle: e.target.value}))} className={inp} placeholder="Twitter card title" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="Twitter Description"><textarea value={social.twitterDescription} onChange={e => setSocial(p => ({...p, twitterDescription: e.target.value}))} rows={2} className={ta} placeholder="Twitter card description" /></FieldRow>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Pinterest Rich Pin</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldRow label="Pinterest Image URL"><input value={social.pinterestImage} onChange={e => setSocial(p => ({...p, pinterestImage: e.target.value}))} className={inp} placeholder="https://…" /></FieldRow>
              <div className="md:col-span-2">
                <FieldRow label="Pinterest Description"><textarea value={social.pinterestDescription} onChange={e => setSocial(p => ({...p, pinterestDescription: e.target.value}))} rows={2} className={ta} placeholder="Pinterest description with keywords" /></FieldRow>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: AI Content ──────────────────────────────────────────────── */}
      {tab === 'content' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><Sparkle size={18} className="text-purple-600" /> AI Content</h2>
            {aiLoading && aiSection !== 'all' && <p className="text-xs text-purple-600 animate-pulse">{aiStatus}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4">
            {[
              { label: 'Premium Product Title', field: 'premiumTitle', section: 'Premium Title', type: 'input' },
              { label: 'Short Description (2–3 sentences)', field: 'shortDescription', section: 'Short Description', type: 'textarea2' },
              { label: 'Luxury Product Description (200+ words)', field: 'luxuryDescription', section: 'Luxury Description', type: 'textarea6' },
              { label: 'Care Instructions', field: 'careInstructions', section: 'Care Instructions', type: 'textarea2' },
              { label: 'Warranty Text', field: 'warrantyText', section: 'Warranty Text', type: 'textarea2' },
              { label: 'Shipping Information', field: 'shippingInfo', section: 'Shipping Info', type: 'textarea2' },
            ].map(({ label, field, section, type }) => (
              <div key={field} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">{label}</label>
                  <RegenBtn section={section} field={field} />
                </div>
                {type === 'input' ? (
                  <input value={(content[field as keyof ContentData] as string) || ''} onChange={e => setContent(p => ({...p, [field]: e.target.value}))} className={inp} placeholder={`AI will generate ${label.toLowerCase()}…`} />
                ) : (
                  <textarea value={(content[field as keyof ContentData] as string) || ''} onChange={e => setContent(p => ({...p, [field]: e.target.value}))} rows={type === 'textarea6' ? 6 : 2} className={ta} placeholder={`AI will generate ${label.toLowerCase()}…`} />
                )}
              </div>
            ))}
            {/* Bullet Features */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Bullet Features</label>
                <RegenBtn section="Bullet Features" field="bulletFeatures" />
              </div>
              <div className="space-y-2">
                {content.bulletFeatures.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-purple-400 text-sm">•</span>
                    <input value={f} onChange={e => setContent(p => ({...p, bulletFeatures: p.bulletFeatures.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, bulletFeatures: p.bulletFeatures.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, bulletFeatures: [...p.bulletFeatures, '']}))} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"><Plus size={12} /> Add Feature</button>
              </div>
            </div>
            {/* Benefits */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Benefits</label>
                <RegenBtn section="Benefits" field="benefits" />
              </div>
              <div className="space-y-2">
                {content.benefits.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-green-400 text-sm">✓</span>
                    <input value={b} onChange={e => setContent(p => ({...p, benefits: p.benefits.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, benefits: p.benefits.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, benefits: [...p.benefits, '']}))} className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1"><Plus size={12} /> Add Benefit</button>
              </div>
            </div>
            {/* Use Cases */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Use Cases</label>
                <RegenBtn section="Use Cases" field="useCases" />
              </div>
              <div className="space-y-2">
                {content.useCases.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-blue-400 text-sm">→</span>
                    <input value={u} onChange={e => setContent(p => ({...p, useCases: p.useCases.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, useCases: p.useCases.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, useCases: [...p.useCases, '']}))} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"><Plus size={12} /> Add Use Case</button>
              </div>
            </div>
            {/* Specs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Technical Specifications</label>
                <RegenBtn section="Specifications" field="specifications" />
              </div>
              <div className="space-y-2">
                {Object.entries(content.specifications).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <input value={k} readOnly className="w-36 border border-gray-100 rounded-lg px-2.5 py-1.5 text-xs bg-gray-50 font-medium text-gray-600" />
                    <span className="text-gray-400">:</span>
                    <input value={v} onChange={e => setContent(p => ({ ...p, specifications: { ...p.specifications, [k]: e.target.value } }))} className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => { const s = {...p.specifications}; delete s[k]; return {...p, specifications: s}; })} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                {!Object.keys(content.specifications).length && <p className="text-xs text-gray-400 italic">No specs yet — use AI Generate or add manually</p>}
              </div>
            </div>
            {/* Package Contents */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Package Contents</label>
                <RegenBtn section="Package Contents" field="packageContents" />
              </div>
              <div className="space-y-2">
                {content.packageContents.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">📦</span>
                    <input value={item} onChange={e => setContent(p => ({...p, packageContents: p.packageContents.map((x,j) => j===i ? e.target.value : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                    <button onClick={() => setContent(p => ({...p, packageContents: p.packageContents.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, packageContents: [...p.packageContents, '']}))} className="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"><Plus size={12} /> Add Item</button>
              </div>
            </div>
            {/* FAQs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">FAQs (used in FAQ Schema)</label>
                <RegenBtn section="FAQs" field="faqs" />
              </div>
              <div className="space-y-3">
                {content.faqs.map((faq, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <input value={faq.q} onChange={e => setContent(p => ({...p, faqs: p.faqs.map((x,j) => j===i ? {...x, q: e.target.value} : x)}))} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white font-medium focus:ring-1 focus:ring-purple-500 focus:outline-none" placeholder="Question?" />
                      <button onClick={() => setContent(p => ({...p, faqs: p.faqs.filter((_,j) => j !== i)}))} className="text-gray-400 hover:text-red-500 mt-1"><X size={14} /></button>
                    </div>
                    <textarea value={faq.a} onChange={e => setContent(p => ({...p, faqs: p.faqs.map((x,j) => j===i ? {...x, a: e.target.value} : x)}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none resize-none" placeholder="Answer…" />
                  </div>
                ))}
                <button onClick={() => setContent(p => ({...p, faqs: [...p.faqs, {q:'', a:''}]}))} className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"><Plus size={12} /> Add FAQ</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: SEO Analysis ────────────────────────────────────────────── */}
      {tab === 'analysis' && (
        <div className="space-y-4">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><TrendUp size={18} className="text-purple-600" /> Live SEO Analysis</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <ScoreCircle label="SEO Score" value={score.overall} />
            <ScoreCircle label="Readability" value={score.readability} />
            <ScoreCircle label="KW Density" value={score.keywordDensity} unit="%" />
            <ScoreCircle label="Meta Chars" value={score.metaLength >= 120 && score.metaLength <= 160 ? 100 : score.metaLength >= 80 ? 65 : 30} />
            <ScoreCircle label="Title Chars" value={score.titleLength >= 50 && score.titleLength <= 60 ? 100 : score.titleLength >= 30 ? 65 : 30} />
            <ScoreCircle label="Image ALT" value={score.missingAlt === 0 ? 100 : 0} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.titleLength}</p>
              <p className="text-xs text-gray-500">Title length <span className="text-gray-400">(ideal 50–60)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.titleLength >= 50 && score.titleLength <= 60 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (score.titleLength/70)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.metaLength}</p>
              <p className="text-xs text-gray-500">Meta length <span className="text-gray-400">(ideal 120–160)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.metaLength >= 120 && score.metaLength <= 160 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (score.metaLength/200)*100)}%` }} /></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-3xl font-bold text-gray-900">{score.keywordDensity.toFixed(1)}%</p>
              <p className="text-xs text-gray-500">Keyword density <span className="text-gray-400">(ideal 1–3%)</span></p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${score.keywordDensity >= 1 && score.keywordDensity <= 3 ? 'bg-green-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, score.keywordDensity * 25)}%` }} /></div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Issues & Recommendations</h3>
            {score.issues.length === 0 ? (
              <p className="text-gray-400 text-sm italic">Generate content to see analysis…</p>
            ) : (
              <div className="space-y-1.5">
                {score.issues.map((issue, i) => (
                  <div key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${issue.type === 'good' ? 'bg-green-50' : issue.type === 'warning' ? 'bg-sky-50' : 'bg-red-50'}`}>
                    <span>{_issueIcon(issue.type)}</span>
                    <span className={issue.type === 'good' ? 'text-green-800' : issue.type === 'warning' ? 'text-blue-800' : 'text-red-800'}>{issue.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Internal Link Suggestions */}
          {selProduct && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><LinkSimple size={15} /> Internal Link Suggestions</h3>
              <div className="space-y-2">
                {products.filter(p => p.id !== selId && p.category === selProduct.category).slice(0,4).map(p => (
                  <div key={p.id} className="flex items-center gap-3 text-sm p-2 rounded-lg hover:bg-gray-50">
                    <span className="text-purple-400">→</span>
                    <span className="text-gray-700">{p.name}</span>
                    <span className="text-gray-400 text-xs ml-auto font-mono">/#/products/{p.id}</span>
                  </div>
                ))}
                {!products.filter(p => p.id !== selId && p.category === selProduct.category).length && <p className="text-gray-400 text-sm italic">No related products in same category</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Preview ─────────────────────────────────────────────────── */}
      {tab === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {([['desktop','💻 Desktop'],['mobile','📱 Mobile'],['facebook','👥 Facebook'],['twitter','🐦 Twitter']] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setPreviewMode(mode)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${previewMode === mode ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-purple-50'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Google Desktop Preview */}
          {previewMode === 'desktop' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Monitor size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Google MagnifyingGlass — Desktop</span>
              </div>
              <div className="border border-gray-200 rounded-xl p-5 max-w-2xl bg-white font-sans">
                <p className="text-xs text-gray-500 mb-1">https://luxedge.us › products › {seo.slug || 'product'}</p>
                <p className="text-xl text-blue-700 hover:underline cursor-pointer font-medium leading-tight mb-1">{seo.title || selProduct?.name || 'SEO Title will appear here'}</p>
                <p className="text-sm text-gray-600 leading-relaxed">{seo.metaDescription || 'Meta description will appear here. It shows up to 160 characters in Google search results.'}</p>
              </div>
              <p className="text-xs text-gray-400 mt-3">Title: {seo.title.length}/60 chars · Meta: {seo.metaDescription.length}/160 chars</p>
            </div>
          )}

          {/* Google Mobile Preview */}
          {previewMode === 'mobile' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <DeviceMobile size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Google MagnifyingGlass — Mobile</span>
              </div>
              <div className="max-w-sm mx-auto">
                <div className="border border-gray-200 rounded-2xl p-4 bg-white font-sans shadow-sm">
                  <p className="text-xs text-green-600 mb-0.5">luxedge.us › {seo.slug || 'products'}</p>
                  <p className="text-base text-blue-700 font-medium leading-tight mb-1 line-clamp-2">{seo.title || 'SEO Title'}</p>
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{seo.metaDescription || 'Meta description shown in mobile search results.'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Facebook Preview */}
          {previewMode === 'facebook' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <ShareNetwork size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-500">Facebook / Open Graph Preview</span>
              </div>
              <div className="max-w-lg mx-auto border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
                {social.ogImage ? (
                  <img src={social.ogImage} alt="" className="w-full h-52 object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                ) : (
                  <div className="w-full h-52 bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">1200×630 OG Image</p>
                  </div>
                )}
                <div className="p-3 bg-gray-50 border-t border-gray-200">
                  <p className="text-xs text-gray-500 uppercase">LUXEDGE.US</p>
                  <p className="font-bold text-gray-900 text-sm leading-tight mt-0.5">{social.ogTitle || seo.title || 'OG Title'}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{social.ogDescription || seo.metaDescription || 'OG Description'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Twitter Preview */}
          {previewMode === 'twitter' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-gray-400 text-sm font-bold">𝕏</span>
                <span className="text-sm font-medium text-gray-500">Twitter / X Card Preview</span>
              </div>
              <div className="max-w-lg mx-auto border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                {social.ogImage ? (
                  <img src={social.ogImage} alt="" className="w-full h-48 object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                ) : (
                  <div className="w-full h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                    <p className="text-gray-400 text-sm">Twitter Card Image</p>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-bold text-gray-900 text-sm">{social.twitterTitle || seo.title || 'Twitter Title'}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{social.twitterDescription || seo.metaDescription || 'Twitter description'}</p>
                  <p className="text-xs text-gray-400 mt-1">luxedge.us</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ============================================================================
// ENTERPRISE VARIANT GENERATOR
// ============================================================================
const VARIANT_ATTRIBUTE_PRESETS: Record<string, string[]> = {
  Colors: ['Black','White','Gray','Navy','Red','Blue','Green','Yellow','Pink','Purple','Orange','Brown','Beige','Gold','Silver'],
  Sizes: ['XS','S','M','L','XL','XXL','XXXL','One Size','6','7','8','9','10','11','12'],
  Materials: ['Cotton','Polyester','Nylon','Leather','Stainless Steel','Aluminum','Silicone','Wood','Bamboo','Canvas','Linen'],
  Storage: ['16GB','32GB','64GB','128GB','256GB','512GB','1TB'],
  Styles: ['Classic','Modern','Vintage','Minimalist','Sport','Casual','Formal','Bohemian'],
  'Bundle Options': ['Single','2-Pack','3-Pack','5-Pack','10-Pack','Starter Kit','Pro Kit','Family Pack'],
};

const ATTR_ICONS: Record<string, string> = {
  Colors: '🎨', Sizes: '📏', Materials: '🧵', Storage: '💾', Styles: '✨', 'Bundle Options': '📦',
};

function _makeVid(): string {
  return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _cartesian(attrs: VariantAttribute[]): Record<string,string>[] {
  const active = attrs.filter(a => a.values.length > 0);
  if (!active.length) return [];
  return active.reduce<Record<string,string>[]>((acc, attr) => {
    if (!acc.length) return attr.values.map(v => ({ [attr.name]: v }));
    return acc.flatMap(combo => attr.values.map(v => ({ ...combo, [attr.name]: v })));
  }, []);
}

function _genSKU(base: string, combo: Record<string,string>, idx: number): string {
  const suffix = Object.values(combo).map(v => v.slice(0,3).toUpperCase().replace(/\s/g,'')).join('-');
  return base ? `${base}-${suffix}` : `SKU-${String(idx).padStart(3,'0')}-${suffix}`;
}

function _comboKey(combo: Record<string,string>): string {
  return Object.entries(combo).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}:${v}`).join('|');
}

function _detectAttrsFromProduct(product: Product): VariantAttribute[] {
  const out: VariantAttribute[] = [];
  const colors = new Set<string>();
  const sizes = new Set<string>();
  (product.variants || []).forEach(pv => {
    if (pv.color) colors.add(pv.color);
    if (pv.size && pv.size !== 'One Size') sizes.add(pv.size);
  });
  if (colors.size) out.push({ id: _makeVid(), name: 'Colors', values: [...colors], autoDetected: true });
  if (sizes.size) out.push({ id: _makeVid(), name: 'Sizes', values: [...sizes], autoDetected: true });
  return out;
}

function AVariantGen() {
  const { products, setProducts, notify } = useApp();
  const navigate = useNavigate();

  type VGStep = 'product'|'attributes'|'matrix'|'done';
  const [step, setStep] = useState<VGStep>('product');
  const [selId, setSelId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [manualPrice, setManualPrice] = useState(0);
  const [attrs, setAttrs] = useState<VariantAttribute[]>([
    { id: _makeVid(), name: 'Colors', values: [], autoDetected: false },
    { id: _makeVid(), name: 'Sizes', values: [], autoDetected: false },
  ]);
  const [variants, setVariants] = useState<EnterpriseVariant[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newValInputs, setNewValInputs] = useState<Record<string,string>>({});
  const [editId, setEditId] = useState<string|null>(null);
  const [dupKeys, setDupKeys] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });

  const selProduct = products.find(p => p.id === selId);

  useEffect(() => {
    const p = products.find(x => x.id === selId);
    if (p) {
      const detected = _detectAttrsFromProduct(p);
      if (detected.length) {
        setAttrs(prev => [...detected, ...prev.filter(a => !a.autoDetected)]);
      }
      setManualSku(`PROD-${p.id}`);
      setManualPrice(p.price);
    }
  }, [selId, products]);

  useEffect(() => {
    const keys = variants.map(v => _comboKey(v.combo));
    const seen = new Set<string>();
    const dups = new Set<string>();
    keys.forEach(k => { if (seen.has(k)) dups.add(k); else seen.add(k); });
    setDupKeys(dups);
  }, [variants]);

  function generateMatrix() {
    const combos = _cartesian(attrs);
    if (!combos.length) { notify('Add at least one attribute with values first.', 'error'); return; }
    const base = selProduct ? selProduct.id.toUpperCase() : (manualSku || 'SKU');
    const basePrice = selProduct ? selProduct.price : manualPrice;
    setVariants(combos.map((combo, i) => ({
      id: _makeVid(),
      combo,
      sku: _genSKU(base, combo, i),
      barcode: '',
      costPrice: Math.round(basePrice * 0.45 * 100) / 100,
      sellingPrice: basePrice,
      comparePrice: Math.round(basePrice * 1.25 * 100) / 100,
      inventory: 50,
      weight: selProduct?.weight || '',
      dimensions: selProduct?.dimensions || '',
      image: selProduct?.images?.[0] || '',
      status: 'active' as const,
      lowStockThreshold: 5,
    })));
    setStep('matrix');
  }

  async function aiSuggest() {
    const info = selProduct
      ? `Product: ${selProduct.name}\nCategory: ${selProduct.category}\nDescription: ${selProduct.shortDesc}`
      : `Product: ${manualName}`;
    const prompt = `You are an expert e-commerce product specialist.

For this product, suggest variant attributes with specific realistic values:
${info}

Return ONLY valid JSON:
{
  "attributes": [
    {"name": "Colors", "values": ["Black", "White"]},
    {"name": "Sizes", "values": ["S", "M", "L"]}
  ]
}

Rules:
- Only include attributes that make sense for this specific product
- Provide realistic and specific values (not generic placeholders)
- Max 4 attribute groups, max 6 values each
- Focus on: Colors, Sizes, Materials, Storage, Styles, Bundle Options
- Return ONLY the JSON, no other text`;

    setAiLoading(true);
    setAiStatus('Analyzing product with AI…');
    try {
      const raw = await callAIProvider(prompt, aiProviders, m => setAiStatus(m));
      const cleaned = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      const parsed = JSON.parse(cleaned) as { attributes: { name: string; values: string[] }[] };
      if (parsed.attributes?.length) {
        setAttrs(parsed.attributes.map(a => ({ id: _makeVid(), name: a.name, values: a.values, autoDetected: true })));
        notify(`AI suggested ${parsed.attributes.length} attribute groups`, 'success');
      }
    } catch (e: any) {
      notify(`AI error: ${e.message}`, 'error');
    } finally {
      setAiLoading(false);
      setAiStatus('');
    }
  }

  function addVal(attrId: string) {
    const val = (newValInputs[attrId] || '').trim();
    if (!val) return;
    setAttrs(prev => prev.map(a =>
      a.id === attrId && !a.values.includes(val) ? { ...a, values: [...a.values, val] } : a
    ));
    setNewValInputs(prev => ({ ...prev, [attrId]: '' }));
  }

  function removeVal(attrId: string, val: string) {
    setAttrs(prev => prev.map(a =>
      a.id === attrId ? { ...a, values: a.values.filter(v => v !== val) } : a
    ));
  }

  function removeAttr(attrId: string) {
    setAttrs(prev => prev.filter(a => a.id !== attrId));
  }

  function addAttr() {
    if (!newAttrName.trim()) return;
    setAttrs(prev => [...prev, { id: _makeVid(), name: newAttrName.trim(), values: [], autoDetected: false }]);
    setNewAttrName('');
  }

  function applyPresets(attrId: string, attrName: string) {
    const presets = VARIANT_ATTRIBUTE_PRESETS[attrName] || [];
    setAttrs(prev => prev.map(a =>
      a.id !== attrId ? a : { ...a, values: [...new Set([...a.values, ...presets])] }
    ));
  }

  function updateV(id: string, field: string, value: string | number) {
    setVariants(prev => prev.map(v => v.id === id ? ({ ...v, [field]: value } as EnterpriseVariant) : v));
  }

  function removeV(id: string) {
    setVariants(prev => prev.filter(v => v.id !== id));
  }

  function removeDuplicates() {
    setVariants(prev => {
      const seen = new Set<string>();
      const keep: EnterpriseVariant[] = [];
      for (const v of prev) {
        const k = _comboKey(v.combo);
        if (!seen.has(k)) { seen.add(k); keep.push(v); }
      }
      return keep;
    });
  }

  function saveToProduct() {
    if (!selProduct) { notify('Select a product first', 'error'); return; }
    const newVars: ProductVariant[] = variants.map(v => ({
      id: v.id,
      color: v.combo['Colors'] || v.combo[Object.keys(v.combo)[0]] || 'Default',
      size: v.combo['Sizes'] || v.combo[Object.keys(v.combo)[1]] || 'One Size',
      price: v.sellingPrice,
      salePrice: v.sellingPrice,
      stock: v.inventory,
      sku: v.sku,
      image: v.image || undefined,
    }));
    setProducts(prev => prev.map(p => p.id === selProduct.id ? { ...p, variants: newVars } : p));
    setSaved(true);
    setStep('done');
    notify(`Saved ${variants.length} variants to "${selProduct.name}"`, 'success');
  }

  function resetAll() {
    setSaved(false);
    setStep('product');
    setVariants([]);
    setSelId('');
    setManualName('');
    setManualSku('');
    setManualPrice(0);
    setAttrs([
      { id: _makeVid(), name: 'Colors', values: [], autoDetected: false },
      { id: _makeVid(), name: 'Sizes', values: [], autoDetected: false },
    ]);
  }

  const totalCombos = _cartesian(attrs).length;
  const dupCount = dupKeys.size;
  const editedV = variants.find(v => v.id === editId) ?? null;

  const VG_STEPS: { key: VGStep; label: string }[] = [
    { key: 'product', label: '1. Product' },
    { key: 'attributes', label: '2. Attributes' },
    { key: 'matrix', label: '3. Matrix' },
    { key: 'done', label: '4. Done' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Stack size={24} className="text-purple-600" /> Enterprise Variant Generator
          </h1>
          <p className="text-gray-500 text-sm mt-1">Auto-detect attributes · AI suggestions · Complete variant matrix</p>
        </div>
        <button onClick={() => navigate('/admin/products')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Products
        </button>
      </div>

      {/* Step Progress */}
      <div className="flex items-center gap-0">
        {VG_STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <button
              onClick={() => { if (s.key !== 'done' || saved) setStep(s.key); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                step === s.key ? 'bg-purple-600 text-white' :
                (VG_STEPS.findIndex(x => x.key === step) > i) ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' :
                'text-gray-400 cursor-default'
              }`}
            >{s.label}</button>
            {i < VG_STEPS.length - 1 && <CaretRight size={16} className="text-gray-400 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Product ─────────────────────────────────────────────────── */}
      {step === 'product' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Package size={18} className="text-purple-600" /> Select Product
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Existing Product</label>
                <select value={selId} onChange={e => setSelId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none bg-white">
                  <option value="">-- Select a product to generate variants for --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} · ${p.price}</option>)}
                </select>
              </div>
              {selProduct && (
                <div className="flex items-center gap-4 p-4 bg-purple-50 rounded-xl border border-purple-100">
                  {selProduct.images?.[0] && (
                    <img src={selProduct.images[0]} alt="" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">{selProduct.name}</p>
                    <p className="text-sm text-gray-500">{selProduct.category} · ${selProduct.price}</p>
                    <p className="text-xs text-purple-600 mt-1">
                      {selProduct.variants?.length || 0} existing variants · will be replaced on save
                    </p>
                  </div>
                </div>
              )}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Or set manually (for new products)</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Product Name</label>
                    <input value={manualName} onChange={e => setManualName(e.target.value)}
                      placeholder="e.g. Premium T-Shirt"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Base SKU</label>
                    <input value={manualSku} onChange={e => setManualSku(e.target.value)}
                      placeholder="e.g. TSHIRT-001"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Base Price ($)</label>
                    <input type="number" value={manualPrice || ''} onChange={e => setManualPrice(parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (!selId && !manualName.trim()) { notify('Select a product or enter a product name', 'error'); return; }
                setStep('attributes');
              }}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"
            >
              Next: Configure Attributes <CaretRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Attributes ──────────────────────────────────────────────── */}
      {step === 'attributes' && (
        <div className="space-y-4">
          {/* AI Banner */}
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl p-5 flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="font-semibold">AI Attribute Suggestions</p>
              <p className="text-sm text-purple-100">Let AI analyze your product and suggest realistic variant attributes and values</p>
              {aiStatus && <p className="text-xs text-purple-200 mt-1 animate-pulse">{aiStatus}</p>}
            </div>
            <button onClick={aiSuggest} disabled={aiLoading}
              className="flex items-center gap-2 bg-white text-purple-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-purple-50 disabled:opacity-60 transition-colors whitespace-nowrap flex-shrink-0">
              {aiLoading ? <SpinnerGap size={16} className="animate-spin" /> : <MagicWand size={16} />}
              {aiLoading ? 'Analyzing…' : 'AI Suggest'}
            </button>
          </div>

          {/* Attribute Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {attrs.map(attr => (
              <div key={attr.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg">{ATTR_ICONS[attr.name] || '📋'}</span>
                    <span className="font-semibold text-gray-900">{attr.name}</span>
                    {attr.autoDetected && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Auto-detected</span>
                    )}
                    <span className="text-xs text-gray-400">{attr.values.length} value{attr.values.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {VARIANT_ATTRIBUTE_PRESETS[attr.name] && (
                      <button onClick={() => applyPresets(attr.id, attr.name)}
                        className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-purple-50 transition-colors">
                        <Shuffle size={12} /> Presets
                      </button>
                    )}
                    <button onClick={() => removeAttr(attr.id)}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
                {/* Values */}
                <div className="flex flex-wrap gap-1.5 mb-3 min-h-8">
                  {attr.values.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2.5 py-1 rounded-full border border-purple-100 group">
                      {v}
                      <button onClick={() => removeVal(attr.id, v)} className="hover:text-red-500 ml-0.5 opacity-60 group-hover:opacity-100">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {!attr.values.length && (
                    <span className="text-xs text-gray-400 italic py-1">No values yet — type below or load presets</span>
                  )}
                </div>
                {/* Add value input */}
                <div className="flex gap-2">
                  <input
                    value={newValInputs[attr.id] || ''}
                    onChange={e => setNewValInputs(p => ({ ...p, [attr.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVal(attr.id); } }}
                    placeholder={`Add ${attr.name.toLowerCase()} value…`}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none"
                  />
                  <button onClick={() => addVal(attr.id)}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 transition-colors">
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add custom attribute */}
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Add Custom Attribute</p>
            <div className="flex gap-2">
              <input value={newAttrName} onChange={e => setNewAttrName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttr(); } }}
                placeholder="e.g. Connectivity, Voltage, Finish, Scent…"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              <button onClick={addAttr}
                className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm hover:bg-gray-800 flex items-center gap-2 transition-colors">
                <Plus size={16} /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.keys(VARIANT_ATTRIBUTE_PRESETS).map(preset => (
                <button key={preset} onClick={() => {
                  if (!attrs.find(a => a.name === preset)) {
                    setAttrs(prev => [...prev, { id: _makeVid(), name: preset, values: [], autoDetected: false }]);
                  }
                }} className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full hover:bg-purple-50 hover:text-purple-700 transition-colors">
                  + {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Matrix preview count */}
          {totalCombos > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-center gap-3">
              <Warning size={18} className="text-blue-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800">
                  Will generate <strong>{totalCombos}</strong> variant{totalCombos !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {attrs.filter(a => a.values.length).map(a => `${a.name}(${a.values.length})`).join(' × ')}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep('product')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-4 py-2.5">
              <ArrowLeft size={16} /> Back
            </button>
            <button onClick={generateMatrix} disabled={totalCombos === 0}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
              <Shuffle size={16} /> Generate {totalCombos > 0 ? `${totalCombos} Variants` : 'Matrix'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Matrix ──────────────────────────────────────────────────── */}
      {step === 'matrix' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Variants', value: variants.length, cls: 'text-purple-600' },
              { label: 'Duplicates', value: dupCount, cls: dupCount ? 'text-red-600' : 'text-green-600' },
              { label: 'Active', value: variants.filter(v => v.status === 'active').length, cls: 'text-green-600' },
              { label: 'Low Stock', value: variants.filter(v => v.inventory <= v.lowStockThreshold).length, cls: 'text-blue-600' },
            ].map(s => (
              <div key={s.label} className={`bg-white rounded-xl border p-3 text-center ${s.label === 'Duplicates' && dupCount ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {dupCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700">
              <Warning size={16} className="flex-shrink-0" />
              <span>{dupCount} duplicate combination{dupCount > 1 ? 's' : ''} detected — remove before saving</span>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Table size={18} className="text-purple-600" /> Variant Matrix ({variants.length})
              </h3>
              <div className="flex gap-2">
                <button onClick={() => setStep('attributes')}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg transition-colors">
                  <Sliders size={14} /> Attributes
                </button>
                <button onClick={removeDuplicates} disabled={!dupCount}
                  className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg disabled:opacity-40 transition-colors">
                  <Trash size={14} /> Remove Dupes
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Combination</th>
                    <th className="text-left px-4 py-3 font-medium">SKU</th>
                    <th className="text-right px-4 py-3 font-medium">Cost</th>
                    <th className="text-right px-4 py-3 font-medium">Price</th>
                    <th className="text-right px-4 py-3 font-medium">Compare</th>
                    <th className="text-right px-4 py-3 font-medium">Stock</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="text-center px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {variants.map(v => {
                    const isDup = dupKeys.has(_comboKey(v.combo));
                    const isEd = editId === v.id;
                    return (
                      <tr key={v.id} className={`hover:bg-gray-50 transition-colors ${isDup ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(v.combo).map(([k, val]) => (
                              <span key={k} className="inline-flex items-center gap-0.5 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full border border-purple-100">
                                <span className="text-purple-400 text-[10px]">{k}:</span>{val}
                              </span>
                            ))}
                            {isDup && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">DUPLICATE</span>}
                          </div>
                        </td>
                        {isEd ? (
                          <>
                            <td className="px-3 py-2">
                              <input value={v.sku} onChange={e => updateV(v.id,'sku',e.target.value)} className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.costPrice} onChange={e => updateV(v.id,'costPrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.sellingPrice} onChange={e => updateV(v.id,'sellingPrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.comparePrice} onChange={e => updateV(v.id,'comparePrice',parseFloat(e.target.value)||0)} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" value={v.inventory} onChange={e => updateV(v.id,'inventory',parseInt(e.target.value)||0)} className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <select value={v.status} onChange={e => updateV(v.id,'status',e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="draft">Draft</option>
                              </select>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600">{v.sku}</td>
                            <td className="px-4 py-3 text-right text-xs text-gray-500">${v.costPrice.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right font-semibold">${v.sellingPrice.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-xs text-gray-400 line-through">${v.comparePrice.toFixed(2)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${v.inventory <= v.lowStockThreshold ? 'text-blue-600' : ''}`}>{v.inventory}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v.status === 'active' ? 'bg-green-100 text-green-700' : v.status === 'draft' ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-600'}`}>
                                {v.status}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setEditId(isEd ? null : v.id)}
                              className={`p-1.5 rounded-lg transition-colors ${isEd ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'}`}>
                              {isEd ? <FloppyDisk size={14} /> : <PencilSimple size={14} />}
                            </button>
                            <button onClick={() => removeV(v.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                              <Trash size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Extended fields panel */}
            {editedV && (
              <div className="p-5 bg-purple-50 border-t border-purple-100">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-4">
                  Extended Fields — {Object.values(editedV.combo).join(' / ')}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Barcode (UPC/EAN)</label>
                    <input value={editedV.barcode} onChange={e => updateV(editedV.id,'barcode',e.target.value)}
                      placeholder="123456789012"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Weight</label>
                    <input value={editedV.weight} onChange={e => updateV(editedV.id,'weight',e.target.value)}
                      placeholder="0.5 lbs"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Dimensions</label>
                    <input value={editedV.dimensions} onChange={e => updateV(editedV.id,'dimensions',e.target.value)}
                      placeholder="10×5×2 in"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Low Stock Alert</label>
                    <input type="number" value={editedV.lowStockThreshold}
                      onChange={e => updateV(editedV.id,'lowStockThreshold',parseInt(e.target.value)||0)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Variant Image URL</label>
                    <input value={editedV.image} onChange={e => updateV(editedV.id,'image',e.target.value)}
                      placeholder="https://…"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  {editedV.image && (
                    <div className="flex items-center gap-2">
                      <img src={editedV.image} alt="" className="h-12 w-12 object-cover rounded-lg border border-gray-200"
                        onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                      <span className="text-xs text-gray-500">Preview</span>
                    </div>
                  )}
                </div>
                <button onClick={() => setEditId(null)}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 transition-colors">
                  <FloppyDisk size={14} /> Done Editing
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center">
            <button onClick={() => setStep('attributes')} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-4 py-2.5">
              <ArrowLeft size={16} /> Back to Attributes
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{variants.length} variant{variants.length !== 1 ? 's' : ''} ready</span>
              {selId ? (
                <button onClick={saveToProduct} disabled={!!dupCount || !variants.length}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
                  <FloppyDisk size={16} /> FloppyDisk All to Product
                </button>
              ) : (
                <button onClick={() => { notify('Select a product to save variants', 'error'); setStep('product'); }}
                  className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
                  <Warning size={16} /> Select Product First
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 4: Done ────────────────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle size={40} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Variants Saved!</h2>
          <p className="text-gray-500 max-w-sm">
            <strong>{variants.length}</strong> variant{variants.length !== 1 ? 's' : ''} created for{' '}
            <strong>{selProduct?.name || 'your product'}</strong>
          </p>
          <div className="bg-gray-50 rounded-xl p-4 text-left w-full max-w-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary</p>
            <div className="space-y-1 text-sm">
              <p><span className="text-gray-500">Attributes:</span> {attrs.filter(a => a.values.length).map(a => `${a.name}(${a.values.length})`).join(' × ')}</p>
              <p><span className="text-gray-500">Total combinations:</span> {variants.length}</p>
              <p><span className="text-gray-500">Price range:</span> ${Math.min(...variants.map(v => v.sellingPrice)).toFixed(2)} – ${Math.max(...variants.map(v => v.sellingPrice)).toFixed(2)}</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={resetAll}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              Start Over
            </button>
            <button onClick={() => navigate('/admin/products')}
              className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 flex items-center gap-2 transition-colors">
              <Package size={16} /> View Products
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AI HUB — Unified AI Management Dashboard
// ============================================================================
function AAIHub() {
  const { notify } = useApp();
  const navigate = useNavigate();
  const [aiProviders, setAiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });
  const [serverStatus, setServerStatus] = useState<Record<string, ProviderStatus> | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [orCredits, setOrCredits] = useState<{ total: number; used: number } | null>(null);
  const [checkingCredits, setCheckingCredits] = useState(false);
  const [scrapeTest, setScrapeTest] = useState<{ status: 'idle' | 'testing' | 'ok' | 'fail'; msg: string }>({ status: 'idle', msg: '' });
  /** Verify the server-side scrape path works (SCRAPE_DO_TOKEN configured → scrape.do, else public fallback). */
  const testScraping = async () => {
    setScrapeTest({ status: 'testing', msg: 'Testing server-side page fetch…' });
    try {
      // A small, stable, fetchable page — returns quickly through any working path.
      const raw = await fetchPageContent('https://example.com');
      const parsed = JSON.parse(raw);
      const ok = parsed && typeof parsed.text === 'string' && parsed.text.length > 50;
      setScrapeTest({
        status: ok ? 'ok' : 'fail',
        msg: ok
          ? 'Page fetch works — the server-side scrape path is reachable. Set SCRAPE_DO_TOKEN to unlock AliExpress (JS-rendered) pages.'
          : 'Page fetch returned too little content — check the server /api/fetch-page deployment.',
      });
    } catch (e) {
      setScrapeTest({
        status: 'fail',
        msg: `Page fetch failed: ${(e as Error).message?.slice(0, 160) || 'unknown error'}`,
      });
    }
  };

  const I = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all';

    const save = (updated: AIProvider[]) => {
    setAiProviders(updated);
    saveAIProviders(updated);
    setSaving(true); notify('AI Providers saved!'); setTimeout(() => setSaving(false), 3000);
  };

  useEffect(() => {
    serverProviderStatus().then((s) => {
      const map: Record<string, ProviderStatus> = {};
      s.providers.forEach(p => { map[p.id] = p; });
      setServerStatus(map);
    }).catch(() => setServerStatus({}));
  }, []);

  const testProvider = async (provider: AIProvider) => {
    setTesting(provider.id);
    try {
      const msg = await serverTestProvider(provider.id, provider.defaultModel);
      setTestResult({ ...testResult, [provider.id]: msg });
    } catch (e: any) {
      setTestResult({ ...testResult, [provider.id]: `Error: ${e.message?.slice(0, 80)}` });
    } finally { setTesting(null); }
  };

  const checkOpenRouterCredits = async () => {
    setCheckingCredits(true);
    try {
      const c = await serverOpenRouterCredits();
      setOrCredits({ total: c.total, used: c.used });
    } catch (e: any) { notify(`Credit check failed: ${e.message}`); }
    finally { setCheckingCredits(false); }
  };

  // ── Owner-attached API keys (stored server-side, never in the browser) ──
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keySaving, setKeySaving] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<Record<string, { configured: boolean; source: string; masked: string }>>({});

  const loadKeyStatus = async () => {
    try {
      const token = getAccessToken();
      const res = await fetch('/api/admin/ai-keys', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.ok) {
        const d = await res.json() as { providers: Array<{ id: string; configured: boolean; source: string; masked: string }> };
        const m: Record<string, { configured: boolean; source: string; masked: string }> = {};
        d.providers.forEach(p => { m[p.id] = p; });
        setKeyStatus(m);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { void loadKeyStatus(); }, []);

  const attachKey = async (providerId: string) => {
    const key = (keyInputs[providerId] || '').trim();
    if (key.length < 8) { notify('Paste the full API key or OAuth token first'); return; }
    setKeySaving(providerId);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/admin/ai-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'set', provider: providerId, key }),
      });
      const d = await res.json() as { ok?: boolean; error?: string; masked?: string };
      if (res.ok && d.ok) {
        notify(`Key saved for ${providerId} — live now`);
        setKeyInputs(prev => ({ ...prev, [providerId]: '' }));
        await loadKeyStatus();
        await serverProviderStatus().then((s) => {
          const map: Record<string, ProviderStatus> = {};
          s.providers.forEach(p => { map[p.id] = p; });
          setServerStatus(map);
        }).catch(() => {});
      } else {
        notify(`Save failed: ${d.error || 'unknown error'}`);
      }
    } catch (e: any) { notify(`Save failed: ${e.message}`); }
    finally { setKeySaving(null); }
  };

  const clearKey = async (providerId: string) => {
    setKeySaving(providerId);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/admin/ai-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'clear', provider: providerId }),
      });
      const d = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        notify(`Key removed for ${providerId}`);
        await loadKeyStatus();
      } else {
        notify(`Clear failed: ${d.error || 'unknown error'}`);
      }
    } catch (e: any) { notify(`Clear failed: ${e.message}`); }
    finally { setKeySaving(null); }
  };

const providerIcons: Record<string, string> = {
    openrouter: '\u{1F310}', gemini: '\u{1F916}', deepseek: '\u{1F40B}', codex: '\u{1F9D1}\u{200D}\u{1F4BB}', openai: '\u{1F9E0}', anthropic: '\u{1F9EC}'
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
          <Robot size={26} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Hub</h1>
          <p className="text-sm text-gray-500">Manage AI providers, API keys, credits, and import settings</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => navigate('/admin/ai-import')} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <MagicWand size={16} /> AI Import
          </button>
          <button onClick={() => navigate('/admin/marketing')} className="px-4 py-2 border border-purple-300 text-purple-700 hover:bg-purple-50 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <Megaphone size={16} /> Marketing
          </button>
        </div>
      </div>

      {/* OpenRouter Credits Card */}
      {aiProviders.find(p => p.id === 'openrouter' && p.enabled) && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm text-purple-800 flex items-center gap-2">
              <Globe size={16} /> OpenRouter Credits
            </h2>
            <button onClick={checkOpenRouterCredits} disabled={checkingCredits}
              className="px-3 py-1.5 bg-white border border-purple-200 rounded-lg text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {checkingCredits ? <SpinnerGap size={12} className="animate-spin" /> : <ArrowClockwise size={12} />}
              {checkingCredits ? 'Checking...' : 'Check Credits'}
            </button>
          </div>
          {orCredits ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-purple-700">${orCredits.total.toFixed(2)}</p>
                <p className="text-xs text-gray-500">Total Limit</p>
              </div>
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">${orCredits.used.toFixed(2)}</p>
                <p className="text-xs text-gray-500">Used</p>
              </div>
              <div className="bg-white rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-600">${(orCredits.total - orCredits.used).toFixed(2)}</p>
                <p className="text-xs text-gray-500">Remaining</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-purple-600">Click "Check Credits" to view your OpenRouter balance.</p>
          )}
          <p className="text-xs text-purple-400 mt-2">
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline hover:text-purple-600">Get OpenRouter credits →</a>
          </p>
        </div>
      )}

      {/* AI Providers */}
      <div className="bg-white rounded-2xl border border-purple-200 p-5">
        <h2 className="font-bold text-sm text-gray-700 mb-4 flex items-center gap-2">
          <Robot size={16} className="text-purple-500" /> AI Provider Configuration
        </h2>
        <p className="text-sm text-gray-500 mb-5">Add API keys and select models for each provider. The default provider is used for all AI operations.</p>
        {/* First-run connection status */}
        {(() => {
          const known = Object.entries(keyStatus);
          const connected = known.filter(([, k]) => k.configured);
          if (connected.length === 0) {
            return (
              <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm flex items-start gap-3">
                <Key size={16} className="text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-800">Nothing connected yet</p>
                  <p className="text-amber-700">Attach your first provider key below, then press <strong>Test</strong> to verify it — keys are stored server-side and never live in this browser.</p>
                </div>
              </div>
            );
          }
          return (
            <div className="mb-5 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 flex-wrap text-xs">
              <CheckCircle size={14} className="text-green-600 shrink-0" />
              <span className="font-medium text-green-700">{connected.length} of {known.length} providers connected</span>
              {connected.map(([id]) => (
                <span key={id} className="px-2 py-0.5 bg-white border border-green-200 text-green-700 rounded-full font-medium">{aiProviders.find(p => p.id === id)?.name || id} ✓</span>
              ))}
            </div>
          );
        })()}
        <div className="space-y-3">
          {aiProviders.map((provider, idx) => (
            <div key={provider.id} className={`border rounded-xl p-4 transition-all ${provider.isDefault ? 'border-purple-300 bg-purple-50/50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => save(aiProviders.map((p, i) => ({ ...p, enabled: i === idx ? !p.enabled : p.enabled })))}>
                    {provider.enabled ? <ToggleRight size={24} className="text-green-500" /> : <ToggleLeft size={24} className="text-gray-400" />}
                  </button>
                  <div>
                    <span className="font-semibold text-sm">{providerIcons[provider.id] || ''} {provider.name}</span>
                    {provider.isDefault && <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Default</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => testProvider(provider)} disabled={testing === provider.id}
                    className="px-3 py-1.5 text-xs border rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
                    {testing === provider.id ? <SpinnerGap size={12} className="animate-spin" /> : <Lightning size={12} />}
                    Test
                  </button>
                  {!provider.isDefault && (
                    <button type="button" onClick={() => save(aiProviders.map(p => ({ ...p, isDefault: p.id === provider.id })))}
                      className="text-xs text-purple-600 hover:text-purple-800 font-medium">Make Default</button>
                  )}
                </div>
              </div>
              {testResult[provider.id] && (
                <div className={`mb-3 p-2 rounded-lg text-xs ${testResult[provider.id].startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {testResult[provider.id]}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Server Key</label>
                  <div className={"flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl border " + (serverStatus?.[provider.id]?.configured ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700')}>
                    {serverStatus?.[provider.id]?.configured ? <CheckCircle size={14} className="shrink-0" /> : <Warning size={14} className="shrink-0" />}
                    {serverStatus?.[provider.id]?.configured
                      ? 'Configured on server — key is safe (env var only)'
                      : 'No key yet — paste one above to go live now (a server env var, if set, wins)'}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="password"
                      value={keyInputs[provider.id] || ''}
                      onChange={e => setKeyInputs(prev => ({ ...prev, [provider.id]: e.target.value }))}
                      placeholder={provider.id === 'codex' ? 'Paste ChatGPT OAuth token (Codex subscription)' : `Paste ${provider.name} API key`}
                      className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-purple-400"
                    />
                    <button type="button" onClick={() => attachKey(provider.id)} disabled={keySaving === provider.id}
                      className="px-3 py-2 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold disabled:opacity-50 shrink-0">
                      {keySaving === provider.id ? 'Saving…' : 'Attach Key'}
                    </button>
                    {keyStatus[provider.id]?.source === 'attached' && (
                      <button type="button" onClick={() => clearKey(provider.id)} disabled={keySaving === provider.id}
                        className="px-3 py-2 text-xs border border-red-200 text-red-600 hover:bg-red-50 rounded-lg font-semibold disabled:opacity-50 shrink-0">
                        Remove
                      </button>
                    )}
                  </div>
                  {keyStatus[provider.id]?.source === 'attached' && (
                    <p className="text-[10px] text-gray-400 mt-1">Attached key: {keyStatus[provider.id].masked} — stored server-side only.</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">Keys never live in the browser. All AI calls proxy through /api/ai/*.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Model</label>
                  <select value={provider.defaultModel} onChange={e => setAiProviders(prev => prev.map((p, i) => i === idx ? { ...p, defaultModel: e.target.value } : p))}
                    className={I + ' text-xs'}>
                    {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              {provider.id === 'openrouter' && (
                <p className="text-xs text-gray-400 mt-2">
                  Free models: nvidia/nemotron-3-super-120b-a12b:free (default — 262k context, general purpose), nvidia/nemotron-3.5-lightning:free (1M context, fast), google/gemma-4-31b-it:free, cohere/north-mini-code:free (coding), openrouter/free (auto-routes to whichever free model is available)
                  <br />Paid models require credits. OpenRouter retires free model ids without notice — if a run fails with “does not offer the requested model”, pick another id here (the server also retries the provider default automatically). <a href="https://openrouter.ai/docs" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Docs</a>
                </p>
              )}
              {provider.id === 'gemini' && (
                <p className="text-xs text-gray-400 mt-2">
                  Free tier: 1,500 requests/day. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Get API key</a>
                </p>
              )}
              {provider.id === 'deepseek' && (
                <p className="text-xs text-gray-400 mt-2">
                  Budget-friendly and fast. <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Get API key</a>
                </p>
              )}
            </div>
          ))}
        </div>
        {saving && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-700 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> AI Providers saved successfully!
          </div>
        )}
        <button type="button" onClick={() => save(aiProviders)}
          className="mt-4 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors w-full sm:w-auto justify-center">
          <FloppyDisk size={16} /> FloppyDisk All AI Providers
        </button>
      </div>

      {/* Quick Start Cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <MagicWand size={18} className="text-blue-600" />
            <h3 className="font-bold text-sm">AI Product Import</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">Paste any product URL from AliExpress, Amazon, eBay, Etsy, Walmart, Temu — AI extracts all details.</p>
          <button onClick={() => navigate('/admin/ai-import')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Launch Import →
          </button>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Megaphone size={18} className="text-green-600" />
            <h3 className="font-bold text-sm">AI Content Generators</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">Generate product descriptions, ad copy, emails, social posts, blog ideas with AI.</p>
          <button onClick={() => navigate('/admin/marketing')} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open Marketing →
          </button>
        </div>
        <div className="bg-gradient-to-br from-sky-50 to-orange-50 border border-sky-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <MagnifyingGlass size={18} className="text-blue-600" />
            <h3 className="font-bold text-sm">SEO Engine</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">AI-powered SEO optimization: meta tags, structured data, keyword analysis, content scoring.</p>
          <button onClick={() => navigate('/admin/seo-engine')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open SEO Engine →
          </button>
        </div>
        <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Stack size={18} className="text-pink-600" />
            <h3 className="font-bold text-sm">Variant Generator</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">AI generates product variants (colors, sizes, materials) with SKUs and pricing.</p>
          <button onClick={() => navigate('/admin/variant-gen')} className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-semibold transition-colors">
            Open Variant Gen →
          </button>
        </div>
      </div>

      {/* Scraping Configuration */}
      <div className="bg-white rounded-2xl border border-green-200 p-5">
        <h2 className="font-bold text-sm text-gray-700 mb-4 flex items-center gap-2">
          <LinkSimple size={16} className="text-green-500" /> Web Scraping Configuration
        </h2>
        <div className="rounded-xl border border-dashed border-green-300 bg-green-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-green-700">scrape.do — Free Web Scraper</p>
            <p className="text-xs text-green-600 mt-0.5">1,000 free requests/month · No credit card · Permanent free tier</p>
          </div>
          <ol className="text-xs text-green-700 space-y-1 list-decimal list-inside">
            <li>Go to scrape.do and create a free account</li>
            <li>Add your token as the <span className="font-mono">SCRAPE_DO_TOKEN</span> environment variable on the server (see .env.example)</li>
            <li>Credential-backed scraping then runs through /api/fetch-page — the token never ships to the browser</li>
          </ol>
          <div className="p-3 bg-white/60 border border-green-200 rounded-xl text-xs text-green-800">
            🔒 Luxedge V2: scraping tokens are server-side only. Without a server token, URL import falls back to public proxies.
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={testScraping} disabled={scrapeTest.status === 'testing'}
              className="px-4 py-2 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors">
              {scrapeTest.status === 'testing' ? <SpinnerGap size={12} className="animate-spin" /> : <LinkSimple size={12} />}
              {scrapeTest.status === 'testing' ? 'Testing…' : 'Test scraping connection'}
            </button>
            {scrapeTest.status !== 'idle' && (
              <p className={`text-xs ${scrapeTest.status === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{scrapeTest.msg}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AAIImport() {
  return <AIImportPanel />;
}
// ============================================================================
interface CRMLead {
  id: string; email?: string | null; name?: string | null; phone?: string | null;
  source?: string | null; page_url?: string | null; coupon_code?: string | null;
  coupon_used?: boolean | null; coupon_used_at?: string | null; opted_in?: boolean | null;
  metadata?: unknown; created_at?: string | null;
}

// CRM (Leads) — every welcome-popup email, WhatsApp inquiry and AI chat lands
// here. Search, source/coupon filters, CSV export (Excel/HubSpot-ready).
function ACRM() {
  const { notify } = useApp();
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [couponUsed, setCouponUsed] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const token = getAccessToken();
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (source) q.set('source', source);
      if (couponUsed !== '') q.set('couponUsed', couponUsed);
      const r = await fetch(`/api/crm/list?${q.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      if (Array.isArray(j?.leads)) setLeads(j.leads);
      else { setLeads([]); setErr(j?.error || 'Could not load leads.'); }
    } catch (e) { setLeads([]); setErr(`Request failed: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [search, source, couponUsed]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = async () => {
    try {
      const token = getAccessToken();
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (source) q.set('source', source);
      if (couponUsed !== '') q.set('couponUsed', couponUsed);
      q.set('format', 'csv');
      const r = await fetch(`/api/crm/list?${q.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await r.text();
      if (!r.ok) { notify('CSV export failed', 'error'); return; }
      const blob = new Blob([text], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `luxedge-crm-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      notify('CSV downloaded — ready for Excel / HubSpot import', 'success');
    } catch (e) { notify(`Export failed: ${(e as Error).message}`, 'error'); }
  };

  const sourceBadge: Record<string, string> = {
    welcome_popup: 'bg-blue-100 text-blue-700',
    whatsapp: 'bg-emerald-100 text-emerald-700',
    ai_chat: 'bg-violet-100 text-violet-700',
    manual: 'bg-gray-100 text-gray-600',
    newsletter: 'bg-amber-100 text-amber-700',
  };
  const sourceLabel: Record<string, string> = {
    welcome_popup: 'Welcome coupon', whatsapp: 'WhatsApp', ai_chat: 'AI chat', manual: 'Manual',
    newsletter: 'Newsletter',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><UsersIcon className="text-blue-600" size={22} /> CRM — Leads</h1>
          <p className="text-xs text-gray-500">Every welcome coupon, WhatsApp inquiry &amp; AI chat, in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} disabled={loading} className="px-3 py-2 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5">
            <ArrowClockwise size={13} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={exportCsv} className="btn-glow px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <Download size={13} /> Export CSV (Excel / HubSpot)
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email, name, phone, coupon…"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all" />
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white">
          <option value="">All sources</option>
          <option value="welcome_popup">Welcome coupon</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="ai_chat">AI chat</option>
          <option value="manual">Manual</option>
          <option value="newsletter">Newsletter</option>
        </select>
        <select value={couponUsed} onChange={(e) => setCouponUsed(e.target.value)} className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white">
          <option value="">Coupon: any</option>
          <option value="0">Not used</option>
          <option value="1">Used</option>
        </select>
      </div>

      {/* HubSpot-ready note */}
      <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-100 rounded-xl p-3 text-[11px] text-sky-800 flex items-start gap-2">
        <ShareNetwork size={14} className="mt-0.5 shrink-0 text-sky-600" />
        <p>
          <b>HubSpot-ready.</b> The CSV maps directly to HubSpot contact fields — email, phone and first/last name are standard HubSpot properties; source, page URL and coupon map to custom properties (once in the import wizard). To sync automatically, connect HubSpot later — no schema changes needed.
        </p>
      </div>

      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">{err}</div>}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-xs text-gray-400">Loading leads…</div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <UsersIcon size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-500 font-medium">No leads yet</p>
          <p className="text-xs text-gray-400 mt-1">They appear here when visitors claim the welcome coupon, click WhatsApp or chat with Luxie.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-3 py-2.5 font-semibold">Contact</th>
                  <th className="px-3 py-2.5 font-semibold">Source</th>
                  <th className="px-3 py-2.5 font-semibold">Page</th>
                  <th className="px-3 py-2.5 font-semibold">Coupon</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-colors">
                    <td className="px-3 py-2.5">
                      <p className="text-[12px] font-semibold text-gray-900">{l.name || '—'}</p>
                      <p className="text-[11px] text-gray-500">{l.email || l.phone || 'no contact'}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sourceBadge[l.source || 'manual'] || sourceBadge.manual}`}>
                        {sourceLabel[l.source || 'manual'] || l.source}
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><span className="text-[11px] text-gray-500 font-mono truncate max-w-[140px] block">{l.page_url || '—'}</span></td>
                    <td className="px-3 py-2.5"><span className="text-[11px] font-mono font-semibold text-indigo-700">{l.coupon_code || '—'}</span></td>
                    <td className="px-3 py-2.5">
                      {l.coupon_used ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700">Used ✓</span>
                      ) : l.coupon_code ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">Unused</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 whitespace-nowrap">
                      {l.created_at ? new Date(l.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-gray-50 text-[11px] text-gray-400">{leads.length} lead{leads.length !== 1 ? 's' : ''} · newest first</div>
        </div>
      )}
    </div>
  );
}

function AEmailMarketing() {
  const { notify } = useApp();
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; message?: string; audience?: number; platform?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ configured?: boolean; inbound?: { enabled?: boolean; destination?: string; routes?: string[] }; outbound?: { sender?: string; bindingPresent?: boolean; note?: string } } | null>(null);
  const [testMail, setTestMail] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [testMailMsg, setTestMailMsg] = useState('');
  const [mailRoutes, setMailRoutes] = useState<{ configured?: boolean; routes?: { id?: string; address?: string; local?: string; forwardsTo?: string; enabled?: boolean }[]; destinations?: { email?: string; verified?: boolean }[]; message?: string } | null>(null);
  const [newAddr, setNewAddr] = useState('');
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrMsg, setAddrMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadRoutes = async () => {
    try {
      const token = getAccessToken();
      const r = await fetch('/api/email/routes', { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      setMailRoutes(j);
    } catch { setMailRoutes(null); }
  };
  useEffect(() => { void loadRoutes(); }, []);

  const addAddress = async () => {
    const local = newAddr.trim().toLowerCase().replace(/@.*$/, '');
    if (!local) { setAddrMsg({ ok: false, text: 'Enter an address name, e.g. salman' }); return; }
    setAddrBusy(true); setAddrMsg(null);
    try {
      const token = getAccessToken();
      const r = await fetch('/api/email/routes', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: local, forwardTo: '8002salman@gmail.com' }),
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) { setAddrMsg({ ok: true, text: j.message }); setNewAddr(''); await loadRoutes(); notify(j.message, 'success'); }
      else { setAddrMsg({ ok: false, text: j?.error || j?.message || 'Could not create address' }); }
    } catch (e) { setAddrMsg({ ok: false, text: `Request failed: ${(e as Error).message}` }); }
    finally { setAddrBusy(false); }
  };

  const deleteAddress = async (local: string) => {
    if (!window.confirm(`Delete ${local}@luxedge.us? Emails to it will stop forwarding.`)) return;
    setAddrBusy(true); setAddrMsg(null);
    try {
      const token = getAccessToken();
      const r = await fetch(`/api/email/routes?name=${encodeURIComponent(local)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) { setAddrMsg({ ok: true, text: j.message }); await loadRoutes(); notify(j.message, 'success'); }
      else setAddrMsg({ ok: false, text: j?.error || 'Could not delete address' });
    } catch (e) { setAddrMsg({ ok: false, text: `Request failed: ${(e as Error).message}` }); }
    finally { setAddrBusy(false); }
  };

  const checkEmail = async () => {
    try {
      const token = getAccessToken();
      const r = await fetch('/api/email/status', { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      setEmailStatus(j);
    } catch { setEmailStatus(null); }
  };
  useEffect(() => { void checkEmail(); }, []);

  const sendTestEmail = async () => {
    setTestMail('sending'); setTestMailMsg('');
    try {
      const token = getAccessToken();
      const r = await fetch('/api/email/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: '8002salman@gmail.com', subject: 'Luxedge — Cloudflare email test', text: 'Hi Salman,\n\nThis is a test email sent from sales@luxedge.us through Cloudflare Email Routing / Email Sending. If you received this, outbound email from the site works.\n\n— Luxedge' }),
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) { setTestMail('sent'); setTestMailMsg('Test email sent to 8002salman@gmail.com — check your Gmail inbox.'); notify('Test email sent', 'success'); }
      else { setTestMail('failed'); setTestMailMsg(j?.error || 'Could not send test email.'); notify(j?.error || 'Send failed', 'error'); }
    } catch (e) { setTestMail('failed'); setTestMailMsg(`Request failed: ${(e as Error).message}`); }
  };

  const check = async () => {
    setChecking(true);
    try {
      const token = getAccessToken();
      const r = await fetch('/api/omnisend/status', { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => null);
      setStatus(j);
      if (!j?.connected) notify(j?.message || 'Omnisend connection failed', 'error');
      else notify(j.message || 'Connected', 'success');
    } catch (e) {
      notify(`Could not check Omnisend: ${(e as Error).message}`, 'error');
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => { void check(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><PaperPlaneRight className="text-green-600" size={24} /> Email Marketing</h1>
          <p className="text-sm text-gray-500">Omnisend-powered email, SMS & automation for Luxedge.</p>
        </div>
        <button onClick={check} disabled={checking} className="btn-glow px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2">
          <ArrowClockwise size={15} />{checking ? 'Checking…' : 'Check Connection'}
        </button>
      </div>

      {/* Connection status */}
      <div className={`rounded-xl border p-5 ${status?.connected ? 'bg-green-50 border-green-200' : status?.configured ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2.5 h-2.5 rounded-full ${status?.connected ? 'bg-green-500' : status?.configured ? 'bg-amber-500' : 'bg-gray-400'}`} />
          <p className="font-semibold text-gray-800">
            {status?.connected ? 'Omnisend Connected' : status?.configured ? 'Key configured — connection pending' : 'Omnisend not configured'}
          </p>
        </div>
        <p className="text-sm text-gray-600">{status?.message || 'Checking server configuration…'}</p>
        {status?.audience !== undefined && (
          <p className="text-sm mt-2 font-medium text-green-800">Contact list: <span className="font-bold">{status.audience.toLocaleString()}</span> contacts</p>
        )}
      </div>

      {/* Cloudflare Email Routing & Sending */}
      <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <CloudArrowUp size={20} className="text-blue-600" />
            <div>
              <h2 className="font-bold text-gray-900">Email Routing & Sending — Cloudflare</h2>
              <p className="text-xs text-gray-500">Inbound forwarding + outbound sender for Luxedge (sales@luxedge.us).</p>
            </div>
          </div>
          <button onClick={checkEmail} className="text-xs text-blue-600 hover:underline font-medium">Refresh status</button>
        </div>

        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          {/* Inbound */}
          <div className="bg-white rounded-xl border border-blue-100 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Inbound — Forwarding</p>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <p className="text-sm font-semibold text-gray-800">Email Routing active</p>
            </div>
            <p className="text-xs text-gray-600">
              Emails to <b>anything@luxedge.us</b> (incl. <b>sales@luxedge.us</b>) forward to{' '}
              <b>{emailStatus?.inbound?.destination || '8002salman@gmail.com'}</b> — set up via the Cloudflare API.
            </p>
            <div className="mt-2 space-y-0.5">
              {(emailStatus?.inbound?.routes || ['sales@luxedge.us → 8002salman@gmail.com', 'anything@luxedge.us → 8002salman@gmail.com']).map((r, i) => (
                <p key={i} className="text-[11px] font-mono text-blue-700 bg-blue-50 rounded px-2 py-0.5">{r}</p>
              ))}
            </div>
          </div>

          {/* Outbound */}
          <div className="bg-white rounded-xl border border-blue-100 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Outbound — Sender</p>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full ${emailStatus?.outbound?.bindingPresent ? 'bg-green-500' : 'bg-amber-500'}`} />
              <p className="text-sm font-semibold text-gray-800">sales@luxedge.us {emailStatus?.outbound?.bindingPresent ? '· binding ready' : '· binding pending'}</p>
            </div>
            <p className="text-xs text-gray-600">{emailStatus?.outbound?.note || 'Emails are sent from sales@luxedge.us via the Cloudflare send_email binding.'}</p>
            <button onClick={sendTestEmail} disabled={testMail === 'sending'} className="btn-glow mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
              <PaperPlaneRight size={13} /> {testMail === 'sending' ? 'Sending…' : 'Send test email to 8002salman@gmail.com'}
            </button>
            {testMailMsg && <p className={`mt-2 text-[11px] ${testMail === 'sent' ? 'text-green-700' : 'text-red-600'}`}>{testMailMsg}</p>}
          </div>
        </div>

        {/* Email addresses — create more like salman@luxedge.us */}
        <div className="mt-3 bg-white rounded-xl border border-blue-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Your email addresses (@luxedge.us)</p>
            <button onClick={loadRoutes} className="text-[11px] text-blue-600 hover:underline font-medium">Refresh</button>
          </div>
          {mailRoutes?.configured === false && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-800 mb-3">
              <p className="font-semibold mb-1">Self-service needs one Cloudflare API token</p>
              <p className="text-amber-700">Cloudflare dashboard → My Profile → API Tokens → Create Token → <b>Edit zone DNS</b> template → give it <b>Email Routing Addresses:Edit</b> + <b>Email Routing Rules:Edit</b> → paste the token as worker secret <code className="font-mono bg-amber-100 px-1 rounded">CLOUDFLARE_API_TOKEN</code> → redeploy. Current addresses still work below.</p>
            </div>
          )}
          {(mailRoutes?.routes || []).length > 0 ? (
            <div className="space-y-1.5">
              {(mailRoutes?.routes || []).map((r) => (
                <div key={r.id || r.address} className="flex items-center justify-between gap-2 bg-blue-50/60 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 font-mono">{r.address} <span className="text-[10px] font-normal text-green-600">{r.enabled ? '· active' : '· off'}</span></p>
                    <p className="text-[10px] text-gray-500">forwards to {r.forwardsTo || '—'}</p>
                  </div>
                  <button onClick={() => r.local && deleteAddress(r.local)} disabled={addrBusy} className="shrink-0 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 rounded border border-red-200 disabled:opacity-50">Delete</button>
                </div>
              ))}
            </div>
          ) : mailRoutes?.configured ? (
            <p className="text-[11px] text-gray-400">No custom addresses yet — add one below.</p>
          ) : (
            <p className="text-[11px] text-gray-400">Loading addresses…</p>
          )}
          <div className="flex gap-1.5 mt-3">
            <input value={newAddr} onChange={(e) => setNewAddr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addAddress(); }} placeholder="e.g. salman" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs" aria-label="New email address name" />
            <span className="self-center text-xs text-gray-400 font-mono">@luxedge.us</span>
            <button onClick={addAddress} disabled={addrBusy || !newAddr.trim()} className="btn-glow px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold whitespace-nowrap">{addrBusy ? '…' : 'Add address'}</button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">New addresses forward to 8002salman@gmail.com automatically — emails to <b>anything@luxedge.us</b> already arrive there too (catch-all).</p>
          {addrMsg && <p className={`mt-2 text-[11px] ${addrMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{addrMsg.text}</p>}
        </div>

        {/* DNS checklist */}
        <div className="mt-3 bg-white/70 rounded-xl border border-blue-100 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">DNS records (deliverability)</p>
          <div className="grid sm:grid-cols-3 gap-2 text-[11px]">
            <div className="bg-blue-50 rounded-lg p-2.5"><p className="font-semibold text-gray-800">MX (inbound)</p><p className="text-gray-500 font-mono break-all">route1/2/3.mx.cloudflare.net — already live ✓</p></div>
            <div className="bg-blue-50 rounded-lg p-2.5"><p className="font-semibold text-gray-800">SPF (outbound)</p><p className="text-gray-500 font-mono break-all">v=spf1 include:_spf.mx.cloudflare.net ~all</p></div>
            <div className="bg-blue-50 rounded-lg p-2.5"><p className="font-semibold text-gray-800">DKIM (outbound)</p><p className="text-gray-500">Add the DKIM key Cloudflare generates under Email → Email Sending (dashboard).</p></div>
          </div>
        </div>
      </div>

      {/* Setup card */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-bold text-gray-900 mb-1">1 · Connect Omnisend</h2>
        <p className="text-sm text-gray-500 mb-3">The API key is stored server-side only — it never reaches the browser.</p>
        <ol className="text-sm text-gray-600 space-y-1.5 list-decimal list-inside">
          <li>Open <a className="text-green-700 font-medium underline" href="https://app.omnisend.com" target="_blank" rel="noreferrer">app.omnisend.com</a> → Settings → <span className="font-medium">API keys</span>.</li>
          <li>Create a key with read access to Contacts.</li>
          <li>Add it as <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">OMNISEND_API_KEY</code> in your hosting env:</li>
        </ol>
        <div className="mt-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono">
          Cloudflare → luxedge-production → Settings → Variables &amp; Secrets → add <span className="text-green-700 font-semibold">OMNISEND_API_KEY</span> → redeploy
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { t: 'Open Omnisend', d: 'Campaigns, forms & automation dashboard', h: 'https://app.omnisend.com', c: 'bg-green-600 hover:bg-green-700' },
          { t: 'New Campaign', d: 'Create an email blast for your list', h: 'https://app.omnisend.com/campaigns', c: 'bg-blue-600 hover:bg-blue-700' },
          { t: 'Automations', d: 'Welcome, abandoned-cart & win-back flows', h: 'https://app.omnisend.com/automations', c: 'bg-purple-600 hover:bg-purple-700' },
        ].map((c) => (
          <a key={c.t} href={c.h} target="_blank" rel="noreferrer" className={`btn-glow ${c.c} text-white rounded-xl p-5 shadow-sm`}>
            <p className="font-bold">{c.t}</p>
            <p className="text-xs text-white/80 mt-1">{c.d}</p>
          </a>
        ))}
      </div>

      {/* Playbook */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-bold text-gray-900 mb-3">Luxedge Email Playbook</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="font-semibold text-gray-800 mb-1">Welcome Series</p>
            <p className="text-gray-500">Email 1: welcome + 10% code. Email 2: bestsellers. Email 3: care guide for their pet.</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="font-semibold text-gray-800 mb-1">Abandoned Cart</p>
            <p className="text-gray-500">Wait 1h, then send: “Your pet’s picks are waiting” + product photo + free-shipping nudge.</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="font-semibold text-gray-800 mb-1">Win-back</p>
            <p className="text-gray-500">30 days inactive: “We miss you (and so does Fido)” + new arrivals.</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="font-semibold text-gray-800 mb-1">Post-purchase</p>
            <p className="text-gray-500">Order shipped + review request after 10 days. Never spam — real pet owners only.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AMarketingTraffic() {
  const { notify } = useApp();
  const [globalCfg, setGlobalCfg] = useState<MarketingConfig | null>(null);
  const [cfg, setCfg] = useState<MarketingConfig>(() => JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [adsTxtStatus, setAdsTxtStatus] = useState<'checking' | 'configured' | 'missing' | 'invalid'>('checking');
  const [hasPreview, setHasPreview] = useState(hasPreviewConfig());

  useEffect(() => {
    fetchGlobalConfig().then(g => {
      setGlobalCfg(g);
      const preview = hasPreviewConfig() ? getCachedPreview() : null;
      setCfg(JSON.parse(JSON.stringify(preview || g)));
      setHasPreview(hasPreviewConfig());
    });
  }, []);

  const set = (patch: Partial<MarketingConfig>) => setCfg(c => ({ ...c, ...patch }));
  const setEx = (k: keyof MarketingConfig['exclusions'], v: boolean) => setCfg(c => ({ ...c, exclusions: { ...c.exclusions, [k]: v } }));
  const setPl = (k: PlacementKey, patch: Partial<{ enabled: boolean; slot: string }>) => setCfg(c => ({ ...c, placements: { ...c.placements, [k]: { ...c.placements[k], ...patch } } }));

  const checkAdsTxt = async () => {
    try {
      const r = await fetch('/ads.txt');
      if (!r.ok) { setAdsTxtStatus('missing'); return; }
      const txt = (await r.text()).trim();
      const expected = (cfg.adsTxtRecord || DEFAULT_CONFIG.adsTxtRecord).trim();
      if (txt === expected) setAdsTxtStatus('configured');
      else if (txt.includes('pub-')) setAdsTxtStatus('invalid');
      else setAdsTxtStatus('missing');
    } catch {
      setAdsTxtStatus('missing');
    }
  };
  useEffect(() => { checkAdsTxt(); }, []);

  const handleSave = () => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (Object.keys(errs).length > 0) { notify('Please fix the validation errors', 'error'); return; }
    savePreviewConfig(cfg);
    setHasPreview(true);
    setSaved(true);
    notify('Marketing settings saved (preview for this browser)');
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTest = async () => {
    const errs = validateConfig(cfg);
    setErrors(errs);
    if (Object.keys(errs).length > 0) { setTestResult({ ok: false, msg: 'Configuration has validation errors — fix them first.' }); return; }
    await checkAdsTxt();
    const clientOk = CLIENT_ID_RE.test(cfg.adsenseClientId.trim());
    const mode = activeModeLabel(cfg);
    const bits: string[] = [];
    if (cfg.adsenseEnabled && clientOk) bits.push('AdSense script would load with ' + cfg.adsenseClientId);
    if (cfg.autoAdsEnabled) bits.push('Auto Ads on');
    if (adsTxtStatus === 'configured') bits.push('ads.txt present at /ads.txt');
    if (cfg.gaEnabled && cfg.ga4Id) bits.push('GA4 script would load for ' + cfg.ga4Id);
    setTestResult({ ok: true, msg: `OK — ${mode}. ${bits.join(' · ') || 'Nothing enabled yet.'} Note: this only confirms code config; it is NOT a Google approval.` });
  };

  const copyAdsTxt = async () => {
    try { await navigator.clipboard.writeText(cfg.adsTxtRecord); notify('ads.txt entry copied'); }
    catch { notify('Copy failed — select the text manually', 'error'); }
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'site-config.json';
    a.click();
    URL.revokeObjectURL(url);
    notify('Downloaded site-config.json — commit it to the repo to make these settings global for all visitors');
  };

  const resetGlobal = () => {
    clearPreviewConfig();
    setHasPreview(false);
    if (globalCfg) setCfg(JSON.parse(JSON.stringify(globalCfg)));
    setErrors({});
    notify('Local preview cleared — now using the deployed global config');
  };

  const Toggle = ({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) => (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? 'bg-blue-600' : 'bg-gray-300'}`} role="switch" aria-checked={on} aria-label={label}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );

  const I = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all bg-white';
  const L = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const Card = ({ title, icon, badge, children }: { title: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm flex items-center gap-2">{icon}{title}</h2>
        {badge}
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  );

  const StatusPill = ({ ok, text }: { ok: boolean; text: string }) => (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-400'}`} />{text}
    </span>
  );

  const enabledPlacements = PLACEMENT_KEYS.filter(k => cfg.placements[k].enabled && AD_SLOT_RE.test(cfg.placements[k].slot.trim()));
  const adsenseOk = cfg.adsenseEnabled && CLIENT_ID_RE.test(cfg.adsenseClientId.trim());

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Marketing &amp; Traffic</h1>
        <div className="flex items-center gap-2">
          {hasPreview && <StatusPill ok text="Local preview active (this browser)" />}
          <span className="text-[11px] text-gray-400">Code installed ≠ Google approved</span>
        </div>
      </div>

      {/* Traffic Overview */}
      <Card title="Traffic Overview" icon={<TrendUp size={18} className="text-blue-600" />}>
        <TrafficDashboard />
        <div className="border-t border-gray-100 pt-4">
          <AdSenseEarnings />
        </div>
        <div className="border-t border-gray-100 pt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Google AdSense</p>
            <p className="font-semibold">{adsenseOk ? 'Configured' : cfg.adsenseEnabled ? 'Invalid config' : 'Disabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Auto Ads</p>
            <p className="font-semibold">{adsenseOk && cfg.autoAdsEnabled ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">ads.txt</p>
            <p className="font-semibold">{adsTxtStatus === 'configured' ? 'Configured' : adsTxtStatus === 'checking' ? 'Checking…' : 'Missing / Invalid'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Manual Ad Units</p>
            <p className="font-semibold">{enabledPlacements.length > 0 ? `${enabledPlacements.length} enabled` : 'None enabled'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Google Analytics</p>
            <p className="font-semibold">{cfg.gaEnabled && cfg.ga4Id ? `Connected (${cfg.ga4Id})` : 'Not configured'}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Publisher</p>
            <p className="font-semibold text-[13px]">{cfg.publisherId || '—'}</p>
          </div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 leading-relaxed">
          <strong>Active mode:</strong> {activeModeLabel(cfg)}.
          {!adsenseOk && cfg.adsenseEnabled ? ' Fix the Client ID to enable ads.' : ''}
          The live traffic charts above use your own first-party events from Supabase; these cards below are configuration status only.
        </div>
      </Card>

      {/* Google AdSense */}
      <Card title="Google AdSense" icon={<Megaphone size={18} className="text-blue-600" />} badge={<StatusPill ok={adsenseOk} text={adsenseOk ? 'Configured' : 'Not configured'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Google AdSense</p>
            <p className="text-xs text-gray-400 mt-0.5">Loads the AdSense script on the public storefront.</p>
          </div>
          <Toggle on={cfg.adsenseEnabled} onChange={v => set({ adsenseEnabled: v })} label="Enable Google AdSense" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={L}>AdSense Client ID</label>
            <input className={I + (errors.adsenseClientId ? ' border-red-300' : '')} value={cfg.adsenseClientId}
              onChange={e => set({ adsenseClientId: e.target.value, publisherId: e.target.value.trim().startsWith('ca-pub-') ? e.target.value.trim().replace('ca-', '') : cfg.publisherId })} />
            {errors.adsenseClientId ? <p className="text-red-500 text-xs mt-1">{errors.adsenseClientId}</p>
              : <p className="text-xs text-gray-400 mt-1">Public Google AdSense publisher/client identifier. This is not a secret API key.</p>}
          </div>
          <div>
            <label className={L}>Publisher ID</label>
            <input className={I + (errors.publisherId ? ' border-red-300' : '')} value={cfg.publisherId}
              onChange={e => set({ publisherId: e.target.value })} />
            {errors.publisherId ? <p className="text-red-500 text-xs mt-1">{errors.publisherId}</p>
              : <p className="text-xs text-gray-400 mt-1">Kept in sync with the Client ID.</p>}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Auto Ads</p>
            <p className="text-xs text-gray-400 mt-0.5">Lets Google decide ad placement automatically. Loads the script once.</p>
          </div>
          <Toggle on={cfg.autoAdsEnabled} onChange={v => set({ autoAdsEnabled: v })} label="Enable Auto Ads" />
        </div>
      </Card>

      {/* ads.txt */}
      <Card title="ads.txt" icon={<FileText size={18} className="text-blue-600" />} badge={
        <StatusPill ok={adsTxtStatus === 'configured'} text={adsTxtStatus === 'configured' ? 'Configured' : adsTxtStatus === 'checking' ? 'Checking…' : adsTxtStatus === 'invalid' ? 'Invalid' : 'Missing'} />
      }>
        <p className="text-xs text-gray-400">Served at <code className="bg-gray-100 px-1 rounded">https://luxedge.us/ads.txt</code> (committed in <code className="bg-gray-100 px-1 rounded">public/ads.txt</code>).</p>
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-gray-200 bg-gray-50 p-3">
          <code className="text-xs font-mono break-all">{cfg.adsTxtRecord}</code>
          <button onClick={copyAdsTxt} className="shrink-0 px-3.5 py-2 bg-white border border-gray-200 hover:border-blue-300 text-xs font-semibold rounded-lg text-gray-700 transition-colors">Copy ads.txt Entry</button>
        </div>
        {adsTxtStatus === 'missing' && <p className="text-xs text-amber-600">ads.txt was not found at /ads.txt in this environment.</p>}
      </Card>

      {/* Ad Placements */}
      <Card title="Ad Placements" icon={<Stack size={18} className="text-blue-600" />} badge={<StatusPill ok={enabledPlacements.length > 0} text={enabledPlacements.length > 0 ? `${enabledPlacements.length} enabled` : 'None enabled'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Manual Ad Units</p>
            <p className="text-xs text-gray-400 mt-0.5">Places ads at the configured spots below.</p>
          </div>
          <Toggle on={cfg.manualAdsEnabled} onChange={v => set({ manualAdsEnabled: v })} label="Enable Manual Ad Units" />
        </div>

        <div className="space-y-3">
          {PLACEMENT_KEYS.map(k => (
            <div key={k} className="rounded-xl border border-gray-100 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{PLACEMENT_LABELS[k]}</p>
                  {cfg.placements[k].enabled && !cfg.placements[k].slot.trim() && (
                    <p className="text-[11px] text-amber-600 mt-0.5">Create an ad unit in Google AdSense and paste its data-ad-slot ID here.</p>
                  )}
                  {errors[`slot_${k}`] && <p className="text-[11px] text-red-500 mt-0.5">{errors[`slot_${k}`]}</p>}
                </div>
                <Toggle on={cfg.placements[k].enabled} onChange={v => setPl(k, { enabled: v })} label={PLACEMENT_LABELS[k]} />
              </div>
              {cfg.placements[k].enabled && (
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-gray-500">Google Ad Slot ID</label>
                  <input className={I + ' mt-1' + (errors[`slot_${k}`] ? ' border-red-300' : '')} placeholder="1234567890"
                    value={cfg.placements[k].slot} onChange={e => setPl(k, { slot: e.target.value.replace(/\D/g, '') })} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Density, Mobile, Exclusions */}
      <Card title="Density & Controls" icon={<Sliders size={18} className="text-blue-600" />}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={L}>Advertising Density (manual placements)</label>
            <select className={I} value={cfg.density} onChange={e => set({ density: e.target.value as MarketingConfig['density'] })}>
              <option value="low">Low</option><option value="balanced">Balanced</option><option value="high">High</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Controls how many Luxedge-managed manual units render per page. Does not override Google Auto Ads.</p>
          </div>
          <div>
            <label className={L}>Mobile Manual Ad Density</label>
            <select className={I} value={cfg.mobileDensity} onChange={e => set({ mobileDensity: e.target.value as MarketingConfig['mobileDensity'] })} disabled={!cfg.showAdsOnMobile}>
              <option value="low">Low</option><option value="balanced">Balanced</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Mobile stays light — fewer, non-overlapping units.</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Show Ads on Mobile</p>
            <p className="text-xs text-gray-400 mt-0.5">Manual ad units on phones &amp; small screens.</p>
          </div>
          <Toggle on={cfg.showAdsOnMobile} onChange={v => set({ showAdsOnMobile: v })} label="Show Ads on Mobile" />
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Disable Ads On</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {([['cart', 'Cart'], ['checkout', 'Checkout'], ['login', 'Login'], ['signup', 'Signup'], ['admin', 'Admin'], ['account', 'Account pages']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5 text-sm cursor-pointer">
                <span>{label}</span>
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={cfg.exclusions[k]} onChange={e => setEx(k, e.target.checked)} />
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Ads NEVER render inside the admin panel regardless of this setting.</p>
        </div>
      </Card>

      {/* Google Analytics */}
      <Card title="Google Analytics" icon={<Globe size={18} className="text-blue-600" />} badge={<StatusPill ok={!!cfg.gaEnabled && !!cfg.ga4Id} text={cfg.gaEnabled && cfg.ga4Id ? 'Connected' : 'Not configured'} />}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Enable Google Analytics (GA4)</p>
            <p className="text-xs text-gray-400 mt-0.5">Loads the gtag.js script and sends page_view + ecommerce events.</p>
          </div>
          <Toggle on={cfg.gaEnabled} onChange={v => set({ gaEnabled: v })} label="Enable Google Analytics" />
        </div>
        <div>
          <label className={L}>GA4 Measurement ID</label>
          <input className={I + (errors.ga4Id ? ' border-red-300' : '')} placeholder="G-XXXXXXXXXX"
            value={cfg.ga4Id} onChange={e => set({ ga4Id: e.target.value })} />
          {errors.ga4Id ? <p className="text-red-500 text-xs mt-1">{errors.ga4Id}</p>
            : <p className="text-xs text-gray-400 mt-1">Paste the GA4 Measurement ID from your Google Analytics property. No API key needed for standard browser tracking.</p>}
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">Events wired to real user actions: <code className="bg-gray-100 px-1 rounded">page_view</code>, <code className="bg-gray-100 px-1 rounded">view_item</code>, <code className="bg-gray-100 px-1 rounded">add_to_cart</code>, <code className="bg-gray-100 px-1 rounded">begin_checkout</code>, <code className="bg-gray-100 px-1 rounded">purchase</code> (fires on the Stripe-hosted checkout success return), <code className="bg-gray-100 px-1 rounded">search</code>. UTM campaign parameters are captured per session.</p>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <FloppyDisk size={16} /> FloppyDisk GearSix
        </button>
        <button onClick={handleTest} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-blue-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <ArrowClockwise size={16} /> Test Configuration
        </button>
        <button onClick={exportConfig} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-blue-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
          <Download size={16} /> Export site-config.json
        </button>
        {hasPreview && (
          <button onClick={resetGlobal} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-red-300 text-gray-700 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
            <ArrowCounterClockwise size={16} /> Reset to Global
          </button>
        )}
      </div>

      {saved && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
          <CheckCircle size={16} /> GearSix saved as a preview for this browser. Download site-config.json and commit it to the repo to make these settings global for all visitors.
        </div>
      )}
      {testResult && (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${testResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {testResult.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <Warning size={16} className="mt-0.5 shrink-0" />}
          {testResult.msg}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 leading-relaxed">
        <strong className="text-gray-700">Global deployment note:</strong> This project is a static site served by Vercel with no backend. Browser
        localStorage only previews changes on this device. To make settings apply to <em>all</em> visitors, download
        <code className="bg-white px-1 rounded"> site-config.json </code>, commit it to the repo at
        <code className="bg-white px-1 rounded"> public/site-config.json </code>, and deploy. The <code className="bg-white px-1 rounded">ads.txt</code>
        file at the site root ships with every deploy. A cookie-consent banner is implemented on the storefront: AdSense and GA4 scripts only load
        after a visitor clicks "Accept All". If you serve personalized ads in the EEA/UK, connect a Google-certified CMP (Consent Management Platform)
        from your AdSense dashboard and paste its ID in the GA4 tag here.
      </div>
    </div>
  );
}


// ============================================================================
// ============================================================================
// ADMIN ROUTES — mounted by App.tsx under /admin/* (lazy-loaded)
// ============================================================================

// Error boundary so a render failure inside the admin chunk shows a message
// instead of unmounting the whole app.
class AdminErrorBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(err: unknown) { return { err: String((err as Error)?.message || err) }; }
  render() {
    if (this.state.err) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <div className="max-w-md w-full bg-white rounded-2xl border border-red-200 p-8 text-center shadow-sm">
            <Warning size={32} className="mx-auto mb-4 text-red-500" />
            <h1 className="text-lg font-bold text-gray-900 mb-2">Something went wrong in the admin area</h1>
            <p className="text-sm text-gray-500 mb-4">{this.state.err}</p>
            <a href="/admin" className="inline-block px-5 py-2.5 bg-[#1E4636] hover:bg-[#143023] text-white text-sm font-semibold rounded-xl transition-colors">Retry</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AdminSection() {
  return (
    <AdminErrorBoundary>
    {/* Nested Routes match RELATIVE to the parent /admin/* route (v6). */}
    <Routes>
      <Route path="" element={<AdminLayout><ADashboard /></AdminLayout>} />
      <Route path="products" element={<AdminLayout><CatalogProductsPage /></AdminLayout>} />
      <Route path="products/new" element={<AdminLayout><CatalogProductEditor /></AdminLayout>} />
      <Route path="products/edit/:id" element={<AdminLayout><CatalogProductEditor /></AdminLayout>} />
      <Route path="promotions" element={<AdminLayout><CatalogPromotionsPage /></AdminLayout>} />
      <Route path="orders" element={<AdminLayout><AOrders /></AdminLayout>} />
      <Route path="sales" element={<AdminLayout><LuxedgeSales /></AdminLayout>} />
      <Route path="gift-drop" element={<AdminLayout><GiftDropAdmin /></AdminLayout>} />
      <Route path="campaigns" element={<AdminLayout><CampaignManager /></AdminLayout>} />
      <Route path="users" element={<AdminLayout><AUsers /></AdminLayout>} />
      <Route path="categories" element={<AdminLayout><ACategories /></AdminLayout>} />
      <Route path="reviews" element={<AdminLayout><AReviews /></AdminLayout>} />
      <Route path="blogs" element={<AdminLayout><BlogManager /></AdminLayout>} />
      <Route path="media" element={<AdminLayout><MediaManager /></AdminLayout>} />
      <Route path="seo-engine" element={<AdminLayout><ASEOEngine /></AdminLayout>} />
      <Route path="marketing" element={<AdminLayout><AMarketingGen /></AdminLayout>} />
      <Route path="variant-gen" element={<AdminLayout><AVariantGen /></AdminLayout>} />
      <Route path="ai" element={<AdminLayout><AAIHub /></AdminLayout>} />
      <Route path="ai-import" element={<AdminLayout><AAIImport /></AdminLayout>} />
      <Route path="listing-task" element={<AdminLayout><ListingTaskAdmin /></AdminLayout>} />
      <Route path="scout" element={<AdminLayout><ProductScout /></AdminLayout>} />
      <Route path="product-research" element={<AdminLayout><ProductResearch /></AdminLayout>} />
      <Route path="ai-control" element={<AdminLayout><AiControlCenter /></AdminLayout>} />
      <Route path="hermes-intel" element={<AdminLayout><HermesIntel /></AdminLayout>} />
      <Route path="cj-setup" element={<AdminLayout><CJSetup /></AdminLayout>} />
      <Route path="payments" element={<AdminLayout><PaymentsSetup /></AdminLayout>} />
      <Route path="shipping" element={<AdminLayout><ShippingSetup /></AdminLayout>} />
      <Route path="settings" element={<AdminLayout><ASettings /></AdminLayout>} />
      <Route path="settings/listing-playbook" element={<AdminLayout><ListingPlaybookAdmin /></AdminLayout>} />
      <Route path="marketing-traffic" element={<AdminLayout><AMarketingTraffic /></AdminLayout>} />
      <Route path="email-marketing" element={<AdminLayout><AEmailMarketing /></AdminLayout>} />
      <Route path="crm" element={<AdminLayout><ACRM /></AdminLayout>} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
    </AdminErrorBoundary>
  );
}
