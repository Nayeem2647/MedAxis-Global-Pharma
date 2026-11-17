import { z } from 'zod';
import { apiRequest, parseApiResponse, ApiError, type ApiMeta } from './api-client';
import { bankInputSchema, currencies, decimalInput, pricingSchema } from './admin-workflow';
import { publicAssetUrl } from './public-catalog';

const text = (max = 200) => z.string().trim().min(1).max(max);
const uuid = z.uuidv4();
const date = z.iso.datetime({ offset: true });
export const resourceKinds = ['products', 'manufacturers', 'generics', 'categories', 'banners'] as const;
export type ResourceKind = (typeof resourceKinds)[number];
const slug = text().regex(/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u);
const commonTranslation = {
  slug,
  description: text(5000).optional(),
  seo_title: text().optional(),
  meta_description: text(500).optional(),
};
export const masterTranslationSchema = z.strictObject({
  name: text(),
  ...commonTranslation,
});
export const productTranslationSchema = z.strictObject({
  brand_name: text(),
  ...commonTranslation,
  indication_summary: text(2000).optional(),
  usage_notes: text(2000).optional(),
  storage_condition: text(500).optional(),
  image_alt_text: text().optional(),
});
export const reviewSchema = z.strictObject({
  kind: z.enum(['TECHNICAL', 'MEDICAL']),
  reviewed_at: date.refine((value) => Date.parse(value) <= Date.now(), 'Review date cannot be in the future.'),
  reviewer_name: text(),
});
export const productBody = z.strictObject({
  sku: text(),
  manufacturer_id: uuid,
  generic_id: uuid,
  category_ids: z
    .array(uuid)
    .min(1)
    .max(100)
    .refine((items) => new Set(items).size === items.length),
  translations: z.strictObject({
    en: productTranslationSchema,
    zhCN: productTranslationSchema.optional(),
  }),
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
    .max(20),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  review_metadata: reviewSchema.nullable().optional(),
});
const masterBase = {
  id: uuid.optional(),
  translations: z.strictObject({
    en: masterTranslationSchema,
    zhCN: masterTranslationSchema.optional(),
  }),
  is_active: z.boolean(),
};
export const manufacturerBody = z.strictObject({
  ...masterBase,
  country: z.string().regex(/^[A-Z]{2}$/),
  certifications: z.array(text()).max(100).optional(),
});
export const genericBody = z.strictObject({
  ...masterBase,
  therapeutic_indications: z.array(text()).max(100).optional(),
});
export const categoryBody = z.strictObject({
  ...masterBase,
  sort_order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export function safeBannerPath(path: string) {
  try {
    if (!/^\/(?:en|zh-CN)(?:\/|$)/.test(path) || /[\\?#]|%2f|%5c|\.\./i.test(path)) return false;
    return new URL(path, 'https://medaxis.test').origin === 'https://medaxis.test';
  } catch {
    return false;
  }
}
export const publicCopy = text(5000).refine(
  (value) =>
    !/[$€¥৳]\s*\d|\b(?:USD|EUR|CNY|BDT|RMB)\s*\d|\d\s*(?:美元|人民币)|\d+(?:\.\d+)?\s*%\s*(?:off|discount|折扣)/iu.test(
      value,
    ),
  'Public prices and retail discounts are not allowed.',
);
const bannerTranslation = z.strictObject({
  title: publicCopy.refine((value) => value.length <= 200),
  body: publicCopy,
});
export const bannerBody = z
  .strictObject({
    id: uuid.optional(),
    translations: z.strictObject({
      en: bannerTranslation,
      zhCN: bannerTranslation.optional(),
    }),
    is_active: z.boolean(),
    sort_order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    starts_at: date.optional(),
    ends_at: date.optional(),
    link_path: z.string().max(500).refine(safeBannerPath).optional(),
  })
  .refine((value) => !value.starts_at || !value.ends_at || value.starts_at < value.ends_at, 'End must follow start.');
const wireIdentity = { _id: uuid, created_at: date, updated_at: date };
export const productRecord = z
  .object({
    ...wireIdentity,
    ...productBody.shape,
    image_keys: productBody.shape.image_keys.default([]),
    review_metadata: reviewSchema.optional(),
  })
  .transform(({ _id, ...value }) => ({ id: _id, ...value }));
export const masterRecord = z
  .object({
    ...wireIdentity,
    translations: z.object({
      en: masterTranslationSchema,
      zhCN: masterTranslationSchema.optional(),
    }),
    is_active: z.boolean(),
    country: z.string().length(2).optional(),
    certifications: z.array(text()).optional(),
    therapeutic_indications: z.array(text()).optional(),
    sort_order: z.number().int().nonnegative().optional(),
  })
  .transform(({ _id, ...value }) => ({ id: _id, ...value }));
export const bannerRecord = z
  .object({ ...wireIdentity, ...bannerBody.shape, id: z.never().optional() })
  .transform(({ _id, ...value }) => ({ ...value, id: _id }));
export type ResourceRecord =
  z.infer<typeof productRecord> | z.infer<typeof masterRecord> | z.infer<typeof bannerRecord>;
export type ProductRecord = z.infer<typeof productRecord>;
export type MasterRecord = z.infer<typeof masterRecord>;
export type BannerRecord = z.infer<typeof bannerRecord>;
export function resourcePath(kind: ResourceKind, id?: string) {
  return `/v1/admin/${kind === 'banners' ? 'cms' : 'catalog'}/${kind}${id ? `/${uuid.parse(id)}` : ''}`;
}
export function resourceSchema(kind: ResourceKind): z.ZodType<ResourceRecord> {
  return kind === 'products' ? productRecord : kind === 'banners' ? bannerRecord : masterRecord;
}
export function resourceName(row: ResourceRecord) {
  const en = row.translations.en;
  return 'brand_name' in en ? en.brand_name : 'name' in en ? en.name : en.title;
}
export function bannerScheduleState(
  row: { is_active: boolean; starts_at?: string; ends_at?: string },
  now = Date.now(),
) {
  return !row.is_active
    ? 'Inactive'
    : row.starts_at && Date.parse(row.starts_at) > now
      ? 'Scheduled'
      : row.ends_at && Date.parse(row.ends_at) <= now
        ? 'Ended'
        : 'Active';
}
export async function readResource(kind: ResourceKind, id: string, signal?: AbortSignal) {
  return (await apiRequest(resourcePath(kind, id), resourceSchema(kind), { signal })).data;
}
export const pageFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const resourceQuery = z.strictObject({
  ...pageFields,
  q: text(100).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  is_active: z.enum(['true', 'false']).optional(),
  manufacturer_id: uuid.optional(),
  generic_id: uuid.optional(),
  category_id: uuid.optional(),
});
export function paramsFor(input: Record<string, unknown>, allowed: readonly string[]) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key) || Array.isArray(value))
      throw new ApiError('Unsupported filter.', {
        status: 422,
        code: 'VALIDATION_FAILED',
      });
    if (typeof value === 'string' && value.trim()) query.set(key, value.trim());
  }
  return query;
}
export function requirePagination(meta: ApiMeta) {
  if (!meta.pagination)
    throw new ApiError('Pagination is missing.', {
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  return meta.pagination;
}
export async function resourceList(kind: ResourceKind, query: URLSearchParams, signal?: AbortSignal) {
  const result = await apiRequest(`${resourcePath(kind)}?${query}`, z.array(resourceSchema(kind)).max(100), { signal });
  return { items: result.data, pagination: requirePagination(result.meta) };
}
export const imageReceipt = z.object({
  r2_object_key: z.string().regex(/^products\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/),
  url: z.url().refine((value) => publicAssetUrl(value) !== null),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  file_size_bytes: z.number().int().positive().max(5_242_880),
});
export function validatedInput<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error: unknown) {
    throw new ApiError('Check form fields.', {
      status: 422,
      code: 'VALIDATION_FAILED',
      responseValidated: true,
      details:
        error instanceof z.ZodError
          ? error.issues.map((issue) => ({
              field: issue.path.join('.'),
              issue: 'Check this field.',
            }))
          : [],
    });
  }
}
export async function validateCatalogImage(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mime = file.type;
  const valid =
    mime === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === 'image/png'
        ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
        : mime === 'image/webp' &&
          new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
          new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!valid || !file.size || file.size > 5_242_880)
    throw new ApiError('Use JPEG, PNG or WebP up to 5 MiB.', {
      status: 422,
      code: 'VALIDATION_FAILED',
      responseValidated: true,
      details: [{ field: 'image', issue: 'Use JPEG, PNG or WebP up to 5 MiB.' }],
    });
}
export async function adminMultipart<T>(
  path: string,
  form: FormData,
  schema: { parse(value: unknown): T },
  signal?: AbortSignal,
) {
  if (!/^\/api\/admin\/catalog\/(?:images|import-csv)(?:\?dry_run=(?:true|false))?$/.test(path))
    throw new Error('Invalid multipart target.');
  const response = await fetch(path, {
    method: 'POST',
    body: form,
    credentials: 'include',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    signal,
  });
  return (await parseApiResponse(response, schema, [200, 201, 202])).data;
}
export const csvColumns = [
  'sku',
  'manufacturer_slug',
  'generic_slug',
  'category_slugs',
  'brand_name_en',
  'slug_en',
  'brand_name_zhCN',
  'slug_zhCN',
  'description_en',
  'description_zhCN',
  'indication_summary_en',
  'indication_summary_zhCN',
  'usage_notes_en',
  'usage_notes_zhCN',
  'seo_title_en',
  'seo_title_zhCN',
  'meta_description_en',
  'meta_description_zhCN',
  'strength',
  'dosage_form',
  'pack_size',
  'packaging_unit',
  'cold_chain_required',
  'storage_condition',
  'status',
] as const;
export const csvReport = z.object({
  dry_run: z.boolean(),
  valid: z.boolean(),
  total_rows: z.number().int().min(1).max(1000),
  valid_rows: z.number().int().nonnegative().max(1000),
  committed: z.number().int().nonnegative().max(1000),
  rows: z
    .array(
      z.object({
        row: z.number().int().positive(),
        sku: text().optional(),
        valid: z.boolean(),
        errors: z.array(z.object({ field: z.string(), issue: z.string() })),
      }),
    )
    .max(1000),
});
export const enrollmentSchema = z.object({
  qr_data_url: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
    .max(200000),
  backup_codes: z.array(text(72)).length(8),
});
const unique = (items: string[]) => new Set(items).size === items.length;
export const settingsBody = z
  .strictObject({
    packaging_units: z
      .strictObject({
        units: z
          .array(text(40).regex(/^[A-Z0-9_ -]+$/))
          .min(1)
          .max(100)
          .refine(unique),
      })
      .optional(),
    wire_instructions: z
      .strictObject({
        ...bankInputSchema.shape,
        configured: z.boolean(),
        beneficiary_name: text(500).optional(),
        bank_name: text(500).optional(),
        account_number: text(500).optional(),
        swift_code: text(500).optional(),
      })
      .optional(),
    payment_presets: z
      .strictObject({
        terms: z.array(z.literal('BANK_WIRE_TT')).length(1),
        quote_validity_days: z.number().int().min(1).max(365),
        reservation_days: z.literal(5),
        business_timezone: z.literal('Asia/Dhaka'),
      })
      .optional(),
    shipping_presets: z
      .strictObject({
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
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
  .superRefine((value, ctx) => {
    if (value.wire_instructions?.configured && !bankInputSchema.safeParse(value.wire_instructions).success)
      ctx.addIssue({
        code: 'custom',
        path: ['wire_instructions'],
        message: 'Complete verified bank details.',
      });
  });
const rate = z
  .string()
  .regex(/^\d{1,5}(?:\.\d{1,16})?$/)
  .refine((value) => {
    const match = /^(\d{1,5})(?:\.(\d{1,16}))?$/.exec(value);
    if (!match) return false;
    const scaled = BigInt(match[1]) * BigInt('10000000000000000') + BigInt((match[2] ?? '').padEnd(16, '0'));
    return scaled >= BigInt('1000000000000000') && scaled <= BigInt('100000000000000000000');
  }, 'Rate must be 0.1–10000.');
export const fxBody = z.strictObject({
  rates: z
    .array(
      z.strictObject({
        currency: z.enum(['USD', 'EUR', 'CNY']),
        active_mode: z.enum(['LIVE', 'MANUAL_FIXED']),
        manual_rate_to_bdt: rate.optional(),
      }),
    )
    .min(1)
    .max(3)
    .refine((rows) => unique(rows.map((row) => row.currency))),
});
export const updateDraftBody = pricingSchema.safeExtend({
  expected_current_version_id: uuid,
  expected_updated_at: date,
});
export const customerRecord = z
  .object({
    _id: uuid,
    full_name: text(),
    customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']),
    company_name: text().optional(),
    email: z.email().optional(),
    whatsapp_number: text(50).optional(),
    wechat_id: text(100).optional(),
    preferred_locale: z.enum(['en', 'zh-CN']),
    country: z.string().length(2),
    city: text().optional(),
    created_at: date,
    updated_at: date,
  })
  .transform(({ _id, ...value }) => ({ id: _id, ...value }));
export const historyRecord = z
  .object({
    _id: uuid,
    rfq_number: text(),
    inquiry_type: z.enum(['QUICK_QUOTE', 'CART_RFQ']),
    status: text(),
    created_at: date,
    quotations: z.array(
      z.object({
        _id: uuid,
        quotation_number: text(),
        overall_status: text(),
        current_version: z.number().int().positive(),
        current_version_id: uuid,
        created_at: date,
      }),
    ),
  })
  .transform(({ _id, ...value }) => ({ id: _id, ...value }));
export const customerDetail = z.object({
  customer: customerRecord,
  history: z.array(historyRecord).max(100),
});
export const customerQuery = z.strictObject({
  ...pageFields,
  q: text(100).optional(),
  buyer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
export const auditQuery = z
  .strictObject({
    ...pageFields,
    actor_type: z.enum(['SUPER_ADMIN', 'BUYER', 'SYSTEM']).optional(),
    actor_id: uuid.optional(),
    action: text().optional(),
    entity_type: text().optional(),
    entity_id: uuid.optional(),
    date_from: date.optional(),
    date_to: date.optional(),
  })
  .refine(
    (value) => !value.date_from || !value.date_to || Date.parse(value.date_from) <= Date.parse(value.date_to),
    'Invalid date range.',
  );
export const quotationQuery = z.strictObject({
  ...pageFields,
  q: text(100).optional(),
  rfq_id: uuid.optional(),
  overall_status: z.enum(['ACTIVE', 'COMPLETED', 'DECLINED', 'EXPIRED']).optional(),
  status: z
    .enum([
      'DRAFT',
      'SENT',
      'ACCEPTED',
      'PAYMENT_RECEIVED',
      'DISPATCHED',
      'DELIVERED',
      'DECLINED',
      'VALIDITY_EXPIRED',
      'SUPERSEDED',
      'PAYMENT_EXPIRED',
    ])
    .optional(),
  reservation_before: date.optional(),
});
export const auditRecord = z.object({
  id: uuid,
  actor_type: z.enum(['SUPER_ADMIN', 'BUYER', 'SYSTEM']),
  actor_id: uuid.optional(),
  action: text(),
  entity_type: text(),
  entity_id: uuid,
  old_status: text().optional(),
  new_status: text().optional(),
  request_id: text(),
  ip_address: text().optional(),
  user_agent: z.string().max(2000).optional(),
  metadata: z.object({
    fields: z.array(z.string()).optional(),
    status: z.string().optional(),
    version_number: z.number().optional(),
    committed: z.number().optional(),
    severity: z.string().optional(),
    backup_codes_generated: z.number().optional(),
    previous_version_id: uuid.optional(),
    rows: z.number().optional(),
  }),
  created_at: date,
});
export const quotationRow = z
  .object({
    _id: uuid,
    quotation_number: text(),
    rfq_id: uuid,
    current_version: z.number().int().positive(),
    current_version_id: uuid,
    overall_status: z.enum(['ACTIVE', 'COMPLETED', 'DECLINED', 'EXPIRED']),
    created_at: date,
    updated_at: date,
    version: z.object({
      status: text(),
      billing_currency: z.enum(currencies),
      total_amount: z.string().regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/),
      valid_until: date.optional(),
      reservation_status: text(),
      reservation_expires_at: date.optional(),
    }),
  })
  .transform(({ _id, ...value }) => ({ id: _id, ...value }));
export const summarySchema = z.object({
  as_of: date,
  window_hours: z.number().int().min(1).max(168),
  active_quotations: z.number().int().nonnegative(),
  accepted_payment_pending: z.number().int().nonnegative(),
  ready_to_dispatch: z.number().int().nonnegative(),
  expiring_allocations: z.number().int().nonnegative(),
});
export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { decimalInput };
