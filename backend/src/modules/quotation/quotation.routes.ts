import { Router } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { sendSuccess } from '../../shared/utils/response.js';
import {
  draftQuoteSchema,
  reviseQuoteSchema,
  resendQuoteSchema,
  sendQuoteSchema,
  updateDraftQuoteSchema,
} from '../../shared/validators/quotation.validator.js';
import { uuid } from '../catalog/catalog.validator.js';
import type { FxService } from '../fx/fx.service.js';
import { createQuotationService, type QuotationHooks } from './quotation.service.js';
import { createFulfillmentService } from './quotation.fulfillment.js';
import { fulfillmentSchema } from '../../shared/validators/decision.validator.js';
import {
  listQuotations,
  quotationListQuery,
  quotationSummary,
  quotationSummaryQuery,
} from './quotation.admin.reads.js';
import { sendPaginated } from '../../shared/utils/response.js';

export function createQuotationRouter(env: AppEnv, fx: FxService, logger: AppLogger, hooks?: QuotationHooks) {
  const router = Router();
  const service = createQuotationService(env, fx, logger, hooks);
  const fulfill = createFulfillmentService(logger, hooks?.dispatchNotifications);
  router.use(adminBoundary(env), adminAuth(env));
  router.get('/', async (req, res) => {
    const query = quotationListQuery.parse(req.query);
    const result = await listQuotations(query);
    sendPaginated(res, result.items, { ...query, totalItems: result.total });
  });
  router.get('/summary', async (req, res) => {
    const query = quotationSummaryQuery.parse(req.query);
    sendSuccess(res, await quotationSummary(query.window_hours));
  });
  router.patch('/:id/draft', async (req, res) => {
    sendSuccess(res, await service.updateDraft(req, uuid.parse(req.params.id), updateDraftQuoteSchema.parse(req.body)));
  });
  router.patch('/:id/fulfillment', async (req, res) => {
    sendSuccess(res, await fulfill(req, uuid.parse(req.params.id), fulfillmentSchema.parse(req.body)));
  });
  router.post('/draft', async (req, res) => {
    sendSuccess(res, await service.draft(req, draftQuoteSchema.parse(req.body)), { status: 201 });
  });
  router.post('/:id/send', async (req, res) => {
    sendSuccess(res, await service.send(req, uuid.parse(req.params.id), sendQuoteSchema.parse(req.body ?? {})));
  });
  router.post('/:id/revise', async (req, res) => {
    sendSuccess(res, await service.revise(req, uuid.parse(req.params.id), reviseQuoteSchema.parse(req.body)), {
      status: 201,
    });
  });
  router.post('/:id/resend', async (req, res) => {
    const body = resendQuoteSchema.parse(req.body ?? {});
    sendSuccess(res, await service.resend(req, uuid.parse(req.params.id), body.expected_version_id));
  });
  router.get('/:id', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await service.detail(uuid.parse(req.params.id)));
  });
  return router;
}
