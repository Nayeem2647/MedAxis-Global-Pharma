import { Router } from 'express';
import { API_VERSION, SERVICE_NAME } from '../../config/constants.js';
import type { CheckDatabaseFn } from '../../config/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { sendSuccess } from '../../shared/utils/response.js';

export function createHealthRouter({
  checkDatabase,
  startedAt = Date.now(),
}: {
  checkDatabase: CheckDatabaseFn;
  startedAt?: number;
}): Router {
  const router = Router();

  router.get('/health', async (_req, res, next) => {
    try {
      const database = await checkDatabase();
      if (database.status !== 'connected') {
        throw AppError.unavailable('Database connection is unavailable.', 5);
      }
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, {
        status: 'ok',
        service: SERVICE_NAME,
        api_version: API_VERSION,
        uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
        database,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
