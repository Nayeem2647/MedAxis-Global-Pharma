'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp } from 'lucide-react';

export function ProductDetailsDisclosure({ preview, label, hasAdditionalDetails, children }: { preview: string; label: string; hasAdditionalDetails: boolean; children: ReactNode }) {
  const t = useTranslations('Catalog');
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(hasAdditionalDetails);
  const previewRef = useRef<HTMLParagraphElement>(null);
  const detailsId = useId();

  useEffect(() => {
    if (expanded || !previewRef.current) return;
    const element = previewRef.current;
    const measure = () => setCanExpand(hasAdditionalDetails || element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, preview, hasAdditionalDetails]);

  return <div className="product-details-disclosure">
    <div className="product-information-body" hidden={expanded}>
      <section className="product-description-preview"><h2>{label}</h2><p ref={previewRef}>{preview}</p></section>
    </div>
    <div id={detailsId} hidden={!expanded}>{children}</div>
    {canExpand && <div className="product-description-toggle"><button type="button" className="button secondary" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>
      {t(expanded ? 'seeLess' : 'seeMore')}{expanded ? <ChevronUp size={17} aria-hidden="true"/> : <ChevronDown size={17} aria-hidden="true"/>}
    </button></div>}
  </div>;
}
