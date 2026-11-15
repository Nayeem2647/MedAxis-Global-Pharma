import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';

export const generateToken = (): string => randomBytes(32).toString('hex');
export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

export interface EncryptedPayload {
  algorithm: 'aes-256-gcm';
  key_id: string;
  iv: string;
  auth_tag: string;
  ciphertext: string;
}

const envelopeSchema = z
  .object({
    algorithm: z.literal('aes-256-gcm'),
    key_id: z.string().min(1).max(200),
    iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
    auth_tag: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
    ciphertext: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();

export function encrypt(data: Buffer | string, key: Buffer, keyId: string): EncryptedPayload {
  if (key.length !== 32 || !keyId || keyId.length > 200) throw new Error('Invalid encryption configuration');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data),
    cipher.final(),
  ]);
  return {
    algorithm: 'aes-256-gcm',
    key_id: keyId,
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** Accepts the same envelope produced by the existing bootstrap seed. */
export function decrypt(payload: unknown, key: Buffer, keyId: string): Buffer {
  try {
    const parsed = envelopeSchema.parse(payload);
    if (key.length !== 32 || parsed.key_id !== keyId) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, 'base64')), decipher.final()]);
  } catch {
    // Never include the supplied envelope, plaintext, or crypto library diagnostics.
    throw new Error('Unable to decrypt protected data');
  }
}

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!hash.startsWith('$argon2id$')) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
