import type { Request } from 'express';
import mongoose from 'mongoose';
import type { z } from 'zod';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { Exact, bsonDecimal, amount } from '../../shared/utils/decimal.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import type { fulfillmentSchema } from '../../shared/validators/decision.validator.js';
import { QuotationModel, QuotationVersionModel } from './quotation.schema.js';
import { quotationEvents } from './quotation.service.js';
import { COMMERCIAL_PROJECTION, commercialQuotation } from './quotation.dto.js';
import { queueLifecycleEmail, scheduleMedicalPurge, versionConflict } from './quotation.lifecycle.js';

export function createFulfillmentService(logger: AppLogger, dispatch?: () => void | Promise<void>) {
  return async (req: Request, id: string, input: z.infer<typeof fulfillmentSchema>) => {
    const result = await mongoose.connection.transaction(
      async (session) => {
        const quote = await QuotationModel.findById(id).session(session).lean();
        if (!quote) throw AppError.notFound();
        if (quote.overall_status !== 'ACTIVE') throw AppError.conflict('This quotation is not active.');
        if (input.expected_version_id && input.expected_version_id !== quote.current_version_id)
          throw versionConflict();
        const version = await QuotationVersionModel.findById(quote.current_version_id)
          .select(COMMERCIAL_PROJECTION)
          .session(session)
          .lean();
        if (!version || version.quotation_id !== id) throw AppError.notFound();
        const now = new Date();
        const filter: Record<string, unknown> = { _id: version._id, quotation_id: id };
        let set: Record<string, unknown>;
        if (input.status === 'PAYMENT_RECEIVED') {
          if (version.workflow_enabled && !version.payment_requested_at) throw AppError.conflict('Request payment after customer approval before recording the transfer.');
          if (version.payment && version.payment.reference === input.wire_reference && version.payment.currency === input.currency && new Exact(version.payment.amount.toString()).eq(input.amount)) return commercialQuotation(version);
          if (
            input.currency !== version.billing_currency ||
            !new Exact(input.amount).gt(0) ||
            !new Exact(input.amount).eq(version.total_amount.toString())
          )
            throw AppError.validation([
              {
                field: 'payment',
                issue: 'Verified payment must equal the payable quotation total in its billing currency.',
              },
            ]);
          if (
            version.status !== 'ACCEPTED' ||
            version.reservation_status !== 'ACTIVE' ||
            !version.reservation_expires_at ||
            version.reservation_expires_at <= now
          )
            throw AppError.conflict('An active, unexpired reservation is required to record payment.');
          Object.assign(filter, {
            status: 'ACCEPTED',
            reservation_status: 'ACTIVE',
            reservation_expires_at: { $gt: now },
          });
          set = {
            status: input.status,
            reservation_status: 'CONSUMED',
            payment: {
              reference: input.wire_reference,
              amount: bsonDecimal(amount(new Exact(input.amount))),
              currency: input.currency,
              received_at: now,
              recorded_by: req.admin!.id,
            },
          };
        } else if (input.status === 'DISPATCHED') {
          if (version.shipment?.courier_name === input.courier_name && version.shipment.awb_number === input.awb_tracking_number) return commercialQuotation(version);
          if (version.status !== 'PAYMENT_RECEIVED' || !version.payment || version.reservation_status !== 'CONSUMED')
            throw AppError.conflict('Verified payment is required before dispatch.');
          filter.status = 'PAYMENT_RECEIVED';
          set = {
            status: input.status,
            shipment: {
              courier_name: input.courier_name,
              awb_number: input.awb_tracking_number,
              dispatched_at: now,
              estimated_delivery: input.estimated_delivery,
            },
          };
        } else {
          if (version.status === 'DELIVERED' && version.workflow_enabled) return commercialQuotation(version);
          if (version.workflow_enabled && !input.delivery_evidence) throw AppError.validation([{ field: 'delivery_evidence', issue: 'Record the courier proof of delivery or handover reference.' }]);
          if (version.status !== 'DISPATCHED' || !version.shipment)
            throw AppError.conflict('Dispatch is required before delivery.');
          filter.status = 'DISPATCHED';
          set = { status: input.status, delivered_at: now, delivery_evidence: input.delivery_evidence };
        }
        const changed = await QuotationVersionModel.findOneAndUpdate(
          filter,
          { $set: set },
          { session, returnDocument: 'after' },
        )
          .select(COMMERCIAL_PROJECTION)
          .lean();
        if (!changed) throw AppError.conflict('Quotation changed or the reservation expired.');
        const parent = await QuotationModel.updateOne(
          { _id: id, current_version_id: version._id, overall_status: 'ACTIVE' },
          { $set: { updated_at: now, ...(input.status === 'DELIVERED' ? { overall_status: 'COMPLETED' } : {}) } },
          { session },
        );
        if (!parent.matchedCount) throw versionConflict();
        if (input.status === 'DELIVERED') await scheduleMedicalPurge(quote.rfq_id, now, session);
        const template =
          input.status === 'PAYMENT_RECEIVED'
            ? 'payment-received'
            : input.status === 'DISPATCHED'
              ? 'dispatch'
              : 'delivered';
        await queueLifecycleEmail(
          session,
          version._id,
          template,
          version.contact_snapshot.email,
          `${template}:${version._id}`,
        );
        await writeAuditLog(
          req,
          {
            actor_type: 'SUPER_ADMIN',
            actor_id: req.admin!.id,
            action: `QUOTATION_${input.status}`,
            entity_type: 'quotation_versions',
            entity_id: version._id,
            old_status: version.status,
            new_status: input.status,
          },
          session,
        );
        return commercialQuotation(changed);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    void Promise.resolve()
      .then(() => quotationEvents.emit('QUOTATION_CHANGED', { quotation_id: id }))
      .then(() => dispatch?.())
      .catch(() => logger.warn('Fulfillment notification hook failed', { request_id: req.requestId }));
    return result;
  };
}
