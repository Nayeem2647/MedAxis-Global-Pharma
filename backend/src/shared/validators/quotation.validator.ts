import { z } from 'zod';
import { uuid } from '../../modules/catalog/catalog.validator.js';
import { Exact, saneRate } from '../utils/decimal.js';

export const decimalInput = z.string().regex(/^\d{1,18}(?:\.\d{1,8})?$/, 'Use a nonnegative decimal string.');
const text = (max = 200) => z.string().trim().min(1).max(max);
export const bankDetailsSchema = z
  .object({
    configured: z.literal(true),
    instructions: text(4000),
    beneficiary_name: text(500),
    bank_name: text(500),
    account_number: text(500),
    swift_code: text(500),
    bank_address: text(500).optional(),
    currency: z.enum(['USD', 'EUR', 'CNY', 'BDT']).optional(),
  })
  .strict();
const snapshot = z
  .object({ brand_name: text(), generic_name: text(), strength: text(), dosage_form: text(), pack_size: text() })
  .strict();
export const quoteLineSchema = z
  .object({
    rfq_item_id: uuid,
    manufacturer_id: uuid,
    availability_status: z.enum(['AVAILABLE', 'UNAVAILABLE', 'SOURCING']),
    procurement_cost_bdt: decimalInput.optional(),
    markup_percent: decimalInput
      .refine((value) => new Exact(value).lte('1000000'), 'Markup exceeds 1000000%.')
      .optional(),
    customer_facing_note: text(2000).optional(),
    snapshot: snapshot.optional(),
  })
  .strict()
  .superRefine((line, ctx) => {
    if (
      line.availability_status === 'AVAILABLE' &&
      (line.procurement_cost_bdt === undefined || line.markup_percent === undefined)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['procurement_cost_bdt'],
        message: 'Available lines require cost and markup.',
      });
    if (line.availability_status === 'UNAVAILABLE' && !line.customer_facing_note)
      ctx.addIssue({
        code: 'custom',
        path: ['customer_facing_note'],
        message: 'Unavailable lines require a customer-facing note.',
      });
  });
export const pricingSchema = z
  .object({
    billing_currency: z.enum(['USD', 'EUR', 'CNY', 'BDT']),
    items: z
      .array(quoteLineSchema)
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((line) => line.rfq_item_id)).size === items.length, 'Duplicate RFQ lines.'),
    freight_amount: decimalInput.default('0'),
    insurance_amount: decimalInput.default('0'),
    shipping_terms: z
      .object({
        method: z.enum(['INCOTERM', 'EXPRESS_COURIER']),
        incoterm: z.enum(['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF']).optional(),
        named_place: text(),
        cold_chain_required: z.boolean().default(false),
        temperature_range: text().optional(),
      })
      .strict()
      .refine((terms) => terms.method !== 'INCOTERM' || !!terms.incoterm, 'Incoterm is required.'),
    payment_terms: z.literal('BANK_WIRE_TT').default('BANK_WIRE_TT'),
    bank_details: bankDetailsSchema.optional(),
    internal_procurement_notes: text(5000).optional(),
  })
  .strict();
export const draftQuoteSchema = pricingSchema.extend({ rfq_id: uuid });
export const updateDraftQuoteSchema = pricingSchema.extend({
  expected_current_version_id: uuid,
  expected_updated_at: z.iso.datetime({ offset: true }),
});
export const sendQuoteSchema = z
  .object({
    expected_version_id: uuid.optional(),
    bank_details: bankDetailsSchema.optional(),
    validity_days: z.number().int().min(1).max(365).optional(),
    allow_stale_fx: z.boolean().default(true),
  })
  .strict();
export const reviseQuoteSchema = pricingSchema.extend({
  expected_current_version_id: uuid,
  issue_immediately: z.boolean().default(false),
  validity_days: z.number().int().min(1).max(365).optional(),
  allow_stale_fx: z.boolean().default(true),
});
export const resendQuoteSchema = z.object({ expected_version_id: uuid.optional() }).strict();
export const fxPatchSchema = z
  .object({
    rates: z
      .array(
        z
          .object({
            currency: z.enum(['USD', 'CNY', 'EUR']),
            active_mode: z.enum(['LIVE', 'MANUAL_FIXED']),
            manual_rate_to_bdt: z
              .string()
              .regex(/^\d{1,5}(?:\.\d{1,16})?$/)
              .refine(saneRate, 'Rate must be between 0.1 and 10000.')
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(3)
      .refine((rates) => new Set(rates.map((rate) => rate.currency)).size === rates.length, 'Duplicate currencies.'),
  })
  .strict();
export type QuotePricing = z.infer<typeof pricingSchema>;
