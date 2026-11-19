import { createHmac, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { turnstile } from '../src/shared/middleware/turnstile.js';
import { canonicalPayload } from '../src/modules/rfq/rfq.intake.service.js';
import { createRfqAdminService, manualTransitions } from '../src/modules/rfq/rfq.admin.service.js';
import { parseRfqIntake } from '../src/shared/validators/rfq.validator.js';
import { createLogger, redact } from '../src/shared/utils/logger.js';
import { validEnv, productionEnv } from './helpers/env.js';
import { RfqModel, ClarificationMessageModel } from '../src/modules/rfq/rfq.schema.js';
import * as audit from '../src/shared/middleware/auditLogger.js';
import * as outbox from '../src/modules/rfq/rfq.outbox.js';
import { rfqRecord } from './fixtures/rfq.js';

afterEach(() => vi.restoreAllMocks());
function query<T>(value: T) {
  return {
    session() {
      return this;
    },
    lean: async () => value,
    then: (resolve: (result: T) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
}
function triageHarness() {
  const rfq = new RfqModel(rfqRecord());
  const req = { requestId: randomUUID(), admin: { id: randomUUID(), sessionId: randomUUID() } } as Request;
  const session = {} as ClientSession;
  vi.spyOn(mongoose.connection, 'transaction').mockImplementation(
    async <T>(work: (value: ClientSession) => Promise<T>) => work(session),
  );
  vi.spyOn(RfqModel, 'findById').mockImplementation(() => query(rfq) as never);
  const changed = vi.spyOn(RfqModel, 'findOneAndUpdate').mockResolvedValue(rfq);
  const update = vi.spyOn(RfqModel, 'updateOne').mockResolvedValue({ matchedCount: 1 } as never);
  const save = vi.spyOn(ClarificationMessageModel.prototype, 'save').mockImplementation(async function (
    this: InstanceType<typeof ClarificationMessageModel>,
  ) {
    return this;
  });
  const log = vi.spyOn(audit, 'writeAuditLog').mockResolvedValue(undefined);
  const enqueue = vi.spyOn(outbox, 'enqueueRfqEmail').mockResolvedValue(undefined);
  const signals = { submitted: vi.fn(), notifications: vi.fn() };
  return { rfq, req, session, changed, update, save, log, enqueue, signals, service: createRfqAdminService(signals) };
}

describe('real RFQ triage service boundaries with isolated persistence', () => {
  it.each(['QUOTED', 'CONVERTED', 'CLOSED', 'CANCELLED'] as const)(
    'refuses line/clarification/unable-to-supply edits from %s',
    async (status) => {
      const h = triageHarness();
      h.rfq.status = status;
      await expect(
        h.service.item(h.req, h.rfq._id, h.rfq.items[0]!._id, { item_availability_status: 'AVAILABLE' }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(h.service.clarify(h.req, h.rfq._id, { body: 'Question', channel: 'EMAIL' })).rejects.toMatchObject({
        status: 409,
      });
      await expect(h.service.close(h.req, h.rfq._id, { unable_to_supply_reason: 'Unavailable' })).rejects.toMatchObject(
        { status: 409 },
      );
      expect(h.changed).not.toHaveBeenCalled();
      expect(h.save).not.toHaveBeenCalled();
      expect(h.enqueue).not.toHaveBeenCalled();
    },
  );
  it('patches only availability/note under the original RFQ state and line ID', async () => {
    const h = triageHarness();
    const before = h.rfq.toObject();
    await h.service.item(h.req, h.rfq._id, h.rfq.items[0]!._id, {
      item_availability_status: 'AVAILABLE',
      customer_facing_note: 'Confirmed specification',
    });
    expect(h.changed).toHaveBeenCalledWith(
      { _id: h.rfq._id, status: 'SUBMITTED', 'items._id': before.items[0]!._id },
      {
        $set: {
          'items.$.item_availability_status': 'AVAILABLE',
          'items.$.customer_facing_note': 'Confirmed specification',
        },
      },
      { session: h.session, returnDocument: 'after' },
    );
    expect(h.rfq.toObject().contact_snapshot).toMatchObject(before.contact_snapshot);
    expect(h.rfq.items[0]!.quantity).toBe(before.items[0]!.quantity);
  });
  it('enforces close/cancel reasons and disallows direct QUOTED/CONVERTED transitions', async () => {
    const h = triageHarness();
    await expect(h.service.status(h.req, h.rfq._id, { status: 'CLOSED' })).rejects.toMatchObject({ status: 422 });
    await expect(h.service.status(h.req, h.rfq._id, { status: 'QUOTED' })).rejects.toMatchObject({ status: 409 });
    expect(h.changed).not.toHaveBeenCalled();
  });
  it('requires email before an email clarification and keeps internal notes in their own messages', async () => {
    const h = triageHarness();
    h.rfq.contact_snapshot.email = undefined;
    await expect(
      h.service.clarify(h.req, h.rfq._id, { body: 'Please confirm', channel: 'EMAIL' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(h.save).not.toHaveBeenCalled();
    const result = await h.service.note(h.req, h.rfq._id, { body: 'Private sourcing note' });
    expect(result.note_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.save.mock.contexts[0]).toMatchObject({
      direction: 'INTERNAL_NOTE',
      channel: 'ADMIN',
      body: 'Private sourcing note',
    });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it('rejects a concurrent triage-state change before logging success', async () => {
    const h = triageHarness();
    h.changed.mockResolvedValue(null);
    await expect(
      h.service.item(h.req, h.rfq._id, h.rfq.items[0]!._id, { item_availability_status: 'AVAILABLE' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.log).not.toHaveBeenCalled();
  });
});

const logger = createLogger({ silent: true });
const flatBody = () => ({
  full_name: 'Buyer',
  email: ' Buyer@Example.Test ',
  destination_country: 'BD',
  preferred_locale: 'en',
  is_uncatalogued: true,
  custom_medicine_name: 'Demo',
  quantity: 1,
  packaging_unit: 'BOX',
});

describe('RFQ validation and privacy', () => {
  it('normalizes flat quick quotes and structured carts to typed canonical input', () => {
    const key = randomUUID();
    const flat = parseRfqIntake(flatBody(), 'QUICK_QUOTE', key);
    expect(flat.contact.email).toBe('buyer@example.test');
    expect(flat.items).toHaveLength(1);
    expect(flat.idempotency_key).toBe(key);
    const cart = parseRfqIntake(
      { idempotency_key: key, contact: flat.contact, destination_country: 'BD', items: flat.items },
      'CART_RFQ',
    );
    expect(cart.items).toEqual(flat.items);
    expect(() => parseRfqIntake({ ...flatBody(), idempotency_key: randomUUID() }, 'QUICK_QUOTE', key)).toThrow(
      'Conflicting',
    );
  });
  it.each([{ preferred_locale: 'zh-CN' }, { locale: 'zh-CN' }, { destination_country: 'CN' }])(
    'enforces China email primary for %j',
    (change) => {
      expect(() =>
        parseRfqIntake({ ...flatBody(), email: ' ', wechat_id: 'buyer', ...change }, 'QUICK_QUOTE', randomUUID()),
      ).toThrow(/Email is required/);
    },
  );
  it('bounds line counts/quantities and rejects client-set status, snapshots or notes', () => {
    for (const quantity of [0, -1, 0.5])
      expect(() => parseRfqIntake({ ...flatBody(), quantity }, 'QUICK_QUOTE', randomUUID())).toThrow();
    const valid = parseRfqIntake(flatBody(), 'QUICK_QUOTE', randomUUID());
    for (const items of [[], Array.from({ length: 101 }, () => valid.items[0])])
      expect(() => parseRfqIntake({ ...valid, items }, 'CART_RFQ')).toThrow();
    expect(() => parseRfqIntake({ ...valid, status: 'QUOTED' }, 'CART_RFQ')).toThrow();
    expect(() =>
      parseRfqIntake({ ...valid, items: [{ ...valid.items[0], internal_note: 'private' }] }, 'CART_RFQ'),
    ).toThrow();
  });
  it('requires explicit packaging units on quick-quote and cart lines', () => {
    expect(() => parseRfqIntake({ ...flatBody(), packaging_unit: undefined }, 'QUICK_QUOTE', randomUUID())).toThrow();
    const valid = parseRfqIntake(flatBody(), 'QUICK_QUOTE', randomUUID());
    expect(() =>
      parseRfqIntake({ ...valid, items: [{ ...valid.items[0], packaging_unit: undefined }] }, 'CART_RFQ'),
    ).toThrow();
  });
  it('hashes semantic payloads deterministically without depending on key order', () => {
    expect(canonicalPayload({ b: 2, a: { d: 4, c: 3 }, omitted: undefined })).toBe(
      canonicalPayload({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(canonicalPayload({ items: [1, 2] })).not.toBe(canonicalPayload({ items: [2, 1] }));
    expect(manualTransitions.CLOSED).toEqual([]);
    expect(manualTransitions.UNDER_REVIEW).not.toContain('CONVERTED');
    const sensitive = {
      body: 'medical private content',
      line_notes: 'diagnosis',
      custom_medicine_name: 'private medicine',
      r2_object_key: 'private/key',
      object_key: 'prescriptions/s3/private.enc',
    };
    expect(Object.values(redact(sensitive) as Record<string, unknown>).every((value) => value === '[REDACTED]')).toBe(
      true,
    );
  });
});

describe('Turnstile, HMAC, and intake HTTP protections', () => {
  const env = loadEnv({ ...validEnv, CLOUDFLARE_TURNSTILE_SECRET: 'test-secret' });
  it('keeps RFQ contact, medical, challenge and session values out of public request/error logs', async () => {
    const captureLogger = createLogger({ silent: true });
    const logs = [vi.spyOn(captureLogger, 'log'), vi.spyOn(captureLogger, 'warn'), vi.spyOn(captureLogger, 'error')];
    const app = createApp({ env, logger: captureLogger });
    const response = await request(app)
      .post('/v1/public/rfq/cart?email=PRIVATE_CONTACT_SENTINEL&prescription=PRIVATE_MEDICAL_SENTINEL')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', 'prescription_upload_session=PRIVATE_SESSION_SENTINEL')
      .send({
        idempotency_key: randomUUID(),
        turnstile_token: 'PRIVATE_CHALLENGE_SENTINEL',
        contact: {
          full_name: 'PRIVATE_CONTACT_SENTINEL',
          email: 'private@example.test',
          customer_type: 'B2C_PATIENT',
          preferred_locale: 'en',
        },
        destination_country: 'BD',
        locale: 'en',
        prescription_ids: [],
        items: [
          {
            is_uncatalogued: true,
            custom_medicine_name: 'PRIVATE_MEDICAL_SENTINEL',
            quantity: 0,
            packaging_unit: 'BOX',
            line_notes: 'PRIVATE_MEDICAL_SENTINEL',
          },
        ],
      });
    expect(response.status).toBe(422); // Rejected before database access.
    expect(logs[0]).toHaveBeenCalled();
    expect(logs.map((spy) => JSON.stringify(spy.mock.calls)).join('\n')).not.toMatch(
      /PRIVATE_(?:CONTACT|MEDICAL|CHALLENGE|SESSION)_SENTINEL|private@example\.test/,
    );
    logs.forEach((spy) => spy.mockRestore());
  });
  it('verifies Turnstile server-side and rejects missing, failed or wrong-host tokens', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new globalThis.Response(JSON.stringify({ success: true, hostname: 'www.medaxisglobalpharma.com' })),
      );
    const next = vi.fn();
    const req = {
      body: { turnstile_token: 'test-token' },
      clientIp: '8.8.8.8',
      get: () => undefined,
    } as unknown as Request;
    await turnstile(loadEnv(productionEnv), fetcher)(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(fetcher).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST', body: expect.any(URLSearchParams) }),
    );
    fetcher.mockResolvedValue(new globalThis.Response(JSON.stringify({ success: true, hostname: 'attacker.test' })));
    next.mockClear();
    await turnstile(loadEnv(productionEnv), fetcher)(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403, code: 'TURNSTILE_VERIFICATION_FAILED' }));
    next.mockClear();
    await turnstile(env, fetcher)({ ...req, body: {} } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
  it('shares the five-per-ten-minutes quota between quick-quote and cart', async () => {
    const app = createApp({ env, logger });
    for (let i = 0; i < 5; i++)
      expect(
        (
          await request(app)
            .post(i % 2 ? '/v1/public/rfq/cart' : '/v1/public/rfq/quick-quote')
            .send({})
        ).status,
      ).toBe(403);
    const sixth = await request(app).post('/v1/public/rfq/cart').send({});
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(sixth.headers['retry-after'])).toBeLessThanOrEqual(600);
  });
  it('rejects forged email webhook signatures before touching MongoDB', async () => {
    const app = createApp({ env: loadEnv({ ...validEnv, WEBHOOK_HMAC_SECRET: 'test-hmac-key' }), logger });
    const res = await request(app)
      .post('/v1/public/webhooks/email-reply')
      .set('x-webhook-signature', createHmac('sha256', 'wrong-key').update('{}').digest('hex'))
      .send({});
    expect(res.status).toBe(403);
  });
  it('requires admin authentication for triage and medical streaming', async () => {
    const app = createApp({ env, logger });
    const id = randomUUID();
    expect((await request(app).get('/v1/admin/rfqs')).status).toBe(401);
    expect((await request(app).get(`/v1/admin/prescriptions/${id}/stream`)).status).toBe(401);
    expect((await request(app).post(`/v1/admin/rfqs/${id}/notes`).send({ body: 'note' })).status).toBe(401);
  });
});
