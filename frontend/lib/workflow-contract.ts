import { z } from "zod";
export const workflowStatuses = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "SENT",
  "CHANGE_REQUESTED",
  "REVISED",
  "COUNTEROFFER",
  "RETAINED",
  "APPROVED",
  "AWAITING_PAYMENT",
  "PAID",
  "DISPATCHED",
  "COMPLETED",
  "DECLINED",
  "CLOSED",
  "EXPIRED",
] as const;
export const workflowStatus = z.enum(workflowStatuses);
export const workflowLabels: Record<(typeof workflowStatuses)[number], string> =
  {
    SUBMITTED: "New request",
    UNDER_REVIEW: "Under review",
    SENT: "Sent to customer",
    CHANGE_REQUESTED: "Change requested",
    REVISED: "Revised offer sent",
    COUNTEROFFER: "Counteroffer sent",
    RETAINED: "Current offer retained",
    APPROVED: "Approved by customer",
    AWAITING_PAYMENT: "Awaiting payment",
    PAID: "Paid",
    DISPATCHED: "Dispatched",
    COMPLETED: "Completed",
    DECLINED: "Declined by customer",
    CLOSED: "Closed",
    EXPIRED: "Offer expired",
  };
export const offerMessage = z.object({
  id: z.uuidv4(),
  author: z.enum(["BUYER", "ADMIN"]),
  kind: z.enum(["REQUEST", "REVISED", "COUNTEROFFER", "RETAINED"]),
  body: z.string().max(5000),
  version_number: z.number().int().positive(),
  version_id: z.uuidv4().optional(),
  created_at: z.iso.datetime({ offset: true }),
  scope: z.enum(["MEDICINE", "DELIVERY", "BOTH"]).optional(),
  proposed_medicine_subtotal: z.string().optional(),
  proposed_delivery_charge: z.string().optional(),
});
export const rfqWorkflow = z.object({
  enabled: z.boolean(),
  reviewed_at: z.iso.datetime({ offset: true }).optional(),
  reviewed_by: z.uuidv4().optional(),
  pending_request_id: z.uuidv4().optional(),
  offer_state: z
    .enum(["CHANGE_REQUESTED", "REVISED", "COUNTEROFFER", "RETAINED"])
    .optional(),
  messages: z.array(offerMessage).max(200).optional(),
});
export const workflowQueues = {
  ALL: "All Quotations",
  REVIEW: "Review & quote",
  CUSTOMER: "Customer review",
  NEGOTIATION: "Change requests",
  PAYMENT: "Payment",
  SHIPPING: "Dispatch & delivery",
  HISTORY: "Closed history",
} as const;
export function workflowStage(status: string) {
  return status === "COMPLETED"
    ? 7
    : status === "DISPATCHED"
      ? 6
      : status === "PAID"
        ? 5
        : status === "AWAITING_PAYMENT"
          ? 4
          : status === "APPROVED"
            ? 3
            : [
                  "SENT",
                  "CHANGE_REQUESTED",
                  "REVISED",
                  "COUNTEROFFER",
                  "RETAINED",
                  "EXPIRED",
                  "DECLINED",
                ].includes(status)
              ? 2
              : status === "UNDER_REVIEW"
                ? 1
                : 0;
}
export const workflowSteps = [
  "Review",
  "Create quote",
  "Customer review",
  "Payment request",
  "Payment",
  "Dispatch",
  "Delivered",
];
