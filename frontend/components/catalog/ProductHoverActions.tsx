'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Columns3, Eye, ListPlus } from 'lucide-react';
import type { HomeProduct } from '../../lib/public-catalog';
import { productCartInput } from '../../lib/product-tools';
import { CartError, type CartIssue } from '../../lib/cart';
import { useCart } from '../layout/CartProvider';
import { useProductTools } from './ProductToolsProvider';

export function ProductHoverActions({ product }: { product: HomeProduct }) {
  const t = useTranslations('ProductTools');
  const cartText = useTranslations('Cart');
  const cart = useCart();
  const tools = useProductTools();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<CartIssue | null>(null);
  const compared = tools.selected.some((item) => item.id === product.id);
  const added = cart.items.some((item) => item.kind === 'catalog' && item.productId === product.id);
  return <>
    <div className="product-hover-actions" role="group" aria-label={t('actionsNamed', { name: product.brand_name })}>
      <button type="button" disabled={!cart.hydrated} aria-label={t('addQuoteNamed', { name: product.brand_name })} title={t('addQuote')} onClick={() => {
        try { cart.addItem(productCartInput(product)); setMessage(t('quoteAdded')); setError(null); } catch (issue: unknown) { setError(issue instanceof CartError ? issue.issue : 'invalidItem'); }
      }}>{added ? <Check size={19}/> : <ListPlus size={19}/>}<span className="product-tool-tip" aria-hidden="true">{t('addQuote')}</span></button>
      <button type="button" disabled={!tools.ready} className={compared ? 'is-selected' : undefined} aria-pressed={compared} aria-label={t(compared ? 'removeCompareNamed' : 'addCompareNamed', { name: product.brand_name })} title={t(compared ? 'removeCompare' : 'addCompare')} onClick={() => tools.toggleCompare(product)}><Columns3 size={18}/><span className="product-tool-tip" aria-hidden="true">{t(compared ? 'removeCompare' : 'addCompare')}</span></button>
      <button type="button" aria-label={t('quickViewNamed', { name: product.brand_name })} title={t('quickView')} onClick={() => tools.showPreview(product)}><Eye size={19}/><span className="product-tool-tip" aria-hidden="true">{t('quickView')}</span></button>
    </div>
    {message && <span className="sr-only" role="status">{message}</span>}
    {error && <span className="product-tool-error" role="alert">{cartText(error)}</span>}
  </>;
}
