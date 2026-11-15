import { z } from 'zod';
import { uuid } from '../../modules/catalog/catalog.validator.js';
import { RFQ_STATUS } from '../../config/constants.js';
import { cleanHtml } from '../utils/content.js';
import { AppError } from '../errors/AppError.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (value === null || (typeof value === 'string' && !value.trim()) ? undefined : value),
    text(max).optional(),
  );
const email = z.preprocess(
  (value) => (value === null || (typeof value === 'string' && !value.trim()) ? undefined : value),
  z.string().trim().toLowerCase().email().max(200).optional(),
);
export const contactSchema = z
  .object({
    full_name: text(200),
    customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']).default('B2C_PATIENT'),
    company_name: optionalText(200),
    email,
    whatsapp_number: optionalText(50),
    wechat_id: optionalText(100),
    preferred_locale: z.enum(['en', 'zh-CN']).default('en'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.email && !data.whatsapp_number && !data.wechat_id)
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'At least one contact channel is required.' });
    if (data.customer_type === 'B2B_WHOLESALE' && !data.company_name)
      ctx.addIssue({ code: 'custom', path: ['company_name'], message: 'Company name is required for B2B.' });
  });
export const rfqLine = z
  .object({
    product_id: z.preprocess((v) => (v === null ? undefined : v), uuid.optional()),
    is_uncatalogued: z.boolean().default(false),
    custom_medicine_name: optionalText(200),
    custom_strength: optionalText(100),
    quantity: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    packaging_unit: text(40),
    line_notes: optionalText(2000),
  })
  .strict()
  .superRefine((line, ctx) => {
    if (line.is_uncatalogued ? !line.custom_medicine_name || !!line.product_id : !line.product_id)
      ctx.addIssue({
        code: 'custom',
        path: [line.is_uncatalogued ? 'custom_medicine_name' : 'product_id'],
        message: 'Specify a catalog product or an uncatalogued medicine name.',
      });
  });
export const rfqIntakeSchema = z
  .object({
    idempotency_key: uuid,
    contact: contactSchema,
    destination_country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    destination_city_port: optionalText(200),
    preferred_currency: z.enum(['USD', 'EUR', 'CNY', 'BDT']).default('USD'),
    locale: z.enum(['en', 'zh-CN']).default('en'),
    items: z.array(rfqLine).min(1).max(100),
    prescription_ids: z.array(uuid).max(5).default([]),
    turnstile_token: z.string().max(2048).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      (input.locale === 'zh-CN' || input.contact.preferred_locale === 'zh-CN' || input.destination_country === 'CN') &&
      !input.contact.email
    )
      ctx.addIssue({
        code: 'custom',
        path: ['contact', 'email'],
        message: 'Email is required for Chinese-language or Mainland China inquiries.',
      });
    if (new Set(input.prescription_ids).size !== input.prescription_ids.length)
      ctx.addIssue({ code: 'custom', path: ['prescription_ids'], message: 'Duplicate prescription IDs.' });
  });
export const cartRfqSchema = rfqIntakeSchema;
export const quickQuoteSchema = rfqIntakeSchema.refine((input) => input.items.length === 1, {
  path: ['items'],
  message: 'Quick quote requires exactly one line.',
});
export type RfqIntake = z.infer<typeof rfqIntakeSchema>;
export function parseRfqIntake(raw: unknown, kind: 'QUICK_QUOTE' | 'CART_RFQ', headerKey?: string): RfqIntake {
  const body = { ...z.record(z.string(), z.unknown()).parse(raw) };
  if (headerKey && body.idempotency_key && body.idempotency_key !== headerKey)
    throw AppError.badRequest('Conflicting idempotency keys.');
  body.idempotency_key ??= headerKey;
  const locale = body.locale ?? body.preferred_locale;
  const flat = [
    'full_name',
    'customer_type',
    'company_name',
    'email',
    'whatsapp_number',
    'wechat_id',
    'preferred_locale',
  ];
  if (body.contact && flat.some((field) => body[field] !== undefined))
    throw AppError.badRequest('Use either contact or flat contact fields.');
  if (!body.contact)
    body.contact = Object.fromEntries(
      flat.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]),
    );
  const contact = z.record(z.string(), z.unknown()).parse(body.contact);
  body.locale = locale ?? contact.preferred_locale ?? 'en';
  body.contact = { ...contact, preferred_locale: contact.preferred_locale ?? body.locale };
  for (const field of flat) delete body[field];
  if (body.prescription_id !== undefined) {
    if (body.prescription_ids !== undefined) throw AppError.badRequest('Use prescription_id or prescription_ids.');
    body.prescription_ids = body.prescription_id ? [body.prescription_id] : [];
    delete body.prescription_id;
  }
  if (kind === 'QUICK_QUOTE' && body.items === undefined) {
    const fields = [
      'product_id',
      'is_uncatalogued',
      'custom_medicine_name',
      'custom_strength',
      'quantity',
      'packaging_unit',
      'line_notes',
    ];
    body.items = [
      {
        ...Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])),
        ...(body.customer_notes ? { line_notes: body.customer_notes } : {}),
      },
    ];
    for (const field of [...fields, 'customer_notes']) delete body[field];
  }
  return (kind === 'QUICK_QUOTE' ? quickQuoteSchema : cartRfqSchema).parse(body);
}
export const availabilitySchema = z
  .object({
    item_availability_status: z.enum(['AVAILABLE', 'UNAVAILABLE', 'SOURCING']),
    customer_facing_note: optionalText(2000),
  })
  .strict();
export const statusSchema = z
  .object({ status: z.enum(Object.values(RFQ_STATUS)), reason: optionalText(2000) })
  .strict();
export const messageSchema = z
  .object({
    body: text(5000)
      .transform(cleanHtml)
      .refine((value) => value.trim().length > 0),
    channel: z.enum(['EMAIL', 'WHATSAPP', 'WECHAT']).default('EMAIL'),
  })
  .strict();
export const noteSchema = z
  .object({
    body: text(5000)
      .transform(cleanHtml)
      .refine((value) => value.trim().length > 0),
  })
  .strict();
export const closeSchema = z.object({ unable_to_supply_reason: text(2000) }).strict();
export const replySchema = z
  .object({
    provider_event_id: text(200),
    thread_id: uuid,
    from_email: z.string().trim().toLowerCase().email().max(200),
    body: text(5000)
      .transform(cleanHtml)
      .refine((value) => value.trim().length > 0),
  })
  .strict();
export const rfqListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(Object.values(RFQ_STATUS)).optional(),
    buyer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']).optional(),
    q: text(100).optional(),
    date_from: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    date_to: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
  })
  .strict()
  .refine((value) => !value.date_from || !value.date_to || value.date_from <= value.date_to, 'Invalid date range.');
