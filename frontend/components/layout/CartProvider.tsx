'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CART_STORAGE_KEY, addCartItem, catalogCartId, catalogCartInput, changeCartQuantity, customCartInput, parseStoredCart, type CartItem, type CatalogCartInput, type CustomCartInput } from '../../lib/cart';

interface CartContextValue {
  items: readonly CartItem[]; hydrated: boolean; itemCount: number;
  drawerOpen: boolean; setDrawerOpen(open: boolean): void;
  addItem(input: CatalogCartInput): void; addCustomItem(input: CustomCartInput): void;
  updateQuantity(id: string, quantity: number): void; removeItem(id: string): void; clearCart(): void;
  clearSubmittedItems(submitted: readonly CartItem[]): void;
}
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const currentItems = useRef<CartItem[]>([]);
  const commit = useCallback((change: (current: CartItem[]) => CartItem[]) => {
    const next = change(currentItems.current);
    currentItems.current = next;
    setItems(next);
  }, []);
  useEffect(() => {
    try { commit(() => parseStoredCart(localStorage.getItem(CART_STORAGE_KEY))); } catch { /* Storage may be unavailable in private browsing. */ }
    setHydrated(true);
    const sync = (event: StorageEvent) => { if (event.key === CART_STORAGE_KEY || event.key === null) commit(() => parseStoredCart(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [commit]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items })); } catch { /* Keep the in-memory cart usable. */ }
  }, [hydrated, items]);
  const addItem = useCallback((input: CatalogCartInput) => {
    const data = catalogCartInput.parse(input);
    commit((current) => addCartItem(current, { ...data, id: catalogCartId(data), kind: 'catalog' }));
  }, [commit]);
  const addCustomItem = useCallback((input: CustomCartInput) => {
    const data = customCartInput.parse(input);
    const candidate: CartItem = { ...data, id: crypto.randomUUID(), kind: 'custom' };
    commit((current) => addCartItem(current, candidate));
  }, [commit]);
  const updateQuantity = useCallback((id: string, quantity: number) => commit((current) => changeCartQuantity(current, id, quantity)), [commit]);
  const removeItem = useCallback((id: string) => commit((current) => current.filter((item) => item.id !== id)), [commit]);
  const clearCart = useCallback(() => commit(() => []), [commit]);
  const clearSubmittedItems = useCallback((submitted: readonly CartItem[]) => commit((current) => current.flatMap((item) => {
    const sent = submitted.find((line) => line.id === item.id && line.kind === item.kind && line.name === item.name && line.strength === item.strength && line.packagingUnit === item.packagingUnit);
    if (!sent) return [item];
    return item.quantity > sent.quantity ? [{ ...item, quantity: item.quantity - sent.quantity }] : [];
  })), [commit]);
  const value = useMemo<CartContextValue>(() => ({ items, hydrated, itemCount: items.length, drawerOpen, setDrawerOpen, addItem, addCustomItem, updateQuantity, removeItem, clearCart, clearSubmittedItems }),
    [items, hydrated, drawerOpen, addItem, addCustomItem, updateQuantity, removeItem, clearCart, clearSubmittedItems]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart requires CartProvider.');
  return context;
}
