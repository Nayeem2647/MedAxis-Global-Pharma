import { z } from 'zod';
import { ApiError, apiQuotationPdf, apiRequest } from './api-client';

const text = (max: number) => z.string().min(1).max(max);
export const quotationToken = z.string().regex(/^[a-f0-9]{64}$/);
export const commercialDecimal = z.string().regex(/^\d{1,34}(?:\.\d{1,34})?(?:[Ee][+-]?\d{1,4})?$/);
const currency = z.enum(['USD', 'EUR', 'CNY', 'BDT']);
const date = z.iso.datetime({ offset: true });
const line = {
  id: z.uuidv4(), rfq_item_id: z.uuidv4(), product_id: z.uuidv4().optional(), manufacturer_id: z.uuidv4(),
  brand_name: text(200), generic_name: text(200), strength: z.string().max(200), dosage_form: text(200), pack_size: text(200),
  packaging_unit: text(40), quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), customer_facing_note: text(2000).optional(),
  weight_per_pack_g: commercialDecimal.optional(), line_weight_g: commercialDecimal.optional(),
};
const lineSchema = z.discriminatedUnion('availability_status', [
  z.object({ ...line, availability_status: z.literal('AVAILABLE'), unit_quoted_price: commercialDecimal, total_line_price: commercialDecimal }),
  z.object({ ...line, availability_status: z.literal('UNAVAILABLE') }),
  z.object({ ...line, availability_status: z.literal('SOURCING') }),
]);
const bankSchema = z.object({
  configured: z.literal(true), instructions: text(4000), beneficiary_name: text(500), bank_name: text(500), account_number: text(500),
  swift_code: text(500), bank_address: text(500).optional(), currency: currency.optional(),
});
export const customerQuotationSchema = z.object({
  id: z.uuidv4(), quotation_id: z.uuidv4(), version_number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(['SENT', 'ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED', 'DECLINED', 'VALIDITY_EXPIRED', 'SUPERSEDED', 'PAYMENT_EXPIRED']),
  contact: z.object({ full_name: text(200), customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']), company_name: text(200).optional(),
    email: z.email().max(200).optional(), whatsapp_number: text(50).optional(), wechat_id: text(100).optional(), preferred_locale: z.enum(['en', 'zh-CN']) }),
  items: z.array(lineSchema).min(1).max(100), billing_currency: currency,
  subtotal_amount: commercialDecimal, freight_cost: commercialDecimal, insurance_cost: commercialDecimal, total_amount: commercialDecimal,
  medicine_weight_g: commercialDecimal.optional(), packed_weight_g: commercialDecimal.optional(), payment_requested_at: date.optional(),
  shipping_terms: z.object({ method: z.enum(['INCOTERM', 'EXPRESS_COURIER']), incoterm: z.enum(['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF']).optional(),
    named_place: text(200), cold_chain_required: z.boolean(), temperature_range: text(200).optional() }),
  payment_terms: z.literal('BANK_WIRE_TT'), bank_details: bankSchema.optional(),
  issued_at: date.optional(), valid_until: date, accepted_at: date.optional(), reservation_expires_at: date.optional(),
  reservation_status: z.enum(['NONE', 'ACTIVE', 'CONSUMED', 'RELEASED']),
  payment: z.object({ reference: text(200), amount: commercialDecimal, currency, received_at: date }).optional(),
  shipment: z.object({ courier_name: text(200), awb_tracking_number: text(200), dispatched_at: date, estimated_delivery: date.optional() }).optional(),
  delivered_at: date.optional(), created_at: date, updated_at: date,
  availability: z.object({ available: z.number().int().nonnegative().max(100), unavailable: z.number().int().nonnegative().max(100), sourcing: z.number().int().nonnegative().max(100) }),
}).superRefine((value, ctx) => {
  for (const [key, status] of [['available', 'AVAILABLE'], ['unavailable', 'UNAVAILABLE'], ['sourcing', 'SOURCING']] as const) {
    if (value.availability[key] !== value.items.filter((item) => item.availability_status === status).length) ctx.addIssue({ code: 'custom', path: ['availability', key], message: 'Invalid availability count.' });
  }
  if (value.shipping_terms.method === 'INCOTERM' && !value.shipping_terms.incoterm) ctx.addIssue({ code: 'custom', path: ['shipping_terms'], message: 'Missing Incoterm.' });
});
export type CustomerQuotation = z.infer<typeof customerQuotationSchema>;
export const acceptedStatus = (status: CustomerQuotation['status']) => ['ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED'].includes(status);
export const acceptanceSchema = customerQuotationSchema.safeExtend({ already_accepted: z.boolean() }).refine((value) => acceptedStatus(value.status) && !!value.accepted_at && !!value.reservation_expires_at);
export const revisionBody = z.strictObject({ notes: z.string().trim().min(1).max(5000) });
export const refreshBody = z.strictObject({ notes: z.string().trim().min(1).max(5000).optional() });
export const declineBody = z.strictObject({ reason: z.enum(['PRICE', 'LEAD_TIME', 'SPECIFICATION', 'OTHER']), notes: z.string().trim().min(1).max(2000).optional() });
export type Decision = { kind: 'request-revision'; body: z.infer<typeof revisionBody> } | { kind: 'request-refresh'; body: z.infer<typeof refreshBody> } | { kind: 'decline'; body: z.infer<typeof declineBody> };
export interface QuotationProblem { kind: 'expired' | 'superseded' | 'missing' | 'validation' | 'rateLimited' | 'unavailable' | 'unknown'; requestId?: string; fields: ('notes' | 'reason' | 'terms_accepted')[] }
export type QuotationInitial = { quotation: CustomerQuotation; problem: null } | { quotation: null; problem: QuotationProblem };

export function quotationProblem(error: unknown): QuotationProblem {
  if (!(error instanceof ApiError)) return { kind: 'unknown', fields: [] };
  return {
    kind: error.status === 403 && error.code === 'QUOTATION_TOKEN_EXPIRED' ? 'expired'
      : error.status === 409 && error.code === 'QUOTATION_VERSION_CONFLICT' ? 'superseded'
        : error.status === 404 ? 'missing' : error.status === 422 || error.status === 400 ? 'validation'
          : error.status === 429 ? 'rateLimited' : error.status === 503 ? 'unavailable' : 'unknown',
    requestId: /^[\w-]{1,100}$/.test(error.requestId ?? '') ? error.requestId : undefined,
    fields: error.details.flatMap((detail) => detail.field === 'notes' || detail.field === 'reason' || detail.field === 'terms_accepted' ? [detail.field] : []),
  };
}
function path(kind: string, token: string) { return `/v1/public/quotation/${kind}/${quotationToken.parse(token)}`; }
export async function readQuotation(token: string, signal?: AbortSignal): Promise<CustomerQuotation> {
  const readable = customerQuotationSchema.refine((value) => !['VALIDITY_EXPIRED', 'PAYMENT_EXPIRED', 'SUPERSEDED'].includes(value.status));
  return (await apiRequest(path('token', token), readable, { cache: 'no-store', timeoutMs: 15_000, signal })).data;
}
export function quotationPdf(token: string, signal?: AbortSignal) { return apiQuotationPdf(path('pdf', token), signal); }

export interface QuotationTransport {
  read(): Promise<CustomerQuotation>;
  accept(key: string): Promise<z.infer<typeof acceptanceSchema>>;
  decide(input: Decision): Promise<CustomerQuotation | { message_id: string } | { requested: true }>;
}
function transport(token: string): QuotationTransport {
  return {
    read: () => readQuotation(token),
    accept: async (key) => (await apiRequest(path('accept', token), acceptanceSchema, { method: 'POST', idempotencyKey: key, json: { terms_accepted: true }, timeoutMs: 20_000 })).data,
    decide: async (input) => {
      const options = { method: 'POST' as const, json: input.body, timeoutMs: 20_000 };
      if (input.kind === 'decline') return (await apiRequest(path(input.kind, token), customerQuotationSchema, options)).data;
      if (input.kind === 'request-revision') return (await apiRequest(path(input.kind, token), z.object({ message_id: z.uuidv4() }), options)).data;
      return (await apiRequest(path(input.kind, token), z.object({ requested: z.literal(true) }), options)).data;
    },
  };
}
export interface QuotationState {
  quotation: CustomerQuotation | null; problem: QuotationProblem | null;
  busy: boolean; pending: 'accept' | Decision['kind'] | null;
  notice: 'accepted' | 'alreadyAccepted' | 'revisionSent' | 'refreshSent' | 'declined' | 'acceptUncertain' | 'decisionUncertain' | null;
}
/** No localStorage, public providers or logs; all buyer actions are memory-only. */
export class QuotationSession {
  private state: QuotationState;
  private listeners = new Set<() => void>();
  private lock = false;
  private acceptanceKey?: string;
  private readonly api: QuotationTransport;
  constructor(token: string, initial: QuotationInitial, api?: QuotationTransport) { this.api = api ?? transport(token); this.state = { ...initial, busy: false, pending: null, notice: null }; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<QuotationState>) { this.state = { ...this.state, ...change }; this.listeners.forEach((listener) => listener()); }
  private fail(error: unknown) {
    const problem = quotationProblem(error);
    const terminal = ['expired', 'superseded', 'missing'].includes(problem.kind);
    // A refresh failure does not make the known expired document available.
    // Retaining that view also keeps the mounted refresh form and its notes.
    if (!terminal && !this.state.quotation && this.state.problem?.kind === 'expired' && this.state.pending === 'request-refresh') problem.kind = 'expired';
    this.update({ problem, ...(terminal ? { quotation: null } : {}), ...(terminal && this.state.pending === 'accept' ? { pending: null } : {}) });
  }
  private async inspect() {
    try {
      const quotation = customerQuotationSchema.parse(await this.api.read());
      if (this.state.pending === 'accept' && acceptedStatus(quotation.status)) this.update({ quotation, problem: null, pending: null, notice: 'alreadyAccepted' });
      else if (this.state.pending === 'decline' && quotation.status === 'DECLINED') this.update({ quotation, problem: null, pending: null, notice: 'declined' });
      else this.update({ quotation, problem: this.state.pending ? this.state.problem : null });
    } catch (error: unknown) { this.fail(error); }
  }
  async reload(): Promise<void> {
    if (this.lock) return;
    this.lock = true; this.update({ busy: true });
    try { await this.inspect(); } finally { this.lock = false; this.update({ busy: false }); }
  }
  async accept(termsAccepted: boolean): Promise<void> {
    if (this.lock || !termsAccepted || this.state.quotation?.status !== 'SENT' || this.state.pending && this.state.pending !== 'accept') return;
    this.lock = true; this.acceptanceKey ??= crypto.randomUUID();
    this.update({ busy: true, pending: 'accept', problem: null, notice: null });
    try {
      const result = acceptanceSchema.parse(await this.api.accept(this.acceptanceKey));
      this.update({ quotation: customerQuotationSchema.parse(result), problem: null, pending: null, notice: result.already_accepted ? 'alreadyAccepted' : 'accepted' });
    } catch (error: unknown) {
      this.fail(error);
      if (error instanceof ApiError && error.responseValidated && [400, 422].includes(error.status)) { this.update({ pending: null }); return; }
      if (this.state.pending === 'accept') {
        this.update({ notice: 'acceptUncertain' });
        await this.inspect(); // A lost/failed response may already have committed.
      }
    } finally { this.lock = false; this.update({ busy: false }); }
  }
  async decide(input: Decision): Promise<void> {
    if (this.lock || this.state.pending || this.state.notice === 'revisionSent' && input.kind === 'request-revision' || this.state.notice === 'refreshSent' && input.kind === 'request-refresh') return;
    if (input.kind === 'request-refresh' ? this.state.problem?.kind !== 'expired' : this.state.quotation?.status !== 'SENT') return;
    const validated: Decision = input.kind === 'decline' ? { kind: input.kind, body: declineBody.parse(input.body) }
      : input.kind === 'request-revision' ? { kind: input.kind, body: revisionBody.parse(input.body) } : { kind: input.kind, body: refreshBody.parse(input.body) };
    this.lock = true; this.update({ busy: true, pending: input.kind, notice: null });
    try {
      // No idempotency contract for these decisions: never automatically POST again.
      const result = await this.api.decide(validated);
      if (input.kind === 'decline') {
        const quotation = customerQuotationSchema.parse(result);
        if (quotation.status !== 'DECLINED') throw new Error('Unconfirmed decline response.');
        this.update({ quotation, problem: null, pending: null, notice: 'declined' });
      }
      else if (input.kind === 'request-revision') { z.object({ message_id: z.uuidv4() }).parse(result); this.update({ pending: null, notice: 'revisionSent' }); }
      else { z.object({ requested: z.literal(true) }).parse(result); this.update({ pending: null, notice: 'refreshSent' }); }
    } catch (error: unknown) {
      const definite = error instanceof ApiError && error.responseValidated && [400, 403, 404, 409, 422].includes(error.status);
      this.fail(error);
      if (definite) this.update({ pending: null });
      else this.update({ notice: 'decisionUncertain' });
      if (definite && [400, 422].includes(error.status)) return;
      await this.inspect(); // Read-only; revision/refresh receipts are not exposed by GET.
    } finally { this.lock = false; this.update({ busy: false }); }
  }
}
