import { useEffect, useRef } from 'react';

/**
 * Adsterra Social Bar / Popunder script loader.
 * Loads https://pl25509888.profitableratecpmnetwork.com/1e/60/9a/1e609a1772f1c8ac6a824ff2534ed894.js
 * exactly once across storefront pages (never inside /admin/*).
 */
export function useAdsterraPop(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/admin')) return;

    const SCRIPT_ID = 'adsterra-social-pop';
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = 'https://pl25509888.profitableratecpmnetwork.com/1e/60/9a/1e609a1772f1c8ac6a824ff2534ed894.js';
      s.async = true;
      document.head.appendChild(s);
    }
  }, []);
}

interface AdsterraBannerProps {
  className?: string;
}

/**
 * Adsterra Native Banner Unit (container-11967f6c35e05352ed496c96f6d8ddf4).
 * Mounts the container and executes invoke.js.
 */
export default function AdsterraBanner({ className = '' }: AdsterraBannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useAdsterraPop();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/admin')) return;

    const SCRIPT_ID = 'adsterra-invoke-script';
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.async = true;
      s.setAttribute('data-cfasync', 'false');
      s.src = 'https://pl25509212.profitableratecpmnetwork.com/11967f6c35e05352ed496c96f6d8ddf4/invoke.js';
      document.body.appendChild(s);
    }
  }, []);

  return (
    <div className={`my-6 flex flex-col items-center justify-center text-center ${className}`}>
      <span className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Advertisement</span>
      <div id="container-11967f6c35e05352ed496c96f6d8ddf4" ref={containerRef} className="min-h-[90px] w-full flex items-center justify-center max-w-4xl" />
    </div>
  );
}
