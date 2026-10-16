import { useEffect, useRef, useState } from 'react';
import { X, PaperPlaneRight, SpinnerGap } from '@phosphor-icons/react';

interface ChatMsg { role: 'user' | 'assistant'; content: string }

const GREETING = 'Hi! I\'m Luxie — your Luxedge fashion & style concierge. ✨ Ask me about our luxury apparel, lingerie & intimates, sizing, shipping, or styling recommendations.';

// Floating AI assistant (bottom-right). Powered by DeepSeek through the
// public /api/crm/assistant endpoint — the key never reaches the browser.
// Pure help/sales chat: it can never publish products or change prices.
export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && msgs.length === 0) {
      setMsgs([{ role: 'assistant', content: GREETING }]);
    }
  }, [open]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    try {
      const history = msgs.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const r = await fetch('/api/crm/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });
      const j = await r.json().catch(() => null) as { reply?: string; error?: string } | null;
      // Surface real backend errors (rate limit / validation) verbatim instead
      // of hiding them behind a generic fallback.
      if (j && !r.ok && typeof j.error === 'string') {
        const errorMsg: string = j.error;
        setMsgs((m) => [...m, { role: 'assistant', content: errorMsg }]);
        return;
      }
      // A 200 always carries a non-empty reply (server falls back to canned on
      // empty model output); guard anyway so an empty string never shows the
      // alarming broken-widget message.
      const reply = j && typeof j.reply === 'string' && j.reply.trim()
        ? j.reply
        : 'Sorry, I could not respond right now. Please try again or message us on WhatsApp (+1 440-941-8002).';
      setMsgs((m) => [...m, { role: 'assistant', content: reply }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Connection issue on my side. Please try again — or reach us on WhatsApp (+1 440-941-8002).' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Open AI assistant"
          className="fixed bottom-5 right-5 z-[125] w-14 h-14 rounded-full bg-gradient-to-br from-[#1E4636] to-[#143023] hover:from-[#285A46] hover:to-[#1E4636] text-white shadow-xl shadow-emerald-950/30 flex items-center justify-center transition-all hover:scale-110 group">
          <img src="/luxedge-mark.png" alt="Luxedge" className="w-9 h-9 rounded-full bg-white object-contain p-1" />
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-[125] w-[360px] max-w-[calc(100vw-2rem)] h-[480px] max-h-[calc(100vh-6rem)] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-gray-100">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-[#143023] via-[#1E4636] to-[#285A46] flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-full bg-white border border-white/40 flex items-center justify-center overflow-hidden">
              <img src="/luxedge-mark.png" alt="Luxedge" className="w-full h-full object-contain p-1" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-[13px] font-bold leading-tight">Luxie — Style Concierge</p>
              <p className="text-[10px] text-emerald-100 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300" /> Online · fashion &amp; sizing advice</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors">
              <X size={14} weight="bold" />
            </button>
          </div>

          {/* Messages */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 bg-slate-50">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-[#1E4636] text-white rounded-br-sm'
                    : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-sm'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="px-3.5 py-2.5 rounded-2xl bg-white border border-gray-100 text-gray-400 text-[13px] flex items-center gap-2 shadow-sm">
                  <SpinnerGap size={14} className="animate-spin" /> Luxie is typing…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-100 bg-white shrink-0 flex items-center gap-2">
            <input
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              placeholder="Ask about fashion, lingerie, sizing, styling…"
              className="flex-1 px-3.5 py-2.5 border border-gray-200 rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-[#1E4636] transition-all"
            />
            <button onClick={send} disabled={busy || !input.trim()} aria-label="Send"
              className="w-10 h-10 rounded-xl bg-[#1E4636] hover:bg-[#143023] disabled:opacity-40 text-white flex items-center justify-center transition-colors shrink-0">
              <PaperPlaneRight size={17} weight="fill" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
