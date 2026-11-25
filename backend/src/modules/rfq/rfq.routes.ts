import { Router, type ErrorRequestHandler, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { rfqRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { turnstile, turnstileToken } from '../../shared/middleware/turnstile.js';
import { generateToken, hashToken } from '../../shared/utils/crypto.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { sendSuccess } from '../../shared/utils/response.js';
import {
  availabilitySchema,
  closeSchema,
  messageSchema,
  noteSchema,
  parseRfqIntake,
  replySchema,
  rfqListSchema,
  statusSchema,
} from '../../shared/validators/rfq.validator.js';
import { uuid } from '../catalog/catalog.validator.js';
import { pagination } from '../catalog/catalog.routes.js';
import {
  createStorageService,
  MAX_FILE_BYTES,
  validatePrescription,
  type StorageService,
} from '../storage/storage.service.js';
import { PrescriptionModel } from '../storage/storage.schema.js';
import { createRfqIntakeService, findRfqReplay, DAY_MS, STAGING_COOKIE } from './rfq.intake.service.js';
import { createRfqSignals, type RfqHooks } from './rfq.events.js';
import { createRfqAdminService } from './rfq.admin.service.js';
import { createRfqDispatcher } from './rfq.dispatch.js';
import { recordEmailReply, verifyEmailWebhook } from './rfq.webhook.js';

export interface RfqOptions {
  notificationFetch?: typeof fetch;
  turnstileFetch?: typeof fetch;
  storage?: StorageService;
  hooks?: RfqHooks;
}
export function createRfqRouter(env: AppEnv, logger: AppLogger, options: RfqOptions = {}) {
  const router = Router();
  const signals = createRfqSignals(logger, {
    ...options.hooks,
    dispatchNotifications:
      options.hooks?.dispatchNotifications ?? createRfqDispatcher(env, logger, options.notificationFetch),
  });
  const intake = createRfqIntakeService(env, signals);
  const admin = createRfqAdminService(signals);
  const storage = options.storage ?? createStorageService(env);
  const bot = turnstile(env, options.turnstileFetch);
  const rate = rfqRateLimiter();
  const uploadRate = rfqRateLimiter();
  const boundary = adminBoundary(env);
  const guard = adminAuth(env);
  const cookieOptions = {
    httpOnly: true,
    signed: true,
    secure: env.isProduction,
    sameSite: 'strict' as const,
    path: '/v1/public',
  };
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  for (const [path, kind] of [
    ['quick-quote', 'QUICK_QUOTE'],
    ['cart', 'CART_RFQ'],
  ] as const)
    router.post(`/public/rfq/${path}`, rate, boundary, async (req, res) => {
      turnstileToken(req);
      const input = parseRfqIntake(req.body, kind, req.get('x-idempotency-key'));
      const replay = await findRfqReplay(req, input, kind);
      if (replay) {
        sendSuccess(res, replay);
        return;
      }
      // An already committed payload can replay without spending a single-use bot token again.
      await new Promise<void>((resolve, reject) => {
        void bot(req, res, (error?: unknown) => (error ? reject(error) : resolve()));
      });
      const result = await intake(req, input, kind);
      sendSuccess(res, result.snapshot, { status: result.replayed ? 200 : 201 });
    });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 2, parts: 3 },
  });
  const uploadError: ErrorRequestHandler = (error, _req, _res, next) => {
    next(
      error instanceof multer.MulterError
        ? AppError.badRequest('Invalid prescription upload or file exceeds 5 MiB.', 'INVALID_PRESCRIPTION_FILE')
        : error,
    );
  };
  router.post(
    '/public/prescriptions/upload',
    uploadRate,
    boundary,
    upload.single('prescription'),
    uploadError,
    bot,
    async (req: Request, res: Response) => {
      z.object({ turnstile_token: z.string().max(2048).optional(), attachment_kind: z.enum(['PRESCRIPTION', 'SUPPORTING']).optional() })
        .strict()
        .parse(req.body ?? {});
      if (!req.file) throw AppError.badRequest('Prescription file is required.', 'INVALID_PRESCRIPTION_FILE');
      const actualMime = await validatePrescription(req.file.buffer);
      if (req.file.mimetype !== actualMime)
        throw AppError.badRequest(
          'Prescription MIME type must match its JPEG, PNG or PDF content.',
          'INVALID_PRESCRIPTION_FILE',
        );
      const existing: unknown = req.signedCookies?.[STAGING_COOKIE];
      const token = typeof existing === 'string' && /^[a-f0-9]{64}$/.test(existing) ? existing : generateToken();
      const object = await storage.uploadPrescription(req.file.buffer);
      const now = new Date();
      const doc = new PrescriptionModel({
        attachment_kind: req.body.attachment_kind ?? 'PRESCRIPTION',
        upload_token_hash: hashToken(token),
        object_key: object.object_key,
        encryption: object.encryption,
        mime_type: object.mime_type,
        file_size_bytes: object.file_size_bytes,
        uploaded_at: now,
        purge_scheduled_at: new Date(now.getTime() + 90 * DAY_MS),
        purge_status: 'ACTIVE',
      });
      try {
        await doc.save();
      } catch (error) {
        try {
          if (error instanceof Error && (error.name === 'ValidationError' || ('code' in error && error.code === 121)))
            await storage.remove('prescriptions', object.object_key);
          else logger.error('Prescription write outcome uncertain; uploaded object retained for reconciliation', { request_id: req.requestId });
        } catch {
          logger.error('Prescription upload compensation failed; storage reconciliation required', {
            request_id: req.requestId,
          });
        }
        throw error;
      }
      res.cookie(STAGING_COOKIE, token, { ...cookieOptions, maxAge: 90 * DAY_MS });
      sendSuccess(
        res,
        { prescription_id: doc._id, mime_type: doc.mime_type, file_size_bytes: doc.file_size_bytes, uploaded_at: now },
        { status: 201 },
      );
    },
  );
  router.post('/public/webhooks/email-reply', verifyEmailWebhook(env), async (req, res) => {
    sendSuccess(res, await recordEmailReply(req, replySchema.parse(req.body)));
  });
  const adminPath = '/admin/rfqs';
  router.get(adminPath, boundary, guard, async (req, res) => {
    const query = rfqListSchema.parse(req.query);
    const result = await admin.list(query);
    sendSuccess(res, result.rows, { meta: { pagination: pagination(query.page, query.limit, result.total) } });
  });
  router.get(`${adminPath}/:id`, boundary, guard, async (req, res) => {
    sendSuccess(res, await admin.detail(uuid.parse(req.params.id)));
  });
  router.patch(`${adminPath}/:id/items/:itemId`, boundary, guard, async (req, res) => {
    sendSuccess(
      res,
      await admin.item(
        req,
        uuid.parse(req.params.id),
        uuid.parse(req.params.itemId),
        availabilitySchema.parse(req.body),
      ),
    );
  });
  router.patch(`${adminPath}/:id/status`, boundary, guard, async (req, res) => {
    sendSuccess(res, await admin.status(req, uuid.parse(req.params.id), statusSchema.parse(req.body)));
  });
  router.post(`${adminPath}/:id/request-clarification`, boundary, guard, async (req, res) => {
    sendSuccess(res, await admin.clarify(req, uuid.parse(req.params.id), messageSchema.parse(req.body)));
  });
  router.post(`${adminPath}/:id/unable-to-supply`, boundary, guard, async (req, res) => {
    sendSuccess(res, await admin.close(req, uuid.parse(req.params.id), closeSchema.parse(req.body)));
  });
  router.post(`${adminPath}/:id/notes`, boundary, guard, async (req, res) => {
    sendSuccess(res, await admin.note(req, uuid.parse(req.params.id), noteSchema.parse(req.body)), { status: 201 });
  });
  router.get('/admin/prescriptions/:id/stream', boundary, guard, async (req, res) => {
    const doc = await PrescriptionModel.findOne({
      _id: uuid.parse(req.params.id),
      purge_status: { $in: ['ACTIVE', 'PENDING'] },
      purge_scheduled_at: { $gt: new Date() },
    }).lean();
    const key = doc?.object_key ?? doc?.r2_storage_key;
    if (!doc || !key || !doc.encryption) throw AppError.notFound();
    const plaintext = await storage.downloadPrescription({
      object_key: key,
      encryption: doc.encryption,
      mime_type: doc.mime_type,
      file_size_bytes: doc.file_size_bytes,
    });
    await writeAuditLog(req, {
      actor_type: 'SUPER_ADMIN',
      actor_id: req.admin!.id,
      action: 'PRESCRIPTION_ACCESSED',
      entity_type: 'prescriptions',
      entity_id: doc._id,
    });
    res.set({
      'Content-Type': doc.mime_type,
      'Content-Length': String(plaintext.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    res.send(plaintext);
  });
  return router;
}
