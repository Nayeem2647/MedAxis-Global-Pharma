import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { detectTransactionSupport } from '../src/config/db.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import { QuotationVersionModel } from '../src/modules/quotation/quotation.schema.js';
import type { IRfq } from '../src/modules/rfq/rfq.schema.js';
import { migrate } from '../src/scripts/migrate.js';
import { persistenceModels } from '../src/shared/persistence/models.js';
import validators from '../src/shared/persistence/validators.json' with { type: 'json' };
import { rfqRecord } from './fixtures/rfq.js';

// Allow malformed status values deliberately: these writes must reach server validation.
const rfqs = () => mongoose.connection.db!.collection<Omit<IRfq, 'status'> & { status: unknown }>('rfqs');
const databaseName = `persistence_test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_TEST_URI or MONGODB_URI to an Atlas / replica-set database');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10_000,
  });
  if (!(await detectTransactionSupport()).supported) throw new Error('Database tests require a replica set or mongos');
  // Exercise first application and repeat application against the actual server.
  await migrate();
  await migrate();
});

afterAll(async () => {
  if (mongoose.connection.name === databaseName && databaseName.startsWith('persistence_test_'))
    await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
});

it('installs all 21 strict/error validators and declared indexes idempotently', async () => {
  const db = mongoose.connection.db!;
  const collections = await db.listCollections({}, { nameOnly: false }).toArray();
  expect(persistenceModels).toHaveLength(21);
  for (const model of persistenceModels) {
    const name = model.collection.name as keyof typeof validators;
    const info = collections.find((collection) => collection.name === name);
    expect(info?.options).toMatchObject({
      validator: { $jsonSchema: validators[name] },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    const indexes = await db.collection(name).listIndexes().toArray();
    for (const [keys, options] of model.schema.indexes()) {
      const index = indexes.find((entry) => JSON.stringify(entry.key) === JSON.stringify(keys));
      expect(index, `${name}: ${JSON.stringify(keys)}`).toBeDefined();
      for (const option of ['unique', 'partialFilterExpression', 'expireAfterSeconds'] as const)
        if (options[option] !== undefined) expect(index![option]).toEqual(options[option]);
    }
  }
});

describe('database writes (always rolled back)', () => {
  let session: ClientSession;
  beforeEach(async () => {
    session = await mongoose.startSession();
    session.startTransaction();
  });
  afterEach(async () => {
    try {
      if (session?.inTransaction()) await session.abortTransaction();
    } finally {
      await session?.endSession();
    }
  });

  it('accepts a valid RFQ directly through the native driver', async () => {
    await expect(rfqs().insertOne(rfqRecord(), { session })).resolves.toMatchObject({ acknowledged: true });
  });

  it('rejects an invalid RFQ status without Mongoose validation', async () => {
    const record = { ...rfqRecord(), status: 'INVALID' };
    await expect(rfqs().insertOne(record, { session })).rejects.toMatchObject({ code: 121 });
  });

  it.each([0, -1, 0.5])('rejects RFQ quantity %s without Mongoose validation', async (quantity) => {
    const record = rfqRecord();
    record.items[0]!.quantity = quantity;
    await expect(rfqs().insertOne(record, { session })).rejects.toMatchObject({ code: 121 });
  });

  it('rejects an invalid post-insert RFQ status through strict validation', async () => {
    const record = rfqRecord();
    await rfqs().insertOne(record, { session });
    await expect(
      rfqs().updateOne({ _id: record._id }, { $set: { status: 'INVALID' } }, { session }),
    ).rejects.toMatchObject({ code: 121 });
  });

  it('rejects a post-insert quantity below one through strict validation', async () => {
    const record = rfqRecord();
    await rfqs().insertOne(record, { session });
    await expect(
      rfqs().updateOne({ _id: record._id }, { $set: { 'items.0.quantity': 0 } }, { session }),
    ).rejects.toMatchObject({ code: 121 });
  });

  it('blocks edits to locked_fx_rates after saving, including alias and nested query paths', async () => {
    const version = new QuotationVersionModel({
      quotation_id: randomUUID(),
      version_number: 1,
      status: 'DRAFT',
      contact_snapshot: rfqRecord().contact_snapshot,
      items: [
        {
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
          unit_quoted_price: '10',
          total_line_price: '10',
        },
      ],
      billing_currency: 'USD',
      subtotal_amount: '10',
      freight_cost: '0',
      insurance_cost: '0',
      total_amount: '10',
      shipping_terms: { method: 'EXPRESS_COURIER', named_place: 'Dhaka', cold_chain_required: false },
      payment_terms: 'BANK_WIRE_TT',
      locked_fx_rates: { mode: 'LIVE', captured_at: new Date(), rates_to_bdt: { USD: '120', CNY: '16', EUR: '130' } },
    });
    await version.save({ session });
    version.locked_fx_rates!.rates_to_bdt.USD = mongoose.Types.Decimal128.fromString('121');
    await expect(version.save({ session })).rejects.toThrow('Locked FX rates are immutable');
    await expect(
      QuotationVersionModel.findOneAndUpdate(
        { _id: version._id },
        { $set: { 'fx_snapshot.rates_to_bdt.USD': '121' } },
        { session },
      ),
    ).rejects.toThrow('Locked FX rates are immutable');
    await expect(
      QuotationVersionModel.updateOne({ _id: version._id }, { $unset: { locked_fx_rates: 1 } }, { session }),
    ).rejects.toThrow('canonical fx_snapshot');
    const stored = await QuotationVersionModel.findById(version._id).session(session).lean();
    expect(stored!.fx_snapshot!.rates_to_bdt.USD.toString()).toBe('120');
  });

  it('blocks edits and deletions of a saved audit entry', async () => {
    const audit = new AuditLogModel({
      actor_type: 'SYSTEM',
      action_type: 'TEST_CREATED',
      entity_type: 'rfq',
      entity_id: randomUUID(),
    });
    await audit.save({ session });
    audit.action_type = 'EDITED';
    await expect(audit.save({ session })).rejects.toThrow('append-only');
    await expect(
      AuditLogModel.findOneAndUpdate({ _id: audit._id }, { $set: { action_type: 'EDITED' } }, { session }),
    ).rejects.toThrow('append-only');
    await expect(audit.deleteOne({ session })).rejects.toThrow('append-only');
    const stored = await AuditLogModel.findById(audit._id).session(session).lean();
    expect(stored!.action_type).toBe('TEST_CREATED');
  });
});
