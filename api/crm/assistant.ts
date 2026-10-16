// POST /api/crm/assistant — storefront AI assistant (OpenRouter → DeepSeek)
//
// Public, rate-limited chat for site visitors: answers questions about the
// store, products, shipping, returns, fashion, sizing, styling. It is a sales/help assistant, NOT
// a publishing tool — it can never create/update products, orders or prices.
//
//   { message: string, history?: [{role:'user'|'assistant', content:string}] }
//
// Keys stay server-side. Primary: OpenRouter free pool (MiniMax M3) via the
// owner-attached OPENROUTER_API_KEY; DeepSeek remains the fallback when its
// key is configured. A hard cap on history + message length prevents abuse.
// Falls back to a friendly canned reply if every provider fails so the
// visitor never sees a broken widget.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson, rateLimited, clientIp, generateWithFallback, isConfiguredFull, defaultModelFor } from '../_lib/providers.js';
import { supabaseConfig, supabaseFetch, uid, isMissingTable } from './_lib.js';

const SYSTEM = `You are Luxie, the sophisticated AI personal stylist and shopping assistant for LUXEDGE (luxedge.us), a curated luxury fashion and intimate apparel boutique based in Denver, Colorado, USA and operated by Embani LLC.

Help visitors with:
- Luxury fashion, lingerie, intimates, and apparel recommendations (dresses, lingerie, satin sleepwear, sculpting shapewear, elegant tops, shoes, handbags, jewelry)
- Fit and sizing guidance (bust/waist/hip measurements, size selection, fabric drape)
- Styling advice (outfit pairings, occasion dressing, date night looks, capsule wardrobe tips)
- USA shipping policy (fast trackable shipping within the USA), returns, orders
- Care advice for delicate fabrics (silk, satin, delicate lace, fine knits)
- Anything else about Luxedge

Rules:
- Be warm, chic, elegant, concise, and helpful. Use a luxury concierge tone with short paragraphs or clean bullet points.
- NEVER invent products, prices, stock levels, discounts or facts you are not certain of. If you don't know, say you are not sure and suggest emailing the store at hello@luxedge.us.
- NEVER promise delivery dates or stock availability.
- You cannot place orders, change prices, or publish products. Offer the storefront links (/shop, /cart, /checkout) and contact info instead.
- Keep answers under ~180 words.`;

interface Msg { role: string; content: string }

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    sendJson(res, 429, { error: 'Too many messages — please slow down and try again shortly.' });
    return;
  }

  let body: { message?: string; history?: Msg[] };
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }

  const message = String(body.message || '').trim().slice(0, 800);
  if (!message) {
    sendJson(res, 400, { error: 'Message is required.' });
    return;
  }

  // Build the message list: system + last ~8 turns + current message.
  const history: Msg[] = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const messages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 2000)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  messages.push({ role: 'user', content: message });

  // Persist the lead (ai_chat source) so the owner sees every chat in the CRM.
  const cfg = supabaseConfig();
  if (cfg) {
    try {
      const pageUrl = String(req.headers.referer || '').slice(0, 500) || undefined;
      const r = await supabaseFetch(cfg, '/rest/v1/crm_leads', {
        method: 'POST',
        body: {
          id: uid(),
          email: null,
          name: 'AI chat visitor',
          source: 'ai_chat',
          page_url: pageUrl ?? null,
          opted_in: false,
          metadata: { last_message: message.slice(0, 300) },
        },
      });
      if (r.ok || isMissingTable(r)) {
        // fine — lead stored, or table pending
      }
    } catch {
      // lead persistence is best-effort; never fail the chat because of it
    }
  }

  // Free-first chain: OpenRouter (MiniMax M3 free) primary, DeepSeek fallback
  // when its key is configured. Both keys stay server-side.
  const openrouterReady = await isConfiguredFull('openrouter');
  const deepseekReady = await isConfiguredFull('deepseek');
  if (!openrouterReady && !deepseekReady) {
    sendJson(res, 200, {
      reply: 'Thanks for your message! Our team will get back to you shortly. For instant help, message us on WhatsApp (+1 440-941-8002) or email sales@luxedge.us.',
      provider: 'canned',
      leadStored: false,
    });
    return;
  }

  try {
    const prompt = messages.map((m) => `${m.role === 'user' ? 'Customer' : 'Luxie'}: ${m.content}`).join('\n\n');
    const result = await generateWithFallback(
      openrouterReady ? 'openrouter' : 'deepseek',
      openrouterReady && deepseekReady ? 'deepseek' : null,
      {
        prompt,
        // Always the provider's current registry default — a hardcoded slug
        // here silently rotted when OpenRouter retired it (HTTP 404), which
        // sent every customer a canned reply instead of a real answer.
        model: defaultModelFor(openrouterReady ? 'openrouter' : 'deepseek'),
        system: SYSTEM,
      },
    );
    const reply = (result.text || '').trim();
    // Models occasionally return empty content — never emit reply:""
    // (the client treats it as a broken response). Fall back to canned.
    if (!reply) {
      sendJson(res, 200, {
        reply: 'I hit a small snag on my side. Please try again in a moment — or reach us instantly on WhatsApp (+1 440-941-8002) / sales@luxedge.us.',
        provider: 'canned',
        leadStored: true,
      });
      return;
    }
    sendJson(res, 200, { reply, provider: result.provider, model: result.model });
  } catch {
    sendJson(res, 200, {
      reply: 'I hit a small snag on my side. Please try again in a moment — or reach us instantly on WhatsApp (+1 440-941-8002) / sales@luxedge.us.',
      provider: 'canned',
      leadStored: true,
    });
  }
}
