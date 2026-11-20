import { z } from 'zod';
import { alternateSlugsSchema, type HomeProduct } from './public-catalog';

export const COMPARISON_STORAGE_KEY = 'medaxis_product_comparison';
export const comparisonItemSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(500), alternate_slugs: alternateSlugsSchema });
export type ComparisonItem = z.infer<typeof comparisonItemSchema>;
const storedComparison = z.object({ version: z.literal(1), products: z.array(comparisonItemSchema).max(3) })
  .refine(({ products }) => new Set(products.map((product) => product.id)).size === products.length);
export function readComparison(value: string | null): ComparisonItem[] {
  if (!value || value.length > 10000) return [];
  try { const parsed = storedComparison.safeParse(JSON.parse(value)); return parsed.success ? parsed.data.products : []; } catch { return []; }
}
export function toggleComparison(items: readonly ComparisonItem[], product: ComparisonItem): ComparisonItem[] {
  const parsed = comparisonItemSchema.parse(product);
  if (items.some((item) => item.id === parsed.id)) return items.filter((item) => item.id !== parsed.id);
  if (items.length >= 3) throw new Error('COMPARISON_FULL');
  return [...items, parsed];
}
export const ratingSummarySchema = z.object({ average: z.number().min(0).max(5), count: z.number().int().nonnegative() });
export const personalRatingSchema = ratingSummarySchema.extend({ my_rating: z.number().int().min(1).max(5).nullable() });
export type RatingSummary = z.infer<typeof ratingSummarySchema>;
export function productCartInput(product: HomeProduct) {
  return { productId: product.id, name: product.brand_name,
    names: { en: product.translations.en.brand_name, ...(product.translations.zhCN ? { 'zh-CN': product.translations.zhCN.brand_name } : {}) },
    strength: product.strength, packagingUnit: product.packaging_unit, quantity: 1 };
}
