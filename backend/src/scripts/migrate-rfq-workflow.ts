import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import validators from '../shared/persistence/validators.js';
import { RfqModel } from '../modules/rfq/rfq.schema.js';
import { QuotationVersionModel } from '../modules/quotation/quotation.schema.js';
import { PrescriptionModel } from '../modules/storage/storage.schema.js';
import { runScript } from './migrate.js';

/** Additive schema/index rollout. Existing RFQs, offers and files are never rewritten. */
export async function migrateRfqWorkflow(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connect to MongoDB before migrating');
  for (const model of [RfqModel, QuotationVersionModel, PrescriptionModel]) {
    const name = model.collection.collectionName as 'rfqs' | 'quotation_versions' | 'prescriptions';
    try {
      await db.createCollection(name);
    } catch (error) {
      if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 48) throw error;
    }
    await db.command({
      collMod: name,
      validator: { $jsonSchema: validators[name] },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    for (const [keys, options] of model.schema.indexes())
      await db
        .collection(name)
        .createIndex(keys as mongoose.mongo.IndexSpecification, options as mongoose.mongo.CreateIndexesOptions);
    process.stdout.write(`Updated ${name} workflow schema and indexes.\n`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runScript(migrateRfqWorkflow);
