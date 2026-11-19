import { guardedAdminRead } from "../../../../../lib/admin-server";
import { summarySchema } from "../../../../../lib/admin-management";
import { AdminLink } from "../../../../../components/admin/AdminShell";
import { QuotationMetrics } from "../../../../../components/admin/QuotationMetrics";
export default async function QuotationOverview() {
  const summary = await guardedAdminRead(
    "/v1/admin/quotations/summary?window_hours=24",
    summarySchema,
  );
  return (
    <div className="admin-products-page">
      <div className="admin-page-heading">
        <div>
          <h1>Quotation overview</h1>
          <p className="muted">
            See what needs attention, then continue the next step.
          </p>
        </div>
        <AdminLink href="/admin/quotations/new" className="button primary">
          Create from RFQ
        </AdminLink>
      </div>
      <QuotationMetrics value={summary.ok ? summary.result.data : null} />
      <section className="admin-panel">
        <h2>Your quotation workflow</h2>
        <ol className="quotation-workflow">
          <li>
            <strong>Select an RFQ</strong>
            <p>
              Review the buyer, requested medicines, quantities and destination.
            </p>
          </li>
          <li>
            <strong>Prepare pricing</strong>
            <p>
              Set availability, procurement costs, markup and shipping terms.
            </p>
          </li>
          <li>
            <strong>Review and send</strong>
            <p>
              Save a draft, verify customer totals and bank details, then issue
              it.
            </p>
          </li>
          <li>
            <strong>Fulfill the order</strong>
            <p>Record verified payment, dispatch details and delivery.</p>
          </li>
        </ol>
        <div className="admin-filter-actions">
          <AdminLink href="/admin/quotations" className="button secondary">
            All quotations
          </AdminLink>
          <AdminLink
            href="/admin/quotations/follow-ups"
            className="button secondary"
          >
            Open follow-ups
          </AdminLink>
        </div>
      </section>
    </div>
  );
}
