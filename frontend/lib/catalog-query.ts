import { z } from 'zod';
import { slugSchema } from './catalog-path';

export type SearchValues = Record<string, string | string[] | undefined>;
export const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
  initial: z.string().regex(/^[A-Za-z]$/).toUpperCase().optional(),
  manufacturer: slugSchema.optional(), generic: slugSchema.optional(), category: slugSchema.optional(),
  dosage_form: z.string().trim().min(1).max(100).optional(), cold_chain: z.enum(['true', 'false']).optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export const queryKeys = ['page', 'limit', 'q', 'initial', 'manufacturer', 'generic', 'category', 'dosage_form', 'cold_chain'] as const;

export function readCatalogQuery(values: SearchValues) {
  const input: Record<string, string | string[]> = {};
  for (const key of queryKeys) {
    const value = values[key];
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (normalized !== undefined && normalized !== '') input[key] = normalized;
  }
  const result = catalogQuerySchema.safeParse(input);
  return { query: result.success ? result.data : catalogQuerySchema.parse({}), valid: result.success, hasParameters: Object.keys(values).length > 0 };
}

export function catalogQueryString(query: CatalogQuery): string {
  const parameters = new URLSearchParams();
  for (const key of queryKeys) {
    const value = query[key];
    if (value !== undefined && value !== '') parameters.set(key, String(value));
  }
  return parameters.toString();
}

export function catalogPageHref(path: string, query: CatalogQuery, page: number): string {
  return `${path}?${catalogQueryString({ ...query, page })}`;
}
