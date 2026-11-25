import type { ClientSession } from 'mongoose';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { decrypt, generateToken, hashToken } from '../../shared/utils/crypto.js';
import { encryptedDelivery } from '../quotation/quotation.outbox.js';
import { RfqModel } from './rfq.schema.js';

export function newGuestAccess(env: AppEnv) {
  const token = generateToken();
  const url = new URL(`/r/${token}`, env.PUBLIC_ORIGIN[0]!).href;
  return {
    guest_token_hash: hashToken(token),
    guest_delivery: encryptedDelivery(env, url),
    guest_expires_at: new Date(Date.now() + 90 * 86400000),
  };
}
export async function resolveGuest(token: string, session?: ClientSession) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw AppError.notFound();
  const rfq = await RfqModel.findOne({ guest_token_hash: hashToken(token) })
    .session(session ?? null)
    .lean();
  if (!rfq) throw AppError.notFound();
  if (rfq.guest_revoked_at || !rfq.guest_expires_at || rfq.guest_expires_at <= new Date())
    throw AppError.forbidden('This private request link has expired or was revoked.', 'QUOTATION_TOKEN_EXPIRED');
  return rfq;
}
export async function guestUrl(env: AppEnv, rfqId: string, session?: ClientSession): Promise<string | undefined> {
  const rfq = await RfqModel.findById(rfqId)
    .select('+guest_delivery +guest_token_hash')
    .session(session ?? null)
    .lean();
  if (!rfq?.guest_delivery || rfq.guest_revoked_at || !rfq.guest_expires_at || rfq.guest_expires_at <= new Date())
    return;
  if (!env.QUOTATION_TOKEN_ENCRYPTION_KEY || !env.QUOTATION_TOKEN_KEY_ID) return;
  const key = env.QUOTATION_TOKEN_ENCRYPTION_KEY;
  const url = new URL(
    decrypt(
      rfq.guest_delivery,
      Buffer.from(key, /^[a-f0-9]{64}$/i.test(key) ? 'hex' : 'base64'),
      env.QUOTATION_TOKEN_KEY_ID,
    ).toString(),
  );
  const token = /^\/r\/([a-f0-9]{64})$/.exec(url.pathname)?.[1];
  if (
    !token ||
    hashToken(token) !== rfq.guest_token_hash ||
    !env.PUBLIC_ORIGIN.some((origin) => new URL(origin).origin === url.origin)
  )
    throw AppError.notFound();
  return url.href;
}
