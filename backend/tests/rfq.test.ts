import { createHmac, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { turnstile } from '../src/shared/middleware/turnstile.js';
import { canonicalPayload } from '../src/modules/rfq/rfq.intake.service.js';
import { manualTransitions } from '../src/modules/rfq/rfq.admin.service.js';
import { parseRfqIntake } from '../src/shared/validators/rfq.validator.js';
import { createLogger, redact } from '../src/shared/utils/logger.js';
import { validEnv, productionEnv } from './helpers/env.js';

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
    };
    expect(Object.values(redact(sensitive) as Record<string, unknown>).every((value) => value === '[REDACTED]')).toBe(
      true,
    );
  });
});

describe('Turnstile, HMAC, and intake HTTP protections', () => {
  const env = loadEnv({ ...validEnv, CLOUDFLARE_TURNSTILE_SECRET: 'test-secret' });
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
