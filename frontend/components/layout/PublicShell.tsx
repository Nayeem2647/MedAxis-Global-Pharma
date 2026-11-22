'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import type { CatalogCartInput } from '../../lib/cart';
import type { ContactConfig } from '../../lib/public-config';
import type { Banner } from '../../lib/public-catalog';
import type { RfqKind } from '../../lib/rfq';
import { CartDrawer } from '../rfq/CartDrawer';
import { RfqForm } from '../rfq/RfqForm';
import { Header } from './Header';
import { Footer } from './Footer';
import { ContactDialog } from './ContactDialog';
import { FloatingChat } from './FloatingChat';
import { useCart } from './CartProvider';
import { ProductToolsProvider } from '../catalog/ProductToolsProvider';

interface ShellActions { openQuickQuote(product?: CatalogCartInput, customName?: string): void; openContact(): void }
const ShellContext = createContext<ShellActions | null>(null);
interface QuoteIntent { id: number; kind: RfqKind; product?: CatalogCartInput; initialName?: string; returnTo: string }
export function usePublicShell(): ShellActions {
  const context = useContext(ShellContext);
  if (!context) throw new Error('usePublicShell requires PublicShell.');
  return context;
}

export function QuoteButton({ children, className = 'button primary', product, initialName }: { children: ReactNode; className?: string; product?: CatalogCartInput; initialName?: string }) {
  const { openQuickQuote } = usePublicShell();
  return <button className={className} onClick={() => openQuickQuote(product, initialName)}>{children}</button>;
}

export function PublicShell({ children, contact, announcements = [] }: { children: ReactNode; contact: ContactConfig; announcements?: Banner[] }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const quotePath = `/${locale}/request-quote`;
  const isQuotePage = pathname === quotePath;
  const { itemCount, hydrated, setDrawerOpen } = useCart();
  const nextQuoteId = useRef(0);
  const leavingQuote = useRef(false);
  const [quote, setQuote] = useState<QuoteIntent | null>(() => isQuotePage ? { id: 0, kind: 'quick-quote', returnTo: `/${locale}/products` } : null);
  const [quoteLocked, setQuoteLocked] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  useEffect(() => {
    if (!isQuotePage) leavingQuote.current = false;
    if (isQuotePage && !quote && !leavingQuote.current) setQuote({ id: ++nextQuoteId.current, kind: 'quick-quote', returnTo: `/${locale}/products` });
  }, [isQuotePage, locale, quote]);
  function openQuote(kind: RfqKind, product?: CatalogCartInput, initialName?: string) {
    leavingQuote.current = false;
    setDrawerOpen(false);
    setContactOpen(false);
    if (!quote || (!quoteLocked && (kind !== quote.kind || product || initialName))) {
      setQuote({ id: ++nextQuoteId.current, kind, product, initialName,
        returnTo: isQuotePage ? quote?.returnTo ?? `/${locale}/products` : `${pathname}${window.location.search}` });
      setQuoteLocked(false);
    }
    if (!isQuotePage) router.push(quotePath);
  }
  const openQuickQuote = (product?: CatalogCartInput, initialName?: string) => openQuote('quick-quote', product, initialName);
  const openContact = () => { setDrawerOpen(false); setContactOpen(true); };
  function closeQuote() {
    leavingQuote.current = true;
    const returnTo = quote?.returnTo ?? `/${locale}/products`;
    // The mounted form retains an unresolved intent until its own guard permits exit.
    router.push(returnTo);
    setQuote(null);
    setQuoteLocked(false);
  }
  return <ShellContext.Provider value={{ openQuickQuote, openContact }}><ProductToolsProvider showTray={!isQuotePage}>
    <Header itemCount={itemCount} hydrated={hydrated} onCart={() => { setContactOpen(false); setDrawerOpen(true); }} onContact={openContact} onQuickQuote={() => openQuickQuote()} contact={contact} contactOpen={contactOpen} announcements={announcements}/>
    <div hidden={isQuotePage} className="public-page-slot">{children}</div>
    {quote && <div hidden={!isQuotePage} className="quote-workspace-slot"><RfqForm key={quote.id} {...quote} active={isQuotePage} contact={contact} onClose={closeQuote} onLockChange={setQuoteLocked}/></div>}
    {!isQuotePage && <><Footer contact={contact} onContact={openContact} onQuickQuote={() => openQuickQuote()}/><FloatingChat contact={contact}/></>}
    <CartDrawer onCustom={() => openQuickQuote()} onSubmit={() => openQuote('cart')}/>
    {contactOpen && <ContactDialog contact={contact} onClose={() => setContactOpen(false)}/>}
  </ProductToolsProvider></ShellContext.Provider>;
}
