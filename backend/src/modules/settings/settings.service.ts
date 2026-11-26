import { z } from 'zod';
import mongoose from 'mongoose';
import type { Request } from 'express';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { PlatformSettingModel } from './settings.schema.js';
import { supplyNetworkCountryCodes, supplyNetworkSetting } from './supply-network.js';

const text = z.string().trim().min(1).max(500);
const unique = (values: string[]) => new Set(values).size === values.length;
const wire = z
  .object({
    configured: z.boolean(),
    instructions: z.string().trim().min(1).max(4000),
    beneficiary_name: text.optional(),
    bank_name: text.optional(),
    account_number: text.optional(),
    swift_code: text.optional(),
    bank_address: text.optional(),
    currency: z.enum(['USD', 'EUR', 'CNY', 'BDT']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.configured)
      for (const field of ['beneficiary_name', 'bank_name', 'account_number', 'swift_code'] as const)
        if (!value[field])
          ctx.addIssue({ code: 'custom', path: [field], message: 'Required for configured wire instructions.' });
  });
export const settingsPatch = z
  .object({
    packaging_units: z
      .object({
        units: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(40)
              .regex(/^[A-Z0-9_ -]+$/),
          )
          .min(1)
          .max(100)
          .refine(unique, 'Duplicate packaging units.'),
      })
      .strict()
      .optional(),
    wire_instructions: wire.optional(),
    supply_network: supplyNetworkSetting.optional(),
    payment_presets: z
      .object({
        terms: z.array(z.literal('BANK_WIRE_TT')).min(1).max(1),
        quote_validity_days: z.number().int().min(1).max(365),
        reservation_days: z.literal(5),
        business_timezone: z.literal('Asia/Dhaka'),
      })
      .strict()
      .optional(),
    shipping_presets: z
      .object({
        methods: z
          .array(z.enum(['INCOTERM', 'EXPRESS_COURIER']))
          .min(1)
          .max(2)
          .refine(unique),
        incoterms: z
          .array(z.enum(['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF']))
          .max(6)
          .refine(unique),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'At least one setting is required.');

export function createSettingsService(revalidate: Revalidate) {
  async function get() {
    const rows = await PlatformSettingModel.find({
      key: { $in: ['packaging_units', 'wire_instructions', 'payment_presets', 'shipping_presets', 'monetary_policy', 'supply_network'] },
    })
      .select({ _id: 0, key: 1, value: 1, updated_at: 1 })
      .sort({ key: 1 })
      .lean();
    return {
      ...Object.fromEntries(rows.map((row) => [row.key, { value: row.value, updated_at: row.updated_at }])),
      supply_network_country_codes: supplyNetworkCountryCodes,
    };
  }
  async function patch(req: Request, input: z.infer<typeof settingsPatch>) {
    await mongoose.connection.transaction(async (session) => {
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        const doc = await PlatformSettingModel.findOneAndUpdate(
          { key },
          { $set: { value, updated_by: req.admin!.id } },
          { session, upsert: true, returnDocument: 'after', runValidators: true },
        );
        await writeAuditLog(
          req,
          {
            actor_type: 'SUPER_ADMIN',
            actor_id: req.admin!.id,
            action: 'PLATFORM_SETTING_UPDATED',
            entity_type: 'platform_settings',
            entity_id: doc!._id,
            metadata: { key },
          },
          session,
        );
      }
    });
    revalidate(req.requestId);
    return get();
  }
  return { get, patch };
}
