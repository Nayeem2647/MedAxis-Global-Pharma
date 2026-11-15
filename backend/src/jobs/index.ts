import cron from 'node-cron';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../shared/utils/logger.js';
import type { FxService } from '../modules/fx/fx.service.js';
import type { NotificationService } from '../modules/notification/notification.service.js';
import type { StorageService } from '../modules/storage/storage.service.js';
import { createNotificationRetryJob } from './notificationRetry.job.js';
import { createReservationExpiryJob } from './reservationExpiry.job.js';
import { createQuotationExpiryJob } from './quotationExpiry.job.js';
import { createExpiryReminderJob } from './expiryReminder.job.js';
import { createFxRateRefreshJob } from './fxRateRefresh.job.js';
import { createPrescriptionPurgeJob } from './prescriptionPurge.job.js';

export function registerJobs(
  env: AppEnv,
  logger: AppLogger,
  dependencies: { notifications: NotificationService; fx: FxService; storage: StorageService },
  scheduler: Pick<typeof cron, 'schedule'> = cron,
) {
  const tasks: ReturnType<typeof cron.schedule>[] = [];
  const running = new Set<Promise<void>>();
  let stopped = false;
  const reminder = createExpiryReminderJob();
  const definitions = [
    ['notification-retry', '*/15 * * * *', createNotificationRetryJob(dependencies.notifications)],
    ['reservation-expiry', '*/30 * * * *', createReservationExpiryJob(env, logger)],
    ['quotation-expiry', '0 0 * * *', createQuotationExpiryJob(env, logger)],
    ['quotation-reminder', '0 9 * * *', () => reminder('QUOTATION_24H')],
    ['payment-reminder', '0 10 * * *', () => reminder('RESERVATION_DAY3')],
    ['fx-refresh', '0 * * * *', createFxRateRefreshJob(dependencies.fx)],
    ['prescription-purge', '0 * * * *', createPrescriptionPurgeJob(env, logger, dependencies.storage)],
  ] as const;
  if (!env.isTest)
    for (const [name, expression, run] of definitions)
      tasks.push(
        scheduler.schedule(
          expression,
          async () => {
            if (stopped) return;
            const operation = Promise.resolve()
              .then(async () => {
                await run();
              })
              .then(async () => {
                if (name !== 'notification-retry') await dependencies.notifications.dispatch();
              })
              .catch(() => {
                logger.error('Scheduled job failed', { job: name });
              })
              .finally(() => {
                running.delete(operation);
              });
            running.add(operation);
            await operation;
          },
          { name, timezone: 'Asia/Dhaka', noOverlap: true },
        ),
      );
  async function stop() {
    stopped = true;
    await Promise.all(tasks.map((task) => task.destroy()));
  }
  async function close() {
    await stop();
    await Promise.allSettled([...running]);
  }
  return { tasks, stop, close };
}
