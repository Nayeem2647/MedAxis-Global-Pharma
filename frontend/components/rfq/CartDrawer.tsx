'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import type { CartIssue, CartItem } from '../../lib/cart';
import { useCart } from '../layout/CartProvider';
import { Modal } from '../layout/Modal';

function CartRow({ item }: { item: CartItem }) {
  const t = useTranslations('Cart');
  const locale = useLocale();
  const { updateQuantity, removeItem } = useCart();
  const [issue, setIssue] = useState<CartIssue | null>(null);
  const name = item.kind === 'catalog' ? item.names?.[locale] ?? item.name : item.name;
  return <li className="cart-row"><div><strong>{name}</strong><p className="small muted">{item.strength} · {item.packagingUnit}</p></div>
    <div className="cart-row-actions"><label><span className="sr-only">{t('quantityFor', { name })}</span><input aria-label={t('quantityFor', { name })} type="number" min={1} step={1} max={Number.MAX_SAFE_INTEGER} value={item.quantity} onChange={(event) => {
      try { updateQuantity(item.id, event.currentTarget.valueAsNumber); setIssue(null); } catch { setIssue('quantityInvalid'); }
    }}/></label><button className="icon-button" aria-label={t('remove', { name })} onClick={() => removeItem(item.id)}><Trash2 size={18}/></button></div>
    {issue && <p role="alert" className="form-error">{t(issue)}</p>}
  </li>;
}

export function CartDrawer({ onCustom, onSubmit }: { onCustom(): void; onSubmit(): void }) {
  const t = useTranslations('Cart');
  const rfq = useTranslations('Rfq');
  const { items, drawerOpen, setDrawerOpen, clearCart } = useCart();
  if (!drawerOpen) return null;
  return <Modal title={t('title')} drawer onClose={() => setDrawerOpen(false)}>
    <p className="muted">{t('savedLocally')}</p>
    {items.length ? <ul className="cart-list">{items.map((item) => <CartRow key={item.id} item={item}/>)}</ul> : <div className="empty-state"><ShoppingBag size={36}/><h3>{t('empty')}</h3><p>{t('emptyHelp')}</p></div>}
    <div className="drawer-actions"><button className="button secondary" onClick={onCustom}><Plus size={17}/>{t('addCustom')}</button>
      {items.length > 0 && <><button className="text-button" onClick={clearCart}>{t('clear')}</button><button className="button primary" onClick={onSubmit}>{rfq('continue')}<ArrowRight size={17}/></button></>}
    </div><p className="small muted">{t('privateQuote')}</p>
  </Modal>;
}
