import { z } from "zod";
import { ArrowRight, Clock, FileEdit, Plus } from "lucide-react";
import { guardedAdminRead } from "../../../../../lib/admin-server";
import {
  quotationRow,
  summarySchema,
} from "../../../../../lib/admin-management";
import {
  quotationAction,
  quotationDate,
  quotationStatus,
} from "../../../../../lib/admin-quotations";
import { AdminLink } from "../../../../../components/admin/AdminShell";
import { QuotationMetrics } from "../../../../../components/admin/QuotationMetrics";
import { QuotationRequests } from "../../../../../components/admin/QuotationRequests";

export default async function QuotationOverview() {
  const [summary, draftsRes, expiringRes] = await Promise.all([
    guardedAdminRead("/v1/admin/quotations/summary?window_hours=24", summarySchema),
    guardedAdminRead(
      "/v1/admin/quotations?status=DRAFT&limit=5",
      z.array(quotationRow).max(100),
    ),
    guardedAdminRead(
      "/v1/admin/quotations?worklist=EXPIRING&limit=5",
      z.array(quotationRow).max(100),
    ),
  ]);
  const drafts = draftsRes.ok ? draftsRes.result.data : [];
  const expiring = expiringRes.ok ? expiringRes.result.data : [];

  return (
    <div className="admin-products-page">
      <div className="admin-page-heading">
        <div>
          <h1>Quotation overview</h1>
          <p className="muted">
            See what needs attention, then continue the next step.
          </p>
        </div>
        <div className="quotation-heading-actions">
          <AdminLink href="/admin/quotations" className="button secondary">
            All quotations
          </AdminLink>
          <AdminLink href="/admin/quotations/new" className="button primary">
            <Plus size={18} aria-hidden="true" />
            Create from RFQ
          </AdminLink>
        </div>
      </div>

      <QuotationRequests />
      <QuotationMetrics value={summary.ok ? summary.result.data : null} />

      <div className="quotation-overview-grid">
        <section className="admin-panel quotation-queue-card">
          <div className="quotation-queue-header">
            <h2>
              <FileEdit size={18} aria-hidden="true" />
              Pending drafts
            </h2>
            <AdminLink
              href="/admin/quotations?overall_status=ACTIVE&status=DRAFT"
              className="quotation-queue-link"
            >
              View all <ArrowRight size={15} aria-hidden="true" />
            </AdminLink>
          </div>
          {drafts.length ? (
            <ul className="quotation-queue-list">
              {drafts.map((row) => (
                <li key={row.id}>
                  <div className="quotation-queue-main">
                    <AdminLink
                      href={`/admin/quotations/${row.id}`}
                      className="quotation-reference"
                    >
                      {row.quotation_number}
                    </AdminLink>
                    <span>
                      {row.customer?.full_name ?? "Customer draft"} · v
                      {row.current_version}
                    </span>
                  </div>
                  <div className="quotation-queue-aside">
                    <strong>
                      {row.version.billing_currency} {row.version.total_amount}
                    </strong>
                    <AdminLink
                      href={`/admin/quotations/${row.id}`}
                      className="quotation-row-action"
                    >
                      {quotationAction(row.version.status)}
                    </AdminLink>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              No saved drafts waiting to be reviewed or issued right now.
            </p>
          )}
        </section>

        <section className="admin-panel quotation-queue-card">
          <div className="quotation-queue-header">
            <h2>
              <Clock size={18} aria-hidden="true" />
              Expiring within 24h
            </h2>
            <AdminLink
              href="/admin/quotations/follow-ups?worklist=EXPIRING"
              className="quotation-queue-link"
            >
              Open follow-ups <ArrowRight size={15} aria-hidden="true" />
            </AdminLink>
          </div>
          {expiring.length ? (
            <ul className="quotation-queue-list">
              {expiring.map((row) => (
                <li key={row.id}>
                  <div className="quotation-queue-main">
                    <AdminLink
                      href={`/admin/quotations/${row.id}`}
                      className="quotation-reference"
                    >
                      {row.quotation_number}
                    </AdminLink>
                    <span>
                      {row.customer?.full_name ?? "Buyer"} ·{" "}
                      {quotationStatus(row.version.status)}
                    </span>
                    <small className="quotation-deadline-badge is-urgent">
                      Due{" "}
                      {quotationDate(
                        row.version.reservation_expires_at ??
                          row.version.valid_until,
                      )}
                    </small>
                  </div>
                  <div className="quotation-queue-aside">
                    <strong>
                      {row.version.billing_currency} {row.version.total_amount}
                    </strong>
                    <AdminLink
                      href={`/admin/quotations/${row.id}`}
                      className="quotation-row-action"
                    >
                      {quotationAction(row.version.status)}
                    </AdminLink>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              No active payment allocations expiring in the next 24 hours.
            </p>
          )}
        </section>
      </div>

      <section className="admin-panel">
        <h2>Your quotation workflow</h2>
        <ol className="quotation-workflow">
          <li>
            <strong>1. Select an RFQ</strong>
            <p>
              Review the buyer, requested medicines, quantities and destination.
            </p>
          </li>
          <li>
            <strong>2. Prepare pricing</strong>
            <p>
              Set availability, procurement costs, markup and shipping terms.
            </p>
          </li>
          <li>
            <strong>3. Review and send</strong>
            <p>
              Save a draft, verify customer totals and bank details, then issue
              it.
            </p>
          </li>
          <li>
            <strong>4. Fulfill the order</strong>
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
