import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Express } from 'express';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { AdminModel, AdminSessionModel } from '../src/modules/auth/auth.schema.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import { CustomerModel } from '../src/modules/customer/customer.schema.js';
import { RfqModel, RfqIdempotencyKeyModel, ClarificationMessageModel } from '../src/modules/rfq/rfq.schema.js';
import { PrescriptionModel } from '../src/modules/storage/storage.schema.js';
import { NotificationLogModel } from '../src/modules/notification/notification.schema.js';
import { PlatformSettingModel } from '../src/modules/settings/settings.schema.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { generateToken, hashPassword, hashToken } from '../src/shared/utils/crypto.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { migrate } from '../src/scripts/migrate.js';
import { validEnv } from './helpers/env.js';
import { createRfqDispatcher } from '../src/modules/rfq/rfq.dispatch.js';
import { pdf, prescriptionFiles } from './fixtures/prescriptions.js';

const databaseName = `rfq_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
const env = loadEnv({
  ...validEnv,
  CLOUDFLARE_TURNSTILE_SECRET: 'test-turnstile-secret',
  WEBHOOK_HMAC_SECRET: 'test-webhook-secret',
  PRESCRIPTION_ENCRYPTION_KEY: 'ab'.repeat(32),
  PRESCRIPTION_KEY_ID: 'test-medical-v1',
  R2_BUCKET_PRESCRIPTIONS: 'test-private-medical',
  ADMIN_ALERT_EMAIL: 'owner@example.test',
});
const logger = createLogger({ silent: true });
const blobs = new Map<string, Buffer>();
const s3 = vi.fn(async (command: unknown) => {
  if (command instanceof PutObjectCommand) {
    blobs.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
    return {};
  }
  if (command instanceof GetObjectCommand) return { Body: Readable.from([blobs.get(command.input.Key!)!]) };
  if (command instanceof DeleteObjectCommand) blobs.delete(command.input.Key!);
  return {};
});
const storage = createStorageService(env, { send: s3 } as unknown as Pick<S3Client, 'send'>);
const onNewRfq = vi.fn();
const dispatchNotifications = vi.fn();
const bot = vi
  .fn<typeof fetch>()
  .mockImplementation(async () => new Response(JSON.stringify({ success: true, hostname: 'localhost' })));
let app: Express;
let adminCookie: string;
let passwordHash: string;
const input = () => ({
  idempotency_key: randomUUID(),
  turnstile_token: 'test-token',
  contact: { full_name: 'Buyer', email: 'buyer@example.test', customer_type: 'B2C_PATIENT', preferred_locale: 'en' },
  destination_country: 'BD',
  preferred_currency: 'USD',
  items: [{ is_uncatalogued: true, custom_medicine_name: 'Test medicine', quantity: 1, packaging_unit: 'BOX' }],
});
const submit = (body: object, cookie?: string) => {
  const call = request(app).post('/v1/public/rfq/cart').send(body);
  return cookie ? call.set('Cookie', cookie) : call;
};
async function uploaded(bytes: Buffer = pdf, filename = 'private.pdf', mime = 'application/pdf') {
  const response = await request(app)
    .post('/v1/public/prescriptions/upload')
    .field('turnstile_token', 'test-token')
    .attach('prescription', bytes, { filename, contentType: mime });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const values = response.headers['set-cookie'];
  const cookie = (Array.isArray(values) ? values : [values])
    .find((value: string) => value.startsWith('prescription_upload_session='))!
    .split(';')[0]!;
  return { id: response.body.data.prescription_id as string, cookie, response };
}
function signedReply(body: object, secret = env.WEBHOOK_HMAC_SECRET!) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return request(app)
    .post('/v1/public/webhooks/email-reply')
    .set('Content-Type', 'application/json')
    .set('x-webhook-signature', `sha256=${signature}`)
    .send(raw);
}
beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_TEST_URI or MONGODB_URI for RFQ integration tests');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10_000,
  });
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('rfq_test_'))
    throw new Error('Refusing to migrate a non-test database');
  await migrate();
  passwordHash = await hashPassword('test-only admin password');
});
beforeEach(async () => {
  if (mongoose.connection.name !== databaseName) throw new Error('Refusing to alter a non-test database');
  for (const name of [
    'admins',
    'admin_sessions',
    'customers',
    'rfqs',
    'rfq_idempotency_keys',
    'prescriptions',
    'clarification_messages',
    'audit_logs',
    'notification_logs',
    'platform_settings',
  ])
    await mongoose.connection.db!.collection(name).deleteMany({});
  const admin = await AdminModel.create({
    email: 'owner@example.test',
    password_hash: passwordHash,
    totp_secret_encrypted: 'unused',
    backup_code_hashes: [],
  });
  const token = generateToken();
  const now = new Date();
  await AdminSessionModel.create({
    admin_id: admin._id,
    token_hash: hashToken(token),
    purpose: 'ADMIN',
    session_generation: 0,
    last_seen_at: now,
    expires_at: new Date(now.getTime() + 1_800_000),
  });
  const signature = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(token).digest('base64').replace(/=+$/, '');
  adminCookie = `medaxis_admin_session=${encodeURIComponent(`s:${token}.${signature}`)}`;
  blobs.clear();
  s3.mockClear();
  onNewRfq.mockClear();
  dispatchNotifications.mockClear();
  bot.mockClear();
  app = createApp({ env, logger, rfq: { turnstileFetch: bot, storage, hooks: { onNewRfq, dispatchNotifications } } });
});
afterAll(async () => {
  try {
    if (mongoose.connection.name === databaseName && databaseName.startsWith('rfq_test_'))
      await mongoose.connection.db?.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

describe('RFQ intake and triage against MongoDB', () => {
  it('replays an identical submission, rejects a changed payload and emits one outbox/event set', async () => {
    const body = input();
    const first = await submit(body);
    const replay = await submit({ ...body, turnstile_token: 'fresh-token' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    const conflict = await submit({ ...body, items: [{ ...body.items[0], quantity: 2 }] });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(await RfqModel.countDocuments()).toBe(1);
    expect(await CustomerModel.countDocuments()).toBe(1);
    expect(await RfqIdempotencyKeyModel.countDocuments()).toBe(1);
    expect(await NotificationLogModel.countDocuments()).toBe(2);
    expect(await AuditLogModel.countDocuments({ action_type: 'RFQ_SUBMITTED' })).toBe(1);
    await vi.waitFor(() => expect(onNewRfq).toHaveBeenCalledTimes(1));
    expect(dispatchNotifications).toHaveBeenCalledTimes(1);
    expect(bot).toHaveBeenCalledTimes(1);
  });
  it('accepts non-China WeChat-only contacts and queues manual confirmation alongside the admin email', async () => {
    const body = input();
    const response = await submit({
      ...body,
      contact: {
        full_name: 'Manual contact',
        customer_type: 'B2C_PATIENT',
        wechat_id: 'manual-buyer',
        preferred_locale: 'en',
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await NotificationLogModel.countDocuments({ kind: 'EMAIL', template_id: 'new-rfq-admin-alert' })).toBe(1);
    const manual = await NotificationLogModel.findOne({ template_id: 'rfq-confirmation' }).lean();
    expect(manual!.kind).toBe('ADMIN_EVENT');
    expect(manual!.safe_payload.manual_delivery_required).toBe(true);
  });
  it('serializes five concurrent copies into exactly one RFQ and one sequence allocation', async () => {
    const body = input();
    const results = await Promise.all(Array.from({ length: 5 }, () => submit(body)));
    expect(results.map((result) => result.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((result) => result.body.data.rfq_id)).size).toBe(1);
    expect(await RfqModel.countDocuments()).toBe(1);
    const counter = await PlatformSettingModel.findOne({ key: /^rfq_sequence_/ }).lean();
    expect(counter!.value.next_number).toBe(1);
  });
  it('preserves an existing customer profile and stores submission contact as an immutable snapshot', async () => {
    const owner = await CustomerModel.create({
      full_name: 'Original profile',
      email: 'buyer@example.test',
      customer_type: 'B2C_PATIENT',
      preferred_locale: 'en',
      country: 'SG',
      whatsapp_number: '+651234',
    });
    const before = owner.toObject();
    const initial = input();
    const body = {
      ...initial,
      contact: {
        ...initial.contact,
        full_name: 'Submitted name',
        email: ' BUYER@EXAMPLE.TEST ',
        whatsapp_number: '+8801999999999',
      },
    };
    const response = await submit(body);
    expect(response.status).toBe(201);
    expect(await CustomerModel.findById(owner._id).lean()).toEqual(before);
    const rfq = await RfqModel.findById(response.body.data.rfq_id).lean();
    expect(rfq!.customer_id).toBe(owner._id);
    expect(rfq!.contact_snapshot.full_name).toBe('Submitted name');
    expect(rfq!.contact_snapshot.whatsapp_number).toBe('+8801999999999');
    await expect(
      RfqModel.updateOne({ _id: rfq!._id }, { $set: { 'contact_snapshot.full_name': 'edited' } }),
    ).rejects.toThrow('immutable');
  });
  it('requires email for Chinese locale and Mainland China even when WeChat is available', async () => {
    const body = input();
    for (const change of [{ locale: 'zh-CN' }, { destination_country: 'CN' }]) {
      const response = await submit({
        ...body,
        ...change,
        contact: { ...body.contact, email: ' ', wechat_id: 'buyer' },
      });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(await RfqModel.countDocuments()).toBe(0);
  });
  it('creates sequential numbers and safely expires idempotency independently of TTL deletion', async () => {
    const body = input();
    const first = await submit(body);
    expect(first.status).toBe(201);
    await RfqIdempotencyKeyModel.updateOne(
      { key: body.idempotency_key },
      { $set: { expires_at: new Date(Date.now() - 1) } },
    );
    const second = await submit(body);
    expect(second.status).toBe(201);
    expect(first.body.data.rfq_number).toMatch(/^RFQ-\d{4}-00001$/);
    expect(second.body.data.rfq_number).toMatch(/^RFQ-\d{4}-00002$/);
    expect(await RfqModel.countDocuments()).toBe(2);
  });
  it('supports the flat Quick Quote contract and creates no unexpected account fields', async () => {
    const body = {
      full_name: 'Quick Buyer',
      email: ' Quick@Example.Test ',
      preferred_locale: 'en',
      destination_country: 'BD',
      is_uncatalogued: true,
      custom_medicine_name: 'Demo',
      quantity: 1,
      packaging_unit: 'BOX',
    };
    const response = await request(app)
      .post('/v1/public/rfq/quick-quote')
      .set('cf-turnstile-response', 'test-token')
      .set('x-idempotency-key', randomUUID())
      .send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const rfq = await RfqModel.findById(response.body.data.rfq_id).lean();
    expect(rfq!.inquiry_type).toBe('QUICK_QUOTE');
    expect((await CustomerModel.findOne().lean())!.email).toBe('quick@example.test');
  });
  it.each(prescriptionFiles)(
    'round-trips $format through encrypted upload, RFQ linking and audited admin streaming',
    async ({ bytes, filename, mime }) => {
      const file = await uploaded(bytes, filename, mime);
      const staged = await PrescriptionModel.findById(file.id).select('+upload_token_hash').lean();
      expect(staged!.rfq_id).toBeUndefined();
      expect(staged!.purge_status).toBe('ACTIVE');
      expect(staged!.purge_scheduled_at.getTime() - staged!.uploaded_at.getTime()).toBe(90 * 86_400_000);
      expect(blobs.get(staged!.r2_storage_key!)).not.toEqual(bytes);
      expect(staged!.mime_type).toBe(mime);
      expect(JSON.stringify(file.response.body)).not.toMatch(/r2_|https?:|encryption|upload_token/);
      const response = await submit({ ...input(), prescription_ids: [file.id] }, file.cookie);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const linked = await PrescriptionModel.findById(file.id).select('+upload_token_hash').lean();
      expect(linked!.rfq_id).toBe(response.body.data.rfq_id);
      expect(linked!.upload_token_hash).toBeUndefined();
      const stream = await request(app).get(`/v1/admin/prescriptions/${file.id}/stream`).set('Cookie', adminCookie);
      expect(stream.status).toBe(200);
      expect(stream.headers['content-type']?.split(';')[0]).toBe(mime);
      expect(stream.body).toEqual(bytes);
      expect(stream.headers['cache-control']).toBe('no-store');
      expect(stream.headers['x-content-type-options']).toBe('nosniff');
      expect(await AuditLogModel.countDocuments({ action_type: 'PRESCRIPTION_ACCESSED' })).toBe(1);
    },
  );
  it('rejects stolen/reused prescription IDs and rolls back failed linkage', async () => {
    const file = await uploaded();
    const anotherSession = await uploaded();
    expect(anotherSession.cookie).not.toBe(file.cookie);
    const cookies = file.response.headers['set-cookie'];
    const stagingCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((value: string) =>
      value.startsWith('prescription_upload_session='),
    );
    expect(stagingCookie).toMatch(/;\s*HttpOnly/i);
    expect(stagingCookie).toMatch(/;\s*SameSite=Strict/i);
    expect(stagingCookie).toMatch(/;\s*Path=\/v1\/public(?:;|$)/i);
    const body = { ...input(), prescription_ids: [file.id] };
    expect((await submit(body)).status).toBe(422);
    expect((await submit(body, anotherSession.cookie)).status).toBe(422);
    expect(await RfqModel.countDocuments()).toBe(0);
    expect(await CustomerModel.countDocuments()).toBe(0);
    expect((await submit(body, file.cookie)).status).toBe(201);
    expect((await submit({ ...body, idempotency_key: randomUUID() }, file.cookie)).status).toBe(422);
    expect(await RfqModel.countDocuments()).toBe(1);
  });
  it('rejects invalid signatures, unsupported/mismatched MIME and oversized files before R2 or metadata writes', async () => {
    for (const { bytes, mime } of [
      { bytes: Buffer.from('<svg>not medical</svg>'), mime: 'image/png' },
      { bytes: Buffer.alloc(5_242_881), mime: 'image/png' },
      { bytes: pdf, mime: 'image/jpeg' },
      { bytes: pdf, mime: 'application/octet-stream' },
      { bytes: Buffer.from('GIF89a\x01\0\x01\0\0\0\0'), mime: 'image/gif' },
    ]) {
      const response = await request(app)
        .post('/v1/public/prescriptions/upload')
        .field('turnstile_token', 'test-token')
        .attach('prescription', bytes, { filename: 'spoofed.png', contentType: mime });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PRESCRIPTION_FILE');
    }
    expect(blobs.size).toBe(0);
    expect(s3).not.toHaveBeenCalled();
    expect(await PrescriptionModel.countDocuments()).toBe(0);
  });
  it('rolls back RFQ/customer/counter/outbox and restores staging ownership when auditing fails', async () => {
    const file = await uploaded();
    const body = { ...input(), prescription_ids: [file.id] };
    const save = vi
      .spyOn(AuditLogModel.prototype, 'save')
      .mockRejectedValueOnce(new Error('private medical details must not be logged'));
    try {
      const response = await submit(body, file.cookie);
      expect(response.status).toBe(500);
      for (const model of [RfqModel, CustomerModel, NotificationLogModel, RfqIdempotencyKeyModel])
        expect(await model.countDocuments()).toBe(0);
      const staged = await PrescriptionModel.findById(file.id).select('+upload_token_hash').lean();
      expect(staged!.rfq_id).toBeUndefined();
      expect(staged!.upload_token_hash).toBeDefined();
      expect(onNewRfq).not.toHaveBeenCalled();
      expect(dispatchNotifications).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
    }
    expect((await submit(body, file.cookie)).status).toBe(201);
  });
  it('removes an uploaded R2 object when prescription metadata cannot be saved', async () => {
    const save = vi.spyOn(PrescriptionModel.prototype, 'save').mockRejectedValueOnce(new Error('test storage failure'));
    try {
      const response = await request(app)
        .post('/v1/public/prescriptions/upload')
        .field('turnstile_token', 'test-token')
        .attach('prescription', pdf, 'private.pdf');
      expect(response.status).toBe(500);
      expect(blobs.size).toBe(0);
      expect(await PrescriptionModel.countDocuments()).toBe(0);
      expect(s3.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(true);
    } finally {
      save.mockRestore();
    }
  });
  it('triages lines, filters the admin queue, appends private notes and forbids invalid status jumps', async () => {
    const submitted = await submit(input());
    const id = submitted.body.data.rfq_id as string;
    const list = await request(app)
      .get('/v1/admin/rfqs?status=SUBMITTED&buyer_type=B2C_PATIENT&q=Buyer')
      .set('Cookie', adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.meta.pagination.total_items).toBe(1);
    const detail = await request(app).get(`/v1/admin/rfqs/${id}`).set('Cookie', adminCookie);
    expect(detail.body.data.prescriptions).toEqual([]);
    expect(detail.body.data.quotations).toEqual([]);
    const itemId = detail.body.data.items[0]._id as string;
    expect(
      (
        await request(app)
          .patch(`/v1/admin/rfqs/${id}/items/${itemId}`)
          .set('Cookie', adminCookie)
          .send({ item_availability_status: 'AVAILABLE', customer_facing_note: 'Available' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .patch(`/v1/admin/rfqs/${id}/status`)
          .set('Cookie', adminCookie)
          .send({ status: 'UNDER_REVIEW' })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).patch(`/v1/admin/rfqs/${id}/status`).set('Cookie', adminCookie).send({ status: 'CONVERTED' }))
        .status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/v1/admin/rfqs/${id}/notes`)
          .set('Cookie', adminCookie)
          .send({ body: '<p>Private note</p><script>bad()</script>' })
      ).status,
    ).toBe(201);
    const note = await ClarificationMessageModel.findOne({ rfq_id: id, direction: 'INTERNAL_NOTE' }).lean();
    expect(note!.body).toBe('<p>Private note</p>');
  });
  it('threads signed email replies, deduplicates provider events and verifies sender ownership', async () => {
    const response = await submit(input());
    const id = response.body.data.rfq_id as string;
    const clarify = await request(app)
      .post(`/v1/admin/rfqs/${id}/request-clarification`)
      .set('Cookie', adminCookie)
      .send({ body: 'Please clarify the medicine', channel: 'EMAIL' });
    expect(clarify.status, JSON.stringify(clarify.body)).toBe(200);
    const reply = {
      provider_event_id: 'test-event-1',
      thread_id: clarify.body.data.thread_id,
      from_email: 'buyer@example.test',
      body: '<p>Buyer reply</p><script>bad()</script>',
    };
    expect((await signedReply(reply, 'forged-key')).status).toBe(403);
    expect((await signedReply({ ...reply, from_email: 'attacker@example.test' })).status).toBe(403);
    const accepted = await signedReply(reply);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((await signedReply(reply)).body.data.replayed).toBe(true);
    expect((await signedReply({ ...reply, body: 'Changed body' })).status).toBe(409);
    expect(await ClarificationMessageModel.countDocuments({ provider_event_id: 'test-event-1' })).toBe(1);
    expect((await RfqModel.findById(id).lean())!.status).toBe('UNDER_REVIEW');
    expect((await ClarificationMessageModel.findOne({ provider_event_id: 'test-event-1' }).lean())!.body).toBe(
      '<p>Buyer reply</p>',
    );
    expect(await NotificationLogModel.countDocuments({ template_id: 'clarification-request' })).toBe(1);
  });
  it('closes unable-to-supply RFQs and schedules the earliest retention deadline', async () => {
    const first = await uploaded();
    const secondResponse = await request(app)
      .post('/v1/public/prescriptions/upload')
      .set('Cookie', first.cookie)
      .field('turnstile_token', 'test-token')
      .attach('prescription', pdf, 'second.pdf');
    expect(secondResponse.status).toBe(201);
    const secondId = secondResponse.body.data.prescription_id as string;
    const submitted = await submit({ ...input(), prescription_ids: [first.id, secondId] }, first.cookie);
    const id = submitted.body.data.rfq_id as string;
    const now = Date.now();
    await PrescriptionModel.updateOne(
      { _id: first.id },
      { $set: { uploaded_at: new Date(now - 89 * 86_400_000), purge_scheduled_at: new Date(now + 86_400_000) } },
    );
    const closed = await request(app)
      .post(`/v1/admin/rfqs/${id}/unable-to-supply`)
      .set('Cookie', adminCookie)
      .send({ unable_to_supply_reason: 'Manufacturer cannot supply' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.data.status).toBe('CLOSED');
    expect(closed.body.data.close_reason).toBe('UNABLE_TO_SUPPLY');
    expect((await PrescriptionModel.findById(first.id).lean())!.purge_scheduled_at.getTime()).toBeLessThanOrEqual(
      now + 86_400_000,
    );
    expect((await PrescriptionModel.findById(secondId).lean())!.purge_scheduled_at.getTime()).toBeLessThan(
      Date.now() + 14 * 86_400_000,
    );
    expect(await NotificationLogModel.countDocuments({ template_id: 'unable-to-supply' })).toBe(1);
    expect(
      (
        await request(app)
          .patch(`/v1/admin/rfqs/${id}/status`)
          .set('Cookie', adminCookie)
          .send({ status: 'UNDER_REVIEW' })
      ).status,
    ).toBe(409);
  });
  it('leases and delivers outbox email jobs once and retains failed deliveries for retry', async () => {
    const response = await submit(input());
    expect(response.status).toBe(201);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify({ id: randomUUID() }), { status: 200 }));
    const deliveryEnv = loadEnv({
      ...validEnv,
      RESEND_API_KEY: 'test-provider-key',
      EMAIL_FROM: 'MedAxis <sender@example.test>',
    });
    const dispatch = createRfqDispatcher(deliveryEnv, logger, fetcher);
    await Promise.all([dispatch(), dispatch()]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await NotificationLogModel.countDocuments({ status: 'SENT' })).toBe(2);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) }),
    );
    await NotificationLogModel.create({
      dedupe_key: 'test-retry',
      kind: 'EMAIL',
      entity_type: 'rfqs',
      entity_id: response.body.data.rfq_id,
      template_id: 'rfq-confirmation',
      recipient: 'buyer@example.test',
      safe_payload: { rfq_id: response.body.data.rfq_id },
      status: 'PENDING',
      next_retry_at: new Date(),
    });
    fetcher.mockResolvedValue(new Response(null, { status: 500 }));
    await dispatch();
    const failed = await NotificationLogModel.findOne({ dedupe_key: 'test-retry' }).lean();
    expect(failed!.status).toBe('FAILED_RETRY');
    expect(failed!.last_error_code).toBe('DELIVERY_FAILED');
    expect(failed!.next_retry_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('never streams medical bytes when the access audit cannot be written', async () => {
    const file = await uploaded();
    const save = vi.spyOn(AuditLogModel.prototype, 'save').mockRejectedValueOnce(new Error('test audit failure'));
    try {
      const response = await request(app).get(`/v1/admin/prescriptions/${file.id}/stream`).set('Cookie', adminCookie);
      expect(response.status).toBe(500);
      expect(response.headers['content-type']).toContain('application/json');
    } finally {
      save.mockRestore();
    }
  });
});
