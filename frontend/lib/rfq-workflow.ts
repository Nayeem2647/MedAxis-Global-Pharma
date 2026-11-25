import { z } from "zod";
import {
  adminVersionSchema,
  quotationDetailSchema,
  rfqDetailSchema,
} from "./admin-workflow";
import {
  offerMessage,
  workflowQueues,
  workflowStatus,
} from "./workflow-contract";
import { apiRequest, paginationSchema } from "./api-client";
export const ledgerFilters = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  history_page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(100).default(""),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .or(z.literal(""))
    .default(""),
  status: workflowStatus.or(z.literal("")).default(""),
  queue: z
    .enum(
      Object.keys(workflowQueues) as [
        keyof typeof workflowQueues,
        ...(keyof typeof workflowQueues)[],
      ],
    )
    .default("ALL"),
});
export type LedgerFilters = z.infer<typeof ledgerFilters>;
export const ledgerRow = z.object({
  _id: z.uuidv4(),
  rfq_number: z.string(),
  contact_snapshot: z.object({
    full_name: z.string(),
    company_name: z.string().optional(),
    customer_type: z.enum(["B2B_WHOLESALE", "B2C_PATIENT"]),
  }),
  destination_country: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  workflow_status: workflowStatus,
  has_prescription: z.boolean(),
  reviewed_at: z.string().optional(),
  quotation_id: z.uuidv4().optional(),
  attachments: z.array(
    z.object({
      _id: z.uuidv4(),
      attachment_kind: z.enum(["PRESCRIPTION", "SUPPORTING"]).optional(),
      mime_type: z.string(),
      purge_status: z.string(),
    }),
  ),
});
export const ledgerData = z.object({
  rows: z.array(ledgerRow).max(100),
  summary: z.object({
    open_requests: z.number().int().nonnegative(),
    awaiting_customer: z.number().int().nonnegative(),
    payment_followup: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }),
});
export type LedgerPage = z.infer<typeof ledgerData> & {
  pagination: z.infer<typeof paginationSchema>;
};
export function ledgerQuery(filters: LedgerFilters, history = false) {
  const query = new URLSearchParams({
    page: String(history ? filters.history_page : filters.page),
    limit: "20",
    queue: filters.queue,
    scope: history ? "HISTORY" : "ACTIVE",
  });
  for (const key of ["q", "country", "status"] as const)
    if (filters[key]) query.set(key, filters[key]);
  return query.toString();
}
export async function readLedger(
  filters: LedgerFilters,
  history: boolean,
  signal?: AbortSignal,
): Promise<LedgerPage> {
  const result = await apiRequest(
    `/v1/admin/rfq-workflow?${ledgerQuery(filters, history)}`,
    ledgerData,
    { signal, cache: "no-store", timeoutMs: 15000 },
  );
  return {
    ...result.data,
    pagination: paginationSchema.parse(result.meta.pagination),
  };
}
export const workflowDetail = z.object({
  rfq: rfqDetailSchema,
  catalog_products: z
    .array(
      z.object({
        _id: z.uuidv4(),
        manufacturer_id: z.uuidv4(),
        strength: z.string(),
        dosage_form: z.string(),
        pack_size: z.string(),
        cold_chain_required: z.boolean(),
      }),
    )
    .default([]),
  quotation: quotationDetailSchema.nullable(),
  email_delivery: z
    .array(
      z.object({
        _id: z.uuidv4(),
        template_id: z.string().optional(),
        status: z.enum([
          "PENDING",
          "PROCESSING",
          "SENT",
          "DELIVERED",
          "FAILED",
          "FAILED_RETRY",
          "BOUNCED",
          "DEAD",
        ]),
        attempt_count: z.number().int().nonnegative(),
        next_retry_at: z.iso.datetime().optional(),
        sent_at: z.iso.datetime().optional(),
        created_at: z.iso.datetime(),
      }),
    )
    .max(10)
    .default([]),
  workflow_status: workflowStatus,
});
export type WorkflowDetail = z.infer<typeof workflowDetail>;
export const readWorkflow = async (id: string, signal?: AbortSignal) =>
  (
    await apiRequest(
      `/v1/admin/rfq-workflow/${z.uuidv4().parse(id)}`,
      workflowDetail,
      { cache: "no-store", signal },
    )
  ).data;
export const guestWorkflow = z.object({
  rfq: z.object({
    id: z.uuidv4(),
    rfq_number: z.string(),
    buyer_name: z.string(),
    country: z.string(),
    received_at: z.iso.datetime({ offset: true }),
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        packaging_unit: z.string(),
      }),
    ),
  }),
  workflow_status: workflowStatus,
  quote: adminVersionSchema.nullable(),
  history: z.array(adminVersionSchema),
  messages: z.array(offerMessage),
  expires_at: z.iso.datetime({ offset: true }),
});
export type GuestWorkflow = z.infer<typeof guestWorkflow>;
export const readGuestWorkflow = async (token: string, signal?: AbortSignal) =>
  (
    await apiRequest(
      `/v1/public/rfq-workflow/${z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(token)}`,
      guestWorkflow,
      { cache: "no-store", signal, timeoutMs: 15000 },
    )
  ).data;
