import { z } from 'zod';
import { cleanHtml } from '../../shared/utils/content.js';

export const uuid = z.uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(200)
  .regex(/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u);
const text = (max = 200) => z.string().trim().min(1).max(max);
const html = (max: number) => text(max).transform(cleanHtml);
const translationFields = {
  slug,
  description: html(5000).optional(),
  seo_title: text().optional(),
  meta_description: text(500).optional(),
};
export const masterTranslation = z.object({ name: text(), ...translationFields }).strict();
export const productTranslation = z
  .object({
    brand_name: text(),
    ...translationFields,
    indication_summary: html(2000).optional(),
    usage_notes: html(2000).optional(),
    storage_condition: text(500).optional(),
    image_alt_text: text().optional(),
  })
  .strict();
export const reviewMetadata = z
  .object({
    kind: z.enum(['TECHNICAL', 'MEDICAL']),
    reviewed_at: z.iso
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) <= Date.now(), 'Review date cannot be in the future.'),
    reviewer_name: text(),
  })
  .strict();
export const productFields = z
  .object({
    sku: text().transform((value) => value.toUpperCase()),
    manufacturer_id: uuid,
    generic_id: uuid,
    category_ids: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate categories are not allowed.'),
    translations: z.object({ en: productTranslation, zhCN: productTranslation.optional() }).strict(),
    strength: text(100),
    dosage_form: text(100),
    pack_size: text(100),
    packaging_unit: text(40).regex(/^[A-Z0-9_ -]+$/),
    cold_chain_required: z.boolean(),
    storage_condition: text(200).optional(),
    image_keys: z
      .array(
        z
          .string()
          .max(500)
          .regex(/^products\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/),
      )
      .max(20)
      .optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
    review_metadata: reviewMetadata.optional(),
  })
  .strict();
export const productCreate = productFields.extend({
  cold_chain_required: z.boolean().default(false),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
});
export const productPatch = productFields
  .partial()
  .extend({
    review_metadata: reviewMetadata.nullable().optional(),
    translations: z
      .object({ en: productTranslation.partial().optional(), zhCN: productTranslation.partial().nullable().optional() })
      .strict()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required.');
const commonMaster = {
  id: uuid.optional(),
  translations: z.object({ en: masterTranslation, zhCN: masterTranslation.optional() }).strict(),
  is_active: z.boolean().default(true),
};
export const masterBodies = {
  manufacturers: z
    .object({
      ...commonMaster,
      country: z.string().regex(/^[A-Z]{2}$/),
      certifications: z.array(text()).max(100).optional(),
    })
    .strict(),
  generics: z.object({ ...commonMaster, therapeutic_indications: z.array(text()).max(100).optional() }).strict(),
  categories: z
    .object({ ...commonMaster, sort_order: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) })
    .strict(),
};
export const catalogQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    locale: z.enum(['en', 'zh-CN']).default('en'),
    q: text(100).optional(),
    manufacturer: slug.optional(),
    generic: slug.optional(),
    category: slug.optional(),
    dosage_form: text(100).optional(),
    cold_chain: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();
export const localeQuery = z.object({ locale: z.enum(['en', 'zh-CN']).default('en') }).strict();
export type CatalogQuery = z.infer<typeof catalogQuery>;
export type ProductInput = z.infer<typeof productCreate>;
export type ProductPatch = z.infer<typeof productPatch>;
export type MasterKind = keyof typeof masterBodies;
export type Locale = 'en' | 'zh-CN';
export const localeKey = (locale: Locale) => (locale === 'zh-CN' ? 'zhCN' : 'en');
