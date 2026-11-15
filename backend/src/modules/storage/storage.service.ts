import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { fileTypeFromBuffer } from 'file-type';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';

export type StorageBucket = 'products' | 'quotes' | 'prescriptions';
export interface PrescriptionObject {
  r2_object_key: string;
  mime_type: 'image/jpeg' | 'image/png' | 'application/pdf';
  file_size_bytes: number;
  encryption: { algorithm: 'aes-256-gcm'; iv: string; auth_tag: string; key_id: string };
}
export const MAX_FILE_BYTES = 5_242_880;

export function productImageUrl(baseUrl: string | undefined, key: string): string | null {
  if (!baseUrl || !/^products\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/.test(key) || key.split('/').includes('..'))
    return null;
  return `${baseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function validatePrescription(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_FILE_BYTES)
    throw AppError.badRequest(
      'Prescription must be a JPEG, PNG or PDF no larger than 5 MiB.',
      'INVALID_PRESCRIPTION_FILE',
    );
  const type = await fileTypeFromBuffer(buffer).catch(() => undefined);
  if (!type || !['image/jpeg', 'image/png', 'application/pdf'].includes(type.mime))
    throw AppError.badRequest(
      'Prescription must be a JPEG, PNG or PDF no larger than 5 MiB.',
      'INVALID_PRESCRIPTION_FILE',
    );
  return type.mime as PrescriptionObject['mime_type'];
}

export function createStorageService(env: AppEnv, suppliedClient?: Pick<S3Client, 'send'>) {
  let client = suppliedClient;
  function r2() {
    if (client) return client;
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
      throw AppError.unavailable('Storage is not configured.');
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000 },
    });
    return client;
  }
  function bucket(kind: StorageBucket) {
    const name = {
      products: env.R2_BUCKET_PRODUCTS,
      quotes: env.R2_BUCKET_QUOTES,
      prescriptions: env.R2_BUCKET_PRESCRIPTIONS,
    }[kind];
    if (!name) throw AppError.unavailable('Storage bucket is not configured.');
    return name;
  }
  function safeKey(kind: StorageBucket, key: string) {
    if (
      !key.startsWith(`${kind}/`) ||
      key.length > 500 ||
      !/^[a-zA-Z0-9/_\-.]+$/.test(key) ||
      key.split('/').some((part) => !part || part === '..' || part === '.')
    )
      throw AppError.badRequest('Invalid storage object key.');
  }
  function encryptionConfig() {
    if (!env.PRESCRIPTION_ENCRYPTION_KEY || !env.PRESCRIPTION_KEY_ID)
      throw AppError.unavailable('Prescription encryption is not configured.');
    const key = Buffer.from(
      env.PRESCRIPTION_ENCRYPTION_KEY,
      /^[0-9a-fA-F]{64}$/.test(env.PRESCRIPTION_ENCRYPTION_KEY) ? 'hex' : 'base64',
    );
    if (key.length !== 32) throw AppError.unavailable('Prescription encryption is not configured.');
    return { key, keyId: env.PRESCRIPTION_KEY_ID };
  }
  async function upload(kind: StorageBucket, key: string, buffer: Buffer, contentType: string) {
    safeKey(kind, key);
    try {
      await r2().send(
        new PutObjectCommand({
          Bucket: bucket(kind),
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: kind === 'products' ? 'public, max-age=31536000, immutable' : 'no-store',
        }),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.unavailable('Storage upload failed.');
    }
  }
  async function download(kind: StorageBucket, key: string): Promise<Buffer> {
    safeKey(kind, key);
    try {
      const result = await r2().send(new GetObjectCommand({ Bucket: bucket(kind), Key: key }));
      if (!result.Body) throw new Error();
      // Bound encrypted medical downloads before buffering a corrupt or replaced object.
      const maximum = kind === 'prescriptions' ? MAX_FILE_BYTES : 25 * 1024 * 1024;
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        length += chunk.byteLength;
        if (length > maximum) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.unavailable('Storage download failed.');
    }
  }
  async function uploadPublicImage(buffer: Buffer) {
    if (!buffer.length || buffer.length > MAX_FILE_BYTES)
      throw AppError.validation([{ field: 'image', issue: 'Image must be no larger than 5 MiB.' }]);
    const type = await fileTypeFromBuffer(buffer).catch(() => undefined);
    if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime))
      throw AppError.validation([{ field: 'image', issue: 'Only JPEG, PNG and WebP images are allowed.' }]);
    const key = `products/${randomUUID()}.${type.ext}`;
    const url = productImageUrl(env.R2_PUBLIC_BASE_URL, key);
    if (!url) throw AppError.unavailable('Public image delivery is not configured.');
    await upload('products', key, buffer, type.mime);
    return { r2_object_key: key, url, mime_type: type.mime, file_size_bytes: buffer.length };
  }
  async function uploadPrescription(buffer: Buffer): Promise<PrescriptionObject> {
    const mime = await validatePrescription(buffer);
    const { key, keyId } = encryptionConfig();
    const payload = encrypt(buffer, key, keyId);
    const objectKey = `prescriptions/${randomUUID()}.enc`;
    await upload('prescriptions', objectKey, Buffer.from(payload.ciphertext, 'base64'), 'application/octet-stream');
    return {
      r2_object_key: objectKey,
      mime_type: mime,
      file_size_bytes: buffer.length,
      encryption: { algorithm: payload.algorithm, key_id: payload.key_id, iv: payload.iv, auth_tag: payload.auth_tag },
    };
  }
  async function downloadPrescription(object: PrescriptionObject): Promise<Buffer> {
    const { key, keyId } = encryptionConfig();
    const ciphertext = await download('prescriptions', object.r2_object_key);
    let plaintext: Buffer;
    try {
      plaintext = decrypt({ ...object.encryption, ciphertext: ciphertext.toString('base64') }, key, keyId);
    } catch {
      throw AppError.unavailable('Prescription decryption failed.');
    }
    if (plaintext.length !== object.file_size_bytes || (await validatePrescription(plaintext)) !== object.mime_type)
      throw AppError.unavailable('Prescription integrity check failed.');
    return plaintext;
  }
  async function remove(kind: StorageBucket, key: string) {
    safeKey(kind, key);
    try {
      await r2().send(new DeleteObjectCommand({ Bucket: bucket(kind), Key: key }));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.unavailable('Storage deletion failed.');
    }
  }
  return { uploadPublicImage, uploadPrescription, downloadPrescription, upload, download, remove };
}
export type StorageService = ReturnType<typeof createStorageService>;
