import { z } from 'zod';
import { adminRfqSchema, rfqStatuses } from './admin-contract';
import { customerQuotationSchema, commercialDecimal } from './quotation';
import { ApiError, apiRequest, parseApiResponse } from './api-client';

const uuid = z.uuidv4();
const text = (max = 200) => z.string().trim().min(1).max(max);
const date = z.iso.datetime({ offset: true });
export const currencies = ['USD', 'EUR', 'CNY', 'BDT'] as const;
export const availability = ['AVAILABLE', 'UNAVAILABLE', 'SOURCING'] as const;
export const shippingSchema = z.strictObject({ method: z.enum(['INCOTERM', 'EXPRESS_COURIER']), incoterm: z.enum(['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF']).optional(), named_place: text(), cold_chain_required: z.boolean(), temperature_range: text().optional() }).refine((value) => value.method !== 'INCOTERM' || !!value.incoterm, 'Choose an Incoterm.');
export const bankInputSchema = z.strictObject({ configured: z.literal(true), instructions: text(4000), beneficiary_name: text(500), bank_name: text(500), account_number: text(500), swift_code: text(500), bank_address: text(500).optional(), currency: z.enum(currencies).optional() });
const contactSchema = z.object({ full_name: text(), customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']), company_name: text().optional(), email: z.email().optional(), whatsapp_number: text(50).optional(), wechat_id: text(100).optional(), preferred_locale: z.enum(['en', 'zh-CN']) });
export const rfqLineSchema = z.object({ _id: uuid, product_id: uuid.optional(), is_uncatalogued: z.boolean(), product_snapshot: z.object({ brand_name: text().optional(), pack_size: text().optional() }).optional(), custom_medicine_name: text().optional(), custom_strength: text(100).optional(), quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), packaging_unit: text(40), item_availability_status: z.enum(availability), customer_facing_note: text(2000).optional(), line_notes: text(2000).optional(), internal_note: text(2000).optional() }).transform(({ _id, ...value }) => ({ id: _id, ...value }));
const quoteReference = z.object({ _id: uuid, quotation_number: text(), current_version: z.number().int().positive(), current_version_id: uuid, overall_status: z.enum(['ACTIVE', 'COMPLETED', 'DECLINED', 'EXPIRED']), created_at: date }).transform(({ _id, ...value }) => ({ id: _id, ...value }));
export const rfqDetailSchema = z.object({ ...adminRfqSchema.in.shape, contact_snapshot: contactSchema, customer_id: uuid, preferred_currency: z.enum(currencies), destination_city_port: text().optional(), close_reason: text().optional(), unable_to_supply_reason: text(2000).optional(), terminal_at: date.optional(), items: z.array(rfqLineSchema).min(1).max(100),
  prescriptions: z.array(z.object({ _id: uuid, mime_type: z.enum(['image/jpeg', 'image/png', 'application/pdf']), file_size_bytes: z.number().int().positive().max(5_242_880), uploaded_at: date, purge_scheduled_at: date, purge_status: z.enum(['ACTIVE', 'PENDING', 'PURGED', 'FAILED']) }).transform(({ _id, ...value }) => ({ id: _id, ...value }))),
  clarification_messages: z.array(z.object({ _id: uuid, direction: z.enum(['ADMIN_TO_BUYER', 'BUYER_TO_ADMIN', 'INTERNAL_NOTE']), channel: z.enum(['EMAIL', 'WHATSAPP', 'WECHAT', 'ADMIN']), body: text(5000), status: z.enum(['PENDING_BUYER', 'REPLIED', 'RESOLVED']), created_at: date }).transform(({ _id, ...value }) => ({ id: _id, ...value }))), quotations: z.array(quoteReference),
}).transform(({ _id, ...value }) => ({ id: _id, ...value }));
export type RfqDetail = z.infer<typeof rfqDetailSchema>;
export type RfqLine = z.infer<typeof rfqLineSchema>;
export const manualTransitions: Record<RfqDetail['status'], readonly RfqDetail['status'][]> = { SUBMITTED: ['UNDER_REVIEW', 'CLOSED', 'CANCELLED'], UNDER_REVIEW: ['CLOSED', 'CANCELLED'], NEED_CLARIFICATION: ['UNDER_REVIEW', 'CLOSED', 'CANCELLED'], QUOTED: ['CANCELLED'], CONVERTED: [], CLOSED: [], CANCELLED: [] };
export const editableRfq = (status: RfqDetail['status']) => ['SUBMITTED', 'UNDER_REVIEW', 'NEED_CLARIFICATION'].includes(status);
export const statusBody = z.strictObject({ status: z.enum(rfqStatuses), reason: text(2000).optional() }).refine((value) => !['CLOSED', 'CANCELLED'].includes(value.status) || !!value.reason, 'A closing reason is required.');
export const availabilityBody = z.strictObject({ item_availability_status: z.enum(availability), customer_facing_note: text(2000).optional() });
export const clarificationBody = z.strictObject({ body: text(5000), channel: z.enum(['EMAIL', 'WHATSAPP', 'WECHAT']) });
export const noteBody = z.strictObject({ body: text(5000) });
export const unableBody = z.strictObject({ unable_to_supply_reason: text(2000) });
export const mutationRfqSchema = z.object({ _id: uuid, status: z.enum(rfqStatuses) });
export const noteResult = z.object({ note_id: uuid });
export const clarificationResult = z.object({ message_id: uuid, thread_id: uuid, status: z.literal('NEED_CLARIFICATION') });

export const decimalInput = z.string().regex(/^\d{1,18}(?:\.\d{1,8})?$/, 'Use a nonnegative decimal string with up to eight decimal places.');
const markup = decimalInput.refine((value) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) < 1_000_000n || BigInt(whole) === 1_000_000n && !/[1-9]/.test(fraction); }, 'Markup exceeds 1000000%.');
const snapshot = z.strictObject({ brand_name: text(), generic_name: text(), strength: text(), dosage_form: text(), pack_size: text() });
export const pricingLineSchema = z.strictObject({ rfq_item_id: uuid, manufacturer_id: uuid, availability_status: z.enum(availability), procurement_cost_bdt: decimalInput.optional(), markup_percent: markup.optional(), customer_facing_note: text(2000).optional(), snapshot: snapshot.optional() }).superRefine((value, ctx) => {
  if (value.availability_status === 'AVAILABLE' && (value.procurement_cost_bdt === undefined || value.markup_percent === undefined)) ctx.addIssue({ code: 'custom', path: ['procurement_cost_bdt'], message: 'Available lines require per-unit cost and markup.' });
  if (value.availability_status === 'UNAVAILABLE' && !value.customer_facing_note) ctx.addIssue({ code: 'custom', path: ['customer_facing_note'], message: 'Explain unavailable lines to the buyer.' });
});
export const pricingSchema = z.strictObject({ billing_currency: z.enum(currencies), items: z.array(pricingLineSchema).min(1).max(100), freight_amount: decimalInput, insurance_amount: decimalInput, shipping_terms: shippingSchema, payment_terms: z.literal('BANK_WIRE_TT'), bank_details: bankInputSchema.optional(), internal_procurement_notes: text(5000).optional() }).superRefine((value, ctx) => {
  if (!value.items.some((line) => line.availability_status === 'AVAILABLE')) ctx.addIssue({ code: 'custom', path: ['items'], message: 'At least one line must be available.' });
  if (new Set(value.items.map((line) => line.rfq_item_id)).size !== value.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Quote each line once.' });
});
export type Pricing = z.infer<typeof pricingSchema>;
export const draftBody = pricingSchema.safeExtend({ rfq_id: uuid });
export const reviseBody = pricingSchema.safeExtend({ expected_current_version_id: uuid, issue_immediately: z.boolean(), validity_days: z.number().int().min(1).max(365).optional(), allow_stale_fx: z.boolean() });
export const sendBody = z.strictObject({ expected_version_id: uuid, bank_details: bankInputSchema.optional(), validity_days: z.number().int().min(1).max(365).optional(), allow_stale_fx: z.boolean() });
export const resendBody = z.strictObject({ expected_version_id: uuid });
export const fulfillmentBody = z.discriminatedUnion('status', [z.strictObject({ expected_version_id: uuid, status: z.literal('PAYMENT_RECEIVED'), wire_reference: text(), amount: decimalInput, currency: z.enum(currencies) }), z.strictObject({ expected_version_id: uuid, status: z.literal('DISPATCHED'), courier_name: text(), awb_tracking_number: text(), estimated_delivery: date.optional() }), z.strictObject({ expected_version_id: uuid, status: z.literal('DELIVERED') })]);
const rateMap = z.object({ USD: commercialDecimal, EUR: commercialDecimal, CNY: commercialDecimal });
export const adminVersionSchema = z.object({ ...customerQuotationSchema.shape, status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED', 'DECLINED', 'VALIDITY_EXPIRED', 'SUPERSEDED', 'PAYMENT_EXPIRED']), valid_until: date.optional(), locked_fx_rates: z.object({ mode: z.enum(['LIVE', 'MANUAL_FIXED']), modes: z.object({ USD: z.enum(['LIVE', 'MANUAL_FIXED']), EUR: z.enum(['LIVE', 'MANUAL_FIXED']), CNY: z.enum(['LIVE', 'MANUAL_FIXED']) }), captured_at: date, fetched_at: z.object({ USD: date, EUR: date, CNY: date }), stale_rates_used: z.boolean(), rates_to_bdt: rateMap }).optional() }).superRefine((value, ctx) => {
  for (const [key, status] of [['available', 'AVAILABLE'], ['unavailable', 'UNAVAILABLE'], ['sourcing', 'SOURCING']] as const) if (value.availability[key] !== value.items.filter((line) => line.availability_status === status).length) ctx.addIssue({ code: 'custom', path: ['availability'], message: 'Invalid line counts.' });
});
export type AdminVersion = z.infer<typeof adminVersionSchema>;
const signedDecimal = z.string().regex(/^-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?$/).max(100);
const internalCost = z.object({ id: uuid, quotation_version_id: uuid, items: z.array(z.object({ rfq_item_id: uuid, manufacturer_id: uuid, quantity: z.number().int().positive(), procurement_unit_cost_bdt: commercialDecimal, markup_percent: commercialDecimal })), procurement_cost_bdt: commercialDecimal, target_markup_percent: commercialDecimal, calculated_base_bdt: commercialDecimal, gross_margin_bdt: signedDecimal.optional(), effective_gross_margin_percent: signedDecimal.optional(), internal_procurement_notes: text(5000).optional() });
export const quotationDetailSchema = z.object({ quotation: z.object({ _id: uuid, quotation_number: text(), rfq_id: uuid, current_version: z.number().int().positive(), current_version_id: uuid, overall_status: z.enum(['ACTIVE', 'COMPLETED', 'DECLINED', 'EXPIRED']) }).transform(({ _id, ...value }) => ({ id: _id, ...value })), versions: z.array(adminVersionSchema).min(1), internal_costs: z.array(internalCost) }).refine((value) => value.versions.some((version) => version.id === value.quotation.current_version_id && version.quotation_id === value.quotation.id && version.version_number === value.quotation.current_version), 'Current version is missing.');
export type QuotationDetail = z.infer<typeof quotationDetailSchema>;
export const quoteWriteResult = z.object({ quotation_id: uuid.optional(), version: adminVersionSchema, fx_preview: z.object({ rates_to_bdt: rateMap, stale: z.boolean(), captured_at: date }).optional(), magic_link_url: z.string().url().optional() });
export const settingsSchema = z.object({
  wire_instructions: z.object({ value: z.object({ configured: z.boolean(), instructions: text(4000), beneficiary_name: text(500).optional(), bank_name: text(500).optional(), account_number: text(500).optional(), swift_code: text(500).optional(), bank_address: text(500).optional(), currency: z.enum(currencies).optional() }), updated_at: date }).optional(),
  payment_presets: z.object({ value: z.object({ quote_validity_days: z.number().int().min(1).max(365), reservation_days: z.literal(5), business_timezone: z.literal('Asia/Dhaka'), terms: z.array(z.literal('BANK_WIRE_TT')) }), updated_at: date }).optional(),
  packaging_units: z.object({ value: z.object({ units: z.array(text(40)).min(1).max(100) }), updated_at: date }).optional(),
  shipping_presets: z.object({ value: z.object({ methods: z.array(z.enum(['INCOTERM', 'EXPRESS_COURIER'])), incoterms: z.array(z.enum(['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF'])) }), updated_at: date }).optional(),
});
export type AdminSettings = z.infer<typeof settingsSchema>;
export const readRfq = async (id: string, signal?: AbortSignal) => (await apiRequest(`/v1/admin/rfqs/${uuid.parse(id)}`, rfqDetailSchema, { signal })).data;
export const readAdminQuotation = async (id: string, signal?: AbortSignal) => (await apiRequest(`/v1/admin/quotations/${uuid.parse(id)}`, quotationDetailSchema, { signal })).data;
export function safeMagicLink(input: string): string | null {
  try { const url = new URL(input); const expected = new URL(process.env.NEXT_PUBLIC_SITE_URL!); if (url.origin !== expected.origin || !/^\/q\/[a-f0-9]{64}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) return null; return url.href; } catch { return null; }
}
export function fulfillmentNext(version: AdminVersion, now = Date.now()): 'PAYMENT_RECEIVED' | 'DISPATCHED' | 'DELIVERED' | null {
  if (version.status === 'ACCEPTED' && version.reservation_status === 'ACTIVE' && version.reservation_expires_at && Date.parse(version.reservation_expires_at) > now) return 'PAYMENT_RECEIVED';
  if (version.status === 'PAYMENT_RECEIVED' && version.payment && version.reservation_status === 'CONSUMED') return 'DISPATCHED';
  if (version.status === 'DISPATCHED' && version.shipment) return 'DELIVERED'; return null;
}
/** Authorized bytes stay in memory; no CDN, cookies in JS, or automatic upload retry. */
export async function prescriptionBlob(id: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/admin/prescriptions/${uuid.parse(id)}/stream`, { credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal });
  const mime = response.headers.get('content-type')?.split(';')[0].trim();
  if (!response.ok || !['image/jpeg', 'image/png', 'application/pdf'].includes(mime ?? '')) { await parseApiResponse(response, z.never()); throw new ApiError('Invalid prescription response.', { status: 502, code: 'INVALID_API_RESPONSE' }); }
  const blob = await response.blob(); const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const valid = mime === 'application/pdf' ? new TextDecoder().decode(bytes).startsWith('%PDF-') : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.join(',') === '137,80,78,71,13,10,26,10';
  if (!valid || !blob.size || blob.size > 5_242_880) throw new ApiError('Invalid prescription file.', { status: 502, code: 'INVALID_API_RESPONSE' }); return blob;
}
