import request, { type Response as SupertestResponse } from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { CheckDatabaseFn } from '../src/config/db.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';

const env = loadEnv({ ...validEnv });
const logger = createLogger({ silent: true });

const makeApp = (checkDatabase: CheckDatabaseFn = async () => ({ status: 'connected' })) =>
  createApp({ env, logger, checkDatabase });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function expectErrorEnvelope(res: SupertestResponse, { status, code }: { status: number; code: string }) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json; charset=utf-8/);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body.success).toBe(false);
  expect(res.body.error.code).toBe(code);
  expect(res.body.error.status).toBe(status);
  expect(typeof res.body.error.message).toBe('string');
  expect(res.body.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(res.body.meta.request_id).toMatch(UUID_V4);
  expect(res.headers['x-request-id']).toBe(res.body.meta.request_id);
  expect(res.headers['content-type']).not.toMatch(/problem\+json/);
  expect(res.body).not.toHaveProperty('type');
}

describe('GET /v1/health', () => {
  it('returns 200 with the success envelope and X-Request-ID', async () => {
    const res = await request(makeApp()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'ok', api_version: 'v1', database: { status: 'connected' } });
    expect(res.body.meta.request_id).toMatch(UUID_V4);
    expect(res.headers['x-request-id']).toBe(res.body.meta.request_id);
    expect(res.body.meta.timestamp).toMatch(/Z$/);
  });

  it('does not leak secrets or connection details', async () => {
    const res = await request(makeApp()).get('/v1/health');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('mongodb://');
    expect(text).not.toContain(validEnv.ADMIN_SESSION_SECRET);
  });

  it('returns 503 SERVICE_UNAVAILABLE in the error envelope when MongoDB is down', async () => {
    const res = await request(makeApp(async () => ({ status: 'disconnected' }))).get('/v1/health');
    expectErrorEnvelope(res, { status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(res.headers['retry-after']).toBe('5');
  });

  it('ignores a caller-supplied X-Request-ID (server-generated only)', async () => {
    const res = await request(makeApp()).get('/v1/health').set('X-Request-ID', 'forged-id');
    expect(res.headers['x-request-id']).not.toBe('forged-id');
    expect(res.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('generates a unique request ID per request', async () => {
    const app = makeApp();
    const a = await request(app).get('/v1/health');
    const b = await request(app).get('/v1/health');
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});

describe('API versioning (API-Spec.md 1.5)', () => {
  it.each(['/unknown', '/', '/v2/health', '/api/health', '/health'])(
    'returns 404 API_VERSION_NOT_SUPPORTED for %s',
    async (path) => {
      expectErrorEnvelope(await request(makeApp()).get(path), { status: 404, code: 'API_VERSION_NOT_SUPPORTED' });
    },
  );

  it('does not redirect or execute mutations on unsupported versions', async () => {
    const res = await request(makeApp()).post('/v2/public/rfq/quick-quote').send({ a: 1 });
    expectErrorEnvelope(res, { status: 404, code: 'API_VERSION_NOT_SUPPORTED' });
  });

  it.each(['/v1/unknown', '/v1/public/nothing', '/v1'])('returns 404 ROUTE_NOT_FOUND for %s', async (path) => {
    expectErrorEnvelope(await request(makeApp()).get(path), { status: 404, code: 'ROUTE_NOT_FOUND' });
  });
});

describe('request body handling', () => {
  it('maps malformed JSON to 400 MALFORMED_JSON with Cache-Control: no-store', async () => {
    const res = await request(makeApp())
      .post('/v1/public/rfq/quick-quote')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');
    expectErrorEnvelope(res, { status: 400, code: 'MALFORMED_JSON' });
  });

  it('rejects bodies over 1 MB without echoing content', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(1_100_000) });
    const res = await request(makeApp())
      .post('/v1/public/rfq/quick-quote')
      .set('Content-Type', 'application/json')
      .send(big);
    expectErrorEnvelope(res, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('accepts valid JSON and reaches RFQ bot verification', async () => {
    const res = await request(makeApp()).post('/v1/public/rfq/quick-quote').send({ ok: true });
    expectErrorEnvelope(res, { status: 403, code: 'TURNSTILE_VERIFICATION_FAILED' });
  });
});

describe('header contract (API-Spec.md 1.2)', () => {
  it('rejects a JSON mutation with a non-JSON Content-Type', async () => {
    const res = await request(makeApp()).post('/v1/public/rfq/cart').set('Content-Type', 'text/plain').send('hello');
    expectErrorEnvelope(res, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('rejects a JSON mutation that carries a body but no Content-Type', async () => {
    const res = await request(makeApp()).post('/v1/public/rfq/cart').set('Content-Length', '2').send(Buffer.from('{}'));
    expectErrorEnvelope(res, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('does not force a Content-Type on body-less commands (e.g. logout)', async () => {
    const res = await request(makeApp()).post('/v1/admin/auth/logout');
    expectErrorEnvelope(res, { status: 401, code: 'AUTHENTICATION_REQUIRED' });
  });

  it('allows multipart/form-data on upload routes only', async () => {
    const upload = await request(makeApp()).post('/v1/public/prescriptions/upload').field('turnstile_token', 'x');
    expectErrorEnvelope(upload, { status: 403, code: 'TURNSTILE_VERIFICATION_FAILED' });

    const other = await request(makeApp()).post('/v1/public/rfq/cart').field('a', 'b');
    expectErrorEnvelope(other, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('requires multipart on upload routes', async () => {
    const res = await request(makeApp()).post('/v1/public/prescriptions/upload').send({ a: 1 });
    expectErrorEnvelope(res, { status: 400, code: 'INVALID_REQUEST' });
  });

  it.each([
    ['application/json', 200],
    ['*/*', 200],
    ['application/*', 200],
    ['text/html,application/xhtml+xml,*/*;q=0.8', 200],
  ])('accepts Accept: %s', async (accept, status) => {
    const res = await request(makeApp()).get('/v1/health').set('Accept', accept);
    expect(res.status).toBe(status);
  });

  it.each(['text/html', 'application/xml', 'application/json;q=0'])('rejects Accept: %s', async (accept) => {
    const res = await request(makeApp()).get('/v1/health').set('Accept', accept);
    expectErrorEnvelope(res, { status: 400, code: 'INVALID_REQUEST' });
  });

  it('exempts binary/SSE routes from the Accept requirement', async () => {
    const res = await request(makeApp()).get('/v1/admin/stream').set('Accept', 'text/event-stream');
    expectErrorEnvelope(res, { status: 401, code: 'AUTHENTICATION_REQUIRED' });
  });
});

describe('security headers (API-Spec.md 1.2)', () => {
  it('emits the standard response headers', async () => {
    const res = await request(makeApp()).get('/v1/health');
    expect(res.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each(['/v1/public/quotation/token/abc123', '/v1/Public/Quotation/token/abc123'])(
    'marks private quotation route %s as noindex, no-referrer and uncacheable',
    async (path) => {
      const res = await request(makeApp()).get(path);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cache-control']).toBe('no-store');
    },
  );

  it('does not set X-Robots-Tag on non-quotation routes', async () => {
    const res = await request(makeApp()).get('/v1/health');
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows the configured frontend origin with credentials', async () => {
    const res = await request(makeApp()).get('/v1/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-ID');
  });

  it('does not grant CORS to other origins', async () => {
    const res = await request(makeApp()).get('/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers preflight for the allowed origin', async () => {
    const res = await request(makeApp())
      .options('/v1/public/rfq/quick-quote')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-idempotency-key,cf-turnstile-response');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('x-idempotency-key');
  });
});

describe('cookies', () => {
  it('does not crash on a malformed cookie header', async () => {
    const res = await request(makeApp()).get('/v1/health').set('Cookie', 'medaxis_admin_session=%E0%A4%A');
    expect(res.status).toBe(200);
  });
});
