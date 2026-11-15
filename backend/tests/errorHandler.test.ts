import express, { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/errors/AppError.js';
import { errorHandler, normalizeError, notFoundHandler } from '../src/shared/middleware/errorHandler.js';
import { requestId } from '../src/shared/middleware/requestId.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { sendPaginated, sendSuccess } from '../src/shared/utils/response.js';

const logger = createLogger({ silent: true });

function appThatThrows(error: unknown) {
  const app = express();
  app.use(requestId());
  app.get('/boom', () => {
    throw typeof error === 'function' ? (error as () => unknown)() : error;
  });
  app.get('/stream', (_req, res) => {
    res.write('partial');
    throw new Error('broke mid-stream');
  });
  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}

describe('errorHandler', () => {
  it('preserves intentional AppErrors', async () => {
    const res = await request(appThatThrows(AppError.forbidden('Account locked.'))).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: 'ACCESS_DENIED', message: 'Account locked.', status: 403 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets Retry-After as a positive integer for 429', async () => {
    const res = await request(appThatThrows(AppError.tooManyRequests(42))).get('/boom');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('maps Zod errors to 422 VALIDATION_FAILED with field/issue pairs', async () => {
    const schema = z.object({ items: z.array(z.object({ quantity: z.number().int().min(1) })) });
    const parsed = schema.safeParse({ items: [{ quantity: 0 }] });
    const res = await request(appThatThrows(parsed.error)).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'items.0.quantity', issue: expect.any(String) }),
    ]);
  });

  it('maps Mongoose validation errors without echoing submitted values', async () => {
    const M = mongoose.model(
      'ErrHandlerProbe',
      new mongoose.Schema({ status: { type: String, enum: ['A'], required: true } }),
    );
    const err = await new M({ status: 'SECRET-VALUE-123' }).validate().catch((e: unknown) => e);
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ field: 'status', issue: 'Value is not an allowed option.' }]);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-VALUE-123');
  });

  it('maps CastError to 400 INVALID_REQUEST', async () => {
    const err = new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id');
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(JSON.stringify(res.body)).not.toContain('not-an-id');
  });

  it('maps duplicate-key errors to 409 without leaking key values', async () => {
    const err = Object.assign(new Error('E11000 duplicate key { email: "buyer@secret.test" }'), { code: 11000 });
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESOURCE_STATE_CONFLICT');
    expect(JSON.stringify(res.body)).not.toContain('buyer@secret.test');
  });

  it('maps MongoDB connectivity failures to 503 with Retry-After', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:27017'), { name: 'MongoServerSelectionError' });
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('5');
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });

  it('sanitizes unexpected errors to 500 INTERNAL_SERVER_ERROR (no message, stack or internals)', async () => {
    const res = await request(
      appThatThrows(new Error('db query {$where: "password"} failed at /srv/app/secret.js')),
    ).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('$where');
    expect(text).not.toContain('secret.js');
    expect(text).not.toContain('stack');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('omits `details` when there are none', async () => {
    const res = await request(appThatThrows(AppError.notFound())).get('/boom');
    expect(res.body.error).not.toHaveProperty('details');
  });

  it('terminates the connection instead of appending JSON after headers are sent', async () => {
    const res = await request(appThatThrows(new Error('x')))
      .get('/stream')
      .catch((e: { text?: string }) => e);
    const body = res?.text ?? '';
    expect(body).not.toContain('"success"');
  });
});

describe('normalizeError', () => {
  it('returns AppError instances unchanged', () => {
    const err = AppError.conflict();
    expect(normalizeError(err)).toBe(err);
  });

  it('handles non-Error throwables', () => {
    expect(normalizeError('weird').status).toBe(500);
    expect(normalizeError(undefined).code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('maps body-parser parse failures to MALFORMED_JSON', () => {
    const e = normalizeError(
      Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 }),
    );
    expect(e.code).toBe('MALFORMED_JSON');
    expect(e.status).toBe(400);
  });
});

describe('response helpers', () => {
  function appWith(handler: (req: Request, res: Response) => unknown) {
    const app = express();
    app.use(requestId());
    app.get('/x', handler);
    return app;
  }

  it('sendSuccess returns { success, data, meta }', async () => {
    const res = await request(appWith((_req, r) => sendSuccess(r, { hello: 'world' }, { status: 201 }))).get('/x');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { hello: 'world' } });
    expect(res.body.meta).toEqual({ timestamp: expect.any(String), request_id: res.headers['x-request-id'] });
  });

  it('sendPaginated computes pagination meta', async () => {
    const res = await request(
      appWith((_req, r) => sendPaginated(r, [1, 2], { page: 2, limit: 20, totalItems: 142 })),
    ).get('/x');
    expect(res.body.meta.pagination).toEqual({
      page: 2,
      limit: 20,
      total_items: 142,
      total_pages: 8,
      has_next: true,
      has_prev: true,
    });
  });

  it('sendPaginated reports a single empty page for zero results', async () => {
    const res = await request(appWith((_req, r) => sendPaginated(r, [], { page: 1, limit: 20, totalItems: 0 }))).get(
      '/x',
    );
    expect(res.body.meta.pagination).toMatchObject({ total_pages: 1, has_next: false, has_prev: false });
  });
});
