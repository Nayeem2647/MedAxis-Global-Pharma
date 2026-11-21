'use client';

import { useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown, Globe2, Search, ShieldCheck } from 'lucide-react';

export interface HeroPanelCopy {
  kicker: string;
  title: string;
  description: string;
  note: string;
  request: string;
  browse: string;
  manufacturer: string;
  coordination: string;
  allCategories: string;
  searchPlaceholder: string;
}

export function HeroPanel({ copy, search, actions, preview = false }: {
  copy: HeroPanelCopy;
  search?: ReactNode;
  actions?: ReactNode;
  preview?: boolean;
}) {
  const [interacted, setInteracted] = useState(false);
  return (
    <div
      className={`hero-overlay-panel${preview ? ' is-preview' : ''}`}
      data-revealed={interacted ? 'true' : undefined}
      onFocusCapture={() => setInteracted(true)}
      onPointerDownCapture={() => setInteracted(true)}
    >
      {!preview && <h1 className="sr-only">{copy.title}</h1>}
      {preview ? (
        <div className="hero-search hero-search-preview" aria-hidden="true">
          <span className="hero-preview-category">{copy.allCategories}<ChevronDown size={14} /></span>
          <span className="hero-preview-query">{copy.searchPlaceholder}</span>
          <span className="hero-search-preview-btn"><Search size={18} /></span>
        </div>
      ) : search}
      <div className="hero-actions">
        {preview ? (
          <>
            <span className="button primary">{copy.request}<ArrowUpRight size={17} aria-hidden="true" /></span>
            <span className="button secondary">{copy.browse}<ArrowRight size={17} aria-hidden="true" /></span>
          </>
        ) : actions}
      </div>
      <div className="hero-assurance">
        <span>
          <ShieldCheck size={18} aria-hidden="true" />
          <span className="hero-assurance-divider" aria-hidden="true" />
          <span>{copy.manufacturer}</span>
        </span>
        <span>
          <Globe2 size={18} aria-hidden="true" />
          <span className="hero-assurance-divider" aria-hidden="true" />
          <span>{copy.coordination}</span>
        </span>
      </div>
    </div>
  );
}
