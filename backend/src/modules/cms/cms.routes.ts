import { Router } from 'express';
import type { AppEnv } from '../../config/env.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { sendSuccess } from '../../shared/utils/response.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { localeQuery } from '../catalog/catalog.validator.js';
import { bannerBody, createCmsService } from './cms.service.js';

export function createCmsRouters(env: AppEnv, revalidate: Revalidate) {
  const service = createCmsService(revalidate);
  const publicRouter = Router();
  const adminRouter = Router();
  publicRouter.get('/banners', async (req, res) => {
    const query = localeQuery.parse(req.query);
    sendSuccess(res, await service.active(query.locale));
  });
  adminRouter.use(adminBoundary(env), adminAuth(env));
  adminRouter.post('/banners', async (req, res) => {
    sendSuccess(res, await service.save(req, bannerBody.parse(req.body)));
  });
  return { publicRouter, adminRouter };
}
