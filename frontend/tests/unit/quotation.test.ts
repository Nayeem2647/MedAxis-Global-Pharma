import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../lib/api-client';
import { QuotationSession, acceptanceSchema, commercialDecimal, customerQuotationSchema, quotationPdf, quotationProblem, readQuotation, type CustomerQuotation, type QuotationTransport } from '../../lib/quotation';
import { meta } from '../fixtures';

const token = 'a'.repeat(64);
const id = '82f591d0-346b-4cc4-8d67-e25358fa0272';
function raw() {
  return { id, quotation_id: id, version_number: 3, status: 'SENT',
    contact: { full_name: 'Private buyer', customer_type: 'B2C_PATIENT', email: 'buyer@example.test', preferred_locale: 'zh-CN' },
    items: [{ id, rfq_item_id: id, manufacturer_id: id, brand_name: 'Medicine', generic_name: 'Ingredient', strength: '10mg', dosage_form: 'Tablet', pack_size: '10 tablets', packaging_unit: 'BOX', quantity: 1, availability_status: 'AVAILABLE', unit_quoted_price: '9007199254740993.21', total_line_price: '9007199254740993.21' }],
    billing_currency: 'USD', subtotal_amount: '9007199254740993.21', freight_cost: '0.00', insurance_cost: '1E-8', total_amount: '9007199254740993.21000001',
    shipping_terms: { method: 'EXPRESS_COURIER', named_place: 'Beijing', cold_chain_required: false }, payment_terms: 'BANK_WIRE_TT',
    bank_details: { configured: true, instructions: 'Wire instructions', beneficiary_name: 'Beneficiary', bank_name: 'Bank', account_number: 'PRIVATE-ACCOUNT', swift_code: 'SWIFT' },
    valid_until: '2030-11-22T10:00:00.000Z', reservation_status: 'NONE', created_at: meta.timestamp, updated_at: meta.timestamp, availability: { available: 1, unavailable: 0, sourcing: 0 },
  };
}
const quote = (): CustomerQuotation => customerQuotationSchema.parse(raw());
const accepted = () => customerQuotationSchema.parse({ ...raw(), status: 'ACCEPTED', accepted_at: '2026-11-16T10:00:00.000Z', reservation_expires_at: '2026-11-21T10:00:00.000Z', reservation_status: 'ACTIVE' });
const failure = (status: number, code = 'INTERNAL_SERVER_ERROR') => new ApiError('PRIVATE_SERVER_MESSAGE', { status, code, responseValidated: true, requestId: meta.request_id });
function api(overrides: Partial<QuotationTransport> = {}): QuotationTransport { return { read: async () => quote(), accept: async () => ({ ...accepted(), already_accepted: false }), decide: async () => ({ message_id: id }), ...overrides }; }
function json(data: unknown) { return Response.json({ success: true, data, meta }); }
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test'); vi.stubEnv('API_INTERNAL_BASE_URL', ''); });
afterEach(() => vi.useRealTimers());

describe('authorized customer quotation boundary', () => {
  it('preserves exact server decimal strings and removes nested internal fields', () => {
    const input = raw();
    const parsed = customerQuotationSchema.parse({ ...input, quotation_number: 'NEVER_INVENT', procurement_cost_bdt: 'NEVER_RENDER_PRIVATE', locked_fx_rate_usd: 'NEVER_RENDER_PRIVATE', magic_link_token_hash: 'NEVER_RENDER_PRIVATE',
      contact: { ...input.contact, internal_notes: 'NEVER_RENDER_PRIVATE' }, bank_details: { ...input.bank_details, admin_note: 'NEVER_RENDER_PRIVATE' }, items: input.items.map((item) => ({ ...item, markup_percent: 'NEVER_RENDER_PRIVATE' })) });
    expect(parsed.total_amount).toBe('9007199254740993.21000001'); expect(parsed.insurance_cost).toBe('1E-8'); expect(parsed.bank_details?.account_number).toBe('PRIVATE-ACCOUNT'); expect(JSON.stringify(parsed)).not.toMatch(/NEVER_RENDER_PRIVATE|NEVER_INVENT|markup_percent|locked_fx|token_hash|quotation_number/);
  });
  it('discards non-payable money instead of making offers out of unavailable/sourcing rows', () => {
    const input = raw();
    const items = ['UNAVAILABLE', 'SOURCING'].map((availability_status) => ({ ...input.items[0], availability_status, unit_quoted_price: 'PRIVATE_NONPAYABLE', total_line_price: 'PRIVATE_NONPAYABLE' }));
    const parsed = customerQuotationSchema.parse({ ...input, items, availability: { available: 0, unavailable: 1, sourcing: 1 } });
    expect(JSON.stringify(parsed.items)).not.toMatch(/unit_quoted_price|total_line_price|PRIVATE_NONPAYABLE/);
  });
  it('re-serializes a network JSON envelope without internal data while keeping actual customer prices', async () => {
    const input = raw();
    const internal = { procurement_unit_cost_bdt: 'NEVER_RENDER', gross_margin_bdt: 'NEVER_RENDER', effective_gross_margin_percent: 'NEVER_RENDER', locked_fx_rate_usd: 'NEVER_RENDER', internal_procurement_notes: 'NEVER_RENDER', magic_link_token_hash: 'NEVER_RENDER' };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, meta: { ...meta, ...internal }, data: { ...input, ...internal,
      contact: { ...input.contact, ...internal }, shipping_terms: { ...input.shipping_terms, internal_cost_data: internal }, bank_details: { ...input.bank_details, ...internal }, items: input.items.map((item) => ({ ...item, ...internal })) } })));
    const envelope = await apiRequest(`/v1/public/quotation/token/${token}`, customerQuotationSchema);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toMatch(/NEVER_RENDER|procurement_unit_cost|gross_margin|locked_fx|internal_procurement|internal_cost_data|token_hash/);
    expect(envelope.data.total_amount).toBe('9007199254740993.21000001'); expect(envelope.data.items[0]).toHaveProperty('unit_quoted_price', '9007199254740993.21');
    expect(envelope.data.bank_details?.account_number).toBe('PRIVATE-ACCOUNT');
  });
  it.each([12.34, '-1.00', 'NaN', 'Infinity', '1,000.00', 'USD 1.20', ''])('rejects non-contract amounts %j', (amount) => {
    expect(commercialDecimal.safeParse(amount).success).toBe(false);
  });
  it('rejects draft/admin DTOs, inconsistent counts and malformed bank instructions', () => {
    expect(customerQuotationSchema.safeParse({ ...raw(), status: 'DRAFT' }).success).toBe(false);
    expect(customerQuotationSchema.safeParse({ ...raw(), availability: { available: 2, unavailable: 0, sourcing: 0 } }).success).toBe(false);
    expect(customerQuotationSchema.safeParse({ ...raw(), bank_details: { configured: false } }).success).toBe(false);
    expect(acceptanceSchema.safeParse({ ...raw(), already_accepted: false }).success).toBe(false);
  });
  it('forces no-store, no-referrer and anonymous credentials even if a caller requests caching', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(raw())); vi.stubGlobal('fetch', fetcher);
    await apiRequest(`/v1/public/quotation/token/${token}`, customerQuotationSchema, { cache: 'force-cache', next: { tags: ['catalog'] } });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('next');
  });
  it('validates tokens before any fetch and rejects unexpected expired commercial documents', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ ...raw(), status: 'VALIDITY_EXPIRED' })); vi.stubGlobal('fetch', fetcher);
    await expect(readQuotation('invalid')).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    await expect(readQuotation(token)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });
  it('projects only safe error categories and relevant field names', () => {
    const error = new ApiError('PRIVATE_FAILURE', { status: 422, code: 'PRIVATE_CODE', details: [{ field: 'notes', issue: 'PRIVATE_MEDICAL_TEXT' }, { field: 'procurement_cost_bdt', issue: 'PRIVATE' }], requestId: 'unsafe <html>' });
    expect(quotationProblem(error)).toEqual({ kind: 'validation', fields: ['notes'], requestId: undefined });
  });
});

describe('atomic acceptance and read-only reconciliation', () => {
  it('requires terms and synchronously suppresses double clicks', async () => {
    let finish: ((value: ReturnType<typeof accepted> & { already_accepted: boolean }) => void) | undefined;
    const accept = vi.fn((key: string) => { expect(key).toMatch(/^[a-f0-9-]{36}$/); return new Promise<ReturnType<typeof accepted> & { already_accepted: boolean }>((resolve) => { finish = resolve; }); });
    const session = new QuotationSession(token, { quotation: quote(), problem: null }, api({ accept }));
    await session.accept(false); expect(accept).not.toHaveBeenCalled();
    const pending = session.accept(true); await session.accept(true); expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0]?.[0]).toMatch(/^[a-f0-9-]{36}$/);
    finish?.({ ...accepted(), already_accepted: false }); await pending;
    expect(session.getSnapshot()).toMatchObject({ pending: null, notice: 'accepted', quotation: { status: 'ACCEPTED' } });
  });
  it('reconciles a lost committed acceptance without calling it failed', async () => {
    const read = vi.fn(async () => accepted());
    const session = new QuotationSession(token, { quotation: quote(), problem: null }, api({ accept: async () => { throw failure(0); }, read }));
    await session.accept(true); expect(read).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({ pending: null, notice: 'alreadyAccepted', quotation: { status: 'ACCEPTED' } });
  });
  it('keeps the same header key and exact terms body across 500 retries and a later manual retry', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes('/accept/')) {
        attempts++;
        if (attempts <= 4) return Response.json({ success: false, error: { status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'PRIVATE_FAILURE' }, meta }, { status: 500, headers: { 'Retry-After': '0' } });
        return json({ ...accepted(), already_accepted: false });
      }
      return json(raw());
    }); vi.stubGlobal('fetch', fetcher);
    const session = new QuotationSession(token, { quotation: quote(), problem: null });
    const first = session.accept(true); await vi.runAllTimersAsync(); await first;
    expect(session.getSnapshot()).toMatchObject({ busy: false, pending: 'accept', notice: 'acceptUncertain' });
    await session.accept(true);
    const writes = fetcher.mock.calls.filter(([url]) => String(url).includes('/accept/'));
    expect(writes).toHaveLength(5); expect(new Set(writes.map(([, init]) => new Headers(init?.headers).get('x-idempotency-key'))).size).toBe(1);
    for (const [, init] of writes) expect(init?.body).toBe('{"terms_accepted":true}');
    expect(session.getSnapshot().notice).toBe('accepted');
  });
  it.each([['QUOTATION_TOKEN_EXPIRED', 403, 'expired'], ['QUOTATION_VERSION_CONFLICT', 409, 'superseded']] as const)('clears stale commercial content for %s', async (code, status, kind) => {
    const session = new QuotationSession(token, { quotation: quote(), problem: null }, api({ accept: async () => { throw failure(status, code); } }));
    await session.accept(true); expect(session.getSnapshot()).toMatchObject({ quotation: null, pending: null, problem: { kind } });
  });
  it('retains the exact server reservation deadline across reloads and clock changes', async () => {
    vi.useFakeTimers(); const session = new QuotationSession(token, { quotation: accepted(), problem: null }, api({ read: async () => accepted() }));
    vi.setSystemTime(new Date('2031-01-01')); await session.reload();
    expect(session.getSnapshot().quotation?.reservation_expires_at).toBe('2026-11-21T10:00:00.000Z');
  });
});

describe('non-idempotent decisions', () => {
  it('does not replay an uncertain revision, and GET cannot invent a receipt', async () => {
    const decide = vi.fn(async () => { throw failure(0); });
    const session = new QuotationSession(token, { quotation: quote(), problem: null }, api({ decide }));
    const input = { kind: 'request-revision' as const, body: { notes: 'Please revise.' } };
    await session.decide(input); await session.reload(); await session.decide(input); await session.accept(true);
    expect(decide).toHaveBeenCalledTimes(1); expect(session.getSnapshot()).toMatchObject({ pending: 'request-revision', notice: 'decisionUncertain' });
  });
  it('retains validated 422 fields without erasing them through an unrelated GET', async () => {
    const read = vi.fn(async () => quote());
    const session = new QuotationSession(token, { quotation: quote(), problem: null }, api({ read, decide: async () => { throw new ApiError('Invalid notes', { status: 422, code: 'VALIDATION_FAILED', responseValidated: true, details: [{ field: 'notes', issue: 'PRIVATE' }] }); } }));
    await session.decide({ kind: 'request-revision', body: { notes: '<b></b>' } });
    expect(session.getSnapshot()).toMatchObject({ pending: null, problem: { kind: 'validation', fields: ['notes'] } }); expect(read).not.toHaveBeenCalled();
  });
  it('reconciles an uncertain decline when the server confirms DECLINED', async () => {
    const session = new QuotationSession(token, { quotation: quote(), problem: null }, api({ decide: async () => { throw failure(0); }, read: async () => ({ ...quote(), status: 'DECLINED' }) }));
    await session.decide({ kind: 'decline', body: { reason: 'SPECIFICATION', notes: 'Different pack required.' } });
    expect(session.getSnapshot()).toMatchObject({ pending: null, notice: 'declined', quotation: { status: 'DECLINED' } });
  });
  it('does not retry a refresh even while its original expired document stays unavailable', async () => {
    const decide = vi.fn(async () => { throw failure(503); });
    const session = new QuotationSession(token, { quotation: null, problem: { kind: 'expired', fields: [] } }, api({ decide, read: async () => { throw failure(403, 'QUOTATION_TOKEN_EXPIRED'); } }));
    const input = { kind: 'request-refresh' as const, body: {} };
    await session.decide(input); await session.reload(); await session.decide(input);
    expect(decide).toHaveBeenCalledTimes(1); expect(session.getSnapshot()).toMatchObject({ quotation: null, pending: 'request-refresh', notice: 'decisionUncertain' });
  });
  it('keeps the expired refresh form available when the server rejects its notes', async () => {
    const session = new QuotationSession(token, { quotation: null, problem: { kind: 'expired', fields: [] } }, api({ decide: async () => { throw new ApiError('Check notes.', { status: 422, code: 'VALIDATION_FAILED', responseValidated: true, details: [{ field: 'notes', issue: 'Required.' }] }); } }));
    await session.decide({ kind: 'request-refresh', body: { notes: 'Please refresh.' } });
    expect(session.getSnapshot()).toMatchObject({ pending: null, quotation: null, problem: { kind: 'expired', fields: ['notes'] } });
  });
});

describe('private PDF transport', () => {
  it('validates PDF bytes and sends no referrer/cookies or cache hints', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('%PDF-1.7\nprivate', { headers: { 'Content-Type': 'application/pdf' } })); vi.stubGlobal('fetch', fetcher);
    const blob = await quotationPdf(token); expect(await blob.text()).toBe('%PDF-1.7\nprivate');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('accept')).toBe('application/pdf, application/json');
  });
  it('preserves JSON before-stream expiry errors', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false, error: { status: 403, code: 'QUOTATION_TOKEN_EXPIRED', message: 'Expired' }, meta }, { status: 403 })));
    await expect(quotationPdf(token)).rejects.toMatchObject({ status: 403, code: 'QUOTATION_TOKEN_EXPIRED', requestId: meta.request_id });
  });
  it('sanitizes proxy HTML with bounded GET retries', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('<html>PRIVATE_PROXY</html>', { status: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '0' } })); vi.stubGlobal('fetch', fetcher);
    const check = expect(quotationPdf(token)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'The request could not be completed. Please try again.' });
    await vi.runAllTimersAsync(); await check; expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each(['application/pdf', 'application/json'])('rejects invalid 200 bytes of type %s', async (mime) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>PRIVATE_PROXY</html>', { headers: { 'Content-Type': mime } })); vi.stubGlobal('fetch', fetcher);
    await expect(quotationPdf(token)).rejects.toMatchObject({ status: 200, code: 'INVALID_API_RESPONSE' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
