import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface IPrescription {
  _id: string;
  rfq_id?: string;
  customer_id?: string;
  upload_token_hash?: string;
  r2_storage_key?: string;
  mime_type: 'image/jpeg' | 'image/png' | 'application/pdf';
  file_size_bytes: number;
  encryption?: { algorithm: 'aes-256-gcm'; key_id: string; iv: string; auth_tag: string };
  uploaded_at: Date;
  purge_scheduled_at: Date;
  purge_status: 'ACTIVE' | 'PENDING' | 'DELETING' | 'PURGED';
  purged_at?: Date;
  retry_count: number;
  next_retry_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export const PrescriptionSchema = new Schema<IPrescription>(
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
      required: false,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    customer_id: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    upload_token_hash: { type: String, match: /^[a-f0-9]{64}$/, select: false },
    r2_storage_key: {
      type: String,
      required: false,
      trim: true,
      maxlength: 500,
      match: /^(?![a-zA-Z][a-zA-Z0-9+.-]*:\/\/).+$/,
    },
    mime_type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['image/jpeg', 'image/png', 'application/pdf'],
    },
    file_size_bytes: { type: Number, required: true, validate: Number.isSafeInteger, min: 1, max: 5242880 },
    encryption: {
      type: new Schema(
        {
          algorithm: { type: String, required: true, trim: true, maxlength: 200, enum: ['aes-256-gcm'] },
          key_id: { type: String, required: true, trim: true, maxlength: 200 },
          iv: { type: String, required: true, trim: true, maxlength: 200 },
          auth_tag: { type: String, required: true, trim: true, maxlength: 200 },
        },
        { _id: false, strict: 'throw' },
      ),
      required: false,
    },
    uploaded_at: { type: Date, required: true },
    purge_scheduled_at: { type: Date, required: true },
    purge_status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['ACTIVE', 'PENDING', 'DELETING', 'PURGED'],
      default: 'ACTIVE',
    },
    purged_at: { type: Date, required: false },
    retry_count: { type: Number, required: true, validate: Number.isSafeInteger, min: 0, default: 0 },
    next_retry_at: { type: Date, required: false },
  },
  {
    collection: 'prescriptions',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
PrescriptionSchema.index({ rfq_id: 1 }, {});
PrescriptionSchema.pre('validate', function () {
  if (!!this.rfq_id !== !!this.customer_id || (!this.rfq_id && !this.upload_token_hash))
    this.invalidate('rfq_id', 'Prescription must be linked to an RFQ/customer pair or have a staging owner.');
});
PrescriptionSchema.index({ purge_status: 1, purge_scheduled_at: 1 }, {});
PrescriptionSchema.index({ purge_status: 1, next_retry_at: 1 }, {});
installPersistenceGuards(PrescriptionSchema, 'prescriptions');
export const PrescriptionModel = model<IPrescription>('Prescription', PrescriptionSchema, 'prescriptions');
