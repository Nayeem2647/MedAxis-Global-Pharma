'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import type { CartIssue, CartItem } from '../../lib/cart';
import { useCart } from '../layout/CartProvider';
import { Modal } from '../layout/Modal';

function CartRow({ item }: { item: CartItem }) {
  const t = useTranslations('Cart');
  const locale = useLocale();
  const { updateQuantity, removeItem } = useCart();
  const [issue, setIssue] = useState<CartIssue | null>(null);
  const name = item.kind === 'catalog' ? item.names?.[locale] ?? item.name : item.name;

  function applyQuantity(next: number) {
    try {
      updateQuantity(item.id, next);
      setIssue(null);
    } catch {
      setIssue('quantityInvalid');
    }
  }

  return (
    <li className="cart-row">
      <div className="cart-row-head">
        <div className="cart-row-info">
          <strong>{name}</strong>
          <p className="small muted">{[item.strength, item.packagingUnit].filter(Boolean).join(' · ')}</p>
        </div>
        <button
          type="button"
          className="icon-button cart-remove-btn"
          aria-label={t('remove', { name })}
          onClick={() => removeItem(item.id)}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="cart-row-controls">
        <div className="cart-qty-stepper">
          <button
            type="button"
            className="cart-qty-btn"
            aria-label={t('decreaseQuantity', { name })}
            disabled={item.quantity <= 1}
            onClick={() => applyQuantity(Math.max(1, item.quantity - 1))}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <label className="cart-qty-input-wrap">
            <span className="sr-only">{t('quantityFor', { name })}</span>
            <input
              aria-label={t('quantityFor', { name })}
              type="number"
              min={1}
              step={1}
              max={Number.MAX_SAFE_INTEGER}
              value={item.quantity}
              onChange={(event) => applyQuantity(event.currentTarget.valueAsNumber)}
            />
          </label>
          <button
            type="button"
            className="cart-qty-btn"
            aria-label={t('increaseQuantity', { name })}
            onClick={() => applyQuantity(item.quantity + 1)}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        <span className="cart-unit-pill">{item.packagingUnit}</span>
      </div>
      {issue && <p role="alert" className="form-error">{t(issue)}</p>}
    </li>
  );
}

export function CartDrawer({ onCustom, onSubmit }: { onCustom(): void; onSubmit(): void }) {
  const t = useTranslations('Cart');
  const rfq = useTranslations('Rfq');
  const { items, drawerOpen, setDrawerOpen, clearCart } = useCart();
  if (!drawerOpen) return null;
  return (
    <Modal title={t('title')} drawer onClose={() => setDrawerOpen(false)}>
      <div className="drawer-meta-bar">
        <span className="muted">{t('savedLocally')}</span>
        {items.length > 0 && (
          <span className="drawer-count-pill">{t('itemCountBadge', { count: items.length })}</span>
        )}
      </div>
      <div className="drawer-body">
        {items.length ? (
          <ul className="cart-list">
            {items.map((item) => <CartRow key={item.id} item={item} />)}
          </ul>
        ) : (
          <div className="empty-state">
            <ShoppingBag size={32} aria-hidden="true" />
            <h3>{t('empty')}</h3>
            <p>{t('emptyHelp')}</p>
          </div>
        )}
      </div>
      <div className="drawer-footer">
        {items.length > 0 && (
          <button type="button" className="button primary drawer-submit-btn" onClick={onSubmit}>
            {rfq('continue')}<ArrowRight size={17} aria-hidden="true" />
          </button>
        )}
        <div className="drawer-secondary-row">
          <button type="button" className="button secondary drawer-custom-btn" onClick={onCustom}>
            <Plus size={16} aria-hidden="true" />{t('addCustom')}
          </button>
          {items.length > 0 && (
            <button type="button" className="text-button drawer-clear-btn" onClick={clearCart}>
              {t('clear')}
            </button>
          )}
        </div>
        <p className="drawer-privacy-note small muted">{t('privateQuote')}</p>
      </div>
    </Modal>
  );
}
