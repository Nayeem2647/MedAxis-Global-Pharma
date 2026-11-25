import { z } from 'zod';
import { ApiError, apiRequest } from './api-client';
import type { CartItem } from './cart';

// ISO 3166-1 alpha-2 public country codes; no private settings read is needed.
export const countryCodes = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const quantity = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const unit = z.string().trim().min(1).max(40);
const commonLine = { quantity, packaging_unit: unit, line_notes: optionalText(2000) };
export const rfqLineSchema = z.discriminatedUnion('is_uncatalogued', [
  z.strictObject({ ...commonLine, is_uncatalogued: z.literal(false), product_id: z.uuidv4() }),
  z.strictObject({ ...commonLine, is_uncatalogued: z.literal(true), custom_medicine_name: z.string().trim().min(1).max(200), custom_strength: optionalText(100) }),
]);
export const rfqBusinessSchema = z.strictObject({
  contact: z.strictObject({
    full_name: z.string().trim().min(1).max(200), customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']),
    company_name: optionalText(200), email: z.email().max(200).transform((value) => value.toLowerCase()),
    whatsapp_number: optionalText(50), wechat_id: optionalText(100), preferred_locale: z.enum(['en', 'zh-CN']),
  }),
  destination_country: z.string().trim().toUpperCase().refine((value) => countryCodes.has(value)),
  destination_city_port: optionalText(200), preferred_currency: z.enum(['USD', 'EUR', 'CNY', 'BDT']).optional(),
  locale: z.enum(['en', 'zh-CN']), items: z.array(rfqLineSchema).min(1).max(100),
  prescription_ids: z.array(z.uuidv4()).max(5).refine((ids) => new Set(ids).size === ids.length),
}).superRefine((value, context) => {
  if (value.contact.customer_type === 'B2B_WHOLESALE' && !value.contact.company_name) context.addIssue({ code: 'custom', path: ['contact', 'company_name'], message: 'Company is required.' });
  if (!value.contact.email && !value.contact.whatsapp_number && !value.contact.wechat_id) context.addIssue({ code: 'custom', path: ['contact', 'email'], message: 'A contact channel is required.' });
  if ((value.locale === 'zh-CN' || value.contact.preferred_locale === 'zh-CN' || value.destination_country === 'CN') && !value.contact.email) context.addIssue({ code: 'custom', path: ['contact', 'email'], message: 'Email is required.' });
});
export type RfqBusiness = z.infer<typeof rfqBusinessSchema>;
export type RfqLine = z.infer<typeof rfqLineSchema>;
export type RfqKind = 'quick-quote' | 'cart';
export type RfqPayload = RfqBusiness & { idempotency_key: string; turnstile_token: string };
export const rfqReceiptSchema = z.object({
  rfq_id: z.uuidv4(), rfq_number: z.string().regex(/^RFQ-[A-Z0-9-]+$/).max(100),
  status: z.literal('SUBMITTED'), created_at: z.iso.datetime(), total_items: z.number().int().positive().max(100),
});
export type RfqReceipt = z.infer<typeof rfqReceiptSchema>;

export function cartLine(item: CartItem, notes?: string): RfqLine {
  return rfqLineSchema.parse({ quantity: item.quantity, packaging_unit: item.packagingUnit,
    ...(notes?.trim() ? { line_notes: notes.trim() } : {}),
    ...(item.kind === 'catalog' ? { is_uncatalogued: false, product_id: item.productId }
      : { is_uncatalogued: true, custom_medicine_name: item.name, ...(item.strength ? { custom_strength: item.strength } : {}) }),
  });
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export interface RfqSubmissionState {
  status: 'idle' | 'submitting' | 'invalid' | 'challenge' | 'uncertain' | 'conflict' | 'success';
  error?: ApiError; receipt?: RfqReceipt; key?: string;
}
type Send = (kind: RfqKind, payload: RfqPayload) => Promise<RfqReceipt>;
async function send(kind: RfqKind, payload: RfqPayload): Promise<RfqReceipt> {
  const response = await apiRequest(`/v1/public/rfq/${kind}`, rfqReceiptSchema, {
    method: 'POST', json: payload, idempotencyKey: payload.idempotency_key,
    prescriptionSession: payload.prescription_ids.length > 0, successStatuses: [200, 201], timeoutMs: 20_000,
  });
  return response.data;
}

/** Memory-only transaction state. A frozen intent survives errors, not page reloads. */
export class RfqSubmission {
  private state: RfqSubmissionState = { status: 'idle' };
  private listeners = new Set<() => void>();
  private intent: { kind: RfqKind; payload: RfqPayload; started: number; uncertain: boolean } | null = null;
  private inFlight = false;
  constructor(private readonly transport: Send = send, private readonly now = Date.now) {}
  getSnapshot = (): RfqSubmissionState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: RfqSubmissionState) { this.state = state; this.listeners.forEach((listener) => listener()); }
  get locked(): boolean { return this.intent !== null && this.state.status !== 'success'; }
  reset(): boolean {
    if (this.locked || this.inFlight) return false;
    this.intent = null; this.publish({ status: 'idle' }); return true;
  }
  async submit(business: RfqBusiness, token: string, kind: RfqKind): Promise<RfqReceipt | null> {
    if (this.intent || this.inFlight) return null;
    const parsed = rfqBusinessSchema.parse(business);
    if (kind === 'quick-quote' && parsed.items.length !== 1) throw new Error('Quick Quote requires one line.');
    if (!token.trim() || token.length > 2048) throw new Error('A Turnstile challenge is required.');
    this.intent = { kind, payload: freeze({ ...parsed, idempotency_key: crypto.randomUUID(), turnstile_token: token }), started: this.now(), uncertain: false };
    return this.run();
  }
  async reconcile(refreshedToken?: string): Promise<RfqReceipt | null> {
    if (!this.intent || this.inFlight || this.state.status === 'success') return null;
    // The server expires keys after 24h. Replaying later could create a second RFQ.
    if (this.now() - this.intent.started >= 24 * 60 * 60 * 1000) {
      this.publish({ status: 'conflict', key: this.intent.payload.idempotency_key, error: new ApiError('Please contact the sourcing team to reconcile this enquiry.', { status: 409, code: 'INTENT_EXPIRED' }) }); return null;
    }
    if (this.state.status === 'challenge') {
      if (!refreshedToken?.trim() || refreshedToken.length > 2048) return null;
      this.intent.payload = freeze({ ...this.intent.payload, turnstile_token: refreshedToken });
    }
    return this.run();
  }
  private async run(): Promise<RfqReceipt | null> {
    const intent = this.intent;
    if (!intent || this.inFlight) return null;
    this.inFlight = true;
    this.publish({ status: 'submitting', key: intent.payload.idempotency_key });
    try {
      const receipt = rfqReceiptSchema.parse(await this.transport(intent.kind, intent.payload));
      if (receipt.total_items !== intent.payload.items.length) throw new Error('Invalid enquiry item count.');
      this.publish({ status: 'success', receipt, key: intent.payload.idempotency_key });
      this.intent = null;
      return receipt;
    } catch (cause: unknown) {
      const error = cause instanceof ApiError ? cause : new ApiError('The enquiry outcome could not be confirmed.', { status: 0, code: 'NETWORK_ERROR', cause });
      const status = error.status === 403 ? 'challenge' : error.status === 409 ? 'conflict'
        : (error.status === 400 || error.status === 422) && error.responseValidated && !intent.uncertain ? 'invalid' : 'uncertain';
      if (status === 'uncertain' || status === 'conflict') intent.uncertain = true;
      if (status === 'invalid') this.intent = null; // A validated rejection did not commit an enquiry.
      this.publish({ status, error, key: intent.payload.idempotency_key });
      return null;
    } finally { this.inFlight = false; }
  }
}
