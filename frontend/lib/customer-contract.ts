import { z } from 'zod';
import { customerQuotationSchema, commercialDecimal } from './quotation';

export const CUSTOMER_COOKIE = 'medaxis_customer_session';
export const customerPrivateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' };
export const customerProfileSchema = z.object({
  id: z.uuid(), email: z.email(), email_verified: z.boolean(), full_name: z.string().max(200), customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']), company_name: z.string().max(200),
  country: z.string().regex(/^[A-Z]{2}$/), city: z.string().max(100), whatsapp_number: z.string().max(50), wechat_id: z.string().max(100), preferred_locale: z.enum(['en', 'zh-CN']),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;
export const customerSessionSchema = z.object({ profile: customerProfileSchema.nullable() });
export const customerRegistrationSchema = z.object({ profile: customerProfileSchema, verification_sent: z.boolean() });
export const draftItemSchema = z.object({ product_id: z.uuid().optional(), name: z.string().trim().min(1).max(200), strength: z.string().max(100).optional(), quantity: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), packaging_unit: z.string().min(1).max(40), notes: z.string().max(2000).optional() });
export const draftBodySchema = z.object({ title: z.string().trim().min(1).max(200), destination_country: z.string().regex(/^[A-Z]{2}$/), preferred_currency: z.enum(['USD', 'CNY', 'EUR', 'BDT']), items: z.array(draftItemSchema).min(1).max(100) });
export const customerDraftSchema = draftBodySchema.extend({ id: z.uuid(), status: z.enum(['DRAFT', 'SUBMITTING', 'SUBMITTED']), revision: z.number().int().nonnegative(), rfq_id: z.uuid().optional(), rfq_number: z.string().optional(), created_at: z.iso.datetime(), updated_at: z.iso.datetime() });
export type CustomerDraft = z.infer<typeof customerDraftSchema>;
export const customerOverviewSchema = z.object({ drafts: z.number().int().nonnegative(), rfqs: z.number().int().nonnegative(), quotations: z.number().int().nonnegative(), packaging_units: z.array(z.string().max(40)).max(100) });
export const customerRfqSchema = z.object({ id: z.uuid(), rfq_number: z.string(), status: z.string(), inquiry_type: z.string(), destination_country: z.string(), preferred_currency: z.string(), created_at: z.iso.datetime(), updated_at: z.iso.datetime(), items: z.array(z.object({ id: z.uuid(), name: z.string(), strength: z.string(), quantity: z.number().int(), packaging_unit: z.string(), availability_status: z.string(), customer_facing_note: z.string().optional(), notes: z.string().optional() })) });
export const customerQuoteSummarySchema = z.object({ id: z.uuid(), quotation_id: z.uuid(), quotation_number: z.string(), version_number: z.number().int(), status: z.string(), billing_currency: z.string(), total_amount: commercialDecimal, issued_at: z.iso.datetime(), valid_until: z.iso.datetime(), is_current: z.boolean() });
export const accountQuotationSchema = customerQuotationSchema.safeExtend({ quotation_number: z.string(), is_current: z.boolean() });
export const customerRevisionSchema = z.object({ id: z.uuid(), body: z.string().max(5000), status: z.string(), created_at: z.iso.datetime(), quotation_number: z.string() });
export const customerHistorySchema = z.object({ id: z.uuid(), kind: z.string(), reference_id: z.uuid().optional(), label: z.string().optional(), status: z.string().optional(), created_at: z.iso.datetime() });
export function customerProxyRule(path: string, method: string) {
  if (/^(auth\/(register|login|verify-email|forgot-password|reset-password|logout|resend-verification|change-password))$/.test(path)) return method === 'POST';
  if (path === 'auth/session') return method === 'GET';
  if (path === 'profile') return method === 'GET' || method === 'PATCH';
  if (path === 'drafts') return method === 'GET' || method === 'POST';
  if (/^(overview|rfqs|quotations|revisions|history)$/.test(path)) return method === 'GET';
  const id = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
  if (new RegExp(`^drafts/${id}$`).test(path)) return method === 'PATCH' || method === 'DELETE';
  if (new RegExp(`^drafts/${id}/submit$`).test(path)) return method === 'POST';
  if (new RegExp(`^rfqs/${id}$`).test(path)) return method === 'GET';
  if (new RegExp(`^quotations/${id}(?:/pdf)?$`).test(path)) return method === 'GET';
  return new RegExp(`^quotations/${id}/revisions$`).test(path) && method === 'POST';
}
