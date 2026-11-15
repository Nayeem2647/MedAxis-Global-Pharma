import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface IAdmin {
  _id: string;
  singleton_key: 'SUPER_ADMIN';
  email: string;
  password_hash: string;
  totp_secret_encrypted: string;
  backup_code_hashes: Array<string>;
  is_active: boolean;
  session_generation: number;
  last_totp_step?: number;
  created_at: Date;
  updated_at: Date;
}

export const AdminSchema = new Schema<IAdmin>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    singleton_key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['SUPER_ADMIN'],
      default: 'SUPER_ADMIN',
    },
    email: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      set: (value: string | undefined) => value?.trim().toLowerCase() || undefined,
    },
    password_hash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      match: new RegExp('^\\$argon2id\\$'),
      select: false,
    },
    totp_secret_encrypted: { type: String, required: true, trim: true, maxlength: 2000, select: false },
    backup_code_hashes: {
      select: false,
      type: [
        {
          type: String,
          required: true,
          trim: true,
          maxlength: 60,
          match: new RegExp('^\\$2[aby]\\$\\d{2}\\$[./A-Za-z0-9]{53}$'),
        },
      ],
      required: true,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 0 && v.length <= 20,
        message: 'Array length outside contract bounds',
      },
    },
    is_active: { type: Boolean, required: true, default: true },
    session_generation: { type: Number, required: true, validate: Number.isSafeInteger, min: 0, default: 0 },
    last_totp_step: { type: Number, validate: Number.isSafeInteger, min: 0, select: false },
  },
  {
    collection: 'admins',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
AdminSchema.index({ singleton_key: 1 }, { unique: true });
AdminSchema.index({ email: 1 }, { unique: true });
installPersistenceGuards(AdminSchema, 'admins');
export const AdminModel = model<IAdmin>('Admin', AdminSchema, 'admins');

export interface IAdminSession {
  _id: string;
  admin_id: string;
  token_hash: string;
  session_generation: number;
  purpose: 'PRE_AUTH' | 'ADMIN';
  user_agent?: string;
  geo?: { country?: string; city?: string };
  last_seen_at: Date;
  expires_at: Date;
  revoked_at?: Date;
  device_label?: string;
  ip_address?: string;
  created_at: Date;
  updated_at: Date;
}

export const AdminSessionSchema = new Schema<IAdminSession>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    admin_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    token_hash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      match: new RegExp('^[a-fA-F0-9]{64}$'),
      select: false,
    },
    session_generation: { type: Number, required: true, validate: Number.isSafeInteger, min: 0, default: 0 },
    purpose: { type: String, enum: ['PRE_AUTH', 'ADMIN'], required: true, default: 'ADMIN' },
    user_agent: { type: String, maxlength: 2000 },
    geo: {
      type: new Schema(
        { country: { type: String, maxlength: 2 }, city: { type: String, maxlength: 200 } },
        { _id: false, strict: 'throw' },
      ),
    },
    last_seen_at: { type: Date, required: true },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, required: false },
    device_label: { type: String, required: false, trim: true, maxlength: 200 },
    ip_address: { type: String, required: false, trim: true, maxlength: 200 },
  },
  {
    collection: 'admin_sessions',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
AdminSessionSchema.index({ token_hash: 1 }, { unique: true });
AdminSessionSchema.index({ admin_id: 1, revoked_at: 1 }, {});
AdminSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
installPersistenceGuards(AdminSessionSchema, 'admin_sessions');
export const AdminSessionModel = model<IAdminSession>('AdminSession', AdminSessionSchema, 'admin_sessions');

export interface IAuthAttempt {
  _id: string;
  scope_key: string;
  failed_count: number;
  window_started_at: Date;
  locked_until?: Date;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export const AuthAttemptSchema = new Schema<IAuthAttempt>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    scope_key: { type: String, required: true, trim: true, maxlength: 200 },
    failed_count: { type: Number, required: true, validate: Number.isSafeInteger, min: 0, default: 0 },
    window_started_at: { type: Date, required: true },
    locked_until: { type: Date, required: false },
    expires_at: { type: Date, required: true },
  },
  {
    collection: 'auth_attempts',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
AuthAttemptSchema.index({ scope_key: 1 }, { unique: true });
AuthAttemptSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
installPersistenceGuards(AuthAttemptSchema, 'auth_attempts');
export const AuthAttemptModel = model<IAuthAttempt>('AuthAttempt', AuthAttemptSchema, 'auth_attempts');
