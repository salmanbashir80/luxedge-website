// ============================================================================
// LUXEDGE — ON-SITE CHECKOUT PAGE (PaymentElement)
//
// Replaces the "redirect to Stripe" step with an embedded, Stripe-hosted card
// form on luxedge.us. The page:
//   1. collects contact + shipping address (validated against Shippo/USPS with
//      an explicit "did you mean" suggestion when a correction is proposed),
//   2. fetches live carrier rates for the address + cart (falls back to the
//      store flat rate honestly when items/Shippo can't produce rates),
//   3. lets the customer pick a rate, apply a coupon and review totals
//      (display copies only — the server recomputes everything),
//   4. calls /api/checkout/onsite which reserves inventory, persists a
//      pending order and creates the PaymentIntent,
//   5. renders the Stripe PaymentElement and confirms payment ON-SITE,
//   6. verifies the intent server-side (/api/checkout/verify) before showing
//      success — never a client-side fake.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../App';
import {
  fetchOnsiteConfig,
  fetchCheckoutRates,
  validateCheckoutAddress,
  startOnsiteCheckout,
  verifyOnsitePayment,
  type OnsiteCheckoutConfig,
  type CheckoutAddress,
  type ShippoRate,
  type AddressValidationResult,
  type OnsiteIntentResult,
} from '../../services/checkoutOnsite';
import OnsitePaymentForm from './OnsitePaymentForm';
import { checkUsShippingEligibility } from '../../services/supplier/usShipping';
import { Lock01, ChevronDown } from '@untitledui/icons';

const FREE_SHIPPING_FALLBACK = 4.99;
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

interface FieldState {
  email: string; phone: string; fullName: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string; country: string;
}

export default function CheckoutOnsitePage() {
  const { cart, coupon, applyCoupon, removeCoupon, freeShippingEnabled, freeShippingThreshold, user, clearCart, notify } = useApp();
  const nav = useNavigate();

  const [config, setConfig] = useState<OnsiteCheckoutConfig | null>(null);
  // Distinct from `config === null` (still loading): a fetch that failed or
  // timed out gets a retry card instead of silently pretending payments are
  // unavailable (which would mislabel a transient outage as a config gap).
  const [configFailed, setConfigFailed] = useState(false);
  const [f, setF] = useState<FieldState>({
    email: user?.email || '', phone: '', fullName: user?.name || '',
    addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: 'US',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [couponInput, setCouponInput] = useState('');
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState<FieldState>({ ...f, fullName: user?.name || '' });
  const [couponApplied, setCouponApplied] = useState<string | null>(coupon?.code || null);

  // Address validation (Shippo)
  const [addrChecking, setAddrChecking] = useState(false);
  const [addrResult, setAddrResult] = useState<AddressValidationResult | null>(null);
  const [addrError, setAddrError] = useState('');
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Rates
  const [rates, setRates] = useState<ShippoRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState('');
  const [ratesAttempted, setRatesAttempted] = useState(false);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);

  // Payment
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [paymentSession, setPaymentSession] = useState<OnsiteIntentResult | null>(null);
  const [confirmError, setConfirmError] = useState('');
  // Mobile/tablet order summary — collapsible card above the form; the total
  // stays visible in its header even when collapsed.
  const [summaryOpen, setSummaryOpen] = useState(true);

  const addressComplete = Boolean(f.fullName.trim() && f.addressLine1.trim() && f.city.trim() && f.state.trim() && /^\d{5}/.test(f.postalCode));

  const shippingAddress = useMemo<CheckoutAddress>(() => ({
    fullName: f.fullName,
    addressLine1: f.addressLine1,
    addressLine2: f.addressLine2,
    city: f.city,
    state: f.state,
    postalCode: f.postalCode,
    country: f.country || 'US',
  }), [f]);

  // Load checkout config (Stripe/payment readiness) with a hard timeout so a
  // hung /api/checkout/onsite can never leave the buyer staring at an endless
  // "checking…" spinner. On failure show a retry card instead.
  const loadConfig = useCallback(() => {
    setConfigFailed(false);
    fetchOnsiteConfig({ signal: AbortSignal.timeout(10_000) })
      .then((c) => { if (c) setConfig(c); })
      .catch(() => { setConfigFailed(true); });
  }, []);
  useEffect(() => { loadConfig(); }, [loadConfig]);

  const setField = (k: keyof FieldState, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  // Debounced address validation → live rates.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    if (!addressComplete) {
      setAddrResult(null);
      setAddrError('');
      setRates([]);
      setRatesAttempted(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setAddrChecking(true);
      setAddrError('');
      try {
        const v = await validateCheckoutAddress(shippingAddress, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAddrResult(v);
        // Auto-apply safe normalizations (state abbreviation + ZIP format)
        // when Shippo found no *street-level* correction.
        if (v.isValid && !v.recommendedAddress) {
          const n = v.normalizedAddress;
          setF((cur) => ({
            ...cur,
            state: n.state || cur.state,
            postalCode: n.postalCode || cur.postalCode,
          }));
        }
        // Live rates only after the address validates.
        if (v.isValid) {
          setRatesLoading(true);
          setRatesError('');
          try {
            const rateAddr: CheckoutAddress = {
              ...shippingAddress,
              state: v.normalizedAddress.state || shippingAddress.state,
              postalCode: v.normalizedAddress.postalCode || shippingAddress.postalCode,
            };
            const r = await fetchCheckoutRates(rateAddr, cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })), { signal: controller.signal });
            if (controller.signal.aborted) return;
            setRates(r.rates);
            setRatesAttempted(true);
            setSelectedRateId((cur) => (cur && r.rates.some((x) => x.objectId === cur) ? cur : (r.rates[0]?.objectId || null)));
          } catch (e) {
            if (controller.signal.aborted) return;
            setRates([]);
            setRatesAttempted(true);
            setRatesError((e as Error).message || 'Live rates unavailable — store flat shipping applies.');
          } finally {
            if (!controller.signal.aborted) setRatesLoading(false);
          }
        } else {
          setRates([]);
          setRatesAttempted(false);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setAddrResult(null);
        setAddrError((e as Error).message || 'Could not validate the address right now.');
        setRates([]);
        setRatesAttempted(false);
      } finally {
        if (!controller.signal.aborted) setAddrChecking(false);
      }
    }, 750);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressComplete, shippingAddress, cart]);

  const acceptSuggestion = () => {
    if (!addrResult?.recommendedAddress) return;
    const s = addrResult.recommendedAddress;
    setF((cur) => ({ ...cur, addressLine1: s.addressLine1, addressLine2: s.addressLine2 || '', city: s.city, state: s.state, postalCode: s.postalCode, country: s.country || 'US' }));
    setAddrResult((cur) => (cur ? { ...cur, recommendedAddress: undefined, isValid: true, messages: [] } : cur));
  };

  // ---- Client display totals (server re-verifies every amount) ----
  const subtotal = cart.reduce((s, i) => s + (i.product.price || 0) * i.quantity, 0);
  const couponDiscount = coupon ? (coupon.discountType === 'percent' ? Math.round(subtotal * coupon.discountValue) / 100 : Math.min(subtotal, coupon.discountValue)) : 0;
  const discountedSubtotal = Math.max(0, subtotal - couponDiscount);
  const freeShippingNow = freeShippingEnabled && discountedSubtotal >= freeShippingThreshold;
  const selectedRate = rates.find((r) => r.objectId === selectedRateId) || null;
  const shipping = freeShippingNow ? 0 : selectedRate ? selectedRate.amount : FREE_SHIPPING_FALLBACK;
  const total = +(discountedSubtotal + shipping).toFixed(2);
  const shippingLabel = freeShippingNow
    ? 'FREE'
    : selectedRate
      ? `$${selectedRate.amount.toFixed(2)}`
      : `$${FREE_SHIPPING_FALLBACK.toFixed(2)} (store rate)`;

  const applyCouponLocal = () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const errMsg = applyCoupon(code);
    if (errMsg) notify(errMsg, 'error');
    else { setCouponApplied(code); notify('Coupon applied!'); }
    setCouponInput('');
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!f.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Please enter a valid email address';
    if (!f.fullName.trim()) e.fullName = 'Please enter your full name';
    if (!f.addressLine1.trim()) e.addressLine1 = 'Please enter your street address';
    if (!f.city.trim()) e.city = 'Please enter your city';
    if (!f.state.trim()) e.state = 'Please select your state';
    if (!/^\d{5}(-\d{4})?$/.test(f.postalCode.trim())) e.postalCode = 'Please enter a valid ZIP code';
    const usCheck = checkUsShippingEligibility({ country: f.country, state: f.state, zip: f.postalCode });
    if (!usCheck.eligible && !e.state && !e.postalCode) e.postalCode = usCheck.reason;
    if (!billingSame) {
      if (!billing.fullName.trim()) e.billingName = 'Please enter the billing name';
      if (!billing.addressLine1.trim()) e.billingLine1 = 'Please enter the billing address';
      if (!billing.city.trim()) e.billingCity = 'Please enter the billing city';
      if (!billing.state.trim()) e.billingState = 'Please select the billing state';
      if (!/^\d{5}(-\d{4})?$/.test(billing.postalCode.trim())) e.billingZip = 'Please enter a valid billing ZIP code';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const startPayment = useCallback(async () => {
    if (starting || paymentSession) return;
    setStartError('');
    if (!validate()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    // Block an obviously unverifiable US address from reaching payment.
    if (addrResult && !addrResult.isValid && addrResult.messages.length > 0) {
      setStartError(addrResult.messages[0] || 'Please correct your shipping address before continuing.');
      return;
    }
    setStarting(true);
    try {
      const result = await startOnsiteCheckout({
        items: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        couponCode: couponApplied || undefined,
        email: f.email,
        phone: f.phone || undefined,
        fullName: f.fullName,
        address: shippingAddress,
        shippingRateId: selectedRate?.objectId || undefined,
      });
      setPaymentSession(result);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setStartError((e as Error).message || 'Checkout could not start. Please try again.');
    } finally {
      setStarting(false);
    }
  }, [starting, paymentSession, addrResult, cart, couponApplied, f, shippingAddress, selectedRate, validate]);

  const handlePaid = useCallback(async (paymentIntentId: string) => {
    if (!paymentSession) return;
    setConfirmError('');
    try {
      const v = await verifyOnsitePayment(paymentSession.orderNumber, paymentIntentId);
      if (v.paid) {
        clearCart();
        removeCoupon();
        nav(`/checkout/success?source=onsite&intent=${encodeURIComponent(paymentIntentId)}&order=${encodeURIComponent(paymentSession.orderNumber)}`);
      } else {
        setConfirmError('Payment is still processing. If you were charged, the order will be confirmed by email shortly.');
      }
    } catch (e) {
      // A succeeded intent that just hadn't reached the DB yet must not look
      // like a failure — re-verify once after a short wait.
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const v2 = await verifyOnsitePayment(paymentSession.orderNumber, paymentIntentId);
        if (v2.paid) {
          clearCart(); removeCoupon();
          nav(`/checkout/success?source=onsite&intent=${encodeURIComponent(paymentIntentId)}&order=${encodeURIComponent(paymentSession.orderNumber)}`);
          return;
        }
      } catch { /* fall through */ }
      setConfirmError((e as Error).message || 'Payment succeeded but we could not confirm it. Please check your email for a receipt.');
    }
  }, [paymentSession, nav, clearCart, removeCoupon]);

  if (cart.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 bg-luxe-cream">
        <div className="text-center max-w-md">
          <h1 className="font-serif text-2xl font-bold text-luxe-black mb-2">Your cart is empty</h1>
          <p className="text-sm text-luxe-gray mb-6">Add a product before checking out.</p>
          <Link to="/shop" className="inline-block px-6 py-3 bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold rounded-full text-sm">Shop now</Link>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-luxe-gold focus:ring-2 focus:ring-luxe-gold/20 transition-all';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
const err = (k: string) => (errors[k] ? <p className="text-red-500 text-xs mt-1">{errors[k]}</p> : null);

  // ---- Checkout presentation helpers (no logic changes) ----
  const cc = cart.reduce((s, i) => s + i.quantity, 0);
  const paymentLoading = !config && !configFailed;
  const paymentFailed = configFailed;
  const paymentUnavailable = Boolean(config) && !config!.anyProviderReady && !config!.stripeConfigured;
  const paymentReady = Boolean(config) && (config!.anyProviderReady || config!.stripeConfigured);
  // The primary CTA is DISABLED only while actually working (reserving or
  // loading config). When payment is unavailable the CTA turns into an
  // ENABLED contact-support action — never a dead button.
  const ctaDisabled = starting || paymentLoading || Boolean(paymentSession);
  const ctaLabel = starting
    ? 'Reserving your items…'
    : paymentSession
      ? 'Complete card payment above'
      : paymentLoading
        ? 'Checking secure payment…'
        : paymentUnavailable
          ? 'Contact Support'
          : `Pay securely — $${total.toFixed(2)}`;
  const onPrimaryClick = paymentUnavailable || paymentFailed
    ? () => nav('/contact')
    : () => { void startPayment(); };

  const StepChip = ({ n }: { n: number }) => (
    <span className="w-7 h-7 rounded-full bg-luxe-gold text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
  );
  const StepTitle = ({ n, title, hint }: { n: number; title: string; hint?: string }) => (
    <div className="flex items-center gap-3 mb-5">
      <StepChip n={n} />
      <div className="min-w-0">
        <h2 className="font-bold text-base sm:text-lg text-luxe-black leading-tight">{title}</h2>
        {hint && <p className="text-xs text-luxe-gray mt-0.5">{hint}</p>}
      </div>
    </div>
  );
  const SubTitle = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500 mb-3">{children}</h3>
  );

  // Items + coupon + totals — shared by the desktop sticky summary and the
  // mobile collapsible card. The CTA + trust row render beside it.
  const summaryBody = (
    <>
      <div className="space-y-4 mb-6 lg:max-h-72 lg:overflow-y-auto lg:pr-1">
        {cart.map((item) => {
          const img = (Array.isArray(item.product.images) && item.product.images[0]) || '';
          return (
            <div key={item.product.id} className="flex gap-3">
              <div className="relative shrink-0">
                <img src={img} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-100" />
                <span className="absolute -top-2 -right-2 w-5 h-5 bg-luxe-charcoal text-white text-[10px] font-bold rounded-full flex items-center justify-center">{item.quantity}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-luxe-black line-clamp-2 lg:line-clamp-1">{item.product.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">${(item.product.price || 0).toFixed(2)} each</p>
              </div>
              <p className="text-sm font-semibold shrink-0">${((item.product.price || 0) * item.quantity).toFixed(2)}</p>
            </div>
          );
        })}
      </div>

      <div className="mb-4">
        {couponApplied ? (
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
            <div><p className="text-xs font-bold text-green-700">{couponApplied} applied</p>{coupon ? <p className="text-[10px] text-green-600">{coupon.discountType === 'percent' ? `${coupon.discountValue}% off` : `$${coupon.discountValue} off`}</p> : null}</div>
            <button onClick={() => { removeCoupon(); setCouponApplied(null); }} className="text-[11px] text-green-700 underline">Remove</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input name="coupon" autoComplete="off" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyCouponLocal())} className="min-w-0 flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Coupon code" aria-label="Coupon code" />
            <button onClick={applyCouponLocal} className="px-4 py-2 bg-luxe-charcoal text-white rounded-lg text-xs font-semibold">Apply</button>
          </div>
        )}
      </div>

      <div className="border-t pt-4 space-y-2.5 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-medium">${subtotal.toFixed(2)}</span></div>
        {couponDiscount > 0 && <div className="flex justify-between"><span className="text-gray-500">Coupon ({couponApplied})</span><span className="font-medium text-green-600">−${couponDiscount.toFixed(2)}</span></div>}
        <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className={`font-medium ${shipping === 0 ? 'text-green-600' : ''}`}>{shippingLabel}</span></div>
        {shipping === 0 && freeShippingEnabled && (
          <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs font-semibold text-green-700">✓ Free shipping applied — this order qualifies!</p>
        )}
        <div className="flex justify-between items-end pt-3 border-t">
          <span className="font-bold text-base text-luxe-black">Total</span>
          <span className="font-bold text-2xl text-gray-900">${total.toFixed(2)}</span>
        </div>
        <p className="text-[10px] text-gray-400">USD · final price — no tax or hidden fees at checkout</p>
      </div>
    </>
  );

  const trustRow = (
    <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] text-gray-500">
      {paymentReady && (
        <>
          <span className="inline-flex items-center gap-1"><Lock01 size={11} /> Secure Stripe payment</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span>30-day returns</span>
      <span aria-hidden="true">·</span>
      <span>Customer support</span>
    </p>
  );

  return (
    <div className="bg-luxe-cream min-h-screen pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <p className="eyebrow mb-2">Checkout</p>
        <h1 className="font-serif text-2xl sm:text-3xl font-bold text-luxe-black mb-1">Secure Checkout</h1>
        <p className="text-sm text-luxe-gray mb-6 sm:mb-8">Pay safely right here on luxedge.us — no redirects, no card details stored.</p>

        {/* Mobile / tablet order summary — collapsible card above the form, total always visible */}
        <div className="lg:hidden mb-5">
          <div className="bg-white rounded-2xl border border-luxe-silver/70 shadow-sm overflow-hidden">
            <button type="button" onClick={() => setSummaryOpen((o) => !o)} aria-expanded={summaryOpen} aria-controls="checkout-mobile-summary" className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left">
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm text-luxe-black">Order Summary</span>
                <span className="text-[10px] font-medium text-gray-400 whitespace-nowrap">({cc} item{cc === 1 ? '' : 's'})</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="font-bold text-lg text-luxe-black">${total.toFixed(2)}</span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${summaryOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {summaryOpen && <div id="checkout-mobile-summary" className="px-4 pb-4 pt-3 border-t border-gray-100">{summaryBody}</div>}
          </div>
        </div>

        <div className="grid lg:grid-cols-5 gap-6 sm:gap-8 items-start">
          <div className="min-w-0 lg:col-span-3 space-y-5 sm:space-y-6">
            {startError && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex-1"><p className="text-sm font-semibold text-red-800">Checkout could not start</p><p className="text-xs text-red-700 mt-0.5">{startError}</p></div>
              </div>
            )}

            {/* STEP 1 — CONTACT */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-4 sm:p-6 shadow-sm">
              <StepTitle n={1} title="Contact" hint="We only use this for your order updates." />
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="checkout-email" className={labelCls}>Email *</label>
                  <input id="checkout-email" name="email" type="email" value={f.email} onChange={(e) => setField('email', e.target.value)} className={inputCls} placeholder="you@example.com" autoComplete="email" />
                  {err('email')}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="checkout-phone" className={labelCls}>Phone <span className="normal-case font-normal text-gray-400">(for delivery updates)</span></label>
                  <input id="checkout-phone" name="tel" type="tel" value={f.phone} onChange={(e) => setField('phone', e.target.value)} className={inputCls} placeholder="(555) 123-4567" autoComplete="tel" />
                </div>
              </div>
            </section>

            {/* STEP 2 — DELIVERY (address + method) */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-4 sm:p-6 shadow-sm">
              <StepTitle n={2} title="Delivery" hint="We ship to United States addresses only. We verify your address against USPS when available." />
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="checkout-name" className={labelCls}>Full name *</label>
                  <input id="checkout-name" name="name" value={f.fullName} onChange={(e) => setField('fullName', e.target.value)} className={inputCls} autoComplete="name" />
                  {err('fullName')}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="checkout-address-line1" className={labelCls}>Street address *</label>
                  <input id="checkout-address-line1" name="address-line1" value={f.addressLine1} onChange={(e) => { setField('addressLine1', e.target.value); setAddrResult(null); }} className={inputCls} placeholder="123 Main Street" autoComplete="address-line1" />
                  {err('addressLine1')}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="checkout-address-line2" className={labelCls}>Apt / suite <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                  <input id="checkout-address-line2" name="address-line2" value={f.addressLine2} onChange={(e) => setField('addressLine2', e.target.value)} className={inputCls} autoComplete="address-line2" />
                </div>
                <div>
                  <label htmlFor="checkout-city" className={labelCls}>City *</label>
                  <input id="checkout-city" name="address-level2" value={f.city} onChange={(e) => { setField('city', e.target.value); setAddrResult(null); }} className={inputCls} autoComplete="address-level2" />
                  {err('city')}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="checkout-state" className={labelCls}>State *</label>
                    <select id="checkout-state" name="address-level1" value={f.state} onChange={(e) => { setField('state', e.target.value); setAddrResult(null); }} className={inputCls} autoComplete="address-level1">
                      <option value="">--</option>
                      {US_STATES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    {err('state')}
                  </div>
                  <div>
                    <label htmlFor="checkout-postal-code" className={labelCls}>ZIP *</label>
                    <input id="checkout-postal-code" name="postal-code" value={f.postalCode} onChange={(e) => { setField('postalCode', e.target.value); setAddrResult(null); }} className={inputCls} placeholder="75038" maxLength={10} autoComplete="postal-code" />
                    {err('postalCode')}
                  </div>
                </div>
              </div>

              {/* Address validation status */}
              {addrChecking && <p className="mt-4 text-xs text-gray-500 flex items-center gap-2">Verifying your delivery address…</p>}
              {!addrChecking && addrError && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Address check unavailable</p>
                  <p className="text-xs mt-0.5">{addrError} You can still continue — delivery will be confirmed at fulfilment.</p>
                </div>
              )}
              {!addrChecking && addrResult && addrResult.isValid && !addrResult.recommendedAddress && (
                <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-start gap-2">
                  <span>✓</span>
                  <span><b>Address verified</b>{addrResult.source === 'shippo' ? ' with USPS' : ''}. Live carrier rates use this address.</span>
                </div>
              )}
              {!addrChecking && addrResult?.recommendedAddress && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Did you mean this address?</p>
                  <p className="mt-1.5 leading-6 text-amber-950">
                    {addrResult.recommendedAddress.addressLine1}
                    {addrResult.recommendedAddress.addressLine2 ? `, ${addrResult.recommendedAddress.addressLine2}` : ''}, {addrResult.recommendedAddress.city}, {addrResult.recommendedAddress.state} {addrResult.recommendedAddress.postalCode}
                  </p>
                  {addrResult.messages.length > 0 && <p className="mt-1 text-xs">{addrResult.messages[0]}</p>}
                  <div className="mt-2.5 flex gap-2">
                    <button type="button" onClick={acceptSuggestion} className="px-4 py-2 bg-luxe-gold hover:bg-luxe-gold-dark text-white rounded-lg text-xs font-bold">Use suggested address</button>
                    <button type="button" onClick={() => setAddrResult((cur) => (cur ? { ...cur, recommendedAddress: undefined, isValid: true } : cur))} className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-xs font-semibold">Keep mine</button>
                  </div>
                </div>
              )}
              {!addrChecking && addrResult && !addrResult.isValid && !addrResult.recommendedAddress && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Please double-check your address</p>
                  <p className="text-xs mt-0.5">{addrResult.messages[0] || 'We could not fully verify this address. Fix any typos or use standard USPS formatting.'}</p>
                </div>
              )}

              {/* Shipping method */}
              <div className="mt-6 pt-5 border-t border-gray-100">
                <SubTitle>Shipping Method</SubTitle>
                {freeShippingNow ? (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"><b>Free shipping</b> applies to this order.</div>
                ) : (
                  <>
                    {ratesLoading && <p className="text-sm text-gray-500 mt-1">Fetching live carrier rates for your address…</p>}
                    {!ratesLoading && rates.length > 0 && (
                      <div className="space-y-2">
                        {rates.map((r) => (
                          <button key={r.objectId} type="button" onClick={() => setSelectedRateId(r.objectId)}
                            className={`w-full text-left rounded-xl border p-3 transition-colors ${selectedRateId === r.objectId ? 'border-luxe-gold bg-luxe-gold-soft/40 ring-1 ring-luxe-gold/30' : 'border-gray-200 hover:border-luxe-gold/40'}`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-luxe-black">{r.provider} — {r.serviceName}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{r.estimatedDays ? `${r.estimatedDays} business days` : 'Estimated delivery varies'}</p>
                              </div>
                              <span className="font-bold text-luxe-gold-dark shrink-0">${r.amount.toFixed(2)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {!ratesLoading && ratesAttempted && rates.length === 0 && (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        {ratesError ? <><b>{ratesError}</b> Store flat shipping applies.</> : 'Live carrier rates are not available for this order — store flat shipping applies.'}
                        <div className="mt-2"><p className="text-xs text-gray-500">Standard shipping · ${FREE_SHIPPING_FALLBACK.toFixed(2)}</p></div>
                      </div>
                    )}
                    {!ratesLoading && !ratesAttempted && addressComplete && <p className="text-xs text-gray-400 mt-1">Enter a complete delivery address to see carrier options.</p>}
                    {!ratesLoading && !ratesAttempted && !addressComplete && <p className="text-xs text-gray-400 mt-1">Complete your address above — standard ${FREE_SHIPPING_FALLBACK.toFixed(2)} shipping applies.</p>}
                  </>
                )}
              </div>
            </section>

            {/* STEP 3 — PAYMENT (billing + card) */}
            <section className="bg-white rounded-2xl border border-luxe-silver/70 p-4 sm:p-6 shadow-sm">
              <StepTitle n={3} title="Payment" hint="Your order is charged only after you review the totals above." />
              <SubTitle>Billing Details</SubTitle>
              <label htmlFor="checkout-billing-same" className="flex items-center gap-2.5 cursor-pointer select-none mb-4 text-sm">
                <input id="checkout-billing-same" name="billing-same" type="checkbox" checked={billingSame} onChange={(e) => setBillingSame(e.target.checked)} className="w-4 h-4 rounded accent-[#9a6f16]" />
                <span className="font-medium text-luxe-charcoal">Billing address is the same as shipping</span>
              </label>
              {!billingSame && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2"><label htmlFor="checkout-billing-name" className={labelCls}>Billing name *</label><input id="checkout-billing-name" name="billing-name" value={billing.fullName} onChange={(e) => setBilling({ ...billing, fullName: e.target.value })} className={inputCls} autoComplete="billing name" />{err('billingName')}</div>
                  <div className="sm:col-span-2"><label htmlFor="checkout-billing-address" className={labelCls}>Billing address *</label><input id="checkout-billing-address" name="billing-address-line1" value={billing.addressLine1} onChange={(e) => setBilling({ ...billing, addressLine1: e.target.value })} className={inputCls} autoComplete="billing address-line1" />{err('billingLine1')}</div>
                  <div><label htmlFor="checkout-billing-city" className={labelCls}>City *</label><input id="checkout-billing-city" name="billing-address-level2" value={billing.city} onChange={(e) => setBilling({ ...billing, city: e.target.value })} className={inputCls} autoComplete="billing address-level2" />{err('billingCity')}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label htmlFor="checkout-billing-state" className={labelCls}>State *</label>
                      <select id="checkout-billing-state" name="billing-address-level1" value={billing.state} onChange={(e) => setBilling({ ...billing, state: e.target.value })} className={inputCls} autoComplete="billing address-level1"><option value="">--</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</select>
                      {err('billingState')}
                    </div>
                    <div><label htmlFor="checkout-billing-zip" className={labelCls}>ZIP *</label><input id="checkout-billing-zip" name="billing-postal-code" value={billing.postalCode} onChange={(e) => setBilling({ ...billing, postalCode: e.target.value })} className={inputCls} maxLength={10} autoComplete="billing postal-code" />{err('billingZip')}</div>
                  </div>
                </div>
              )}

              <div className="mt-6 pt-5 border-t border-gray-100">
                <SubTitle>Payment</SubTitle>
                {paymentLoading ? (
                  /* Compact skeleton while the config fetch is in flight —
                     never a blank/endless "checking…" state. */
                  <div className="rounded-xl border border-luxe-silver bg-white p-4" aria-busy="true" aria-label="Loading payment options">
                    <div className="h-3.5 w-40 bg-gray-200 rounded animate-pulse mb-2.5" />
                    <div className="h-3 w-56 bg-gray-100 rounded animate-pulse mb-2" />
                    <div className="h-3 w-48 bg-gray-100 rounded animate-pulse" />
                  </div>
                ) : paymentFailed ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="font-semibold text-amber-900">We could not load payment options</p>
                    <p className="text-xs text-amber-800 mt-1">Your cart is saved. Check your connection and try again, or contact support.</p>
                    <button onClick={loadConfig} className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-luxe-charcoal text-white rounded-lg text-xs font-bold hover:bg-luxe-black transition-colors">
                      Retry
                    </button>
                  </div>
                ) : paymentUnavailable ? (
                  /* ONE concise honest error card — no dead buttons, no
                     misleading "secure by Stripe" claims. The CTA row becomes
                     an enabled Contact Support action (see onPrimaryClick). */
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="font-semibold text-amber-900">Online payments are temporarily unavailable</p>
                    <p className="text-xs text-amber-800 mt-1">Your cart is saved — nothing will be charged. Please try again shortly or contact support.</p>
                    <Link to="/contact" className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-luxe-charcoal text-white rounded-lg text-xs font-bold hover:bg-luxe-black transition-colors">
                      Contact Support
                    </Link>
                  </div>
                ) : paymentSession ? (
                  <OnsitePaymentForm
                    publishableKey={config?.stripePublishableKey || ''}
                    clientSecret={paymentSession.clientSecret || ''}
                    amountLabel={`$${(paymentSession.totals?.total ?? total).toFixed(2)}`}
                    onSuccess={handlePaid}
                    onError={(m) => { setConfirmError(m); }}
                  />
                ) : (
                  <div className="rounded-xl border border-luxe-silver bg-luxe-cream/60 px-4 py-3 text-sm text-gray-600">
                    <p className="font-medium text-luxe-charcoal">Your card details are handled by {config?.activeCardProvider || 'Stripe'} — they never touch Luxedge servers.</p>
                    <p className="text-xs text-gray-500 mt-1">Press <b>Pay securely</b> to load the secure card form, review your order, and complete payment.</p>
                  </div>
                )}
                {confirmError && <p className="mt-3 text-sm text-red-600">{confirmError}</p>}
              </div>
            </section>
          </div>

          {/* ORDER SUMMARY — desktop sticky */}
          <div className="hidden lg:block min-w-0 lg:col-span-2">
            <div className="min-w-0 bg-white rounded-2xl border border-luxe-silver/70 p-4 sm:p-6 shadow-sm lg:sticky lg:top-20">
              <h2 className="font-bold text-lg mb-5">Order Summary</h2>
              {summaryBody}
              <button
                onClick={onPrimaryClick}
                disabled={ctaDisabled}
                className={`mt-6 w-full py-4 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-gold ${ctaDisabled ? 'bg-gray-300 cursor-not-allowed' : 'bg-luxe-gold hover:bg-luxe-gold-dark'}`}
              >
                {ctaLabel}
              </button>
              {trustRow}
              <p className="mt-3 text-center text-[10px] text-gray-400">🔒 256-bit SSL · your order is reserved for 24 hours while you pay</p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile / tablet sticky payment bar — total + CTA always visible */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-luxe-silver/70 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-2px_12px_rgba(27,31,39,0.06)]">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="shrink-0">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Total</p>
            <p className="font-bold text-lg text-luxe-black leading-tight">${total.toFixed(2)}</p>
          </div>
          <button
            onClick={onPrimaryClick}
            disabled={ctaDisabled}
            className={`flex-1 py-3.5 rounded-xl text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 ${ctaDisabled ? 'bg-gray-300 cursor-not-allowed' : 'bg-luxe-gold hover:bg-luxe-gold-dark shadow-gold'}`}
          >
            {ctaLabel}
          </button>
        </div>
        {paymentReady && <p className="mt-1.5 text-center text-[9px] text-gray-400">Secure Stripe payment · 30-day returns · Customer support</p>}
      </div>
    </div>
  );
}
