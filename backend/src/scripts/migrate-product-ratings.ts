import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import validators from '../shared/persistence/validators.json' with { type: 'json' };
import { ProductRatingModel } from '../modules/catalog/product-rating.schema.js';
import { runScript } from './migrate.js';

/** Prepare only the new ratings collection; leave catalog and commercial records untouched. */
export async function migrateProductRatings(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connect to MongoDB before migrating ratings.');
  try { await db.createCollection('product_ratings'); }
  catch (error) { if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 48) throw error; }
  await db.command({ collMod: 'product_ratings', validator: { $jsonSchema: validators.product_ratings }, validationLevel: 'strict', validationAction: 'error' });
  for (const [keys, options] of ProductRatingModel.schema.indexes()) {
    await db.collection('product_ratings').createIndex(keys as mongoose.mongo.IndexSpecification, options as mongoose.mongo.CreateIndexesOptions);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runScript(migrateProductRatings);
