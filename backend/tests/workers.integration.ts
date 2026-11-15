import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { AdminModel, AdminSessionModel } from '../src/modules/auth/auth.schema.js';
import { CustomerModel } from '../src/modules/customer/customer.schema.js';
import { RfqModel, ClarificationMessageModel } from '../src/modules/rfq/rfq.schema.js';
import {
  QuotationModel,
  QuotationVersionModel,
  type IQuotationVersion,
} from '../src/modules/quotation/quotation.schema.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import { NotificationLogModel } from '../src/modules/notification/notification.schema.js';
import { PrescriptionModel } from '../src/modules/storage/storage.schema.js';
import { createNotificationService } from '../src/modules/notification/notification.service.js';
import { encryptedDelivery } from '../src/modules/quotation/quotation.outbox.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { createReservationExpiryJob } from '../src/jobs/reservationExpiry.job.js';
import { createQuotationExpiryJob } from '../src/jobs/quotationExpiry.job.js';
import { createExpiryReminderJob } from '../src/jobs/expiryReminder.job.js';
import { createPrescriptionPurgeJob } from '../src/jobs/prescriptionPurge.job.js';
import { generateToken, hashPassword, hashToken } from '../src/shared/utils/crypto.js';
import { bsonDecimal } from '../src/shared/utils/decimal.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { migrate } from '../src/scripts/migrate.js';
import { rfqRecord } from './fixtures/rfq.js';
import { quotationVersionFixture, pdfFixture } from './fixtures/commercial.js';
import { validEnv } from './helpers/env.js';

const databaseName = `worker_test_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
const env = loadEnv({
  ...validEnv,
  RESEND_API_KEY: 'test-resend',
  BREVO_API_KEY: 'test-brevo',
  EMAIL_FROM: 'MedAxis <sender@example.test>',
  EMAIL_REPLY_DOMAIN: 'reply.example.test',
  QUOTATION_TOKEN_ENCRYPTION_KEY: 'de'.repeat(32),
  QUOTATION_TOKEN_KEY_ID: 'test-delivery',
  R2_BUCKET_PRESCRIPTIONS: 'test-private-medical',
});
const logger = createLogger({ silent: true });
const fetcher = vi.fn<typeof fetch>();
const remove = vi.fn(async (_key: string) => undefined);
const send = vi.fn(async (command: unknown) => {
  if (command instanceof DeleteObjectCommand) await remove(command.input.Key!);
  return {};
});
const storage = createStorageService(env, { send } as unknown as Pick<S3Client, 'send'>);
let hash: string;
let cookie: string;
let rfqId: string;
let customerId: string;
const dispatch = vi.fn();
const mailer = (fallback = false, batchSize = 10) =>
  createNotificationService({ ...env, EMAIL_FALLBACK_ENABLED: fallback }, logger, { fetcher, batchSize });
async function version(accepted = false, extra: Partial<IQuotationVersion> = {}) {
  const data = quotationVersionFixture(accepted);
  const token = generateToken();
  Object.assign(data, {
    issued_at: new Date(),
    valid_until: new Date(Date.now() + 7 * 86400000),
    magic_link_token_hash: hashToken(token),
    bank_details_snapshot: pdfFixture().wire_details,
    fx_snapshot: {
      mode: 'LIVE',
      captured_at: new Date(),
      rates_to_bdt: { USD: bsonDecimal('120'), CNY: bsonDecimal('16'), EUR: bsonDecimal('130') },
    },
    ...(accepted
      ? { accepted_at: new Date(Date.now() - 86400000), reservation_expires_at: new Date(Date.now() + 4 * 86400000) }
      : {}),
    ...extra,
  });
  await QuotationModel.create({
    _id: data.quotation_id,
    quotation_number: `QT-${randomUUID()}`,
    rfq_id: rfqId,
    customer_id: customerId,
    current_version: 1,
    current_version_id: data._id,
    overall_status: 'ACTIVE',
  });
  await QuotationVersionModel.create(data);
  await RfqModel.updateOne({ _id: rfqId }, { $set: { status: accepted ? 'CONVERTED' : 'QUOTED' } });
  return { data, token };
}
async function email(template = 'rfq-confirmation', extras: Record<string, unknown> = {}) {
  return NotificationLogModel.create({
    dedupe_key: `email:${randomUUID()}`,
    entity_type: 'rfqs',
    entity_id: rfqId,
    kind: 'EMAIL',
    template_id: template,
    recipient: 'buyer@qq.com',
    safe_payload: { rfq_id: rfqId },
    status: 'PENDING',
    next_retry_at: new Date(),
    ...extras,
  });
}
async function prescription(extra: Record<string, unknown> = {}) {
  return PrescriptionModel.create({
    rfq_id: rfqId,
    customer_id: customerId,
    r2_storage_key: `prescriptions/${randomUUID()}.enc`,
    mime_type: 'application/pdf',
    file_size_bytes: 100,
    encryption: { algorithm: 'aes-256-gcm', key_id: 'test-v1', iv: 'test-iv', auth_tag: 'test-tag' },
    uploaded_at: new Date(Date.now() - 86400000),
    purge_scheduled_at: new Date(Date.now() - 1000),
    purge_status: 'ACTIVE',
    ...extra,
  });
}
beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Configure a replica-set test URI');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  await migrate();
  hash = await hashPassword('test-only admin password');
});
beforeEach(async () => {
  if (mongoose.connection.name !== databaseName || !databaseName.startsWith('worker_test_'))
    throw new Error('Not a disposable worker database');
  for (const name of [
    'admins',
    'admin_sessions',
    'customers',
    'rfqs',
    'quotations',
    'quotation_versions',
    'quotation_internal_costs',
    'notification_logs',
    'prescriptions',
    'audit_logs',
    'clarification_messages',
  ])
    await mongoose.connection.db!.collection(name).deleteMany({});
  const admin = await AdminModel.create({
    email: 'owner@example.test',
    password_hash: hash,
    totp_secret_encrypted: 'unused',
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
  customerId = (
    await CustomerModel.create({
      full_name: 'Test Buyer',
      customer_type: 'B2C_PATIENT',
      email: 'buyer@qq.com',
      preferred_locale: 'zh-CN',
      country: 'CN',
    })
  )._id;
  const rfq = rfqRecord();
  rfq.customer_id = customerId;
  rfq.contact_snapshot.email = 'buyer@qq.com';
  rfq.contact_snapshot.preferred_locale = 'zh-CN';
  await RfqModel.create(rfq);
  rfqId = rfq._id;
  fetcher
    .mockReset()
    .mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(String(url).includes('brevo') ? { messageId: 'brevo-test-id' } : { id: 'resend-test-id' }),
        ),
    );
  send.mockClear();
  remove.mockReset().mockResolvedValue(undefined);
  dispatch.mockClear();
});
afterAll(async () => {
  try {
    if (mongoose.connection.name === databaseName && databaseName.startsWith('worker_test_'))
      await mongoose.connection.db?.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

describe('durable notification delivery', () => {
  it('claims an outbox row across two workers once, delivers bilingual content and does not re-send committed work', async () => {
    const job = await email();
    const a = mailer();
    const b = mailer();
    await Promise.all([a.dispatch(), b.dispatch()]);
    await Promise.all([a.dispatch(), b.dispatch(), mailer().dispatch()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const row = await NotificationLogModel.findOne({ template_id: 'rfq-confirmation' }).lean();
    expect(row?.status).toBe('SENT');
    expect(row?.dedupe_key).toBe(job.dedupe_key);
    expect(row?.attempt_count).toBe(1);
    expect(row?.delivery_provider).toBe('RESEND');
    const message = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(message.html).toContain('lang="zh-CN"');
    expect(message.headers['Content-Language']).toBe('zh-CN');
  });
  it.each(['SENT', 'DELIVERED'] as const)(
    'never reclaims an already %s dedupe key, even across fresh workers and a duplicate enqueue',
    async (status) => {
      const sentAt = new Date(Date.now() - 60000);
      const job = await email('rfq-confirmation', {
        status,
        attempt_count: 1,
        sent_at: sentAt,
        delivery_provider: 'RESEND',
        provider_message_id: 'already-succeeded',
        next_retry_at: new Date(0),
        lease_until: new Date(0),
      });
      await expect(email('rfq-confirmation', { dedupe_key: job.dedupe_key })).rejects.toMatchObject({ code: 11000 });
      await Promise.all([mailer().dispatch(), mailer().dispatch(), mailer().dispatch()]);
      expect(fetcher).not.toHaveBeenCalled();
      expect(await NotificationLogModel.countDocuments({ dedupe_key: job.dedupe_key })).toBe(1);
      const stored = await NotificationLogModel.findById(job._id).lean();
      expect(stored).toMatchObject({ status, attempt_count: 1, provider_message_id: 'already-succeeded' });
      expect(stored?.sent_at).toEqual(sentAt);
    },
  );
  it('recovers an abandoned lease and legacy FAILED rows', async () => {
    await email('rfq-confirmation', { status: 'PROCESSING', lease_until: new Date(Date.now() - 1000) });
    await email('rfq-confirmation', { status: 'FAILED' });
    await mailer().dispatch();
    expect(await NotificationLogModel.countDocuments({ status: 'SENT' })).toBe(2);
  });
  it('pins Brevo fallback after an explicit Resend rejection, while ambiguous timeouts stay on the primary', async () => {
    const job = await email();
    fetcher.mockImplementation(async (url) =>
      String(url).includes('resend')
        ? new Response(null, { status: 503 })
        : new Response(JSON.stringify({ messageId: 'brevo-fallback' })),
    );
    await mailer(true).dispatch();
    expect((await NotificationLogModel.findById(job._id).lean())?.delivery_provider).toBe('BREVO');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const pending = await email();
    fetcher.mockReset().mockRejectedValue(new Error('network timeout'));
    await mailer(true, 1).dispatch();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await NotificationLogModel.findById(pending._id).lean())?.status).toBe('FAILED_RETRY');
  });
  it('backs off, dead-letters after three failures and enqueues one high-priority admin alert', async () => {
    const job = await email();
    fetcher.mockImplementation(async () => new Response(null, { status: 500 }));
    const worker = mailer(false, 1);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await worker.dispatch();
      const row = await NotificationLogModel.findById(job._id).lean();
      expect(row?.attempt_count).toBe(attempt);
      expect(row?.status).toBe(attempt === 3 ? 'DEAD' : 'FAILED_RETRY');
      if (attempt < 3) {
        expect(row!.next_retry_at.getTime()).toBeGreaterThan(Date.now());
        await NotificationLogModel.updateOne({ _id: job._id }, { $set: { next_retry_at: new Date(0) } });
      }
    }
    expect(
      await NotificationLogModel.countDocuments({
        dedupe_key: `email-dead:${job._id}`,
        'safe_payload.priority': 'HIGH',
      }),
    ).toBe(1);
  });
  it('decrypts a live quotation link only for send, excludes costs and erases its persisted delivery envelope', async () => {
    const quote = await version();
    const url = new URL(`/q/${quote.token}`, env.PUBLIC_ORIGIN[0]).href;
    const job = await email('quotation-sent', {
      entity_type: 'quotation_versions',
      entity_id: quote.data._id,
      safe_payload: {
        version_id: quote.data._id,
        delivery: encryptedDelivery(env, url),
        delivery_expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    await mailer().dispatch();
    const body = String(fetcher.mock.calls[0]![1]!.body);
    expect(body).toContain(url);
    expect(body).not.toMatch(/procurement|markup|margin/);
    const stored = await NotificationLogModel.findById(job._id).lean();
    expect(stored?.status).toBe('SENT');
    expect(stored?.safe_payload.delivery).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(quote.token);
  });
  it('never sends a stale rotated link and preserves threaded Reply-To for clarification', async () => {
    const quote = await version();
    await email('quotation-sent', {
      entity_type: 'quotation_versions',
      entity_id: quote.data._id,
      safe_payload: {
        delivery: encryptedDelivery(env, new URL(`/q/${quote.token}`, env.PUBLIC_ORIGIN[0]).href),
        delivery_expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    });
    await QuotationVersionModel.updateOne(
      { _id: quote.data._id },
      { $set: { magic_link_token_hash: hashToken(generateToken()) } },
    );
    await mailer().dispatch();
    expect(fetcher).not.toHaveBeenCalled();
    const thread = randomUUID();
    const message = await ClarificationMessageModel.create({
      rfq_id: rfqId,
      customer_id: customerId,
      thread_id: thread,
      direction: 'ADMIN_TO_BUYER',
      channel: 'EMAIL',
      body: 'Please confirm the quantity',
      status: 'PENDING_BUYER',
    });
    await email('clarification-request', {
      safe_payload: { thread_id: thread, clarification_message_id: message._id },
    });
    await mailer().dispatch();
    const payload = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(payload.reply_to).toBe(`reply+${thread}@reply.example.test`);
    expect(payload.text).toContain('Please confirm');
  });
});

describe('expiry, reminders and medical purge', () => {
  it('expires only current unpaid reservations, releases allocation, audits and schedules the earliest purge', async () => {
    const due = new Date(Date.now() - 1000);
    const quote = await version(true, { reservation_expires_at: due });
    const rx = await prescription({ purge_scheduled_at: new Date(Date.now() + 90 * 86400000) });
    const worker = createReservationExpiryJob(env, logger);
    expect(await worker()).toBe(1);
    expect(await worker()).toBe(0);
    expect((await QuotationVersionModel.findById(quote.data._id).lean())?.status).toBe('PAYMENT_EXPIRED');
    expect((await QuotationModel.findById(quote.data.quotation_id).lean())?.overall_status).toBe('EXPIRED');
    expect((await PrescriptionModel.findById(rx._id).lean())!.purge_scheduled_at.getTime()).toBeLessThanOrEqual(
      due.getTime() + 14 * 86400000,
    );
    expect(await AuditLogModel.countDocuments({ action_type: 'QUOTATION_PAYMENT_EXPIRED' })).toBe(1);
    expect(await NotificationLogModel.countDocuments({ template_id: 'reservation-expired' })).toBe(1);
  });
  it('never overwrites a recorded payment even if its old reservation deadline is past', async () => {
    const quote = await version(true, {
      status: 'PAYMENT_RECEIVED',
      reservation_status: 'CONSUMED',
      reservation_expires_at: new Date(0),
      payment: {
        reference: 'TT-1',
        amount: bsonDecimal('6.35'),
        currency: 'USD',
        received_at: new Date(),
        recorded_by: (await AdminModel.findOne().lean())!._id,
      },
    });
    expect(await createReservationExpiryJob(env, logger)()).toBe(0);
    expect((await QuotationVersionModel.findById(quote.data._id).lean())?.status).toBe('PAYMENT_RECEIVED');
  });
  it('expires a SENT quotation once without changing locked financial data', async () => {
    const quote = await version(false, { valid_until: new Date(Date.now() - 1000) });
    const job = createQuotationExpiryJob(env, logger);
    expect(await job()).toBe(1);
    expect(await job()).toBe(0);
    const saved = await QuotationVersionModel.findById(quote.data._id).lean();
    expect(saved?.status).toBe('VALIDITY_EXPIRED');
    expect(saved?.total_amount.toString()).toBe('6.35');
    expect(saved?.fx_snapshot?.rates_to_bdt.USD.toString()).toBe('120');
  });
  it('deduplicates daily 24-hour and Day-3 reminders and skips paid reservations', async () => {
    const quote = await version(false, { valid_until: new Date(Date.now() + 3600000) });
    const job = createExpiryReminderJob();
    await job('QUOTATION_24H');
    await job('QUOTATION_24H');
    expect(await NotificationLogModel.countDocuments({ template_id: 'expiry-reminder' })).toBe(1);
    await QuotationVersionModel.updateOne(
      { _id: quote.data._id },
      {
        $set: {
          status: 'ACCEPTED',
          accepted_at: new Date(Date.now() - 3 * 86400000 - 1000),
          reservation_status: 'ACTIVE',
          reservation_expires_at: new Date(Date.now() + 2 * 86400000),
        },
      },
    );
    await job('RESERVATION_DAY3');
    await job('RESERVATION_DAY3');
    expect(await NotificationLogModel.countDocuments({ template_id: 'expiry-reminder' })).toBe(2);
    await QuotationVersionModel.updateOne({ _id: quote.data._id }, { $set: { status: 'PAYMENT_RECEIVED' } });
    expect(await job('RESERVATION_DAY3')).toBe(0);
  });
  it('deletes R2 first, clears keys only after confirmation, and prevents two workers deleting one leased row twice', async () => {
    const rx = await prescription();
    let deletionStarted!: () => void;
    let confirmDeletion!: () => void;
    const started = new Promise<void>((resolve) => {
      deletionStarted = resolve;
    });
    const confirmation = new Promise<void>((resolve) => {
      confirmDeletion = resolve;
    });
    const order: string[] = [];
    const originalUpdate = PrescriptionModel.updateOne.bind(PrescriptionModel);
    const update = vi.spyOn(PrescriptionModel, 'updateOne').mockImplementation((...args) => {
      const change = args[1];
      if (change && !Array.isArray(change) && change.$set?.purge_status === 'PURGED') order.push('MONGO_PURGED');
      return originalUpdate(...args);
    });
    remove.mockImplementation(async () => {
      deletionStarted();
      await confirmation;
      order.push('R2_CONFIRMED');
    });
    const purge = createPrescriptionPurgeJob(env, logger, storage);
    const runs = [purge(), purge()];
    const settled = Promise.allSettled(runs);
    try {
      await Promise.race([
        started,
        settled.then(() => {
          throw new Error('Purge workers finished before attempting R2 deletion');
        }),
      ]);
      const inFlight = await PrescriptionModel.findById(rx._id).lean();
      expect(inFlight?.purge_status).toBe('DELETING');
      expect(inFlight?.r2_storage_key).toBe(rx.r2_storage_key);
      expect(inFlight?.encryption).toBeDefined();
      expect(await AuditLogModel.countDocuments({ action_type: 'PRESCRIPTION_PURGED' })).toBe(0);
      expect(order).toEqual([]);
      confirmDeletion();
      const results = await Promise.all(runs);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(order).toContain('MONGO_PURGED');
      expect(order.indexOf('MONGO_PURGED')).toBeGreaterThan(order.indexOf('R2_CONFIRMED'));
      const row = await PrescriptionModel.findById(rx._id).lean();
      expect(row?.purge_status).toBe('PURGED');
      expect(row?.r2_storage_key).toBeUndefined();
      expect(row?.encryption).toBeUndefined();
      expect(await AuditLogModel.countDocuments({ action_type: 'PRESCRIPTION_PURGED' })).toBe(1);
    } finally {
      confirmDeletion();
      await settled;
      update.mockRestore();
    }
  });
  it('keeps encrypted metadata on deletion failure, retries after restart and alerts for overdue failures', async () => {
    const rx = await prescription({ purge_scheduled_at: new Date(Date.now() - 2 * 3600000) });
    remove.mockRejectedValueOnce(new Error('R2 unavailable with private diagnostics'));
    expect(await createPrescriptionPurgeJob(env, logger, storage)()).toBe(0);
    const failed = await PrescriptionModel.findById(rx._id).lean();
    expect(failed?.purge_status).toBe('PENDING');
    expect(failed?.encryption).toBeDefined();
    expect(failed?.r2_storage_key).toBeDefined();
    expect(await NotificationLogModel.countDocuments({ 'safe_payload.alert_code': 'PRESCRIPTION_PURGE_OVERDUE' })).toBe(
      1,
    );
    await PrescriptionModel.updateOne({ _id: rx._id }, { $set: { next_retry_at: new Date(0) } });
    expect(await createPrescriptionPurgeJob(env, logger, storage)()).toBe(1);
  });
  it('recovers a stale DELETING lease and applies the hard 90-day cap even when a stored schedule is too late', async () => {
    const rx = await prescription({
      uploaded_at: new Date(Date.now() - 91 * 86400000),
      purge_scheduled_at: new Date(Date.now() + 86400000),
      purge_status: 'DELETING',
      next_retry_at: new Date(0),
    });
    expect(await createPrescriptionPurgeJob(env, logger, storage)()).toBe(1);
    expect((await PrescriptionModel.findById(rx._id).lean())?.purge_status).toBe('PURGED');
  });
  it('retries confirmed deletion if the transactional purge receipt cannot commit', async () => {
    const rx = await prescription();
    const fail = vi.spyOn(AuditLogModel.prototype, 'save').mockRejectedValueOnce(new Error('test receipt failure'));
    try {
      expect(await createPrescriptionPurgeJob(env, logger, storage)()).toBe(0);
    } finally {
      fail.mockRestore();
    }
    const row = await PrescriptionModel.findById(rx._id).lean();
    expect(row?.purge_status).toBe('PENDING');
    expect(row?.encryption).toBeDefined();
    await PrescriptionModel.updateOne({ _id: rx._id }, { $set: { next_retry_at: new Date(0) } });
    expect(await createPrescriptionPurgeJob(env, logger, storage)()).toBe(1);
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it.each(['accept', 'payment'] as const)(
    'serializes %s against an expiry worker without split state',
    async (operation) => {
      const deadline = new Date(Date.now() + 10000);
      const quote = await version(
        operation === 'payment',
        operation === 'payment' ? { reservation_expires_at: deadline } : { valid_until: deadline },
      );
      const app = createApp({
        env,
        logger,
        quotationHooks: { dispatchNotifications: dispatch },
        decisionHooks: { dispatchNotifications: dispatch, dispatchPdf: dispatch },
      });
      const action =
        operation === 'accept'
          ? request(app).post(`/v1/public/quotation/accept/${quote.token}`).send({ terms_accepted: true })
          : request(app)
              .patch(`/v1/admin/quotations/${quote.data.quotation_id}/fulfillment`)
              .set('Cookie', cookie)
              .send({ status: 'PAYMENT_RECEIVED', wire_reference: 'TT-1', amount: '6.35', currency: 'USD' });
      // Both sides are eligible under a controlled boundary clock; guarded writes must choose one winner.
      const [response] = await Promise.all([
        action,
        (operation === 'accept' ? createQuotationExpiryJob(env, logger) : createReservationExpiryJob(env, logger))(
          new Date(deadline.getTime() + 1),
        ),
      ]);
      const saved = (await QuotationVersionModel.findById(quote.data._id).lean())!;
      const parent = (await QuotationModel.findById(quote.data.quotation_id).lean())!;
      if (operation === 'accept') {
        expect(['ACCEPTED', 'VALIDITY_EXPIRED']).toContain(saved.status);
        expect(response.status).toBe(saved.status === 'ACCEPTED' ? 200 : 403);
      } else {
        expect(['PAYMENT_RECEIVED', 'PAYMENT_EXPIRED']).toContain(saved.status);
        expect(response.status).toBe(saved.status === 'PAYMENT_RECEIVED' ? 200 : 409);
      }
      expect(parent.overall_status).toBe(saved.status.endsWith('EXPIRED') ? 'EXPIRED' : 'ACTIVE');
      expect(parent.current_version_id).toBe(saved._id);
    },
  );
});
