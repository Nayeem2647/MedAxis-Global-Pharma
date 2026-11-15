import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import {
  createStorageService,
  MAX_FILE_BYTES,
  productImageUrl,
  validatePrescription,
} from '../src/modules/storage/storage.service.js';
import { validEnv } from './helpers/env.js';
import { pdf, png, jpeg } from './fixtures/prescriptions.js';

const env = loadEnv({
  ...validEnv,
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-id',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_PRODUCTS: 'public-images',
  R2_BUCKET_QUOTES: 'private-quotes',
  R2_BUCKET_PRESCRIPTIONS: 'private-medical',
  R2_PUBLIC_BASE_URL: 'https://cdn.example.test',
  PRESCRIPTION_ENCRYPTION_KEY: 'ab'.repeat(32),
  PRESCRIPTION_KEY_ID: 'medical-v1',
});

describe('R2 encrypted storage', () => {
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
    expect(result.r2_object_key).toMatch(/^prescriptions\/.+\.enc$/);
    expect(result.encryption).toMatchObject({ algorithm: 'aes-256-gcm', key_id: 'medical-v1' });
    expect(JSON.stringify(result)).not.toMatch(/https?:|url|ciphertext/i);
    expect(stored).not.toEqual(pdf);
    const put = send.mock.calls[0]![0] as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: 'private-medical',
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
    expect(image.url).toMatch(/^https:\/\/cdn\.example\.test\/products\/.+\.png$/);
    expect((send.mock.calls[0]![0] as PutObjectCommand).input).toMatchObject({
      Bucket: 'public-images',
      ContentType: 'image/png',
    });
    await expect(storage.uploadPublicImage(pdf)).rejects.toMatchObject({ status: 422 });
    await storage.upload('quotes', 'quotes/example.pdf', pdf, 'application/pdf');
    expect((send.mock.calls[1]![0] as PutObjectCommand).input.Bucket).toBe('private-quotes');
    await storage.remove('quotes', 'quotes/example.pdf');
    expect(send.mock.calls[2]![0]).toBeInstanceOf(DeleteObjectCommand);
    await expect(storage.download('prescriptions', 'products/example.png')).rejects.toMatchObject({ status: 400 });
    expect(productImageUrl(env.R2_PUBLIC_BASE_URL, 'prescriptions/example.enc')).toBeNull();
    expect(productImageUrl(env.R2_PUBLIC_BASE_URL, 'https://attacker.test/a.png')).toBeNull();
  });
  it('sanitizes storage failures and requires configuration before any external call', async () => {
    const storage = createStorageService(loadEnv(validEnv));
    await expect(storage.uploadPrescription(pdf)).rejects.toMatchObject({ status: 503 });
    const send = vi.fn().mockRejectedValue(new Error('R2-secret-value'));
    const configured = createStorageService(env, { send } as unknown as Pick<S3Client, 'send'>);
    await expect(configured.uploadPublicImage(png)).rejects.toThrow('Storage upload failed.');
  });
});
