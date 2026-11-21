'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import type { Banner } from '../../lib/public-catalog';
import { publicLocalePath } from '../../lib/seo';

interface PlacementBannerProps {
  banners: Banner[];
  locale: Locale;
  variant: 'hero' | 'products' | 'blog';
  preview?: boolean;
  children?: ReactNode;
}

const ASPECT_DIMENSIONS = {
  hero: { width: 1440, height: 480 },
  products: { width: 1400, height: 350 },
  blog: { width: 1200, height: 400 },
};

export function PlacementBanner({ banners, locale, variant, preview = false, children }: PlacementBannerProps) {
  const [active, setActive] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [playback, setPlayback] = useState<'auto' | 'playing' | 'paused'>('auto');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const count = banners.length;
  const safeIndex = count ? active % count : 0;
  const slide = banners[safeIndex];
  const stopped = playback === 'paused' || (reducedMotion && playback !== 'playing');
  const paused = preview || pageHidden || stopped || (playback !== 'playing' && inputFocused);
  const chinese = locale === 'zh-CN';

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (count <= 1 || paused) return;
    const timer = setInterval(() => setActive((current) => (current + 1) % count), 4500);
    return () => clearInterval(timer);
  }, [count, paused, safeIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused || (playback === 'auto' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) video.pause();
    else void video.play().catch(() => {});
  }, [paused, playback, slide?.id, slide?.media_url]);

  if (!slide) return null;
  const target = !preview && slide.link_path ? publicLocalePath(slide.link_path, locale) : null;
  const dims = ASPECT_DIMENSIONS[variant];
  const hasMedia = Boolean(slide.media_url);
  const showOverlay = !children && (!hasMedia || Boolean(slide.show_overlay));
  const hasControls = !preview && (count > 1 || slide.media_type === 'VIDEO');
  const content = (
    <>
      {hasMedia && (slide.media_type === 'VIDEO' ? (
        <video
          ref={videoRef} key={slide.id} src={slide.media_url}
          className="placement-banner-media"
          muted loop playsInline preload="metadata"
          aria-label={slide.title || (chinese ? '精选视频' : 'Featured video')}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={slide.id} src={slide.media_url}
          alt={showOverlay ? '' : slide.title}
          width={dims.width} height={dims.height}
          className="placement-banner-media"
          loading="eager" decoding="async"
          fetchPriority={variant === 'hero' ? 'high' : 'auto'}
        />
      ))}
      {showOverlay && (
        <div className={`placement-banner-overlay${hasMedia ? ' has-backdrop' : ''}`}>
          <div className="placement-banner-copy">
            <span className="placement-banner-eyebrow">MEDAXIS GLOBAL PHARMA</span>
            {slide.title && <h2>{slide.title}</h2>}
            {slide.body && <p>{slide.body}</p>}
            {(target || (preview && slide.link_path)) && (
              <span className="placement-banner-cta">{chinese ? '了解更多' : 'Explore more'}<ArrowUpRight size={16} aria-hidden="true" /></span>
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
    <section
      className={`placement-banner placement-banner-${variant}${hasMedia ? ' has-media' : ''}${showOverlay ? ' has-overlay' : ''}${hasControls ? ' has-controls' : ''}${children ? ' has-persistent-overlay' : ''}${stopped ? ' is-stopped' : ''}${preview ? ' is-preview' : ''}`}
      aria-roledescription={chinese ? '轮播' : 'carousel'}
      aria-label={chinese ? '精选内容' : 'Featured highlights'}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
          setInputFocused(true);
        }
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof HTMLElement && event.currentTarget.contains(nextTarget) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(nextTarget.tagName))) {
          setInputFocused(false);
        }
      }}
    >
      <div className="placement-banner-slide" role="group" aria-roledescription={chinese ? '幻灯片' : 'slide'} aria-label={`${safeIndex + 1} / ${count}`} aria-live={paused ? 'polite' : 'off'}>
        {target ? (
          <Link key={slide.id} href={target} className="placement-banner-frame" aria-label={slide.title || (chinese ? '查看精选内容' : 'View featured content')}>{content}</Link>
        ) : (
          <div key={slide.id} className="placement-banner-frame">{content}</div>
        )}
      </div>
      {children && <div className="hero-persistent-overlay">{children}</div>}
      {hasControls && (
        <div className="placement-banner-controls">
          {count > 1 && <button type="button" className="placement-banner-control" aria-label={chinese ? '上一张横幅' : 'Previous banner'} onClick={() => setActive((safeIndex - 1 + count) % count)}><ChevronLeft size={18} aria-hidden="true" /></button>}
          <span className="placement-banner-counter" aria-hidden="true">{String(safeIndex + 1).padStart(2, '0')} <span>/ {String(count).padStart(2, '0')}</span></span>
          {count > 1 && <button type="button" className="placement-banner-control" aria-label={chinese ? '下一张横幅' : 'Next banner'} onClick={() => setActive((safeIndex + 1) % count)}><ChevronRight size={18} aria-hidden="true" /></button>}
          <button type="button" className="placement-banner-control placement-banner-pause" aria-label={stopped ? (chinese ? '播放横幅动画' : 'Play banner animation') : (chinese ? '暂停横幅动画' : 'Pause banner animation')} aria-pressed={stopped} onClick={() => setPlayback(stopped ? 'playing' : 'paused')}>
            {stopped ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
          </button>
        </div>
      )}
    </section>
  );
}
