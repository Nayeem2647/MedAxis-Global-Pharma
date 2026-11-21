import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fileTypeFromBuffer } from 'file-type';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';

export type StorageBucket = 'products' | 'quotes' | 'prescriptions' | 'avatars';
type LegacyBucket = Exclude<StorageBucket, 'avatars'>;
export interface PrescriptionObject {
  object_key: string;
  mime_type: 'image/jpeg' | 'image/png' | 'application/pdf';
  file_size_bytes: number;
  encryption: { algorithm: 'aes-256-gcm'; iv: string; auth_tag: string; key_id: string };
}
export const MAX_FILE_BYTES = 5_242_880;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const DEFAULT_LOCAL_UPLOADS_DIR = fileURLToPath(new URL('../../../uploads', import.meta.url));

export function isS3ObjectKey(kind: StorageBucket, key: string): boolean {
  return key.startsWith(`${kind}/s3/`);
}

export function isManagedObjectKey(kind: StorageBucket, key: string): boolean {
  return key.startsWith(`${kind}/local/`) || isS3ObjectKey(kind, key);
}

export function migratedObjectKey(kind: StorageBucket, source: string, extension: string): string {
  return `${kind}/s3/legacy/${createHash('sha256').update(source).digest('hex')}.${extension}`;
}

export function publicImageBaseUrl(
  env: Pick<AppEnv, 'STORAGE_DRIVER' | 'S3_PUBLIC_BASE_URL' | 'API_ORIGIN'>,
): string | undefined {
  if (env.STORAGE_DRIVER === 'local') return `${env.API_ORIGIN.replace(/\/+$/, '')}/v1/public/media`;
  return env.S3_PUBLIC_BASE_URL;
}

export function localStorageRoot(env: Pick<AppEnv, 'LOCAL_STORAGE_DIR'>): string {
  return path.resolve(env.LOCAL_STORAGE_DIR || DEFAULT_LOCAL_UPLOADS_DIR);
}

export async function initializeLocalStorage(env: Pick<AppEnv, 'STORAGE_DRIVER' | 'LOCAL_STORAGE_DIR'>): Promise<void> {
  if (env.STORAGE_DRIVER !== 'local') return;
  const root = localStorageRoot(env);
  await Promise.all((['products', 'quotes', 'prescriptions', 'avatars'] as const)
    .map((kind) => mkdir(path.join(root, kind), { recursive: true, mode: 0o700 })));
}

export function resolveLocalObjectPath(rootDir: string, kind: StorageBucket, key: string): string {
  if (
    !key.startsWith(`${kind}/`) ||
    key.length > 500 ||
    !/^[a-zA-Z0-9/_\-.]+$/.test(key) ||
    key.split('/').some((part) => !part || part === '..' || part === '.')
  )
    throw AppError.badRequest('Invalid storage object key.');
  const bucketRoot = path.resolve(rootDir, kind);
  const resolved = path.resolve(rootDir, key);
  if (!resolved.startsWith(`${bucketRoot}${path.sep}`)) throw AppError.badRequest('Invalid storage object key.');
  return resolved;
}

function localMimeType(key: string): string {
  if (/\.jpe?g$/i.test(key)) return 'image/jpeg';
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.webp$/i.test(key)) return 'image/webp';
  if (/\.mp4$/i.test(key)) return 'video/mp4';
  if (/\.webm$/i.test(key)) return 'video/webm';
  if (/\.pdf$/i.test(key)) return 'application/pdf';
  return 'application/octet-stream';
}

function signLocalAvatarToken(secret: string, key: string, expires: number): string {
  return createHmac('sha256', secret).update(`${key}:${expires}`).digest('hex');
}

export function verifyLocalAvatarSignature(
  env: Pick<AppEnv, 'ADMIN_SESSION_SECRET'>,
  key: string,
  expires: string,
  sig: string,
): boolean {
  if (!/^\d{1,12}$/.test(expires) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(expires);
  if (exp < now || exp > now + 300) return false;
  const expected = signLocalAvatarToken(env.ADMIN_SESSION_SECRET, key, exp);
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

export async function readLocalMediaFile(
  env: Pick<AppEnv, 'LOCAL_STORAGE_DIR'>,
  kind: 'products' | 'avatars',
  key: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const filePath = resolveLocalObjectPath(localStorageRoot(env), kind, key);
  try {
    const bytes = await readFile(filePath);
    const limit = /\.(?:mp4|webm)$/i.test(key)
      ? MAX_VIDEO_BYTES
      : kind === 'products' && /\.(?:jpg|jpeg|png|webp)$/i.test(key)
        ? MAX_IMAGE_BYTES
        : MAX_FILE_BYTES;
    if (bytes.length > limit) throw AppError.unavailable('Storage download failed.');
    return { bytes, contentType: localMimeType(key) };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw AppError.notFound();
    if (error instanceof AppError) throw error;
    throw AppError.unavailable('Storage download failed.');
  }
}

export function productImageUrl(baseUrl: string | undefined, key: string, legacyBase?: string): string | null {
  if (!isManagedObjectKey('products', key)) baseUrl = legacyBase ?? baseUrl;
  if (!baseUrl || !/^products\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/.test(key) || key.split('/').includes('..'))
    return null;
  return `${baseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function productVideoUrl(baseUrl: string | undefined, key: string | undefined): string | null {
  if (!baseUrl || !key || !/^products\/(?:local|s3)\/videos\/[a-zA-Z0-9_-]+\.(?:mp4|webm)$/.test(key)) return null;
  return baseUrl.replace(/\/+$/, '') + '/' + key;
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

export function createStorageService(
  env: AppEnv,
  suppliedClient?: Pick<S3Client, 'send'>,
  suppliedLegacyClient?: Pick<S3Client, 'send'>,
) {
  let client: S3Client | undefined;
  let legacyClient = suppliedLegacyClient;
  const isLocal = env.STORAGE_DRIVER === 'local' && !env.isProduction && !suppliedClient;
  const localRoot = localStorageRoot(env);
  const transport = { maxAttempts: 3, requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000 } };
  function awsClient() {
    if (!env.AWS_REGION) throw AppError.unavailable('AWS storage region is not configured.');
    return (client ??= new S3Client({ region: env.AWS_REGION, ...transport }));
  }
  function objectStorageClient() {
    return suppliedClient ?? awsClient();
  }
  function legacyStorageClient() {
    if (legacyClient) return legacyClient;
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
      throw AppError.unavailable('Legacy storage is not configured.');
    legacyClient = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      ...transport,
    });
    return legacyClient;
  }
  function bucket(kind: StorageBucket) {
    const name = {
      products: env.S3_BUCKET_PRODUCTS,
      quotes: env.S3_BUCKET_QUOTES,
      prescriptions: env.S3_BUCKET_PRESCRIPTIONS,
      avatars: env.S3_BUCKET_AVATARS,
    }[kind];
    if (!name) throw AppError.unavailable('S3 bucket is not configured.');
    return name;
  }
  function legacyBucket(kind: LegacyBucket) {
    return {
      products: env.R2_BUCKET_PRODUCTS,
      quotes: env.R2_BUCKET_QUOTES,
      prescriptions: env.R2_BUCKET_PRESCRIPTIONS,
    }[kind];
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
    if (!isManagedObjectKey(kind, key)) throw AppError.badRequest('New objects require a managed storage key.');
    if (!isLocal && key.startsWith(`${kind}/local/`)) throw AppError.badRequest('Local objects require local storage.');
    if (isLocal) {
      const target = resolveLocalObjectPath(localRoot, kind, key);
      try {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, buffer, { mode: 0o600, flag: 'wx' });
        return;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.unavailable('Storage upload failed.');
      }
    }
    try {
      await objectStorageClient().send(
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
  async function readObject(kind: StorageBucket, key: string, source: 's3' | 'r2') {
    safeKey(kind, key);
    if (isLocal && source === 's3') {
      const target = resolveLocalObjectPath(localRoot, kind, key);
      const maximum = kind === 'quotes' ? 25 * 1024 * 1024 : kind === 'products' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      try {
        const bytes = await readFile(target);
        if (bytes.length > maximum) throw new Error();
        return { bytes, contentType: localMimeType(key) };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.unavailable('Storage download failed.');
      }
    }
    const legacyName = source === 'r2' && kind !== 'avatars' ? legacyBucket(kind) : undefined;
    if (source === 'r2' && !legacyName) throw AppError.unavailable('Legacy bucket is not configured.');
    try {
      const connection = source === 'r2' ? legacyStorageClient() : objectStorageClient();
      const result = await connection.send(new GetObjectCommand({ Bucket: legacyName ?? bucket(kind), Key: key }));
      if (!result.Body) throw new Error();
      // Bound encrypted medical downloads before buffering a corrupt or replaced object.
      const maximum = kind === 'quotes' ? 25 * 1024 * 1024 : kind === 'products' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        length += chunk.byteLength;
        if (length > maximum) {
          if ('destroy' in result.Body && typeof result.Body.destroy === 'function') result.Body.destroy();
          throw new Error();
        }
        chunks.push(Buffer.from(chunk));
      }
      return { bytes: Buffer.concat(chunks), contentType: result.ContentType };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.unavailable('Storage download failed.');
    }
  }

  async function download(kind: StorageBucket, key: string): Promise<Buffer> {
    if (!isLocal && key.startsWith(`${kind}/local/`)) throw AppError.unavailable('Local objects require local storage.');
    const source = !isLocal && kind !== 'avatars' && !isS3ObjectKey(kind, key) && legacyBucket(kind) ? 'r2' : 's3';
    return (await readObject(kind, key, source)).bytes;
  }
  async function uploadPublicImage(buffer: Buffer, folder?: 'manufacturers' | 'generics' | 'categories') {
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES)
      throw AppError.validation([{ field: 'image', issue: 'Image must be no larger than 25 MiB.' }]);
    const type = await fileTypeFromBuffer(buffer).catch(() => undefined);
    if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime))
      throw AppError.validation([{ field: 'image', issue: 'Only JPEG, PNG and WebP images are allowed.' }]);
    const prefix = isLocal ? 'products/local' : 'products/s3';
    const directory = folder ? `${prefix}/${folder}` : prefix;
    const key = `${directory}/${randomUUID()}.${type.ext}`;
    const url = productImageUrl(publicImageBaseUrl(env), key);
    if (!url) throw AppError.unavailable('Public image delivery is not configured.');
    await upload('products', key, buffer, type.mime);
    return { object_key: key, url, mime_type: type.mime, file_size_bytes: buffer.length };
  }
  async function uploadPublicVideo(buffer: Buffer) {
    if (!buffer.length || buffer.length > MAX_VIDEO_BYTES)
      throw AppError.validation([{ field: 'video', issue: 'Video must be no larger than 100 MiB.' }]);
    const type = await fileTypeFromBuffer(buffer).catch(() => undefined);
    if (!type || !['video/mp4', 'video/webm'].includes(type.mime))
      throw AppError.validation([{ field: 'video', issue: 'Only MP4 and WebM videos are allowed.' }]);
    const key = 'products/' + (isLocal ? 'local' : 's3') + '/videos/' + randomUUID() + '.' + type.ext;
    const url = productVideoUrl(publicImageBaseUrl(env), key);
    if (!url) throw AppError.unavailable('Public video delivery is not configured.');
    await upload('products', key, buffer, type.mime);
    return { object_key: key, url, mime_type: type.mime, file_size_bytes: buffer.length };
  }
  async function uploadAvatar(buffer: Buffer) {
    const key = `avatars/${isLocal ? 'local' : 's3'}/${randomUUID()}.jpg`;
    await upload('avatars', key, buffer, 'image/jpeg');
    return key;
  }
  async function signAvatar(key: string) {
    safeKey('avatars', key);
    if (!isManagedObjectKey('avatars', key)) throw AppError.badRequest('Invalid avatar key.');
    if (!isLocal && key.startsWith('avatars/local/')) throw AppError.unavailable('Local objects require local storage.');
    if (isLocal) {
      const expires = Math.floor(Date.now() / 1000) + 120;
      const sig = signLocalAvatarToken(env.ADMIN_SESSION_SECRET, key, expires);
      return `${env.API_ORIGIN.replace(/\/+$/, '')}/v1/public/media/${key.split('/').map(encodeURIComponent).join('/')}?expires=${expires}&sig=${sig}`;
    }
    const name = bucket('avatars');
    try {
      return await getSignedUrl(awsClient(), new GetObjectCommand({ Bucket: name, Key: key }), { expiresIn: 120 });
    } catch {
      throw AppError.unavailable('Avatar is temporarily unavailable.');
    }
  }
  async function uploadPrescription(buffer: Buffer): Promise<PrescriptionObject> {
    const mime = await validatePrescription(buffer);
    const { key, keyId } = encryptionConfig();
    const payload = encrypt(buffer, key, keyId);
    const objectKey = `prescriptions/${isLocal ? 'local' : 's3'}/${randomUUID()}.enc`;
    await upload('prescriptions', objectKey, Buffer.from(payload.ciphertext, 'base64'), 'application/octet-stream');
    return {
      object_key: objectKey,
      mime_type: mime,
      file_size_bytes: buffer.length,
      encryption: { algorithm: payload.algorithm, key_id: payload.key_id, iv: payload.iv, auth_tag: payload.auth_tag },
    };
  }
  async function downloadPrescription(object: PrescriptionObject): Promise<Buffer> {
    const { key, keyId } = encryptionConfig();
    const ciphertext = await download('prescriptions', object.object_key);
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
    if (!isManagedObjectKey(kind, key)) throw AppError.conflict('Legacy objects must be migrated before deletion.');
    if (!isLocal && key.startsWith(`${kind}/local/`)) throw AppError.unavailable('Local objects require local storage.');
    if (isLocal) {
      const target = resolveLocalObjectPath(localRoot, kind, key);
      try {
        await rm(target, { force: true });
        return;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw AppError.unavailable('Storage deletion failed.');
      }
    }
    try {
      await objectStorageClient().send(new DeleteObjectCommand({ Bucket: bucket(kind), Key: key }));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.unavailable('Storage deletion failed.');
    }
  }
  async function putVerifiedCopy(kind: StorageBucket, key: string, bytes: Buffer, contentType: string) {
    safeKey(kind, key);
    if (!isS3ObjectKey(kind, key)) throw AppError.badRequest('Migration destination must be an S3 key.');
    let result: 'copied' | 'already-present' = 'copied';
    try {
      await objectStorageClient().send(new PutObjectCommand({
        Bucket: bucket(kind), Key: key, Body: bytes, ContentType: contentType, IfNoneMatch: '*',
        CacheControl: kind === 'products' ? 'public, max-age=31536000, immutable' : 'no-store',
      }));
    } catch (error) {
      if (!(error && typeof error === 'object' && '$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode === 412)) throw error;
      result = 'already-present';
    }
    const saved = await readObject(kind, key, 's3');
    if (!bytes.equals(saved.bytes) || contentType !== saved.contentType) throw new Error('S3 copy verification failed');
    return result;
  }
  return { uploadPublicVideo, uploadPublicImage, uploadAvatar, signAvatar, uploadPrescription, downloadPrescription, upload, download, remove, readObject, putVerifiedCopy };
}
export type StorageService = ReturnType<typeof createStorageService>;
