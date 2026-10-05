// ============================================================================
// AI PRODUCT IMPORT ENGINE - shared panel used by the Admin sidebar route
// (/admin/ai-import) and the Add Product editor AI Import mode.
// ============================================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { loadAIProviders } from '../features/ai/providers';
import { callAIProvider } from '../features/ai/client';
import {
  buildExtractionPrompt, fetchPageContent, extractAliExpressItemId, assessAliExpressRisk,
  buildImportImages, buildImportVariants, buildImportProductInput,
  buildStorageImageInputs, importProductImagesToStorage,
  buildScrapedEvidenceProduct, mergeScrapedWithAi, requireReviewEvidence, isEmptyExtraction, parseHtmlPage
} from '../features/ai/importer';
import type { AIProvider, AIExtractedProduct, ImportHistoryEntry } from '../features/ai/types';
import { loadProviderSettings } from '../features/ai/providers';
import { createProduct, updateProduct, saveProductImages, saveProductVariants, listCategories, setDbToken, checkProductDuplicate } from '../features/catalog/repository';
import {
  getListingPlaybook, getImportHistory, appendImportHistory,
  supplierBrandForUrl, rulesForCategory, effectiveStatusForImport,
  type ListingPlaybook, type PlaybookImportHistoryEntry,
} from '../features/catalog/listingPlaybook';
import { getFreshAccessToken } from '../services/supabase';
import {
  ArrowClockwise, ArrowLeft, CheckCircle, Clipboard, ClockCounterClockwise,
  CurrencyDollar, FileText, Globe, Image as ImageIcon, LinkSimple, MagicWand,
  Package, PencilSimpleLine, Robot, Sparkle, SpinnerGap, Star, Tag, UploadSimple, Warning, BookBookmark,
} from '@phosphor-icons/react';
// ============================================================================
// AI PRODUCT IMPORT ENGINE
// ============================================================================
const SUPPORTED_PLATFORMS = ['AliExpress','Alibaba','Amazon','eBay','Etsy','Walmart','Temu','CJ Dropshipping','Daraz','Shopify Stores','Any public product page'];

function detectPlatform(url: string): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('aliexpress.com') || u.includes('aliexpress.us')) return 'AliExpress';
  if (u.includes('alibaba.com')) return 'Alibaba';
  if (u.includes('amazon.com') || u.includes('amzn.to')) return 'Amazon';
  if (u.includes('ebay.com') || u.includes('ebay.co')) return 'eBay';
  if (u.includes('etsy.com')) return 'Etsy';
  if (u.includes('walmart.com')) return 'Walmart';
  if (u.includes('temu.com')) return 'Temu';
  if (u.includes('daraz.pk') || u.includes('daraz.com')) return 'Daraz';
  if (u.includes('cjdropshipping.com')) return 'CJ Dropshipping';
  if (u.includes('myshopify.com') || u.includes('shopify.com')) return 'Shopify Store';
  if (u.startsWith('http')) return 'Website';
  return null;
}

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-600 bg-green-50' : score >= 50 ? 'text-blue-600 bg-sky-50' : 'text-red-500 bg-red-50';
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${color}`}>{score}%</span>;
}

export function AIImportPanel() {
  const { notify } = useApp();
  const navigate = useNavigate();

  type ImportSource = 'url'|'html'|'text'|'clipboard'|'image';
  type ImportStep = 'source'|'input'|'processing'|'preview'|'done'|'history';

  const [step, setStep] = useState<ImportStep>('source');
  const [source, setSource] = useState<ImportSource>('url');

  // Inputs
  const [urlInput, setUrlInput] = useState('');
  const [htmlInput, setHtmlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{msg:string;ok:boolean}[]>([]);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<any>(null);

  // Results
  const [extracted, setExtracted] = useState<AIExtractedProduct|null>(null);
  const [editField, setEditField] = useState<Partial<AIExtractedProduct>>({});
  const [selectedImgs, setSelectedImgs] = useState<string[]>([]);
  const [heroImg, setHeroImg] = useState('');
  const [saving, setSaving] = useState(false);
  const [dupProduct, setDupProduct] = useState<{ id: string; name: string } | null>(null);

  // Providers — 'auto' uses the configured default/fallback routing (Settings
  // → AI Providers); any other value forces that provider for this import and
  // keeps the configured fallback for automatic failover on the server.
  const [aiProviders] = useState<AIProvider[]>(() => {
    return loadAIProviders();
  });
  const [importProvider, setImportProvider] = useState<string>('auto');

  // ClockCounterClockwise — DB-backed history (localStorage is a fallback only).
  const [history, setHistory] = useState<PlaybookImportHistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('luxedge_import_history')||'[]').map((e: PlaybookImportHistoryEntry) => ({ ...e, store: 'local' as const })); }
    catch { return []; }
  });
  const [playbook, setPlaybook] = useState<ListingPlaybook | null>(null);

  useEffect(() => {
    // Listing Playbook (DB) + import history (DB) load together on mount.
    void getListingPlaybook().then(setPlaybook);
    void getImportHistory().then((h) => { if (h.length) setHistory(h); });
  }, []);

  const addLog = (msg: string, ok=true) => setProgress(p => [...p, {msg, ok}]);

  const startTimer = () => {
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-t0)/1000)), 200);
  };
  const stopTimer = () => { clearInterval(timerRef.current); };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (text) setTextInput(text);
  }, []);

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => { setTextInput(`[Image uploaded: ${file.name}] ${ev.target?.result as string}`); };
      reader.readAsDataURL(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setTextInput(`[Image: ${file.name}] ${dataUrl}`);
        addLog(`Image loaded: ${file.name}`);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImport = async () => {
    setLoading(true); setError(''); setProgress([]); setElapsed(0);
    setStep('processing'); startTimer();
    try {
      let rawContent = '';
      let pageImages: string[] = [];
      let parsed: any = null;

      if (source === 'url') {
        if (!urlInput.trim()) throw new Error('Please enter a URL');
        addLog(`Fetching: ${urlInput}`);
        const pageData = await fetchPageContent(urlInput.trim());
        parsed = JSON.parse(pageData);
        rawContent = parsed.text;
        pageImages = parsed.images || [];
        const parsedTitle = (parsed.title || '').trim();
        const parsedDesc = (parsed.description || '').trim();
        addLog(`Page fetched — ${rawContent.length} chars, ${pageImages.length} images`, true);
        addLog(`FETCH: SERVER SCRAPE SUCCESS`);
        addLog(`SCRAPED CHARS: ${rawContent.length}`);
        addLog(`SCRAPED TITLE: ${parsedTitle ? 'FOUND' : 'MISSING'}${parsedTitle ? ` — ${parsedTitle.slice(0, 80)}` : ''}`);
        addLog(`SCRAPED IMAGES: ${pageImages.length}`);
        addLog(`JSON-LD PRODUCT: ${parsed.jsonLdProduct ? 'FOUND' : 'MISSING'}`);
        addLog(`SCRAPED DESCRIPTION: ${parsedDesc ? 'FOUND' : 'MISSING'}`);
        addLog(`ITEM ID IN PAGE: ${extractAliExpressItemId(urlInput) ? 'FOUND' : 'MISSING'}`);
        addLog(`TITLE SOURCE: ${parsedTitle ? (parsed.jsonLdProduct ? 'og:title + json-ld' : 'og:title') : (parsed.jsonLdProduct ? 'json-ld' : 'MISSING')}`);
        addLog(`DESCRIPTION SOURCE: ${parsedDesc ? (parsed.jsonLdProduct ? 'og:description + json-ld' : 'og:description') : (parsed.jsonLdProduct ? 'json-ld' : 'MISSING')}`);
      } else if (source === 'html') {
        if (!htmlInput.trim()) throw new Error('Please paste some HTML');
        // A URL pasted into the HTML box means "fetch this page" — route it
        // through the same server/proxy fetch the URL tab uses (anti-bot
        // aware, retries + fallbacks), instead of parsing the URL as HTML.
        const looksLikeUrl = /^https?:\/\//i.test(htmlInput.trim());
        if (looksLikeUrl) {
          const pageData = await fetchPageContent(htmlInput.trim());
          parsed = JSON.parse(pageData);
          rawContent = parsed.text;
          pageImages = parsed.images || [];
          addLog(`URL detected in HTML import — fetched ${rawContent.length} chars, ${pageImages.length} images`, true);
          addLog(`SCRAPED TITLE: ${(parsed.title || '').trim().slice(0, 80) || 'MISSING'}`);
        } else {
          const parser = new DOMParser();
          const doc = parser.parseFromString(htmlInput, 'text/html');
          doc.querySelectorAll('script,style').forEach(el => el.remove());
          pageImages = [];
          // Anti-bot / CSR shells (e.g. AliExpress) have an empty <body> — the
          // real evidence (og:title/og:image, DCData.imagePathList, JSON-LD) is
          // in <head> and script data that DOMParser-based extraction can't see.
          const shellParsed = parseHtmlPage(htmlInput);
          parsed = shellParsed;
          pageImages = [...new Set([...(shellParsed.images || []), ...pageImages])];
          // AliExpress lazy-loads images: real URLs live in srcset (highest
          // width variant), data-src, data-hd-src, and data-ks-lazyload. Plain
          // `src` is often a 1px placeholder — never take it as the only source.
          const pushUrl = (u: string) => {
            const t = (u || '').trim();
            if (/^https?:\/\//i.test(t) && !pageImages.includes(t)) pageImages.push(t);
          };
          doc.querySelectorAll('img').forEach(img => {
            const srcset = img.getAttribute('srcset') || '';
            // srcset: "url 100w, url2 800w" — take the last (largest) entry.
            const parts = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
            if (parts.length) pushUrl(parts[parts.length - 1]);
            ['data-hd-src', 'data-src', 'data-ks-lazyload', 'data-lazy-src', 'src'].forEach(attr => {
              const v = img.getAttribute(attr) || '';
              // AliExpress stores large previews as ".webp_" suffix URLs in
              // data attributes (e.g. "....webp_640x640.webp").
              pushUrl(v.replace(/\.webp_\d+x\d+\.webp$/i, '.webp'));
            });
          });
          // Feed the AI the og:title/description/JSON-LD + body text, not just
          // body innerText — otherwise a shell page gives the model no title.
          rawContent = shellParsed.text || doc.body?.innerText || htmlInput;
          addLog(`HTML processed — ${rawContent.length} chars, ${pageImages.length} images, title=${shellParsed.title ? 'FOUND' : 'MISSING'}`, true);
        }
      } else if (source === 'text' || source === 'clipboard') {
        if (!textInput.trim()) throw new Error('Please paste some content');
        rawContent = textInput;
        addLog(`Content ready — ${rawContent.length} chars`, true);
      } else if (source === 'image') {
        if (!textInput.includes('[Image')) throw new Error('Please upload an image first');
        rawContent = `Product image provided. Extract product information from this image description. Image data: ${textInput.slice(0,200)}...`;
        addLog('Image content prepared', true);
      }

      // ---------------------------------------------------------------------
      // DETERMINISTIC BASE: the scrape output is the base product. AI is only
      // an enrichment layer — an AI failure must NEVER erase real scraped
      // evidence (title/images/description/price) into an empty form.
      // ---------------------------------------------------------------------
      let base: AIExtractedProduct | null = null;
      if (source === 'url') {
        base = buildScrapedEvidenceProduct(parsed, urlInput.trim());
        addLog(`BASE EVIDENCE: title=${base.title ? 'FOUND' : 'MISSING'} images=${base.images.length} desc=${base.shortDescription ? 'FOUND' : 'MISSING'} price=${base.sellingPrice > 0 ? '$' + base.sellingPrice.toFixed(2) : 'UNKNOWN'}`);
      } else if (source === 'html' && parsed?.title) {
        // Same guarantee as the URL path: deterministic evidence (og:title,
        // og:image, DCData gallery, og:url supplier trace) becomes the base
        // product, so an AI failure never blanks the Review form. When the
        // HTML box actually held a URL (already fetched above), that URL is
        // the supplier evidence; otherwise the page's own og:url is used.
        const evUrl = parsed.sourceUrl || (/^https?:\/\//i.test(htmlInput.trim()) ? htmlInput.trim() : '');
        base = buildScrapedEvidenceProduct(parsed, evUrl);
        addLog(`BASE EVIDENCE (HTML): title=${base.title ? 'FOUND' : 'MISSING'} images=${base.images.length} desc=${base.shortDescription ? 'FOUND' : 'MISSING'} itemId=${base.supplierItemId || 'UNKNOWN'}`);
      }

      addLog('AI REQUEST: REACHED — sending to provider');
      let data: AIExtractedProduct | null = null;
      let aiState = 'FAILED';
      let aiJsonParsed = false;
      try {
        const prompt = buildExtractionPrompt(rawContent, source);
        const aiText = await callAIProvider(prompt, aiProviders, (m) => addLog(m), undefined, importProvider);
        addLog('AI RESULT: 200 — provider replied');
        addLog('Parsing AI response…');
        let cleanText = aiText.trim();
        // Strip markdown code fences if present
        if (cleanText.includes('```')) {
          cleanText = cleanText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        }
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        aiJsonParsed = !!jsonMatch;
        if (jsonMatch) {
          try {
            const aiData = JSON.parse(jsonMatch[0]) as AIExtractedProduct;
            if (!isEmptyExtraction(aiData)) {
              data = aiData;
              aiState = 'SUCCESS';
            } else {
              aiState = 'EMPTY';
            }
          } catch (pe) {
            // Repair trailing commas or unescaped newlines in JSON
            try {
              const repaired = jsonMatch[0].replace(/,\s*([\}\]])/g, '$1');
              const aiData = JSON.parse(repaired) as AIExtractedProduct;
              if (!isEmptyExtraction(aiData)) {
                data = aiData;
                aiState = 'SUCCESS';
              }
            } catch {
              addLog('AI JSON format warning: ' + (pe as Error).message, false);
            }
          }
        }
      } catch (e2: any) {
        addLog(`AI RESULT: FAILED — ${e2?.message || 'unknown'}`, false);
      }
      addLog(`AI JSON PARSE: ${aiJsonParsed ? 'OK' : 'FAILED — no JSON object in reply'}`);
      addLog(`AI: ${aiState}`);

      // Merge: scraped base first, AI enrichment layered on top. Scraped
      // images/title/description are NEVER discarded by an empty AI result.
      const final = base ? mergeScrapedWithAi(base, data) : (data ?? null);
      if (!final) throw new Error('No product evidence could be extracted. Try again or paste HTML/text instead.');

      // NEVER open a blank Review — hard gate: a URL import needs a real title
      // AND at least one usable image; paste imports need at least a title.
      const gate = requireReviewEvidence(final, source);
      if (!gate.ok) {
        addLog(`✗ ${gate.reason}`, false);
        throw new Error(gate.reason);
      }

      addLog(`FINAL SOURCE: ${base ? (data ? 'SCRAPE+AI' : 'SCRAPE ONLY') : 'AI ONLY'}`);
      addLog(`FINAL TITLE: ${(final.title || '').slice(0, 80)}`);
      addLog(`FINAL IMAGES: ${(final.images || []).filter((u: string) => u.startsWith('http')).length}`);

      // Merge page images with AI-found images
      const allImages = [...new Set([...(final.images||[]), ...pageImages])].filter(u => u.startsWith('http')).slice(0, 24);
      final.images = allImages;

      setExtracted(final);
      setEditField({...final});
      setSelectedImgs(allImages.slice(0, 6));
      setHeroImg(allImages[0] || '');

      // FloppyDisk history — record the provider actually used for this import.
      const activeProvider =
        (importProvider !== 'auto' && aiProviders.find(p => p.id === importProvider))
        || aiProviders.find(p => p.isDefault && p.enabled)
        || aiProviders.find(p => p.enabled);
      const entry: ImportHistoryEntry = {
        id: `imp-${Date.now()}`, source: source === 'url' ? urlInput : source, sourceType: source,
        date: new Date().toISOString(), provider: activeProvider?.name||'Unknown',
        model: activeProvider?.defaultModel||'Unknown', productTitle: final.title,
        status: 'success', importTime: elapsed * 1000
      };
      const newHist = [entry, ...history].slice(0, 50);
      setHistory(newHist);
      localStorage.setItem('luxedge_import_history', JSON.stringify(newHist));
      // Persist to the database (never blocks the import on failure).
      void appendImportHistory(entry).catch(() => {});

      addLog(`✓ Done in ${elapsed}s — ready to review!`, true);
      setStep('preview');

    } catch (e: any) {
      // Never open a blank Review and never allow saving insufficient evidence:
      // surface the real error and stay on the import form.
      setError(e?.message || 'Import failed');
      addLog(`✗ ${e?.message || 'Import failed'}`, false);
      setStep('input');
    } finally { setLoading(false); stopTimer(); }
  };

  const handleSave = async () => {
    if (!extracted || saving) return;
    const ef = editField;
    const title = ef.title || extracted.title;
    const url = extracted.supplierUrl || urlInput;
    const itemId = extracted.supplierItemId || extractAliExpressItemId(urlInput) || null;

    // AliExpress safety gate — hard-restricted products are never imported.
    const risk = assessAliExpressRisk({
      title,
      brand: ef.brand || extracted.brand,
      riskFlags: extracted.riskFlags,
      batteryElectrical: extracted.batteryElectrical,
      safetyNotes: extracted.safetyNotes,
    });
    if (risk.blocked.length) {
      notify(`Import blocked: ${risk.blocked.join(', ')} — cannot be customer-visible.`, 'error');
      return;
    }

    setSaving(true);
    try {
      // Admin writes flow through the signed-in JWT (RLS governs every mutation).
      // Refresh first — a long-open import form must not write with a stale JWT.
      setDbToken(await getFreshAccessToken());

      // Fast parallel pre-checks: targeted duplicate check & categories lookup
      // Avoids loading thousands of product images/variants into browser memory
      const [dup, cats] = await Promise.all([
        checkProductDuplicate({ url, itemId, title, sku: extracted.sku }),
        listCategories(),
      ]);
      if (dup) {
        setDupProduct({ id: dup.id, name: dup.name });
        notify('DUPLICATE FOUND — open the existing product instead of saving.', 'error');
        return;
      }
      const catName = String(ef.category || extracted.category || '').trim();
      const categoryId = cats.find((c) => c.name.toLowerCase() === catName.toLowerCase())?.id || null;

      // Listing Playbook: brand rule (e.g. HimalayanKoh) + category rules.
      const rules = playbook ? rulesForCategory(playbook, catName) : null;
      const playbookBrand = supplierBrandForUrl(url, rules?.brand);
      const brand = playbookBrand || ef.brand || extracted.brand || 'Luxedge';

      const finalRiskFlags = [...new Set([...(extracted.riskFlags || []), ...risk.warnings])];
      const created = await createProduct(buildImportProductInput({
        title,
        shortDescription: ef.shortDescription || extracted.shortDescription || undefined,
        description: ef.longDescription || extracted.longDescription || undefined,
        features: (extracted.features || []).slice(0, 6),
        specifications: extracted.specifications,
        brand,
        categoryId,
        price: Number(ef.sellingPrice ?? extracted.sellingPrice) || 0,
        supplierListPrice: Number(extracted.sellingPrice) || undefined,
        comparePrice: Number(ef.comparePrice ?? extracted.comparePrice) || undefined,
        costPrice: Number(ef.costPrice ?? extracted.costPrice) || undefined,
        stock: Number(ef.stock ?? extracted.stock) || 0,
        tags: ef.tags || extracted.tags || [],
        seoTitle: ef.seoTitle || extracted.seoTitle || undefined,
        seoDescription: ef.metaDescription || extracted.metaDescription || undefined,
        seoKeywords: extracted.seoKeywords || [],
        url,
        itemId,
        riskFlags: finalRiskFlags,
        shippingToUsa: extracted.shippingToUsa,
        deliveryRangeUsa: extracted.deliveryRangeUsa,
        usStockEvidence: extracted.usStockEvidence,
        imageCount: selectedImgs.length,
      }));

      // Images & Variants — persist immediately to DB in parallel for sub-2-second saving!
      const imageRows: ReturnType<typeof buildImportImages> = selectedImgs.length
        ? buildImportImages(selectedImgs, heroImg || selectedImgs[0])
        : [];
      const variants = buildImportVariants((extracted.variants || []).map((v) => ({ attributes: v.attributes, sku: v.sku, price: v.price })));

      await Promise.all([
        imageRows.length ? saveProductImages(created.id, imageRows, { reload: false }) : Promise.resolve(),
        variants.length ? saveProductVariants(created.id, variants, { reload: false }) : Promise.resolve(),
      ]);

      // Listing Playbook status rule: promote to Active only when the verified
      // image count meets the minimum; otherwise keep Draft.
      let finalStatus = created.status || 'draft';
      if (playbook) {
        const verified = imageRows.length;
        const wanted = effectiveStatusForImport(playbook, catName, verified, rules?.defaultStatus || 'draft');
        if (wanted === 'active' && verified >= (rules?.minImages ?? playbook.global.minImages ?? 3)) {
          const updated = await updateProduct(created.id, { status: 'active' });
          if (updated) finalStatus = 'active';
        }
      }

      // Instant UI completion — notify user and transition to 'done' immediately!
      const riskNote = risk.warnings.length ? ` Risk flags: ${risk.warnings.join('; ')}.` : '';
      notify(`${finalStatus === 'active' ? 'ACTIVE listing saved' : 'DRAFT saved to catalog'} (${created.name}) — ${imageRows.length} image${imageRows.length === 1 ? '' : 's'}, readiness ${created.commerceReadiness || 'DRAFT'}.${riskNote}`);
      setStep('done');

      // Non-blocking background Storage Sync:
      // Downloads supplier CDN images & uploads to Supabase Storage in background.
      // The user is already on 'done' and the listing is fully working!
      if (selectedImgs.length) {
        void (async () => {
          try {
            const sr = await importProductImagesToStorage(created.id, selectedImgs);
            if (sr.ok && sr.uploaded.length) {
              const storageRows = buildStorageImageInputs(sr.uploaded, heroImg || selectedImgs[0]);
              await saveProductImages(created.id, storageRows, { reload: false });
            }
          } catch (e) {
            console.warn('[AIImport] Background image storage sync deferred:', (e as Error).message);
          }
        })();
      }
    } catch (e) {
      notify(`Save failed: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const EF = (field: keyof AIExtractedProduct) => ({
    value: (editField[field] ?? extracted?.[field] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) =>
      setEditField(prev => ({...prev, [field]: e.target.value} as Partial<AIExtractedProduct>))
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';

  // ── SOURCE SELECTION ──
  if (step === 'source') {
    const sources = [
      { id:'url', icon:<LinkSimple size={24}/>, label:'URL Import', desc:'Paste any product URL', color:'bg-blue-50 border-blue-200 hover:border-blue-400', iconColor:'text-blue-600' },
      { id:'html', icon:<FileText size={24}/>, label:'HTML Import', desc:'Paste copied HTML', color:'bg-orange-50 border-orange-200 hover:border-orange-400', iconColor:'text-orange-600' },
      { id:'text', icon:<PencilSimpleLine size={24}/>, label:'Text Import', desc:'Paste product description', color:'bg-green-50 border-green-200 hover:border-green-400', iconColor:'text-green-600' },
      { id:'clipboard', icon:<Clipboard size={24}/>, label:'Clipboard', desc:'Ctrl+V anywhere to paste', color:'bg-purple-50 border-purple-200 hover:border-purple-400', iconColor:'text-purple-600' },
      { id:'image', icon:<ImageIcon size={24}/>, label:'Image UploadSimple', desc:'JPG, PNG, WEBP, GIF', color:'bg-pink-50 border-pink-200 hover:border-pink-400', iconColor:'text-pink-600' },
    ];
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center">
            <Robot size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Product Import Engine</h1>
            <p className="text-sm text-gray-500">Import any product in under 60 seconds using AI</p>
          </div>
          <button onClick={() => setStep('history')} className="ml-auto flex items-center gap-2 px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <ClockCounterClockwise size={16} /> History ({history.length})
          </button>
          <button onClick={() => navigate('/admin/settings/listing-playbook')} className="flex items-center gap-2 px-4 py-2 border border-blue-200 bg-blue-50 rounded-xl text-sm text-blue-700 hover:bg-blue-100 transition-colors" title="Listing Playbook — rules applied to every import">
            <BookBookmark size={16} /> Listing Playbook
          </button>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Choose Import Source</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sources.map(s => (
              <button key={s.id} onClick={() => { setSource(s.id as ImportSource); setStep('input'); }}
                className={`border-2 rounded-2xl p-5 text-left transition-all ${s.color} ${source===s.id?'ring-2 ring-offset-1':''}`}>
                <div className={`mb-3 ${s.iconColor}`}>{s.icon}</div>
                <p className="font-semibold text-gray-900">{s.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Supported Platforms</p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_PLATFORMS.map(p => <span key={p} className="px-3 py-1 bg-white border text-xs rounded-full text-gray-600">{p}</span>)}
          </div>
        </div>
      </div>
    );
  }

  // ── INPUT STEP ──
  if (step === 'input') {
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep('source')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><ArrowLeft size={20}/></button>
          <h1 className="text-xl font-bold">
            {source==='url'?'URL Import':source==='html'?'HTML Import':source==='clipboard'?'Clipboard Import':source==='image'?'Image UploadSimple':'Text Import'}
          </h1>
          <button onClick={() => navigate('/admin/settings/listing-playbook')} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 border border-blue-200 bg-blue-50 rounded-lg text-xs text-blue-700 hover:bg-blue-100 transition-colors" title="Listing Playbook — rules applied to this import">
            <BookBookmark size={14} /> Playbook rules
          </button>
        </div>

        {error && <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm"><Warning size={18} className="mt-0.5 shrink-0"/><div><p className="font-semibold">Import Failed</p><p>{error}</p></div></div>}

        {source === 'url' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Product URL</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleImport()}
                    className={inputCls + ' w-full'} placeholder="https://www.aliexpress.com/item/... or any product page URL" />
                  {urlInput.trim() && detectPlatform(urlInput) && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      {detectPlatform(urlInput)}
                    </span>
                  )}
                </div>
                <button onClick={handleImport} disabled={!urlInput.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 whitespace-nowrap transition-colors">
                  <MagicWand size={16}/> Import
                </button>
              </div>
            </div>
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">Smart Import:</span> Paste any product URL — {
                  urlInput.trim() && detectPlatform(urlInput)
                    ? <span>detected as <span className="font-bold text-blue-800">{detectPlatform(urlInput)}</span> product</span>
                    : 'AI will extract title, price, images, specs, description, variants, SEO data automatically'
                }
              </p>
            </div>
            <div className="text-xs text-gray-500">
              <p className="font-medium mb-1">Supported platforms:</p>
              <div className="flex flex-wrap gap-1">{SUPPORTED_PLATFORMS.map(p=><span key={p} className="px-2 py-0.5 bg-gray-100 rounded">{p}</span>)}</div>
            </div>
          </div>
        )}

        {source === 'html' && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Paste HTML Source Code</label>
            <textarea value={htmlInput} onChange={e=>setHtmlInput(e.target.value)}
              className={inputCls + ' min-h-[200px] font-mono text-xs'} placeholder="Paste the HTML of the product page here..." />
            <button onClick={handleImport} disabled={!htmlInput.trim()}
              className="mt-3 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <MagicWand size={16}/> Analyze HTML
            </button>
          </div>
        )}

        {(source === 'text' || source === 'clipboard') && (
          <div onPaste={handlePaste}>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {source==='clipboard' ? 'Press Ctrl+V to paste clipboard content' : 'Paste Product Text/Description'}
            </label>
            <textarea value={textInput} onChange={e=>setTextInput(e.target.value)}
              className={inputCls + ' min-h-[200px]'}
              placeholder={source==='clipboard' ? 'Click here and press Ctrl+V...' : 'Paste product title, description, features, specifications...'} />
            {source==='clipboard' && textInput && <p className="text-xs text-green-600 mt-1">✓ Content pasted ({textInput.length} chars)</p>}
            <button onClick={handleImport} disabled={!textInput.trim()}
              className="mt-3 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <MagicWand size={16}/> {source==='clipboard'?'Import from Clipboard':'Analyze Text'}
            </button>
          </div>
        )}

        {source === 'image' && (
          <div>
            <div onDrop={handleImageDrop} onDragOver={e=>{e.preventDefault();setIsDragging(true)}} onDragLeave={()=>setIsDragging(false)}
              onClick={()=>fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${isDragging?'border-blue-400 bg-blue-50':'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}`}>
              <UploadSimple size={32} className="mx-auto text-gray-400 mb-3"/>
              <p className="font-semibold text-gray-700">Drop image here or click to upload</p>
              <p className="text-xs text-gray-500 mt-1">PNG, JPG, JPEG, WEBP supported</p>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect}/>
            </div>
            {textInput.includes('[Image') && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm flex items-center gap-2">
                <CheckCircle size={16}/> Image loaded — AI will analyze it
              </div>
            )}
            <button onClick={handleImport} disabled={!textInput.includes('[Image')}
              className="mt-3 px-5 py-2.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors">
              <Robot size={16}/> Analyze Image with AI
            </button>
          </div>
        )}

        <div className="border rounded-xl p-4 bg-sky-50 border-sky-200 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-semibold text-blue-700">⚡ AI Provider</p>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={importProvider} onChange={e => setImportProvider(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-blue-200 text-xs font-semibold text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="auto">Auto — settings default → fallback</option>
                {aiProviders.filter(p => p.enabled).map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.defaultModel})</option>
                ))}
              </select>
            </div>
          </div>
          {(() => {
            // The SERVER is the authority on keys (/api/ai/status). Client
            // localStorage toggles only affect routing, never real availability.
            const active = (importProvider !== 'auto' && aiProviders.find(p => p.id === importProvider))
              || aiProviders.find(p => p.isDefault && p.enabled)
              || aiProviders.find(p => p.enabled)
              || aiProviders[0];
            const fallback = (aiProviders.find(p => p.id === loadProviderSettings().fallbackProviderId && p.id !== (importProvider !== 'auto' ? importProvider : undefined)));
            if (!active) return <p className="text-xs text-red-600">No AI provider enabled — check AI Hub → AI Providers.</p>;
            const note = fallback ? ` · auto-fallback: ${fallback.name}` : '';
            return <p className="text-xs text-blue-800">{active.name} · {active.defaultModel}{note}</p>;
          })()}
          <p className="text-[10px] text-blue-600/80">Server falls back automatically when the primary provider is unavailable (e.g. DeepSeek → Codex). No keys ever reach the browser.</p>
        </div>
      </div>
    );
  }

  // ── PROCESSING STEP ──
  if (step === 'processing') {
    return (
      <div className="space-y-6 max-w-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center animate-pulse">
            <Robot size={22} className="text-white"/>
          </div>
          <div>
            <h1 className="text-xl font-bold">AI is analyzing your product…</h1>
            <p className="text-sm text-gray-500 font-mono">{elapsed}s elapsed</p>
          </div>
        </div>
        <div className="bg-gray-900 rounded-2xl p-5 min-h-[200px] font-mono text-sm space-y-1.5">
          {progress.map((p,i) => (
            <div key={i} className={`flex items-start gap-2 ${p.ok?'text-green-400':'text-red-400'}`}>
              <span className="text-gray-600 text-xs mt-0.5">[{String(i+1).padStart(2,'0')}]</span>
              <span>{p.msg}</span>
            </div>
          ))}
          {loading && <div className="flex items-center gap-2 text-blue-400"><SpinnerGap size={14} className="animate-spin"/><span>Processing…</span></div>}
        </div>
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700 text-sm font-semibold">{error}</p>
            <button onClick={()=>setStep('input')} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium">← Try Again</button>
          </div>
        )}
      </div>
    );
  }

  // ── PREVIEW STEP ──
  if (step === 'preview' && extracted) {
    const conf = extracted.confidence || {};
    const PreviewField = ({ label, field, multiline=false, conf: c=0 }: {label:string;field:keyof AIExtractedProduct;multiline?:boolean;conf?:number}) => (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
          {c > 0 && <ConfidenceBadge score={c}/>}
        </div>
        {multiline
          ? <textarea {...EF(field)} className={inputCls + ' text-sm min-h-[80px]'}/>
          : <input {...EF(field)} className={inputCls + ' text-sm'}/>
        }
      </div>
    );

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={()=>setStep('input')} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={20}/></button>
          <div>
            <h1 className="text-xl font-bold">Review & Edit</h1>
            <p className="text-sm text-gray-500">AI extracted {Object.keys(extracted).length} fields — edit any before saving</p>
          </div>
          <button onClick={handleSave} disabled={saving} className="ml-auto px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-green-200">
            <CheckCircle size={16}/> {saving ? 'Saving…' : 'FloppyDisk as Draft Product'}
          </button>
        </div>

        {dupProduct && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <Warning size={18} className="text-red-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-700">DUPLICATE FOUND</p>
              <p className="text-xs text-red-600 truncate">{dupProduct.name} · {dupProduct.id}</p>
            </div>
            <button onClick={() => navigate(`/admin/products/edit/${dupProduct.id}`)} className="shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold text-white bg-red-600 hover:bg-red-700">
              OPEN EXISTING PRODUCT
            </button>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-5">
          {/* LEFT — Core Fields */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Package size={16} className="text-blue-500"/>Product Info</h2>
              <PreviewField label="Product Title" field="title" conf={conf.title}/>
              <PreviewField label="Luxury Title (Premium)" field="luxuryTitle"/>
              <PreviewField label="SEO Title" field="seoTitle" conf={conf.category}/>
              <PreviewField label="Brand" field="brand" conf={conf.brand}/>
              <div className="grid grid-cols-2 gap-3">
                <PreviewField label="Category" field="category" conf={conf.category}/>
                <PreviewField label="Subcategory" field="subcategory"/>
              </div>
              <PreviewField label="SKU" field="sku"/>
              <PreviewField label="Origin" field="origin"/>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><CurrencyDollar size={16} className="text-green-500"/>Pricing</h2>
              <div className="grid grid-cols-3 gap-3">
                <PreviewField label="Sell Price ($)" field="sellingPrice" conf={conf.price}/>
                <PreviewField label="Compare Price ($)" field="comparePrice"/>
                <PreviewField label="Cost Price ($)" field="costPrice"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PreviewField label="Stock" field="stock"/>
                <PreviewField label="Weight" field="weight"/>
              </div>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><FileText size={16} className="text-purple-500"/>Descriptions</h2>
              <PreviewField label="Short Description" field="shortDescription" multiline conf={conf.description}/>
              <PreviewField label="Long Description" field="longDescription" multiline/>
            </div>

            <div className="bg-white rounded-2xl border p-5 space-y-4">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Globe size={16} className="text-blue-500"/>SEO</h2>
              <PreviewField label="Slug" field="slug"/>
              <PreviewField label="Meta Title" field="metaTitle"/>
              <PreviewField label="Meta Description" field="metaDescription" multiline/>
              <PreviewField label="Focus Keyword" field="focusKeyword"/>
            </div>
          </div>

          {/* RIGHT — Images + Extra */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><ImageIcon size={16} className="text-pink-500"/>Images ({extracted.images?.length||0} found)</h2>
                <span className="text-xs text-gray-500">{selectedImgs.length} selected</span>
              </div>
              {extracted.images?.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {extracted.images.slice(0,18).map((img,i) => {
                    const isSelected = selectedImgs.includes(img);
                    const isHero = heroImg === img;
                    return (
                      <div key={i} className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${isSelected?'border-blue-500':'border-transparent'}`}
                        onClick={()=>{ setSelectedImgs(prev => isSelected ? prev.filter(x=>x!==img) : [...prev, img]); if(!heroImg) setHeroImg(img); }}>
                        <img src={img} className="w-full h-20 object-cover" onError={e=>(e.currentTarget.style.display='none')} alt=""/>
                        {isSelected && <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center"><CheckCircle size={12} className="text-white"/></div>}
                        {isHero && <div className="absolute bottom-0 left-0 right-0 bg-blue-500 text-white text-[10px] text-center font-bold py-0.5">HERO</div>}
                        {!isHero && isSelected && <button type="button" className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 hover:bg-blue-500 transition-colors"
                          onClick={e=>{e.stopPropagation();setHeroImg(img);}}>Set Hero</button>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <ImageIcon size={32} className="mx-auto mb-2 opacity-40"/>
                  <p className="text-sm">No images found. Add image URLs manually.</p>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={()=>setSelectedImgs(extracted.images?.slice(0,12)||[])} className="text-xs text-blue-600 hover:underline">Select All</button>
                <span className="text-gray-300">|</span>
                <button onClick={()=>setSelectedImgs([])} className="text-xs text-gray-500 hover:underline">Clear</button>
              </div>
            </div>

            {/* Features & Tags */}
            <div className="bg-white rounded-2xl border p-5 space-y-3">
              <h2 className="font-bold text-sm text-gray-700 flex items-center gap-2"><Sparkle size={16} className="text-blue-500"/>Features & Tags</h2>
              {extracted.features?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Features</p>
                  <ul className="space-y-1">
                    {extracted.features.slice(0,6).map((f,i) => <li key={i} className="text-sm text-gray-700 flex items-start gap-2"><span className="text-green-500 mt-0.5">✓</span>{f}</li>)}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">{(extracted.tags||[]).map(t=><span key={t} className="px-2 py-0.5 bg-gray-100 text-xs rounded-full text-gray-600">{t}</span>)}</div>
              </div>
              {(extracted.colors?.length||0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Colors</p>
                  <div className="flex flex-wrap gap-1">{extracted.colors?.map(c=><span key={c} className="px-2 py-0.5 border text-xs rounded-full">{c}</span>)}</div>
                </div>
              )}
              {(extracted.sizes?.length||0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Sizes</p>
                  <div className="flex flex-wrap gap-1">{extracted.sizes?.map(s=><span key={s} className="px-2 py-0.5 border text-xs rounded-full">{s}</span>)}</div>
                </div>
              )}
            </div>

            {/* Specs */}
            {Object.keys(extracted.specifications||{}).length > 0 && (
              <div className="bg-white rounded-2xl border p-5">
                <h2 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2"><Tag size={16} className="text-gray-500"/>Specifications</h2>
                <div className="space-y-1.5">
                  {Object.entries(extracted.specifications).slice(0,12).map(([k,v]) => (
                    <div key={k} className="flex text-sm">
                      <span className="w-2/5 text-gray-500 text-xs font-medium pr-2 leading-5">{k}</span>
                      <span className="flex-1 text-gray-800 text-xs leading-5">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence Overview */}
            <div className="bg-white rounded-2xl border p-5">
              <h2 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2"><Star size={16} className="text-blue-500"/>AI Confidence Scores</h2>
              <div className="space-y-2">
                {Object.entries(conf).map(([k,v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-24 capitalize">{k}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${Number(v)>=80?'bg-green-500':Number(v)>=50?'bg-sky-400':'bg-red-400'}`} style={{width:`${v}%`}}/>
                    </div>
                    <span className="text-xs font-bold text-gray-600 w-8 text-right">{v}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* FloppyDisk Button */}
        <div className="sticky bottom-0 bg-white border-t p-4 -mx-6 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-500">Product will be saved as <span className="font-semibold text-gray-700">Draft</span> — you can publish it from Products page.</p>
          <button onClick={handleSave} disabled={saving} className="px-8 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-green-200">
            <CheckCircle size={18}/> {saving ? 'Saving…' : 'FloppyDisk Product'}
          </button>
        </div>
      </div>
    );
  }

  // ── DONE ──
  if (step === 'done') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-5">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
          <CheckCircle size={40} className="text-green-500"/>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Imported!</h1>
          <p className="text-gray-500 mt-1">Saved as Draft — publish it when ready</p>
        </div>
        <div className="flex gap-3">
          <button onClick={()=>navigate('/admin/products')} className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold flex items-center gap-2">
            <Package size={16}/> View Products
          </button>
          <button onClick={()=>{ setStep('source'); setExtracted(null); setEditField({}); setSelectedImgs([]); setUrlInput(''); setTextInput(''); setHtmlInput(''); }}
            className="px-6 py-2.5 border rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2">
            <ArrowClockwise size={16}/> Import Another
          </button>
        </div>
      </div>
    );
  }

  // ── HISTORY ──
  if (step === 'history') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={()=>setStep('source')} className="p-2 hover:bg-gray-100 rounded-xl"><ArrowLeft size={20}/></button>
          <h1 className="text-xl font-bold">Import ClockCounterClockwise</h1>
        </div>
        {history.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <ClockCounterClockwise size={40} className="mx-auto mb-3 opacity-40"/>
            <p>No imports yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-white border rounded-xl p-4 flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${h.status==='success'?'bg-green-100':'bg-red-100'}`}>
                  {h.status==='success'?<CheckCircle size={18} className="text-green-600"/>:<Warning size={18} className="text-red-500"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">{h.productTitle}</p>
                  <p className="text-xs text-gray-500">{new Date(h.date).toLocaleDateString()} · {h.provider} · {(h.importTime/1000).toFixed(1)}s</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${h.sourceType==='url'?'bg-blue-100 text-blue-700':h.sourceType==='html'?'bg-orange-100 text-orange-700':'bg-gray-100 text-gray-600'}`}>{h.sourceType}</span>
              </div>
            ))}
          </div>
        )}
        {history.length > 0 && (
          <button onClick={()=>{ setHistory([]); localStorage.removeItem('luxedge_import_history'); }}
            className="text-sm text-red-500 hover:text-red-700">Clear ClockCounterClockwise</button>
        )}
      </div>
    );
  }

  return null;
}


// ============================================================================
// ADMIN — MARKETING & TRAFFIC
