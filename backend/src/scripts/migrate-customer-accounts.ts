import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import {
  CustomerAccountModel,
  CustomerSessionModel,
  CustomerDraftModel,
  CustomerEventModel,
} from '../modules/customer/account.schema.js';
import { customerAccountValidators } from '../modules/customer/account.validators.js';
import { runScript } from './migrate.js';

/** Add only customer-account collections and indexes; preserve existing customer/RFQ records. */
export async function migrateCustomerAccounts() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connect to MongoDB before migrating');
  for (const model of [CustomerAccountModel, CustomerSessionModel, CustomerDraftModel, CustomerEventModel]) {
    const name = model.collection.collectionName as keyof typeof customerAccountValidators;
    try {
      await db.createCollection(name);
    } catch (error) {
      if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 48) throw error;
    }
    await db.command({
      collMod: name,
      validator: { $jsonSchema: customerAccountValidators[name] },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    for (const [keys, options] of model.schema.indexes())
      await db
        .collection(name)
        .createIndex(keys as mongoose.mongo.IndexSpecification, options as mongoose.mongo.CreateIndexesOptions);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runScript(migrateCustomerAccounts);
