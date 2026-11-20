import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { hashToken } from '../../shared/utils/crypto.js';
import { sendSuccess } from '../../shared/utils/response.js';
import { ProductRatingModel } from './product-rating.schema.js';
import { uuid } from './catalog.validator.js';
import type { PublicProduct } from './catalog.dto.js';

export const ratingBody = z.object({ score: z.number().int().min(1).max(5) }).strict();
const COOKIE = 'medaxis_rating_visitor';

export function createProductRatingRouter(env: AppEnv, findProduct: (id: string) => Promise<PublicProduct>) {
  const router = Router({ mergeParams: true });
  const writes = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.tooManyRequests(60)) });
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.vary('Cookie'); next(); });
  router.get('/', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const product = await findProduct(id);
    const visitor = z.uuid().safeParse(req.signedCookies?.[COOKIE]);
    const own = visitor.success ? await ProductRatingModel.findOne({ product_id: id, visitor_hash: hashToken(visitor.data) }).select({ _id: 0, score: 1 }).lean() : null;
    sendSuccess(res, { ...product.customer_rating, my_rating: own?.score ?? null });
  });
  router.put('/', writes, async (req, res) => {
    // Rating cookies must never authorize a cross-origin vote.
    const origin = req.get('origin');
    if (!origin || !env.PUBLIC_ORIGIN.includes(origin)) throw AppError.forbidden();
    z.object({}).strict().parse(req.query);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { score } = ratingBody.parse(req.body);
    await findProduct(id);
    const existing = z.uuid().safeParse(req.signedCookies?.[COOKIE]);
    const visitor = existing.success ? existing.data : randomUUID();
    const filter = { product_id: id, visitor_hash: hashToken(visitor) };
    try {
      await ProductRatingModel.updateOne(filter, { $set: { score } }, { upsert: true, runValidators: true });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      await ProductRatingModel.updateOne(filter, { $set: { score } }, { runValidators: true });
    }
    const product = await findProduct(id);
    res.cookie(COOKIE, visitor, { signed: true, httpOnly: true, secure: env.isProduction, sameSite: 'lax', path: '/v1/public/products', maxAge: 365 * 24 * 60 * 60 * 1000 });
    sendSuccess(res, { ...product.customer_rating, my_rating: score });
  });
  return router;
}
