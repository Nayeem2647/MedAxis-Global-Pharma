'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, ImageIcon, Pill, Play } from 'lucide-react';
import { CatalogImage } from './CatalogImage';

export function ProductGallery({ images, video, name, alt }: { images: string[]; video: string | null; name: string; alt: string }) {
  const t = useTranslations('Catalog');
  const [selected, setSelected] = useState(0);
  const count = images.length + (video ? 1 : 0);
  const isVideo = Boolean(video && selected === images.length);
  const move = (direction: number) => setSelected((current) => (current + direction + count) % count);

  return <div className="product-gallery">
    <div className={`gallery-main${isVideo ? ' gallery-video' : ''}`}>
      {isVideo ? <video key={video} controls playsInline preload="metadata" src={video!} aria-label={t('namedVideo', { name })} />
        : images[selected] ? <CatalogImage key={images[selected]} src={images[selected]} alt={alt} width={720} height={720} sizes="(max-width: 800px) 90vw, 42vw" priority={selected === 0} fallbackLabel={t('imageUnavailable')} />
          : <div className="gallery-fallback"><Pill size={76} strokeWidth={1}/><span>{t('imageUnavailable')}</span></div>}
      {!isVideo && images.length > 0 && <span className="gallery-image-label"><ImageIcon size={14}/>{t('productPhotos')}</span>}
    </div>
    {count > 0 && <div className="gallery-navigation">
      {count > 1 && <button type="button" className="gallery-arrow" onClick={() => move(-1)} aria-label={t('previousMedia')}><ChevronLeft size={19}/></button>}
      <div className="gallery-thumbnails" role="group" aria-label={t('productMedia')}>
        {images.map((src, index) => <button type="button" className={`gallery-thumbnail${selected === index ? ' is-selected' : ''}`} key={src} aria-label={t('showImage', { number: index + 1 })} aria-pressed={selected === index} onClick={() => setSelected(index)}>
          <CatalogImage src={src} alt="" width={88} height={88} sizes="72px" fallbackLabel={t('imageUnavailable')}/>
        </button>)}
        {video && <button type="button" className={`gallery-thumbnail gallery-video-thumbnail${isVideo ? ' is-selected' : ''}`} aria-pressed={isVideo} onClick={() => setSelected(images.length)}>
          <span className="gallery-play"><Play size={18} fill="currentColor"/></span><span>{t('productVideo')}</span>
        </button>}
      </div>
      {count > 1 && <button type="button" className="gallery-arrow" onClick={() => move(1)} aria-label={t('nextMedia')}><ChevronRight size={19}/></button>}
    </div>}
    {video && <p className="gallery-caption">{t('videoHint')}</p>}
  </div>;
}
