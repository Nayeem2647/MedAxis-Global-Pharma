import type { z } from "zod";
import type { summarySchema } from "../../lib/admin-management";
import { quotationDate } from "../../lib/admin-quotations";
import { AdminLink } from "./AdminShell";

export function QuotationMetrics({
  value,
  compact = false,
}: {
  value: z.infer<typeof summarySchema> | null;
  compact?: boolean;
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
      "default",
    ],
    [
      "Drafts",
      value.drafts,
      "?overall_status=ACTIVE&status=DRAFT",
      "Review and send",
      "neutral",
    ],
    [
      "Sent to customer",
      value.sent,
      "?overall_status=ACTIVE&status=SENT",
      "Waiting for a decision",
      "info",
    ],
    [
      "Awaiting payment",
      value.accepted_payment_pending,
      "?worklist=AWAITING_PAYMENT",
      "Accepted with an active allocation",
      "warn",
    ],
    [
      "Ready to dispatch",
      value.ready_to_dispatch,
      "?worklist=READY_TO_DISPATCH",
      "Verified payment recorded",
      "success",
    ],
    [
      "Expiring within 24h",
      value.expiring_allocations,
      "?worklist=EXPIRING",
      "Active payment deadlines",
      value.expiring_allocations > 0 ? "danger" : "neutral",
    ],
  ] as const;

  return (
    <section
      aria-label="Quotation summary"
      className={compact ? "quotation-summary is-compact" : "quotation-summary"}
    >
      <div
        className={
          compact ? "quotation-metrics is-compact" : "quotation-metrics"
        }
      >
        {cards.map(([label, count, query, hint, tone]) => (
          <AdminLink
            key={label}
            href={`/admin/quotations${query}`}
            className={`quotation-metric is-tone-${tone}`}
          >
            <span>{label}</span>
            <strong>{count ?? "—"}</strong>
            {!compact && <small>{hint}</small>}
          </AdminLink>
        ))}
      </div>
      <p className="quotation-summary-meta small muted">
        All quotations · Updated {quotationDate(value.as_of)} (Dhaka)
      </p>
    </section>
  );
}
