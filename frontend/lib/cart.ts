import { z } from 'zod';

export const CART_STORAGE_KEY = 'medaxis_rfq_cart';
export const quantitySchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const fields = {
  name: z.string().trim().min(1).max(200), strength: z.string().trim().max(100).default(''),
  packagingUnit: z.string().trim().min(1).max(40), quantity: quantitySchema,
};
export const catalogCartInput = z.object({ ...fields, productId: z.uuid(), names: z.object({ en: z.string().max(200), 'zh-CN': z.string().max(200).optional() }).optional() });
export const customCartInput = z.object(fields);
export type CatalogCartInput = z.input<typeof catalogCartInput>;
export type CustomCartInput = z.input<typeof customCartInput>;
const cartItemSchema = z.discriminatedUnion('kind', [
  catalogCartInput.extend({ kind: z.literal('catalog'), id: z.string().max(300) }),
  customCartInput.extend({ kind: z.literal('custom'), id: z.uuid() }),
]);
export type CartItem = z.infer<typeof cartItemSchema>;
const storedCartSchema = z.object({ version: z.literal(1), items: z.array(cartItemSchema).max(100) });
export type CartIssue = 'quantityInvalid' | 'cartFull' | 'invalidItem';
export class CartError extends Error {
  constructor(readonly issue: CartIssue) { super(issue); this.name = 'CartError'; }
}

function sameItem(left: CartItem, right: CartItem): boolean {
  if (left.kind !== right.kind || left.packagingUnit !== right.packagingUnit) return false;
  return left.kind === 'catalog' && right.kind === 'catalog' ? left.productId === right.productId
    : left.name.normalize('NFC').toLowerCase() === right.name.normalize('NFC').toLowerCase() && left.strength === right.strength;
}
export function addCartItem(items: readonly CartItem[], candidate: CartItem): CartItem[] {
  const parsed = cartItemSchema.safeParse(candidate);
  if (!parsed.success) throw new CartError('invalidItem');
  const existing = items.find((item) => sameItem(item, parsed.data));
  if (existing) {
    const quantity = existing.quantity + parsed.data.quantity;
    if (!quantitySchema.safeParse(quantity).success) throw new CartError('quantityInvalid');
    return items.map((item) => item.id === existing.id ? { ...item, quantity } : item);
  }
  if (items.length >= 100) throw new CartError('cartFull');
  return [...items, parsed.data];
}
export function changeCartQuantity(items: readonly CartItem[], id: string, quantity: number): CartItem[] {
  if (!quantitySchema.safeParse(quantity).success) throw new CartError('quantityInvalid');
  return items.map((item) => item.id === id ? { ...item, quantity } : item);
}
export function parseStoredCart(value: string | null): CartItem[] {
  if (!value || value.length > 200_000) return [];
  try {
    const input: unknown = JSON.parse(value);
    const parsed = storedCartSchema.safeParse(input);
    if (!parsed.success || new Set(parsed.data.items.map((item) => item.id)).size !== parsed.data.items.length) return [];
    return parsed.data.items;
  } catch { return []; }
}
export function catalogCartId(input: { productId: string; packagingUnit: string }): string {
  return `${input.productId}:${encodeURIComponent(input.packagingUnit)}`;
}
