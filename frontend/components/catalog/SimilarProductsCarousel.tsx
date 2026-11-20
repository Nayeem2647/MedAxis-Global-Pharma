'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function SimilarProductsCarousel({ children, count }: { children: ReactNode; count: number }) {
  const t = useTranslations('Catalog');
  const track = useRef<HTMLDivElement>(null);
  const [navigation, setNavigation] = useState({ previous: false, next: false });
  const syncNavigation = () => {
    const element = track.current;
    if (element) setNavigation({ previous: element.scrollLeft > 2, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 });
  };
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    syncNavigation();
    const observer = new ResizeObserver(syncNavigation);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  function scroll(direction: number) {
    const element = track.current;
    if (!element) return;
    const card = element.firstElementChild?.getBoundingClientRect().width ?? element.clientWidth;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    element.scrollBy({ left: direction * (card + gap), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  return <>
    {(navigation.previous || navigation.next) && <div className="similar-products-controls">
      <button type="button" aria-label={t('previousSimilar')} disabled={!navigation.previous} onClick={() => scroll(-1)}><ChevronLeft size={21} aria-hidden="true"/></button>
      <button type="button" aria-label={t('nextSimilar')} disabled={!navigation.next} onClick={() => scroll(1)}><ChevronRight size={21} aria-hidden="true"/></button>
    </div>}
    <div ref={track} className="similar-products-track" role="list" aria-label={t('similarProducts')} onScroll={syncNavigation}>{children}</div>
  </>;
}
