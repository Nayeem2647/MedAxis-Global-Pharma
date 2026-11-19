import type { z } from "zod";
import type { summarySchema } from "../../lib/admin-management";
import { quotationDate } from "../../lib/admin-quotations";
import { AdminLink } from "./AdminShell";
export function QuotationMetrics({
  value,
}: {
  value: z.infer<typeof summarySchema> | null;
}) {
  if (!value)
    return (
      <p className="admin-feedback">
        Quotation summary is unavailable. Refresh to try again.
      </p>
    );
  const cards = [
    [
      "Active quotations",
      value.active_quotations,
      "?overall_status=ACTIVE",
      "All open work",
    ],
    [
      "Drafts",
      value.drafts,
      "?overall_status=ACTIVE&status=DRAFT",
      "Review and send",
    ],
    [
      "Sent to customer",
      value.sent,
      "?overall_status=ACTIVE&status=SENT",
      "Waiting for a decision",
    ],
    [
      "Awaiting payment",
      value.accepted_payment_pending,
      "?worklist=AWAITING_PAYMENT",
      "Accepted with an active allocation",
    ],
    [
      "Ready to dispatch",
      value.ready_to_dispatch,
      "?worklist=READY_TO_DISPATCH",
      "Verified payment recorded",
    ],
    [
      "Expiring within 24h",
      value.expiring_allocations,
      "?worklist=EXPIRING",
      "Active payment deadlines",
    ],
  ] as const;
  return (
    <section aria-label="Quotation summary" className="quotation-summary">
      <div className="quotation-metrics">
        {cards.map(([label, count, query, hint]) => (
          <AdminLink
            key={label}
            href={`/admin/quotations${query}`}
            className="quotation-metric"
          >
            <span>{label}</span>
            <strong>{count ?? "—"}</strong>
            <small>{hint}</small>
          </AdminLink>
        ))}
      </div>
      <p className="small muted">
        All quotations · Updated {quotationDate(value.as_of)} (Dhaka)
      </p>
    </section>
  );
}
