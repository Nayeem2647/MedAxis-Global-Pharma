import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import {
  createStorageService,
  initializeLocalStorage,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  productImageUrl,
  validatePrescription,
} from '../src/modules/storage/storage.service.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { s3EnvSettings, validEnv } from './helpers/env.js';
import { pdf, png, jpeg } from './fixtures/prescriptions.js';
import { mp4, webm } from './fixtures/catalog-media.js';

const rawStorageEnv = {
  ...validEnv,
  ...s3EnvSettings,
  PRESCRIPTION_ENCRYPTION_KEY: 'ab'.repeat(32),
  PRESCRIPTION_KEY_ID: 'medical-v1',
};
const env = loadEnv(rawStorageEnv);

describe('S3 object storage with legacy R2 reads', () => {
  it('uploads only recognized video containers and preserves the actual MIME type', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = createStorageService(env, { send } as unknown as Pick<S3Client, 'send'>);
    for (const [bytes, type, extension] of [[mp4, 'video/mp4', 'mp4'], [webm, 'video/webm', 'webm']] as const) {
      const result = await storage.uploadPublicVideo(bytes);
      expect(result.mime_type).toBe(type);
      expect(result.object_key).toMatch(new RegExp('^products/s3/videos/[a-f0-9-]+\\.' + extension + '$'));
      expect(send.mock.calls.at(-1)![0].input).toMatchObject({ ContentType: type, Body: bytes, CacheControl: 'public, max-age=31536000, immutable' });
    }
    for (const invalid of [Buffer.alloc(0), png, Buffer.from('<script>bad</script>'), Buffer.alloc(MAX_VIDEO_BYTES + 1)])
      await expect(storage.uploadPublicVideo(invalid)).rejects.toMatchObject({ status: 422 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('serves local video with bounded byte ranges and rejects invalid or private media paths', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'medaxis-video-'));
    try {
      const localEnv = loadEnv({ ...validEnv, STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: dir, API_ORIGIN: 'http://127.0.0.1:4000' });
      const storage = createStorageService(localEnv);
      const app = createApp({ env: localEnv, logger: createLogger({ silent: true }), storage });
      const result = await storage.uploadPublicVideo(mp4);
      const filePath = new URL(result.url).pathname;
      expect(readFileSync(path.join(dir, result.object_key))).toEqual(mp4);
      const full = await request(app).get(filePath);
      expect(full.status).toBe(200);
      expect(full.headers['content-type']).toContain('video/mp4');
      expect(full.headers['accept-ranges']).toBe('bytes');
      const partial = await request(app).get(filePath).set('Range', 'bytes=4-7');
      expect(partial.status).toBe(206);
      expect(partial.headers['content-range']).toBe(`bytes 4-7/${mp4.length}`);
      expect(partial.headers['content-length']).toBe('4');
      const suffix = await request(app).get(filePath).set('Range', 'bytes=-4');
      expect(suffix.status).toBe(206);
      expect(suffix.headers['content-range']).toBe(`bytes ${mp4.length - 4}-${mp4.length - 1}/${mp4.length}`);
      for (const range of ['bytes=999999-', 'bytes=9-2', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=']) {
        const response = await request(app).get(filePath).set('Range', range);
        expect(response.status).toBe(416);
        expect(response.headers['content-range']).toBe(`bytes */${mp4.length}`);
      }
      expect((await request(app).get(filePath.replace(/mp4$/, 'html'))).status).toBe(404);
      expect((await request(app).get('/v1/public/media/prescriptions/local/private.mp4')).status).toBe(404);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('validates actual bytes and rejects spoofed/oversized prescriptions', async () => {
    expect(await validatePrescription(pdf)).toBe('application/pdf');
    expect(await validatePrescription(png)).toBe('image/png');
    expect(await validatePrescription(jpeg)).toBe('image/jpeg');
    expect(await validatePrescription(Buffer.concat([pdf, Buffer.alloc(MAX_FILE_BYTES - pdf.length)]))).toBe(
      'application/pdf',
    );
    for (const invalid of [Buffer.alloc(0), Buffer.from('<svg onload="alert(1)"/>'), Buffer.alloc(MAX_FILE_BYTES + 1)])
      await expect(validatePrescription(invalid)).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_PRESCRIPTION_FILE',
      });
  });
  it('encrypts before uploading, keeps URLs out of medical metadata and decrypts byte-for-byte', async () => {
    let stored = Buffer.alloc(0);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        stored = Buffer.from(command.input.Body as Buffer);
        return {};
      }
      if (command instanceof GetObjectCommand) return { Body: Readable.from([stored]) };
      return {};
    });
    const storage = createStorageService(env, { send } as unknown as Pick<S3Client, 'send'>);
    const result = await storage.uploadPrescription(pdf);
    expect(result.object_key).toMatch(/^prescriptions\/s3\/.+\.enc$/);
    expect(result.encryption).toMatchObject({ algorithm: 'aes-256-gcm', key_id: 'medical-v1' });
    expect(JSON.stringify(result)).not.toMatch(/https?:|url|ciphertext/i);
    expect(stored).not.toEqual(pdf);
    const put = send.mock.calls[0]![0] as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: 'private-prescriptions',
      ContentType: 'application/octet-stream',
      CacheControl: 'no-store',
    });
    expect(await storage.downloadPrescription(result)).toEqual(pdf);
    stored[0] = stored[0]! ^ 1;
    await expect(storage.downloadPrescription(result)).rejects.toMatchObject({ status: 503 });
  });
  it('uploads only validated product images and uses separate quote/product buckets', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = createStorageService(env, { send } as unknown as Pick<S3Client, 'send'>);
    const image = await storage.uploadPublicImage(png);
    expect(image.url).toMatch(/^https:\/\/cdn\.example\.test\/products\/s3\/.+\.png$/);
    expect((send.mock.calls[0]![0] as PutObjectCommand).input).toMatchObject({
      Bucket: 'catalog-images',
      ContentType: 'image/png',
    });
    await expect(storage.uploadPublicImage(pdf)).rejects.toMatchObject({ status: 422 });
    await storage.upload('quotes', 'quotes/s3/example.pdf', pdf, 'application/pdf');
    expect((send.mock.calls[1]![0] as PutObjectCommand).input.Bucket).toBe('private-quotes');
    await storage.remove('quotes', 'quotes/s3/example.pdf');
    expect(send.mock.calls[2]![0]).toBeInstanceOf(DeleteObjectCommand);
    await expect(storage.download('prescriptions', 'products/example.png')).rejects.toMatchObject({ status: 400 });
    expect(productImageUrl(env.S3_PUBLIC_BASE_URL, 'prescriptions/example.enc')).toBeNull();
    expect(productImageUrl(env.S3_PUBLIC_BASE_URL, 'https://attacker.test/a.png')).toBeNull();
    const logo = await storage.uploadPublicImage(png, 'manufacturers');
    expect(logo.url).toMatch(/^https:\/\/cdn\.example\.test\/products\/s3\/manufacturers\/.+\.png$/);
    const sixMibPng = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);
    expect((await storage.uploadPublicImage(sixMibPng)).file_size_bytes).toBe(sixMibPng.length);
    await expect(storage.uploadPublicImage(Buffer.alloc(MAX_IMAGE_BYTES + 1))).rejects.toMatchObject({ status: 422 });
  });
  it('routes legacy reads to R2 and refuses to issue a legacy delete', async () => {
    const send = vi.fn();
    const legacy = vi.fn().mockResolvedValue({ Body: Readable.from([pdf]) });
    const legacyEnv = loadEnv({ ...rawStorageEnv, R2_BUCKET_QUOTES: 'legacy-quotes' });
    const storage = createStorageService(legacyEnv, { send }, { send: legacy });
    expect(await storage.download('quotes', 'quotes/legacy.pdf')).toEqual(pdf);
    expect((legacy.mock.calls[0]![0] as GetObjectCommand).input.Bucket).toBe('legacy-quotes');
    await expect(storage.remove('quotes', 'quotes/legacy.pdf')).rejects.toMatchObject({ status: 409 });
    await expect(storage.upload('quotes', 'quotes/legacy.pdf', pdf, 'application/pdf')).rejects.toMatchObject({ status: 400 });
    expect(send).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(productImageUrl(env.S3_PUBLIC_BASE_URL, 'products/legacy.png', 'https://old.example.test'))
      .toBe('https://old.example.test/products/legacy.png');
  });
  it('issues private avatar signatures scoped to the avatar bucket for two minutes', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'fixture-access-key');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'fixture-secret-key');
    try {
      const storage = createStorageService(env);
      const signed = new URL(await storage.signAvatar('avatars/s3/example.jpg'));
      expect(signed.hostname).toBe('private-avatars.s3.ap-southeast-1.amazonaws.com');
      expect(signed.pathname).toBe('/avatars/s3/example.jpg');
      expect(signed.searchParams.get('X-Amz-Expires')).toBe('120');
      expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
      await expect(storage.signAvatar('quotes/s3/example.pdf')).rejects.toMatchObject({ status: 400 });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('sanitizes storage failures and requires configuration before any external call', async () => {
    const storage = createStorageService(loadEnv(validEnv));
    await expect(storage.uploadPrescription(pdf)).rejects.toMatchObject({ status: 503 });
    const send = vi.fn().mockRejectedValue(new Error('private-storage-diagnostics'));
    const configured = createStorageService(env, { send } as unknown as Pick<S3Client, 'send'>);
    await expect(configured.uploadPublicImage(png)).rejects.toThrow('Storage upload failed.');
  });

  it.each(['test', 'development'] as const)('stores every upload locally and protects private files in %s', async (mode) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'medaxis-local-storage-'));
    try {
      const localEnv = loadEnv({
        ...validEnv,
        NODE_ENV: mode,
        STORAGE_DRIVER: 'local',
        LOCAL_STORAGE_DIR: dir,
        API_ORIGIN: 'http://127.0.0.1:4000',
        S3_PUBLIC_BASE_URL: 'https://retired-cdn.example.test',
        R2_BUCKET_PRESCRIPTIONS: 'retired-prescriptions',
        PRESCRIPTION_ENCRYPTION_KEY: 'ab'.repeat(32),
        PRESCRIPTION_KEY_ID: 'local-rx-1',
      });
      await initializeLocalStorage(localEnv);
      for (const kind of ['products', 'quotes', 'prescriptions', 'avatars']) {
        expect(existsSync(path.join(dir, kind))).toBe(true);
      }
      const storage = createStorageService(localEnv);
      const app = createApp({ env: localEnv, logger: createLogger({ silent: true }), storage });

      const product = await storage.uploadPublicImage(png);
      expect(product.url).toBe(`${localEnv.API_ORIGIN}/v1/public/media/${product.object_key}`);
      expect(product.object_key).toMatch(/^products\/local\/.+\.png$/);
      const productPath = new URL(product.url).pathname;
      const productRes = await request(app).get(productPath).set('Accept', 'image/png');
      expect(productRes.status).toBe(200);
      expect(productRes.headers['content-type']).toMatch(/^image\/png/);
      expect(Buffer.from(productRes.body)).toEqual(png);

      const logo = await storage.uploadPublicImage(png, 'manufacturers');
      expect(logo.object_key).toMatch(/^products\/local\/manufacturers\/.+\.png$/);
      const logoRes = await request(app).get(new URL(logo.url).pathname);
      expect(logoRes.status).toBe(200);
      const genericImage = await storage.uploadPublicImage(png, 'generics');
      expect(genericImage.object_key).toMatch(/^products\/local\/generics\/.+\.png$/);
      const genericMedia = await request(app).get(new URL(genericImage.url).pathname).set('Accept', 'image/png');
      expect(genericMedia.status).toBe(200);
      expect(Buffer.from(genericMedia.body)).toEqual(png);
      const categoryImage = await storage.uploadPublicImage(png, 'categories');
      expect(categoryImage.object_key).toMatch(/^products\/local\/categories\/.+\.png$/);
      const categoryMedia = await request(app).get(new URL(categoryImage.url).pathname).set('Accept', 'image/png');
      expect(categoryMedia.status).toBe(200);
      expect(Buffer.from(categoryMedia.body)).toEqual(png);

      const avatarKey = await storage.uploadAvatar(jpeg);
      const signed = new URL(await storage.signAvatar(avatarKey));
      expect(signed.pathname).toMatch(/^\/v1\/public\/media\/avatars\/local\/.+\.jpg$/);
      const avatarOk = await request(app).get(`${signed.pathname}${signed.search}`);
      expect(avatarOk.status).toBe(200);
      expect(Buffer.from(avatarOk.body)).toEqual(jpeg);
      const avatarForged = await request(app).get(`${signed.pathname}?expires=${signed.searchParams.get('expires')}&sig=${'0'.repeat(64)}`);
      expect(avatarForged.status).toBe(403);
      const avatarExpired = await request(app).get(`${signed.pathname}?expires=1&sig=${signed.searchParams.get('sig')}`);
      expect(avatarExpired.status).toBe(403);
      const avatarUnsigned = await request(app).get(signed.pathname);
      expect(avatarUnsigned.status).toBe(422);

      const rx = await storage.uploadPrescription(pdf);
      expect(rx.object_key).toMatch(/^prescriptions\/local\/.+\.enc$/);
      const encrypted = readFileSync(path.join(dir, rx.object_key));
      expect(encrypted).not.toEqual(pdf);
      expect(await storage.downloadPrescription(rx)).toEqual(pdf);
      const publicRx = await request(app).get(`/v1/public/media/${rx.object_key}`);
      expect(publicRx.status).toBe(404);
      encrypted[0] = encrypted[0]! ^ 1;
      writeFileSync(path.join(dir, rx.object_key), encrypted);
      await expect(storage.downloadPrescription(rx)).rejects.toMatchObject({ status: 503 });
      await storage.remove('prescriptions', rx.object_key);
      await expect(storage.downloadPrescription(rx)).rejects.toMatchObject({ status: 503 });

      await storage.upload('quotes', 'quotes/local/local-quote.pdf', pdf, 'application/pdf');
      expect(await storage.download('quotes', 'quotes/local/local-quote.pdf')).toEqual(pdf);
      const publicQuote = await request(app).get('/v1/public/media/quotes/local/local-quote.pdf');
      expect(publicQuote.status).toBe(404);
      await expect(storage.download('products', 'products/local/../../prescriptions/private.enc')).rejects.toMatchObject({ status: 400 });
      await storage.remove('quotes', 'quotes/local/local-quote.pdf');
      expect(existsSync(path.join(dir, 'quotes/local/local-quote.pdf'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
