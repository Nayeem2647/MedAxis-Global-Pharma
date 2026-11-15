import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { uuid } from '../../modules/catalog/catalog.validator.js';
import { decimalInput } from './quotation.validator.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const notes = text(5000)
  .transform((value) => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }))
  .refine((value) => !!value.trim(), 'Notes are required.');
export const acceptSchema = z.object({ terms_accepted: z.literal(true) }).strict();
export const revisionRequestSchema = z.object({ notes }).strict();
export const refreshRequestSchema = z.object({ notes: notes.optional() }).strict();
export const declineSchema = z
  .object({
    reason: z.enum(['PRICE', 'LEAD_TIME', 'SPECIFICATION', 'OTHER']),
    notes: notes.refine((value) => value.length <= 2000, 'Decline notes must not exceed 2000 characters.').optional(),
  })
  .strict();
const expected = { expected_version_id: uuid.optional() };
export const fulfillmentSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...expected,
      status: z.literal('PAYMENT_RECEIVED'),
      wire_reference: text(200),
      amount: decimalInput,
      currency: z.enum(['USD', 'EUR', 'CNY', 'BDT']),
    })
    .strict(),
  z
    .object({
      ...expected,
      status: z.literal('DISPATCHED'),
      courier_name: text(200),
      awb_tracking_number: text(200),
      estimated_delivery: z.iso
        .datetime({ offset: true })
        .transform((date) => new Date(date))
        .optional(),
    })
    .strict(),
  z.object({ ...expected, status: z.literal('DELIVERED') }).strict(),
]);
export const pageQuery = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const customerQuery = z
  .object({
    ...pageQuery,
    q: text(100).optional(),
    buyer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .strict();
export const auditQuery = z
  .object({
    ...pageQuery,
    actor_type: z.enum(['SUPER_ADMIN', 'BUYER', 'SYSTEM']).optional(),
    actor_id: uuid.optional(),
    action: text(200).optional(),
    entity_type: text(200).optional(),
    entity_id: uuid.optional(),
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
