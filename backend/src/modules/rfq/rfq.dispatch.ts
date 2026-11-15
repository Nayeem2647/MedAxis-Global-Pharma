import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { createNotificationService } from '../notification/notification.service.js';

/** Compatibility entry point: all email work now uses the durable shared worker. */
export function createRfqDispatcher(env: AppEnv, logger: AppLogger, fetcher: typeof fetch = fetch) {
  return createNotificationService(env, logger, { fetcher }).dispatch;
}
