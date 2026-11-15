import { createHmac, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { replySchema } from '../../shared/validators/rfq.validator.js';
import { ClarificationMessageModel, RfqModel } from './rfq.schema.js';
import { duplicateKey } from './rfq.intake.service.js';
import { rfqEvents } from './rfq.events.js';

export function verifyEmailWebhook(env: AppEnv): RequestHandler {
  return (req, _res, next) => {
    if (!env.WEBHOOK_HMAC_SECRET) return next(AppError.unavailable('Email webhook is not configured.'));
    const signature = req.get('x-webhook-signature')?.replace(/^sha256=/, '');
    if (!req.rawBody || !signature || !/^[a-f0-9]{64}$/i.test(signature))
      return next(AppError.forbidden('Webhook authentication failed.'));
    const expected = createHmac('sha256', env.WEBHOOK_HMAC_SECRET).update(req.rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      return next(AppError.forbidden('Webhook authentication failed.'));
    next();
  };
}
export async function recordEmailReply(req: Request, input: z.infer<typeof replySchema>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let repliedRfqId: string | undefined;
      const result = await mongoose.connection.transaction(async (session) => {
        const anchor = await ClarificationMessageModel.findOne({
          thread_id: input.thread_id,
          direction: 'ADMIN_TO_BUYER',
          channel: 'EMAIL',
        })
          .sort({ created_at: -1, _id: -1 })
          .session(session);
        if (!anchor) throw AppError.notFound();
        const rfq = await RfqModel.findOne({ _id: anchor.rfq_id, 'contact_snapshot.email': input.from_email }).session(
          session,
        );
        if (!rfq || anchor.customer_id !== rfq.customer_id)
          throw AppError.forbidden('Email sender does not match this thread.');
        const previous = await ClarificationMessageModel.findOne({ provider_event_id: input.provider_event_id })
          .session(session)
          .lean();
        if (previous) {
          if (previous.thread_id !== input.thread_id || previous.body !== input.body || previous.rfq_id !== rfq._id)
            throw AppError.conflict('Provider event ID conflicts with another reply.');
          return { received: true, replayed: true };
        }
        await new ClarificationMessageModel({
          rfq_id: rfq._id,
          customer_id: rfq.customer_id,
          thread_id: input.thread_id,
          direction: 'BUYER_TO_ADMIN',
          channel: 'EMAIL',
          body: input.body,
          status: 'REPLIED',
          provider_event_id: input.provider_event_id,
          reply_to_id: anchor._id,
        }).save({ session });
        await ClarificationMessageModel.updateOne({ _id: anchor._id }, { $set: { status: 'REPLIED' } }, { session });
        await RfqModel.updateOne(
          { _id: rfq._id, status: 'NEED_CLARIFICATION' },
          { $set: { status: 'UNDER_REVIEW' } },
          { session },
        );
        await writeAuditLog(
          req,
          {
            actor_type: 'BUYER',
            actor_id: rfq.customer_id,
            action: 'RFQ_EMAIL_REPLY_RECEIVED',
            entity_type: 'rfqs',
            entity_id: rfq._id,
          },
          session,
        );
        repliedRfqId = rfq._id;
        return { received: true, replayed: false };
      });
      if (!result.replayed && repliedRfqId)
        void Promise.resolve()
          .then(() =>
            rfqEvents.emit('CLARIFICATION_REPLY', {
              type: 'CLARIFICATION_REPLY',
              rfq_id: repliedRfqId,
              received_at: new Date().toISOString(),
            }),
          )
          .catch(() => undefined);
      return result;
    } catch (error) {
      if (duplicateKey(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw AppError.unavailable();
}
