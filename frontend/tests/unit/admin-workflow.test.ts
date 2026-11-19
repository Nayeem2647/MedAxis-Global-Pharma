import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../../lib/api-client';
import { AdminOperation, adminVersionSchema, availabilityBody, decimalForInput, draftBody, fulfillmentBody, fulfillmentNext, manualTransitions, prescriptionBlob, pricingLineSchema, quotationDetailSchema, quoteWriteResult, resendBody, reviseBody, rfqDetailSchema, safeMagicLink, sendBody, settingsSchema, statusBody } from '../../lib/admin-workflow';
import { adminVersionFixture, quotationDetailFixture, rfqFixture, workflowIds as ids, workflowSettings } from '../admin-fixtures';
import { meta } from '../fixtures';
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test'); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://medaxisglobalpharma.com'); });
const pricing = () => ({ billing_currency: 'USD', items: [{ rfq_item_id: ids.catalogLine, manufacturer_id: ids.manufacturer, availability_status: 'AVAILABLE', procurement_cost_bdt: '9007199254740993.12345678', markup_percent: '20.12345678' }, { rfq_item_id: ids.customLine, manufacturer_id: ids.manufacturer, availability_status: 'UNAVAILABLE', customer_facing_note: 'Cannot supply', snapshot: { brand_name: 'Custom', generic_name: 'Ingredient', strength: '80 mg', dosage_form: 'Tablet', pack_size: '10 tablets' } }], freight_amount: '10.00000001', insurance_amount: '0', shipping_terms: { method: 'EXPRESS_COURIER', named_place: 'Shanghai', cold_chain_required: false }, payment_terms: 'BANK_WIRE_TT' });

describe('registered RFQ and quotation adapters', () => {
  it('adapts real wire _id only at the boundary and keeps buyer snapshots immutable in write contracts', () => {
    const rfq = rfqDetailSchema.parse(rfqFixture()); expect(rfq.id).toBe(ids.rfq); expect(rfq.items[0].id).toBe(ids.catalogLine); expect(rfq.contact_snapshot.full_name).toBe('Authorized buyer fixture'); expect(JSON.stringify(rfq)).not.toContain('NEVER_RENDER_WORKFLOW_SECRET');
    expect(availabilityBody.safeParse({ item_availability_status: 'AVAILABLE', quantity: 999 }).success).toBe(false); expect(statusBody.safeParse({ status: 'CLOSED' }).success).toBe(false); expect(manualTransitions.QUOTED).toEqual(['CANCELLED']); expect(manualTransitions.CONVERTED).toEqual([]);
  });
  it('accepts actual DRAFT DTOs without customer-only availability counts while stripping credentials', () => {
    const detail = quotationDetailSchema.parse(quotationDetailFixture()); expect(detail.versions[0].status).toBe('DRAFT'); expect(detail.internal_costs[0].procurement_cost_bdt).toBe('200.24691356'); expect(detail.versions[0].total_amount).toBe('34.69135780'); const json = JSON.stringify(detail); expect(json).not.toMatch(/NEVER_RENDER_|token_hash|password_hash|encrypted_secret/);
    expect(quoteWriteResult.parse({ quotation_id: ids.quote, version: adminVersionFixture(), fx_preview: { rates_to_bdt: { USD: '122.5', EUR: '130', CNY: '17' }, stale: false, captured_at: meta.timestamp } }).version.quotation_id).toBe(ids.quote);
    expect(settingsSchema.parse(workflowSettings)).not.toHaveProperty('private_credentials');
  });
  it('rejects inconsistent current versions and malformed commercial data', () => {
    const detail = quotationDetailFixture(); detail.quotation.current_version_id = ids.rfq; expect(quotationDetailSchema.safeParse(detail).success).toBe(false);
    const version = adminVersionFixture(); version.total_amount = 'NaN'; expect(adminVersionSchema.safeParse(version).success).toBe(false);
  });
  it('preserves precise per-unit strings and matches strict nested pricing/version transport', () => {
    const draft = draftBody.parse({ ...pricing(), rfq_id: ids.rfq }); expect(draft.items[0].procurement_cost_bdt).toBe('9007199254740993.12345678'); expect(draft.freight_amount).toBe('10.00000001'); expect(draftBody.safeParse({ ...draft, total_amount: 'client total' }).success).toBe(false);
    expect(pricingLineSchema.safeParse({ ...draft.items[0], quantity: 8 }).success).toBe(false); expect(pricingLineSchema.safeParse({ ...draft.items[0], markup_percent: '1000000.00000001' }).success).toBe(false);
    expect(pricingLineSchema.safeParse({ ...draft.items[0], markup_percent: 'not a decimal' }).success).toBe(false);
    expect(draftBody.safeParse({ ...draft, items: [draft.items[1]] }).success).toBe(false); expect(draftBody.safeParse({ ...draft, items: [draft.items[0], draft.items[0]] }).success).toBe(false);
    expect(reviseBody.parse({ ...pricing(), expected_current_version_id: ids.quote, issue_immediately: false, allow_stale_fx: false })).not.toHaveProperty('rfq_id'); expect(sendBody.safeParse({ expected_version_id: ids.quote, validity_date: 'tomorrow', allow_stale_fx: false }).success).toBe(false); expect(resendBody.safeParse({ expected_version_id: ids.quote, token: 'new' }).success).toBe(false);
  });
  it.each([['0E-8', '0.00000000'], ['9007199254740993.12345678', '9007199254740993.12345678'], ['1.2345678E+2', '123.45678'], ['1E-8', '0.00000001']])('expands decimal text without float rounding: %s', (input, expected) => expect(decimalForInput(input)).toBe(expected));
  it('allows only server-defined fulfillment transitions and an unexpired reservation', () => {
    let version = adminVersionSchema.parse({ ...adminVersionFixture('ACCEPTED'), reservation_status: 'ACTIVE', reservation_expires_at: '2030-01-01T00:00:00.000Z' }); expect(fulfillmentNext(version, Date.parse('2029-01-01T00:00:00Z'))).toBe('PAYMENT_RECEIVED'); expect(fulfillmentNext(version, Date.parse('2030-01-01T00:00:00Z'))).toBeNull();
    version = adminVersionSchema.parse({ ...adminVersionFixture('PAYMENT_RECEIVED'), reservation_status: 'CONSUMED', payment: { reference: 'wire', amount: '34.69135780', currency: 'USD', received_at: meta.timestamp } }); expect(fulfillmentNext(version)).toBe('DISPATCHED'); expect(fulfillmentNext(adminVersionSchema.parse(adminVersionFixture('SENT')))).toBeNull();
    expect(fulfillmentBody.safeParse({ status: 'DISPATCHED', expected_version_id: ids.quote, courier_name: 'courier', awb_tracking_number: 'awb', amount: '1' }).success).toBe(false); expect(fulfillmentBody.safeParse({ status: 'DELIVERED', expected_version_id: ids.quote }).success).toBe(true);
  });
  it.each(['https://evil.test/q/' + 'a'.repeat(64), 'https://medaxisglobalpharma.com/admin', 'https://medaxisglobalpharma.com/q/' + 'a'.repeat(64) + '?private=1'])('rejects unsafe share links %s', (input) => expect(safeMagicLink(input)).toBeNull());
});

describe('admin business write recovery', () => {
  it.each(['GENERIC_IMAGE_UPLOAD_FAILED', 'CATEGORY_IMAGE_UPLOAD_FAILED'])('keeps the form editable after %s without replaying the save', async (code) => {
    const operation = new AdminOperation();
    const refresh = vi.fn();
    const save = vi.fn(async () => { throw new ApiError('Picture unavailable', { status: 503, code, responseValidated: true }); });
    await operation.run(save, refresh);
    expect(save).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    expect(operation.getSnapshot()).toMatchObject({ busy: false, blocked: false, uncertain: false, problem: null });
    expect(operation.getSnapshot().notice).toContain('Remove the selected picture');
  });
  it('explains duplicate catalog slugs and allows a corrected manual submission without reloading or replaying', async () => {
    const operation = new AdminOperation();
    const refresh = vi.fn();
    await operation.run(async () => { throw new ApiError('Duplicate', {
      status: 422, code: 'CATALOG_SLUG_CONFLICT', responseValidated: true,
      details: [{ field: 'translations.en.slug', issue: 'Already used' }, { field: 'translations.zhCN.slug', issue: 'Already used' }],
    }); }, refresh);
    expect(refresh).not.toHaveBeenCalled();
    expect(operation.getSnapshot()).toMatchObject({ blocked: false, uncertain: false, problem: {
      code: 'CATALOG_SLUG_CONFLICT', fields: ['translations.en.slug', 'translations.zhCN.slug'],
    } });
    expect(operation.getSnapshot().notice).toContain('existing record already uses this page slug');
    const corrected = vi.fn(async () => undefined);
    await operation.run(corrected, refresh);
    expect(corrected).toHaveBeenCalledOnce();
    expect(operation.getSnapshot().problem).toBeNull();
  });

  it('synchronously suppresses duplicate writes and does not report committed writes as failed when refresh breaks', async () => {
    const operation = new AdminOperation(); let done: (() => void) | undefined; const work = vi.fn(() => new Promise<void>((resolve) => { done = resolve; })); const refresh = vi.fn(async () => { throw new Error('lost read'); }); const committed = vi.fn();
    const first = operation.run(work, refresh, committed); await operation.run(work, refresh, committed); expect(work).toHaveBeenCalledOnce(); done?.(); await first; expect(committed).toHaveBeenCalledOnce(); expect(operation.getSnapshot()).toMatchObject({ blocked: true, uncertain: false }); expect(operation.getSnapshot().notice).toContain('Saved.'); await operation.refresh(async () => undefined); expect(operation.getSnapshot().blocked).toBe(false);
  });
  it.each([0, 429, 500, 503])('reconciles uncertain status %s using reads, and never silently unlocks/resends it', async (status) => {
    const operation = new AdminOperation(); const work = vi.fn(async () => { throw new ApiError('Unknown delivery', { status, code: 'UNKNOWN' }); }); const read = vi.fn(async () => undefined); await operation.run(work, read); await operation.run(work, read); await operation.refresh(read); expect(work).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledTimes(2); expect(operation.getSnapshot()).toMatchObject({ blocked: true, uncertain: true, busy: false });
  });
  it('re-reads an explicit 409 before allowing a deliberate action with the latest version', async () => { const operation = new AdminOperation(); const read = vi.fn(async () => undefined); await operation.run(async () => { throw new ApiError('Conflict', { status: 409, code: 'QUOTATION_VERSION_CONFLICT', responseValidated: true }); }, read); expect(read).toHaveBeenCalledOnce(); expect(operation.getSnapshot()).toMatchObject({ blocked: false, uncertain: false }); });
  it('allows a distinct next action only after an authoritative version/status advanced', async () => { const operation = new AdminOperation(); const original = vi.fn(async () => { throw new ApiError('Lost response', { status: 0, code: 'NETWORK_ERROR' }); }); await operation.run(original, async () => { operation.reconcileAdvancedVersion(); }); expect(original).toHaveBeenCalledOnce(); expect(operation.getSnapshot()).toMatchObject({ blocked: false, uncertain: false }); expect(operation.getSnapshot().notice).toContain('original write was not replayed'); });
  it('retains nested 422 fields without forcing a repeat request', async () => { const operation = new AdminOperation(); const read = vi.fn(); await operation.run(async () => { throw new ApiError('Invalid', { status: 422, code: 'VALIDATION_FAILED', responseValidated: true, details: [{ field: 'items.0.manufacturer_id', issue: 'Invalid' }] }); }, read); expect(read).not.toHaveBeenCalled(); expect(operation.getSnapshot()).toMatchObject({ blocked: false, problem: { fields: ['items.0.manufacturer_id'] } }); });
  it('never automatically retries a non-idempotent admin issue', async () => { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>private</html>', { status: 503, headers: { 'content-type': 'text/html' } })); vi.stubGlobal('fetch', fetcher); await expect(apiRequest(`/v1/admin/quotations/${ids.quote}/send`, quoteWriteResult, { method: 'POST', json: { expected_version_id: ids.quote, allow_stale_fx: false } })).rejects.toMatchObject({ status: 503 }); expect(fetcher).toHaveBeenCalledOnce(); });
});

describe('private prescription bytes', () => {
  it('normalizes a PDF content-type parameter without misclassifying the private preview', async () => { vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('%PDF-private', { headers: { 'content-type': 'application/pdf; charset=binary' } }))); expect((await prescriptionBlob(ids.prescription, new AbortController().signal)).type).toBe('application/pdf'); });
  it('retains HttpOnly credentials, no-store and MIME/signature checks', async () => { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('%PDF-private', { headers: { 'content-type': 'application/pdf' } })); vi.stubGlobal('fetch', fetcher); const blob = await prescriptionBlob(ids.prescription, new AbortController().signal); expect(blob.type).toBe('application/pdf'); expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' }); });
  it.each([new Response('<html>private proxy</html>', { status: 502, headers: { 'content-type': 'text/html' } }), new Response('fake', { headers: { 'content-type': 'image/png' } })])('rejects proxy HTML and spoofed files', async (response) => { vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response)); await expect(prescriptionBlob(ids.prescription, new AbortController().signal)).rejects.toBeInstanceOf(ApiError); });
});
