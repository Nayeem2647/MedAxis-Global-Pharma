'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Columns3, X } from 'lucide-react';
import type { HomeProduct } from '../../lib/public-catalog';
import { COMPARISON_STORAGE_KEY, personalRatingSchema, readComparison, toggleComparison, type ComparisonItem, type RatingSummary } from '../../lib/product-tools';
import { apiRequest } from '../../lib/api-client';
import { ProductQuickView } from './ProductQuickView';
import { ProductComparison } from './ProductComparison';
import { ProductRatingDialog } from './ProductRating';

interface ProductTools {
  selected: readonly ComparisonItem[];
  ready: boolean;
  toggleCompare(product: HomeProduct): void;
  showPreview(product: HomeProduct): void;
  showRating(product: HomeProduct): void;
  showComparison(): void;
  ratings: Record<string, RatingSummary>;
  refreshRating(id: string): Promise<void>;
}
const Context = createContext<ProductTools | null>(null);
export function useProductTools() {
  const value = useContext(Context);
  if (!value) throw new Error('Product tools require ProductToolsProvider.');
  return value;
}

export function ProductToolsProvider({ children, showTray = true }: { children: ReactNode; showTray?: boolean }) {
  const t = useTranslations('ProductTools');
  const [selected, setSelected] = useState<ComparisonItem[]>([]);
  const current = useRef<ComparisonItem[]>([]);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<HomeProduct | null>(null);
  const [ratingProduct, setRatingProduct] = useState<HomeProduct | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({});
  const requestedRatings = useRef(new Set<string>());
  const ratingRevisions = useRef(new Map<string, number>());
  const refreshRating = useCallback(async (id: string) => {
    if (requestedRatings.current.has(id)) return;
    requestedRatings.current.add(id);
    const revision = ratingRevisions.current.get(id) ?? 0;
    try {
      const { data } = await apiRequest(`/v1/public/products/${id}/ratings`, personalRatingSchema, { ratingSession: true, timeoutMs: 6000 });
      if ((ratingRevisions.current.get(id) ?? 0) === revision) setRatings((currentRatings) => ({ ...currentRatings, [id]: { average: data.average, count: data.count } }));
    } catch { requestedRatings.current.delete(id); }
  }, []);
  const commit = useCallback((products: ComparisonItem[]) => { current.current = products; setSelected(products); }, []);
  useEffect(() => {
    try { commit(readComparison(localStorage.getItem(COMPARISON_STORAGE_KEY))); } catch { /* Keep comparison available in memory. */ }
    setReady(true);
    const sync = (event: StorageEvent) => { if (event.key === COMPARISON_STORAGE_KEY || event.key === null) commit(readComparison(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [commit]);
  useEffect(() => {
    if (ready) try { localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify({ version: 1, products: selected })); } catch { /* Private storage may be blocked. */ }
  }, [ready, selected]);
  function toggleCompare(product: HomeProduct) {
    try {
      commit(toggleComparison(current.current, { id: product.id, name: product.brand_name, alternate_slugs: product.alternate_slugs }));
      setFeedback('');
    } catch { setFeedback(t('comparisonLimit')); }
  }
  function remove(id: string) { commit(current.current.filter((product) => product.id !== id)); setFeedback(''); }
  return <Context.Provider value={{ selected, ready, toggleCompare, showPreview: setPreview, showRating: setRatingProduct, showComparison: () => setComparisonOpen(true), ratings, refreshRating }}>
    {children}
    {showTray && selected.length > 0 && <aside className="comparison-tray" aria-label={t('comparisonTitle')}>
      <div className="comparison-selection"><Columns3 size={20} aria-hidden="true"/><span>{t('selectedCount', { count: selected.length })}</span>
        <div className="comparison-chips">{selected.map((product) => <span className="comparison-chip" key={product.id}><span title={product.name}>{product.name}</span><button type="button" aria-label={t('removeNamed', { name: product.name })} onClick={() => remove(product.id)}><X size={14}/></button></span>)}</div>
      </div>
      <button type="button" className="button primary" disabled={selected.length < 2} onClick={() => setComparisonOpen(true)}>{t('compareCount', { count: selected.length })}</button>
      {selected.length < 2 && <p className="comparison-hint">{t('chooseAnother')}</p>}
      {feedback && <p className="comparison-hint" role="status">{feedback}</p>}
    </aside>}
    {preview && <ProductQuickView product={preview} onClose={() => setPreview(null)}/>}
    {comparisonOpen && <ProductComparison selected={selected} onRemove={remove} onClose={() => setComparisonOpen(false)}/>}
    {ratingProduct && <ProductRatingDialog product={ratingProduct} onClose={() => setRatingProduct(null)} onSaved={(summary) => {
      ratingRevisions.current.set(ratingProduct.id, (ratingRevisions.current.get(ratingProduct.id) ?? 0) + 1);
      setRatings((currentRatings) => ({ ...currentRatings, [ratingProduct.id]: summary }));
    }}/>}
  </Context.Provider>;
}
