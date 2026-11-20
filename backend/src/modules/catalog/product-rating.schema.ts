import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface IProductRating {
  _id: string;
  product_id: string;
  visitor_hash: string;
  score: number;
  created_at: Date;
  updated_at: Date;
}

const schema = new Schema<IProductRating>({
  _id: { type: String, default: () => randomUUID() },
  product_id: { type: String, required: true },
  visitor_hash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  score: { type: Number, required: true, min: 1, max: 5, validate: { validator: (value: number) => Number.isInteger(value) } },
}, { collection: 'product_ratings', strict: 'throw', autoIndex: false, autoCreate: false, versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
schema.index({ product_id: 1, visitor_hash: 1 }, { unique: true });
installPersistenceGuards(schema, 'product_ratings');
export const ProductRatingModel = model<IProductRating>('ProductRating', schema);
