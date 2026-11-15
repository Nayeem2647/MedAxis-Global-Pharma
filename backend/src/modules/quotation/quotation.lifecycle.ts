import type { ClientSession } from 'mongoose';
import { AppError } from '../../shared/errors/AppError.js';
import { PrescriptionModel } from '../storage/storage.schema.js';
import { NotificationLogModel } from '../notification/notification.schema.js';
import { AdminModel } from '../auth/auth.schema.js';
import type { AppEnv } from '../../config/env.js';
import type { IQuotationVersion } from './quotation.schema.js';

export const ACCEPTED_STATUSES = ['ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED'] as const;
export const isAccepted = (status: string) => ACCEPTED_STATUSES.some((value) => value === status);
export const isExpired = (version: IQuotationVersion, now = new Date()) =>
  ['VALIDITY_EXPIRED', 'PAYMENT_EXPIRED'].includes(version.status) ||
  (version.status === 'SENT' && (!version.valid_until || version.valid_until <= now));
export const tokenExpired = () =>
  AppError.forbidden('This quotation has expired. Request an updated quotation.', 'QUOTATION_TOKEN_EXPIRED');
export const versionConflict = () =>
  AppError.conflict('This quotation version is no longer current.', 'QUOTATION_VERSION_CONFLICT');
export async function scheduleMedicalPurge(rfqId: string, now: Date, session: ClientSession) {
  const rows = await PrescriptionModel.find({ rfq_id: rfqId, purge_status: { $ne: 'PURGED' } })
    .select({ _id: 1, uploaded_at: 1 })
    .session(session)
    .lean();
  for (const row of rows)
    await PrescriptionModel.updateOne(
      { _id: row._id, purge_status: { $ne: 'PURGED' } },
      {
        $min: {
          purge_scheduled_at: new Date(
            Math.min(row.uploaded_at.getTime() + 90 * 86400000, now.getTime() + 14 * 86400000),
          ),
        },
      },
      { session },
    );
}
export async function queueLifecycleEmail(
  session: ClientSession,
  versionId: string,
  template: string,
  recipient: string | undefined,
  dedupe: string,
  priority?: 'HIGH',
) {
  if (!recipient) return;
  await NotificationLogModel.updateOne(
    { dedupe_key: dedupe },
    {
      $setOnInsert: {
        entity_type: 'quotation_versions',
        entity_id: versionId,
        kind: 'EMAIL',
        template_id: template,
        recipient,
        safe_payload: { version_id: versionId, ...(priority ? { priority } : {}) },
        status: 'PENDING',
        next_retry_at: new Date(),
      },
    },
    { upsert: true, runValidators: true, session },
  );
}
export async function queueAdminEmail(
  env: AppEnv,
  session: ClientSession,
  versionId: string,
  template: string,
  dedupe: string,
) {
  const owner = await AdminModel.findOne({ singleton_key: 'SUPER_ADMIN', is_active: true })
    .select({ email: 1 })
    .session(session)
    .lean();
  await queueLifecycleEmail(session, versionId, template, env.ADMIN_ALERT_EMAIL ?? owner?.email, dedupe, 'HIGH');
}
