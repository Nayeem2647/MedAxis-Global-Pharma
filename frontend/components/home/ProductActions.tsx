'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Mail, Plus } from 'lucide-react';
import { CartError, type CartIssue, type CatalogCartInput } from '../../lib/cart';
import { useCart } from '../layout/CartProvider';
import { QuoteButton } from '../layout/PublicShell';

export function ProductActions({ product }: { product: CatalogCartInput }) {
  const t = useTranslations('Cart');
  const { addItem, setDrawerOpen, hydrated } = useCart();
  const [added, setAdded] = useState(false);
  const [issue, setIssue] = useState<CartIssue | null>(null);
  return <><div className="product-actions"><QuoteButton className="button primary product-quote-button" product={product}><Mail size={17} aria-hidden="true"/><span>{t('quickQuote')}</span></QuoteButton><button type="button" className="add-product" title={added ? t('added') : t('addToList')} aria-label={t('addNamed', { name: product.name })} disabled={!hydrated} onClick={() => {
    try { addItem(product); setAdded(true); setIssue(null); setDrawerOpen(true); } catch (error: unknown) { setIssue(error instanceof CartError ? error.issue : 'invalidItem'); }
  }}>{added ? <Check size={18}/> : <Plus size={18}/>}</button></div>{added && <span className="sr-only" role="status">{t('added')}</span>}{issue && <p role="alert" className="form-error">{t(issue)}</p>}</>;
}
