import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { persistenceModels } from '../src/shared/persistence/models.js';
import validators from '../src/shared/persistence/validators.json' with { type: 'json' };
import searchIndex from '../src/scripts/atlas-search-index.json' with { type: 'json' };
import { ProductModel } from '../src/modules/catalog/catalog.schema.js';
import { CustomerModel } from '../src/modules/customer/customer.schema.js';
import { RfqModel, RfqIdempotencyKeyModel } from '../src/modules/rfq/rfq.schema.js';
import { PrescriptionModel } from '../src/modules/storage/storage.schema.js';
import { migrate } from '../src/scripts/migrate.js';
import { seed } from '../src/scripts/seed.js';
import { AdminModel } from '../src/modules/auth/auth.schema.js';
import { QuotationVersionModel, QuotationInternalCostModel } from '../src/modules/quotation/quotation.schema.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import { ExchangeRateModel } from '../src/modules/fx/fx.schema.js';
import { NotificationLogModel } from '../src/modules/notification/notification.schema.js';

const contact = {
  full_name: 'Buyer',
  customer_type: 'B2C_PATIENT',
  email: 'buyer@example.test',
  preferred_locale: 'en',
};
const line = () => ({
  _id: randomUUID(),
  rfq_item_id: randomUUID(),
  manufacturer_id: randomUUID(),
  brand_name_snapshot: 'Demo',
  generic_name_snapshot: 'Demo',
  strength_snapshot: 'Demo',
  dosage_form_snapshot: 'Demo',
  pack_size_snapshot: 'Demo',
  packaging_unit: 'BOX',
  quantity: 1,
  availability_status: 'AVAILABLE',
  unit_quoted_price: '10.00',
  total_line_price: '10.00',
});
const draft = () =>
  new QuotationVersionModel({
    quotation_id: randomUUID(),
    version_number: 1,
    status: 'DRAFT',
    contact_snapshot: contact,
    items: [line()],
    billing_currency: 'USD',
    subtotal_amount: '10.00',
    freight_cost: '0',
    insurance_cost: '0',
    total_amount: '10.00',
    shipping_terms: { method: 'EXPRESS_COURIER', named_place: 'Dhaka', cold_chain_required: false },
    payment_terms: 'BANK_WIRE_TT',
    reservation_status: 'NONE',
  });
const mockPrevious = (model: typeof QuotationVersionModel, previous: Record<string, unknown>) => {
  vi.spyOn(model, 'findOne').mockReturnValue({ session: () => ({ lean: async () => previous }) } as never);
};
afterEach(() => vi.restoreAllMocks());

describe('persistence contracts', () => {
  it('loads the Argon2 bootstrap implementation and refuses missing credentials before writes', async () => {
    vi.spyOn(AdminModel, 'findOne').mockResolvedValue(null);
    const before = process.env.SEED_ADMIN_EMAIL;
    delete process.env.SEED_ADMIN_EMAIL;
    try {
      await expect(seed()).rejects.toThrow('SEED_ADMIN_EMAIL');
    } finally {
      if (before !== undefined) process.env.SEED_ADMIN_EMAIL = before;
    }
  });

  it('defaults idempotency expiry to 24 hours and accepts only private prescription keys', async () => {
    const before = Date.now();
    const key = new RfqIdempotencyKeyModel();
    expect(key.expires_at.getTime()).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(key.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
    const prescription = new PrescriptionModel({
      rfq_id: randomUUID(),
      customer_id: randomUUID(),
      r2_storage_key: 'https://public.example.test/prescription.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1024,
      uploaded_at: new Date(),
      purge_scheduled_at: new Date(),
    });
    await expect(prescription.validate()).rejects.toThrow('r2_storage_key');
    prescription.r2_storage_key = 'prescriptions/private/object';
    prescription.encryption = { algorithm: 'aes-256-gcm', key_id: 'medical-v1', iv: 'nonce', auth_tag: 'tag' };
    await expect(prescription.validate()).resolves.toBeUndefined();
    prescription.file_size_bytes = 5_242_881;
    await expect(prescription.validate()).rejects.toThrow('file_size_bytes');
  });

  it('reapplies all validators and exact indexes after collections already exist', async () => {
    const createIndex = vi.fn().mockResolvedValue('index');
    const createCollection = vi
      .fn()
      .mockRejectedValue(new mongoose.mongo.MongoServerError({ message: 'exists', code: 48 }));
    const command = vi.fn().mockResolvedValue({ ok: 1 });
    const collection = vi.fn().mockReturnValue({ createIndex });
    const previousDb = mongoose.connection.db;
    Reflect.set(mongoose.connection, 'db', { createCollection, command, collection });
    try {
      await migrate();
      await migrate();
      expect(command).toHaveBeenCalledTimes(42);
      const indexCount = persistenceModels.reduce((sum, model) => sum + model.schema.indexes().length, 0);
      expect(createIndex).toHaveBeenCalledTimes(indexCount * 2);
      for (const [value] of command.mock.calls)
        expect(value).toEqual({
          collMod: expect.any(String),
          validator: { $jsonSchema: expect.any(Object) },
          validationLevel: 'strict',
          validationAction: 'error',
        });
    } finally {
      Reflect.set(mongoose.connection, 'db', previousDb);
    }
  });
  it('registers exactly 21 explicitly named UUID collections and complete strict validators', () => {
    expect(persistenceModels).toHaveLength(21);
    expect(new Set(persistenceModels.map((m) => m.collection.name)).size).toBe(21);
    for (const model of persistenceModels) {
      expect(model.schema.options.autoIndex).toBe(false);
      expect(model.schema.options.strict).toBe('throw');
      expect(model.schema.paths._id!.instance).toBe('String');
      const validator = validators[model.collection.name as keyof typeof validators];
      expect(validator.additionalProperties).toBe(false);
      for (const field of Object.keys(model.schema.paths)) expect(validator.properties).toHaveProperty(field);
    }
  });

  it('normalizes optional customer email and validates contact and B2B requirements', async () => {
    const buyer = new CustomerModel({ ...contact, email: ' Buyer@Example.Test ', country: 'BD' });
    await expect(buyer.validate()).resolves.toBeUndefined();
    expect(buyer.email).toBe('buyer@example.test');
    buyer.email = undefined;
    await expect(buyer.validate()).rejects.toThrow('contact channel');
    buyer.wechat_id = 'buyer';
    buyer.customer_type = 'B2B_WHOLESALE';
    await expect(buyer.validate()).rejects.toThrow('company name');
    expect(() => new CustomerModel({ ...contact, password_hash: 'forbidden' })).toThrow();
  });

  it('rejects public catalog prices and invalid reference UUIDs', async () => {
    expect(() => new ProductModel({ price: '10' })).toThrow();
    const product = new ProductModel({
      sku: 'X',
      manufacturer_id: 'not-uuid',
      generic_id: randomUUID(),
      category_ids: [randomUUID()],
      translations: { en: { brand_name: 'Demo', slug: 'demo' } },
      strength: 'X',
      dosage_form: 'Tablet',
      pack_size: '10',
      packaging_unit: 'BOX',
      cold_chain_required: false,
      image_keys: [],
    });
    await expect(product.validate()).rejects.toThrow('manufacturer_id');
  });

  it('bounds RFQ lines and validates catalogued/uncatalogued alternatives', async () => {
    const rfq = new RfqModel({
      rfq_number: 'RFQ-1',
      customer_id: randomUUID(),
      inquiry_type: 'CART_RFQ',
      contact_snapshot: contact,
      destination_country: 'BD',
      preferred_currency: 'USD',
      items: [],
    });
    await expect(rfq.validate()).rejects.toThrow('Array length');
    rfq.items = [
      {
        _id: randomUUID(),
        is_uncatalogued: true,
        quantity: 1,
        packaging_unit: 'BOX',
        item_availability_status: 'SOURCING',
      },
    ];
    await expect(rfq.validate()).rejects.toThrow('custom medicine');
    rfq.items[0]!.custom_medicine_name = 'Demo';
    await expect(rfq.validate()).resolves.toBeUndefined();
    rfq.items = Array.from({ length: 101 }, () => ({ ...rfq.items[0]!, _id: randomUUID() }));
    await expect(rfq.validate()).rejects.toThrow();
  });

  it('uses decimal money and requires payable prices and issuance snapshots', async () => {
    const version = draft();
    await expect(version.validate()).resolves.toBeUndefined();
    expect(version.total_amount).toBeInstanceOf(Types.Decimal128);
    version.items[0]!.unit_quoted_price = undefined;
    await expect(version.validate()).rejects.toThrow('require prices');
    version.items[0]!.unit_quoted_price = Types.Decimal128.fromString('10');
    version.status = 'SENT';
    await expect(version.validate()).rejects.toThrow('issuance');
  });

  it('offers requested naming aliases without duplicate stored values', () => {
    const fx = new ExchangeRateModel({ _id: 'USD', currency_code: 'USD', active_mode: 'LIVE' });
    expect(fx.mode).toBe('LIVE');
    const job = new NotificationLogModel({ retry_count: 2 });
    expect(job.attempt_count).toBe(2);
    expect(job.toObject()).not.toHaveProperty('retry_count');
    const version = draft();
    version.locked_fx_rates = {
      mode: 'LIVE',
      captured_at: new Date(),
      rates_to_bdt: {
        USD: Types.Decimal128.fromString('120'),
        CNY: Types.Decimal128.fromString('16'),
        EUR: Types.Decimal128.fromString('130'),
      },
    };
    expect(version.fx_snapshot?.rates_to_bdt.USD.toString()).toBe('120');
  });

  it('defines exact partial unique and TTL cleanup indexes', () => {
    const indexes = Object.fromEntries(persistenceModels.map((m) => [m.collection.name, m.schema.indexes()]));
    expect(indexes.customers).toContainEqual([
      { email: 1 },
      { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
    ]);
    expect(indexes.quotations).toContainEqual([
      { rfq_id: 1 },
      { unique: true, partialFilterExpression: { overall_status: 'ACTIVE' } },
    ]);
    for (const name of ['rfq_idempotency_keys', 'admin_sessions', 'auth_attempts'])
      expect(indexes[name]).toContainEqual([{ expires_at: 1 }, { expireAfterSeconds: 0 }]);
    const totalTtl = Object.values(indexes)
      .flat()
      .filter(([, options]) => options.expireAfterSeconds !== undefined);
    expect(totalTtl).toHaveLength(3);
    expect(searchIndex.definition.mappings.dynamic).toBe(false);
    expect(JSON.stringify(searchIndex)).not.toMatch(/procurement|markup|total_amount|payment|magic_link/);
  });
});

describe('snapshot and append-only guards (before database dispatch)', () => {
  it('blocks audit mutation, deletion, replacement and bulk writes', async () => {
    await expect(AuditLogModel.updateOne({}, { $set: { action_type: 'edited' } })).rejects.toThrow('append-only');
    await expect(AuditLogModel.findOneAndUpdate({}, { $set: { action_type: 'edited' } })).rejects.toThrow(
      'append-only',
    );
    await expect(AuditLogModel.deleteMany({})).rejects.toThrow('append-only');
    await expect(AuditLogModel.replaceOne({}, {})).rejects.toThrow('append-only');
    await expect(AuditLogModel.bulkWrite([{ deleteOne: { filter: {} } }])).rejects.toThrow('append-only');
    const doc = new AuditLogModel();
    await expect(doc.deleteOne()).rejects.toThrow('append-only');
  });

  it('blocks financial edits and FX edits including nested and rename paths', async () => {
    mockPrevious(QuotationVersionModel, { status: 'SENT', fx_snapshot: { mode: 'LIVE' } });
    await expect(QuotationVersionModel.findOneAndUpdate({}, { $set: { total_amount: '12' } })).rejects.toThrow(
      'immutable',
    );
    await expect(
      QuotationVersionModel.updateOne({}, { $set: { 'fx_snapshot.rates_to_bdt.USD': '121' } }),
    ).rejects.toThrow('immutable');
    await expect(QuotationVersionModel.updateOne({}, { $rename: { total_amount: 'other' } })).rejects.toThrow(
      'immutable',
    );
    await expect(QuotationVersionModel.updateOne({}, { $set: { status: 'DRAFT' } })).rejects.toThrow('return to DRAFT');
    await expect(QuotationVersionModel.updateMany({}, { $set: { total_amount: '0' } })).rejects.toThrow(
      'individual snapshot',
    );
    await expect(
      QuotationVersionModel.updateOne({}, [{ $set: { total_amount: '0' } }], { updatePipeline: true }),
    ).rejects.toThrow('pipelines');
  });

  it('blocks FX changes even in a persisted draft', async () => {
    mockPrevious(QuotationVersionModel, { status: 'DRAFT', fx_snapshot: { mode: 'LIVE' } });
    await expect(QuotationVersionModel.updateOne({}, { $unset: { fx_snapshot: 1 } })).rejects.toThrow('Locked FX');
    await expect(QuotationVersionModel.deleteOne({})).rejects.toThrow('cannot be deleted');
  });

  it('runs save guards on hydrated issued versions and audit records', async () => {
    mockPrevious(QuotationVersionModel, { status: 'SENT', fx_snapshot: { mode: 'LIVE' } });
    const version = QuotationVersionModel.hydrate({ ...draft().toObject(), status: 'SENT' });
    version.total_amount = Types.Decimal128.fromString('11');
    await expect(version.save()).rejects.toThrow('Issued financial fields');
    const audit = AuditLogModel.hydrate({
      _id: randomUUID(),
      actor_type: 'SYSTEM',
      action_type: 'CREATED',
      entity_type: 'rfq',
      entity_id: randomUUID(),
      created_at: new Date(),
    });
    audit.action_type = 'CHANGED';
    await expect(audit.save()).rejects.toThrow('append-only');
  });

  it('requires a transaction for cost writes and forbids cost deletion', async () => {
    vi.spyOn(QuotationInternalCostModel, 'findOne').mockReturnValue({
      session: () => ({ lean: async () => ({ quotation_version_id: randomUUID() }) }),
    } as never);
    await expect(
      QuotationInternalCostModel.findOneAndUpdate({}, { $set: { procurement_cost_bdt: '1' } }),
    ).rejects.toThrow('transaction');
    await expect(QuotationInternalCostModel.deleteMany({})).rejects.toThrow('cannot be deleted');
    await expect(
      RfqModel.updateOne({}, { $set: { 'contact_snapshot.email': 'changed@example.test' } }),
    ).rejects.toThrow('immutable');
  });
});
