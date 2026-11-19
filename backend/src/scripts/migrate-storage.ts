import 'dotenv/config';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileTypeFromBuffer } from 'file-type';
import mongoose from 'mongoose';
import { loadEnv, type AppEnv } from '../config/env.js';
import {
  createStorageService,
  isS3ObjectKey,
  migratedObjectKey,
  productImageUrl,
  type StorageBucket,
  type StorageService,
} from '../modules/storage/storage.service.js';
import { runScript } from './migrate.js';

export type MigrationStorage = Pick<StorageService, 'readObject' | 'putVerifiedCopy'>;
type LegacySource = 'r2' | 's3';
type Row = mongoose.mongo.Document;
type Report = { collection: string; record: string; outcome: 'planned' | 'migrated' | 'conflict' | 'failed'; reason?: string };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const oldKey = (value: unknown, kind: StorageBucket): value is string =>
  typeof value === 'string' && value.startsWith(kind + '/') && !isS3ObjectKey(kind, value);
const sameField = (value: unknown) => value === undefined ? { $exists: false } : value;

export async function copyLegacyFile(
  storage: MigrationStorage, kind: Exclude<StorageBucket, 'avatars'>, key: string, source: LegacySource, expectedBytes?: number,
): Promise<string> {
  if (!oldKey(key, kind)) throw new Error('Invalid legacy object key');
  const { bytes } = await storage.readObject(kind, key, source);
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) throw new Error('Legacy file size does not match its record');
  let format: { ext: string; mime: string };
  if (kind === 'prescriptions') {
    if (!bytes.length) throw new Error('Empty encrypted prescription');
    format = { ext: 'enc', mime: 'application/octet-stream' };
  } else {
    const detected = await fileTypeFromBuffer(bytes);
    const allowed = kind === 'quotes' ? ['application/pdf'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!detected || !allowed.includes(detected.mime)) throw new Error('Unexpected legacy file type');
    format = detected;
  }
  const target = migratedObjectKey(kind, key, format.ext);
  await storage.putVerifiedCopy(kind, target, bytes, format.mime);
  return target;
}

async function copyInlineImage(storage: MigrationStorage, input: string, kind: 'products' | 'avatars') {
  const [prefix, encoded, extra] = input.split(',', 3);
  const bytes = Buffer.from(encoded ?? '', 'base64');
  const type = await fileTypeFromBuffer(bytes);
  const allowed = kind === 'avatars' ? ['image/jpeg'] : ['image/png', 'image/webp'];
  if (extra !== undefined || bytes.toString('base64') !== encoded ||
      !type || !allowed.includes(type.mime) || prefix !== `data:${type.mime};base64`)
    throw new Error('Invalid inline image');
  return copyImageBytes(storage, kind, bytes, type);
}

async function copyImageBytes(
  storage: MigrationStorage, kind: 'products' | 'avatars', bytes: Buffer, type: { ext: string; mime: string },
) {
  const key = migratedObjectKey(kind, digest(bytes), type.ext);
  await storage.putVerifiedCopy(kind, key, bytes, type.mime);
  return key;
}

async function copyAvatar(
  storage: MigrationStorage, value: string, env: Pick<AppEnv, 'R2_PUBLIC_BASE_URL' | 'S3_PUBLIC_BASE_URL'>, source: LegacySource,
) {
  if (value.startsWith('data:')) return copyInlineImage(storage, value, 'avatars');
  const url = new URL(value);
  const key = url.pathname.slice(1);
  const base = source === 'r2' ? env.R2_PUBLIC_BASE_URL : env.S3_PUBLIC_BASE_URL;
  if (!oldKey(key, 'products') || productImageUrl(base, key) !== value) throw new Error('Unrecognized legacy avatar URL');
  const { bytes } = await storage.readObject('products', key, source);
  const type = await fileTypeFromBuffer(bytes);
  if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime)) throw new Error('Unexpected avatar file type');
  return copyImageBytes(storage, 'avatars', bytes, type);
}

export async function migrateStorageReferences(
  db: mongoose.mongo.Db,
  storage: MigrationStorage,
  env: Pick<AppEnv, 'R2_PUBLIC_BASE_URL' | 'S3_PUBLIC_BASE_URL'>,
  options: { apply: boolean; source: LegacySource; report: (item: Report) => void },
) {
  const totals = { planned: 0, migrated: 0, conflict: 0, failed: 0 };
  const copy = (kind: Exclude<StorageBucket, 'avatars'>, key: string) =>
    copyLegacyFile(storage, kind, key, options.source);
  async function scan(
    name: string, query: Row, projection: Row,
    prepare: (row: Row) => Promise<{ filter: Row; update: Row }>,
  ) {
    const collection = db.collection(name);
    for await (const row of collection.find(query, { projection })) {
      const record = digest(String(row._id)).slice(0, 16);
      let outcome: Report['outcome'] = 'planned';
      let reason: string | undefined;
      if (options.apply) {
        try {
          const { filter, update } = await prepare(row);
          const result = await collection.updateOne({ _id: row._id, ...filter }, update);
          outcome = result.matchedCount === 1 ? 'migrated' : 'conflict';
          if (outcome === 'conflict') reason = 'Record changed during copy. Rerun the migration.';
        } catch (error) {
          outcome = 'failed';
          // Avoid printing AWS responses, private keys, credentials or file contents.
          reason = error instanceof Error && ['S3 copy verification failed', 'Unexpected legacy file type', 'Invalid inline image',
            'Unrecognized legacy avatar URL', 'Unexpected avatar file type', 'Invalid legacy object key',
            'Empty encrypted prescription', 'Prescription purge is in progress', 'Legacy file size does not match its record'].includes(error.message)
            ? error.message : 'Copy, storage access or database update failed.';
        }
      }
      totals[outcome] += 1;
      options.report({ collection: name, record, outcome, ...(reason ? { reason } : {}) });
    }
  }

  await scan('products', { image_keys: /^products\/(?!s3\/)/ }, { image_keys: 1 }, async (row) => {
    const imageKeys = row.image_keys as string[];
    const next: string[] = [];
    for (const key of imageKeys) next.push(oldKey(key, 'products') ? await copy('products', key) : key);
    return { filter: { image_keys: imageKeys }, update: { $set: { image_keys: next } } };
  });
  await scan('manufacturers', {
    $or: [{ logo_object_key: /^products\/(?!s3\/)/ }, { logo_object_key: { $exists: false }, logo_data_url: /^data:/ }],
  }, { logo_object_key: 1, logo_data_url: 1 }, async (row) => {
    const key = row.logo_object_key
      ? await copy('products', row.logo_object_key)
      : await copyInlineImage(storage, row.logo_data_url, 'products');
    return {
      filter: { logo_object_key: sameField(row.logo_object_key), logo_data_url: sameField(row.logo_data_url) },
      update: { $set: { logo_object_key: key }, $unset: { logo_data_url: 1 } },
    };
  });
  await scan('admins', {
    avatar_object_key: { $exists: false }, avatar_url: /^(?:data:|https:\/\/)/,
  }, { avatar_url: 1 }, async (row) => ({
    filter: { avatar_url: row.avatar_url, avatar_object_key: { $exists: false } },
    update: { $set: { avatar_object_key: await copyAvatar(storage, row.avatar_url, env, options.source) }, $unset: { avatar_url: 1 } },
  }));
  await scan('prescriptions', {
    r2_storage_key: { $type: 'string' }, object_key: { $exists: false }, purge_status: { $ne: 'PURGED' },
  }, { r2_storage_key: 1, purge_status: 1, next_retry_at: 1, file_size_bytes: 1 }, async (row) => {
    if (row.purge_status === 'DELETING' && row.next_retry_at instanceof Date && row.next_retry_at > new Date())
      throw new Error('Prescription purge is in progress');
    const key = await copyLegacyFile(storage, 'prescriptions', row.r2_storage_key, options.source, row.file_size_bytes);
    return {
      filter: {
        r2_storage_key: row.r2_storage_key, object_key: { $exists: false }, purge_status: row.purge_status,
        next_retry_at: sameField(row.next_retry_at),
      },
      update: {
        $set: { object_key: key, ...(row.purge_status === 'DELETING' ? { purge_status: 'PENDING' } : {}) },
        $unset: { r2_storage_key: 1 },
      },
    };
  });
  for (const variant of ['original', 'accepted'] as const) {
    const path = `pdf.${variant}`;
    const legacy = `${path}.r2_object_key`;
    const keyPath = `${path}.object_key`;
    await scan('quotation_versions', { [legacy]: { $type: 'string' }, [keyPath]: { $exists: false } }, { [path]: 1 }, async (row) => {
      const old = row.pdf[variant].r2_object_key as string;
      return {
        filter: { [legacy]: old, [keyPath]: { $exists: false } },
        update: { $set: { [keyPath]: await copy('quotes', old) }, $unset: { [legacy]: 1 } },
      };
    });
  }
  return totals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply', '--source=s3', '--source=r2'].includes(arg)) ||
      args.includes('--source=s3') && args.includes('--source=r2')) {
    process.stderr.write('Usage: npm run migrate:storage -- [--apply] [--source=r2|--source=s3]\n');
    process.exitCode = 1;
  } else {
    await runScript(async () => {
      const env = loadEnv();
      if (env.STORAGE_DRIVER !== 's3') throw new Error('This legacy migration targets S3. Local development does not require it.');
      const db = mongoose.connection.db;
      if (!db) throw new Error('Connect to MongoDB before migrating');
      const totals = await migrateStorageReferences(db, createStorageService(env), env, {
        apply: args.includes('--apply'),
        source: args.includes('--source=s3') ? 's3' : 'r2',
        report: (item) => process.stdout.write(JSON.stringify(item) + '\n'),
      });
      process.stdout.write(JSON.stringify({ totals }) + '\n');
      if (totals.failed || totals.conflict) process.exitCode = 1;
    });
  }
}
