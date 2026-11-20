import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProductRatingRouter, ratingBody } from '../src/modules/catalog/product-rating.routes.js';
import { ProductRatingModel } from '../src/modules/catalog/product-rating.schema.js';
import { loadEnv } from '../src/config/env.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';
import type { PublicProduct } from '../src/modules/catalog/catalog.dto.js';

const env = loadEnv(validEnv);
const id = randomUUID();
afterEach(() => vi.restoreAllMocks());
function setup() {
  const product = { customer_rating: { average: 4, count: 1 } } as PublicProduct;
  const findProduct = vi.fn(async () => product);
  const app = express();
  app.use(express.json(), cookieParser(env.ADMIN_SESSION_SECRET));
  app.use('/v1/public/products/:id/ratings', createProductRatingRouter(env, findProduct));
  app.use(errorHandler(createLogger({ silent: true })));
  return { app, findProduct };
}
describe('customer ratings', () => {
  it('accepts only whole-number scores between one and five without extra claims or identifiers', () => {
    for (const score of [0, 6, 2.5, '5', null]) expect(ratingBody.safeParse({ score }).success).toBe(false);
    expect(ratingBody.safeParse({ score: 5, visitor_hash: 'forged' }).success).toBe(false);
    expect(ratingBody.parse({ score: 5 })).toEqual({ score: 5 });
  });
  it('serves an anonymous aggregate without exposing a visitor identifier', async () => {
    const { app } = setup();
    const response = await request(app).get(`/v1/public/products/${id}/ratings`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ average: 4, count: 1, my_rating: null });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('rejects cross-origin, origin-less and hidden-product votes before a write', async () => {
    const { app, findProduct } = setup();
    const update = vi.spyOn(ProductRatingModel, 'updateOne').mockResolvedValue({} as never);
    for (const origin of [undefined, 'https://untrusted.example']) {
      const call = request(app).put(`/v1/public/products/${id}/ratings`).send({ score: 5 });
      if (origin) call.set('Origin', origin);
      expect((await call).status).toBe(403);
    }
    findProduct.mockRejectedValueOnce(AppError.notFound());
    expect((await request(app).put(`/v1/public/products/${id}/ratings`).set('Origin', validEnv.PUBLIC_ORIGIN).send({ score: 5 })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
  it('updates the same signed browser vote instead of adding another rating', async () => {
    const { app } = setup();
    const update = vi.spyOn(ProductRatingModel, 'updateOne').mockResolvedValue({} as never);
    const first = await request(app).put(`/v1/public/products/${id}/ratings`).set('Origin', validEnv.PUBLIC_ORIGIN).send({ score: 4 });
    expect(first.status).toBe(200);
    const cookies = first.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = cookies?.[0];
    if (!cookie) throw new Error('The successful vote did not set its browser cookie.');
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
    const second = await request(app).put(`/v1/public/products/${id}/ratings`).set('Origin', validEnv.PUBLIC_ORIGIN).set('Cookie', cookie.split(';')[0]!).send({ score: 5 });
    expect(second.status).toBe(200);
    expect(update.mock.calls[0]![0]).toEqual(update.mock.calls[1]![0]);
    expect(update.mock.calls[0]![0]).toMatchObject({ product_id: id, visitor_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(update.mock.calls[1]![1]).toEqual({ $set: { score: 5 } });
    expect(second.body.data.my_rating).toBe(5);
    const read = vi.spyOn(ProductRatingModel, 'findOne').mockReturnValue({ select: () => ({ lean: async () => ({ score: 5 }) }) } as never);
    const own = await request(app).get(`/v1/public/products/${id}/ratings`).set('Cookie', cookie.split(';')[0]!);
    expect(own.body.data.my_rating).toBe(5);
    expect(read).toHaveBeenCalledWith(update.mock.calls[0]![0]);
  });
  it('bounds mutation volume and never writes an eleventh vote in a minute', async () => {
    const { app } = setup();
    const update = vi.spyOn(ProductRatingModel, 'updateOne').mockResolvedValue({} as never);
    for (let index = 0; index < 10; index++) expect((await request(app).put(`/v1/public/products/${id}/ratings`).set('Origin', validEnv.PUBLIC_ORIGIN).send({ score: 3 })).status).toBe(200);
    expect((await request(app).put(`/v1/public/products/${id}/ratings`).set('Origin', validEnv.PUBLIC_ORIGIN).send({ score: 3 })).status).toBe(429);
    expect(update).toHaveBeenCalledTimes(10);
  });
});
