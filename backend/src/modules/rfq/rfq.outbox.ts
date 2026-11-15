import type { ClientSession } from 'mongoose';
import { NotificationLogModel } from '../notification/notification.schema.js';

export async function enqueueRfqEmail(
  session: ClientSession,
  rfqId: string,
  template: string,
  recipient: string | undefined,
  dedupe: string,
  extra: Record<string, unknown> = {},
) {
  await new NotificationLogModel({
    dedupe_key: dedupe,
    entity_type: 'rfqs',
    entity_id: rfqId,
    kind: recipient ? 'EMAIL' : 'ADMIN_EVENT',
    recipient,
    template_id: template,
    safe_payload: { rfq_id: rfqId, ...extra, ...(!recipient ? { manual_delivery_required: true } : {}) },
    status: 'PENDING',
    next_retry_at: new Date(),
  }).save({ session });
}
