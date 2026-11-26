import { Router } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { sendSuccess } from '../../shared/utils/response.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { createSettingsService, settingsPatch } from './settings.service.js';
import { readPublicSupplyNetwork } from './supply-network.js';

export function createPublicSupplyNetworkRouter() {
  const router = Router();
  router.get('/', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await readPublicSupplyNetwork());
  });
  return router;
}

export function createSettingsRouter(env: AppEnv, revalidate: Revalidate) {
  const router = Router();
  const service = createSettingsService(revalidate);
  router.use(adminBoundary(env), adminAuth(env));
  router.get('/', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await service.get());
  });
  router.patch('/', async (req, res) => {
    sendSuccess(res, await service.patch(req, settingsPatch.parse(req.body)));
  });
  return router;
}
