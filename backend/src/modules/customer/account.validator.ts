import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(4).max(1024);
export const accountRegistration = z
  .strictObject({
    email,
    password,
    full_name: text(200),
    customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']),
    company_name: z.string().trim().max(200).optional(),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    preferred_locale: z.enum(['en', 'zh-CN']),
    turnstile_token: z.string().max(2048).optional(),
  })
  .superRefine((value, context) => {
    if (value.customer_type === 'B2B_WHOLESALE' && !value.company_name)
      context.addIssue({ code: 'custom', path: ['company_name'], message: 'Company name is required.' });
  });
export const accountLogin = z.strictObject({ email, password: z.string().min(1).max(1024) });
export const accountEmail = z.strictObject({ email });
export const accountToken = z.strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export const accountReset = accountToken.extend({ password });
export const accountPassword = z.strictObject({ current_password: z.string().min(1).max(1024), password });
export const accountProfile = z
  .strictObject({
    full_name: text(200),
    customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']),
    company_name: z.string().trim().max(200).optional(),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    city: z.string().trim().max(100).optional(),
    whatsapp_number: z.string().trim().max(50).optional(),
    wechat_id: z.string().trim().max(100).optional(),
    preferred_locale: z.enum(['en', 'zh-CN']),
  })
  .superRefine((value, context) => {
    if (value.customer_type === 'B2B_WHOLESALE' && !value.company_name)
      context.addIssue({ code: 'custom', path: ['company_name'], message: 'Company name is required.' });
  });
export const accountDraft = z.strictObject({
  title: text(200),
  destination_country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  preferred_currency: z.enum(['USD', 'CNY', 'EUR', 'BDT']),
  items: z
    .array(
      z.strictObject({
        product_id: z.uuid().optional(),
        name: text(200),
        strength: z.string().trim().max(100).optional(),
        quantity: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        packaging_unit: text(40),
        notes: z.string().trim().max(2000).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export const accountDraftUpdate = accountDraft.extend({ revision: z.number().int().nonnegative() });
export const accountPage = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const accountRevision = z.strictObject({ notes: text(2000) });
