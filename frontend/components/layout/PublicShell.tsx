'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CatalogCartInput } from '../../lib/cart';
import type { ContactConfig } from '../../lib/public-config';
import type { RfqKind } from '../../lib/rfq';
import { CartDrawer } from '../rfq/CartDrawer';
import { RfqDialog } from '../rfq/RfqDialog';
import { Header } from './Header';
import { Footer } from './Footer';
import { ContactDialog } from './ContactDialog';
import { useCart } from './CartProvider';

interface ShellActions { openQuickQuote(product?: CatalogCartInput, customName?: string): void; openContact(): void }
const ShellContext = createContext<ShellActions | null>(null);
export function usePublicShell(): ShellActions {
  const context = useContext(ShellContext);
  if (!context) throw new Error('usePublicShell requires PublicShell.');
  return context;
}

export function QuoteButton({ children, className = 'button primary', product, initialName }: { children: ReactNode; className?: string; product?: CatalogCartInput; initialName?: string }) {
  const { openQuickQuote } = usePublicShell();
  return <button className={className} onClick={() => openQuickQuote(product, initialName)}>{children}</button>;
}

export function PublicShell({ children, contact }: { children: ReactNode; contact: ContactConfig }) {
  const { itemCount, hydrated, setDrawerOpen } = useCart();
  const [quote, setQuote] = useState<{ kind: RfqKind; product?: CatalogCartInput; initialName?: string } | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const openQuickQuote = (product?: CatalogCartInput, initialName?: string) => { if (quote) return; setDrawerOpen(false); setContactOpen(false); setQuote({ kind: 'quick-quote', product, initialName }); };
  const openContact = () => { if (quote) return; setDrawerOpen(false); setContactOpen(true); };
  return <ShellContext.Provider value={{ openQuickQuote, openContact }}>
    <Header itemCount={itemCount} hydrated={hydrated} onCart={() => { if (!quote) { setContactOpen(false); setDrawerOpen(true); } }} onContact={openContact} onQuickQuote={() => openQuickQuote()}/>
    {children}
    <Footer contact={contact} onContact={openContact}/>
    {quote && <RfqDialog {...quote} contact={contact} onClose={() => setQuote(null)}/>}
    <CartDrawer onCustom={() => openQuickQuote()} onSubmit={() => { setDrawerOpen(false); setQuote({ kind: 'cart' }); }}/>
    {contactOpen && <ContactDialog contact={contact} onClose={() => setContactOpen(false)}/>}
  </ShellContext.Provider>;
}
