import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
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
import { NotificationLogModel } from '../src/modules/notification/notification.schema.js';
import {
  QuotationModel,
  QuotationVersionModel,
  type IQuotationVersion,
} from '../src/modules/quotation/quotation.schema.js';
import { quotationEvents } from '../src/modules/quotation/quotation.service.js';
import { RfqModel, ClarificationMessageModel, type IRfq } from '../src/modules/rfq/rfq.schema.js';
import { rfqEvents } from '../src/modules/rfq/rfq.events.js';
import { PrescriptionModel } from '../src/modules/storage/storage.schema.js';
import { PlatformSettingModel } from '../src/modules/settings/settings.schema.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { createPdfRuntime } from '../src/modules/pdf/pdf.worker.js';
import type { PdfInput } from '../src/modules/pdf/pdf.template.js';
import { createAdminStream } from '../src/modules/admin/admin.stream.js';
import { generateToken, hashPassword, hashToken } from '../src/shared/utils/crypto.js';
import { bsonDecimal } from '../src/shared/utils/decimal.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { migrate } from '../src/scripts/migrate.js';
import { rfqRecord } from './fixtures/rfq.js';
import { s3EnvSettings, validEnv } from './helpers/env.js';

const databaseName = `decision_test_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const env = loadEnv({
  ...validEnv,
  ...s3EnvSettings,
  QUOTATION_TOKEN_ENCRYPTION_KEY: 'ce'.repeat(32),
  QUOTATION_TOKEN_KEY_ID: 'test-delivery',
  S3_BUCKET_QUOTES: 'test-private-quotes',
  WEBHOOK_HMAC_SECRET: 'test-reply-hmac',
});
const logger = createLogger({ silent: true });
const blobs = new Map<string, Buffer>();
const s3 = vi.fn(async (command: unknown) => {
  if (command instanceof PutObjectCommand) blobs.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
  if (command instanceof DeleteObjectCommand) blobs.delete(command.input.Key!);
  if (command instanceof GetObjectCommand) {
    const buffer = blobs.get(command.input.Key!);
    if (!buffer) throw new Error('not found');
    return { Body: Readable.from([buffer]) };
  }
  return {};
});
const storage = createStorageService(env, { send: s3 } as unknown as Pick<S3Client, 'send'>);
const renderer = {
  render: vi.fn(async (_input: PdfInput) => Buffer.from('%PDF-1.7\ntest commercial PDF')),
  close: vi.fn(async () => undefined),
};
const dispatch = vi.fn();
const onAccepted = vi.fn();
let runtime: ReturnType<typeof createPdfRuntime>;
let stream: ReturnType<typeof createAdminStream>;
let app: Express;
let cookie: string;
let passwordHash: string;
let rfq: IRfq;
let manufacturerId: string;
let sessionId: string;
const bank = {
  configured: true,
  instructions: 'Use quotation reference',
  beneficiary_name: 'Exporter',
  bank_name: 'Test Bank',
  account_number: '123456',
  swift_code: 'TESTBDDH',
};
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
});
const adminPost = (path: string, body: object = {}) =>
  request(app).post(`/v1/admin/quotations${path}`).set('Cookie', cookie).send(body);
const publicPost = (operation: string, token: string, body: object = {}) =>
  request(app).post(`/v1/public/quotation/${operation}/${token}`).send(body);
async function issued() {
  const draft = await adminPost('/draft', { ...pricing(), rfq_id: rfq._id });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const id = draft.body.data.quotation_id as string;
  const send = await adminPost(`/${id}/send`);
  expect(send.status, JSON.stringify(send.body)).toBe(200);
  return {
    id,
    versionId: send.body.data.version.id as string,
    token: new URL(send.body.data.magic_link_url).pathname.split('/').at(-1)!,
  };
}
async function accepted() {
  const quote = await issued();
  const response = await publicPost('accept', quote.token, { terms_accepted: true });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { ...quote, response };
}
async function stagedPrescription() {
  return PrescriptionModel.create({
    rfq_id: rfq._id,
    customer_id: rfq.customer_id,
    mime_type: 'application/pdf',
    file_size_bytes: 100,
    uploaded_at: new Date(),
    purge_scheduled_at: new Date(Date.now() + 90 * 86400000),
    purge_status: 'ACTIVE',
  });
}
const fulfill = (id: string, body: object) =>
  request(app).patch(`/v1/admin/quotations/${id}/fulfillment`).set('Cookie', cookie).send(body);
const payment = { status: 'PAYMENT_RECEIVED', wire_reference: 'TT-TEST-1', amount: '6.35', currency: 'USD' };

beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Configure a MongoDB replica-set URI for decision integration tests');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('decision_test_'))
    throw new Error('Refusing to migrate a non-test database');
  await migrate();
  passwordHash = await hashPassword('test-only admin password');
});
beforeEach(async () => {
  quotationEvents.off('QUOTATION_ACCEPTED', onAccepted);
  stream?.close();
  await runtime?.close();
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('decision_test_'))
    throw new Error('Refusing to modify a non-test database');
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
    'prescriptions',
    'clarification_messages',
  ])
    await mongoose.connection.db!.collection(name).deleteMany({});
  const admin = await AdminModel.create({
    email: 'owner@example.test',
    password_hash: passwordHash,
    totp_secret_encrypted: 'unused',
    backup_code_hashes: [],
  });
  const token = generateToken();
  const session = await AdminSessionModel.create({
    admin_id: admin._id,
    token_hash: hashToken(token),
    purpose: 'ADMIN',
    session_generation: 0,
    last_seen_at: new Date(),
    expires_at: new Date(Date.now() + 1800000),
  });
  sessionId = session._id;
  const signature = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(token).digest('base64').replace(/=+$/, '');
  cookie = `medaxis_admin_session=${encodeURIComponent(`s:${token}.${signature}`)}`;
  manufacturerId = (
    await ManufacturerModel.create({
      translations: { en: { name: 'Test Manufacturer', slug: 'test-manufacturer' } },
      country: 'BD',
      is_active: true,
    })
  )._id;
  const customer = await CustomerModel.create({
    full_name: 'Test Buyer',
    customer_type: 'B2C_PATIENT',
    email: 'buyer@example.test',
    preferred_locale: 'en',
    country: 'BD',
  });
  rfq = rfqRecord();
  rfq.customer_id = customer._id;
  rfq.items[0]!.quantity = 3;
  await RfqModel.create(rfq);
  for (const [code, value] of [
    ['USD', '120'],
    ['CNY', '16'],
    ['EUR', '130'],
  ] as const)
    await ExchangeRateModel.create({
      _id: code,
      currency_code: code,
      live_rate_to_bdt: bsonDecimal(value),
      live_fetched_at: new Date(),
      mode: 'LIVE',
    });
  await PlatformSettingModel.create({ key: 'wire_instructions', value: bank, updated_by: admin._id });
  blobs.clear();
  s3.mockClear();
  renderer.render.mockClear();
  dispatch.mockClear();
  onAccepted.mockClear();
  runtime = createPdfRuntime(env, logger, { storage, renderer });
  stream = createAdminStream(logger);
  app = createApp({
    env,
    logger,
    pdf: { get: runtime.get, dispatch },
    adminStream: stream,
    quotationHooks: { dispatchNotifications: dispatch },
    decisionHooks: { dispatchNotifications: dispatch, dispatchPdf: dispatch },
  });
  quotationEvents.on('QUOTATION_ACCEPTED', onAccepted);
});
afterAll(async () => {
  stream?.close();
  await runtime?.close();
  quotationEvents.off('QUOTATION_ACCEPTED', onAccepted);
  try {
    if (mongoose.connection.name === databaseName && databaseName.startsWith('decision_test_'))
      await mongoose.connection.db?.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

describe('magic-link decisions, fulfillment and operations', () => {
  it('exposes commercial details and bank instructions with private headers, never hashes or internal costs', async () => {
    const quote = await issued();
    const response = await request(app).get(`/v1/public/quotation/token/${quote.token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.total_amount).toBe('6.35');
    expect(response.body.data.bank_details).toEqual(bank);
    expect(response.body.data.availability.available).toBe(1);
    expect(response.body.data.validity_remaining_seconds).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toMatch(
      /procurement|markup|margin|token_hash|acceptance_evidence|recorded_by|object_key/,
    );
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toContain('noindex');
    const invalid = await request(app).get(`/v1/public/quotation/token/${generateToken()}`);
    expect(invalid.status).toBe(404);
    expect(invalid.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('requires explicit terms and atomically accepts concurrent clicks once without extending reservation deadlines', async () => {
    const quote = await issued();
    expect((await publicPost('accept', quote.token, { terms_accepted: false })).status).toBe(422);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => publicPost('accept', quote.token, { terms_accepted: true })),
    );
    for (const response of responses) expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(responses.filter((response) => !response.body.data.already_accepted)).toHaveLength(1);
    const version = await QuotationVersionModel.findById(quote.versionId).lean();
    expect(version?.status).toBe('ACCEPTED');
    expect(version?.reservation_status).toBe('ACTIVE');
    expect(version?.acceptance_evidence?.terms_accepted).toBe(true);
    expect(new Set(responses.map((response) => response.body.data.reservation_expires_at))).toEqual(
      new Set([version?.reservation_expires_at?.toISOString()]),
    );
    expect(version!.reservation_expires_at!.getTime() - version!.accepted_at!.getTime()).toBe(5 * 86400000);
    expect((await RfqModel.findById(rfq._id).lean())?.status).toBe('CONVERTED');
    expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_ACCEPTED' })).toBe(1);
    for (const template of ['accepted', 'admin-accepted-alert'])
      expect(await NotificationLogModel.countDocuments({ template_id: template })).toBe(1);
    expect(
      await NotificationLogModel.countDocuments({ dedupe_key: `quotation-pdf:${quote.versionId}:ACCEPTED_QUOTE` }),
    ).toBe(1);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    const repeated = await publicPost('accept', quote.token, { terms_accepted: true });
    expect(repeated.body.data.reservation_expires_at).toBe(version?.reservation_expires_at?.toISOString());
  });

  it('rejects a superseded or rotated link without any buyer decision side effects', async () => {
    const quote = await issued();
    const rotated = await adminPost(`/${quote.id}/resend`);
    expect(rotated.status).toBe(200);
    expect((await publicPost('accept', quote.token, { terms_accepted: true })).status).toBe(404);
    const token = new URL(rotated.body.data.magic_link_url).pathname.split('/').at(-1)!;
    expect(
      (
        await adminPost(`/${quote.id}/revise`, {
          ...pricing(),
          expected_current_version_id: quote.versionId,
          issue_immediately: true,
        })
      ).status,
    ).toBe(201);
    const conflict = await publicPost('accept', token, { terms_accepted: true });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('QUOTATION_VERSION_CONFLICT');
    expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_ACCEPTED' })).toBe(0);
  });

  it.each([1, 2, 3])(
    'serializes the real acceptance endpoint against a simultaneous direct revision (race %i)',
    async () => {
      const quote = await issued();
      const errors = vi.spyOn(logger, 'error');
      const [accepted, revised] = await Promise.all([
        publicPost('accept', quote.token, { terms_accepted: true }),
        adminPost(`/${quote.id}/revise`, {
          ...pricing(),
          expected_current_version_id: quote.versionId,
          issue_immediately: true,
        }),
      ]);
      const diagnostic = JSON.stringify(errors.mock.calls);
      errors.mockRestore();
      expect([accepted.status, revised.status].sort(), diagnostic).toEqual(
        accepted.status === 200 ? [200, 409] : [201, 409],
      );
      const parent = await QuotationModel.findById(quote.id).lean();
      const old = await QuotationVersionModel.findById(quote.versionId).lean();
      if (accepted.status === 200) {
        expect(parent?.current_version_id).toBe(quote.versionId);
        expect(old?.status).toBe('ACCEPTED');
        expect(parent?.current_version).toBe(1);
        expect(await QuotationVersionModel.countDocuments({ quotation_id: quote.id })).toBe(1);
        expect((await RfqModel.findById(rfq._id).lean())?.status).toBe('CONVERTED');
        expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_ACCEPTED' })).toBe(1);
      } else {
        expect(old?.status).toBe('SUPERSEDED');
        expect(parent?.current_version).toBe(2);
        expect(parent?.current_version_id).toBe(revised.body.data.version.id);
        expect((await QuotationVersionModel.findById(parent?.current_version_id).lean())?.status).toBe('SENT');
        expect(await QuotationVersionModel.countDocuments({ quotation_id: quote.id })).toBe(2);
        expect((await RfqModel.findById(rfq._id).lean())?.status).toBe('QUOTED');
        expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_ACCEPTED' })).toBe(0);
      }
    },
  );

  it('enforces expiry at request time before any TTL/job cleanup and permits an expired refresh request', async () => {
    const quote = await issued();
    await mongoose.connection
      .db!.collection<IQuotationVersion>('quotation_versions')
      .updateOne({ _id: quote.versionId }, { $set: { valid_until: new Date(Date.now() - 1000) } });
    const response = await publicPost('accept', quote.token, { terms_accepted: true });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('QUOTATION_TOKEN_EXPIRED');
    expect((await publicPost('request-refresh', quote.token, { notes: 'Please send a new quotation' })).status).toBe(
      200,
    );
    expect((await QuotationVersionModel.findById(quote.versionId).lean())?.status).toBe('VALIDITY_EXPIRED');
    expect((await QuotationModel.findById(quote.id).lean())?.overall_status).toBe('EXPIRED');
    expect(await NotificationLogModel.countDocuments({ template_id: 'refresh-request' })).toBe(1);
    expect((await request(app).get(`/v1/public/quotation/pdf/${quote.token}`)).status).toBe(403);
  });

  it('retries a forced transient write conflict without adding __v to strict nested quotation documents', async () => {
    const quote = await issued();
    const source = (await QuotationVersionModel.findById(quote.versionId).lean())!;
    const newId = randomUUID();
    let attempts = 0;
    await mongoose.connection.transaction(async (session) => {
      await new QuotationVersionModel({
        ...source,
        _id: newId,
        status: 'DRAFT',
        version_number: 2,
        fx_snapshot: undefined,
        issued_at: undefined,
        valid_until: undefined,
      }).save({ session });
      attempts++;
      if (attempts === 1)
        throw new mongoose.mongo.MongoServerError({
          message: 'test transient write conflict',
          code: 112,
          errorLabels: ['TransientTransactionError'],
        });
    });
    expect(attempts).toBe(2);
    expect(await QuotationVersionModel.countDocuments({ _id: newId })).toBe(1);
    expect(JSON.stringify(await QuotationVersionModel.findById(newId).lean())).not.toContain('"__v"');
    expect((await QuotationVersionModel.findById(quote.versionId).lean())?.status).toBe('SENT');
  });

  it('rolls back a failed acceptance and writes sanitized local/audit diagnostics, alerting only after three consecutive failures', async () => {
    const quote = await issued();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const fail = vi.spyOn(NotificationLogModel, 'updateOne').mockImplementationOnce(() => {
        throw new Error(`driver leaked token ${quote.token}`);
      });
      try {
        const response = await publicPost('accept', quote.token, { terms_accepted: true });
        expect(response.status).toBe(500);
        expect(response.body.error.message).toBe("We couldn't confirm your acceptance. Please try again.");
      } finally {
        fail.mockRestore();
      }
      expect((await QuotationVersionModel.findById(quote.versionId).lean())?.status).toBe('SENT');
      expect((await RfqModel.findById(rfq._id).lean())?.status).toBe('QUOTED');
      expect(await NotificationLogModel.countDocuments({ template_id: 'accepted' })).toBe(0);
      expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_ACCEPTED' })).toBe(0);
      expect(await NotificationLogModel.countDocuments({ template_id: 'acceptance-failure-alert' })).toBe(
        attempt === 3 ? 1 : 0,
      );
    }
    try {
      expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_ACCEPTANCE_FAILED' })).toBe(3);
      expect(JSON.stringify(stderr.mock.calls)).not.toContain(quote.token);
    } finally {
      stderr.mockRestore();
    }
    expect((await publicPost('accept', quote.token, { terms_accepted: true })).status).toBe(200);
  });

  it('sanitizes and threads buyer revision notes without logging their text', async () => {
    const quote = await issued();
    const response = await publicPost('request-revision', quote.token, {
      notes: '<script>leak()</script><b>Please reduce the quantity</b>',
    });
    expect(response.status).toBe(200);
    const message = await ClarificationMessageModel.findById(response.body.data.message_id).lean();
    expect(message?.body).toBe('Please reduce the quantity');
    expect(message?.rfq_id).toBe(rfq._id);
    expect(message?.direction).toBe('BUYER_TO_ADMIN');
    const audit = await AuditLogModel.findOne({ action_type: 'QUOTATION_REVISION_REQUESTED' }).lean();
    expect(JSON.stringify(audit)).not.toContain('Please reduce');
    expect(await NotificationLogModel.countDocuments({ template_id: 'revision-request' })).toBe(1);
    expect((await publicPost('request-refresh', quote.token)).status).toBe(409);
  });

  it('atomically declines, closes the inquiry and shortens prescription retention without extending earlier deadlines', async () => {
    const quote = await issued();
    const prescription = await stagedPrescription();
    const earlier = new Date(Date.now() + 86400000);
    const early = await stagedPrescription();
    await PrescriptionModel.updateOne({ _id: early._id }, { $set: { purge_scheduled_at: earlier } });
    const response = await publicPost('decline', quote.token, { reason: 'PRICE', notes: 'Outside budget' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await QuotationModel.findById(quote.id).lean())?.overall_status).toBe('DECLINED');
    expect((await RfqModel.findById(rfq._id).lean())?.status).toBe('CLOSED');
    expect(
      (await PrescriptionModel.findById(prescription._id).lean())!.purge_scheduled_at.getTime(),
    ).toBeLessThanOrEqual(Date.now() + 14 * 86400000);
    expect((await PrescriptionModel.findById(early._id).lean())?.purge_scheduled_at).toEqual(earlier);
    const refused = await publicPost('accept', quote.token, { terms_accepted: true });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('RESOURCE_STATE_CONFLICT');
    expect(await NotificationLogModel.countDocuments({ template_id: 'quotation-declined' })).toBe(1);
  });

  it('guards payment amount/currency/deadline and enforces payment -> dispatch -> delivery with one outbox set', async () => {
    const quote = await accepted();
    const prescription = await stagedPrescription();
    const premature = await fulfill(quote.id, {
      status: 'DISPATCHED',
      courier_name: 'DHL',
      awb_tracking_number: 'AWB-UNPAID',
    });
    expect(premature.status).toBe(409);
    expect(premature.body.error.code).toBe('RESOURCE_STATE_CONFLICT');
    const unpaid = await QuotationVersionModel.findById(quote.versionId).lean();
    expect(unpaid?.status).toBe('ACCEPTED');
    expect(unpaid?.reservation_status).toBe('ACTIVE');
    expect(unpaid?.shipment).toBeUndefined();
    expect(await NotificationLogModel.countDocuments({ template_id: 'dispatch' })).toBe(0);
    expect((await fulfill(quote.id, { status: 'DELIVERED' })).status).toBe(409);
    expect((await fulfill(quote.id, { ...payment, currency: 'BDT' })).status).toBe(422);
    expect((await fulfill(quote.id, { ...payment, amount: '0' })).status).toBe(422);
    const paid = await fulfill(quote.id, payment);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.data.reservation_status).toBe('CONSUMED');
    expect((await fulfill(quote.id, { status: 'DISPATCHED', courier_name: 'DHL' })).status).toBe(422);
    expect(
      (await fulfill(quote.id, { status: 'DISPATCHED', courier_name: 'DHL', awb_tracking_number: 'AWB-123' })).status,
    ).toBe(200);
    expect((await fulfill(quote.id, { status: 'DELIVERED' })).status).toBe(200);
    expect((await QuotationModel.findById(quote.id).lean())?.overall_status).toBe('COMPLETED');
    expect(
      (await PrescriptionModel.findById(prescription._id).lean())!.purge_scheduled_at.getTime(),
    ).toBeLessThanOrEqual(Date.now() + 14 * 86400000);
    for (const template of ['payment-received', 'dispatch', 'delivered'])
      expect(await NotificationLogModel.countDocuments({ template_id: template })).toBe(1);
    const repeat = await publicPost('accept', quote.token, { terms_accepted: true });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.already_accepted).toBe(true);
  }, 120000);

  it('blocks payment on an expired reservation before an expiry worker runs', async () => {
    const quote = await accepted();
    await QuotationVersionModel.updateOne(
      { _id: quote.versionId },
      { $set: { reservation_expires_at: new Date(Date.now() - 1000) } },
    );
    expect((await fulfill(quote.id, payment)).status).toBe(409);
    expect((await QuotationVersionModel.findById(quote.versionId).lean())?.payment).toBeUndefined();
    await QuotationVersionModel.updateOne(
      { _id: quote.versionId },
      { $set: { status: 'PAYMENT_EXPIRED', reservation_status: 'RELEASED' } },
    );
    expect((await publicPost('accept', quote.token, { terms_accepted: true })).status).toBe(403);
    expect((await publicPost('request-refresh', quote.token)).status).toBe(200);
  });

  it('proxies a token-authorized PDF, records private S3 keys and switches to the accepted Proforma', async () => {
    const quote = await issued();
    expect((await request(app).get('/v1/public/quotation/pdf/' + 'a'.repeat(64))).status).toBe(404);
    const original = await request(app).get(`/v1/public/quotation/pdf/${quote.token}`).buffer();
    expect(original.status, JSON.stringify(original.body)).toBe(200);
    expect(original.headers['content-type']).toBe('application/pdf');
    expect(original.body).toEqual(Buffer.from('%PDF-1.7\ntest commercial PDF'));
    expect(renderer.render.mock.calls[0]![0]).toMatchObject({ mode: 'ORIGINAL_QUOTE' });
    expect((await QuotationVersionModel.findById(quote.versionId).lean())?.pdf?.original).toMatchObject({
      object_key: expect.stringMatching(/^quotes\/s3\/.+\/original-.+\.pdf$/),
    });
    expect((await publicPost('accept', quote.token, { terms_accepted: true })).status).toBe(200);
    await runtime.dispatch();
    const accepted = await request(app).get(`/v1/public/quotation/pdf/${quote.token}`).buffer();
    expect(accepted.status).toBe(200);
    expect(accepted.headers['x-robots-tag']).toContain('noindex');
    expect(accepted.headers['referrer-policy']).toBe('no-referrer');
    expect(renderer.render.mock.calls.at(-1)![0]).toMatchObject({ mode: 'ACCEPTED_QUOTE' });
    expect(JSON.stringify(renderer.render.mock.calls)).not.toMatch(
      /procurement|markup|margin|magic_link_token_hash|internal_note/,
    );
    expect((await QuotationVersionModel.findById(quote.versionId).lean())?.pdf?.accepted).toMatchObject({
      object_key: expect.stringMatching(/^quotes\/s3\/.+\/accepted-.+\.pdf$/),
    });
    expect(await NotificationLogModel.countDocuments({ kind: 'PDF_RENDER', status: 'PENDING' })).toBe(0);
  });

  it('leaves failed PDF work retryable and recovers abandoned worker leases', async () => {
    const quote = await issued();
    renderer.render.mockRejectedValueOnce(new Error('test chromium failure'));
    await runtime.dispatch();
    const failed = await NotificationLogModel.findOne({ kind: 'PDF_RENDER' }).lean();
    expect(failed?.status).toBe('FAILED');
    expect(failed?.last_error_code).toBe('PDF_RENDER_FAILED');
    await NotificationLogModel.updateOne(
      { _id: failed!._id },
      { $set: { status: 'PROCESSING', lease_until: new Date(Date.now() - 1000) } },
    );
    await runtime.dispatch();
    expect((await NotificationLogModel.findById(failed!._id).lean())?.status).toBe('SENT');
    expect((await QuotationVersionModel.findById(quote.versionId).lean())?.pdf?.original).toBeDefined();
  });

  it('provides paginated admin customer history and redacted, filtered audit records', async () => {
    const quote = await accepted();
    const directory = await request(app).get('/v1/admin/customers?q=Test&limit=1').set('Cookie', cookie);
    expect(directory.status).toBe(200);
    expect(directory.body.data).toHaveLength(1);
    const detail = await request(app).get(`/v1/admin/customers/${rfq.customer_id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.history[0].quotations[0]._id).toBe(quote.id);
    expect(JSON.stringify(detail.body.data.history)).not.toMatch(
      /procurement|markup|token_hash|line_notes|contact_snapshot/,
    );
    const audit = await request(app)
      .get('/v1/admin/audit-logs?action=QUOTATION_ACCEPTED&actor_type=BUYER')
      .set('Cookie', cookie);
    expect(audit.status).toBe(200);
    expect(audit.body.data).toHaveLength(1);
    expect(audit.body.data[0].new_status).toBe('ACCEPTED');
    expect((await request(app).get('/v1/admin/customers')).status).toBe(401);
  });

  it('streams only approved events, pings at 25 seconds and closes revoked sessions with listener cleanup', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const listeners = rfqEvents.listenerCount('NEW_RFQ');
    const server = app.listen(0);
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const readUntil = async (wanted: string) => {
      let text = '';
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        while (!text.includes(wanted)) {
          const next = await reader!.read();
          if (next.done) return text;
          text += new TextDecoder().decode(next.value);
        }
        return text;
      } finally {
        clearTimeout(timeout);
      }
    };
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/admin/stream`, {
        headers: { Cookie: cookie },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      await readUntil('connected');
      rfqEvents.emit('NEW_RFQ', { rfq_id: rfq._id, rfq_number: rfq.rfq_number, full_name: 'DO-NOT-STREAM' });
      const event = await readUntil('event: NEW_RFQ');
      expect(event).not.toContain('DO-NOT-STREAM');
      quotationEvents.emit('QUOTATION_ACCEPTED', {
        quotation_id: randomUUID(),
        version_id: randomUUID(),
        rfq_id: rfq._id,
      });
      expect(await readUntil('event: QUOTATION_ACCEPTED')).toContain('QUOTATION_ACCEPTED');
      rfqEvents.emit('CLARIFICATION_REPLY', { rfq_id: rfq._id, body: 'DO-NOT-STREAM' });
      expect(await readUntil('event: CLARIFICATION_REPLY')).not.toContain('DO-NOT-STREAM');
      const heartbeat = interval.mock.calls.find((call) => call[1] === 25000)![0] as () => void;
      heartbeat();
      expect(await readUntil(': ping')).toContain(': ping');
      await AdminSessionModel.updateOne({ _id: sessionId }, { $set: { revoked_at: new Date() } });
      heartbeat();
      expect((await reader.read()).done).toBe(true);
      expect(rfqEvents.listenerCount('NEW_RFQ')).toBe(listeners);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      stream.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      interval.mockRestore();
    }
  });
});
