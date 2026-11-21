'use client';

import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { Banner } from '../../lib/public-catalog';
import type { Locale } from '../../i18n/routing';
import { publicLocalePath } from '../../lib/seo';

interface AnnouncementLabels {
  title: string;
  dismiss: string;
  previous: string;
  next: string;
  read: string;
  liveBadge?: string;
}

function ChevronsMark() {
  return (
    <span className="announcement-chevrons" aria-hidden="true">
      <svg width="20" height="12" viewBox="0 0 20 12" fill="none">
        <path d="M1.5 1.5L5.5 6L1.5 10.5M7.5 1.5L11.5 6L7.5 10.5M13.5 1.5L17.5 6L13.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function splitAnnouncementBody(body: string): string[] {
  return body
    .split(/\s*[•·|]\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function AnnouncementItemCopy({ title, body, hasLink }: { title: string; body: string; hasLink: boolean }) {
  const segments = body ? splitAnnouncementBody(body) : [];
  return (
    <>
      <span className="announcement-copy">
        <strong>{title}</strong>
        {segments.map((segment, idx) => (
          <Fragment key={`${idx}-${segment}`}>
            <span className="announcement-dot" aria-hidden="true" />
            <span>{segment}</span>
          </Fragment>
        ))}
      </span>
      {hasLink && <ArrowUpRight size={14} className="announcement-link-icon" aria-hidden="true" />}
    </>
  );
}

export function AnnouncementStrip({ banners, locale, labels, onDismiss, preview = false }: {
  banners: Banner[];
  locale: Locale;
  labels: AnnouncementLabels;
  onDismiss?: (id: string) => void;
  preview?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLUListElement>(null);
  const [scroll, setScroll] = useState({ overflow: false, previous: false, next: false });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [marquee, setMarquee] = useState({ repeatCount: 1, duration: 24 });

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(media.matches);
    const rafId = window.requestAnimationFrame(syncMotion);
    media.addEventListener('change', syncMotion);
    return () => {
      window.cancelAnimationFrame(rafId);
      media.removeEventListener('change', syncMotion);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const items = itemsRef.current;
    if (!viewport || !items) return;

    const update = () => {
      const viewportWidth = viewport.clientWidth;
      const itemsWidth = items.scrollWidth;
      const remaining = viewport.scrollWidth - viewportWidth - viewport.scrollLeft;
      const nextScroll = {
        overflow: viewport.scrollWidth > viewportWidth + 2,
        previous: viewport.scrollLeft > 2,
        next: remaining > 2,
      };
      setScroll((current) => (
        current.overflow === nextScroll.overflow
        && current.previous === nextScroll.previous
        && current.next === nextScroll.next
          ? current
          : nextScroll
      ));

      if (itemsWidth > 0 && viewportWidth > 0) {
        const nextRepeat = Math.max(1, Math.min(6, Math.ceil((viewportWidth + 32) / itemsWidth)));
        const halfWidth = itemsWidth * nextRepeat;
        const nextDuration = Math.max(14, Math.min(48, Math.round((halfWidth / 55) * 10) / 10));
        setMarquee((current) => (
          current.repeatCount === nextRepeat && Math.abs(current.duration - nextDuration) < 0.5
            ? current
            : { repeatCount: nextRepeat, duration: nextDuration }
        ));
      }
    };

    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(items);
    viewport.addEventListener('scroll', update, { passive: true });
    const rafId = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
      viewport.removeEventListener('scroll', update);
    };
  }, [banners, reducedMotion]);

  function move(direction: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      left: direction * viewport.clientWidth * 0.8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  if (!banners.length) return null;

  const liveBadgeText = labels.liveBadge ?? 'LIVE UPDATE';
  const showManualControls = reducedMotion && scroll.overflow;
  const cloneIndices = Array.from({ length: marquee.repeatCount }, (_, i) => i);
  const trailingClones = cloneIndices.slice(1);
  const firstBanner = banners[0];

  const renderBannerNodes = (prefix: string, interactive: boolean) => banners.map((banner) => {
    const path = !preview && banner.link_path
      ? publicLocalePath(banner.link_path, locale) ?? publicLocalePath(banner.link_path, locale === 'en' ? 'zh-CN' : 'en')
      : null;
    const hasLink = Boolean(path || (preview && banner.link_path));
    const inner = <AnnouncementItemCopy title={banner.title} body={banner.body} hasLink={hasLink} />;

    if (interactive) {
      return (
        <li className="announcement-pill" key={`${prefix}-${banner.id}`}>
          {path ? (
            <Link
              href={path}
              className="announcement-pill-content"
              aria-label={`${banner.title}. ${banner.body} ${labels.read}`}
              title={banner.body}
            >
              {inner}
            </Link>
          ) : (
            <div className="announcement-pill-content" title={banner.body}>
              {inner}
            </div>
          )}
          <span className="announcement-dot announcement-item-sep" aria-hidden="true" />
        </li>
      );
    }

    return (
      <div className="announcement-pill-clone" key={`${prefix}-${banner.id}`}>
        <div className="announcement-pill-content">
          {inner}
        </div>
        <span className="announcement-dot announcement-item-sep" aria-hidden="true" />
      </div>
    );
  });

  return (
    <aside className={`announcement-bar${preview ? ' is-preview' : ''}`} aria-label={labels.title}>
      <div className="site-container announcement-shell">
        <div className={`announcement-inner${showManualControls ? ' has-controls' : ''}${onDismiss ? ' has-dismiss' : ''}`}>
          <div className="announcement-live-badge" aria-hidden="true">
            <span className="announcement-live-dot" />
            <span>{liveBadgeText}</span>
          </div>
          <span className="announcement-divider announcement-divider-start" aria-hidden="true" />
          <ChevronsMark />

          <div
            className="announcement-viewport"
            ref={viewportRef}
            tabIndex={showManualControls ? 0 : undefined}
            aria-label={showManualControls ? labels.title : undefined}
          >
            <div
              className="announcement-marquee-track"
              style={{ '--announcement-duration': `${marquee.duration}s` } as CSSProperties}
            >
              <div className="announcement-marquee-half">
                <ul className="announcement-items" ref={itemsRef}>
                  {renderBannerNodes('primary', true)}
                </ul>
                {trailingClones.map((copyIndex) => (
                  <div className="announcement-items-clone" aria-hidden="true" key={`lead-clone-${copyIndex}`}>
                    {renderBannerNodes(`lead-${copyIndex}`, false)}
                  </div>
                ))}
              </div>
              <div className="announcement-marquee-half" aria-hidden="true">
                {cloneIndices.map((copyIndex) => (
                  <div className="announcement-items-clone" key={`half-clone-${copyIndex}`}>
                    {renderBannerNodes(`half-${copyIndex}`, false)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <ChevronsMark />

          {showManualControls && (
            <div className="announcement-controls">
              <button type="button" aria-label={labels.previous} disabled={!scroll.previous} onClick={() => move(-1)}>
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button type="button" aria-label={labels.next} disabled={!scroll.next} onClick={() => move(1)}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          {onDismiss && (
            <>
              <span className="announcement-divider announcement-divider-end" aria-hidden="true" />
              <button
                type="button"
                className="announcement-dismiss"
                aria-label={`${labels.dismiss}: ${firstBanner.title}`}
                onClick={() => onDismiss(firstBanner.id)}
              >
                <X size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

export function Announcements({ banners }: { banners: Banner[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const t = useTranslations('Home');
  const locale = useLocale();
  const visible = banners.filter(
    (banner) => (!banner.placement || banner.placement === 'ANNOUNCEMENT') && !dismissed.includes(banner.id),
  );
  return (
    <AnnouncementStrip
      banners={visible}
      locale={locale}
      labels={{
        title: t('announcements'),
        dismiss: t('dismissAnnouncement'),
        previous: t('previousAnnouncements'),
        next: t('nextAnnouncements'),
        read: t('learnMore'),
        liveBadge: t('liveUpdate'),
      }}
      onDismiss={(id) => setDismissed((current) => [...current, id])}
    />
  );
}
