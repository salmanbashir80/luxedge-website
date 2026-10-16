import { useEffect, useRef } from 'react';

/**
 * Popunder script is disabled to protect user experience and prevent
 * unwanted automatic redirects / file downloads on user clicks.
 */
export function useAdsterraPop(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const existing = document.getElementById('adsterra-social-pop');
    if (existing) existing.remove();
    const rogueScripts = document.querySelectorAll('script[src*="profitableratecpmnetwork.com"]');
    rogueScripts.forEach((s) => s.remove());
  }, []);
}

interface AdsterraBannerProps {
  className?: string;
}

/**
 * Adsterra Placed Native Banner Unit (container-11967f6c35e05352ed496c96f6d8ddf4).
 * Mounts in a fixed placement inside page layouts without click hijacking.
 */
export default function AdsterraBanner({ className = '' }: AdsterraBannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/admin')) return;
    if (!containerRef.current) return;

    // Check if script is already injected in this container
    if (containerRef.current.querySelector('script[data-adsterra-invoke]')) return;

    const s = document.createElement('script');
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.setAttribute('data-adsterra-invoke', 'true');
    s.src = 'https://pl25509212.profitableratecpmnetwork.com/11967f6c35e05352ed496c96f6d8ddf4/invoke.js';
    containerRef.current.appendChild(s);
  }, []);

  return (
    <div className={`my-8 flex flex-col items-center justify-center text-center overflow-hidden ${className}`}>
      <span className="text-[10px] uppercase tracking-wider text-gray-400 mb-2 font-mono">Sponsored Recommendations</span>
      <div
        id="container-11967f6c35e05352ed496c96f6d8ddf4"
        ref={containerRef}
        className="min-h-[100px] w-full flex items-center justify-center max-w-4xl"
      />
    </div>
  );
}
