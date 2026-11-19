import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { AdminModel, AdminSessionModel } from '../src/modules/auth/auth.schema.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import { ManufacturerModel } from '../src/modules/catalog/catalog.schema.js';
import { CustomerModel } from '../src/modules/customer/customer.schema.js';
import { ExchangeRateModel } from '../src/modules/fx/fx.schema.js';
import { createFxService, FX_TTL_MS, type FxService } from '../src/modules/fx/fx.service.js';
import { NotificationLogModel } from '../src/modules/notification/notification.schema.js';
import {
  QuotationModel,
  QuotationVersionModel,
  QuotationInternalCostModel,
  type IQuotationVersion,
} from '../src/modules/quotation/quotation.schema.js';
import { RfqModel, type IRfq } from '../src/modules/rfq/rfq.schema.js';
import { PlatformSettingModel } from '../src/modules/settings/settings.schema.js';
import { decrypt, generateToken, hashPassword, hashToken } from '../src/shared/utils/crypto.js';
import { bsonDecimal } from '../src/shared/utils/decimal.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { migrate } from '../src/scripts/migrate.js';
import { rfqRecord } from './fixtures/rfq.js';
import { validEnv } from './helpers/env.js';

const databaseName = `quote_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const env = loadEnv({
  ...validEnv,
  EXCHANGE_RATE_API_KEY: 'test-provider-key',
  QUOTATION_TOKEN_ENCRYPTION_KEY: 'cd'.repeat(32),
  QUOTATION_TOKEN_KEY_ID: 'test-quote-v1',
});
const logger = createLogger({ silent: true });
const bank = {
  configured: true,
  instructions: 'Use the quotation reference.',
  beneficiary_name: 'Test Exporter',
  bank_name: 'Test Bank',
  account_number: '123456',
  swift_code: 'TESTBDDH',
};
const provider = () =>
  new Response(
    `{"result":"success","base_code":"BDT","time_last_update_unix":${Math.floor(Date.now() / 1000)},"conversion_rates":{"BDT":1,"USD":0.01,"CNY":0.100000000000000001,"EUR":0.005}}`,
  );
const fetcher = vi.fn<typeof fetch>();
const onAlert = vi.fn();
const dispatchNotifications = vi.fn();
let app: Express;
let fx: FxService;
let cookie: string;
let passwordHash: string;
let rfq: IRfq;
let manufacturerId: string;
let adminId: string;

const pricing = () => ({
  billing_currency: 'USD',
  items: rfq.items.map((line) => ({
    rfq_item_id: line._id,
    manufacturer_id: manufacturerId,
    availability_status: 'AVAILABLE',
    procurement_cost_bdt: '120',
    markup_percent: '20',
    snapshot: {
      brand_name: 'Test Brand',
      generic_name: 'Test Generic',
      strength: '10mg',
      dosage_form: 'Tablet',
      pack_size: '10 tablets',
    },
  })),
  freight_amount: '2.50',
  insurance_amount: '0.25',
  shipping_terms: { method: 'EXPRESS_COURIER', named_place: 'Dhaka', cold_chain_required: false },
  internal_procurement_notes: 'Private sourcing information',
});
const post = (path: string, body: object = {}) =>
  request(app).post(`/v1/admin/quotations${path}`).set('Cookie', cookie).send(body);
async function draft(body = { ...pricing(), rfq_id: rfq._id }) {
  const response = await post('/draft', body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data as { quotation_id: string; version: { id: string; total_amount: string } };
}
async function issue() {
  const created = await draft();
  const response = await post(`/${created.quotation_id}/send`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return {
    ...created,
    sent: response.body.data as { magic_link_url: string; version: { id: string; total_amount: string } },
  };
}
beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_TEST_URI or MONGODB_URI for quotation integration tests');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10_000,
  });
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('quote_test_'))
    throw new Error('Refusing to migrate a non-test database');
  await migrate();
  passwordHash = await hashPassword('test-only admin password');
});
beforeEach(async () => {
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('quote_test_'))
    throw new Error('Refusing to alter a non-test database');
  for (const name of [
    'admins',
    'admin_sessions',
    'customers',
    'rfqs',
    'quotations',
    'quotation_versions',
    'quotation_internal_costs',
    'exchange_rates',
    'platform_settings',
    'notification_logs',
    'audit_logs',
    'manufacturers',
  ])
    await mongoose.connection.db!.collection(name).deleteMany({});
  const admin = await AdminModel.create({
    email: 'owner@example.test',
    password_hash: passwordHash,
    totp_secret_encrypted: 'unused',
    backup_code_hashes: [],
  });
  adminId = admin._id;
  const token = generateToken();
  await AdminSessionModel.create({
    admin_id: admin._id,
    token_hash: hashToken(token),
    purpose: 'ADMIN',
    session_generation: 0,
    last_seen_at: new Date(),
    expires_at: new Date(Date.now() + 1_800_000),
  });
  const signature = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(token).digest('base64').replace(/=+$/, '');
  cookie = `medaxis_admin_session=${encodeURIComponent(`s:${token}.${signature}`)}`;
  const manufacturer = await ManufacturerModel.create({
    translations: { en: { name: 'Test Manufacturer', slug: 'test-manufacturer' } },
    country: 'BD',
    is_active: true,
  });
  manufacturerId = manufacturer._id;
  const customer = await CustomerModel.create({
    full_name: 'Buyer',
    customer_type: 'B2C_PATIENT',
    email: 'buyer@example.test',
    preferred_locale: 'en',
    country: 'BD',
  });
  rfq = rfqRecord();
  rfq.customer_id = customer._id;
  rfq.items[0]!.quantity = 3;
  await RfqModel.create(rfq);
  for (const [currency, rate] of [
    ['USD', '120'],
    ['CNY', '16'],
    ['EUR', '130'],
  ] as const)
    await ExchangeRateModel.create({
      _id: currency,
      currency_code: currency,
      live_rate_to_bdt: bsonDecimal(rate),
      live_fetched_at: new Date(),
      mode: 'LIVE',
    });
  await PlatformSettingModel.create({ key: 'wire_instructions', value: bank, updated_by: adminId });
  fetcher.mockReset().mockImplementation(async () => provider());
  onAlert.mockReset();
  dispatchNotifications.mockReset();
  fx = createFxService(env, logger, { fetcher, onAlert });
  app = createApp({ env, logger, fx, quotationHooks: { dispatchNotifications } });
});
afterAll(async () => {
  fx?.stop();
  try {
    if (mongoose.connection.name === databaseName && databaseName.startsWith('quote_test_'))
      await mongoose.connection.db?.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

describe('FX rates and quotation lifecycle against MongoDB', () => {
  it('searches current customer snapshots and RFQ references without exposing internal pricing', async () => {
    const created = await draft();
    for (const q of ['Test Buyer', 'buyer@example.test', rfq.rfq_number]) {
      const response = await request(app).get('/v1/admin/quotations').query({ q }).set('Cookie', cookie);
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        _id: created.quotation_id,
        rfq_number: rfq.rfq_number,
        customer: { full_name: 'Test Buyer', email: 'buyer@example.test' },
        version: { status: 'DRAFT', total_amount: '6.35' },
      });
      expect(JSON.stringify(response.body.data)).not.toMatch(
        /procurement|markup|margin|token|bank_details|Private sourcing/,
      );
    }
    const literal = await request(app).get('/v1/admin/quotations').query({ q: '.*' }).set('Cookie', cookie);
    expect(literal.body.data).toEqual([]);
    const summary = await request(app).get('/v1/admin/quotations/summary').set('Cookie', cookie);
    expect(summary.body.data).toMatchObject({
      active_quotations: 1,
      drafts: 1,
      sent: 0,
      accepted_payment_pending: 0,
      ready_to_dispatch: 0,
      expiring_allocations: 0,
    });
    for (const worklist of ['AWAITING_PAYMENT', 'READY_TO_DISPATCH', 'EXPIRING']) {
      const response = await request(app).get('/v1/admin/quotations').query({ worklist }).set('Cookie', cookie);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    }
  });

  it('keeps payment and dispatch work queues consistent with summary counts and reservation deadlines', async () => {
    const { quotation_id: id, version } = await draft();
    const get = (path: string) => request(app).get(`/v1/admin/quotations${path}`).set('Cookie', cookie);
    // Set lifecycle states directly to exercise read boundaries without issuing notifications.
    const deadline = new Date(Date.now() + 3600000);
    await QuotationVersionModel.updateOne(
      { _id: version.id },
      {
        $set: {
          status: 'ACCEPTED',
          accepted_at: new Date(),
          reservation_status: 'ACTIVE',
          reservation_expires_at: deadline,
        },
      },
    );
    expect((await get('/summary')).body.data).toMatchObject({
      accepted_payment_pending: 1,
      ready_to_dispatch: 0,
      expiring_allocations: 1,
    });
    for (const worklist of ['AWAITING_PAYMENT', 'EXPIRING'])
      expect((await get(`?worklist=${worklist}`)).body.data.map((row: { _id: string }) => row._id)).toEqual([id]);
    await QuotationVersionModel.updateOne(
      { _id: version.id },
      { $set: { reservation_expires_at: new Date(Date.now() - 1000) } },
    );
    expect((await get('?worklist=AWAITING_PAYMENT')).body.data).toEqual([]);
    expect((await get('/summary')).body.data).toMatchObject({ accepted_payment_pending: 0, expiring_allocations: 0 });
    await QuotationVersionModel.updateOne(
      { _id: version.id },
      {
        $set: {
          status: 'PAYMENT_RECEIVED',
          reservation_status: 'CONSUMED',
          payment: {
            reference: 'verified-wire',
            amount: bsonDecimal('6.35'),
            currency: 'USD',
            received_at: new Date(),
            recorded_by: adminId,
          },
        },
      },
    );
    expect((await get('?worklist=READY_TO_DISPATCH')).body.data.map((row: { _id: string }) => row._id)).toEqual([id]);
    expect((await get('/summary')).body.data.ready_to_dispatch).toBe(1);
    await QuotationModel.updateOne({ _id: id }, { $set: { overall_status: 'COMPLETED' } });
    expect((await get('?worklist=READY_TO_DISPATCH')).body.data).toEqual([]);
    expect((await get('/summary')).body.data).toMatchObject({
      active_quotations: 0,
      drafts: 0,
      sent: 0,
      ready_to_dispatch: 0,
    });
  });

  it('calculates a draft on the server, isolates internal costs and rejects a second active quotation', async () => {
    const created = await draft();
    expect(created.version.total_amount).toBe('6.35');
    expect(JSON.stringify(created.version)).not.toMatch(/procurement|markup|margin|Private sourcing/);
    const costs = await QuotationInternalCostModel.findOne({ quotation_version_id: created.version.id }).lean();
    expect(costs?.procurement_cost_bdt.toString()).toBe('360.00000000');
    expect(costs?.gross_margin_bdt?.toString()).toBe('72.00000000');
    expect((await post('/draft', { ...pricing(), rfq_id: rfq._id })).status).toBe(409);
    expect(await QuotationModel.countDocuments()).toBe(1);
    expect((await QuotationVersionModel.findById(created.version.id).lean())?.fx_snapshot).toBeUndefined();
  });

  it('locks issue-time rates, hashes the token, queues encrypted email/PDF work, and keeps costs out of versions', async () => {
    const { quotation_id: id, version, sent } = await issue();
    const token = new URL(sent.magic_link_url).pathname.split('/').at(-1)!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const stored = await QuotationVersionModel.findById(version.id).select('+magic_link_token_hash').lean();
    expect(stored?.magic_link_token_hash).toBe(hashToken(token));
    expect(stored?.magic_link_token_hash).not.toBe(token);
    const bson = await mongoose.connection
      .db!.collection<IQuotationVersion>('quotation_versions')
      .findOne({ _id: version.id });
    expect(bson).not.toBeNull();
    expect(JSON.stringify(bson)).not.toMatch(/"[^"\n]*(?:procurement|markup|margin|internal_cost)[^"\n]*"\s*:/i);
    expect(stored?.fx_snapshot?.rates_to_bdt.USD.toString()).toBe('120');
    expect(stored?.fx_snapshot?.modes?.USD).toBe('LIVE');
    expect(sent.version).toMatchObject({ bank_details: bank });
    expect((await RfqModel.findById(rfq._id).lean())?.status).toBe('QUOTED');
    expect(await NotificationLogModel.countDocuments({ kind: 'PDF_RENDER' })).toBe(1);
    const email = await NotificationLogModel.findOne({ kind: 'EMAIL', template_id: 'quotation-sent' }).lean();
    expect(
      decrypt(
        email?.safe_payload.delivery,
        Buffer.from(env.QUOTATION_TOKEN_ENCRYPTION_KEY!, 'hex'),
        env.QUOTATION_TOKEN_KEY_ID!,
      ).toString(),
    ).toBe(sent.magic_link_url);
    // Inspect every persisted collection, including the append-only audit/outbox records.
    for (const collection of await mongoose.connection.db!.collections()) {
      const text = JSON.stringify(await collection.find({}).toArray());
      expect(text, collection.collectionName).not.toContain(token);
      expect(text, collection.collectionName).not.toContain(sent.magic_link_url);
    }
    const detail = await request(app).get(`/v1/admin/quotations/${id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body.data.versions)).not.toMatch(
      /procurement|markup|margin|magic_link_token_hash|Private sourcing/,
    );
    expect(detail.body.data.internal_costs[0].internal_procurement_notes).toBe('Private sourcing information');
    expect(dispatchNotifications).toHaveBeenCalledTimes(1);
    await ExchangeRateModel.updateOne({ _id: 'USD' }, { $set: { live_rate_to_bdt: bsonDecimal('240') } });
    expect((await QuotationVersionModel.findById(version.id).lean())?.total_amount.toString()).toBe('6.35');
    await expect(
      QuotationVersionModel.updateOne(
        { _id: version.id },
        { $set: { 'fx_snapshot.rates_to_bdt.USD': bsonDecimal('240') } },
      ),
    ).rejects.toThrow('Locked FX rates are immutable');
    const issuedDoc = await QuotationVersionModel.findById(version.id);
    expect(issuedDoc?.locked_fx_rates?.rates_to_bdt.USD.toString()).toBe('120');
    issuedDoc!.locked_fx_rates!.rates_to_bdt.USD = bsonDecimal('240');
    await expect(issuedDoc!.save()).rejects.toThrow('Locked FX rates are immutable');
    await expect(
      QuotationVersionModel.updateOne({ _id: version.id }, { $unset: { locked_fx_rates: 1 } }),
    ).rejects.toThrow('Use canonical fx_snapshot field');
    const unchanged = await QuotationVersionModel.findById(version.id).lean();
    expect(unchanged?.fx_snapshot?.rates_to_bdt.USD.toString()).toBe('120');
    expect(unchanged?.total_amount.toString()).toBe('6.35');
    await expect(
      mongoose.connection.transaction(async (session) => {
        const costs = await QuotationInternalCostModel.findOne({ quotation_version_id: version.id }).session(session);
        costs!.procurement_cost_bdt = bsonDecimal('1');
        await costs!.save({ session });
      }),
    ).rejects.toThrow();
  });

  it('recalculates a draft at the active issue-time rate before freezing its commercial and cost snapshots', async () => {
    const created = await draft();
    await ExchangeRateModel.updateOne({ _id: 'USD' }, { $set: { live_rate_to_bdt: bsonDecimal('240') } });
    const response = await post(`/${created.quotation_id}/send`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.version.items[0].unit_quoted_price).toBe('0.60');
    expect(response.body.data.version.total_amount).toBe('4.55');
    expect(
      (
        await QuotationInternalCostModel.findOne({ quotation_version_id: created.version.id }).lean()
      )?.gross_margin_bdt?.toString(),
    ).toBe('72.00000000');
  });

  it('excludes unavailable lines from all payable and internal cost totals', async () => {
    const second = { ...rfq.items[0]!, _id: randomUUID(), quantity: 999 };
    rfq.items.push(second);
    await RfqModel.updateOne({ _id: rfq._id }, { $push: { items: second } });
    const body = { ...pricing(), rfq_id: rfq._id };
    Object.assign(body.items[1]!, {
      availability_status: 'UNAVAILABLE',
      procurement_cost_bdt: '999999',
      customer_facing_note: 'Not available',
    });
    const created = await draft(body);
    expect(created.version.total_amount).toBe('6.35');
    const costs = await QuotationInternalCostModel.findOne({ quotation_version_id: created.version.id }).lean();
    expect(costs?.items).toHaveLength(1);
    const sent = await post(`/${created.quotation_id}/send`);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.data.version.items[1].unit_quoted_price).toBeUndefined();
  });

  it('rolls issuance back if bank instructions are missing or the outbox cannot be committed', async () => {
    const created = await draft();
    await PlatformSettingModel.deleteOne({ key: 'wire_instructions' });
    expect((await post(`/${created.quotation_id}/send`)).status).toBe(422);
    await PlatformSettingModel.create({ key: 'wire_instructions', value: bank, updated_by: adminId });
    const fail = vi
      .spyOn(NotificationLogModel.prototype, 'save')
      .mockRejectedValueOnce(new Error('test outbox failure'));
    try {
      expect((await post(`/${created.quotation_id}/send`)).status).toBe(500);
    } finally {
      fail.mockRestore();
    }
    const version = await QuotationVersionModel.findById(created.version.id).select('+magic_link_token_hash').lean();
    expect(version?.status).toBe('DRAFT');
    expect(version?.fx_snapshot).toBeUndefined();
    expect(version?.magic_link_token_hash).toBeUndefined();
    expect((await RfqModel.findById(rfq._id).lean())?.status).toBe('SUBMITTED');
    expect(await NotificationLogModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_SENT' })).toBe(0);
  });

  it('supports cached fallback, exposes staleness and can opt into requiring fresh rates', async () => {
    await ExchangeRateModel.updateMany({}, { $set: { live_fetched_at: new Date(Date.now() - FX_TTL_MS - 1000) } });
    const created = await draft();
    const rates = await request(app).get('/v1/admin/fx-rates').set('Cookie', cookie);
    expect(rates.body.data.rates.every((rate: { stale: boolean }) => rate.stale)).toBe(true);
    expect((await post(`/${created.quotation_id}/send`, { allow_stale_fx: false })).status).toBe(409);
    expect((await post(`/${created.quotation_id}/send`)).status).toBe(200);
    expect((await QuotationVersionModel.findById(created.version.id).lean())?.fx_snapshot?.stale_rates_used).toBe(true);
  });

  it('configures manual rates, refreshes live data without changing the selected mode, and uses exact inversion', async () => {
    const changed = await request(app)
      .patch('/v1/admin/fx-rates')
      .set('Cookie', cookie)
      .send({ rates: [{ currency: 'USD', active_mode: 'MANUAL_FIXED', manual_rate_to_bdt: '122.1234567890123456' }] });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(
      changed.body.data.rates.find((rate: { currency: string }) => rate.currency === 'USD').active_rate_to_bdt,
    ).toBe('122.1234567890123456');
    expect(await fx.refresh()).toBe(true);
    const row = await ExchangeRateModel.findById('USD').lean();
    expect(row?.mode).toBe('MANUAL_FIXED');
    expect(row?.live_rate_to_bdt.toString()).toBe('100');
    expect(row?.manual_rate_to_bdt?.toString()).toBe('122.1234567890123456');
    // A JSON.parse/Number round-trip would produce 10 and lose this precision.
    expect((await ExchangeRateModel.findById('CNY').lean())?.live_rate_to_bdt.toString()).toBe('9.9999999999999999');
    const active = (await fx.inspect()).rates.find((rate) => rate.currency === 'USD');
    expect(active && 'active_rate_to_bdt' in active ? active.active_rate_to_bdt : undefined).toBe(
      '122.1234567890123456',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      (
        await request(app)
          .patch('/v1/admin/fx-rates')
          .set('Cookie', cookie)
          .send({ rates: [{ currency: 'EUR', active_mode: 'MANUAL_FIXED' }] })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .patch('/v1/admin/fx-rates')
          .set('Cookie', cookie)
          .send({ rates: [{ currency: 'USD', active_mode: 'LIVE', manual_rate_to_bdt: '10001' }] })
      ).status,
    ).toBe(422);
  });

  it('rejects a corrupt provider batch, keeps last good DB/cache values and alerts only once per hour', async () => {
    await fx.hydrate();
    fetcher.mockImplementation(
      async () =>
        new Response(
          `{"result":"success","base_code":"BDT","time_last_update_unix":${Math.floor(Date.now() / 1000)},"conversion_rates":{"BDT":1,"USD":0.01,"CNY":0,"EUR":0.005}}`,
        ),
    );
    expect(await fx.refresh()).toBe(false);
    expect(await fx.refresh()).toBe(false);
    expect((await ExchangeRateModel.findById('USD').lean())?.live_rate_to_bdt.toString()).toBe('120');
    expect(fx.cache.get('USD')?.live_rate_to_bdt).toBe('120');
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(await NotificationLogModel.countDocuments({ template_id: 'fx-rate-alert' })).toBe(1);
    expect((await fx.inspect()).last_error_code).toBe('FX_PROVIDER_REJECTED');
  });

  it('serves cached data through an outage and schedules one unrefed hourly refresh until stopped', async () => {
    const unref = vi.fn();
    const timer = { unref } as unknown as ReturnType<typeof setInterval>;
    const interval = vi.spyOn(globalThis, 'setInterval').mockReturnValue(timer);
    const clear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    try {
      await fx.start();
      expect(interval).toHaveBeenCalledWith(expect.any(Function), FX_TTL_MS);
      expect(unref).toHaveBeenCalledTimes(1);
      fetcher.mockRejectedValue(new Error('test provider outage'));
      const tick = interval.mock.calls[0]![0] as () => void;
      tick();
      // Joins the scheduled request, verifying refresh calls are coalesced.
      expect(await fx.refresh()).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fx.cache.get('USD')?.live_rate_to_bdt).toBe('100');
      expect((await ExchangeRateModel.findById('USD').lean())?.live_rate_to_bdt.toString()).toBe('100');
      fx.stop();
      expect(clear).toHaveBeenCalledWith(timer);
    } finally {
      fx.stop();
      interval.mockRestore();
      clear.mockRestore();
    }
  });

  it('uses configured manual fallback even when all provider timestamps are stale', async () => {
    await ExchangeRateModel.updateMany(
      {},
      { $set: { live_fetched_at: new Date(0), mode: 'MANUAL_FIXED', manual_rate_to_bdt: bsonDecimal('144') } },
    );
    const created = await draft();
    const response = await post(`/${created.quotation_id}/send`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.version.items[0].unit_quoted_price).toBe('1.00');
    const version = await QuotationVersionModel.findById(created.version.id).lean();
    expect(version?.fx_snapshot?.mode).toBe('MANUAL_FIXED');
    expect(version?.fx_snapshot?.stale_rates_used).toBe(false);
  });

  it('creates v2, supersedes only v1, invalidates old queued work and preserves the old financial snapshot', async () => {
    const issued = await issue();
    const revised = await post(`/${issued.quotation_id}/revise`, {
      ...pricing(),
      expected_current_version_id: issued.version.id,
      freight_amount: '10',
    });
    expect(revised.status, JSON.stringify(revised.body)).toBe(201);
    expect(revised.body.data.version.version_number).toBe(2);
    expect(revised.body.data.version.status).toBe('DRAFT');
    expect((await QuotationVersionModel.findById(issued.version.id).lean())?.status).toBe('SUPERSEDED');
    expect((await QuotationVersionModel.findById(issued.version.id).lean())?.total_amount.toString()).toBe('6.35');
    expect((await QuotationModel.findById(issued.quotation_id).lean())?.current_version_id).toBe(
      revised.body.data.version.id,
    );
    expect(await QuotationInternalCostModel.countDocuments()).toBe(2);
    expect(await NotificationLogModel.countDocuments({ entity_id: issued.version.id, status: 'PENDING' })).toBe(0);
    expect(
      (await post(`/${issued.quotation_id}/send`, { expected_version_id: revised.body.data.version.id })).status,
    ).toBe(200);
  });

  it('can issue a revision directly and serializes two concurrent revisions against the expected current version', async () => {
    const issued = await issue();
    const body = { ...pricing(), expected_current_version_id: issued.version.id, issue_immediately: true };
    const responses = await Promise.all([
      post(`/${issued.quotation_id}/revise`, body),
      post(`/${issued.quotation_id}/revise`, body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const success = responses.find((response) => response.status === 201)!;
    expect(success.body.data.version.status).toBe('SENT');
    expect(success.body.data.magic_link_url).toMatch(/\/q\/[a-f0-9]{64}$/);
    expect(await QuotationVersionModel.countDocuments()).toBe(2);
    expect((await QuotationModel.findById(issued.quotation_id).lean())?.current_version).toBe(2);
    expect(await NotificationLogModel.countDocuments({ kind: 'PDF_RENDER', status: 'PENDING' })).toBe(1);
  });

  it('rolls back the v2 pointer, supersession and new cost/version records when revision fails after those writes', async () => {
    const issued = await issue();
    // This operation runs after v2 creation, parent pointer update and v1 supersession.
    const failure = vi.spyOn(NotificationLogModel, 'updateMany').mockImplementationOnce(() => {
      throw new Error('test revision outbox failure');
    });
    try {
      const response = await post(`/${issued.quotation_id}/revise`, {
        ...pricing(),
        expected_current_version_id: issued.version.id,
      });
      expect(response.status).toBe(500);
    } finally {
      failure.mockRestore();
    }
    const parent = await QuotationModel.findById(issued.quotation_id).lean();
    expect(parent?.current_version).toBe(1);
    expect(parent?.current_version_id).toBe(issued.version.id);
    expect((await QuotationVersionModel.findById(issued.version.id).lean())?.status).toBe('SENT');
    expect(await QuotationVersionModel.countDocuments()).toBe(1);
    expect(await QuotationInternalCostModel.countDocuments()).toBe(1);
    expect(await NotificationLogModel.countDocuments({ entity_id: issued.version.id, status: 'PENDING' })).toBe(2);
    expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_REVISED' })).toBe(0);
    expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_DRAFT_CREATED' })).toBe(1);
  });

  it('rotates a resend token immediately without mutating prices or adding another PDF job', async () => {
    const issued = await issue();
    const response = await post(`/${issued.quotation_id}/resend`, { expected_version_id: issued.version.id });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const url = response.body.data.magic_link_url as string;
    expect(url).not.toBe(issued.sent.magic_link_url);
    const current = await QuotationVersionModel.findById(issued.version.id).select('+magic_link_token_hash').lean();
    expect(current?.magic_link_token_hash).toBe(hashToken(new URL(url).pathname.split('/').at(-1)!));
    expect(current?.magic_link_token_hash).not.toBe(
      hashToken(new URL(issued.sent.magic_link_url).pathname.split('/').at(-1)!),
    );
    expect(current?.total_amount.toString()).toBe('6.35');
    expect(await NotificationLogModel.countDocuments({ kind: 'PDF_RENDER' })).toBe(1);
    expect(await NotificationLogModel.countDocuments({ kind: 'EMAIL', status: 'PENDING' })).toBe(1);
    expect(
      (await NotificationLogModel.findOne({ template_id: 'quotation-sent' }).lean())?.safe_payload.delivery,
    ).toBeUndefined();
  });

  it('cannot revise or resend an accepted quotation or use an outdated expected version', async () => {
    const issued = await issue();
    expect((await post(`/${issued.quotation_id}/resend`, { expected_version_id: randomUUID() })).status).toBe(409);
    await QuotationVersionModel.updateOne({ _id: issued.version.id, status: 'SENT' }, { $set: { status: 'ACCEPTED' } });
    expect(
      (await post(`/${issued.quotation_id}/revise`, { ...pricing(), expected_current_version_id: issued.version.id }))
        .status,
    ).toBe(409);
    expect((await post(`/${issued.quotation_id}/resend`)).status).toBe(409);
    expect(await QuotationVersionModel.countDocuments()).toBe(1);
  });

  it('serializes a revision against the documented buyer-acceptance transaction without accepting a superseded version', async () => {
    const issued = await issue();
    // Exercise the Step 7 write contract without introducing its public endpoint.
    const accept = () =>
      mongoose.connection.transaction(async (session) => {
        const parent = await QuotationModel.findOne({
          _id: issued.quotation_id,
          current_version_id: issued.version.id,
          overall_status: 'ACTIVE',
        })
          .session(session)
          .lean();
        if (!parent) return false;
        const accepted = await QuotationVersionModel.updateOne(
          { _id: issued.version.id, status: 'SENT', valid_until: { $gt: new Date() } },
          { $set: { status: 'ACCEPTED' } },
          { session },
        );
        if (!accepted.matchedCount) return false;
        await QuotationModel.updateOne(
          { _id: parent._id, current_version_id: issued.version.id },
          { $set: { updated_at: new Date() } },
          { session },
        );
        await RfqModel.updateOne({ _id: rfq._id }, { $set: { status: 'CONVERTED' } }, { session });
        return true;
      });
    const [accepted, revised] = await Promise.all([
      accept(),
      post(`/${issued.quotation_id}/revise`, {
        ...pricing(),
        expected_current_version_id: issued.version.id,
        issue_immediately: true,
      }),
    ]);
    const parent = await QuotationModel.findById(issued.quotation_id).lean();
    const old = await QuotationVersionModel.findById(issued.version.id).lean();
    if (accepted) {
      expect(revised.status).toBe(409);
      expect(parent?.current_version_id).toBe(issued.version.id);
      expect(old?.status).toBe('ACCEPTED');
      expect(await QuotationVersionModel.countDocuments()).toBe(1);
    } else {
      expect(revised.status, JSON.stringify(revised.body)).toBe(201);
      expect(parent?.current_version_id).toBe(revised.body.data.version.id);
      expect(old?.status).toBe('SUPERSEDED');
      expect(await QuotationVersionModel.countDocuments()).toBe(2);
    }
  });
});
