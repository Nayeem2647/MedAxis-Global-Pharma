import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import validators from '../shared/persistence/validators.js';
import { persistenceModels } from '../shared/persistence/models.js';

/** Explicit, repeatable migration: never drops indexes or silently weakens validation. */
export async function migrate(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connect to MongoDB before migrating');
  for (const model of persistenceModels) {
    const name = model.collection.collectionName as keyof typeof validators;
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
  }
}

export async function runScript(work: () => Promise<void>): Promise<void> {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    await work();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Persistence script failed'}\n`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runScript(migrate);
