'use client';

import { useEffect, useState, type CSSProperties, type FocusEvent } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Pill } from 'lucide-react';

export type CategoryCarouselItem = {
  id: string;
  href: string;
  name: string;
  imageUrl?: string;
  countLabel: string;
};

type CategoryCarouselProps = {
  items: CategoryCarouselItem[];
  prevLabel: string;
  nextLabel: string;
  sectionLabel: string;
};

function getVisibleCount(width: number): number {
  if (width >= 1100) return 5;
  if (width >= 860) return 4;
  if (width >= 600) return 3;
  if (width >= 420) return 2;
  return 1;
}

export function CategoryCarousel({ items, prevLabel, nextLabel, sectionLabel }: CategoryCarouselProps) {
  const [visibleCount, setVisibleCount] = useState(5);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const maxIndex = Math.max(0, items.length - visibleCount);
  const activeIndex = Math.min(index, maxIndex);
  const canSlide = items.length > visibleCount;

  useEffect(() => {
    const syncViewport = () => {
      const nextVisible = getVisibleCount(window.innerWidth);
      setVisibleCount(nextVisible);
      setIndex((current) => Math.min(current, Math.max(0, items.length - nextVisible)));
    };

    const rafId = window.requestAnimationFrame(syncViewport);
    window.addEventListener('resize', syncViewport);

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(mediaQuery.matches);
    const motionRafId = window.requestAnimationFrame(syncMotion);
    mediaQuery.addEventListener('change', syncMotion);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.cancelAnimationFrame(motionRafId);
      window.removeEventListener('resize', syncViewport);
      mediaQuery.removeEventListener('change', syncMotion);
    };
  }, [items.length]);

  useEffect(() => {
    if (!canSlide || paused || reducedMotion) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current >= maxIndex ? 0 : current + 1));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [canSlide, paused, reducedMotion, maxIndex]);

  const handlePrev = () => {
    setIndex((current) => {
      const clamped = Math.min(current, maxIndex);
      return clamped <= 0 ? maxIndex : clamped - 1;
    });
  };

  const handleNext = () => {
    setIndex((current) => {
      const clamped = Math.min(current, maxIndex);
      return clamped >= maxIndex ? 0 : clamped + 1;
    });
  };

  const handleBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setPaused(false);
    }
  };

  return (
    <div
      className={`category-carousel${canSlide ? ' is-scrollable' : ' is-compact'}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={handleBlurCapture}
      role="region"
      aria-roledescription="carousel"
      aria-label={sectionLabel}
    >
      {canSlide ? (
        <button
          type="button"
          className="category-carousel-arrow prev"
          aria-label={prevLabel}
          onClick={handlePrev}
        >
          <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}

      <div className="category-carousel-viewport">
        <div
          className="category-track"
          style={{ '--cat-index': activeIndex } as CSSProperties}
        >
          {items.map((item) => (
            <article className="category-card" key={item.id}>
              <Link href={item.href} className="category-card-link">
                {item.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    width={320}
                    height={320}
                    className="category-photo"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="category-fallback" aria-hidden="true">
                    <Pill size={42} strokeWidth={1.3} />
                  </div>
                )}
                <div className="category-card-overlay" aria-hidden="true" />
                <div className="category-card-content">
                  <h3>{item.name}</h3>
                  <p className="category-count">
                    <span className="category-count-dot" aria-hidden="true">•</span>
                    <span>{item.countLabel}</span>
                  </p>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </div>

      {canSlide ? (
        <button
          type="button"
          className="category-carousel-arrow next"
          aria-label={nextLabel}
          onClick={handleNext}
        >
          <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
