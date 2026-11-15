import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../shared/utils/logger.js';
import { createExpiryWorker } from './expiry.worker.js';
export const createReservationExpiryJob = (env: AppEnv, logger: AppLogger) =>
  createExpiryWorker(env, logger, 'RESERVATION');
