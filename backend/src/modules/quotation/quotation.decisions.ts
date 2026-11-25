import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import mongoose, { type ClientSession } from 'mongoose';
import { ZodError, type z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { hashToken } from '../../shared/utils/crypto.js';
import { addCalendarDays } from '../../shared/utils/calendar.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import {
  acceptSchema,
  type declineSchema,
  type refreshRequestSchema,
  type revisionRequestSchema,
} from '../../shared/validators/decision.validator.js';
import { RfqModel, ClarificationMessageModel } from '../rfq/rfq.schema.js';
import { resolveBuyerRfq, type BuyerRfqAccess } from '../rfq/rfq.guest-access.js';
import { NotificationLogModel } from '../notification/notification.schema.js';
import { commercialQuotation, COMMERCIAL_PROJECTION } from './quotation.dto.js';
import { QuotationModel, QuotationVersionModel, type IQuotationVersion } from './quotation.schema.js';
import { quotationEvents } from './quotation.service.js';
import {
  isAccepted,
  isExpired,
  queueAdminEmail,
  queueLifecycleEmail,
  scheduleMedicalPurge,
  tokenExpired,
  versionConflict,
} from './quotation.lifecycle.js';

export interface DecisionHooks {
  dispatchNotifications?: () => void | Promise<void>;
  dispatchPdf?: () => void | Promise<void>;
}
export function createDecisionService(env: AppEnv, logger: AppLogger, hooks: DecisionHooks = {}) {
  const failures = new Map<string, { count: number; at: number }>();
  const later = (work: () => unknown) => {
    void Promise.resolve()
      .then(work)
      .catch(() => logger.warn('Quotation post-commit hook failed'));
  };
  function notify() {
    later(() => hooks.dispatchNotifications?.());
  }
  async function resolve(access: BuyerRfqAccess, session?: ClientSession) {
    const tokenAccess = typeof access === 'string';
    if (tokenAccess && !/^[a-f0-9]{64}$/.test(access)) throw AppError.notFound();
    let hash = tokenAccess ? hashToken(access) : undefined;
    let version = tokenAccess ? await QuotationVersionModel.findOne({ magic_link_token_hash: hash })
      .select(`${COMMERCIAL_PROJECTION} +magic_link_token_hash`)
      .session(session ?? null)
      .lean() : null;
    const versionRequired = !version;
    if (!version) {
      const rfq = await resolveBuyerRfq(access, session);
      const parent = await QuotationModel.findOne({ rfq_id: rfq._id, customer_id: rfq.customer_id }).sort({ created_at: -1, _id: -1 }).session(session ?? null).lean();
      version = parent ? await QuotationVersionModel.findById(parent.current_version_id).select(`${COMMERCIAL_PROJECTION} +magic_link_token_hash`).session(session ?? null).lean() : null;
      if (version && version.quotation_id !== parent?._id) throw AppError.notFound();
      if (tokenAccess && version) {
        if (!version.magic_link_token_hash) throw AppError.notFound();
        hash = version.magic_link_token_hash;
      }
    }
    if (!version || version.status === 'DRAFT') throw AppError.notFound();
    const quote = await QuotationModel.findById(version.quotation_id)
      .session(session ?? null)
      .lean();
    if (!quote) throw AppError.notFound();
    if (quote.current_version_id !== version._id || version.status === 'SUPERSEDED') throw versionConflict();
    return { version, quote, tokenFilter: hash ? { magic_link_token_hash: hash } : {}, versionRequired };
  }
  function usable(version: IQuotationVersion) {
    if (isExpired(version)) throw tokenExpired();
  }
  function view(version: IQuotationVersion) {
    return {
      ...commercialQuotation(version),
      availability: {
        available: version.items.filter((line) => line.availability_status === 'AVAILABLE').length,
        unavailable: version.items.filter((line) => line.availability_status === 'UNAVAILABLE').length,
        sourcing: version.items.filter((line) => line.availability_status === 'SOURCING').length,
      },
      validity_remaining_seconds: Math.max(0, Math.floor(((version.valid_until?.getTime() ?? 0) - Date.now()) / 1000)),
      reservation_remaining_seconds:
        version.reservation_status === 'ACTIVE'
          ? Math.max(0, Math.floor(((version.reservation_expires_at?.getTime() ?? 0) - Date.now()) / 1000))
          : 0,
    };
  }
  async function get(token: string) {
    const current = await resolve(token);
    usable(current.version);
    return view(current.version);
  }
  async function buyerAudit(
    req: Request,
    version: IQuotationVersion,
    customerId: string,
    action: string,
    session: ClientSession,
    oldStatus?: string,
    newStatus?: string,
  ) {
    await writeAuditLog(
      req,
      {
        actor_type: 'BUYER',
        actor_id: customerId,
        action,
        entity_type: 'quotation_versions',
        entity_id: version._id,
        old_status: oldStatus,
        new_status: newStatus,
      },
      session,
    );
  }
  async function acceptanceFailure(req: Request, hash: string, versionId?: string) {
    const safe = {
      request_id: req.requestId,
      error_code: 'ACCEPTANCE_TRANSACTION_FAILED',
      ...(versionId ? { version_id: versionId } : {}),
    };
    // No driver error, token/hash, request URL, email or medical text reaches either sink.
    process.stderr.write(
      `${JSON.stringify({ level: 'error', message: 'Quotation acceptance transaction failed', ...safe })}\n`,
    );
    logger.error('Quotation acceptance transaction failed', safe);
    try {
      await writeAuditLog(req, {
        actor_type: 'SYSTEM',
        action: 'QUOTATION_ACCEPTANCE_FAILED',
        entity_type: versionId ? 'quotation_versions' : 'requests',
        entity_id: versionId ?? req.requestId,
        metadata: { error_code: safe.error_code },
      });
    } catch {
      logger.error('Unable to persist quotation acceptance failure audit', { request_id: req.requestId });
    }
    const previous = failures.get(hash);
    const count = previous && Date.now() - previous.at < 3_600_000 ? previous.count + 1 : 1;
    if (failures.size >= 1000) failures.delete(failures.keys().next().value!);
    failures.set(hash, { count, at: Date.now() });
    if (count === 3 && versionId) {
      try {
        await mongoose.connection.transaction((session) =>
          queueAdminEmail(
            env,
            session,
            versionId,
            'acceptance-failure-alert',
            `accept-failure:${versionId}:${Math.floor(Date.now() / 3_600_000)}`,
          ),
        );
        notify();
      } catch {
        logger.error('Unable to queue acceptance failure alert', { request_id: req.requestId });
      }
    }
  }
  async function accept(req: Request, access: BuyerRfqAccess, input: unknown) {
    const failureKey = hashToken(typeof access === 'string' ? access : `account:${access.customerId}:${access.rfqId}`);
    let knownId: string | undefined;
    let result: { version: IQuotationVersion; changed: boolean; quotation_id: string; rfq_id: string };
    try {
      result = await mongoose.connection.transaction(
        async (session) => {
          const { version, quote, tokenFilter, versionRequired } = await resolve(access, session);
          knownId = version._id;
          const intent = acceptSchema.parse(input);
          if ((versionRequired || intent.expected_version_id) && intent.expected_version_id !== version._id) throw versionConflict();
          const rfqState = await RfqModel.findById(quote.rfq_id).session(session).lean();
          if (rfqState?.workflow?.pending_request_id) throw AppError.conflict('Wait for the response to your change request before approving.');
          if (isAccepted(version.status))
            return { version, changed: false, quotation_id: quote._id, rfq_id: quote.rfq_id };
          usable(version);
          if (version.status !== 'SENT' || quote.overall_status !== 'ACTIVE')
            throw AppError.conflict('This quotation cannot be accepted in its current state.');
          const now = new Date();
          const changed = await QuotationVersionModel.findOneAndUpdate(
            {
              _id: version._id,
              quotation_id: quote._id,
              ...tokenFilter,
              status: 'SENT',
              valid_until: { $gt: now },
            },
            {
              $set: {
                status: 'ACCEPTED',
                accepted_at: now,
                acceptance_evidence: {
                  accepted_at: now,
                  client_ip: req.clientIp ?? req.ip ?? 'unknown',
                  user_agent: (req.get('user-agent') || 'Unknown').slice(0, 2000),
                  terms_accepted: true,
                },
                reservation_status: 'ACTIVE',
                reservation_expires_at: addCalendarDays(now, 5),
              },
            },
            { session, returnDocument: 'after' },
          )
            .select(COMMERCIAL_PROJECTION)
            .lean();
          if (!changed) {
            const state = await QuotationVersionModel.findOne({ _id: version._id, ...tokenFilter })
              .select(COMMERCIAL_PROJECTION)
              .session(session)
              .lean();
            if (!state) throw AppError.notFound();
            if (isAccepted(state.status))
              return { version: state, changed: false, quotation_id: quote._id, rfq_id: quote.rfq_id };
            if (isExpired(state)) throw tokenExpired();
            if (state.status === 'SUPERSEDED') throw versionConflict();
            throw AppError.conflict();
          }
          const parent = await QuotationModel.updateOne(
            { _id: quote._id, current_version_id: version._id, overall_status: 'ACTIVE' },
            { $set: { updated_at: now } },
            { session },
          );
          if (parent.matchedCount !== 1) throw versionConflict();
          const rfq = await RfqModel.updateOne(
            { _id: quote.rfq_id, status: 'QUOTED' },
            { $set: { status: 'CONVERTED' } },
            { session },
          );
          if (rfq.matchedCount !== 1) throw AppError.conflict('The inquiry cannot be converted in its current state.');
          await buyerAudit(req, changed, quote.customer_id, 'QUOTATION_ACCEPTED', session, 'SENT', 'ACCEPTED');
          await queueLifecycleEmail(
            session,
            version._id,
            'accepted',
            version.contact_snapshot.email,
            `accepted:${version._id}`,
          );
          await queueAdminEmail(env, session, version._id, 'admin-accepted-alert', `admin-accepted:${version._id}`);
          // Durable before commit; the asynchronous render is kicked only after a successful commit.
          await NotificationLogModel.updateOne(
            { dedupe_key: `quotation-pdf:${version._id}:ACCEPTED_QUOTE` },
            {
              $setOnInsert: {
                entity_type: 'quotation_versions',
                entity_id: version._id,
                kind: 'PDF_RENDER',
                safe_payload: { version_id: version._id, mode: 'ACCEPTED_QUOTE' },
                status: 'PENDING',
                next_retry_at: now,
              },
            },
            { upsert: true, runValidators: true, session },
          );
          return { version: changed, changed: true, quotation_id: quote._id, rfq_id: quote.rfq_id };
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      if (error instanceof AppError || error instanceof ZodError) throw error;
      await acceptanceFailure(req, failureKey, knownId);
      throw new AppError({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: "We couldn't confirm your acceptance. Please try again.",
      });
    }
    failures.delete(failureKey);
    if (result.changed) {
      later(() =>
        quotationEvents.emit('QUOTATION_ACCEPTED', {
          type: 'QUOTATION_ACCEPTED',
          quotation_id: result.quotation_id,
          version_id: result.version._id,
          rfq_id: result.rfq_id,
          accepted_at: result.version.accepted_at!.toISOString(),
        }),
      );
      later(() => hooks.dispatchPdf?.());
      notify();
    }
    return { ...view(result.version), already_accepted: !result.changed };
  }
  async function requestRevision(req: Request, token: string, input: z.infer<typeof revisionRequestSchema>) {
    const messageId = randomUUID();
    const result = await mongoose.connection.transaction(async (session) => {
      const { version, quote } = await resolve(token, session);
      usable(version);
      if (version.status !== 'SENT' || quote.overall_status !== 'ACTIVE')
        throw AppError.conflict('Revision requests require a current SENT quotation.');
      const touched = await QuotationVersionModel.updateOne(
        { _id: version._id, status: 'SENT' },
        { $set: { revision_request: { requested_at: new Date(), message_id: messageId } } },
        { session },
      );
      if (!touched.matchedCount) throw AppError.conflict();
      await new ClarificationMessageModel({
        _id: messageId,
        rfq_id: quote.rfq_id,
        customer_id: quote.customer_id,
        thread_id: quote._id,
        direction: 'BUYER_TO_ADMIN',
        channel: 'EMAIL',
        body: input.notes,
        status: 'REPLIED',
      }).save({ session });
      await buyerAudit(req, version, quote.customer_id, 'QUOTATION_REVISION_REQUESTED', session);
      await queueAdminEmail(env, session, version._id, 'revision-request', `revision-request:${messageId}`);
      return { message_id: messageId };
    });
    notify();
    return result;
  }
  async function requestRefresh(req: Request, token: string, input: z.infer<typeof refreshRequestSchema>) {
    const messageId = randomUUID();
    const result = await mongoose.connection.transaction(async (session) => {
      const { version, quote } = await resolve(token, session);
      if (!isExpired(version)) throw AppError.conflict('Only an expired quotation can be refreshed.');
      if (version.status === 'SENT') {
        const changed = await QuotationVersionModel.updateOne(
          { _id: version._id, status: 'SENT', valid_until: { $lte: new Date() } },
          { $set: { status: 'VALIDITY_EXPIRED' } },
          { session },
        );
        if (changed.matchedCount !== 1) throw AppError.conflict();
        await QuotationModel.updateOne(
          { _id: quote._id, current_version_id: version._id, overall_status: 'ACTIVE' },
          { $set: { overall_status: 'EXPIRED' } },
          { session },
        );
      }
      await new ClarificationMessageModel({
        _id: messageId,
        rfq_id: quote.rfq_id,
        customer_id: quote.customer_id,
        thread_id: quote._id,
        direction: 'BUYER_TO_ADMIN',
        channel: 'EMAIL',
        body: input.notes ?? 'Customer requested an updated quotation.',
        status: 'REPLIED',
      }).save({ session });
      await buyerAudit(req, version, quote.customer_id, 'QUOTATION_REFRESH_REQUESTED', session);
      await queueAdminEmail(env, session, version._id, 'refresh-request', `refresh-request:${version._id}`);
      return { requested: true };
    });
    notify();
    return result;
  }
  async function decline(req: Request, access: BuyerRfqAccess, input: z.infer<typeof declineSchema>) {
    const result = await mongoose.connection.transaction(async (session) => {
      const { version, quote, tokenFilter, versionRequired } = await resolve(access, session);
      if ((versionRequired || input.expected_version_id) && input.expected_version_id !== version._id) throw versionConflict();
      if (versionRequired && version.status === 'DECLINED') return { version, changed: false };
      usable(version);
      if (version.status !== 'SENT' || quote.overall_status !== 'ACTIVE')
        throw AppError.conflict('Only a current SENT quotation can be declined.');
      const now = new Date();
      const updated = await QuotationVersionModel.findOneAndUpdate(
        { _id: version._id, status: 'SENT', ...tokenFilter, valid_until: { $gt: now } },
        {
          $set: {
            status: 'DECLINED',
            decline_reason: input.reason,
            decline_notes: input.notes,
            reservation_status: 'RELEASED',
          },
        },
        { session, returnDocument: 'after' },
      )
        .select(COMMERCIAL_PROJECTION)
        .lean();
      if (!updated) throw AppError.conflict();
      const parent = await QuotationModel.updateOne(
        { _id: quote._id, current_version_id: version._id, overall_status: 'ACTIVE' },
        { $set: { overall_status: 'DECLINED' } },
        { session },
      );
      if (parent.matchedCount !== 1) throw versionConflict();
      const rfq = await RfqModel.updateOne(
        { _id: quote.rfq_id, status: 'QUOTED' },
        { $set: { status: 'CLOSED', close_reason: 'BUYER_DECLINED', closed_at: now, terminal_at: now } },
        { session },
      );
      if (!rfq.matchedCount) throw AppError.conflict();
      await scheduleMedicalPurge(quote.rfq_id, now, session);
      await buyerAudit(req, version, quote.customer_id, 'QUOTATION_DECLINED', session, 'SENT', 'DECLINED');
      await queueAdminEmail(env, session, version._id, 'quotation-declined', `declined:${version._id}`);
      return { version: updated, changed: true };
    });
    if (result.changed) {
      later(() => quotationEvents.emit('QUOTATION_CHANGED', { quotation_id: result.version.quotation_id }));
      notify();
    }
    return view(result.version);
  }
  return { resolve, usable, get, accept, requestRevision, requestRefresh, decline };
}
