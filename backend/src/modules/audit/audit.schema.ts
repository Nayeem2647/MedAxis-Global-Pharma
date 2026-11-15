import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface IAuditLog {
  _id: string;
  actor_type: 'SUPER_ADMIN' | 'BUYER' | 'SYSTEM';
  actor_id?: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  old_status?: string;
  new_status?: string;
  change_reason?: string;
  safe_changes?: Record<string, unknown>;
  request_id?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export const AuditLogSchema = new Schema<IAuditLog>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    actor_type: { type: String, required: true, trim: true, maxlength: 200, enum: ['SUPER_ADMIN', 'BUYER', 'SYSTEM'] },
    actor_id: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    action_type: { type: String, required: true, trim: true, maxlength: 200 },
    entity_type: { type: String, required: true, trim: true, maxlength: 200 },
    entity_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    old_status: { type: String, required: false, trim: true, maxlength: 200 },
    new_status: { type: String, required: false, trim: true, maxlength: 200 },
    change_reason: { type: String, required: false, trim: true, maxlength: 2000 },
    safe_changes: { type: Schema.Types.Mixed, required: false },
    request_id: { type: String, required: false, trim: true, maxlength: 200 },
    ip_address: { type: String, required: false, trim: true, maxlength: 200 },
    user_agent: { type: String, required: false, trim: true, maxlength: 2000 },
  },
  {
    collection: 'audit_logs',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: false },
  },
);
AuditLogSchema.index({ actor_id: 1, created_at: -1 }, {});
AuditLogSchema.index({ entity_type: 1, entity_id: 1, created_at: -1 }, {});
installPersistenceGuards(AuditLogSchema, 'audit_logs');
export const AuditLogModel = model<IAuditLog>('AuditLog', AuditLogSchema, 'audit_logs');
