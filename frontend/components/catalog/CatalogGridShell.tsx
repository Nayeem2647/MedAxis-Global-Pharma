'use client';

import { useState, type ReactNode } from 'react';
import { LayoutGrid, List } from 'lucide-react';

interface CatalogGridShellProps {
  resultsLabel: string;
  viewLabel: string;
  gridLabel: string;
  listLabel: string;
  children: ReactNode;
}

export function CatalogGridShell({ resultsLabel, viewLabel, gridLabel, listLabel, children }: CatalogGridShellProps) {
  const [view, setView] = useState<'grid' | 'list'>('grid');

  return <>
    <div className="catalog-toolbar">
      <p className="results-count" role="status">{resultsLabel}</p>
      <div className="view-toggle" role="group" aria-label={viewLabel}>
        <button
          type="button"
          className={`view-toggle-btn${view === 'grid' ? ' is-active' : ''}`}
          aria-pressed={view === 'grid'}
          onClick={() => setView('grid')}
        >
          <LayoutGrid size={16} aria-hidden="true"/>
          <span>{gridLabel}</span>
        </button>
        <button
          type="button"
          className={`view-toggle-btn${view === 'list' ? ' is-active' : ''}`}
          aria-pressed={view === 'list'}
          onClick={() => setView('list')}
        >
          <List size={16} aria-hidden="true"/>
          <span>{listLabel}</span>
        </button>
      </div>
    </div>
    <div className={view === 'list' ? 'product-grid is-list' : 'product-grid'}>
      {children}
    </div>
  </>;
}
