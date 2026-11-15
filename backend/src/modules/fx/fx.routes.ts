import { Router } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { sendSuccess } from '../../shared/utils/response.js';
import { fxPatchSchema } from '../../shared/validators/quotation.validator.js';
import type { FxService } from './fx.service.js';

export function createFxRouter(env: AppEnv, service: FxService) {
  const router = Router();
  router.use(adminBoundary(env), adminAuth(env));
  router.get('/', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await service.inspect());
  });
  router.patch('/', async (req, res) => {
    sendSuccess(res, await service.patch(req, fxPatchSchema.parse(req.body)));
  });
  return router;
}
