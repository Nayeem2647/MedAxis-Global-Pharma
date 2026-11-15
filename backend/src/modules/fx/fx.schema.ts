import { Schema, model, type Types } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface IExchangeRate {
  _id: 'USD' | 'CNY' | 'EUR';
  currency_code: 'USD' | 'CNY' | 'EUR';
  live_rate_to_bdt: Types.Decimal128;
  live_fetched_at: Date;
  manual_rate_to_bdt?: Types.Decimal128;
  mode: 'LIVE' | 'MANUAL_FIXED';
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
  active_mode?: 'LIVE' | 'MANUAL_FIXED';
}

export const ExchangeRateSchema = new Schema<IExchangeRate>(
  {
    _id: { type: String, required: true, trim: true, maxlength: 200, enum: ['USD', 'CNY', 'EUR'] },
    currency_code: { type: String, required: true, trim: true, maxlength: 200, enum: ['USD', 'CNY', 'EUR'] },
    live_rate_to_bdt: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    live_fetched_at: { type: Date, required: true },
    manual_rate_to_bdt: {
      type: Schema.Types.Decimal128,
      required: false,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    mode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['LIVE', 'MANUAL_FIXED'],
      alias: 'active_mode',
    },
    updated_by: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
  },
  {
    collection: 'exchange_rates',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
ExchangeRateSchema.index({ currency_code: 1 }, { unique: true });
installPersistenceGuards(ExchangeRateSchema, 'exchange_rates');
export const ExchangeRateModel = model<IExchangeRate>('ExchangeRate', ExchangeRateSchema, 'exchange_rates');
