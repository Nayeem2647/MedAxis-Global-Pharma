import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';
import type { RfqWorkflow } from './rfq.workflow.types.js';

export interface IRfq {
  workflow?: RfqWorkflow;
  guest_token_hash?: string;
  guest_delivery?: Record<string, unknown>;
  guest_expires_at?: Date;
  guest_revoked_at?: Date;
  _id: string;
  rfq_number: string;
  customer_id: string;
  inquiry_type: 'QUICK_QUOTE' | 'CART_RFQ';
  contact_snapshot: {
    full_name: string;
    customer_type: 'B2B_WHOLESALE' | 'B2C_PATIENT';
    company_name?: string;
    email?: string;
    whatsapp_number?: string;
    wechat_id?: string;
    preferred_locale: 'en' | 'zh-CN';
  };
  destination_country: string;
  destination_city_port?: string;
  preferred_currency: 'USD' | 'CNY' | 'EUR' | 'BDT';
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'NEED_CLARIFICATION' | 'QUOTED' | 'CONVERTED' | 'CLOSED' | 'CANCELLED';
  has_prescription: boolean;
  close_reason?: string;
  unable_to_supply_reason?: string;
  closed_at?: Date;
  terminal_at?: Date;
  items: Array<{
    _id: string;
    product_id?: string;
    is_uncatalogued: boolean;
    product_snapshot?: { brand_name?: string; pack_size?: string };
    custom_medicine_name?: string;
    custom_strength?: string;
    quantity: number;
    packaging_unit: string;
    item_availability_status: 'AVAILABLE' | 'UNAVAILABLE' | 'SOURCING';
    customer_facing_note?: string;
    internal_note?: string;
    line_notes?: string;
  }>;
  created_at: Date;
  updated_at: Date;
}

export const RfqSchema = new Schema<IRfq>(
  {
    workflow: { type: Schema.Types.Mixed },
    guest_token_hash: { type: String, select: false, match: /^[a-f0-9]{64}$/ },
    guest_delivery: { type: Schema.Types.Mixed, select: false },
    guest_expires_at: Date,
    guest_revoked_at: Date,
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    rfq_number: { type: String, required: true, trim: true, maxlength: 200 },
    customer_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    inquiry_type: { type: String, required: true, trim: true, maxlength: 200, enum: ['QUICK_QUOTE', 'CART_RFQ'] },
    contact_snapshot: {
      type: new Schema(
        {
          full_name: { type: String, required: true, trim: true, maxlength: 200 },
          customer_type: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
            enum: ['B2B_WHOLESALE', 'B2C_PATIENT'],
          },
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
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
      immutable: true,
    },
    destination_country: { type: String, required: true, trim: true, maxlength: 2, match: new RegExp('^[A-Z]{2}$') },
    destination_city_port: { type: String, required: false, trim: true, maxlength: 200 },
    preferred_currency: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['USD', 'CNY', 'EUR', 'BDT'],
    },
    status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['SUBMITTED', 'UNDER_REVIEW', 'NEED_CLARIFICATION', 'QUOTED', 'CONVERTED', 'CLOSED', 'CANCELLED'],
      default: 'SUBMITTED',
    },
    has_prescription: { type: Boolean, required: true, default: false },
    close_reason: { type: String, required: false, trim: true, maxlength: 200 },
    unable_to_supply_reason: { type: String, trim: true, maxlength: 2000 },
    closed_at: { type: Date, required: false },
    terminal_at: { type: Date, required: false },
    items: {
      type: [
        {
          type: new Schema(
            {
              _id: {
                type: String,
                required: true,
                default: () => randomUUID(),
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              product_id: {
                type: String,
                required: false,
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              is_uncatalogued: { type: Boolean, required: true },
              product_snapshot: {
                type: new Schema(
                  {
                    brand_name: { type: String, required: false, trim: true, maxlength: 200 },
                    pack_size: { type: String, required: false, trim: true, maxlength: 200 },
                  },
                  { _id: false, strict: 'throw' },
                ),
                required: false,
              },
              custom_medicine_name: { type: String, required: false, trim: true, maxlength: 200 },
              custom_strength: { type: String, required: false, trim: true, maxlength: 100 },
              quantity: { type: Number, required: true, validate: Number.isSafeInteger, min: 1 },
              packaging_unit: { type: String, required: true, trim: true, maxlength: 40 },
              item_availability_status: {
                type: String,
                required: true,
                trim: true,
                maxlength: 200,
                enum: ['AVAILABLE', 'UNAVAILABLE', 'SOURCING'],
                default: 'SOURCING',
              },
              customer_facing_note: { type: String, required: false, trim: true, maxlength: 2000 },
              internal_note: { type: String, required: false, trim: true, maxlength: 2000, select: false },
              line_notes: { type: String, required: false, trim: true, maxlength: 2000 },
            },
            { _id: false, strict: 'throw' },
          ),
          required: true,
        },
      ],
      required: true,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 1 && v.length <= 100,
        message: 'Array length outside contract bounds',
      },
    },
  },
  {
    collection: 'rfqs',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
RfqSchema.index({ rfq_number: 1 }, { unique: true });
RfqSchema.index({ guest_token_hash: 1 }, { unique: true, partialFilterExpression: { guest_token_hash: { $type: 'string' } } });
RfqSchema.index({ customer_id: 1, created_at: -1 }, {});
RfqSchema.index({ status: 1, created_at: -1 }, {});
installPersistenceGuards(RfqSchema, 'rfqs');
export const RfqModel = model<IRfq>('Rfq', RfqSchema, 'rfqs');

export interface IRfqIdempotencyKey {
  _id: string;
  key: string;
  request_hash: string;
  rfq_id: string;
  response_snapshot: Record<string, unknown>;
  expires_at: Date;
  created_at: Date;
}

export const RfqIdempotencyKeySchema = new Schema<IRfqIdempotencyKey>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    key: { type: String, required: true, trim: true, maxlength: 200 },
    request_hash: { type: String, required: true, trim: true, maxlength: 200 },
    rfq_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    response_snapshot: { type: Schema.Types.Mixed, required: true },
    expires_at: { type: Date, required: true, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  },
  {
    collection: 'rfq_idempotency_keys',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: false },
  },
);
RfqIdempotencyKeySchema.index({ key: 1 }, { unique: true });
RfqIdempotencyKeySchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
installPersistenceGuards(RfqIdempotencyKeySchema, 'rfq_idempotency_keys');
export const RfqIdempotencyKeyModel = model<IRfqIdempotencyKey>(
  'RfqIdempotencyKey',
  RfqIdempotencyKeySchema,
  'rfq_idempotency_keys',
);

export interface IClarificationMessage {
  _id: string;
  rfq_id: string;
  customer_id: string;
  thread_id: string;
  direction: 'ADMIN_TO_BUYER' | 'BUYER_TO_ADMIN' | 'INTERNAL_NOTE';
  channel: 'EMAIL' | 'WHATSAPP' | 'WECHAT' | 'ADMIN';
  body: string;
  status: 'PENDING_BUYER' | 'REPLIED' | 'RESOLVED';
  provider_event_id?: string;
  reply_to_id?: string;
  actor_id?: string;
  created_at: Date;
  updated_at: Date;
}

export const ClarificationMessageSchema = new Schema<IClarificationMessage>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    rfq_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    customer_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    thread_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    direction: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['ADMIN_TO_BUYER', 'BUYER_TO_ADMIN', 'INTERNAL_NOTE'],
    },
    channel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['EMAIL', 'WHATSAPP', 'WECHAT', 'ADMIN'],
    },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['PENDING_BUYER', 'REPLIED', 'RESOLVED'],
    },
    provider_event_id: { type: String, required: false, trim: true, maxlength: 200 },
    reply_to_id: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    actor_id: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
  },
  {
    collection: 'clarification_messages',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
ClarificationMessageSchema.index({ rfq_id: 1, created_at: -1 }, {});
ClarificationMessageSchema.index({ customer_id: 1, created_at: -1 }, {});
ClarificationMessageSchema.index({ thread_id: 1, created_at: 1 }, {});
ClarificationMessageSchema.index(
  { provider_event_id: 1 },
  { unique: true, partialFilterExpression: { provider_event_id: { $type: 'string' } } },
);
installPersistenceGuards(ClarificationMessageSchema, 'clarification_messages');
export const ClarificationMessageModel = model<IClarificationMessage>(
  'ClarificationMessage',
  ClarificationMessageSchema,
  'clarification_messages',
);
