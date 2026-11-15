import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Types } from 'mongoose';
import { AdminModel } from '../modules/auth/auth.schema.js';
import { ManufacturerModel, GenericModel, CategoryModel, ProductModel } from '../modules/catalog/catalog.schema.js';
import { ExchangeRateModel } from '../modules/fx/fx.schema.js';
import { PlatformSettingModel } from '../modules/settings/settings.schema.js';
import { runScript } from './migrate.js';
import { encrypt, hashPassword } from '../shared/utils/crypto.js';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value?.trim()) throw new Error(`${key} is required to bootstrap the admin`);
  return value;
};

/** Insert-only defaults: reruns never overwrite credentials, bank details or edited catalog. */
export async function seed(): Promise<void> {
  let admin = await AdminModel.findOne({ singleton_key: 'SUPER_ADMIN' });
  if (!admin) {
    const email = required('SEED_ADMIN_EMAIL').trim().toLowerCase();
    const password = required('SEED_ADMIN_PASSWORD');
    if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must contain at least 12 characters');
    const secret = required('SEED_ADMIN_TOTP_SECRET');
    if (!/^[A-Z2-7]{16,}$/.test(secret)) throw new Error('SEED_ADMIN_TOTP_SECRET must be a base32 TOTP secret');
    const key = Buffer.from(required('SEED_TOTP_ENCRYPTION_KEY_BASE64'), 'base64');
    if (key.length !== 32) throw new Error('TOTP encryption key must decode to 32 bytes');
    const keyId = required('SEED_TOTP_KEY_ID');
    const backupCodes: unknown = JSON.parse(required('SEED_ADMIN_BACKUP_CODE_HASHES'));
    if (
      !Array.isArray(backupCodes) ||
      backupCodes.length < 1 ||
      backupCodes.length > 20 ||
      !backupCodes.every((v) => typeof v === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(v))
    )
      throw new Error('Provide a JSON array of bcrypt backup-code hashes');
    const candidate = new AdminModel({
      _id: randomUUID(),
      singleton_key: 'SUPER_ADMIN',
      email,
      password_hash: await hashPassword(password),
      totp_secret_encrypted: JSON.stringify(encrypt(secret, key, keyId)),
      backup_code_hashes: backupCodes,
      is_active: true,
      session_generation: 0,
    });
    await candidate.validate();
    admin = await AdminModel.findOneAndUpdate(
      { singleton_key: 'SUPER_ADMIN' },
      { $setOnInsert: candidate.toObject() },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
  }
  if (!admin) throw new Error('Admin bootstrap did not return an account');
  const updated_by = admin._id;
  const defaults: Record<string, Record<string, unknown>> = {
    packaging_units: { units: ['BOX', 'BOTTLE', 'VIAL', 'PACK', 'STRIP'] },
    wire_instructions: {
      configured: false,
      instructions: 'Configure and verify bank wire details before issuing quotations.',
    },
    payment_presets: {
      terms: ['BANK_WIRE_TT'],
      quote_validity_days: 7,
      reservation_days: 5,
      business_timezone: 'Asia/Dhaka',
    },
    shipping_presets: {
      methods: ['INCOTERM', 'EXPRESS_COURIER'],
      incoterms: ['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF'],
    },
    monetary_policy: {
      final_amount_decimal_places: 2,
      rounding: 'ROUND_HALF_UP',
      fx_precision: 'preserve source precision',
    },
  };
  for (const [key, value] of Object.entries(defaults))
    await PlatformSettingModel.updateOne(
      { key },
      { $setOnInsert: { _id: randomUUID(), key, value, updated_by } },
      { upsert: true, runValidators: true },
    );

  // Synthetic initial rates, deliberately stale. Fetch/verify live rates before issuance.
  const rates = { USD: '120', CNY: '16', EUR: '130' } as const;
  for (const currency_code of ['USD', 'CNY', 'EUR'] as const) {
    const value = rates[currency_code];
    await ExchangeRateModel.updateOne(
      { _id: currency_code },
      {
        $setOnInsert: {
          _id: currency_code,
          currency_code,
          live_rate_to_bdt: Types.Decimal128.fromString(value),
          live_fetched_at: new Date(0),
          mode: 'LIVE',
          updated_by,
        },
      },
      { upsert: true, runValidators: true },
    );
  }

  const manufacturerId = '00000000-0000-4000-8000-000000000001';
  const genericId = '00000000-0000-4000-8000-000000000002';
  const categoryId = '00000000-0000-4000-8000-000000000003';
  const productId = '00000000-0000-4000-8000-000000000004';
  await ManufacturerModel.updateOne(
    { _id: manufacturerId },
    {
      $setOnInsert: {
        _id: manufacturerId,
        translations: { en: { name: 'Demo Manufacturer', slug: 'demo-manufacturer' } },
        country: 'BD',
        certifications: [],
        is_active: true,
      },
    },
    { upsert: true, runValidators: true },
  );
  await GenericModel.updateOne(
    { _id: genericId },
    {
      $setOnInsert: {
        _id: genericId,
        translations: { en: { name: 'Demo Ingredient', slug: 'demo-ingredient' } },
        therapeutic_indications: [],
        is_active: true,
      },
    },
    { upsert: true, runValidators: true },
  );
  await CategoryModel.updateOne(
    { _id: categoryId },
    {
      $setOnInsert: {
        _id: categoryId,
        translations: { en: { name: 'Demo Category', slug: 'demo-category' } },
        sort_order: 1,
        is_active: true,
      },
    },
    { upsert: true, runValidators: true },
  );
  await ProductModel.updateOne(
    { _id: productId },
    {
      $setOnInsert: {
        _id: productId,
        sku: 'DEMO-001',
        manufacturer_id: manufacturerId,
        generic_id: genericId,
        category_ids: [categoryId],
        translations: { en: { brand_name: 'Demo Medicine', slug: 'demo-medicine' } },
        brand_name: 'Demo Medicine',
        generic_name: 'Demo Ingredient',
        manufacturer: 'Demo Manufacturer',
        strength: 'Demo strength',
        dosage_form: 'Tablet',
        pack_size: '10 tablets',
        packaging_unit: 'BOX',
        cold_chain_required: false,
        storage_condition: 'Demo storage instructions',
        image_keys: [],
        status: 'DRAFT',
      },
    },
    { upsert: true, runValidators: true },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runScript(seed);
