import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { Router, type Express } from 'express';
import { API_BASE_PATH } from './config/constants.js';
import { checkDatabase as defaultCheckDatabase, type CheckDatabaseFn } from './config/db.js';
import type { AppEnv } from './config/env.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import type { AuthHooks } from './modules/auth/auth.security.js';
import { createPublicCatalogRouter, createAdminCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createCmsRouters } from './modules/cms/cms.routes.js';
import { createSettingsRouter } from './modules/settings/settings.routes.js';
import { createRevalidator } from './shared/utils/revalidate.js';
import { apiVersionGuard, headerContract } from './shared/middleware/apiGuards.js';
import { clientIp } from './shared/middleware/clientIp.js';
import { errorHandler, notFoundHandler } from './shared/middleware/errorHandler.js';
import { requestId } from './shared/middleware/requestId.js';
import { requestLogger } from './shared/middleware/requestLogger.js';
import { corsPolicy, privateQuotationHeaders, securityHeaders } from './shared/middleware/security.js';
import type { AppLogger } from './shared/utils/logger.js';
import { createRfqRouter, type RfqOptions } from './modules/rfq/rfq.routes.js';
import { createFxService, type FxService } from './modules/fx/fx.service.js';
import { createFxRouter } from './modules/fx/fx.routes.js';
import { createQuotationRouter } from './modules/quotation/quotation.routes.js';
import type { QuotationHooks } from './modules/quotation/quotation.service.js';
import { createPublicQuotationRouter } from './modules/quotation/quotation.public.routes.js';
import type { DecisionHooks } from './modules/quotation/quotation.decisions.js';
import { createPdfRuntime, type PdfDelivery } from './modules/pdf/pdf.worker.js';
import { createAdminStream, type AdminStream } from './modules/admin/admin.stream.js';
import { createAdminOperationsRouter } from './modules/admin/admin.operations.js';

export interface CreateAppOptions {
  env: AppEnv;
  logger: AppLogger;
  checkDatabase?: CheckDatabaseFn;
  startedAt?: number;
  authHooks?: AuthHooks;
  revalidateFetch?: typeof fetch;
  rfq?: RfqOptions;
  fx?: FxService;
  quotationHooks?: QuotationHooks;
  decisionHooks?: DecisionHooks;
  pdf?: PdfDelivery;
  adminStream?: AdminStream;
}

export function createApp({
  env,
  logger,
  checkDatabase = defaultCheckDatabase,
  startedAt = Date.now(),
  authHooks,
  revalidateFetch,
  rfq,
  fx = createFxService(env, logger),
  quotationHooks,
  decisionHooks,
  pdf = createPdfRuntime(env, logger),
  adminStream = createAdminStream(logger),
}: CreateAppOptions): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(clientIp({ trustCloudflare: env.TRUST_CLOUDFLARE_HEADERS }));
  app.use(requestLogger(logger));
  app.use(securityHeaders());
  app.use(corsPolicy(env.PUBLIC_ORIGIN));
  app.use(
    compression({
      filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (type.includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  app.use(apiVersionGuard());
  app.use(privateQuotationHeaders());
  app.use(cookieParser(env.ADMIN_SESSION_SECRET));
  app.use(headerContract());
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        if (req.url?.split('?')[0]?.replace(/\/$/, '') === '/v1/public/webhooks/email-reply')
          (req as express.Request).rawBody = Buffer.from(buffer);
      },
    }),
  );

  const v1 = Router();
  v1.use(createHealthRouter({ checkDatabase, startedAt }));
  v1.use('/admin/auth', createAuthRouter({ env, logger, hooks: authHooks }));
  const revalidate = createRevalidator(env, logger, revalidateFetch);
  const cms = createCmsRouters(env, revalidate);
  v1.use('/public', createPublicCatalogRouter(env));
  v1.use('/public/cms', cms.publicRouter);
  v1.use('/admin/catalog', createAdminCatalogRouter(env, revalidate));
  v1.use('/admin/cms', cms.adminRouter);
  v1.use('/admin/settings', createSettingsRouter(env, revalidate));
  v1.use(createRfqRouter(env, logger, rfq));
  v1.use('/admin/fx-rates', createFxRouter(env, fx));
  v1.use(
    '/admin/quotations',
    createQuotationRouter(env, fx, logger, quotationHooks ?? { dispatchNotifications: () => pdf.dispatch() }),
  );
  v1.use('/public/quotation', createPublicQuotationRouter(env, logger, pdf, decisionHooks));
  v1.use('/admin', createAdminOperationsRouter(env, adminStream));
  app.use(API_BASE_PATH, v1);

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
