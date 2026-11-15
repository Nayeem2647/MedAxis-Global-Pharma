import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface INotificationLog {
  _id: string;
  dedupe_key: string;
  entity_type: string;
  entity_id: string;
  kind: 'EMAIL' | 'PDF_RENDER' | 'ADMIN_EVENT';
  recipient?: string;
  template_id?: string;
  safe_payload: Record<string, unknown>;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'FAILED_RETRY' | 'BOUNCED' | 'DEAD';
  delivery_provider?: 'RESEND' | 'BREVO';
  first_attempt_at?: Date;
  attempt_count: number;
  next_retry_at: Date;
  lease_until?: Date;
  provider_message_id?: string;
  last_error_code?: string;
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
  retry_count?: number;
}

export const NotificationLogSchema = new Schema<INotificationLog>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    dedupe_key: { type: String, required: true, trim: true, maxlength: 200 },
    entity_type: { type: String, required: true, trim: true, maxlength: 200 },
    entity_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    kind: { type: String, required: true, trim: true, maxlength: 200, enum: ['EMAIL', 'PDF_RENDER', 'ADMIN_EVENT'] },
    recipient: { type: String, required: false, trim: true, maxlength: 200 },
    template_id: { type: String, required: false, trim: true, maxlength: 200 },
    safe_payload: { type: Schema.Types.Mixed, required: true },
    delivery_provider: { type: String, enum: ['RESEND', 'BREVO'] },
    first_attempt_at: { type: Date },
    status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'FAILED_RETRY', 'BOUNCED', 'DEAD'],
      default: 'PENDING',
    },
    attempt_count: {
      type: Number,
      required: true,
      validate: Number.isSafeInteger,
      min: 0,
      default: 0,
      alias: 'retry_count',
    },
    next_retry_at: { type: Date, required: true },
    lease_until: { type: Date, required: false },
    provider_message_id: { type: String, required: false, trim: true, maxlength: 200 },
    last_error_code: { type: String, required: false, trim: true, maxlength: 200 },
    sent_at: { type: Date, required: false },
  },
  {
    collection: 'notification_logs',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
NotificationLogSchema.index({ dedupe_key: 1 }, { unique: true });
NotificationLogSchema.index({ status: 1, next_retry_at: 1 }, {});
NotificationLogSchema.index({ status: 1, lease_until: 1 }, {});
NotificationLogSchema.index(
  { provider_message_id: 1 },
  { partialFilterExpression: { provider_message_id: { $type: 'string' } } },
);
installPersistenceGuards(NotificationLogSchema, 'notification_logs');
export const NotificationLogModel = model<INotificationLog>(
  'NotificationLog',
  NotificationLogSchema,
  'notification_logs',
);
