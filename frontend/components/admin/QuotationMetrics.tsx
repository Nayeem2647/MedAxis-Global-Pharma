import type { z } from 'zod';
import type { summarySchema } from '../../lib/admin-management';
export function QuotationMetrics({ value }: { value: z.infer<typeof summarySchema> | null }) {
  return (
    <section className="admin-panel">
      <h2>Global quotation summary</h2>
      {value ? (
        <>
          <div className="admin-rate-grid">
            {(
              [
                ['Active quotations', value.active_quotations],
                ['Accepted · awaiting payment', value.accepted_payment_pending],
                ['Paid · ready to dispatch', value.ready_to_dispatch],
                ['Allocations expiring within 24h', value.expiring_allocations],
              ] as const
            ).map(([label, count]) => (
              <article className="admin-rate" key={label}>
                <h3>{label}</h3>
                <strong>{count}</strong>
              </article>
            ))}
          </div>
          <p className="small muted">
            Authoritative current-version totals · {value.as_of} · Allocation window {value.window_hours}h
          </p>
        </>
      ) : (
        <p>Global totals unavailable. No counts are inferred from this page.</p>
      )}
    </section>
  );
}
