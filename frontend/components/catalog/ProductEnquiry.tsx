'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Mail, MessageCircle, Plus } from 'lucide-react';
import { CartError, type CartIssue, type CatalogCartInput } from '../../lib/cart';
import type { ContactConfig } from '../../lib/public-config';
import { useCart } from '../layout/CartProvider';
import { QuoteButton, usePublicShell } from '../layout/PublicShell';

export function ProductEnquiry({ product, contact }: { product: CatalogCartInput; contact: ContactConfig }) {
  const t = useTranslations('Catalog');
  const cart = useTranslations('Cart');
  const channels = useTranslations('Contact');
  const { addItem, hydrated } = useCart();
  const { openContact } = usePublicShell();
  const [added, setAdded] = useState(false);
  const [issue, setIssue] = useState<CartIssue | null>(null);
  const enquiry = t('whatsappMessage', { name: product.name, strength: product.strength ?? '' });

  return <div className="product-enquiry">
    <div className="product-enquiry-actions">
      {contact.whatsapp && <a className="button product-whatsapp" href={`${contact.whatsapp}?text=${encodeURIComponent(enquiry)}`} target="_blank" rel="noopener noreferrer nofollow"><MessageCircle size={19}/>{t('orderWhatsapp')}</a>}
      <QuoteButton className="button product-price-inquiry" product={product}><Mail size={19}/>{t('priceInquiry')}</QuoteButton>
    </div>
    <button type="button" className="product-save-enquiry" aria-label={cart('addNamed', { name: product.name })} disabled={!hydrated} onClick={() => {
      try { addItem(product); setAdded(true); setIssue(null); } catch (error: unknown) { setIssue(error instanceof CartError ? error.issue : 'invalidItem'); }
    }}>{added ? <Check size={17}/> : <Plus size={17}/>}<span>{added ? cart('added') : cart('addToList')}</span></button>
    {added && <span className="sr-only" role="status">{cart('added')}</span>}
    {issue && <p role="alert" className="form-error">{cart(issue)}</p>}
    <p className="product-availability-note">{t('privateAvailability')}</p>
    {contact.wechatQr && <div className="product-direct-contact">
      <a className="product-wechat-qr" href={contact.wechatQr} target="_blank" rel="noopener noreferrer nofollow" aria-label={channels('openQr')}><Image src={contact.wechatQr} alt={channels('qrAlt')} width={88} height={88} unoptimized/></a>
      <div><span className="product-contact-label">{t('preferWechat')}</span><p>{t('scanForEnquiry')}</p><button type="button" className="product-contact-link" onClick={openContact}>{t('contactOptions')}</button></div>
    </div>}
  </div>;
}
