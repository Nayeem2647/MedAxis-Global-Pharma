'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Pill } from 'lucide-react';

export function CatalogImage({ src, alt, width, height, sizes, priority = false, fallbackLabel }: { src: string; alt: string; width: number; height: number; sizes: string; priority?: boolean; fallbackLabel: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="catalog-image-fallback" role="img" aria-label={alt}><Pill size={50} aria-hidden="true"/><span>{fallbackLabel}</span></span>
    : <Image src={src} alt={alt} width={width} height={height} sizes={sizes} priority={priority} onError={() => setFailed(true)}/>;
}
