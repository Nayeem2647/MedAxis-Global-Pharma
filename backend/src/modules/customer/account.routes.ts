import { Router, type RequestHandler, type Response } from 'express';
import mongoose, { type PipelineStage } from 'mongoose';
import { z } from 'zod';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/errors/AppError.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { turnstile } from '../../shared/middleware/turnstile.js';
import { hashPassword, verifyPassword } from '../../shared/utils/crypto.js';
import { sendSuccess, sendPaginated } from '../../shared/utils/response.js';
import { createRfqIntakeService } from '../rfq/rfq.intake.service.js';
import { negotiateBody, type createRfqWorkflow } from '../rfq/rfq.workflow.js';
import type { createDecisionService } from '../quotation/quotation.decisions.js';
import { acceptSchema, declineSchema } from '../../shared/validators/decision.validator.js';
import { createRfqSignals } from '../rfq/rfq.events.js';
import { createRfqDispatcher } from '../rfq/rfq.dispatch.js';
import { rfqIntakeSchema } from '../../shared/validators/rfq.validator.js';
import { RfqModel, RfqIdempotencyKeyModel, ClarificationMessageModel } from '../rfq/rfq.schema.js';
import { QuotationModel, QuotationVersionModel } from '../quotation/quotation.schema.js';
import { COMMERCIAL_PROJECTION, commercialQuotation } from '../quotation/quotation.dto.js';
import { isAccepted, queueAdminEmail } from '../quotation/quotation.lifecycle.js';
import { PlatformSettingModel } from '../settings/settings.schema.js';
import type { PdfDelivery } from '../pdf/pdf.worker.js';
import type { StorageService } from '../storage/storage.service.js';
import { CustomerModel } from './customer.schema.js';
import {
  CustomerAccountModel,
  CustomerSessionModel,
  CustomerDraftModel,
  CustomerEventModel,
} from './account.schema.js';
import {
  CUSTOMER_COOKIE,
  createCustomerAuthService,
  customerAuth,
  customerIdentity,
  customerCookieOptions,
  verifiedCustomer,
  type CustomerAuthHooks,
} from './account.auth.js';
import {
  accountRegistration,
  accountLogin,
  accountEmail,
  accountToken,
  accountReset,
  accountPassword,
  accountProfile,
  accountDraft,
  accountDraftUpdate,
  accountPage,
  accountRevision,
} from './account.validator.js';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};
const uuid = z.uuid();
const publicRfq = (rfq: {
  _id: string;
  rfq_number: string;
  status: string;
  inquiry_type: string;
  destination_country: string;
  preferred_currency: string;
  created_at: Date;
  updated_at: Date;
  items: {
    _id: string;
    product_snapshot?: { brand_name?: string; pack_size?: string };
    custom_medicine_name?: string;
    custom_strength?: string;
    quantity: number;
    packaging_unit: string;
    item_availability_status: string;
    customer_facing_note?: string;
    line_notes?: string;
  }[];
}) => ({
  id: rfq._id,
  rfq_number: rfq.rfq_number,
  status: rfq.status,
  inquiry_type: rfq.inquiry_type,
  destination_country: rfq.destination_country,
  preferred_currency: rfq.preferred_currency,
  created_at: rfq.created_at,
  updated_at: rfq.updated_at,
  items: rfq.items.map((line) => ({
    id: line._id,
    name: line.product_snapshot?.brand_name ?? line.custom_medicine_name ?? '',
    strength: line.custom_strength ?? '',
    quantity: line.quantity,
    packaging_unit: line.packaging_unit,
    availability_status: line.item_availability_status,
    customer_facing_note: line.customer_facing_note,
    notes: line.line_notes,
  })),
});
const pagination = (res: Response, items: unknown[], total: number, page: number, limit: number) =>
  sendPaginated(res, items, { page, limit, totalItems: total });
const quoteOwnership = (customerId: string): (PipelineStage.Match | PipelineStage.Lookup | PipelineStage.Unwind)[] => [
  { $match: { status: { $ne: 'DRAFT' }, issued_at: { $exists: true } } },
  {
    $lookup: {
      from: 'quotations',
      localField: 'quotation_id',
      foreignField: '_id',
      as: 'owner',
      pipeline: [
        { $match: { customer_id: customerId } },
        { $project: { quotation_number: 1, current_version_id: 1, rfq_id: 1 } },
      ],
    },
  },
  { $unwind: '$owner' },
];
export function createCustomerRouter(
  env: AppEnv,
  logger: AppLogger,
  pdf: PdfDelivery,
  storage: StorageService,
  { workflow, decisions }: {
    workflow: ReturnType<typeof createRfqWorkflow>;
    decisions: ReturnType<typeof createDecisionService>;
  },
  hooks: CustomerAuthHooks = {},
) {
  const router = Router();
  const auth = createCustomerAuthService(env, hooks);
  const guard = customerAuth(env);
  const intake = createRfqIntakeService(
    env,
    createRfqSignals(logger, {
      dispatchNotifications: hooks.dispatchNotifications ?? createRfqDispatcher(env, logger),
    }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.clientIp || req.ip || 'unknown'),
    handler: (_req, _res, next) => next(AppError.tooManyRequests(900)),
  });
  const writeLimit = rateLimit({
    windowMs: 10 * 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (_req, res) => customerIdentity(res).account._id,
    handler: (_req, _res, next) => next(AppError.tooManyRequests(600)),
  });
  router.use((_req, res, next) => {
    res.set(privateHeaders);
    next();
  });
  router.use(adminBoundary(env));
  router.use('/auth', (req, res, next) => (req.method === 'GET' ? next() : authLimit(req, res, next)));
  router.get('/auth/session', (req, res, next) => {
    if (!req.signedCookies?.[CUSTOMER_COOKIE]) {
      sendSuccess(res, { profile: null });
      return;
    }
    void guard(req, res, (error?: unknown) => {
      if (error instanceof AppError && error.status === 401) {
        res.clearCookie(CUSTOMER_COOKIE, { ...customerCookieOptions(env), signed: false });
        sendSuccess(res, { profile: null });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      void auth
        .profile(customerIdentity(res).account)
        .then((profile) => sendSuccess(res, { profile }))
        .catch(next);
    });
  });
  const registerBot: RequestHandler = env.CLOUDFLARE_TURNSTILE_SECRET
    ? turnstile(env)
    : (_req, _res, next) => next();
  router.post('/auth/register', registerBot, async (req, res) => {
    sendSuccess(res, await auth.register(accountRegistration.parse(req.body), res), { status: 201 });
  });
  router.post('/auth/login', async (req, res) => {
    const input = accountLogin.parse(req.body);
    sendSuccess(res, await auth.login(input.email, input.password, res));
  });
  router.post('/auth/verify-email', async (req, res) => {
    sendSuccess(res, await auth.verify(accountToken.parse(req.body).token));
  });
  router.post('/auth/forgot-password', async (req, res) => {
    const { email } = accountEmail.parse(req.body);
    const account = await CustomerAccountModel.findOne({ email, is_active: true }).lean();
    if (account) await auth.sendLink(account, 'reset');
    sendSuccess(res, { requested: true, email_delivery_available: auth.mailReady() });
  });
  router.post('/auth/reset-password', async (req, res) => {
    const input = accountReset.parse(req.body);
    sendSuccess(res, await auth.reset(input.token, input.password));
  });
  router.use(guard);
  router.post('/auth/logout', async (_req, res) => {
    await CustomerSessionModel.deleteOne({ _id: customerIdentity(res).sessionId });
    res.clearCookie(CUSTOMER_COOKIE, { ...customerCookieOptions(env), signed: false });
    sendSuccess(res, { logged_out: true });
  });
  router.post('/auth/resend-verification', async (_req, res) => {
    const { account } = customerIdentity(res);
    if (account.email_verified_at) {
      sendSuccess(res, { verification_sent: false, already_verified: true });
      return;
    }
    sendSuccess(res, { verification_sent: await auth.sendLink(account, 'verify'), already_verified: false });
  });
  router.post('/auth/change-password', async (req, res) => {
    const input = accountPassword.parse(req.body);
    const { account } = customerIdentity(res);
    const credentials = await CustomerAccountModel.findById(account._id).select('+password_hash').lean();
    if (!credentials || !(await verifyPassword(credentials.password_hash, input.current_password)))
      throw AppError.unauthorized('Current password was not confirmed.');
    const changed = await CustomerAccountModel.updateOne(
      { _id: account._id, session_generation: account.session_generation },
      {
        $set: { password_hash: await hashPassword(input.password) },
        $inc: { session_generation: 1 },
        $unset: { password_reset: 1 },
      },
    );
    if (!changed.matchedCount) throw AppError.conflict();
    await CustomerSessionModel.deleteMany({ account_id: account._id });
    res.clearCookie(CUSTOMER_COOKIE, { ...customerCookieOptions(env), signed: false });
    await auth.event(account._id, 'PASSWORD_CHANGED');
    sendSuccess(res, { changed: true });
  });
  router.get('/profile', async (req, res) => {
    z.strictObject({}).parse(req.query);
    sendSuccess(res, await auth.profile(customerIdentity(res).account));
  });
  router.patch('/profile', writeLimit, async (req, res) => {
    const input = accountProfile.parse(req.body);
    const { account } = customerIdentity(res);
    await mongoose.connection.transaction(async (session) => {
      await CustomerAccountModel.updateOne({ _id: account._id }, { $set: input }, { session, runValidators: true });
      if (account.email_verified_at && account.customer_id)
        await CustomerModel.updateOne({ _id: account.customer_id }, { $set: input }, { session, runValidators: true });
      await new CustomerEventModel({ account_id: account._id, kind: 'PROFILE_UPDATED' }).save({ session });
    });
    const updated = await CustomerAccountModel.findById(account._id).lean();
    if (!updated) throw AppError.unauthorized();
    sendSuccess(res, await auth.profile(updated));
  });
  router.get('/overview', async (_req, res) => {
    const { account } = customerIdentity(res);
    const [drafts, rfqs, quotes, units] = await Promise.all([
      CustomerDraftModel.countDocuments({ account_id: account._id, status: { $ne: 'SUBMITTED' } }),
      account.email_verified_at && account.customer_id
        ? RfqModel.countDocuments({ customer_id: account.customer_id })
        : 0,
      account.email_verified_at && account.customer_id
        ? QuotationVersionModel.aggregate([...quoteOwnership(account.customer_id), { $count: 'total' }])
        : [],
      PlatformSettingModel.findOne({ key: 'packaging_units' }).select({ value: 1 }).lean(),
    ]);
    const configured = units?.value as { units?: unknown } | undefined;
    const packagingUnits = Array.isArray(configured?.units)
      ? configured.units
          .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 40)
          .slice(0, 100)
      : [];
    sendSuccess(res, { drafts, rfqs, quotations: quotes[0]?.total ?? 0, packaging_units: packagingUnits });
  });
  router.get('/drafts', async (req, res) => {
    const { page, limit } = accountPage.parse(req.query);
    const filter = { account_id: customerIdentity(res).account._id };
    const [items, total] = await Promise.all([
      CustomerDraftModel.find(filter)
        .sort({ created_at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CustomerDraftModel.countDocuments(filter),
    ]);
    pagination(
      res,
      items.map(({ _id, account_id: _owner, ...item }) => ({ id: _id, ...item })),
      total,
      page,
      limit,
    );
  });
  router.post('/drafts', writeLimit, async (req, res) => {
    const input = accountDraft.parse(req.body);
    const accountId = customerIdentity(res).account._id;
    const draft = await CustomerDraftModel.create({ ...input, account_id: accountId });
    await auth.event(accountId, 'DRAFT_CREATED', draft._id);
    sendSuccess(res, { id: draft._id }, { status: 201 });
  });
  router.patch('/drafts/:id', writeLimit, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { revision, ...input } = accountDraftUpdate.parse(req.body);
    const accountId = customerIdentity(res).account._id;
    const draft = await CustomerDraftModel.findOneAndUpdate(
      { _id: id, account_id: accountId, status: 'DRAFT', revision },
      { $set: input, $inc: { revision: 1 } },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!draft) throw AppError.conflict('This draft changed or is no longer editable. Refresh and try again.');
    await auth.event(accountId, 'DRAFT_UPDATED', id);
    sendSuccess(res, { saved: true, revision: draft.revision });
  });
  router.delete('/drafts/:id', writeLimit, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const accountId = customerIdentity(res).account._id;
    const result = await CustomerDraftModel.deleteOne({ _id: id, account_id: accountId, status: 'DRAFT' });
    if (!result.deletedCount) throw AppError.notFound();
    await auth.event(accountId, 'DRAFT_DELETED', id);
    sendSuccess(res, { deleted: true });
  });
  router.post('/drafts/:id/submit', writeLimit, async (req, res) => {
    verifiedCustomer(res);
    z.strictObject({}).parse(req.body);
    const id = uuid.parse(req.params.id);
    const { account } = customerIdentity(res);
    const draft = await CustomerDraftModel.findOneAndUpdate(
      { _id: id, account_id: account._id, status: { $in: ['DRAFT', 'SUBMITTING', 'SUBMITTED'] } },
      { $set: { status: 'SUBMITTING' } },
      { returnDocument: 'after' },
    ).lean();
    if (!draft) throw AppError.notFound();
    if (draft.rfq_id) {
      await CustomerDraftModel.updateOne({ _id: id }, { $set: { status: 'SUBMITTED' } });
      sendSuccess(res, { rfq_id: draft.rfq_id, rfq_number: draft.rfq_number, replayed: true });
      return;
    }
    try {
      // Intake may have committed before saving the draft receipt. Recover it before
      // rebuilding the request, because the customer may since have edited their profile.
      const receipt = await RfqIdempotencyKeyModel.findOne({ key: id }).lean();
      if (receipt) {
        const submitted = await RfqModel.findOne({ _id: receipt.rfq_id, customer_id: account.customer_id })
          .select({ _id: 1, rfq_number: 1 })
          .lean();
        if (!submitted) throw AppError.conflict();
        await CustomerDraftModel.updateOne(
          { _id: id, account_id: account._id },
          { $set: { status: 'SUBMITTED', rfq_id: submitted._id, rfq_number: submitted.rfq_number } },
        );
        sendSuccess(res, { rfq_id: submitted._id, rfq_number: submitted.rfq_number, replayed: true });
        return;
      }
      const profile = await auth.profile(account);
      const input = rfqIntakeSchema.parse({
        idempotency_key: id,
        contact: {
          full_name: profile.full_name,
          customer_type: profile.customer_type,
          company_name: profile.company_name || undefined,
          email: account.email,
          whatsapp_number: profile.whatsapp_number || undefined,
          wechat_id: profile.wechat_id || undefined,
          preferred_locale: profile.preferred_locale,
        },
        destination_country: draft.destination_country,
        preferred_currency: draft.preferred_currency,
        locale: profile.preferred_locale,
        items: draft.items.map((item) => ({
          product_id: item.product_id,
          is_uncatalogued: !item.product_id,
          custom_medicine_name: item.product_id ? undefined : item.name,
          custom_strength: item.product_id ? undefined : item.strength,
          quantity: item.quantity,
          packaging_unit: item.packaging_unit,
          line_notes: item.notes,
        })),
        prescription_ids: [],
      });
      const result = await intake(req, input, 'CART_RFQ');
      await CustomerDraftModel.updateOne(
        { _id: id, account_id: account._id },
        { $set: { status: 'SUBMITTED', rfq_id: result.snapshot.rfq_id, rfq_number: result.snapshot.rfq_number } },
      );
      if (!result.replayed) await auth.event(account._id, 'RFQ_SUBMITTED', String(result.snapshot.rfq_id));
      sendSuccess(res, { ...result.snapshot, replayed: result.replayed });
    } catch (error) {
      if (error instanceof z.ZodError || (error instanceof AppError && error.status >= 400 && error.status < 500))
        await CustomerDraftModel.updateOne(
          { _id: id, account_id: account._id, rfq_id: { $exists: false } },
          { $set: { status: 'DRAFT' } },
        );
      throw error;
    }
  });
  router.get('/rfqs', async (req, res) => {
    const customerId = verifiedCustomer(res);
    const { page, limit } = accountPage.parse(req.query);
    const [items, total] = await Promise.all([
      RfqModel.find({ customer_id: customerId })
        .sort({ created_at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      RfqModel.countDocuments({ customer_id: customerId }),
    ]);
    pagination(res, items.map(publicRfq), total, page, limit);
  });
  router.get('/rfqs/:id', async (req, res) => {
    const rfq = await RfqModel.findOne({ _id: uuid.parse(req.params.id), customer_id: verifiedCustomer(res) }).lean();
    if (!rfq) throw AppError.notFound();
    sendSuccess(res, publicRfq(rfq));
  });
  const ownedRequest = (id: unknown, res: Response) => ({ rfqId: uuid.parse(id), customerId: verifiedCustomer(res) });
  router.get('/rfqs/:id/workflow', async (req, res) => {
    sendSuccess(res, await workflow.buyerView(ownedRequest(req.params.id, res)));
  });
  router.post('/rfqs/:id/workflow/negotiate', writeLimit, async (req, res) => {
    sendSuccess(res, await workflow.negotiate(req, ownedRequest(req.params.id, res), negotiateBody.parse(req.body)));
  });
  router.post('/rfqs/:id/workflow/accept', writeLimit, async (req, res) => {
    sendSuccess(res, await decisions.accept(req, ownedRequest(req.params.id, res), acceptSchema.parse(req.body)));
  });
  router.post('/rfqs/:id/workflow/decline', writeLimit, async (req, res) => {
    sendSuccess(res, await decisions.decline(req, ownedRequest(req.params.id, res), declineSchema.parse(req.body)));
  });
  router.get('/quotations', async (req, res) => {
    const customerId = verifiedCustomer(res);
    const { page, limit } = accountPage.parse(req.query);
    const [result] = await QuotationVersionModel.aggregate([
      ...quoteOwnership(customerId),
      { $sort: { issued_at: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: '$_id',
                quotation_id: 1,
                quotation_number: '$owner.quotation_number',
                version_number: 1,
                status: 1,
                billing_currency: 1,
                total_amount: { $toString: '$total_amount' },
                issued_at: 1,
                valid_until: 1,
                is_current: { $eq: ['$_id', '$owner.current_version_id'] },
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]);
    pagination(res, result?.items ?? [], result?.total[0]?.count ?? 0, page, limit);
  });
  async function ownedVersion(id: string, res: Response) {
    const customerId = verifiedCustomer(res);
    const version = await QuotationVersionModel.findOne({
      _id: uuid.parse(id),
      status: { $ne: 'DRAFT' },
      issued_at: { $exists: true },
    })
      .select(`${COMMERCIAL_PROJECTION} pdf revision_request`)
      .lean();
    if (!version) throw AppError.notFound();
    const quote = await QuotationModel.findOne({ _id: version.quotation_id, customer_id: customerId }).lean();
    if (!quote) throw AppError.notFound();
    return { version, quote };
  }
  router.get('/quotations/:id', async (req, res) => {
    const { version, quote } = await ownedVersion(String(req.params.id), res);
    sendSuccess(res, {
      ...commercialQuotation(version),
      quotation_number: quote.quotation_number,
      rfq_id: quote.rfq_id,
      workflow_enabled: version.workflow_enabled === true,
      is_current: quote.current_version_id === version._id,
      availability: {
        available: version.items.filter((item) => item.availability_status === 'AVAILABLE').length,
        unavailable: version.items.filter((item) => item.availability_status === 'UNAVAILABLE').length,
        sourcing: version.items.filter((item) => item.availability_status === 'SOURCING').length,
      },
    });
  });
  router.get('/quotations/:id/pdf', async (req, res) => {
    const { version, quote } = await ownedVersion(String(req.params.id), res);
    let bytes: Buffer;
    if (quote.current_version_id === version._id && (version.status === 'SENT' || isAccepted(version.status)))
      bytes = (await pdf.get(version._id)).bytes;
    else {
      const artifact = isAccepted(version.status) ? version.pdf?.accepted : version.pdf?.original;
      const key =
        artifact &&
        typeof artifact === 'object' &&
        ('object_key' in artifact
          ? artifact.object_key
          : 'r2_object_key' in artifact
            ? artifact.r2_object_key
            : undefined);
      if (typeof key !== 'string') throw AppError.conflict('A PDF has not been generated for this historical version.');
      bytes = await storage.download('quotes', key);
    }
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw AppError.unavailable();
    await ownedVersion(String(req.params.id), res);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quotation-v${version.version_number}.pdf"`,
      'X-Content-Type-Options': 'nosniff',
      ...privateHeaders,
    });
    res.send(bytes);
  });
  router.post('/quotations/:id/revisions', writeLimit, async (req, res) => {
    const input = accountRevision.extend({ request_id: uuid }).parse(req.body);
    const { account } = customerIdentity(res);
    const { version, quote } = await ownedVersion(String(req.params.id), res);
    if (version.workflow_enabled) {
      const intent = negotiateBody.parse({ expected_version_id: version._id, operation_id: input.request_id, scope: 'BOTH', body: input.notes });
      sendSuccess(res, await workflow.negotiate(req, { rfqId: quote.rfq_id, customerId: quote.customer_id }, intent));
      return;
    }
    const result = await mongoose.connection.transaction(async (session) => {
      const previous = await ClarificationMessageModel.findOne({ _id: input.request_id }).session(session).lean();
      if (previous) {
        if (
          previous.customer_id !== quote.customer_id ||
          previous.thread_id !== quote._id ||
          previous.body !== input.notes
        )
          throw AppError.conflict();
        return { message_id: previous._id, replayed: true };
      }
      const current = await QuotationModel.exists({
        _id: quote._id,
        customer_id: quote.customer_id,
        current_version_id: version._id,
        overall_status: 'ACTIVE',
      }).session(session);
      if (!current) throw AppError.conflict('Revision requests require the current sent quotation.');
      const touched = await QuotationVersionModel.updateOne(
        { _id: version._id, status: 'SENT', valid_until: { $gt: new Date() } },
        { $set: { revision_request: { requested_at: new Date(), message_id: input.request_id } } },
        { session },
      );
      if (!touched.matchedCount) throw AppError.conflict('This quotation is no longer open for revision requests.');
      await new ClarificationMessageModel({
        _id: input.request_id,
        customer_id: quote.customer_id,
        rfq_id: quote.rfq_id,
        thread_id: quote._id,
        direction: 'BUYER_TO_ADMIN',
        channel: 'EMAIL',
        body: input.notes,
        status: 'REPLIED',
      }).save({ session });
      await new CustomerEventModel({
        account_id: account._id,
        kind: 'REVISION_REQUESTED',
        reference_id: input.request_id,
      }).save({ session });
      await queueAdminEmail(env, session, version._id, 'revision-request', `revision-request:${input.request_id}`);
      return { message_id: input.request_id, replayed: false };
    });
    sendSuccess(res, result);
  });
  router.get('/revisions', async (req, res) => {
    const customerId = verifiedCustomer(res);
    const { page, limit } = accountPage.parse(req.query);
    const ownership: PipelineStage[] = [
      { $match: { customer_id: customerId, direction: 'BUYER_TO_ADMIN' } },
      {
        $lookup: {
          from: 'quotations',
          localField: 'thread_id',
          foreignField: '_id',
          as: 'quote',
          pipeline: [{ $match: { customer_id: customerId } }, { $project: { quotation_number: 1 } }],
        },
      },
      { $unwind: '$quote' },
    ];
    const [result] = await ClarificationMessageModel.aggregate([
      ...ownership,
      { $sort: { created_at: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: '$_id',
                body: 1,
                status: 1,
                created_at: 1,
                quotation_number: '$quote.quotation_number',
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]);
    pagination(res, result?.items ?? [], result?.total[0]?.count ?? 0, page, limit);
  });
  router.get('/history', async (req, res) => {
    const { account } = customerIdentity(res);
    const { page, limit } = accountPage.parse(req.query);
    const pipeline: PipelineStage[] = [
      { $match: { account_id: account._id } },
      { $project: { _id: 0, id: '$_id', kind: 1, reference_id: 1, created_at: 1 } },
    ];
    if (account.email_verified_at && account.customer_id)
      pipeline.push(
        {
          $unionWith: {
            coll: 'rfqs',
            pipeline: [
              { $match: { customer_id: account.customer_id } },
              {
                $project: {
                  _id: 0,
                  id: '$_id',
                  reference_id: '$_id',
                  kind: { $literal: 'RFQ_STATUS' },
                  status: 1,
                  label: '$rfq_number',
                  created_at: '$updated_at',
                },
              },
            ],
          },
        },
        {
          $unionWith: {
            coll: 'quotation_versions',
            pipeline: [
              ...quoteOwnership(account.customer_id),
              {
                $project: {
                  _id: 0,
                  id: '$_id',
                  reference_id: '$_id',
                  kind: { $literal: 'QUOTATION_STATUS' },
                  status: 1,
                  label: '$owner.quotation_number',
                  created_at: '$updated_at',
                },
              },
            ],
          },
        },
      );
    const [result] = await CustomerEventModel.aggregate([
      ...pipeline,
      { $sort: { created_at: -1, id: -1 } },
      { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'count' }] } },
    ]);
    pagination(res, result?.items ?? [], result?.total[0]?.count ?? 0, page, limit);
  });
  return router;
}
