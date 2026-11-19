import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { quotationProbeLimiter } from '../../shared/middleware/rateLimiter.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { sendSuccess } from '../../shared/utils/response.js';
import {
  declineSchema,
  refreshRequestSchema,
  revisionRequestSchema,
} from '../../shared/validators/decision.validator.js';
import type { PdfDelivery } from '../pdf/pdf.worker.js';
import { createDecisionService, type DecisionHooks } from './quotation.decisions.js';
import { isAccepted } from './quotation.lifecycle.js';

export function createPublicQuotationRouter(
  env: AppEnv,
  logger: AppLogger,
  pdf: PdfDelivery,
  hooks: DecisionHooks = {},
) {
  const router = Router();
  const service = createDecisionService(env, logger, {
    ...hooks,
    dispatchPdf: hooks.dispatchPdf ?? (() => pdf.dispatch()),
  });
  router.use(quotationProbeLimiter());
  router.param('token', (_req, _res, next, token: string) => {
    next(/^[a-f0-9]{64}$/.test(token) ? undefined : AppError.notFound());
  });
  const boundary = adminBoundary(env);
  router.get('/token/:token', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await service.get(String(req.params.token)));
  });
  router.post('/accept/:token', boundary, async (req, res) => {
    sendSuccess(res, await service.accept(req, String(req.params.token), req.body));
  });
  router.post('/request-revision/:token', boundary, async (req, res) => {
    await service.resolve(String(req.params.token));
    sendSuccess(
      res,
      await service.requestRevision(req, String(req.params.token), revisionRequestSchema.parse(req.body)),
    );
  });
  router.post('/request-refresh/:token', boundary, async (req, res) => {
    await service.resolve(String(req.params.token));
    sendSuccess(
      res,
      await service.requestRefresh(req, String(req.params.token), refreshRequestSchema.parse(req.body ?? {})),
    );
  });
  router.post('/decline/:token', boundary, async (req, res) => {
    await service.resolve(String(req.params.token));
    sendSuccess(res, await service.decline(req, String(req.params.token), declineSchema.parse(req.body)));
  });
  router.get('/pdf/:token', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const token = String(req.params.token);
    const resolved = await service.resolve(token);
    service.usable(resolved.version);
    let artifact = await pdf.get(resolved.version._id);
    // Acceptance, token rotation and supersession may occur during rendering or object retrieval.
    let current = await service.resolve(token);
    service.usable(current.version);
    if (isAccepted(current.version.status) !== (artifact.mode !== 'ORIGINAL_QUOTE')) {
      artifact = await pdf.get(current.version._id);
      current = await service.resolve(token);
      service.usable(current.version);
    }
    if (isAccepted(current.version.status) !== (artifact.mode !== 'ORIGINAL_QUOTE'))
      throw AppError.conflict('Quotation state changed during PDF generation. Please retry.');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quotation-v${current.version.version_number}.pdf"`,
      'Content-Length': String(artifact.bytes.length),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(Readable.from([artifact.bytes]), res);
  });
  return router;
}
