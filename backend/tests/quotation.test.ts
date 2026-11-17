import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { calculateFastQuote } from '../src/modules/quotation/fastquote.engine.js';
import { commercialQuotation } from '../src/modules/quotation/quotation.dto.js';
import { encryptedDelivery } from '../src/modules/quotation/quotation.outbox.js';
import type { IQuotationVersion } from '../src/modules/quotation/quotation.schema.js';
import { bsonDecimal, saneRate } from '../src/shared/utils/decimal.js';
import { decrypt } from '../src/shared/utils/crypto.js';
import { createLogger } from '../src/shared/utils/logger.js';
import {
  draftQuoteSchema,
  fxPatchSchema,
  updateDraftQuoteSchema,
} from '../src/shared/validators/quotation.validator.js';
import { ManufacturerModel } from '../src/modules/catalog/catalog.schema.js';
import { validEnv } from './helpers/env.js';
import { quotationVersionFixture } from './fixtures/commercial.js';
import {
  QuotationModel,
  QuotationVersionModel,
  QuotationInternalCostModel,
} from '../src/modules/quotation/quotation.schema.js';
import { PlatformSettingModel } from '../src/modules/settings/settings.schema.js';
import { RfqModel } from '../src/modules/rfq/rfq.schema.js';
import { createQuotationService } from '../src/modules/quotation/quotation.service.js';
import { createDecisionService } from '../src/modules/quotation/quotation.decisions.js';
import type { FxService } from '../src/modules/fx/fx.service.js';
import * as outbox from '../src/modules/quotation/quotation.outbox.js';
import * as audit from '../src/shared/middleware/auditLogger.js';
import { hashToken } from '../src/shared/utils/crypto.js';
import { z } from 'zod';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function query<T>(value: T) {
  return {
    select() {
      return this;
    },
    session() {
      return this;
    },
    lean: async () => value,
    then: (resolve: (result: T) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
}

// Execute the real service/crypto/calculator. Persistence/outbox are isolated;
// MongoDB transaction atomicity remains covered by the separate integration suite.
function issuanceHarness() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
  const env = loadEnv(validEnv);
  const logger = createLogger({ silent: true });
  const fixture = quotationVersionFixture();
  const version = new QuotationVersionModel({ ...fixture, status: 'DRAFT', issued_at: undefined });
  const quote = new QuotationModel({
    _id: fixture.quotation_id,
    quotation_number: 'QT-SERVICE-001',
    rfq_id: randomUUID(),
    customer_id: randomUUID(),
    current_version: 1,
    current_version_id: fixture._id,
    overall_status: 'ACTIVE',
  });
  const session = {} as ClientSession;
  vi.spyOn(mongoose.connection, 'transaction').mockImplementation(
    async <T>(work: (value: ClientSession) => Promise<T>) => work(session),
  );
  const req = { requestId: randomUUID(), admin: { id: randomUUID(), sessionId: randomUUID() } } as Request;
  vi.spyOn(QuotationModel, 'findOne').mockImplementation(() => query(quote) as never);
  vi.spyOn(QuotationModel, 'findOneAndUpdate').mockImplementation(() => query(quote) as never);
  vi.spyOn(QuotationModel, 'findById').mockImplementation(() => query(quote.toObject()) as never);
  vi.spyOn(QuotationVersionModel, 'findOne').mockImplementation((filter) => {
    const hash = z.object({ magic_link_token_hash: z.string().optional() }).parse(filter).magic_link_token_hash;
    return query(hash ? (hash === version.magic_link_token_hash ? version.toObject() : null) : version) as never;
  });
  vi.spyOn(version, 'save').mockResolvedValue(version);
  const costs = new QuotationInternalCostModel({
    quotation_version_id: version._id,
    items: fixture.items.map((item) => ({
      rfq_item_id: item.rfq_item_id,
      manufacturer_id: item.manufacturer_id,
      quantity: item.quantity,
      procurement_unit_cost_bdt: bsonDecimal('120'),
      markup_percent: bsonDecimal('20'),
    })),
    procurement_cost_bdt: bsonDecimal('360'),
    target_markup_percent: bsonDecimal('20'),
    calculated_base_bdt: bsonDecimal('432'),
  });
  vi.spyOn(costs, 'save').mockResolvedValue(costs);
  vi.spyOn(QuotationInternalCostModel, 'findOne').mockImplementation(() => query(costs) as never);
  vi.spyOn(RfqModel, 'findById').mockImplementation(
    () => query({ _id: quote.rfq_id, status: 'UNDER_REVIEW' }) as never,
  );
  const rfqWrite = vi.spyOn(RfqModel, 'updateOne').mockResolvedValue({ matchedCount: 1 } as never);
  const bank = {
    configured: true,
    instructions: 'Verified wire',
    beneficiary_name: 'Exporter',
    bank_name: 'Bank',
    account_number: 'WIRE-001',
    swift_code: 'TESTBDDH',
  };
  vi.spyOn(PlatformSettingModel, 'findOne').mockImplementation(
    (filter) =>
      query({
        value:
          z.object({ key: z.string() }).parse(filter).key === 'wire_instructions' ? bank : { quote_validity_days: 7 },
      }) as never,
  );
  const snapshot = vi.fn(async () => ({
    rate: '120',
    rates: { USD: '120', EUR: '130', CNY: '17' },
    modes: { USD: 'LIVE', EUR: 'LIVE', CNY: 'LIVE' },
    fetched: { USD: new Date(), EUR: new Date(), CNY: new Date() },
    captured_at: new Date(),
    stale: false,
  }));
  const fx = { snapshot } as unknown as FxService;
  const enqueue = vi.spyOn(outbox, 'enqueueQuotation').mockResolvedValue(undefined);
  const log = vi.spyOn(audit, 'writeAuditLog').mockResolvedValue(undefined);
  return {
    version,
    quote,
    req,
    session,
    snapshot,
    rfqWrite,
    enqueue,
    log,
    service: createQuotationService(env, fx, logger),
    decisions: createDecisionService(env, logger),
  };
}

describe('real issue/resend service boundaries with isolated persistence', () => {
  it('edits an existing draft atomically without creating a version or locking FX, and rejects stale replay', async () => {
    const h = issuanceHarness();
    const before = h.version.updated_at.toISOString();
    const line = h.version.items[0]!;
    vi.spyOn(RfqModel, 'findById').mockImplementation(
      () =>
        query({
          _id: h.quote.rfq_id,
          status: 'UNDER_REVIEW',
          contact_snapshot: h.version.contact_snapshot,
          items: [{ _id: line.rfq_item_id, is_uncatalogued: true, quantity: 3, packaging_unit: 'BOX' }],
        }) as never,
    );
    vi.spyOn(ManufacturerModel, 'findOneAndUpdate').mockImplementation(
      () => query({ _id: line.manufacturer_id, is_active: true }) as never,
    );
    const stamp = vi.spyOn(QuotationVersionModel, 'updateOne').mockResolvedValue({ matchedCount: 1 } as never);
    const input = updateDraftQuoteSchema.parse({
      expected_current_version_id: h.version._id,
      expected_updated_at: before,
      billing_currency: 'USD',
      items: [
        {
          rfq_item_id: line.rfq_item_id,
          manufacturer_id: line.manufacturer_id,
          availability_status: 'AVAILABLE',
          procurement_cost_bdt: '120.12345678',
          markup_percent: '20',
          snapshot: {
            brand_name: 'Actual custom medicine',
            generic_name: 'Ingredient',
            strength: '10 mg',
            dosage_form: 'Tablet',
            pack_size: '10 tablets',
          },
        },
      ],
      freight_amount: '2.50',
      insurance_amount: '0.25',
      shipping_terms: h.version.toObject().shipping_terms,
      payment_terms: 'BANK_WIRE_TT',
    });
    const result = await h.service.updateDraft(h.req, h.quote._id, input);
    expect(result.version.id).toBe(h.version._id);
    expect(result.version.version_number).toBe(1);
    expect(result.version.status).toBe('DRAFT');
    expect(result.version.items[0]?.quantity).toBe(3);
    expect(result.version).not.toHaveProperty('locked_fx_rates');
    expect(h.snapshot).toHaveBeenCalledExactlyOnceWith('USD', h.session, true);
    expect(result.version.updated_at.getTime()).toBeGreaterThan(Date.parse(before));
    expect(stamp).toHaveBeenCalledWith({ _id: h.version._id, status: 'DRAFT' }, expect.any(Object), {
      session: h.session,
      timestamps: false,
    });
    expect(h.log).toHaveBeenCalledWith(
      h.req,
      expect.objectContaining({ action: 'QUOTATION_DRAFT_UPDATED' }),
      h.session,
    );
    expect(h.enqueue).not.toHaveBeenCalled();
    await expect(h.service.updateDraft(h.req, h.quote._id, input)).rejects.toMatchObject({
      status: 409,
      code: 'QUOTATION_VERSION_CONFLICT',
    });
  });
  it('never edits issued prices or a superseded version through draft update', async () => {
    const h = issuanceHarness();
    const input = updateDraftQuoteSchema.parse({
      expected_current_version_id: h.version._id,
      expected_updated_at: h.version.updated_at.toISOString(),
      billing_currency: 'USD',
      items: [
        {
          rfq_item_id: h.version.items[0]!.rfq_item_id,
          manufacturer_id: h.version.items[0]!.manufacturer_id,
          availability_status: 'AVAILABLE',
          procurement_cost_bdt: '120',
          markup_percent: '20',
        },
      ],
      freight_amount: '0',
      insurance_amount: '0',
      shipping_terms: h.version.toObject().shipping_terms,
    });
    h.version.status = 'SENT';
    await expect(h.service.updateDraft(h.req, h.quote._id, input)).rejects.toMatchObject({ status: 409 });
    expect(h.snapshot).not.toHaveBeenCalled();
    h.version.status = 'DRAFT';
    await expect(
      h.service.updateDraft(h.req, h.quote._id, { ...input, expected_current_version_id: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('recalculates and captures FX only at issue, then rotates the token without changing locked prices/rates', async () => {
    const h = issuanceHarness();
    h.snapshot.mockResolvedValueOnce({
      rate: '240',
      rates: { USD: '240', EUR: '130', CNY: '17' },
      modes: { USD: 'LIVE', EUR: 'LIVE', CNY: 'LIVE' },
      fetched: { USD: new Date(), EUR: new Date(), CNY: new Date() },
      captured_at: new Date(),
      stale: false,
    });
    const sent = await h.service.send(h.req, h.quote._id, {
      expected_version_id: h.version._id,
      allow_stale_fx: false,
    });
    expect(h.snapshot).toHaveBeenCalledExactlyOnceWith('USD', h.session, false);
    expect(sent.version.total_amount).toBe('4.55');
    expect(h.version.fx_snapshot?.rates_to_bdt.USD.toString()).toBe('240');
    expect(h.version.status).toBe('SENT');
    const first = new URL(sent.magic_link_url).pathname.split('/').at(-1)!;
    expect(h.version.magic_link_token_hash).toBe(hashToken(first));
    expect((await h.decisions.get(first)).total_amount).toBe('4.55');
    vi.spyOn(QuotationVersionModel, 'findOneAndUpdate').mockImplementation((filter, update) => {
      expect(filter).toMatchObject({ _id: h.version._id, status: 'SENT', magic_link_token_hash: hashToken(first) });
      h.version.magic_link_token_hash = z
        .object({ $set: z.object({ magic_link_token_hash: z.string() }) })
        .parse(update).$set.magic_link_token_hash;
      return query(h.version) as never;
    });
    const rotated = await h.service.resend(h.req, h.quote._id, h.version._id);
    const second = new URL(rotated.magic_link_url).pathname.split('/').at(-1)!;
    expect(second).not.toBe(first);
    await expect(h.decisions.get(first)).rejects.toMatchObject({ status: 404 });
    expect((await h.decisions.get(second)).total_amount).toBe('4.55');
    expect(h.snapshot).toHaveBeenCalledOnce();
    expect(h.version.fx_snapshot?.rates_to_bdt.USD.toString()).toBe('240');
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(h.enqueue.mock.calls[1]?.at(-1)).toBe(true);
  });
  it('rejects stale expected versions before any issue work, FX capture or notification', async () => {
    const h = issuanceHarness();
    await expect(
      h.service.send(h.req, h.quote._id, { expected_version_id: randomUUID(), allow_stale_fx: false }),
    ).rejects.toMatchObject({ status: 409, code: 'QUOTATION_VERSION_CONFLICT' });
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.rfqWrite).not.toHaveBeenCalled();
  });
  it('rejects a concurrent parent-version change at its compare-and-set lock', async () => {
    const h = issuanceHarness();
    vi.mocked(QuotationModel.findOneAndUpdate).mockImplementation(() => query(null) as never);
    await expect(
      h.service.send(h.req, h.quote._id, { expected_version_id: h.version._id, allow_stale_fx: false }),
    ).rejects.toMatchObject({ status: 409 });
    expect(QuotationModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ current_version_id: h.version._id, current_version: 1, overall_status: 'ACTIVE' }),
      expect.anything(),
      expect.objectContaining({ session: h.session }),
    );
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it('refuses to issue sourcing lines before FX capture or side effects', async () => {
    const h = issuanceHarness();
    h.version.items[0]!.availability_status = 'SOURCING';
    await expect(
      h.service.send(h.req, h.quote._id, { expected_version_id: h.version._id, allow_stale_fx: false }),
    ).rejects.toMatchObject({ status: 422 });
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it('rejects a resend token changed by a concurrent actor without queuing another delivery', async () => {
    const h = issuanceHarness();
    h.version.status = 'SENT';
    h.version.magic_link_token_hash = hashToken('a'.repeat(64));
    vi.spyOn(QuotationVersionModel, 'findOneAndUpdate').mockImplementation(() => query(null) as never);
    await expect(h.service.resend(h.req, h.quote._id, h.version._id)).rejects.toMatchObject({ status: 409 });
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.snapshot).not.toHaveBeenCalled();
  });
});

const line = {
  rfq_item_id: randomUUID(),
  manufacturer_id: randomUUID(),
  quantity: 3,
  availability_status: 'AVAILABLE' as const,
  procurement_cost_bdt: '120',
  markup_percent: '20',
};
describe('server-side exact fast quote', () => {
  it('converts 1 foreign unit = BDT rate, multiplies rounded units, and isolates internal margins', () => {
    const value = calculateFastQuote({
      currency: 'USD',
      rate_to_bdt: '120',
      items: [line],
      freight_amount: '2.50',
      insurance_amount: '0.25',
    });
    expect(value.commercial).toMatchObject({
      items: [{ unit_quoted_price: '1.20', total_line_price: '3.60' }],
      subtotal_amount: '3.60',
      total_amount: '6.35',
    });
    expect(value.internal).toMatchObject({
      procurement_cost_bdt: '360.00000000',
      calculated_base_bdt: '432.00000000',
      gross_margin_bdt: '72.00000000',
      target_markup_percent: '20.00000000',
    });
    expect(JSON.stringify(value.commercial)).not.toMatch(/procurement|markup|margin|manufacturer/);
  });
  it('uses ROUND_HALF_UP at the unit boundary rather than binary arithmetic or line-total rounding', () => {
    const value = calculateFastQuote({
      currency: 'BDT',
      rate_to_bdt: '1',
      items: [{ ...line, procurement_cost_bdt: '1.005', markup_percent: '0' }],
      freight_amount: '0.1',
      insurance_amount: '0.2',
    });
    expect(value.commercial.items[0]!.unit_quoted_price).toBe('1.01');
    expect(value.commercial.items[0]!.total_line_price).toBe('3.03');
    expect(value.commercial.total_amount).toBe('3.33');
  });
  it('keeps large safe quantities exact and excludes unavailable/sourcing cost inflation', () => {
    const value = calculateFastQuote({
      currency: 'BDT',
      rate_to_bdt: '1',
      items: [
        { ...line, quantity: 9007199254740991, procurement_cost_bdt: '0.1', markup_percent: '0' },
        {
          ...line,
          rfq_item_id: randomUUID(),
          availability_status: 'UNAVAILABLE',
          procurement_cost_bdt: '999999',
          markup_percent: '9999',
        },
        { ...line, rfq_item_id: randomUUID(), availability_status: 'SOURCING' },
      ],
      freight_amount: '0',
      insurance_amount: '0',
    });
    expect(value.commercial.total_amount).toBe('900719925474099.10');
    expect(value.commercial.items[1]).not.toHaveProperty('unit_quoted_price');
    expect(value.internal.items).toHaveLength(1);
  });
  it.each(['-1', 'NaN', 'Infinity', '1e3', '0.000000001'])('rejects unsupported/negative money %s', (cost) => {
    expect(() =>
      calculateFastQuote({
        currency: 'USD',
        rate_to_bdt: '120',
        items: [{ ...line, procurement_cost_bdt: cost }],
        freight_amount: '0',
        insurance_amount: '0',
      }),
    ).toThrow();
  });
  it('rejects negative freight, invalid FX, fractional quantities and all-unavailable quotes', () => {
    const base = {
      currency: 'USD' as const,
      rate_to_bdt: '120',
      items: [line],
      freight_amount: '0',
      insurance_amount: '0',
    };
    for (const change of [
      { freight_amount: '-0.01' },
      { rate_to_bdt: '0' },
      { rate_to_bdt: '10001' },
      { items: [{ ...line, quantity: 0.5 }] },
      { items: [{ ...line, availability_status: 'UNAVAILABLE' as const }] },
    ])
      expect(() => calculateFastQuote({ ...base, ...change })).toThrow();
    expect(saneRate('0.1')).toBe(true);
    expect(saneRate('10000')).toBe(true);
    expect(saneRate('0.099999')).toBe(false);
  });
});
describe('quotation DTO, validation and delivery secrets', () => {
  it('explicitly allowlists customer-facing fields and hides token hashes even from poisoned records', () => {
    const value = {
      _id: randomUUID(),
      quotation_id: randomUUID(),
      version_number: 1,
      status: 'DRAFT',
      contact_snapshot: {
        full_name: 'Buyer',
        customer_type: 'B2C_PATIENT',
        preferred_locale: 'en',
        password: 'private',
      },
      items: [
        {
          _id: randomUUID(),
          rfq_item_id: randomUUID(),
          manufacturer_id: randomUUID(),
          brand_name_snapshot: 'Demo',
          generic_name_snapshot: 'Demo',
          strength_snapshot: '10mg',
          dosage_form_snapshot: 'Tablet',
          pack_size_snapshot: '10',
          packaging_unit: 'BOX',
          quantity: 1,
          availability_status: 'AVAILABLE',
          unit_quoted_price: bsonDecimal('10'),
          total_line_price: bsonDecimal('10'),
          procurement_cost_bdt: '5',
          markup_percent: '20',
        },
      ],
      billing_currency: 'USD',
      subtotal_amount: bsonDecimal('10'),
      freight_cost: bsonDecimal('0'),
      insurance_cost: bsonDecimal('0'),
      total_amount: bsonDecimal('10'),
      shipping_terms: {
        method: 'EXPRESS_COURIER',
        named_place: 'Dhaka',
        cold_chain_required: false,
        internal_note: 'private',
      },
      payment_terms: 'BANK_WIRE_TT',
      bank_details_snapshot: {
        configured: true,
        instructions: 'Pay by wire',
        beneficiary_name: 'Exporter',
        bank_name: 'Bank',
        account_number: '123',
        swift_code: 'TESTBDDH',
        procurement_cost_bdt: 'private',
      },
      reservation_status: 'NONE',
      magic_link_token_hash: 'a'.repeat(64),
      procurement_cost_bdt: '5',
      margin: 'private',
    } as unknown as IQuotationVersion;
    expect(JSON.stringify(commercialQuotation(value))).not.toMatch(
      /procurement|markup|margin|token|password|internal_note/,
    );
  });
  it('encrypts a delivery URL separately and rejects unconfigured delivery', () => {
    const key = 'ab'.repeat(32);
    const env = loadEnv({ ...validEnv, QUOTATION_TOKEN_ENCRYPTION_KEY: key, QUOTATION_TOKEN_KEY_ID: 'quote-v1' });
    const url = `https://example.test/q/${'a'.repeat(64)}`;
    const sealed = encryptedDelivery(env, url);
    expect(JSON.stringify(sealed)).not.toContain(url);
    expect(decrypt(sealed, Buffer.from(key, 'hex'), 'quote-v1').toString()).toBe(url);
    expect(() => encryptedDelivery(loadEnv(validEnv), url)).toThrow('not configured');
  });
  it('rejects client totals, numeric money and corrupt manual rates', () => {
    expect(draftQuoteSchema.safeParse({ total_amount: '1' }).success).toBe(false);
    for (const value of ['0', '-1', '10000.1', 120])
      expect(
        fxPatchSchema.safeParse({
          rates: [{ currency: 'USD', active_mode: 'MANUAL_FIXED', manual_rate_to_bdt: value }],
        }).success,
      ).toBe(false);
  });
  it.each(['/v1/admin/fx-rates', '/v1/admin/quotations/draft', `/v1/admin/quotations/${randomUUID()}/send`])(
    'requires full admin authentication at %s',
    async (path) => {
      const app = createApp({ env: loadEnv(validEnv), logger: createLogger({ silent: true }) });
      const response = path.endsWith('fx-rates')
        ? await request(app).get(path)
        : await request(app).post(path).send({});
      expect(response.status).toBe(401);
    },
  );
});
