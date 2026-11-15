import type { ClientSession } from 'mongoose';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { encrypt } from '../../shared/utils/crypto.js';
import { NotificationLogModel } from '../notification/notification.schema.js';
import type { IQuotationVersion } from './quotation.schema.js';

export function encryptedDelivery(env: AppEnv, url: string) {
  const value = env.QUOTATION_TOKEN_ENCRYPTION_KEY;
  const keyId = env.QUOTATION_TOKEN_KEY_ID;
  if (!value || !keyId) throw AppError.unavailable('Quotation token-delivery encryption is not configured.');
  const key = Buffer.from(value, /^[a-f0-9]{64}$/i.test(value) ? 'hex' : 'base64');
  if (key.length !== 32) throw AppError.unavailable('Quotation token-delivery encryption is not configured.');
  return encrypt(url, key, keyId);
}
export async function enqueueQuotation(
  env: AppEnv,
  version: IQuotationVersion,
  tokenHash: string,
  url: string,
  session: ClientSession,
  resend = false,
) {
  const delivery = encryptedDelivery(env, url);
  // Pending links from earlier token rotations/revisions must not be delivered.
  await NotificationLogModel.updateMany(
    {
      entity_type: 'quotation_versions',
      entity_id: version._id,
      kind: 'EMAIL',
      status: { $in: ['PENDING', 'FAILED', 'FAILED_RETRY', 'PROCESSING'] },
    },
    { $set: { status: 'DEAD', safe_payload: { version_id: version._id, invalidated: true } } },
    { session },
  );
  await new NotificationLogModel({
    dedupe_key: `quotation:${version._id}:${tokenHash}`,
    entity_type: 'quotation_versions',
    entity_id: version._id,
    kind: 'EMAIL',
    recipient: version.contact_snapshot.email,
    template_id: resend ? 'quotation-resend' : 'quotation-sent',
    safe_payload: {
      version_id: version._id,
      delivery,
      delivery_expires_at: new Date(Math.min(Date.now() + 86_400_000, version.valid_until!.getTime())).toISOString(),
    },
    status: 'PENDING',
    next_retry_at: new Date(),
  }).save({ session });
  if (!resend)
    await new NotificationLogModel({
      dedupe_key: `quotation-pdf:${version._id}`,
      entity_type: 'quotation_versions',
      entity_id: version._id,
      kind: 'PDF_RENDER',
      safe_payload: { version_id: version._id, mode: 'ORIGINAL_QUOTE' },
      status: 'PENDING',
      next_retry_at: new Date(),
    }).save({ session });
}
