import mongoose from 'mongoose';
import { NotificationLogModel } from '../modules/notification/notification.schema.js';
import { QuotationModel, QuotationVersionModel } from '../modules/quotation/quotation.schema.js';

export const dhakaDate = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
export function createExpiryReminderJob() {
  return async (kind: 'QUOTATION_24H' | 'RESERVATION_DAY3', now = new Date()) => {
    const criteria =
      kind === 'QUOTATION_24H'
        ? { status: 'SENT' as const, valid_until: { $gt: now, $lte: new Date(now.getTime() + 86400000) } }
        : {
            status: 'ACCEPTED' as const,
            accepted_at: { $lte: new Date(now.getTime() - 3 * 86400000) },
            reservation_status: 'ACTIVE' as const,
            reservation_expires_at: { $gt: now },
            payment: { $exists: false },
          };
    const candidates = await QuotationVersionModel.find(criteria).select({ _id: 1, quotation_id: 1 }).limit(500).lean();
    for (const row of candidates)
      await mongoose.connection.transaction(async (session) => {
        if (
          !(await QuotationModel.exists({
            _id: row.quotation_id,
            current_version_id: row._id,
            overall_status: 'ACTIVE',
          }).session(session))
        )
          return;
        const version = await QuotationVersionModel.findOne({ ...criteria, _id: row._id })
          .select({ contact_snapshot: 1 })
          .session(session)
          .lean();
        if (!version?.contact_snapshot.email) return;
        await NotificationLogModel.updateOne(
          { dedupe_key: `reminder:${row._id}:${kind}:${dhakaDate(now)}` },
          {
            $setOnInsert: {
              kind: 'EMAIL',
              entity_type: 'quotation_versions',
              entity_id: row._id,
              template_id: 'expiry-reminder',
              recipient: version.contact_snapshot.email,
              safe_payload: { version_id: row._id, reminder_kind: kind },
              status: 'PENDING',
              next_retry_at: now,
            },
          },
          { upsert: true, runValidators: true, session },
        );
      });
    return candidates.length;
  };
}
