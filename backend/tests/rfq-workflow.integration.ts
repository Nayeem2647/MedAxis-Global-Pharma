import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { validEnv, s3EnvSettings } from './helpers/env.js';
import { migrate } from '../src/scripts/migrate.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { generateToken, hashToken, hashPassword } from '../src/shared/utils/crypto.js';
import { bsonDecimal } from '../src/shared/utils/decimal.js';
import { AdminModel, AdminSessionModel } from '../src/modules/auth/auth.schema.js';
import { CustomerAccountModel } from '../src/modules/customer/account.schema.js';
import { ManufacturerModel } from '../src/modules/catalog/catalog.schema.js';
import { PlatformSettingModel } from '../src/modules/settings/settings.schema.js';
import { ExchangeRateModel } from '../src/modules/fx/fx.schema.js';
import { RfqModel } from '../src/modules/rfq/rfq.schema.js';
import { guestUrl } from '../src/modules/rfq/rfq.guest-access.js';
import { QuotationVersionModel, QuotationInternalCostModel } from '../src/modules/quotation/quotation.schema.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { NotificationLogModel } from '../src/modules/notification/notification.schema.js';
import { createNotificationService } from '../src/modules/notification/notification.service.js';

// This suite creates and removes only this unique test database. It cannot select the application database.
const databaseName = `workflow_test_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const env = loadEnv({
  ...validEnv,
  ...s3EnvSettings,
  CLOUDFLARE_TURNSTILE_SECRET: 'test-only-challenge',
  QUOTATION_TOKEN_ENCRYPTION_KEY: 'ca'.repeat(32),
  QUOTATION_TOKEN_KEY_ID: 'workflow-test-v1',
  PRESCRIPTION_ENCRYPTION_KEY: 'ad'.repeat(32),
  PRESCRIPTION_KEY_ID: 'workflow-files-test',
  RESEND_API_KEY: 'test-mail-transport',
  EMAIL_FROM: 'MedAxis <quotes@example.test>',
  ADMIN_ALERT_EMAIL: 'admin@example.test',
});
const logger = createLogger({ silent: true });
const bank = {
  configured: true,
  beneficiary_name: 'Sample Exporter',
  bank_name: 'Sample Bank',
  account_number: 'TEST-12345',
  swift_code: 'TESTBDDH',
  instructions: 'Use the RFQ reference with your test transfer.',
};
let app: Express;
let cookie: string;
let manufacturer: string;
let password: string;
const blobs = new Map<string, Buffer>();
const transport = vi.fn(async (command: unknown) => {
  if (command instanceof PutObjectCommand) {
    blobs.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
    return {};
  }
  if (command instanceof DeleteObjectCommand) {
    blobs.delete(command.input.Key!);
    return {};
  }
  if (command instanceof GetObjectCommand) return { Body: Readable.from([blobs.get(command.input.Key!)!]) };
  return {};
});
const storage = createStorageService(env, { send: transport } as unknown as Pick<S3Client, 'send'>);
const emails: string[] = [];
const mailFetch = vi.fn<typeof fetch>(async (_url, init) => {
  emails.push(String(init?.body ?? ''));
  return Response.json({ id: `test-mail-${emails.length}` });
});
const mail = createNotificationService(env, logger, { fetcher: mailFetch });
const adminPost = (id: string, action: string, body: object) =>
  request(app).post(`/v1/admin/rfq-workflow/${id}/${action}`).set('Cookie', cookie).send(body);
const quotePost = (id: string, action: string, body: object) =>
  request(app).post(`/v1/admin/quotations/${id}/${action}`).set('Cookie', cookie).send(body);
const getGuest = (token: string) => request(app).get(`/v1/public/rfq-workflow/${token}`);
const guestPost = (token: string, action: string, body: object) =>
  request(app).post(`/v1/public/rfq-workflow/${token}/${action}`).send(body);
const accountRfq = (id: string) => `/v1/public/customer/rfqs/${id}/workflow`;
const fulfill = (id: string, body: object) =>
  request(app).patch(`/v1/admin/quotations/${id}/fulfillment`).set('Cookie', cookie).send(body);

async function signInBuyer(email = 'buyer@example.test') {
  const token = generateToken();
  await CustomerAccountModel.create({
    email,
    password_hash: password,
    full_name: 'Sample Workflow Buyer',
    customer_type: 'B2C_PATIENT',
    country: 'BD',
    preferred_locale: 'en',
    verification: { token_hash: hashToken(token), expires_at: new Date(Date.now() + 1800000) },
  });
  const login = await request(app).post('/v1/public/customer/auth/login').send({
    email,
    password: 'Sample workflow test password',
  });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  const session = String(login.headers['set-cookie']?.[0]).split(';')[0]!;
  return {
    get: (id: string) => request(app).get(accountRfq(id)).set('Cookie', session),
    post: (id: string, action: string, body: object) =>
      request(app).post(`${accountRfq(id)}/${action}`).set('Cookie', session).send(body),
    verify: () => request(app).post('/v1/public/customer/auth/verify-email').send({ token }),
  };
}

beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('A replica-set URI is required; only a generated workflow_test database is used.');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('workflow_test_'))
    throw new Error('Refusing to migrate an application database');
  await migrate();
  password = await hashPassword('Sample workflow test password');
});
beforeEach(async () => {
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('workflow_test_'))
    throw new Error('Refusing to alter an application database');
  for (const collection of await mongoose.connection.db!.listCollections().toArray())
    await mongoose.connection.db!.collection(collection.name).deleteMany({});
  const admin = await AdminModel.create({
    email: 'admin@example.test',
    password_hash: password,
    totp_secret_encrypted: 'unused-test-enrollment',
    backup_code_hashes: [],
  });
  const token = generateToken();
  await AdminSessionModel.create({
    admin_id: admin._id,
    token_hash: hashToken(token),
    purpose: 'ADMIN',
    session_generation: 0,
    last_seen_at: new Date(),
    expires_at: new Date(Date.now() + 1800000),
  });
  const signature = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(token).digest('base64').replace(/=+$/, '');
  cookie = `medaxis_admin_session=${encodeURIComponent(`s:${token}.${signature}`)}`;
  manufacturer = (
    await ManufacturerModel.create({
      translations: { en: { name: 'Sample Manufacturer', slug: 'sample-workflow-manufacturer' } },
      country: 'BD',
      is_active: true,
    })
  )._id;
  await PlatformSettingModel.create({ key: 'packaging_units', value: { units: ['BOX'] }, updated_by: admin._id });
  await PlatformSettingModel.create({ key: 'wire_instructions', value: bank, updated_by: admin._id });
  for (const [currency, rate] of [
    ['USD', '100'],
    ['CNY', '14'],
    ['EUR', '110'],
  ] as const)
    await ExchangeRateModel.create({
      _id: currency,
      currency_code: currency,
      live_rate_to_bdt: bsonDecimal(rate),
      live_fetched_at: new Date(),
      mode: 'LIVE',
    });
  blobs.clear();
  emails.length = 0;
  app = createApp({
    env,
    logger,
    rfq: {
      storage,
      turnstileFetch: vi.fn(async () => Response.json({ success: true })),
      hooks: { dispatchNotifications: vi.fn() },
    },
    quotationHooks: { dispatchNotifications: vi.fn() },
    decisionHooks: { dispatchNotifications: vi.fn(), dispatchPdf: vi.fn() },
  });
});
afterAll(async () => {
  try {
    if (mongoose.connection.name === databaseName && databaseName.startsWith('workflow_test_'))
      await mongoose.connection.db?.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

async function submit(kind = 'quick-quote', attached = false) {
  let uploadCookie: string | undefined;
  const prescriptionIds: string[] = [];
  if (attached) {
    const upload = await request(app)
      .post('/v1/public/prescriptions/upload')
      .field('turnstile_token', 'test-token')
      .field('attachment_kind', kind === 'quick-quote' ? 'PRESCRIPTION' : 'SUPPORTING')
      .attach('prescription', Buffer.from('%PDF-1.7\nSample purchase list'), {
        filename: 'sample-purchase-list.pdf',
        contentType: 'application/pdf',
      });
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    prescriptionIds.push(upload.body.data.prescription_id);
    uploadCookie = String(upload.headers['set-cookie']?.[0]).split(';')[0];
  }
  const call = request(app).post(`/v1/public/rfq/${kind}`);
  if (uploadCookie) call.set('Cookie', uploadCookie);
  const response = await call.send({
    idempotency_key: randomUUID(),
    turnstile_token: 'test-token',
    contact: {
      full_name: 'Sample Workflow Buyer',
      customer_type: 'B2C_PATIENT',
      email: 'buyer@example.test',
      preferred_locale: 'en',
    },
    destination_country: 'BD',
    destination_city_port: 'Dhaka',
    preferred_currency: 'USD',
    locale: 'en',
    items: [
      {
        is_uncatalogued: true,
        custom_medicine_name: 'Sample medicine',
        custom_strength: '80 mg',
        quantity: 2,
        packaging_unit: 'BOX',
      },
    ],
    prescription_ids: prescriptionIds,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const id = response.body.data.rfq_id as string;
  const url = await guestUrl(env, id);
  expect(url).toBeTruthy();
  const token = new URL(url!).pathname.split('/').at(-1)!;
  return { id, token, number: response.body.data.rfq_number as string };
}
async function prepare(kind = 'quick-quote', attached = false) {
  const source = await submit(kind, attached);
  await mail.dispatch();
  expect(emails.some((message) => message.includes(`/r/${source.token}`))).toBe(true);
  const rfq = (await RfqModel.findById(source.id).lean())!;
  const pricing = {
    rfq_id: source.id,
    billing_currency: 'USD',
    items: [
      {
        rfq_item_id: rfq.items[0]!._id,
        manufacturer_id: manufacturer,
        availability_status: 'AVAILABLE',
        selling_price: '125',
        procurement_cost_bdt: '1000',
        markup_percent: '25',
        weight_per_pack_g: '100',
        snapshot: {
          brand_name: 'Sample medicine',
          generic_name: 'Sample generic',
          strength: '80 mg',
          dosage_form: 'Tablet',
          pack_size: '30 tablets',
        },
      },
    ],
    freight_amount: '25',
    insurance_amount: '0',
    packed_weight_g: '250',
    shipping_terms: { method: 'EXPRESS_COURIER', named_place: 'Dhaka', cold_chain_required: false },
    payment_terms: 'BANK_WIRE_TT',
  };
  const blocked = await request(app).post('/v1/admin/quotations/draft').set('Cookie', cookie).send(pricing);
  expect(blocked.status).toBe(409);
  const reviewed = await adminPost(source.id, 'review', {
    expected_updated_at: rfq.updated_at.toISOString(),
    items: rfq.items.map((line) => ({ id: line._id, availability: 'AVAILABLE' })),
  });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  const badWeight = await request(app)
    .post('/v1/admin/quotations/draft')
    .set('Cookie', cookie)
    .send({ ...pricing, packed_weight_g: '199' });
  expect(badWeight.status).toBe(422);
  const draft = await request(app).post('/v1/admin/quotations/draft').set('Cookie', cookie).send(pricing);
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const quoteId = draft.body.data.quotation_id as string;
  const sent = await quotePost(quoteId, 'send', {
    expected_version_id: draft.body.data.version.id,
    bank_details: bank,
    validity_days: 7,
  });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body.data.magic_link_url).toBe(await guestUrl(env, source.id));
  return { ...source, quoteId, versionId: sent.body.data.version.id as string, itemId: rfq.items[0]!._id };
}

describe('production RFQ workflow on an isolated database and test email transport', () => {
  it('accepts a buyer proposal as new terms requiring customer approval and supports quick intake with files', async () => {
    const offer = await prepare('quick-quote', true);
    const proposal = await guestPost(offer.token, 'negotiate', {
      expected_version_id: offer.versionId,
      operation_id: randomUUID(),
      scope: 'BOTH',
      body: 'Can we agree on USD 240 medicines and USD 10 delivery?',
      proposed_medicine_subtotal: '240',
      proposed_delivery_charge: '10',
    });
    expect(proposal.status).toBe(200);
    const response = {
      expected_version_id: offer.versionId,
      request_id: proposal.body.data.message_id,
      operation_id: randomUUID(),
      mode: 'ACCEPT',
      body: 'We can offer these revised terms for your approval.',
      prices: [{ rfq_item_id: offer.itemId, selling_price: '120' }],
      delivery_charge: '10',
    };
    const accepted = await adminPost(offer.id, 'respond', response);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const guest = await getGuest(offer.token);
    expect(guest.body.data.workflow_status).toBe('REVISED');
    expect(guest.body.data.quote.status).toBe('SENT');
    expect(guest.body.data.quote.total_amount).toBe('250.00');
    expect(guest.body.data.quote.accepted_at).toBeUndefined();
    expect(
      (await adminPost(offer.id, 'respond', { ...response, body: 'Different response using the same operation key.' }))
        .status,
    ).toBe(409);
    expect(
      (await guestPost(offer.token, 'decline', { expected_version_id: guest.body.data.quote.id, reason: 'PRICE' }))
        .status,
    ).toBe(200);
  });
  it('follows intake → saved review → weighted quotation → counteroffer → approval → payment → dispatch → completed history', async () => {
    const offer = await prepare('quick-quote', false);
    const buyer = await signInBuyer();
    expect((await request(app).get(accountRfq(offer.id))).status).toBe(401);
    expect((await buyer.get(offer.id)).status).toBe(403);
    expect((await buyer.post(offer.id, 'accept', { expected_version_id: offer.versionId, terms_accepted: true })).status).toBe(403);
    expect((await buyer.verify()).status).toBe(200);
    const otherBuyer = await signInBuyer('other-buyer@example.test');
    expect((await otherBuyer.verify()).status).toBe(200);
    expect((await otherBuyer.get(offer.id)).status).toBe(404);
    expect((await otherBuyer.post(offer.id, 'accept', { expected_version_id: offer.versionId, terms_accepted: true })).status).toBe(404);
    const adminDetail = await request(app).get(`/v1/admin/rfq-workflow/${offer.id}`).set('Cookie', cookie);
    expect(adminDetail.status, JSON.stringify(adminDetail.body)).toBe(200);
    expect(adminDetail.body.data.email_delivery.length).toBeGreaterThan(0);
    expect(adminDetail.body.data.email_delivery[0]).not.toHaveProperty('safe_payload');
    let guest = await getGuest(offer.token);
    expect(guest.status).toBe(200);
    expect(guest.headers['cache-control']).toContain('no-store');
    const dashboard = await buyer.get(offer.id);
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
    expect(dashboard.headers['cache-control']).toContain('no-store');
    const { expires_at: _expiresAt, ...guestData } = guest.body.data;
    expect(dashboard.body.data).toEqual(guestData);
    expect(guest.body.data.quote).toMatchObject({
      medicine_weight_g: '200.00000000',
      packed_weight_g: '250',
      total_amount: '275.00',
    });
    expect(JSON.stringify(guest.body)).not.toMatch(
      /procurement|markup|internal_note|guest_token_hash|guest_delivery|prescription|acceptance_evidence/,
    );
    const negotiation = {
      expected_version_id: offer.versionId,
      operation_id: randomUUID(),
      scope: 'DELIVERY',
      body: 'Could you reduce delivery to USD 10?',
      proposed_delivery_charge: '10',
    };
    const [one, repeated] = await Promise.all([
      buyer.post(offer.id, 'negotiate', negotiation),
      guestPost(offer.token, 'negotiate', negotiation),
    ]);
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(repeated.status, JSON.stringify(repeated.body)).toBe(200);
    expect(one.body.data.message_id).toBe(repeated.body.data.message_id);
    expect(
      (await guestPost(offer.token, 'accept', { expected_version_id: offer.versionId, terms_accepted: true })).status,
    ).toBe(409);
    const response = {
      expected_version_id: offer.versionId,
      request_id: one.body.data.message_id,
      operation_id: randomUUID(),
      mode: 'COUNTEROFFER',
      body: 'We can offer USD 15 delivery.',
      prices: [{ rfq_item_id: offer.itemId, selling_price: '125' }],
      delivery_charge: '15',
      validity_days: 7,
    };
    const counter = await adminPost(offer.id, 'respond', response);
    expect(counter.status, JSON.stringify(counter.body)).toBe(200);
    const retry = await adminPost(offer.id, 'respond', response);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(await QuotationVersionModel.countDocuments({ quotation_id: offer.quoteId })).toBe(2);
    guest = await getGuest(offer.token);
    expect(guest.body.data.workflow_status).toBe('COUNTEROFFER');
    expect(guest.body.data.quote.total_amount).toBe('265.00');
    expect(guest.body.data.history).toHaveLength(2);
    expect(guest.body.data.messages).toHaveLength(2);
    expect((await buyer.get(offer.id)).body.data.messages).toEqual(guest.body.data.messages);
    expect(
      (await buyer.post(offer.id, 'accept', { expected_version_id: offer.versionId, terms_accepted: true })).status,
    ).toBe(409);
    const current = guest.body.data.quote.id as string;
    const revisedCosts = await QuotationInternalCostModel.findOne({ quotation_version_id: current }).lean();
    expect(revisedCosts?.items[0]?.procurement_unit_cost_bdt.toString()).toBe('1000.00000000');
    const approvals = await Promise.all([
      buyer.post(offer.id, 'accept', { expected_version_id: current, terms_accepted: true }),
      guestPost(offer.token, 'accept', { expected_version_id: current, terms_accepted: true }),
    ]);
    approvals.forEach((result) => expect(result.status, JSON.stringify(result.body)).toBe(200));
    const payment = {
      expected_version_id: current,
      status: 'PAYMENT_RECEIVED',
      amount: '265.00',
      currency: 'USD',
      wire_reference: 'SAMPLE-BANK-TT-01',
    };
    expect((await fulfill(offer.quoteId, payment)).status).toBe(409);
    expect((await adminPost(offer.id, 'payment-request', { expected_version_id: current })).status).toBe(200);
    expect((await adminPost(offer.id, 'payment-request', { expected_version_id: current })).status).toBe(200);
    const bankInstructions = (await buyer.get(offer.id)).body.data.quote.bank_details;
    expect(bankInstructions).toMatchObject({ account_number: bank.account_number, swift_code: bank.swift_code });
    expect(await NotificationLogModel.countDocuments({ dedupe_key: `payment-request:${current}` })).toBe(1);
    expect((await fulfill(offer.quoteId, { ...payment, amount: '1' })).status).toBe(422);
    expect((await fulfill(offer.quoteId, { ...payment, currency: 'EUR' })).status).toBe(422);
    expect((await fulfill(offer.quoteId, payment)).status).toBe(200);
    expect((await fulfill(offer.quoteId, payment)).status).toBe(200);
    expect(
      (
        await fulfill(offer.quoteId, {
          expected_version_id: current,
          status: 'DISPATCHED',
          courier_name: 'Sample Courier',
          awb_tracking_number: 'SAMPLE-AWB-001',
          estimated_delivery: new Date(Date.now() + 86400000).toISOString(),
        })
      ).status,
    ).toBe(200);
    expect((await getGuest(offer.token)).body.data.quote.shipment.awb_tracking_number).toBe('SAMPLE-AWB-001');
    expect((await buyer.get(offer.id)).body.data.quote.shipment.awb_tracking_number).toBe('SAMPLE-AWB-001');
    expect((await fulfill(offer.quoteId, { expected_version_id: current, status: 'DELIVERED' })).status).toBe(422);
    expect(
      (
        await fulfill(offer.quoteId, {
          expected_version_id: current,
          status: 'DELIVERED',
          delivery_evidence: 'Sample courier proof of delivery POD-001',
        })
      ).status,
    ).toBe(200);
    const history = await request(app)
      .get('/v1/admin/rfq-workflow')
      .query({ scope: 'HISTORY', q: offer.number, country: 'BD', status: 'COMPLETED' })
      .set('Cookie', cookie);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(history.body.data.rows).toHaveLength(1);
    expect(history.body.data.rows[0].workflow_status).toBe('COMPLETED');
    expect((await getGuest(offer.token)).body.data.workflow_status).toBe('COMPLETED');
    expect((await buyer.get(offer.id)).body.data.workflow_status).toBe('COMPLETED');
    await mail.dispatch();
    expect(emails.some((message) => message.includes('SAMPLE-AWB-001'))).toBe(true);
    expect(emails.some((message) => message.includes('Payment requested'))).toBe(true);
  });
  it('allows cart intake with a private supporting document, keeps the existing offer after a written reply, and records customer decline in history', async () => {
    const offer = await prepare('cart', true);
    const buyer = await signInBuyer();
    expect((await buyer.verify()).status).toBe(200);
    const proposal = await guestPost(offer.token, 'negotiate', {
      expected_version_id: offer.versionId,
      operation_id: randomUUID(),
      scope: 'BOTH',
      body: 'Can you lower the total?',
      proposed_medicine_subtotal: '210',
      proposed_delivery_charge: '10',
    });
    expect(proposal.status).toBe(200);
    const response = {
      expected_version_id: offer.versionId,
      request_id: proposal.body.data.message_id,
      operation_id: randomUUID(),
      mode: 'RETAINED',
      body: 'The current terms remain our best available offer.',
    };
    expect((await adminPost(offer.id, 'respond', response)).status).toBe(200);
    expect((await adminPost(offer.id, 'respond', response)).status).toBe(200);
    const guest = await getGuest(offer.token);
    expect(guest.body.data.workflow_status).toBe('RETAINED');
    expect(guest.body.data.quote.id).toBe(offer.versionId);
    expect(await QuotationVersionModel.countDocuments({ quotation_id: offer.quoteId })).toBe(1);
    expect(guest.body.data.messages).toHaveLength(2);
    expect(
      (await buyer.post(offer.id, 'decline', { expected_version_id: offer.versionId, reason: 'PRICE' })).status,
    ).toBe(200);
    expect(
      (await guestPost(offer.token, 'decline', { expected_version_id: offer.versionId, reason: 'PRICE' })).status,
    ).toBe(200);
    const history = await request(app)
      .get('/v1/admin/rfq-workflow')
      .query({ scope: 'HISTORY', q: offer.number })
      .set('Cookie', cookie);
    expect(history.body.data.rows[0].workflow_status).toBe('DECLINED');
    expect((await getGuest(offer.token)).body.data.workflow_status).toBe('DECLINED');
  });
  it('shows request status before issuance and supports expired, revoked and reissued guest access without granting access by RFQ number', async () => {
    const source = await submit('cart', false);
    const pending = await getGuest(source.token);
    expect(pending.status).toBe(200);
    expect(pending.body.data.quote).toBeNull();
    expect(pending.body.data.workflow_status).toBe('SUBMITTED');
    expect((await getGuest(source.number)).status).toBe(404);
    expect((await request(app).get('/v1/admin/rfq-workflow')).status).toBe(401);
    await RfqModel.updateOne({ _id: source.id }, { $set: { guest_expires_at: new Date(Date.now() - 1000) } });
    expect((await getGuest(source.token)).status).toBe(403);
    expect((await adminPost(source.id, 'guest-link', { action: 'REISSUE' })).status).toBe(200);
    const newUrl = (await guestUrl(env, source.id))!;
    const token = new URL(newUrl).pathname.split('/').at(-1)!;
    expect(token).not.toBe(source.token);
    expect((await getGuest(source.token)).status).toBe(404);
    expect((await getGuest(token)).status).toBe(200);
    await mail.dispatch();
    expect(emails.some((message) => message.includes('buyer@example.test') && message.includes(`/r/${token}`))).toBe(
      true,
    );
    expect((await adminPost(source.id, 'guest-link', { action: 'REVOKE' })).status).toBe(200);
    expect((await getGuest(token)).status).toBe(403);
    const buyer = await signInBuyer();
    expect((await buyer.verify()).status).toBe(200);
    expect((await buyer.get(source.id)).body.data.workflow_status).toBe('SUBMITTED');
  });
});
