import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { RfqSubmission, cartLine, rfqBusinessSchema, rfqLineSchema, rfqReceiptSchema, type RfqBusiness, type RfqPayload } from '../../lib/rfq';
import { MAX_PRESCRIPTION_BYTES, uploadPrescription, validatePrescription } from '../../lib/prescription-upload';
import { meta } from '../fixtures';

const id = '82f591d0-346b-4cc4-8d67-e25358fa0272';
const receipt = { rfq_id: id, rfq_number: 'RFQ-2026-00001', status: 'SUBMITTED' as const, created_at: meta.timestamp, total_items: 1 };
const business = (): RfqBusiness => ({
  contact: { full_name: 'Buyer', customer_type: 'B2C_PATIENT', email: 'buyer@example.test', whatsapp_number: '+8801560066410', preferred_locale: 'en' },
  destination_country: 'BD', locale: 'en', items: [{ is_uncatalogued: true, custom_medicine_name: 'Medicine', quantity: 1, packaging_unit: 'BOX' }], prescription_ids: [],
});
const failed = (status: number, code = 'FAILURE') => new ApiError('Private proxy / server text must not be rendered.', { status, code, responseValidated: true });
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test'); vi.stubEnv('API_INTERNAL_BASE_URL', ''); });
afterEach(() => vi.useRealTimers());

describe('RFQ transport validation', () => {
  it('accepts nested patient/wholesale input and no optional attachments', () => {
    expect(rfqBusinessSchema.parse(business()).prescription_ids).toEqual([]);
    expect(rfqBusinessSchema.parse({ ...business(), destination_country: ' cn ', contact: { ...business().contact, company_name: 'Company', customer_type: 'B2B_WHOLESALE', email: 'BUYER@example.test' } })).toMatchObject({ destination_country: 'CN', contact: { email: 'buyer@example.test' } });
  });
  it.each([
    { contact: { full_name: 'Buyer', customer_type: 'B2B_WHOLESALE', email: 'buyer@example.test', preferred_locale: 'en' } },
    { contact: { full_name: 'Buyer', customer_type: 'B2C_PATIENT', preferred_locale: 'en' } },
    { contact: { ...business().contact, email: 'not-an-email' } },
    { contact: { ...business().contact, email: undefined } },
    { locale: 'zh-CN', contact: { ...business().contact, email: undefined } },
    { destination_country: 'CN', contact: { ...business().contact, email: undefined } },
    { destination_country: 'ZZ' }, { destination_country: 'CHN' }, { items: [] },
    { items: Array.from({ length: 101 }, () => business().items[0]) },
    { prescription_ids: Array.from({ length: 6 }, () => crypto.randomUUID()) }, { prescription_ids: [id, id] },
    { notes: 'Unsupported root field' }, { unit_price: 'Never send internal fields' },
  ])('rejects invalid or unsupported business fields %j', (patch) => {
    expect(rfqBusinessSchema.safeParse({ ...business(), ...patch }).success).toBe(false);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects unsafe quantity %s', (quantity) => {
    expect(rfqLineSchema.safeParse({ ...business().items[0], quantity }).success).toBe(false);
  });
  it('projects catalog and custom lines without fake IDs or root notes', () => {
    expect(cartLine({ kind: 'catalog', id: `${id}:BOX`, productId: id, name: 'Medicine', strength: '80mg', packagingUnit: 'BOX', quantity: 2 }, 'Line note')).toEqual({ is_uncatalogued: false, product_id: id, quantity: 2, packaging_unit: 'BOX', line_notes: 'Line note' });
    const custom = cartLine({ kind: 'custom', id, name: 'Uncatalogued', strength: '', quantity: 1, packagingUnit: 'BOX' });
    expect(custom).not.toHaveProperty('product_id');
    expect(rfqLineSchema.safeParse({ ...custom, product_id: id }).success).toBe(false);
    expect(rfqLineSchema.safeParse({ is_uncatalogued: false, quantity: 1, packaging_unit: 'BOX' }).success).toBe(false);
  });
  it('allowlists the confirmation and never consumes customer/internal data', () => {
    expect(rfqReceiptSchema.parse({ ...receipt, customer: { full_name: 'Private' }, price: 'USD 999', internal_notes: 'Private' })).toEqual(receipt);
  });
});

describe('memory-only RFQ submission intent', () => {
  it('locks synchronously against double submits and freezes the business snapshot', async () => {
    let finish: ((value: typeof receipt) => void) | undefined;
    const transport = vi.fn((kind: string, payload: RfqPayload) => {
      expect(kind).toBe('quick-quote'); expect(payload.contact.full_name).toBe('Buyer');
      return new Promise<typeof receipt>((resolve) => { finish = resolve; });
    });
    const submission = new RfqSubmission(transport);
    const draft = business();
    const pending = submission.submit(draft, 'first-token', 'quick-quote');
    draft.contact.full_name = 'Changed'; draft.items[0]!.quantity = 3;
    expect(submission.locked).toBe(true);
    expect(await submission.submit(draft, 'other-token', 'quick-quote')).toBeNull();
    expect(await submission.reconcile()).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
    const sent = transport.mock.calls[0];
    expect(sent?.[1].contact.full_name).toBe('Buyer'); expect(sent?.[1].items[0]?.quantity).toBe(1);
    finish?.(receipt); await pending;
    expect(submission.getSnapshot().status).toBe('success');
  });
  it.each([0, 429, 500, 503, 200])('retains exact key/body after uncertain status %s', async (status) => {
    const bodies: string[] = [];
    const transport = vi.fn(async (_kind: string, payload: RfqPayload) => { bodies.push(JSON.stringify(payload)); if (bodies.length === 1) throw failed(status); return receipt; });
    const submission = new RfqSubmission(transport);
    await submission.submit(business(), 'captured-token', 'quick-quote');
    expect(submission.getSnapshot().status).toBe('uncertain'); expect(submission.reset()).toBe(false);
    await submission.submit(business(), 'unrelated-token', 'quick-quote');
    await submission.reconcile('ignored-token');
    expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
    const firstKey = submission.getSnapshot().key;
    await submission.submit(business(), 'fresh-token', 'quick-quote');
    expect(submission.getSnapshot().key).not.toBe(firstKey);
  });
  it('refreshes only the challenge after 403, preserving key and business', async () => {
    const payloads: RfqPayload[] = [];
    const submission = new RfqSubmission(async (_kind, payload) => { payloads.push(payload); if (payloads.length === 1) throw failed(403); return receipt; });
    await submission.submit(business(), 'expired-token', 'quick-quote');
    expect(submission.getSnapshot().status).toBe('challenge');
    expect(await submission.reconcile()).toBeNull();
    await submission.reconcile('refreshed-token');
    expect(payloads[1]).toEqual({ ...payloads[0], turnstile_token: 'refreshed-token' });
    expect(Object.isFrozen(payloads[0]?.contact)).toBe(true);
  });
  it('keeps 409 conflicts locked and never creates a new intent automatically', async () => {
    const transport = vi.fn(async () => { throw failed(409, 'IDEMPOTENCY_KEY_CONFLICT'); });
    const submission = new RfqSubmission(transport);
    await submission.submit(business(), 'token', 'cart');
    const key = submission.getSnapshot().key;
    expect(submission.reset()).toBe(false);
    await submission.submit(business(), 'token', 'cart');
    expect(transport).toHaveBeenCalledTimes(1);
    await submission.reconcile(); expect(submission.getSnapshot().key).toBe(key);
  });
  it('refuses replay after the backend key TTL instead of risking another enquiry', async () => {
    let now = 0;
    const transport = vi.fn(async () => { throw failed(503); });
    const submission = new RfqSubmission(transport, () => now);
    await submission.submit(business(), 'token', 'cart'); now += 86_400_000;
    await submission.reconcile();
    expect(transport).toHaveBeenCalledTimes(1); expect(submission.getSnapshot().error?.code).toBe('INTENT_EXPIRED'); expect(submission.reset()).toBe(false);
  });
  it('allows corrected input after a definite 422 rejection', async () => {
    const transport = vi.fn(async () => { throw failed(422); });
    const submission = new RfqSubmission(transport);
    await submission.submit(business(), 'token', 'cart'); const key = submission.getSnapshot().key;
    expect(submission.locked).toBe(false);
    await submission.submit(business(), 'new-token', 'cart'); expect(submission.getSnapshot().key).not.toBe(key);
  });
  it('does not interpret a later validation error or proxy HTML as reconciliation of an uncertain write', async () => {
    const submission = new RfqSubmission(vi.fn().mockRejectedValueOnce(failed(503)).mockRejectedValueOnce(failed(422)));
    await submission.submit(business(), 'token', 'cart'); await submission.reconcile();
    expect(submission.getSnapshot().status).toBe('uncertain'); expect(submission.reset()).toBe(false);
    const proxy = new RfqSubmission(async () => { throw new ApiError('Sanitized proxy error.', { status: 422, code: 'VALIDATION_FAILED' }); });
    await proxy.submit(business(), 'token', 'cart'); expect(proxy.locked).toBe(true);
  });
  it('rejects multiple Quick Quote lines and blank challenges before sending', async () => {
    const submission = new RfqSubmission();
    await expect(submission.submit({ ...business(), items: [business().items[0]!, business().items[0]!] }, 'token', 'quick-quote')).rejects.toThrow('one line');
    await expect(submission.submit(business(), '', 'cart')).rejects.toThrow('challenge');
  });
  it('replays identical serialized JSON/header through 429 Retry-After, then reconciles without bot-token churn', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('proxy', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(Response.json({ success: true, data: receipt, meta }, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const submission = new RfqSubmission();
    const pending = submission.submit(business(), 'captured-token', 'quick-quote');
    await vi.advanceTimersByTimeAsync(2999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync(); expect(await pending).toEqual(receipt);
    const bodies = fetcher.mock.calls.map(([, init]) => init?.body);
    expect(new Set(bodies).size).toBe(1);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.credentials).toBe('omit'); expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('x-idempotency-key')).toBe(submission.getSnapshot().key);
      expect(init?.body).toContain(`"idempotency_key":"${submission.getSnapshot().key}"`);
    }
  });
  it('sends staging credentials narrowly for RFQ attachments', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: receipt, meta }, { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    await new RfqSubmission().submit({ ...business(), prescription_ids: [id] }, 'token', 'cart');
    expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
  });
});

describe('private prescription upload', () => {
  const pdf = () => new File(['%PDF-1.7\nprivate'], 'prescription.pdf', { type: 'application/pdf' });
  it('accepts actual supported signatures and rejects empty/oversized/spoofed files', async () => {
    await expect(validatePrescription(pdf())).resolves.toBeUndefined();
    await expect(validatePrescription(new File([new Uint8Array([255, 216, 255, 224])], 'photo.jpg', { type: 'image/jpeg' }))).resolves.toBeUndefined();
    await expect(validatePrescription(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'scan.png', { type: 'image/png' }))).resolves.toBeUndefined();
    await expect(validatePrescription(new File([], 'empty.pdf', { type: 'application/pdf' }))).rejects.toMatchObject({ code: 'FILE_SIZE' });
    await expect(validatePrescription(new File([new Uint8Array(MAX_PRESCRIPTION_BYTES + 1)], 'big.pdf', { type: 'application/pdf' }))).rejects.toMatchObject({ code: 'FILE_SIZE' });
    await expect(validatePrescription(new File(['%PDF-1.7'], 'spoof.png', { type: 'image/png' }))).rejects.toMatchObject({ code: 'INVALID_PRESCRIPTION_FILE' });
  });
  class Xhr {
    static instance: Xhr;
    withCredentials = false; timeout = 0; status = 201; responseText = '';
    onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
    upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    open = vi.fn(); setRequestHeader = vi.fn(); send = vi.fn(); abort = vi.fn(() => this.onabort?.());
    getResponseHeader = vi.fn((name: string): string => name === 'content-type' ? 'application/json' : 'proxy-request-id');
    constructor() { Xhr.instance = this; }
  }
  it('owns no multipart boundary, includes cookies, reports progress and validates the receipt', async () => {
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const progress = vi.fn();
    const pending = uploadPrescription(pdf(), 'challenge', new AbortController().signal, progress);
    const xhr = Xhr.instance;
    expect(xhr.withCredentials).toBe(true); expect(xhr.timeout).toBe(60_000);
    expect(xhr.setRequestHeader.mock.calls).toEqual([['Accept', 'application/json']]);
    const form: unknown = xhr.send.mock.calls[0]?.[0];
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error('Expected multipart form');
    expect([...form.keys()]).toEqual(['prescription', 'turnstile_token']); expect(form.get('turnstile_token')).toBe('challenge');
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); expect(progress).toHaveBeenCalledWith(50);
    xhr.responseText = JSON.stringify({ success: true, data: { prescription_id: id, mime_type: 'application/pdf', file_size_bytes: 16, uploaded_at: meta.timestamp, private_url: 'NEVER_EXPOSE' }, meta });
    xhr.onload?.();
    expect(await pending).toEqual({ prescription_id: id, mime_type: 'application/pdf', file_size_bytes: 16, uploaded_at: meta.timestamp });
  });
  it.each(['html', 'malformed'])('sanitizes %s without an upload retry', async (kind) => {
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const pending = uploadPrescription(pdf(), 'token', new AbortController().signal, () => undefined);
    const xhr = Xhr.instance;
    xhr.status = 503; xhr.responseText = '<html>PRIVATE_PROXY_SECRET</html>';
    xhr.getResponseHeader.mockImplementation((name) => name === 'content-type' ? (kind === 'html' ? 'text/html' : 'application/json') : 'proxy-request-id');
    xhr.onload?.();
    await expect(pending).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', requestId: 'proxy-request-id' });
    expect(xhr.send).toHaveBeenCalledTimes(1);
  });
  it('aborts without retrying', async () => {
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const controller = new AbortController();
    const pending = uploadPrescription(pdf(), 'token', controller.signal, () => undefined);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(Xhr.instance.abort).toHaveBeenCalledTimes(1); expect(Xhr.instance.send).toHaveBeenCalledTimes(1);
  });
  it('rejects an empty unexpected status instead of throwing out of the XHR handler', async () => {
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const pending = uploadPrescription(pdf(), 'token', new AbortController().signal, () => undefined);
    Xhr.instance.status = 204; Xhr.instance.onload?.();
    await expect(pending).rejects.toMatchObject({ status: 204, code: 'INVALID_API_RESPONSE' });
  });
});
