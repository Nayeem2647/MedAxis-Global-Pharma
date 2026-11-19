import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { copyLegacyFile, migrateStorageReferences } from '../src/scripts/migrate-storage.js';
import { png } from './fixtures/prescriptions.js';
import { s3EnvSettings, validEnv } from './helpers/env.js';

const env = loadEnv({ ...validEnv, ...s3EnvSettings, R2_BUCKET_PRODUCTS: 'legacy-images' });
const legacyKey = 'products/old.png';

function fakeStorage() {
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  const s3 = vi.fn(async (command: PutObjectCommand | GetObjectCommand) => {
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      expect(command.input.IfNoneMatch).toBe('*');
      if (objects.has(key)) throw { $metadata: { httpStatusCode: 412 } };
      objects.set(key, { bytes: Buffer.from(command.input.Body as Buffer), mime: command.input.ContentType! });
      return {};
    }
    const value = objects.get(key)!;
    return { Body: Readable.from([value.bytes]), ContentType: value.mime };
  });
  const r2 = vi.fn(async (_command: GetObjectCommand) => ({ Body: Readable.from([png]), ContentType: 'image/png' }));
  const storage = createStorageService(env, { send: s3 } as never, { send: r2 } as never);
  return { storage, objects, s3, r2 };
}

describe('legacy object migration', () => {
  it('reruns against one destination key, verifies bytes and never overwrites a conflicting object', async () => {
    const { storage, objects, r2 } = fakeStorage();
    const key = await copyLegacyFile(storage, 'products', legacyKey, 'r2');
    expect(key).toMatch(/^products\/s3\/legacy\/[a-f0-9]{64}\.png$/);
    expect(await copyLegacyFile(storage, 'products', legacyKey, 'r2')).toBe(key);
    expect(objects.size).toBe(1);
    objects.set(key, { bytes: Buffer.from('other object'), mime: 'image/png' });
    await expect(copyLegacyFile(storage, 'products', legacyKey, 'r2')).rejects.toThrow('S3 copy verification failed');
    expect(objects.get(key)?.bytes.toString()).toBe('other object');
    expect(r2.mock.calls.every(([command]) => command instanceof GetObjectCommand)).toBe(true);
  });

  it('reports dry runs and leaves references on R2 until the copy verifies', async () => {
    const { storage } = fakeStorage();
    const row = { _id: 'fixture', image_keys: [legacyKey] };
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: (name: string) => ({ find: () => name === 'products' ? [row] : [], updateOne }),
    } as unknown as mongoose.mongo.Db;
    const report = vi.fn();
    const options = { apply: false, source: 'r2' as const, report };
    expect(await migrateStorageReferences(db, storage, env, options)).toMatchObject({ planned: 1 });
    expect(updateOne).not.toHaveBeenCalled();
    const verification = vi.spyOn(storage, 'putVerifiedCopy').mockRejectedValueOnce(new Error('S3 copy verification failed'));
    expect(await migrateStorageReferences(db, storage, env, { ...options, apply: true })).toMatchObject({ failed: 1 });
    expect(updateOne).not.toHaveBeenCalled();
    verification.mockRestore();
    expect(await migrateStorageReferences(db, storage, env, { ...options, apply: true })).toMatchObject({ migrated: 1 });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: row._id, image_keys: [legacyKey] },
      { $set: { image_keys: [expect.stringMatching(/^products\/s3\/legacy\//)] } },
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain(legacyKey);
  });
});
