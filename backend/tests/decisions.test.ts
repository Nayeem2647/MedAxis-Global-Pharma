import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
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
