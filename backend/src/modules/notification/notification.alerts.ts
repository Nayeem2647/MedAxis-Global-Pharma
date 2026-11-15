import type { ClientSession } from 'mongoose';
import type { AppEnv } from '../../config/env.js';
import { AdminModel } from '../auth/auth.schema.js';
import { NotificationLogModel } from './notification.schema.js';

export async function enqueueOperatorAlert(
  env: AppEnv,
  code: string,
  referenceId: string,
  dedupeKey: string,
  session?: ClientSession,
) {
  const owner = await AdminModel.findOne({ singleton_key: 'SUPER_ADMIN', is_active: true })
    .select({ _id: 1, email: 1 })
    .session(session ?? null)
    .lean();
  if (!owner) return;
  await NotificationLogModel.updateOne(
    { dedupe_key: dedupeKey },
    {
      $setOnInsert: {
        entity_type: 'admins',
        entity_id: owner._id,
        kind: 'EMAIL',
        recipient: env.ADMIN_ALERT_EMAIL ?? owner.email,
        template_id: 'operational-alert',
        safe_payload: { priority: 'HIGH', alert_code: code, reference_id: referenceId },
        status: 'PENDING',
        next_retry_at: new Date(),
      },
    },
    { upsert: true, runValidators: true, session },
  );
}
