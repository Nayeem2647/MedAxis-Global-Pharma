import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import type puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { addCalendarDays } from '../src/shared/utils/calendar.js';
import {
  acceptSchema,
  declineSchema,
  fulfillmentSchema,
  revisionRequestSchema,
} from '../src/shared/validators/decision.validator.js';
import { renderQuotationHtml } from '../src/modules/pdf/pdf.template.js';
import { commercialQuotation } from '../src/modules/quotation/quotation.dto.js';
import { createPdfService, loadEmbeddedFonts, PDF_TIMEOUT_MS } from '../src/modules/pdf/pdf.service.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';
import { pdfFixture, quotationVersionFixture } from './fixtures/commercial.js';
import { QuotationModel, QuotationVersionModel } from '../src/modules/quotation/quotation.schema.js';
import { createFulfillmentService } from '../src/modules/quotation/quotation.fulfillment.js';
import * as lifecycle from '../src/modules/quotation/quotation.lifecycle.js';
import * as audit from '../src/shared/middleware/auditLogger.js';
import { bsonDecimal } from '../src/shared/utils/decimal.js';
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
  };
}
function fulfillmentHarness() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
  const version = quotationVersionFixture(true);
  const quote = {
    _id: version.quotation_id,
    current_version_id: version._id,
    rfq_id: randomUUID(),
    overall_status: 'ACTIVE',
  };
  const req = { requestId: randomUUID(), admin: { id: randomUUID(), sessionId: randomUUID() } } as Request;
  const session = {} as ClientSession;
  const transaction = vi
    .spyOn(mongoose.connection, 'transaction')
    .mockImplementation(async <T>(work: (value: ClientSession) => Promise<T>) => work(session));
  vi.spyOn(QuotationModel, 'findById').mockImplementation(() => query(quote) as never);
  vi.spyOn(QuotationVersionModel, 'findById').mockImplementation(() => query(version) as never);
  const changed = vi.spyOn(QuotationVersionModel, 'findOneAndUpdate').mockImplementation((_filter, update) => {
    const values = z.object({ $set: z.record(z.string(), z.unknown()) }).parse(update).$set;
    return query({ ...version, ...values }) as never;
  });
  const parent = vi.spyOn(QuotationModel, 'updateOne').mockResolvedValue({ matchedCount: 1 } as never);
  const queue = vi.spyOn(lifecycle, 'queueLifecycleEmail').mockResolvedValue(undefined);
  const purge = vi.spyOn(lifecycle, 'scheduleMedicalPurge').mockResolvedValue(undefined);
  const log = vi.spyOn(audit, 'writeAuditLog').mockResolvedValue(undefined);
  return {
    version,
    quote,
    req,
    session,
    transaction,
    changed,
    parent,
    queue,
    purge,
    log,
    service: createFulfillmentService(createLogger({ silent: true })),
  };
}

describe('real fulfillment service guards with isolated persistence', () => {
  it.each(['SENT', 'DRAFT', 'DELIVERED'] as const)('cannot record payment from %s', async (status) => {
    const h = fulfillmentHarness();
    h.version.status = status;
    await expect(
      h.service(h.req, h.quote._id, {
        expected_version_id: h.version._id,
        status: 'PAYMENT_RECEIVED',
        wire_reference: 'WIRE',
        amount: '6.35',
        currency: 'USD',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.queue).not.toHaveBeenCalled();
  });
  it.each(['2026-11-16T09:59:59Z', '2026-11-16T10:00:00Z'])(
    'blocks an expired reservation without depending on workers: %s',
    async (deadline) => {
      const h = fulfillmentHarness();
      h.version.reservation_expires_at = new Date(deadline);
      await expect(
        h.service(h.req, h.quote._id, {
          expected_version_id: h.version._id,
          status: 'PAYMENT_RECEIVED',
          wire_reference: 'WIRE',
          amount: '6.35',
          currency: 'USD',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.changed).not.toHaveBeenCalled();
    },
  );
  it.each([
    { amount: '6.34', currency: 'USD' as const },
    { amount: '0', currency: 'USD' as const },
    { amount: '6.35', currency: 'EUR' as const },
  ])('checks exact payment amount/currency: %j', async (payment) => {
    const h = fulfillmentHarness();
    await expect(
      h.service(h.req, h.quote._id, {
        expected_version_id: h.version._id,
        status: 'PAYMENT_RECEIVED',
        wire_reference: 'WIRE',
        ...payment,
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(h.changed).not.toHaveBeenCalled();
  });
  it('rejects a stale expected version before updating a commercial document', async () => {
    const h = fulfillmentHarness();
    await expect(
      h.service(h.req, h.quote._id, {
        expected_version_id: randomUUID(),
        status: 'PAYMENT_RECEIVED',
        wire_reference: 'WIRE',
        amount: '6.35',
        currency: 'USD',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'QUOTATION_VERSION_CONFLICT' });
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.queue).not.toHaveBeenCalled();
  });
  it('uses status/reservation compare-and-set predicates and snapshot/majority transaction options', async () => {
    const h = fulfillmentHarness();
    const paid = await h.service(h.req, h.quote._id, {
      expected_version_id: h.version._id,
      status: 'PAYMENT_RECEIVED',
      wire_reference: 'WIRE',
      amount: '6.35000000',
      currency: 'USD',
    });
    expect(paid.status).toBe('PAYMENT_RECEIVED');
    expect(paid.payment?.amount).toBe('6.35');
    expect(h.changed).toHaveBeenCalledWith(
      {
        _id: h.version._id,
        quotation_id: h.quote._id,
        status: 'ACCEPTED',
        reservation_status: 'ACTIVE',
        reservation_expires_at: { $gt: new Date() },
      },
      expect.objectContaining({ $set: expect.objectContaining({ reservation_status: 'CONSUMED' }) }),
      expect.objectContaining({ session: h.session }),
    );
    expect(h.transaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
    expect(h.queue).toHaveBeenCalledOnce();
  });
  it('handles a lost concurrent compare-and-set without queuing fulfillment', async () => {
    const h = fulfillmentHarness();
    h.changed.mockImplementation(() => query(null) as never);
    await expect(
      h.service(h.req, h.quote._id, {
        expected_version_id: h.version._id,
        status: 'PAYMENT_RECEIVED',
        wire_reference: 'WIRE',
        amount: '6.35',
        currency: 'USD',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.parent).not.toHaveBeenCalled();
    expect(h.queue).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });
  it('rejects a parent-version change before enqueueing side effects', async () => {
    const h = fulfillmentHarness();
    h.parent.mockResolvedValue({ matchedCount: 0 } as never);
    await expect(
      h.service(h.req, h.quote._id, {
        expected_version_id: h.version._id,
        status: 'PAYMENT_RECEIVED',
        wire_reference: 'WIRE',
        amount: '6.35',
        currency: 'USD',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'QUOTATION_VERSION_CONFLICT' });
    expect(h.queue).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });
  it('does not dispatch before verified payment and consumed reservation', async () => {
    const h = fulfillmentHarness();
    await expect(
      h.service(h.req, h.quote._id, {
        expected_version_id: h.version._id,
        status: 'DISPATCHED',
        courier_name: 'Courier',
        awb_tracking_number: 'AWB',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.changed).not.toHaveBeenCalled();
    h.version.status = 'PAYMENT_RECEIVED';
    h.version.reservation_status = 'CONSUMED';
    h.version.payment = {
      reference: 'WIRE',
      amount: bsonDecimal('6.35'),
      currency: 'USD',
      received_at: new Date(),
      recorded_by: h.req.admin!.id,
    };
    expect(
      (
        await h.service(h.req, h.quote._id, {
          expected_version_id: h.version._id,
          status: 'DISPATCHED',
          courier_name: 'Courier',
          awb_tracking_number: 'AWB',
        })
      ).status,
    ).toBe('DISPATCHED');
  });
  it('requires dispatch and refuses repeated delivery without another purge/email', async () => {
    const h = fulfillmentHarness();
    await expect(
      h.service(h.req, h.quote._id, { expected_version_id: h.version._id, status: 'DELIVERED' }),
    ).rejects.toMatchObject({ status: 409 });
    h.version.status = 'DISPATCHED';
    h.version.shipment = { courier_name: 'Courier', awb_number: 'AWB', dispatched_at: new Date() };
    const delivered = await h.service(h.req, h.quote._id, { expected_version_id: h.version._id, status: 'DELIVERED' });
    expect(delivered.status).toBe('DELIVERED');
    h.version.status = 'DELIVERED';
    await expect(
      h.service(h.req, h.quote._id, { expected_version_id: h.version._id, status: 'DELIVERED' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.purge).toHaveBeenCalledOnce();
    expect(h.queue).toHaveBeenCalledOnce();
  });
});

describe('decision boundary and print isolation', () => {
  it('serializes the real customer DTO without poisoned internal fields while preserving customer prices', () => {
    const version = quotationVersionFixture(true);
    const internal = {
      procurement_cost_bdt: 'SECRET-COST',
      procurement_unit_cost_bdt: 'SECRET-COST',
      gross_margin_bdt: 'SECRET-MARGIN',
      markup_percent: 'SECRET-MARKUP',
      locked_fx_rate_usd: 'SECRET-FX',
      internal_cost_data: { value: 'SECRET-COST' },
      internal_procurement_notes: 'SECRET-NOTES',
      magic_link_token_hash: 'SECRET-TOKEN-HASH',
    };
    Object.assign(version, internal);
    Object.assign(version.contact_snapshot, internal);
    Object.assign(version.shipping_terms, internal);
    version.items.forEach((line) => Object.assign(line, internal));
    version.bank_details_snapshot = {
      configured: true,
      instructions: 'Authorized wire instructions',
      beneficiary_name: 'Beneficiary',
      bank_name: 'Bank',
      account_number: 'AUTHORIZED-ACCOUNT',
      swift_code: 'TESTBDDH',
    };
    const customer = commercialQuotation(version);
    const json = JSON.stringify(customer);
    expect(json).not.toMatch(
      /SECRET-|procurement_cost|procurement_unit_cost|gross_margin|markup_percent|locked_fx_rate|internal_cost_data|internal_procurement_notes|magic_link_token_hash/,
    );
    expect(customer.items[0]?.unit_quoted_price).toBe('1.20');
    expect(customer.items[0]?.total_line_price).toBe('3.60');
    expect(customer.total_amount).toBe('6.35');
    expect(customer.bank_details?.account_number).toBe('AUTHORIZED-ACCOUNT');
    expect(customer.reservation_expires_at).toEqual(new Date('2026-11-21T10:00:00Z'));
  });
  it('requires affirmative terms and sanitizes buyer notes without permitting payment/total overrides', () => {
    for (const terms of [undefined, false, 'true', 1])
      expect(acceptSchema.safeParse({ terms_accepted: terms }).success).toBe(false);
    expect(acceptSchema.parse({ terms_accepted: true })).toEqual({ terms_accepted: true });
    expect(
      revisionRequestSchema.parse({ notes: '<script>secret()</script><b>Please change the quantity</b>' }).notes,
    ).toBe('Please change the quantity');
    expect(declineSchema.safeParse({ reason: 'UNKNOWN' }).success).toBe(false);
    expect(fulfillmentSchema.safeParse({ status: 'DISPATCHED', courier_name: 'DHL' }).success).toBe(false);
    expect(
      fulfillmentSchema.safeParse({ status: 'PAYMENT_RECEIVED', wire_reference: 'TT-1', amount: 6.35, currency: 'USD' })
        .success,
    ).toBe(false);
  });
  it('adds five Dhaka calendar days through month/year/leap boundaries preserving local wall time', () => {
    for (const [start, end] of [
      ['2026-12-29T20:35:12.123Z', '2027-01-03T20:35:12.123Z'],
      ['2028-02-26T20:35:00Z', '2028-03-02T20:35:00.000Z'],
    ])
      expect(addCalendarDays(new Date(start!), 5).toISOString()).toBe(end);
  });
  it('escapes hostile text and prints only allowlisted commercial fields, including for poisoned inputs', () => {
    const input = pdfFixture(true);
    Object.assign(input.version, {
      procurement_cost_bdt: 'SECRET-COST',
      markup_percent: 'SECRET-MARKUP',
      internal_procurement_notes: 'SECRET-NOTES',
    });
    Object.assign(input.version.items[0]!, { procurement_cost_bdt: 'SECRET-LINE-COST' });
    input.version.contact.full_name = '<img src="https://attacker.test/leak">';
    const html = renderQuotationHtml(input, '@font-face{font-family:local-test}');
    expect(html).not.toMatch(/SECRET-|procurement|markup|internal_procurement|<img/);
    expect(html).toContain('&lt;img');
    expect(html).toContain('测试药品');
    expect(html).toContain('ACCEPTED / PROFORMA INVOICE');
    expect(html).toContain('123456789');
    expect(html).toContain('TESTBDDH');
    expect(renderQuotationHtml(pdfFixture(), '')).not.toContain('ACCEPTED / PROFORMA INVOICE');
  });
  it('shares a 30-probe bucket across malformed magic-link routes with private headers and Retry-After', async () => {
    const app = createApp({ env: loadEnv(validEnv), logger: createLogger({ silent: true }) });
    for (let index = 0; index < 30; index++) {
      const response = await request(app).get(`/v1/public/quotation/${index % 2 ? 'token' : 'pdf'}/invalid-token`);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    }
    const limited = await request(app).post('/v1/public/quotation/accept/invalid-token').send({ terms_accepted: true });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('times out a hung render after 15 seconds, closes its context and frees the pooled slot for retry', async () => {
    await loadEmbeddedFonts();
    const page = {
      setJavaScriptEnabled: vi.fn(),
      setRequestInterception: vi.fn(),
      on: vi.fn(),
      setDefaultTimeout: vi.fn(),
      setContent: vi
        .fn()
        .mockResolvedValue(undefined)
        .mockImplementationOnce(() => new Promise<void>(() => undefined)),
      pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-test')),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi
        .fn()
        .mockResolvedValue(undefined)
        .mockImplementationOnce(() => new Promise<void>(() => undefined)),
    };
    const kill = vi.fn();
    const browser = {
      createBrowserContext: vi.fn(async () => context),
      once: vi.fn(),
      close: vi.fn(async () => undefined),
      process: vi.fn(() => ({ kill })),
    };
    const launch = vi.fn<typeof puppeteer.launch>().mockResolvedValue(browser as unknown as Browser);
    const renderer = createPdfService({ launch });
    vi.useFakeTimers();
    try {
      const rejected = expect(renderer.render(pdfFixture())).rejects.toThrow('PDF rendering failed');
      await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS + 1001);
      await rejected;
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith('SIGKILL');
      expect(await renderer.render(pdfFixture())).toEqual(Buffer.from('%PDF-test'));
      expect(launch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      await renderer.close();
    }
  });
  it.each(['/v1/admin/customers', `/v1/admin/customers/${randomUUID()}`, '/v1/admin/audit-logs', '/v1/admin/stream'])(
    'protects %s with full admin authentication',
    async (path) => {
      const response = await request(createApp({ env: loadEnv(validEnv), logger: createLogger({ silent: true }) })).get(
        path,
      );
      expect(response.status).toBe(401);
    },
  );
});
