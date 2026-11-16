import { describe, expect, it } from 'vitest';
import { addCartItem, catalogCartId, changeCartQuantity, parseStoredCart, type CartItem } from '../../lib/cart';

const item: CartItem = { kind: 'catalog', productId: '82f591d0-346b-4cc4-8d67-e25358fa0272', id: 'product:BOX', name: 'Medicine', strength: '80mg', packagingUnit: 'BOX', quantity: 2 };
const custom: CartItem = { kind: 'custom', id: '4d5e6f7a-8b9c-4d1e-8f3a-4b5c6d7e8f9a', name: 'Custom medicine', strength: '', packagingUnit: 'VIAL', quantity: 1 };

describe('persistent RFQ cart', () => {
  it('merges the same product and unit without duplicating the line', () => {
    const next = addCartItem([item], { ...item, quantity: 3 });
    expect(next).toEqual([{ ...item, quantity: 5 }]);
    expect(item.quantity).toBe(2);
  });
  it('keeps different packaging units and custom medicines separate', () => {
    const other = { ...item, id: catalogCartId({ ...item, packagingUnit: 'PACK' }), packagingUnit: 'PACK' };
    expect(addCartItem(addCartItem([item], other), custom)).toHaveLength(3);
  });
  it('merges repeated custom medicine requirements', () => {
    expect(addCartItem([custom], { ...custom, name: 'CUSTOM MEDICINE', quantity: 4 })).toEqual([{ ...custom, quantity: 5 }]);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantity %s', (quantity) => {
    expect(() => changeCartQuantity([item], item.id, quantity)).toThrow('quantityInvalid');
  });
  it('detects overflow during repeated additions', () => {
    expect(() => addCartItem([{ ...item, quantity: Number.MAX_SAFE_INTEGER }], item)).toThrow('quantityInvalid');
  });
  it('hydrates valid versioned items and strips unknown price fields', () => {
    const parsed = parseStoredCart(JSON.stringify({ version: 1, items: [{ ...item, unit_price: 'SECRET' }, custom] }));
    expect(parsed).toEqual([item, custom]);
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
  });
  it.each([null, '{broken', '{}', '{"version":2,"items":[]}', JSON.stringify({ version: 1, items: [{ ...item, quantity: -1 }] }), JSON.stringify({ version: 1, items: [item, item] })])('safely discards invalid storage %s', (value) => {
    expect(parseStoredCart(value)).toEqual([]);
  });
  it('limits persisted lists and new additions to 100 distinct items', () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ ...custom, id: crypto.randomUUID(), name: `Custom ${index}` }));
    expect(() => addCartItem(items, custom)).toThrow('cartFull');
    expect(parseStoredCart(JSON.stringify({ version: 1, items: [...items, custom] }))).toEqual([]);
  });
});
