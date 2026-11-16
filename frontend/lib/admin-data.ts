import { z } from 'zod';
import { apiRequest, ApiError, type ApiMeta } from './api-client';
import { adminFxSchema, adminRfqsSchema, rfqStatuses, type AdminRfq } from './admin-contract';

const blank = (value: unknown) => value === '' ? undefined : value;
const day = z.preprocess(blank, z.iso.date().optional());
export const adminFiltersSchema = z.strictObject({ page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.preprocess(blank, z.string().trim().max(100).optional()), status: z.preprocess(blank, z.enum(rfqStatuses).optional()), buyer_type: z.preprocess(blank, z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']).optional()), date_from: day, date_to: day,
}).refine((value) => !value.date_from || !value.date_to || value.date_from <= value.date_to);
export type AdminFilters = z.infer<typeof adminFiltersSchema>;
export function rfqQuery(filters: AdminFilters): string {
  const query = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit) });
  for (const key of ['q', 'status', 'buyer_type'] as const) if (filters[key]) query.set(key, filters[key]);
  if (filters.date_from) query.set('date_from', `${filters.date_from}T00:00:00.000Z`);
  if (filters.date_to) query.set('date_to', `${filters.date_to}T23:59:59.999Z`);
  return query.toString();
}
export interface AdminRfqPage { items: AdminRfq[]; pagination: NonNullable<ApiMeta['pagination']> }
export function rfqPage(items: AdminRfq[], meta: ApiMeta): AdminRfqPage {
  if (!meta.pagination) throw new ApiError('RFQ pagination is missing.', { status: 502, code: 'INVALID_API_RESPONSE' });
  return { items, pagination: meta.pagination };
}
export async function refreshAdminRfqs(filters: AdminFilters, signal: AbortSignal) {
  const result = await apiRequest(`/v1/admin/rfqs?${rfqQuery(filters)}`, adminRfqsSchema, { signal, timeoutMs: 12_000 });
  return rfqPage(result.data, result.meta);
}
export async function refreshAdminFx(signal: AbortSignal) { return (await apiRequest('/v1/admin/fx-rates', adminFxSchema, { signal, timeoutMs: 12_000 })).data; }
