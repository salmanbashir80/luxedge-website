// ============================================================================
// LUXEDGE — MEDIA HUB (storefront)
//
// Premium US editorial video hub. The official YouTube channel is the primary
// video host: these pages embed official YouTube videos (click-to-load, never
// autoplay) and send viewers back to the channel. Every editorial field comes
// from the Supabase `media_videos` table (migration 0026) — nothing here is
// invented; empty sections simply don't render.
//
// YOUTUBE_CHANNEL_URL is a documented placeholder until Salman provides the
// real channel URL. It is the ONLY place this value lives on the client; the
// worker uses the same placeholder (see worker/seo-meta.ts) so Subscribe CTAs
// and structured data stay consistent until the real URL is supplied.
// ============================================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  Play,
  YoutubeLogo,
} from '@phosphor-icons/react';
import type { Product } from '../App';
import { trackEvent, utmParams } from '../lib/marketing';
import {
  loadPublishedMedia,
  mediaThumbnail,
  formatDuration,
} from '../services/media';
import type { MediaVideo } from '../services/media';

/**
 * Official Luxedge channel (AI With Salman) — verified from the owner data of
 * the channel's real video YOBlXCyOh28 (channel id UCPvPDstYz61AebGhKzKS1lw).
 * This is the single client-side source for Subscribe CTAs + the footer link.
 */
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@TheAIWithSalman';
export const YOUTUBE_CHANNEL_ID = 'UCPvPDstYz61AebGhKzKS1lw';

export const MEDIA_CATEGORIES = [
  { id: 'product-education', label: 'Product Education', blurb: 'How our products are made, what they do, and why they earn their place.' },
  { id: 'fashion-styling', label: 'Fashion & Styling', blurb: 'Practical styling guidance, capsule wardrobes, and luxury fit advice.' },
  { id: 'himalayan-salt', label: 'Himalayan Salt & Natural Products', blurb: 'Salt licks, blocks and natural essentials — sourcing, science and use.' },
  { id: 'how-to-guides', label: 'How-To Guides', blurb: 'Step-by-step video guides with real demonstrations.' },
  { id: 'buying-guides', label: 'Buying Guides', blurb: 'What to look for, what to avoid, and how to choose well.' },
  { id: 'behind-the-brand', label: 'Behind the Brand', blurb: 'Stories from the Luxedge team and how we source.' },
] as const;

export const MEDIA_COPYRIGHT =
  '© Luxedge. Original video content may not be reproduced or redistributed without permission, except where permitted by applicable law.';

export function categoryLabel(id: string): string {
  return MEDIA_CATEGORIES.find((c) => c.id === id)?.label || 'Videos';
}

export function productPath(p: Pick<Product, 'id' | 'slug'>): string {
  return `/product/${p.slug || p.id}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Analytics — the five media events (first-party site_events + GA via gtag)
// ---------------------------------------------------------------------------
export function mediaEvent(name: string, extra: Record<string, unknown> = {}): void {
  trackEvent(name, { ...extra, ...utmParams() });
}

// ---------------------------------------------------------------------------
// Click-to-load YouTube embed — no iframe until the visitor clicks play.
// ---------------------------------------------------------------------------
export function YouTubeEmbed({
  videoId,
  title,
  start,
}: {
  videoId: string;
  title: string;
  start?: number | null;
}) {
  const [active, setActive] = useState(false);
  const startSec = start && start > 0 ? start : null;
  const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  if (active) {
    const qs = new URLSearchParams({ rel: '0', modestbranding: '1' });
    if (startSec) qs.set('start', String(startSec));
    return (
      <div className="relative w-full aspect-video bg-luxe-black rounded-2xl overflow-hidden">
        <iframe
          key={startSec ?? 'main'}
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?${qs.toString()}`}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setActive(true);
        mediaEvent('media_video_play', { video_id: videoId, title });
      }}
      className="relative block w-full aspect-video rounded-2xl overflow-hidden group focus-visible:outline-2 focus-visible:outline-luxe-gold"
      aria-label={`Play video: ${title}`}
    >
      <img
        src={thumb}
        alt={title}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-luxe-black/60 via-transparent to-transparent" aria-hidden="true" />
      <span
        className="absolute inset-0 m-auto w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-luxe-gold text-white flex items-center justify-center shadow-gold group-hover:scale-110 transition-transform duration-300"
        aria-hidden="true"
      >
        <Play size={26} weight="fill" />
      </span>
      <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-luxe-black/80 text-white text-[11px] font-semibold flex items-center gap-1">
        <Play size={10} weight="fill" aria-hidden="true" /> Play
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Media card — lazy thumbnail, duration badge, editorial metadata.
// ---------------------------------------------------------------------------
export function MediaCard({ video, priority = false }: { video: MediaVideo; priority?: boolean }) {
  const thumb = mediaThumbnail(video);
  const dur = formatDuration(video.duration);
  return (
    <article className="group">
      <Link to={`/media/${video.slug}`} className="block focus-visible:outline-luxe-gold rounded-2xl" aria-label={video.title}>
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-luxe-black/5">
          {thumb ? (
            <img
              src={thumb}
              alt={video.title}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-luxe-black text-luxe-gold-light">
              <YoutubeLogo size={34} weight="fill" aria-hidden="true" />
            </div>
          )}
          {dur && (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-luxe-black/85 text-white text-[11px] font-semibold flex items-center gap-1" aria-label={`Duration ${dur}`}>
              <Clock size={10} weight="fill" aria-hidden="true" /> {dur}
            </span>
          )}
          {video.isShort && (
            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-luxe-gold text-luxe-black text-[10px] font-bold uppercase tracking-wide">
              Short
            </span>
          )}
        </div>
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-luxe-gold-dark">{categoryLabel(video.category)}</p>
          <h3 className="mt-1 font-serif text-[15px] font-bold text-luxe-black leading-snug line-clamp-2 group-hover:text-luxe-gold-dark transition-colors">
            {video.title}
          </h3>
          {video.publishedAt && (
            <p className="mt-1 text-xs text-luxe-black/55">{formatDate(video.publishedAt)}</p>
          )}
        </div>
      </Link>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Subscribe CTA band (used on the hub and every video page).
// ---------------------------------------------------------------------------
export function SubscribeBand({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'mt-10' : 'mt-14'} aria-label="Subscribe on YouTube">
      <div className="rounded-3xl bg-luxe-black text-luxe-white px-6 py-8 sm:px-10 sm:py-10 flex flex-col sm:flex-row items-center gap-6 justify-between overflow-hidden relative">
        <div aria-hidden="true" className="absolute -top-20 -right-16 w-64 h-64 rounded-full bg-luxe-gold/10 blur-[80px]" />
        <div className="relative text-center sm:text-left">
          <p className="eyebrow mb-1 text-luxe-gold-light">Never Miss a Video</p>
          <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-tight">Subscribe on YouTube</h2>
          <p className="mt-1.5 text-sm text-luxe-white/65 max-w-md">
            New guides and stories go live on the official Luxedge channel first.
          </p>
        </div>
        <a
          href={YOUTUBE_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => mediaEvent('media_subscribe_click')}
          className="relative inline-flex items-center gap-2 px-6 py-3 rounded-full bg-luxe-gold hover:bg-luxe-gold-dark text-white font-bold text-sm transition-all hover:-translate-y-0.5 shadow-gold"
        >
          <YoutubeLogo size={18} weight="fill" aria-hidden="true" /> Subscribe
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// /media — the hub
// ---------------------------------------------------------------------------
export function MediaLatestSection() {
  const [videos, setVideos] = useState<MediaVideo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPublishedMedia().then((v) => {
      if (!cancelled && v && v.length > 0) setVideos(v.slice(0, 3));
    });
    return () => { cancelled = true; };
  }, []);

  if (!videos || videos.length === 0) return null;

  return (
    <section className="bg-luxe-black/5 py-10 sm:py-12" aria-label="Latest from Luxedge Media">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-luxe-gold-dark">Watch & Learn</p>
            <h2 className="mt-1 font-serif text-2xl sm:text-3xl font-bold text-luxe-black tracking-tight">
              Latest from Luxedge Media
            </h2>
          </div>
          <Link
            to="/media"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-luxe-gold-dark hover:text-luxe-black transition-colors"
          >
            Explore All Videos <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-9">
          {videos.map((v, i) => (
            <MediaCard key={v.id} video={v} priority={i === 0} />
          ))}
        </div>
        <div className="mt-8 text-center sm:hidden">
          <Link to="/media" className="inline-flex items-center gap-1.5 text-sm font-bold text-luxe-gold-dark hover:text-luxe-black transition-colors">
            Explore All Videos <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
