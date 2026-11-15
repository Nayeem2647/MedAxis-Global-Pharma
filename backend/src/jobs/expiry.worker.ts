import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../shared/utils/logger.js';
import { writeAuditLog } from '../shared/middleware/auditLogger.js';
import { QuotationModel, QuotationVersionModel } from '../modules/quotation/quotation.schema.js';
import {
  queueAdminEmail,
  queueLifecycleEmail,
  scheduleMedicalPurge,
} from '../modules/quotation/quotation.lifecycle.js';

export function createExpiryWorker(env: AppEnv, logger: AppLogger, mode: 'RESERVATION' | 'QUOTATION') {
  return async (now = new Date()) => {
    const status = mode === 'RESERVATION' ? 'ACCEPTED' : 'SENT';
    const next = mode === 'RESERVATION' ? 'PAYMENT_EXPIRED' : 'VALIDITY_EXPIRED';
    const dateField = mode === 'RESERVATION' ? 'reservation_expires_at' : 'valid_until';
    const deadline = mode === 'RESERVATION' ? { $lte: now } : { $lt: now };
    const candidates = await QuotationVersionModel.find({ status, [dateField]: deadline })
      .select({ _id: 1, quotation_id: 1 })
      .limit(200)
      .lean();
    let count = 0;
    for (const candidate of candidates) {
      try {
        const changed = await mongoose.connection.transaction(
          async (session) => {
            const quote = await QuotationModel.findOne({
              _id: candidate.quotation_id,
              current_version_id: candidate._id,
              overall_status: 'ACTIVE',
            })
              .session(session)
              .lean();
            if (!quote) return false;
            const version = await QuotationVersionModel.findOneAndUpdate(
              {
                _id: candidate._id,
                status,
                [dateField]: deadline,
                ...(mode === 'RESERVATION' ? { reservation_status: 'ACTIVE', payment: { $exists: false } } : {}),
              },
              { $set: { status: next, reservation_status: 'RELEASED' } },
              { session, returnDocument: 'after' },
            )
              .select({ contact_snapshot: 1, valid_until: 1, reservation_expires_at: 1 })
              .lean();
            if (!version) return false;
            const parent = await QuotationModel.updateOne(
              { _id: quote._id, current_version_id: candidate._id, overall_status: 'ACTIVE' },
              { $set: { overall_status: 'EXPIRED' } },
              { session },
            );
            if (!parent.matchedCount) throw new Error('Expiry pointer conflict');
            const terminalAt = (mode === 'RESERVATION' ? version.reservation_expires_at : version.valid_until)!;
            await scheduleMedicalPurge(quote.rfq_id, terminalAt, session);
            await writeAuditLog(
              { requestId: randomUUID(), get: () => undefined },
              {
                actor_type: 'SYSTEM',
                action: `QUOTATION_${next}`,
                entity_type: 'quotation_versions',
                entity_id: candidate._id,
                old_status: status,
                new_status: next,
              },
              session,
            );
            if (mode === 'RESERVATION') {
              await queueLifecycleEmail(
                session,
                candidate._id,
                'reservation-expired',
                version.contact_snapshot.email,
                `reservation-expired:${candidate._id}`,
              );
              await queueAdminEmail(
                env,
                session,
                candidate._id,
                'admin-reservation-expired',
                `admin-reservation-expired:${candidate._id}`,
              );
            }
            return true;
          },
          { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
        );
        if (changed) count++;
      } catch {
        logger.error('Expiry transaction failed; next sweep will retry', { version_id: candidate._id, job: mode });
      }
    }
    return count;
  };
}
