import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { cleanHtml, escapeRegex } from '../../shared/utils/content.js';
import {
  availabilitySchema,
  closeSchema,
  messageSchema,
  noteSchema,
  rfqListSchema,
  statusSchema,
} from '../../shared/validators/rfq.validator.js';
import { PrescriptionModel } from '../storage/storage.schema.js';
import { QuotationModel } from '../quotation/quotation.schema.js';
import { RfqModel, ClarificationMessageModel, type IRfq } from './rfq.schema.js';
import type { RfqSignals } from './rfq.events.js';
import { enqueueRfqEmail } from './rfq.outbox.js';
import { DAY_MS } from './rfq.intake.service.js';

const editable = ['SUBMITTED', 'UNDER_REVIEW', 'NEED_CLARIFICATION'] as const;
export const manualTransitions: Record<IRfq['status'], readonly IRfq['status'][]> = {
  SUBMITTED: ['UNDER_REVIEW', 'CLOSED', 'CANCELLED'],
  UNDER_REVIEW: ['CLOSED', 'CANCELLED'],
  NEED_CLARIFICATION: ['UNDER_REVIEW', 'CLOSED', 'CANCELLED'],
  QUOTED: ['CANCELLED'],
  CONVERTED: [],
  CLOSED: [],
  CANCELLED: [],
};
async function requiredRfq(id: string, session: ClientSession) {
  const rfq = await RfqModel.findById(id).session(session);
  if (!rfq) throw AppError.notFound();
  return rfq;
}
async function retention(rfqId: string, now: Date, session: ClientSession) {
  const rows = await PrescriptionModel.find({ rfq_id: rfqId, purge_status: { $in: ['ACTIVE', 'PENDING'] } })
    .session(session)
    .lean();
  for (const row of rows)
    await PrescriptionModel.updateOne(
      { _id: row._id },
      {
        $min: {
          purge_scheduled_at: new Date(Math.min(row.uploaded_at.getTime() + 90 * DAY_MS, now.getTime() + 14 * DAY_MS)),
        },
      },
      { session },
    );
}
export function createRfqAdminService(signals: RfqSignals) {
  async function list(query: z.infer<typeof rfqListSchema>) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.buyer_type) filter['contact_snapshot.customer_type'] = query.buyer_type;
    if (query.q)
      filter.$or = ['rfq_number', 'contact_snapshot.full_name', 'contact_snapshot.email'].map((field) => ({
        [field]: { $regex: escapeRegex(query.q!), $options: 'i' },
      }));
    if (query.date_from || query.date_to)
      filter.created_at = {
        ...(query.date_from ? { $gte: query.date_from } : {}),
        ...(query.date_to ? { $lte: query.date_to } : {}),
      };
    const [rows, total] = await Promise.all([
      RfqModel.find(filter)
        .select({
          rfq_number: 1,
          inquiry_type: 1,
          contact_snapshot: 1,
          destination_country: 1,
          status: 1,
          has_prescription: 1,
          created_at: 1,
          updated_at: 1,
        })
        .sort({ created_at: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .maxTimeMS(10_000)
        .lean(),
      RfqModel.countDocuments(filter).maxTimeMS(10_000),
    ]);
    return { rows, total };
  }
  async function detail(id: string) {
    const rfq = await RfqModel.findById(id).select('+items.internal_note').lean();
    if (!rfq) throw AppError.notFound();
    const [prescriptions, clarification_messages, quotations] = await Promise.all([
      PrescriptionModel.find({ rfq_id: id })
        .select({ _id: 1, mime_type: 1, file_size_bytes: 1, uploaded_at: 1, purge_scheduled_at: 1, purge_status: 1 })
        .sort({ uploaded_at: 1 })
        .lean(),
      ClarificationMessageModel.find({ rfq_id: id }).sort({ created_at: 1, _id: 1 }).lean(),
      QuotationModel.find({ rfq_id: id })
        .select({
          _id: 1,
          quotation_number: 1,
          current_version: 1,
          current_version_id: 1,
          overall_status: 1,
          created_at: 1,
        })
        .lean(),
    ]);
    return { ...rfq, prescriptions, clarification_messages, quotations };
  }
  async function item(req: Request, id: string, itemId: string, input: z.infer<typeof availabilitySchema>) {
    return mongoose.connection.transaction(async (session) => {
      const rfq = await requiredRfq(id, session);
      if (!editable.some((status) => status === rfq.status))
        throw AppError.conflict('RFQ lines cannot be edited in this state.');
      if (!rfq.items.some((line) => line._id === itemId)) throw AppError.notFound();
      const changed = await RfqModel.findOneAndUpdate(
        { _id: id, status: rfq.status, 'items._id': itemId },
        {
          $set: {
            'items.$.item_availability_status': input.item_availability_status,
            ...(input.customer_facing_note ? { 'items.$.customer_facing_note': input.customer_facing_note } : {}),
          },
        },
        { session, returnDocument: 'after' },
      );
      if (!changed) throw AppError.conflict();
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'RFQ_ITEM_TRIAGED',
          entity_type: 'rfqs',
          entity_id: id,
          metadata: { item_id: itemId, availability: input.item_availability_status },
        },
        session,
      );
      return changed.toObject();
    });
  }
  async function status(req: Request, id: string, input: z.infer<typeof statusSchema>) {
    const result = await mongoose.connection.transaction(async (session) => {
      const rfq = await requiredRfq(id, session);
      if (!manualTransitions[rfq.status].includes(input.status))
        throw AppError.conflict('RFQ status transition is not allowed; use the corresponding workflow action.');
      if (['CLOSED', 'CANCELLED'].includes(input.status) && !input.reason)
        throw AppError.validation([{ field: 'reason', issue: 'A reason is required.' }]);
      const now = new Date();
      const changed = await RfqModel.findOneAndUpdate(
        { _id: id, status: rfq.status },
        {
          $set: {
            status: input.status,
            ...(['CLOSED', 'CANCELLED'].includes(input.status)
              ? {
                  terminal_at: now,
                  closed_at: now,
                  close_reason: input.status === 'CLOSED' ? 'ADMIN_CLOSED' : 'ADMIN_CANCELLED',
                }
              : {}),
          },
        },
        { session, returnDocument: 'after' },
      );
      if (!changed) throw AppError.conflict();
      if (changed.terminal_at) await retention(id, now, session);
      if (input.reason)
        await new ClarificationMessageModel({
          rfq_id: id,
          customer_id: rfq.customer_id,
          thread_id: randomUUID(),
          direction: 'INTERNAL_NOTE',
          channel: 'ADMIN',
          body: cleanHtml(input.reason),
          status: 'RESOLVED',
          actor_id: req.admin!.id,
        }).save({ session });
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'RFQ_STATUS_CHANGED',
          entity_type: 'rfqs',
          entity_id: id,
          metadata: { old_status: rfq.status, new_status: input.status },
        },
        session,
      );
      return changed.toObject();
    });
    return result;
  }
  async function clarify(req: Request, id: string, input: z.infer<typeof messageSchema>) {
    const result = await mongoose.connection.transaction(async (session) => {
      const rfq = await requiredRfq(id, session);
      if (!editable.some((status) => status === rfq.status))
        throw AppError.conflict('Clarification is not allowed in this RFQ state.');
      if (input.channel === 'EMAIL' && !rfq.contact_snapshot.email)
        throw AppError.validation([{ field: 'channel', issue: 'RFQ contact has no email address.' }]);
      const threadId = randomUUID();
      const message = new ClarificationMessageModel({
        rfq_id: id,
        customer_id: rfq.customer_id,
        thread_id: threadId,
        direction: 'ADMIN_TO_BUYER',
        channel: input.channel,
        body: input.body,
        status: 'PENDING_BUYER',
        actor_id: req.admin!.id,
      });
      await message.save({ session });
      const changed = await RfqModel.updateOne(
        { _id: id, status: rfq.status },
        { $set: { status: 'NEED_CLARIFICATION' } },
        { session },
      );
      if (changed.matchedCount !== 1) throw AppError.conflict();
      await enqueueRfqEmail(
        session,
        id,
        'clarification-request',
        input.channel === 'EMAIL' ? rfq.contact_snapshot.email : undefined,
        `clarification:${message._id}`,
        { thread_id: threadId, clarification_message_id: message._id },
      );
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'RFQ_CLARIFICATION_REQUESTED',
          entity_type: 'rfqs',
          entity_id: id,
          metadata: { thread_id: threadId, channel: input.channel },
        },
        session,
      );
      return { message_id: message._id, thread_id: threadId, status: 'NEED_CLARIFICATION' };
    });
    signals.notifications(req.requestId);
    return result;
  }
  async function close(req: Request, id: string, input: z.infer<typeof closeSchema>) {
    const result = await mongoose.connection.transaction(async (session) => {
      const rfq = await requiredRfq(id, session);
      if (!editable.some((status) => status === rfq.status))
        throw AppError.conflict('Unable-to-supply is not allowed in this RFQ state.');
      const now = new Date();
      const changed = await RfqModel.findOneAndUpdate(
        { _id: id, status: rfq.status },
        {
          $set: {
            status: 'CLOSED',
            close_reason: 'UNABLE_TO_SUPPLY',
            unable_to_supply_reason: input.unable_to_supply_reason,
            closed_at: now,
            terminal_at: now,
          },
        },
        { session, returnDocument: 'after' },
      );
      if (!changed) throw AppError.conflict();
      await retention(id, now, session);
      await enqueueRfqEmail(session, id, 'unable-to-supply', rfq.contact_snapshot.email, `unable-to-supply:${id}`);
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'RFQ_UNABLE_TO_SUPPLY',
          entity_type: 'rfqs',
          entity_id: id,
        },
        session,
      );
      return changed.toObject();
    });
    signals.notifications(req.requestId);
    return result;
  }
  async function note(req: Request, id: string, input: z.infer<typeof noteSchema>) {
    return mongoose.connection.transaction(async (session) => {
      const rfq = await requiredRfq(id, session);
      const message = new ClarificationMessageModel({
        rfq_id: id,
        customer_id: rfq.customer_id,
        thread_id: randomUUID(),
        direction: 'INTERNAL_NOTE',
        channel: 'ADMIN',
        body: input.body,
        status: 'RESOLVED',
        actor_id: req.admin!.id,
      });
      await message.save({ session });
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'RFQ_INTERNAL_NOTE_ADDED',
          entity_type: 'rfqs',
          entity_id: id,
        },
        session,
      );
      return { note_id: message._id };
    });
  }
  return { list, detail, item, status, clarify, close, note };
}
