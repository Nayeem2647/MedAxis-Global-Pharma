import 'dotenv/config';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase, registerGracefulShutdown } from './config/db.js';
import { createFxService } from './modules/fx/fx.service.js';
import { createPdfRuntime } from './modules/pdf/pdf.worker.js';
import { createAdminStream } from './modules/admin/admin.stream.js';
import { createNotificationService } from './modules/notification/notification.service.js';
import { createStorageService, initializeLocalStorage } from './modules/storage/storage.service.js';
import { registerJobs } from './jobs/index.js';
import { EnvValidationError, loadEnv, type AppEnv } from './config/env.js';
import { getLogger } from './shared/utils/logger.js';

async function main(): Promise<void> {
  let env: AppEnv;
  try {
    env = loadEnv(process.env);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const logger = getLogger(env);

  await initializeLocalStorage(env);
  await connectDatabase(env, logger);

  const fx = createFxService(env, logger);
  await fx.hydrate();
  if (!env.isTest) await fx.refresh();
  const storage = createStorageService(env);
  const pdf = createPdfRuntime(env, logger, { storage });
  const notifications = createNotificationService(env, logger);
  const adminStream = createAdminStream(logger);
  const app = createApp({
    env,
    logger,
    fx,
    pdf,
    adminStream,
    storage,
    rfq: { hooks: { dispatchNotifications: notifications.dispatch } },
    quotationHooks: {
      dispatchNotifications: async () => {
        await Promise.all([notifications.dispatch(), pdf.dispatch()]);
      },
    },
    decisionHooks: { dispatchNotifications: notifications.dispatch, dispatchPdf: pdf.dispatch },
    authHooks: { onSecurityEvent: notifications.securityEvent },
  });
  const jobs = env.isTest ? undefined : registerJobs(env, logger, { notifications, fx, storage });
  if (!env.isTest) {
    pdf.start();
    void notifications.dispatch();
  }
  const server = app.listen(env.PORT, () => {
    logger.info('MedAxis Global Pharma API listening', { port: env.PORT, node_env: env.NODE_ENV });
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  registerGracefulShutdown({
    server,
    logger,
    beforeClose: async () => {
      adminStream.close();
      pdf.stop();
      fx.stop();
      notifications.stop();
      await jobs?.stop();
    },
    disconnect: async () => {
      await pdf.close();
      await jobs?.close();
      await notifications.close();
      await disconnectDatabase();
    },
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal startup error: ${message}\n`);
  process.exit(1);
});
