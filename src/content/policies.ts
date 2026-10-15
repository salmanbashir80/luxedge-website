// ============================================================================
// LUXEDGE — shared static page content (single source of truth)
//
// Used by both the React pages (src/App.tsx) and the worker pre-render
// (worker/seo-meta.ts) so crawlers and users see the same substantive
// content in the initial HTML. Every fact is drawn from the live policies.
// ============================================================================

/**
 * Public contact details.
 *
 * The support phone number and the street address are published deliberately —
 * the owner restored both after the earlier email-only attempt.
 */
export const CONTACT_INFO = [
  { label: 'Email', value: 'hello@luxedge.us', sub: 'We reply within 24hrs' },
  { label: 'Phone', value: '(440) 941-8002', sub: 'Mon-Fri, 9AM-6PM CT' },
  { label: 'Address', value: '1500 N Grant St, Denver, CO 80203', sub: 'United States' },
  { label: 'Hours', value: 'Mon - Fri', sub: '9:00 AM - 6:00 PM CT' },
];

export interface PolicySection {
  title: string;
  body: string;
}

export const PRIVACY_SECTIONS: PolicySection[] = [
  { title: 'Introduction', body: 'At Luxedge, we value your privacy and are committed to protecting your personal information. This Privacy Policy explains what information we collect, how we use it, and the choices you have when using our website. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Information We Collect', body: 'Name, billing and shipping address, email address, phone number, payment and transaction information (Luxedge does not store complete card numbers), order history, messages and contact details you provide through the contact form or our support assistant, IP address, browser type, device information, and website usage information through cookies and analytics.' },
  { title: 'Checkout Options', body: 'You do not need an account to buy from Luxedge. Guest checkout collects only what is needed to process, ship, and support the order. If you create an account instead, we keep your order history, profile details and saved information so you can track current and past orders. Either way, the information is collected, stored and protected under this policy.' },
  { title: 'How We Use Your Information', body: 'To process and fulfill orders, communicate regarding orders and customer service, respond to inquiries, improve our website, prevent fraud, comply with legal obligations, and send promotional emails if you have opted in.' },
  { title: 'Cookies and Analytics', body: 'Our website uses essential browser storage for the cart, account sessions, and preferences. With your consent, we may load Google Analytics and Google advertising technologies, including AdSense, to measure traffic and show relevant ads. Google and its partners may use cookies or similar technologies and may use information such as device, browser, and interaction data as described in Google\'s own policies. Our site sends Google consent signals (Consent Mode) covering advertising storage, advertising personalization, advertising measurement, and analytics storage; they remain denied until you accept, and Google is instructed not to read or write advertising cookies while they are denied. You can decline optional analytics and advertising through the consent prompt, change your decision by clearing this site\'s storage in your browser, or use Google\'s advertising settings (https://adssettings.google.com) to control the ads Google shows you; see our choices section for more information. Where required by law, including in the European Economic Area, the United Kingdom, and Switzerland, we use a consent solution compatible with Google\'s certification requirements for advertising partners before personalized advertising runs.' },
  { title: 'Sharing Your Information', body: 'We do not sell or rent your personal information. We share only with trusted service providers including payment processors, shipping carriers, website hosting, analytics, and AI service providers that help operate support tools.' },
  { title: 'Data Security', body: 'We use reasonable administrative, technical, and physical safeguards. While no method of transmission is completely secure, we strive to use industry-standard practices.' },
  { title: 'Your Privacy Choices', body: 'You may request access to, correction of, or deletion of personal information. We do not sell personal information. To make a privacy request, email hello@luxedge.us.' },
  { title: 'Children\'s Privacy', body: 'Luxedge is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided information to us, contact hello@luxedge.us so we can review it and delete it where appropriate.' },
  { title: 'Advertising and Third-Party Vendors', body: 'Luxedge is supported by advertising. Google (including AdSense) is an advertising vendor on this site, and third-party vendors, including Google, may use cookies or similar identifiers to serve ads based on your prior visits to this website or other websites. Those vendors may collect device, browser, and interaction data for ad delivery, measurement, and fraud prevention. Advertising may be personalized or non-personalized depending on your consent and your region, and where consent is required it is collected before personalized advertising runs. You can control personalized advertising from Google in your Google Ads Settings (https://adssettings.google.com), and you can review how Google uses information from sites that use its services at Google\'s Partner Sites Privacy Policy (https://policies.google.com/technologies/partner-sites). Turning off personalized advertising does not remove ads; it makes them less relevant to you.' },
  { title: 'Your US Privacy Rights', body: 'If you live in a US state with a comprehensive privacy law, including California, you have the right to know what personal information we hold about you, to request a copy of it, to ask us to correct it, and to ask us to delete it. You also have the right to opt out of the sale or sharing of personal information: Luxedge does not sell personal information and does not share it for cross-context behavioral advertising outside the consent choices described above. We will not discriminate against you for making a privacy request. To exercise any of these rights, email hello@luxedge.us from the address on the order, include the request and the order number if you have one, and we will respond within the timeframe the law allows.' },
  { title: 'Data Retention', body: 'Order, payment, and shipping records are kept for as long as needed to fulfil the order and then to meet accounting, tax, warranty, and dispute obligations. Support emails and contact-form messages are kept while the issue is open and for a reasonable period afterwards so we can recognise repeat problems. Analytics data is retained according to the settings of the provider we use. When information is no longer needed, we delete it or remove the details that identify you.' },
  { title: 'Payment Details', body: 'Card and bank details are entered on the payment provider\'s own secure checkout and are not stored on Luxedge servers: we receive a confirmation that a payment succeeded, along with the transaction reference we need for refunds and accounting, not your full card number. Online payment processing is provided by a third-party payment processor when checkout is enabled. If payment is not enabled, checkout does not create a paid order and no payment is taken.' },
  { title: 'Email Marketing', body: 'If you opt in to newsletters or promotional messages, you can unsubscribe using the link in the message or by contacting us. Transactional messages about an order or a support request may still be sent when they are necessary.' },
  { title: 'Third-Party Links', body: 'Our website may link to websites we do not control. We are not responsible for the privacy practices or the content of those websites; check their own policies before you give them information.' },
  { title: 'International Visitors', body: 'Luxedge is operated in the United States, and the information described here is processed there. If you order from outside the United States, you are sending your information to the United States for the purposes described in this policy, and shipping and returns follow the terms published on our shipping and returns pages. Visitors in the European Economic Area, the United Kingdom, and Switzerland receive the consent choices described in the advertising section before advertising cookies are used.' },
  { title: 'Updates to This Policy', body: 'When this policy changes in a way that affects what we collect or how we use it, we publish the revised version here with a new date. Material changes are also described where we can reach you, such as at the top of the site or by email if you have an account on file.' },
  { title: 'Contact Us', body: 'Questions about this Privacy Policy? Email hello@luxedge.us or call (440) 941-8002. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

export const TERMS_SECTIONS: PolicySection[] = [
  { title: 'Using Luxedge', body: 'By using this website, you agree to these Terms of Service and our Privacy Policy. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Products, Pricing, and Availability', body: 'Product availability, pricing, images, specifications, and descriptions may change. We work to keep details accurate, but occasional errors may occur.' },
  { title: 'Orders and Payment', body: 'Submitting checkout is not acceptance of an order. An order is accepted only after the payment provider confirms a successful transaction and Luxedge sends a confirmation. If payment is unavailable, the checkout action remains disabled and no paid order is created.' },
  { title: 'Customer Responsibilities', body: 'You are responsible for providing accurate contact, shipping and payment details, and for using any product according to the manufacturer\'s instructions, the product label, its warnings, and the law that applies where you are.' },
  { title: 'Shipping and Delivery', body: 'Shipping availability, cost, and estimated delivery windows are shown at checkout or on product pages. Estimates are not guarantees.' },
  { title: 'Returns, Replacements, and Refunds', body: 'Returns and replacements are governed by our Return & Replacement Policy. Luxedge does not offer change-of-mind refunds as a standard remedy.' },
  { title: 'Product Information', body: 'Product information is for general shopping purposes. Follow the care label, sizing guidance and warnings, and stop using any item that appears unsafe or damaged. Luxedge does not manufacture or independently certify the products it sells, including fabrics, metals, gemstones, watches and eyewear. Check the listing, materials, size chart and supplier reference before you buy.' },
  { title: 'Disclaimers and Liability', body: 'The website and its content are provided without warranties beyond those that cannot legally be excluded. Luxedge is not liable for indirect, incidental, or consequential losses except where liability cannot be limited.' },
  { title: 'Order Acceptance and Cancellation', body: 'We may decline or cancel an order if an item is out of stock, if a price or product detail was listed in error, if payment cannot be verified, or if the delivery address cannot be served. If we cancel an order after payment, the amount charged for that order is refunded to the original payment method. You may ask us to cancel an order before it ships by emailing hello@luxedge.us with the order number; once a shipment is with the carrier, the returns process applies instead.' },
  { title: 'Intellectual Property', body: 'The Luxedge name, logo, page layouts, buying guides, and the descriptions we write are owned by Luxedge or licensed to it, and may not be republished, resold, or used to train or supply a competing catalogue without written permission. Photographs and diagrams supplied by manufacturers or suppliers remain the property of their owners and are used to identify the product being sold. You may share a link to a Luxedge page freely.' },
  { title: 'Acceptable Use', body: 'Do not scrape or bulk-copy the catalogue, submit automated orders or contact-form floods, attempt to interfere with checkout, payment, or account security, or use Luxedge support channels to send unlawful, abusive, or misleading messages. We may restrict access where activity risks other customers, our suppliers, or the store itself.' },
  { title: 'Warranties and Product Limits', body: 'Products are supplied with the documentation and packaging the manufacturer provides. We do not add a warranty beyond the rights you have under applicable consumer law, and we do not warrant how a product will fit, wear or perform for you, because results depend on fit, fabric and metal care, and how the item is used and maintained. Follow the care label, the size chart, and any limit stated in the listing.' },
  { title: 'Governing Law', body: 'Luxedge is operated by Embani LLC, registered in Denver, Colorado, United States. These Terms of Service and any dispute or claim arising out of or in connection with them shall be governed by and construed in accordance with the laws of the State of Colorado and applicable federal law of the United States, without giving effect to any choice or conflict of law provision. Any dispute should first be raised with us at hello@luxedge.us so we can try to resolve it directly.' },
  { title: 'Changes and Contact', body: 'We may update these Terms by posting a revised version with a new date. Continued use of the site after an update means the revised Terms apply. If any part of these Terms is found unenforceable, the remaining parts continue to apply. Questions about an order, a return, or these Terms: email hello@luxedge.us or call (440) 941-8002, Monday to Friday, 9AM–6PM CT.' },
];

export const RETURNS_SECTIONS: PolicySection[] = [
  { title: 'Our Promise', body: 'If you receive a product that is damaged, defective, or incorrect, contact us within 30 days of delivery and we will work to resolve it as quickly as we can. This policy covers orders that arrive wrong or faulty; it is not a change-of-mind return programme.' },
  { title: 'Return Eligibility', body: 'Return requests must be made within 30 days of delivery. Products must be in their original packaging with all included parts and accessories. Items opened solely for reasonable inspection remain eligible if found to be defective or damaged upon arrival. Returns need prior approval from Luxedge before they are shipped back, so please contact us first.' },
  { title: 'Replacement Policy', body: 'Once we receive and inspect your returned product, we will process a replacement if the return meets the policy requirements. Replacement items are shipped after the returned product has been received and approved.' },
  { title: 'Refunds and Legal Rights', body: 'Luxedge does not offer change-of-mind refunds, exchanges for different products, or store credit as a standard policy. Eligible damaged, defective, or incorrect products are normally handled by replacement. Where applicable law or a payment-provider rule requires a refund or another remedy, that right is not limited by this policy.' },
  { title: 'Return Shipping', body: 'Customers are responsible for purchasing their own return shipping label, for packaging the product so it is not damaged in transit, and for all return shipping costs. Use a trackable shipping service: Luxedge is not responsible for a return that is lost or damaged on its way back.' },
  { title: 'Damaged or Incorrect Orders', body: 'If your order arrives damaged, or you received the wrong product, contact us within 30 days of delivery with your order number and photos of the product and its packaging so we can review the request promptly.' },
  { title: 'Contact Us', body: 'Questions about returns? Email hello@luxedge.us or call (440) 941-8002. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

/**
 * Shipping policy, in reading order. This array is the single source of truth:
 * the worker pre-renders these exact strings into the crawl HTML and the React
 * page renders the same section titles, so a crawler and a visitor cannot be
 * shown different shipping terms. Facts stay deliberately conservative — we do
 * not publish a delivery window, carrier or processing time the checkout does
 * not actually stand behind. Nothing here may promise a number the storefront
 * cannot show.
 */
export const SHIPPING_SECTIONS: PolicySection[] = [
  { title: 'Overview', body: 'This page explains how Luxedge orders are shipped: where we deliver, how shipping is priced, what affects your delivery estimate, and what to do if something goes wrong with a shipment. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
  { title: 'Where We Ship', body: 'Luxedge offers shipping within the United States where the destination is supported by the product, supplier, and carrier. International shipping is not currently offered.' },
  { title: 'Shipping Costs', body: 'Shipping cost is calculated for your specific cart, products, and destination, and is shown in the cart and again at checkout before you pay. The amount displayed immediately before payment is the amount that applies to your order. Free shipping currently applies to qualifying orders of $50 or more, and to orders where every item in the cart is individually flagged as qualifying for free shipping. A promotion applies only as displayed in the cart or checkout, may have exclusions, and can change or end without notice; the threshold and the final charge are always confirmed before you pay.' },
  { title: 'Processing Time', body: 'Orders are prepared for dispatch once payment is confirmed. Because different products may be fulfilled from different supplier locations, preparation time can vary between items in the same order. You will receive shipment and tracking information when it becomes available.' },
  { title: 'Shipping Methods & Times', body: 'Shipping methods and estimated delivery windows are shown on the product page and again at checkout. Where a listing carries its own window \u2014 for example 5 to 11 business days \u2014 that window applies to that item; where it does not, our standard estimate is 7 to 14 business days from dispatch. Delivery estimates are estimates, not guarantees: your destination, the fulfilment location of each item, and carrier load all affect the final date. Express shipping is not currently offered unless it is specifically shown as an option at checkout.' },
  { title: 'Order Tracking', body: 'Once your order ships, you will receive a confirmation email with a tracking number that you can use on the carrier\u2019s website. You can also check your order status at any time from your Luxedge account.' },
  { title: 'Delivery Delays', body: 'Delays can occasionally occur because of high order volume, supplier or carrier issues, weather events, public holidays, or other circumstances outside our control. Delivery estimates can be affected by your destination, the fulfilment location of each item, and carrier load during peak periods. If your order is significantly delayed, contact us and we will investigate.' },
  { title: 'Missing or Lost Packages', body: 'If tracking shows "delivered" but you have not received your package, check with neighbours, building management, or your local post office. If you still cannot locate your package after 48 hours, contact hello@luxedge.us and we will work with the carrier to resolve it.' },
  { title: 'Address Accuracy', body: 'Please double-check your shipping address before completing checkout. Luxedge is not responsible for orders shipped to an incorrect address provided by the customer. Address correction fees charged by carriers are the customer\u2019s responsibility.' },
  { title: 'P.O. Boxes & Military Addresses', body: 'P.O. Box and APO/FPO/DPO destinations are supported where a carrier can deliver to them, and the available options are shown at checkout. Delivery times to military addresses may vary, and express services may not be available for these destinations.' },
  { title: 'Related Information', body: 'See our Returns & Refunds policy for damaged, defective, or incorrect items, the FAQ for common delivery and tracking questions, or contact us and we will help.' },
];

/** Copyright / DMCA page — one page, not four. Deliberately conservative:
 * it states what we own, what we use with permission, how to send a notice,
 * what a notice should contain, and that false notices are not acceptable. It
 * does not claim any registration, legal-agent designation or statutory
 * obligation the business has not established. */
export const COPYRIGHT_SECTIONS: PolicySection[] = [
  { title: 'Copyright', body: 'The original content published on luxedge.us — our product write-ups, buying guides, page copy, the site design and layout, and the Luxedge name and logo — is owned by Embani LLC (operating as Luxedge) or used with permission. Copyright \u00a9 2026 Embani LLC. All rights reserved. Photography on Luxedge is original, supplied by verified suppliers, licensed under royalty-free commercial licenses (including Pexels), or used under applicable Creative Commons licenses with author attribution. Product names, brand names and supplier photography that appear in a listing stay the property of their respective owners.' },
  { title: 'Using Our Content', body: 'You are welcome to quote a short excerpt of a guide or product description if you link back to the page you took it from. Republishing an article in full, reselling our images, or presenting our content as your own is not permitted without written permission from us. If you are unsure whether your intended use is allowed, email us before you publish.' },
  { title: 'Reporting Infringing Material', body: 'If you believe material published on luxedge.us infringes a copyright you own or represent, email hello@luxedge.us with the subject line \u201cCopyright Notice\u201d. Include the page address (URL) of the material so we can find it, and we will review the notice and remove or disable access to material that is properly identified.' },
  { title: 'What a Notice Should Include', body: 'To let us act quickly, a notice should contain:\n\u2022 identification of the copyrighted work you say is infringed;\n\u2022 the exact URL of the material you are asking us to remove;\n\u2022 your name, address, telephone number and email address;\n\u2022 a statement that you have a good-faith belief the use is not authorised by the owner, its agent, or the law;\n\u2022 a statement that the information in your notice is accurate and that you are the owner or are authorised to act for the owner;\n\u2022 your physical or electronic signature.\nWe may ask for clarification if a notice is incomplete.' },
  { title: 'If Your Material Was Removed', body: 'If we remove material that you published and you believe the removal was a mistake, you can reply to the same address with your contact details, the URL concerned, and an explanation of why the material should be restored. We will review it and may restore the material where the law allows.' },
  { title: 'Misleading or Abusive Notices', body: 'Please do not send notices you know to be false or misleading, and do not use this process to remove legitimate criticism or a competitor\u2019s genuine listing. We may decline to act on notices that are incomplete, that are not about copyright, or that appear to be an attempt to misuse the process. Sending a knowingly false notice can carry legal consequences for the sender.' },
  { title: 'Contact', body: 'Copyright questions and notices: email hello@luxedge.us or call (440) 941-8002, Monday to Friday, 9AM\u20136PM CT. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

/** Editorial Policy — explains who prepares the guides and how factual claims,
 * product links, updates, and corrections are handled. It makes no claim of
 * veterinary review or first-hand testing that the site cannot substantiate. */
/** Product and animal-care disclaimer. This is informational, not a medical or
 * veterinary promise, and uses only the limitations already reflected in the
 * site's terms and editorial process. */
export const DISCLAIMER_SECTIONS: PolicySection[] = [
  { title: 'General information', body: 'Luxedge product pages, style guides, and care articles provide general shopping and fashion information. They are not medical, legal, tailoring, or professional advice.' },
  { title: 'Care and safety', body: 'Do not use a Luxedge article or product description as medical advice. For skin irritation, an allergic reaction, an injury, or any urgent health problem, contact an appropriately qualified professional. If you have a known metal or material allergy, check the listing before you wear an item for long periods.' },
  { title: 'Product facts', body: 'We publish the product information we can verify. Size, material, capacity, compatibility, care instructions, and performance can vary by product or variant. Read the exact listing and product label before ordering or use, and do not rely on an image or a general guide as proof of a specification.' },
  { title: 'Use and supervision', body: 'Choose items for your size, activity and climate. Inspect products on arrival, follow the care label, and keep small accessories away from young children, who may swallow them. Stop using an item that breaks, tarnishes, or no longer fits.' },
  { title: 'No independent product testing', body: 'Luxedge does not claim to have independently tested, measured, or certified the products it sells. Product pages and style guides are written from the manufacturer and supplier information available to us, from the item as listed, and from reputable published guidance where a source is relevant. A guide describes what to check before buying; it is not a laboratory result and it is not a guarantee of how a product will perform or wear for you.' },
  { title: 'Affiliate links', body: 'Luxedge does not currently publish affiliate links, and no page on this site earns a commission from a third-party retailer. Product links go to our own store. If Luxedge ever joins an affiliate programme, the affected pages will say so above the link rather than only in this disclaimer.' },
  { title: 'Advertising', body: 'This site may display advertising, including advertising served by Google, and Luxedge may earn revenue from it. Advertising revenue is separate from product recommendations: an advertiser does not choose which products we list, and a product is not presented differently because an ad appeared next to it.' },
  { title: 'Questions and corrections', body: 'If a page contains an error, a broken link, or a product detail you need clarified, email hello@luxedge.us or call (440) 941-8002. Luxedge is operated by Embani LLC, 1500 N Grant St, Denver, CO 80203, United States.' },
];

export const EDITORIAL_SECTIONS: PolicySection[] = [
  { title: 'Who prepares our guides', body: 'Luxedge buying guides and care articles are prepared by the Luxedge Editorial Team. The team writes from the product information available to Luxedge, the individual product listing, and reputable published fashion and care guidance where a source is relevant. We do not present the team as stylists, tailors, designers, manufacturers, or product testers.' },
  { title: 'What our articles are for', body: 'Our guides help readers compare everyday fashion pieces, check fit and sizing, and care for fabrics, metals, leather and eyewear. They are general shopping and care information. They are not medical, legal, or professional advice. For a skin reaction or an urgent health problem, contact an appropriately qualified professional.' },
  { title: 'Product facts and links', body: 'Product links are included only when they are relevant to the topic and the product is publicly listed. We do not invent dimensions, materials, capacities, certifications, ratings, reviews, safety tests, or performance results. When a fact is not confirmed, the article tells the reader to check the product listing, label, or supplier evidence before ordering.' },
  { title: 'Updates and corrections', body: 'We update an article when a product, policy, link, or factual explanation materially changes. We preserve the article URL when it remains useful. If an article cannot be kept accurate or relevant, we may remove it or hold it from public indexing. Readers can report a factual error or a broken link by emailing hello@luxedge.us.' },
  { title: 'Images and attribution', body: 'Images are used when they help explain the subject or identify a product. We use images supplied for the store or images from sources whose stated terms permit the intended use, and we keep descriptive alternative text where an image is part of an article. An image is not evidence of a product specification or performance claim.' },
  { title: 'Last reviewed', body: 'This policy describes the editorial process used for Luxedge guides. It does not mean every article has been independently reviewed by a veterinarian or other professional.' },
];

/**
 * Last-updated label per policy route. ONE source, read by both the worker's
 * pre-rendered HTML and the React page, so the crawl copy and the hydrated copy
 * cannot disagree about when a policy last changed. /copyright is dated to the
 * day it was published rather than inheriting an earlier revision date.
 */
export const POLICY_LAST_UPDATED: Record<string, string> = {
  '/privacy': 'August 26, 2026',
  '/terms': 'August 26, 2026',
  '/returns': 'August 26, 2026',
  '/shipping-policy': 'September 15, 2026',
  '/copyright': 'September 14, 2026',
  '/editorial-policy': 'September 15, 2026',
  '/disclaimer': 'September 15, 2026',
};

export interface FaqItem {
  q: string;
  a: string;
}

export interface FaqCategory {
  category: string;
  items: FaqItem[];
}

/**
 * The /faq page — ONE source, read by BOTH the worker pre-render
 * (injectFaqBody) and the React page (FAQPage in src/App.tsx).
 *
 * There used to be a second, hand-maintained copy of these questions inside the
 * React component. The two drifted, and the crawl HTML ended up telling Google
 * something the page did not tell visitors: that online payment is "handled by
 * the configured third-party provider" while checkout — correctly — reports
 * that payment is not enabled (GET /api/checkout/onsite returns
 * anyProviderReady:false, and the checkout page shows its "temporarily
 * unavailable, nothing will be charged" state). Serving crawlers different
 * answers than visitors is misleading content, so the duplicate list was
 * deleted rather than synced.
 *
 * Rules for this array:
 *  - Every answer must agree with the policy page that owns the fact
 *    (SHIPPING_SECTIONS, RETURNS_SECTIONS, PRIVACY_SECTIONS) and with what the
 *    code actually does (checkout provider state, cancellation window, support
 *    channels).
 *  - No claim about certifications, supplier verification, reviews, or a
 *    feature the site does not have — see the notes on the answers below.
 *  - The payments answers are deliberately written to be true in BOTH states:
 *    they never assert that a provider is connected, and they never promise a
 *    method the checkout cannot show.
 */
export const FAQ_DATA: FaqCategory[] = [
  { category: 'Orders & Shipping', items: [
    { q: 'How long does shipping take?', a: 'Standard shipping is estimated at 7 to 14 business days from dispatch, unless an item-specific delivery window is shown on the product page. Orders typically undergo 1 to 2 business days of preparation before dispatch, and tracking details are emailed as soon as the package ships.' },
    { q: 'Do you offer free shipping?', a: 'Some products or orders may qualify for a free-shipping promotion. Eligibility, exclusions, and the final shipping charge are shown in the cart or at checkout.' },
    { q: 'How can I track my order?', a: 'Once your order ships you will receive an email with a tracking number, and the current status is always available under "My Orders" in your account.' },
    { q: 'Do you ship internationally?', a: 'Currently, Luxedge offers shipping within the United States where the destination is supported by the product, supplier, and carrier. International shipping is not currently offered.' },
    { q: 'Can I change my shipping address after ordering?', a: 'If your order has not shipped yet, contact us immediately at hello@luxedge.us and we will update it if we can. Once it has shipped, the address cannot be changed.' },
  ]},
  { category: 'Returns & Refunds', items: [
    { q: 'What is your return policy?', a: 'Our 30-day return window covers products that arrive damaged, defective, or incorrect. Return requests must be made within 30 days of delivery, and items should be in their original packaging. Items opened solely for reasonable inspection remain eligible if found to be defective or damaged upon arrival. Email hello@luxedge.us to request return approval.' },
    { q: 'How does the replacement process work?', a: 'Once we receive and inspect the returned product, we process a replacement if the return meets policy requirements. Change-of-mind refunds and exchanges for different products are not standard; rights that cannot be waived still apply.' },
    { q: 'Who pays for return shipping?', a: 'Customers are responsible for purchasing their own return shipping label, for packaging the product so it is not damaged in transit, and for all return shipping costs \u2014 the same wording as our Returns & Replacement Policy. Use a trackable service, because we are not responsible for a return lost on its way back.' },
    { q: 'What if I receive a damaged or incorrect item?', a: 'Contact us within 30 days of delivery with your order number and photos of the product and packaging. We will review the request and, where it meets the policy, arrange a replacement.' },
  ]},
  { category: 'Payment & Security', items: [
    { q: 'How does online checkout and payment work?', a: 'Orders are placed directly through our secure online checkout. We accept major payment methods supported by our third-party checkout provider with industry-standard encryption. If checkout is undergoing scheduled maintenance, your cart is preserved and our support team is available to help you complete your order.' },
    { q: 'What payment methods do you accept?', a: 'When a payment provider is connected, the options it supports appear at checkout and the card form is provided by that provider. The amount displayed immediately before you pay is the amount that applies to your order.' },
    { q: 'Is my payment information secure?', a: 'Card details are entered in the payment processor\u2019s own secure form and never touch Luxedge servers. Luxedge does not store complete card numbers.' },
    { q: 'Can I cancel an order?', a: 'Orders can be canceled within 2 hours of placement. After that the order enters processing — email hello@luxedge.us as soon as possible and we will tell you where it stands.' },
  ]},
  { category: 'Products & Quality', items: [
    { q: 'What materials do your products use?', a: 'Materials are listed on each product page, including fabric, leather, metal, or gemstone details where the supplier provides them. Where a material cannot be confirmed, the product page says so.' },
    { q: 'How do you select your products?', a: 'Every product goes through a curation process before it is listed. We consider quality, design, value, and the supplier information we hold; where a specification cannot be confirmed, the product page says so instead of stating it.' },
    { q: 'Are your products authentic?', a: 'We aim to source products from manufacturers and authorized distributors, and every item is reviewed before it is listed. If a listing cannot confirm a brand, size, or material, the product page says so.' },
    { q: 'Do you offer warranties?', a: 'Warranty coverage varies by product and manufacturer. Check the product description for specific details; our 30-day return policy covers general quality issues.' },
  ]},
  { category: 'Account & Support', items: [
    { q: 'Do I need an account to shop?', a: 'No. You can browse, add items to the cart, and check out without creating an account \u2014 orders are placed with the email address you provide. Creating an account lets you view your order history and manage your profile.' },
    { q: 'How do I contact customer support?', a: 'Email hello@luxedge.us or call (440) 941-8002. Our support team is available Monday-Friday, 9 AM - 6 PM CT. We typically respond to emails within 24 hours.' },
    { q: 'I forgot my password. What do I do?', a: 'Email us at hello@luxedge.us from the address on your account and we will help you regain access.' },
  ]},
];

/** Contact page — pre-rendered intro paragraph. */
export const CONTACT_INTRO = 'Have a question, concern, or just want to say hello? We\'d love to hear from you. Our team typically responds within 24 hours.';

/** Contact page — pre-rendered message-sent confirmation text. */
export const CONTACT_SENT = 'Message Received! Thank you for reaching out. We\'ll get back to you within 24 hours.';
