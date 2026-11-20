import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';

interface Challenge {
  token_hash: string;
  expires_at: Date;
}
export interface CustomerAccount {
  _id: string;
  email: string;
  password_hash: string;
  full_name: string;
  customer_type: 'B2B_WHOLESALE' | 'B2C_PATIENT';
  company_name?: string;
  country: string;
  city?: string;
  whatsapp_number?: string;
  wechat_id?: string;
  preferred_locale: 'en' | 'zh-CN';
  customer_id?: string;
  email_verified_at?: Date;
  verification?: Challenge;
  password_reset?: Challenge;
  is_active: boolean;
  session_generation: number;
  failed_count: number;
  locked_until?: Date;
  created_at: Date;
  updated_at: Date;
}
export interface CustomerSession {
  _id: string;
  account_id: string;
  token_hash: string;
  session_generation: number;
  expires_at: Date;
  absolute_expires_at: Date;
  created_at: Date;
  updated_at: Date;
}
export interface CustomerDraft {
  _id: string;
  account_id: string;
  title: string;
  destination_country: string;
  preferred_currency: 'USD' | 'CNY' | 'EUR' | 'BDT';
  items: {
    product_id?: string;
    name: string;
    strength?: string;
    quantity: number;
    packaging_unit: string;
    notes?: string;
  }[];
  status: 'DRAFT' | 'SUBMITTING' | 'SUBMITTED';
  revision: number;
  rfq_id?: string;
  rfq_number?: string;
  created_at: Date;
  updated_at: Date;
}
export type CustomerEventKind =
  | 'REGISTERED'
  | 'EMAIL_VERIFIED'
  | 'SIGNED_IN'
  | 'PASSWORD_CHANGED'
  | 'PROFILE_UPDATED'
  | 'DRAFT_CREATED'
  | 'DRAFT_UPDATED'
  | 'DRAFT_DELETED'
  | 'RFQ_SUBMITTED'
  | 'REVISION_REQUESTED';
export interface CustomerEvent {
  _id: string;
  account_id: string;
  kind: CustomerEventKind;
  reference_id?: string;
  created_at: Date;
}

const options = {
  strict: 'throw' as const,
  versionKey: false as const,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  autoIndex: false,
  autoCreate: false,
};
const id = { type: String, required: true, default: () => randomUUID() };
const challenge = new Schema(
  { token_hash: { type: String, required: true }, expires_at: { type: Date, required: true } },
  { _id: false, strict: 'throw' },
);
const accountSchema = new Schema<CustomerAccount>(
  {
    _id: id,
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    password_hash: { type: String, required: true, select: false },
    full_name: { type: String, required: true, maxlength: 200 },
    customer_type: { type: String, enum: ['B2B_WHOLESALE', 'B2C_PATIENT'], required: true },
    company_name: { type: String, maxlength: 200 },
    country: { type: String, required: true, match: /^[A-Z]{2}$/ },
    city: { type: String, maxlength: 100 },
    whatsapp_number: { type: String, maxlength: 50 },
    wechat_id: { type: String, maxlength: 100 },
    preferred_locale: { type: String, enum: ['en', 'zh-CN'], required: true },
    customer_id: String,
    email_verified_at: Date,
    verification: { type: challenge, select: false },
    password_reset: { type: challenge, select: false },
    is_active: { type: Boolean, required: true, default: true },
    session_generation: { type: Number, required: true, default: 0 },
    failed_count: { type: Number, required: true, default: 0 },
    locked_until: Date,
  },
  { ...options, collection: 'customer_accounts' },
);
accountSchema.index({ email: 1 }, { unique: true });
accountSchema.index({ 'verification.token_hash': 1 }, { sparse: true, unique: true });
accountSchema.index({ 'password_reset.token_hash': 1 }, { sparse: true, unique: true });
export const CustomerAccountModel = model<CustomerAccount>('CustomerAccount', accountSchema);

const sessionSchema = new Schema<CustomerSession>(
  {
    _id: id,
    account_id: { type: String, required: true },
    token_hash: { type: String, required: true },
    session_generation: { type: Number, required: true },
    expires_at: { type: Date, required: true },
    absolute_expires_at: { type: Date, required: true },
  },
  { ...options, collection: 'customer_sessions' },
);
sessionSchema.index({ token_hash: 1 }, { unique: true });
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ account_id: 1 });
export const CustomerSessionModel = model<CustomerSession>('CustomerSession', sessionSchema);

const draftItem = new Schema(
  {
    product_id: String,
    name: { type: String, required: true, maxlength: 200 },
    strength: { type: String, maxlength: 100 },
    quantity: { type: Number, required: true, min: 1, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger },
    packaging_unit: { type: String, required: true, maxlength: 40 },
    notes: { type: String, maxlength: 2000 },
  },
  { _id: false, strict: 'throw' },
);
const draftSchema = new Schema<CustomerDraft>(
  {
    _id: id,
    account_id: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    destination_country: { type: String, required: true, match: /^[A-Z]{2}$/ },
    preferred_currency: { type: String, enum: ['USD', 'CNY', 'EUR', 'BDT'], required: true },
    items: {
      type: [draftItem],
      required: true,
      validate: (items: unknown[]) => items.length > 0 && items.length <= 100,
    },
    status: { type: String, enum: ['DRAFT', 'SUBMITTING', 'SUBMITTED'], required: true, default: 'DRAFT' },
    revision: { type: Number, required: true, default: 0 },
    rfq_id: String,
    rfq_number: String,
  },
  { ...options, collection: 'customer_drafts' },
);
draftSchema.index({ account_id: 1, created_at: -1 });
export const CustomerDraftModel = model<CustomerDraft>('CustomerDraft', draftSchema);

const eventSchema = new Schema<CustomerEvent>(
  {
    _id: id,
    account_id: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: [
        'REGISTERED',
        'EMAIL_VERIFIED',
        'SIGNED_IN',
        'PASSWORD_CHANGED',
        'PROFILE_UPDATED',
        'DRAFT_CREATED',
        'DRAFT_UPDATED',
        'DRAFT_DELETED',
        'RFQ_SUBMITTED',
        'REVISION_REQUESTED',
      ],
    },
    reference_id: String,
    created_at: { type: Date, required: true, default: Date.now },
  },
  { strict: 'throw', versionKey: false, autoIndex: false, autoCreate: false, collection: 'customer_events' },
);
eventSchema.index({ account_id: 1, created_at: -1 });
export const CustomerEventModel = model<CustomerEvent>('CustomerEvent', eventSchema);
