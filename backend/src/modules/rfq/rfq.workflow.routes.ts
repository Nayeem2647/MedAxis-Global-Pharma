import { Router } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import type { FxService } from '../fx/fx.service.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { quotationProbeLimiter } from '../../shared/middleware/rateLimiter.js';
import { sendSuccess } from '../../shared/utils/response.js';
import { pagination } from '../catalog/catalog.routes.js';
import { createDecisionService, type DecisionHooks } from '../quotation/quotation.decisions.js';
import { acceptSchema, declineSchema } from '../../shared/validators/decision.validator.js';
import {
  createRfqWorkflow,
  guestLinkBody,
  ledgerQuery,
  negotiateBody,
  paymentRequestBody,
  responseBody,
  reviewBody,
} from './rfq.workflow.js';

export function createRfqWorkflowRouter(env: AppEnv, fx: FxService, logger: AppLogger, hooks: DecisionHooks = {}) {
  const router = Router();
  const workflow = createRfqWorkflow(env, fx, logger, hooks);
  const decisions = createDecisionService(env, logger, hooks);
  const guard = [adminBoundary(env), adminAuth(env)];
  const admin = '/admin/rfq-workflow';
  const publicPath = '/public/rfq-workflow/:token';
  router.use('/public/rfq-workflow', quotationProbeLimiter(), (_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    next();
  });
  router.get(admin, ...guard, async (req, res) => {
    const query = ledgerQuery.parse(req.query);
    const data = await workflow.ledger(query);
    sendSuccess(
      res,
      { rows: data.rows, summary: data.summary },
      { meta: { pagination: pagination(query.page, query.limit, data.total) } },
    );
  });
  router.get(`${admin}/:id`, ...guard, async (req, res) => {
    sendSuccess(res, await workflow.detail(z.uuidv4().parse(req.params.id)));
  });
  router.post(`${admin}/:id/review`, ...guard, async (req, res) => {
    sendSuccess(res, await workflow.review(req, z.uuidv4().parse(req.params.id), reviewBody.parse(req.body)));
  });
  router.post(`${admin}/:id/respond`, ...guard, async (req, res) => {
    sendSuccess(res, await workflow.respond(req, z.uuidv4().parse(req.params.id), responseBody.parse(req.body)));
  });
  router.post(`${admin}/:id/payment-request`, ...guard, async (req, res) => {
    sendSuccess(
      res,
      await workflow.requestPayment(req, z.uuidv4().parse(req.params.id), paymentRequestBody.parse(req.body)),
    );
  });
  router.post(`${admin}/:id/guest-link`, ...guard, async (req, res) => {
    sendSuccess(res, await workflow.guestLink(req, z.uuidv4().parse(req.params.id), guestLinkBody.parse(req.body)));
  });
  router.get(publicPath, async (req, res) => {
    sendSuccess(res, await workflow.guest(String(req.params.token)));
  });
  router.post(`${publicPath}/negotiate`, adminBoundary(env), async (req, res) => {
    sendSuccess(res, await workflow.negotiate(req, String(req.params.token), negotiateBody.parse(req.body)));
  });
  router.post(`${publicPath}/accept`, adminBoundary(env), async (req, res) => {
    sendSuccess(res, await decisions.accept(req, String(req.params.token), acceptSchema.parse(req.body)));
  });
  router.post(`${publicPath}/decline`, adminBoundary(env), async (req, res) => {
    sendSuccess(res, await decisions.decline(req, String(req.params.token), declineSchema.parse(req.body)));
  });
  return router;
}
