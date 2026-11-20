'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import type { Banner } from '../../lib/public-catalog';
import { publicLocalePath } from '../../lib/seo';

interface PlacementBannerProps {
  banners: Banner[];
  locale: Locale;
  variant: 'hero' | 'products' | 'blog';
  children?: ReactNode;
}

const ASPECT_DIMENSIONS: Record<PlacementBannerProps['variant'], { width: number; height: number }> = {
  hero: { width: 1440, height: 480 },
  products: { width: 1400, height: 350 },
  blog: { width: 1200, height: 400 },
};

export function PlacementBanner({ banners, locale, variant, children }: PlacementBannerProps) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = banners.length;
  const safeIndex = count ? active % count : 0;

  useEffect(() => {
    if (count <= 1 || paused) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      setActive((current) => (current + 1) % count);
    }, 6000);
    return () => clearInterval(timer);
  }, [count, paused]);

  if (!count) return null;

  const slide = banners[safeIndex]!;
  const target = slide.link_path ? publicLocalePath(slide.link_path, locale) : null;
  const dims = ASPECT_DIMENSIONS[variant];
  const hasMedia = Boolean(slide.media_url);
  const showOverlay = !hasMedia || Boolean(slide.show_overlay);

  const mediaNode = hasMedia ? (
    slide.media_type === 'VIDEO' ? (
      <video
        key={slide.id}
        src={slide.media_url}
        className="placement-banner-media"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={slide.title || 'Promotional animation banner'}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={slide.id}
        src={slide.media_url}
        alt={slide.title || 'Promotional banner'}
        width={dims.width}
        height={dims.height}
        className="placement-banner-media"
        loading="eager"
        decoding="async"
      />
    )
  ) : null;

  const overlayContent = showOverlay ? (
    children ? (
      <div className="placement-banner-overlay-custom">{children}</div>
    ) : (
      <div className={`placement-banner-overlay${hasMedia ? ' has-backdrop' : ''}`}>
        <div className="placement-banner-copy">
          {slide.title && <h2>{slide.title}</h2>}
          {slide.body && <p>{slide.body}</p>}
        </div>
      </div>
    )
  ) : null;

  return (
    <div
      className={`placement-banner placement-banner-${variant}${hasMedia ? ' has-media' : ''}${showOverlay ? ' has-overlay' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {target && !children ? (
        <Link href={target} className="placement-banner-frame" aria-label={slide.title || 'View featured offer'}>
          {mediaNode}
          {overlayContent}
        </Link>
      ) : (
        <div className="placement-banner-frame">
          {target ? (
            <Link href={target} className="placement-banner-media-link" aria-label={slide.title || 'Open banner link'}>
              {mediaNode}
            </Link>
          ) : (
            mediaNode
          )}
          {overlayContent}
        </div>
      )}

      {count > 1 && (
        <>
          <button
            type="button"
            className="placement-banner-arrow is-prev"
            aria-label="Previous banner"
            onClick={() => setActive((current) => (current - 1 + count) % count)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="placement-banner-arrow is-next"
            aria-label="Next banner"
            onClick={() => setActive((current) => (current + 1) % count)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <div className="placement-banner-dots" role="tablist" aria-label="Banner slides">
            {banners.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={idx === safeIndex}
                aria-label={`Banner slide ${idx + 1}`}
                className={`placement-banner-dot${idx === safeIndex ? ' is-active' : ''}`}
                onClick={() => setActive(idx)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
