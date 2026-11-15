import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';

// Contract tests isolate persistence/auth adapters. Existing integration suites
// exercise real authentication and business success/failure paths against MongoDB.
vi.mock('../src/shared/middleware/adminAuth.js', async (original) => ({
  ...(await original<typeof import('../src/shared/middleware/adminAuth.js')>()),
  adminAuth:
    () => (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
      req.admin = { id: randomUUID(), sessionId: randomUUID() };
      next();
    },
}));
vi.mock('../src/modules/auth/auth.service.js', () => ({ createAuthService: () => ({ sessions: async () => [] }) }));
const spec = readFileSync(new URL('../../Docs/API-Spec.md', import.meta.url), 'utf8');
const contracts = [...spec.matchAll(/\|\s*\*\*(\d{2})\*\*\s*\|\s*(GET|POST|PATCH)\s*\|\s*(\/v1\/[^\s|]+)\s*\|/g)].map(
  (match) => ({ id: Number(match[1]), method: match[2]!.toLowerCase() as 'get' | 'post' | 'patch', path: match[3]! }),
);
describe('all 52 API-Spec endpoint envelopes and registered validation boundaries', () => {
  it('covers the complete numbered Release 1 endpoint table', () => {
    expect(contracts.map((item) => item.id)).toEqual(Array.from({ length: 52 }, (_, index) => index + 1));
  });
  it.each(contracts)('#$id $method $path', async ({ id, method, path }) => {
    const app = createApp({
      env: loadEnv({ ...validEnv, WEBHOOK_HMAC_SECRET: 'test-webhook-secret' }),
      logger: createLogger({ silent: true }),
    });
    const url = path
      .replace(/:slug/g, 'invalid-slug')
      .replace(/:token/g, 'invalid-token')
      .replace(/:(?:itemId|id)/g, 'invalid-id');
    const call = request(app)[method](url);
    if (method === 'get' && id <= 7) call.query({ locale: 'invalid' });
    else if (method === 'get' && id >= 25) call.query({ limit: 0 });
    if (id === 10) call.field('turnstile_token', '');
    else if (id === 41) call.field('dry_run', 'true');
    else if (method !== 'get') call.send({ unexpected: true });
    const result = await call;
    const expected = id === 22 ? 200 : id >= 8 && id <= 11 ? 403 : id >= 12 && id <= 17 ? 404 : 422;
    expect(result.status, JSON.stringify(result.body)).toBe(expected);
    expect(result.headers['content-type']).toMatch(/application\/json/);
    expect(result.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/i);
    expect(result.body.meta.request_id).toBe(result.headers['x-request-id']);
    expect(Number.isFinite(Date.parse(result.body.meta.timestamp))).toBe(true);
    expect(result.body.success).toBe(expected < 400);
    if (expected >= 400) {
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.error.status).toBe(expected);
      expect(result.body.error.code).not.toBe('ROUTE_NOT_FOUND');
      expect(result.body.error.message).toEqual(expect.any(String));
    } else expect(result.body.data).toEqual([]);
  });
});
