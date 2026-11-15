import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface ICustomer {
  _id: string;
  full_name: string;
  customer_type: 'B2B_WHOLESALE' | 'B2C_PATIENT';
  company_name?: string;
  email?: string;
  whatsapp_number?: string;
  wechat_id?: string;
  preferred_locale: 'en' | 'zh-CN';
  country: string;
  city?: string;
  created_at: Date;
  updated_at: Date;
}

export const CustomerSchema = new Schema<ICustomer>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    full_name: { type: String, required: true, trim: true, maxlength: 200 },
    customer_type: { type: String, required: true, trim: true, maxlength: 200, enum: ['B2B_WHOLESALE', 'B2C_PATIENT'] },
    company_name: { type: String, required: false, trim: true, maxlength: 200 },
    email: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      set: (value: string | undefined) => value?.trim().toLowerCase() || undefined,
    },
    whatsapp_number: { type: String, required: false, trim: true, maxlength: 50 },
    wechat_id: { type: String, required: false, trim: true, maxlength: 100 },
    preferred_locale: { type: String, required: true, trim: true, maxlength: 200, enum: ['en', 'zh-CN'] },
    country: { type: String, required: true, trim: true, maxlength: 2, match: new RegExp('^[A-Z]{2}$') },
    city: { type: String, required: false, trim: true, maxlength: 100 },
  },
  {
    collection: 'customers',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
CustomerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
CustomerSchema.index({ whatsapp_number: 1 }, {});
CustomerSchema.index({ wechat_id: 1 }, { partialFilterExpression: { wechat_id: { $type: 'string' } } });
installPersistenceGuards(CustomerSchema, 'customers');
export const CustomerModel = model<ICustomer>('Customer', CustomerSchema, 'customers');
