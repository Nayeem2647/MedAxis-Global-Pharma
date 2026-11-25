import { z } from 'zod';
import { adminRfqSchema, rfqStatuses } from './admin-contract';
import { customerQuotationSchema, commercialDecimal } from './quotation';
import { rfqWorkflow } from './workflow-contract';
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
export const rfqDetailSchema = z.object({ ...adminRfqSchema.in.shape, workflow: rfqWorkflow.optional(), guest_expires_at: date.optional(), guest_revoked_at: date.optional(), contact_snapshot: contactSchema, customer_id: uuid, preferred_currency: z.enum(currencies), destination_city_port: text().optional(), close_reason: text().optional(), unable_to_supply_reason: text(2000).optional(), terminal_at: date.optional(), items: z.array(rfqLineSchema).min(1).max(100),
  prescriptions: z.array(z.object({ _id: uuid, attachment_kind: z.enum(['PRESCRIPTION', 'SUPPORTING']).optional(), mime_type: z.enum(['image/jpeg', 'image/png', 'application/pdf']), file_size_bytes: z.number().int().positive().max(5_242_880), uploaded_at: date, purge_scheduled_at: date, purge_status: z.enum(['ACTIVE', 'PENDING', 'DELETING', 'PURGED']) }).transform(({ _id, ...value }) => ({ id: _id, ...value }))),
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
/** Lossless decimal text expansion for editable server Decimal128 strings. */
export function decimalForInput(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?(?:[Ee]([+-]?\d+))?$/.exec(value); if (!match) return value;
  const exponent = Number(match[3] ?? '0'); if (Math.abs(exponent) > 100) return value;
  const digits = match[1] + (match[2] ?? ''); const point = match[1].length + exponent;
  const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const normalized = expanded.replace(/^0+(?=\d)/, ''); return decimalInput.safeParse(normalized).success ? normalized : value;
}
const markup = decimalInput.refine((value) => { if (!decimalInput.safeParse(value).success) return false; const [whole, fraction = ''] = value.split('.'); return BigInt(whole) < BigInt('1000000') || BigInt(whole) === BigInt('1000000') && !/[1-9]/.test(fraction); }, 'Markup exceeds 1000000%.');
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
export const fulfillmentBody = z.discriminatedUnion('status', [z.strictObject({ expected_version_id: uuid, status: z.literal('PAYMENT_RECEIVED'), wire_reference: text(), amount: decimalInput, currency: z.enum(currencies) }), z.strictObject({ expected_version_id: uuid, status: z.literal('DISPATCHED'), courier_name: text(), awb_tracking_number: text(), estimated_delivery: date.optional() }), z.strictObject({ expected_version_id: uuid, status: z.literal('DELIVERED'), delivery_evidence: text(2000).optional() })]);
const rateMap = z.object({ USD: commercialDecimal, EUR: commercialDecimal, CNY: commercialDecimal });
export const adminVersionSchema = z.object({ ...customerQuotationSchema.shape, availability: customerQuotationSchema.shape.availability.optional(), status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED', 'DECLINED', 'VALIDITY_EXPIRED', 'SUPERSEDED', 'PAYMENT_EXPIRED']), valid_until: date.optional(), locked_fx_rates: z.object({ mode: z.enum(['LIVE', 'MANUAL_FIXED']), modes: z.object({ USD: z.enum(['LIVE', 'MANUAL_FIXED']), EUR: z.enum(['LIVE', 'MANUAL_FIXED']), CNY: z.enum(['LIVE', 'MANUAL_FIXED']) }), captured_at: date, fetched_at: z.object({ USD: date, EUR: date, CNY: date }), stale_rates_used: z.boolean(), rates_to_bdt: rateMap }).optional() }).superRefine((value, ctx) => {
  for (const [key, status] of [['available', 'AVAILABLE'], ['unavailable', 'UNAVAILABLE'], ['sourcing', 'SOURCING']] as const) if (value.availability && value.availability[key] !== value.items.filter((line) => line.availability_status === status).length) ctx.addIssue({ code: 'custom', path: ['availability'], message: 'Invalid line counts.' });
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
  try { const url = new URL(input); const expected = new URL(process.env.NEXT_PUBLIC_SITE_URL!); if (url.origin !== expected.origin || !/^\/(?:q|r)\/[a-f0-9]{64}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) return null; return url.href; } catch { return null; }
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
  if (!valid || !blob.size || blob.size > 5_242_880) throw new ApiError('Invalid prescription file.', { status: 502, code: 'INVALID_API_RESPONSE' }); return blob.type === mime ? blob : blob.slice(0, blob.size, mime);
}

export interface OperationState { busy: boolean; blocked: boolean; uncertain: boolean; notice: string; problem: { status: number; code?: string; requestId?: string; fields: string[] } | null }
/** One synchronous lock per workspace; writes never replay on uncertain delivery. */
export class AdminOperation {
  private locked = false;
  private state: OperationState = { busy: false, blocked: false, uncertain: false, notice: '', problem: null };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  reconcileAdvancedVersion() { if (this.state.uncertain) this.update({ uncertain: false, blocked: false, notice: 'The authoritative version/state advanced. Review it before a distinct action; the original write was not replayed.' }); }
  private update(change: Partial<OperationState>) { this.state = { ...this.state, ...change }; this.listeners.forEach((listener) => listener()); }
  private problem(error: unknown) { return { status: error instanceof ApiError ? error.status : 503, code: error instanceof ApiError && error.responseValidated ? error.code : undefined, requestId: error instanceof ApiError && /^[\w-]{1,100}$/.test(error.requestId ?? '') ? error.requestId : undefined, fields: error instanceof ApiError ? error.details.map((detail) => detail.field).filter((field) => /^[\w.[\]-]{1,160}$/.test(field)) : [] }; }
  async run<T>(work: () => Promise<T>, refresh: () => Promise<void>, committed?: (result: T) => void) {
    if (this.locked || this.state.blocked) return;
    this.locked = true; this.update({ busy: true, problem: null, notice: '' });
    try {
      const result = await work(); this.update({ notice: 'Saved. Refreshing authoritative state.' }); committed?.(result);
      try { await refresh(); this.update({ notice: 'Saved. Server state refreshed.', blocked: false }); }
      catch (error: unknown) { this.update({ notice: 'Saved. The latest state could not be loaded; use Refresh state.', blocked: true, problem: this.problem(error) }); }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.responseValidated &&
          error.status === 503 && ['MANUFACTURER_LOGO_UPLOAD_FAILED', 'GENERIC_IMAGE_UPLOAD_FAILED', 'CATEGORY_IMAGE_UPLOAD_FAILED'].includes(error.code)) {
        this.update({
          blocked: false,
          uncertain: false,
          notice: error.code === 'MANUFACTURER_LOGO_UPLOAD_FAILED'
            ? 'Manufacturer was not saved because logo storage is unavailable. Remove the selected logo and submit again, or retry when storage is available.'
            : `${error.code === 'CATEGORY_IMAGE_UPLOAD_FAILED' ? 'Category' : 'Generic'} was not saved because picture storage is unavailable. Remove the selected picture and submit again, or retry when storage is available.`,
        });
        return;
      }
      const definite = error instanceof ApiError && error.responseValidated && [400, 422].includes(error.status);
      const duplicateSlug = definite && error instanceof ApiError && error.code === 'CATALOG_SLUG_CONFLICT';
      this.update({ problem: this.problem(error), blocked: !definite, uncertain: !definite, notice: duplicateSlug ? 'An existing record already uses this page slug. Open that record to edit it, or choose a different slug for a different record.' : definite ? 'Correct the listed form fields before submitting again.' : 'Delivery was not confirmed. Refreshing server state; this action will not be replayed.' });
      if (!definite) {
        try { await refresh(); if (error instanceof ApiError && error.responseValidated && error.status === 409) this.update({ blocked: false, uncertain: false, notice: 'The server rejected a conflict. Review the refreshed version before a manual action.' }); }
        catch { /* Keep the original failure and locked business action. */ }
      }
    } finally { this.locked = false; this.update({ busy: false }); }
  }
  async refresh(read: () => Promise<void>) {
    if (this.locked) return; this.locked = true; this.update({ busy: true });
    try { await read(); this.update({ problem: null, blocked: this.state.uncertain, notice: this.state.uncertain ? 'Server state refreshed. Delivery remains uncertain; confirm with the team before another write. Keep this page open.' : 'Server state refreshed.', }); }
    catch (error: unknown) { this.update({ problem: this.problem(error) }); }
    finally { this.locked = false; this.update({ busy: false }); }
  }
}
