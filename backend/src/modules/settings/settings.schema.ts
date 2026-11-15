import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface IPlatformSetting {
  _id: string;
  key: string;
  value: Record<string, unknown>;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

export const PlatformSettingSchema = new Schema<IPlatformSetting>(
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
    value: { type: Schema.Types.Mixed, required: true },
    updated_by: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
  },
  {
    collection: 'platform_settings',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
PlatformSettingSchema.index({ key: 1 }, { unique: true });
installPersistenceGuards(PlatformSettingSchema, 'platform_settings');
export const PlatformSettingModel = model<IPlatformSetting>(
  'PlatformSetting',
  PlatformSettingSchema,
  'platform_settings',
);
