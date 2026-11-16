'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Menu, MessageCircle, Plus, ShoppingBag, X } from 'lucide-react';
import { LocaleSwitcher } from './LocaleSwitcher';

interface HeaderProps {
  itemCount: number;
  hydrated: boolean;
  onCart(): void;
  onContact(): void;
  onQuickQuote(): void;
}

export function Header({ itemCount, hydrated, onCart, onContact, onQuickQuote }: HeaderProps) {
  const locale = useLocale();
  const t = useTranslations('Shell');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigation = [['products', 'products'], ['manufacturers', 'manufacturers'], ['generics', 'generics'], ['services', 'services']] as const;

  return <>
    <a className="skip-link" href="#main-content">{t('skip')}</a>
    <div className="trust-bar"><div className="site-container">
      <span>{t('directSourcing')}</span>
      <button onClick={onContact}><MessageCircle size={15}/>{locale === 'zh-CN' ? 'WeChat · Email' : 'WhatsApp · WeChat'}</button>
    </div></div>
    <header className="site-header">
      <div className="site-container header-main">
        <Link href={`/${locale}`} className="brand" aria-label="MedAxis Global Pharma">
          <span className="brand-mark" aria-hidden="true"><Plus size={28} strokeWidth={2.8}/></span>
          <span>MedAxis<span className="brand-sub">GLOBAL PHARMA</span></span>
        </Link>
        <nav className="desktop-nav" aria-label={t('navigation')}>
          {navigation.map(([key, route]) => <Link key={key} href={`/${locale}/${route}`}>{t(key)}</Link>)}
        </nav>
        <div className="header-preferences"><LocaleSwitcher/></div>
        <div className="header-tools">
          <button className="cart-button" aria-label={t('cartCount', { count: itemCount })} onClick={onCart} disabled={!hydrated}>
            <ShoppingBag size={21}/><span className="cart-badge" aria-live="polite">{itemCount}</span>
          </button>
          <button className="icon-button menu-button" aria-label={t('menu')} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={23}/> : <Menu size={23}/>}
          </button>
        </div>
        <button className="button primary header-quote" onClick={onQuickQuote}>{t('quickQuote')}<ArrowRight size={17}/></button>
      </div>
      {menuOpen && <nav className="mobile-nav site-container" id="mobile-navigation" aria-label={t('mobileNavigation')}>
        {navigation.map(([key, route]) => <Link key={key} href={`/${locale}/${route}`} onClick={() => setMenuOpen(false)}>{t(key)}<ArrowRight size={17}/></Link>)}
      </nav>}
    </header>
  </>;
}
