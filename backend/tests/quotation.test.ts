import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { calculateFastQuote } from '../src/modules/quotation/fastquote.engine.js';
import { commercialQuotation } from '../src/modules/quotation/quotation.dto.js';
import { encryptedDelivery } from '../src/modules/quotation/quotation.outbox.js';
import type { IQuotationVersion } from '../src/modules/quotation/quotation.schema.js';
import { bsonDecimal, saneRate } from '../src/shared/utils/decimal.js';
import { decrypt } from '../src/shared/utils/crypto.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { draftQuoteSchema, fxPatchSchema } from '../src/shared/validators/quotation.validator.js';
import { validEnv } from './helpers/env.js';

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
