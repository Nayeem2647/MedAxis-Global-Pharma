import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { hashPassword, hashToken } from '../src/shared/utils/crypto.js';
import { migrate } from '../src/scripts/migrate.js';
import { AdminModel } from '../src/modules/auth/auth.schema.js';
import { CustomerModel } from '../src/modules/customer/customer.schema.js';
import {
  CustomerAccountModel,
  CustomerDraftModel,
  CustomerSessionModel,
} from '../src/modules/customer/account.schema.js';
import { RfqModel, ClarificationMessageModel } from '../src/modules/rfq/rfq.schema.js';
import { QuotationModel, QuotationVersionModel } from '../src/modules/quotation/quotation.schema.js';
import { PlatformSettingModel } from '../src/modules/settings/settings.schema.js';
import { rfqRecord } from './fixtures/rfq.js';
import { quotationVersionFixture } from './fixtures/commercial.js';
import { validEnv } from './helpers/env.js';

const databaseName = `customer_account_test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const env = loadEnv(validEnv);
const logger = createLogger({ silent: true });
const prefix = '/v1/public/customer';
const password = 'Customer test password 2026!';
const mail = new Map<string, string>();
let app: Express;
let ownerHash: string;
function assertTestDatabase() {
  if (mongoose.connection.name !== databaseName || !/^customer_account_test_[a-f0-9]{16}$/.test(databaseName))
    throw new Error('Refusing to mutate a non-test database');
}
function cookie(response: request.Response) {
  const values = response.headers['set-cookie'] as string[] | undefined;
  const value = values?.filter((item) => item.startsWith('medaxis_customer_session=')).at(-1);
  expect(value).toBeDefined();
  expect(value).toContain('HttpOnly');
  expect(value).toContain('SameSite=Strict');
  return value!.split(';')[0]!;
}
const post = (path: string, body: object, session = '') =>
  request(app)
    .post(prefix + path)
    .set('Origin', env.PUBLIC_ORIGIN[0]!)
    .set('Cookie', session)
    .send(body);
const get = (path: string, session: string) =>
  request(app)
    .get(prefix + path)
    .set('Cookie', session);
async function register(email = 'alice@example.test', verify = true) {
  const response = await post('/auth/register', {
    email,
    password,
    full_name: 'Test customer',
    customer_type: 'B2C_PATIENT',
    country: 'BD',
    preferred_locale: 'en',
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const session = cookie(response);
  if (verify) {
    const token = new URL(mail.get(`${email}:verify`)!).hash.slice(1);
    expect((await post('/auth/verify-email', { token })).status).toBe(200);
  }
  const account = await CustomerAccountModel.findOne({ email }).lean();
  return { session, account: account!, response };
}
async function customerRfq(customerId: string, email: string) {
  const record = rfqRecord();
  record.customer_id = customerId;
  record.contact_snapshot.email = email;
  record.items[0]!.internal_note = 'NEVER_RENDER_CUSTOMER_INTERNAL_NOTE';
  return RfqModel.create(record);
}
async function customerQuote(customerId: string, email: string) {
  const rfq = await customerRfq(customerId, email);
  const version = quotationVersionFixture();
  version.magic_link_token_hash = hashToken(randomUUID());
  version.fx_snapshot = {
    mode: 'LIVE',
    captured_at: new Date(),
    rates_to_bdt: {
      USD: mongoose.Types.Decimal128.fromString('120'),
      CNY: mongoose.Types.Decimal128.fromString('16'),
      EUR: mongoose.Types.Decimal128.fromString('130'),
    },
  };
  version.contact_snapshot.email = email;
  version.valid_until = new Date(Date.now() + 86400000);
  await QuotationModel.create({
    _id: version.quotation_id,
    quotation_number: `QT-${randomUUID()}`,
    rfq_id: rfq._id,
    customer_id: customerId,
    current_version_id: version._id,
  });
  await QuotationVersionModel.create(version);
  return { rfq, version };
}
beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Configure MongoDB for customer-account integration tests');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
  });
  assertTestDatabase();
  await migrate();
  ownerHash = await hashPassword('Test owner password only');
});
beforeEach(async () => {
  assertTestDatabase();
  await Promise.all(
    [
      'customer_accounts',
      'customer_sessions',
      'customer_drafts',
      'customer_events',
      'customers',
      'admins',
      'rfqs',
      'rfq_idempotency_keys',
      'quotations',
      'quotation_versions',
      'clarification_messages',
      'notification_logs',
      'platform_settings',
      'audit_logs',
    ].map((name) => mongoose.connection.db!.collection(name).deleteMany({})),
  );
  mail.clear();
  const owner = await AdminModel.create({
    email: 'owner@example.test',
    password_hash: ownerHash,
    totp_secret_encrypted: 'unused',
    backup_code_hashes: [],
  });
  await PlatformSettingModel.create({
    key: 'packaging_units',
    value: { units: ['BOX', 'BOTTLE'] },
    updated_by: owner._id,
  });
  app = createApp({
    env,
    logger,
    customerAuth: {
      deliverLink: async (email, url, purpose) => {
        mail.set(`${email}:${purpose}`, url);
      },
      dispatchNotifications: () => undefined,
    },
    pdf: {
      get: async () => ({ bytes: Buffer.from('%PDF-1.7\nCustomer test document'), mode: 'ORIGINAL_QUOTE' }),
      dispatch: () => undefined,
    },
  });
});
afterAll(async () => {
  if (mongoose.connection.readyState) {
    assertTestDatabase();
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

describe('customer account authentication and ownership', () => {
  it('registers, verifies, logs out and logs in with a private revocable session', async () => {
    const { session, account, response } = await register();
    expect(response.body.data.profile.email_verified).toBe(false);
    expect(JSON.stringify(response.body)).not.toMatch(/password_hash|token_hash|verification.*expires_at|customer_id/);
    expect(account.email_verified_at).toBeInstanceOf(Date);
    expect((await get('/profile', session)).body.data.email_verified).toBe(true);
    const duplicate = await post('/auth/register', {
      email: account.email,
      password,
      full_name: 'Duplicate',
      customer_type: 'B2C_PATIENT',
      country: 'BD',
      preferred_locale: 'en',
    });
    expect(duplicate.status).toBe(409);
    expect((await post('/auth/logout', {}, session)).status).toBe(200);
    expect((await get('/profile', session)).status).toBe(401);
    const login = await post('/auth/login', { email: account.email, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect((await get('/overview', cookie(login))).status).toBe(200);
    expect(await CustomerSessionModel.countDocuments({ account_id: account._id })).toBe(1);
  });
  it('does not attach existing customer records until the email is verified', async () => {
    const existing = await CustomerModel.create({
      email: 'alice@example.test',
      full_name: 'Existing verified recipient',
      customer_type: 'B2C_PATIENT',
      country: 'BD',
      preferred_locale: 'en',
    });
    await customerRfq(existing._id, existing.email!);
    const { session, account } = await register('alice@example.test', false);
    expect(account.customer_id).toBeUndefined();
    expect((await get('/rfqs', session)).status).toBe(403);
    const token = new URL(mail.get('alice@example.test:verify')!).hash.slice(1);
    expect((await post('/auth/verify-email', { token })).status).toBe(200);
    expect((await post('/auth/verify-email', { token })).status).toBe(400);
    const profile = await get('/profile', session);
    expect(profile.body.data.full_name).toBe('Existing verified recipient');
    const rfqs = await get('/rfqs', session);
    expect(rfqs.body.data).toHaveLength(1);
    expect(JSON.stringify(rfqs.body)).not.toContain('NEVER_RENDER_CUSTOMER_INTERNAL_NOTE');
  });
  it('isolates RFQs, quotations, PDFs and revision requests between two customers', async () => {
    const alice = await register('alice@example.test');
    const bob = await register('bob@example.test');
    const own = await customerQuote(alice.account.customer_id!, alice.account.email);
    const foreign = await customerQuote(bob.account.customer_id!, bob.account.email);
    const list = await get('/quotations', alice.session);
    expect(list.body.data.map((item: { id: string }) => item.id)).toEqual([own.version._id]);
    for (const path of [
      `/rfqs/${foreign.rfq._id}`,
      `/quotations/${foreign.version._id}`,
      `/quotations/${foreign.version._id}/pdf`,
    ])
      expect((await get(path, alice.session)).status).toBe(404);
    expect((await get(`/quotations/${own.version._id}`, alice.session)).body.data.total_amount).toBe('6.35');
    const pdf = await get(`/quotations/${own.version._id}/pdf`, alice.session);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const body = { request_id: randomUUID(), notes: 'Please review the requested quantity.' };
    expect((await post(`/quotations/${foreign.version._id}/revisions`, body, alice.session)).status).toBe(404);
    const first = await post(`/quotations/${own.version._id}/revisions`, body, alice.session);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const replay = await post(`/quotations/${own.version._id}/revisions`, body, alice.session);
    expect(replay.body.data.replayed).toBe(true);
    expect(await ClarificationMessageModel.countDocuments({ _id: body.request_id })).toBe(1);
    expect((await get('/revisions', alice.session)).body.data).toHaveLength(1);
    expect((await get('/revisions', bob.session)).body.data).toHaveLength(0);
    expect(JSON.stringify((await get('/history', alice.session)).body)).not.toContain(foreign.rfq.rfq_number);
    expect((await get('/v1/admin/auth/sessions'.replace(prefix, ''), alice.session)).status).toBe(404);
    expect((await request(app).get('/v1/admin/auth/sessions').set('Cookie', alice.session)).status).toBe(401);
  });
  it('saves drafts, rejects stale edits and submits exactly one RFQ on retry', async () => {
    const alice = await register();
    const body = {
      title: 'My saved requirement',
      destination_country: 'BD',
      preferred_currency: 'USD',
      items: [{ name: 'Requested medicine', quantity: 2, packaging_unit: 'BOX', notes: 'Documented request' }],
    };
    const created = await post('/drafts', body, alice.session);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const update = await request(app)
      .patch(`${prefix}/drafts/${id}`)
      .set('Cookie', alice.session)
      .send({ ...body, title: 'Updated requirement', revision: 0 });
    expect(update.status).toBe(200);
    const stale = await request(app)
      .patch(`${prefix}/drafts/${id}`)
      .set('Cookie', alice.session)
      .send({ ...body, revision: 0 });
    expect(stale.status).toBe(409);
    const submitted = await post(`/drafts/${id}/submit`, {}, alice.session);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const replay = await post(`/drafts/${id}/submit`, {}, alice.session);
    expect(replay.body.data.rfq_id).toBe(submitted.body.data.rfq_id);
    // Simulate a lost draft receipt after intake committed, then a profile edit.
    await CustomerDraftModel.updateOne(
      { _id: id },
      { $set: { status: 'SUBMITTING' }, $unset: { rfq_id: 1, rfq_number: 1 } },
    );
    await CustomerAccountModel.updateOne(
      { _id: alice.account._id },
      { $set: { full_name: 'Changed after submission' } },
    );
    const recovered = await post(`/drafts/${id}/submit`, {}, alice.session);
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    expect(recovered.body.data.rfq_id).toBe(submitted.body.data.rfq_id);
    expect(recovered.body.data.replayed).toBe(true);
    expect(await RfqModel.countDocuments({ customer_id: alice.account.customer_id })).toBe(1);
    expect((await CustomerDraftModel.findById(id).lean())?.status).toBe('SUBMITTED');
  });
  it('resets a password once and revokes all older sessions', async () => {
    const alice = await register();
    expect((await post('/auth/forgot-password', { email: alice.account.email })).status).toBe(200);
    const token = new URL(mail.get(`${alice.account.email}:reset`)!).hash.slice(1);
    const replacement = 'Replacement customer password 2026!';
    expect((await post('/auth/reset-password', { token, password: replacement })).status).toBe(200);
    expect((await get('/profile', alice.session)).status).toBe(401);
    expect((await post('/auth/reset-password', { token, password: replacement })).status).toBe(400);
    expect((await post('/auth/login', { email: alice.account.email, password })).status).toBe(401);
    expect((await post('/auth/login', { email: alice.account.email, password: replacement })).status).toBe(200);
  });
  it('rejects forged sessions, cross-origin writes and repeated password failures', async () => {
    const alice = await register();
    expect((await get('/profile', 'medaxis_customer_session=forged')).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`${prefix}/auth/login`)
          .set('Origin', 'https://evil.example')
          .send({ email: alice.account.email, password })
      ).status,
    ).toBe(403);
    for (let i = 0; i < 4; i++)
      expect((await post('/auth/login', { email: alice.account.email, password: 'incorrect' })).status).toBe(401);
    expect((await post('/auth/login', { email: alice.account.email, password: 'incorrect' })).status).toBe(429);
    expect((await post('/auth/login', { email: alice.account.email, password })).status).toBe(429);
  });
});
