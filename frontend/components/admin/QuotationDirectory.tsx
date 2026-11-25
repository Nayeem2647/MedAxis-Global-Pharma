import { z } from "zod";
import { AlertTriangle, FileText, Plus, Search } from "lucide-react";
import { guardedAdminRead } from "../../lib/admin-server";
import {
  paramsFor,
  quotationQuery,
  quotationRow,
  summarySchema,
  requirePagination,
} from "../../lib/admin-management";
import {
  quotationAction,
  quotationDate,
  quotationStatus,
  quotationTabHref,
  quotationWorklistLabels,
} from "../../lib/admin-quotations";
import { AdminUnavailable } from "./AdminFeedback";
import { AdminLink } from "./AdminShell";
import { ManagementPagination, ManagementTable } from "./ManagementTable";
import { QuotationMetrics } from "./QuotationMetrics";
import { QuotationRequests } from "./QuotationRequests";

export type QuotationSearch = Promise<
  Record<string, string | string[] | undefined>
>;

const DIRECTORY_STATUS_TABS = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "PAYMENT_RECEIVED",
  "DISPATCHED",
  "DELIVERED",
  "DECLINED",
  "VALIDITY_EXPIRED",
  "PAYMENT_EXPIRED",
] as const;

function deadlineUrgency(
  row: z.infer<typeof quotationRow>,
  referenceMs: number,
): "urgent" | "overdue" | null {
  if (!["DRAFT", "SENT", "ACCEPTED"].includes(row.version.status)) return null;
  const iso =
    row.version.status === "ACCEPTED"
      ? row.version.reservation_expires_at
      : row.version.valid_until;
  if (!iso) return null;
  const deadlineMs = Date.parse(iso);
  if (!Number.isFinite(deadlineMs)) return null;
  if (deadlineMs <= referenceMs) return "overdue";
  if (deadlineMs - referenceMs <= 24 * 60 * 60 * 1000) return "urgent";
  return null;
}

export async function QuotationDirectory({
  searchParams,
  followUps = false,
}: {
  searchParams: QuotationSearch;
  followUps?: boolean;
}) {
  const path = followUps ? "/admin/quotations/follow-ups" : "/admin/quotations/documents";
  let params: URLSearchParams;
  try {
    params = paramsFor(await searchParams, [
      "page",
      "limit",
      "q",
      "rfq_id",
      "overall_status",
      "status",
      "reservation_before",
      "worklist",
    ]);
    if (followUps && !params.has("worklist"))
      params.set("worklist", "AWAITING_PAYMENT");
    quotationQuery.parse(Object.fromEntries(params));
  } catch {
    return <AdminUnavailable problem={{ status: 422 }} />;
  }
  const query = Object.fromEntries(params);
  const [list, summary] = await Promise.all([
    guardedAdminRead(
      `/v1/admin/quotations?${params}`,
      z.array(quotationRow).max(100),
    ),
    guardedAdminRead(
      "/v1/admin/quotations/summary?window_hours=24",
      summarySchema,
    ),
  ]);
  if (!list.ok) return <AdminUnavailable problem={list.problem} />;
  let pagination;
  try {
    pagination = requirePagination(list.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }
  const tabs = followUps
    ? Object.entries(quotationWorklistLabels).map(([worklist, label]) => ({
        label,
        filter: { worklist },
        current: query.worklist === worklist,
      }))
    : [
        {
          label: "All quotations",
          filter: {},
          current: !query.status && !query.worklist,
        },
        ...DIRECTORY_STATUS_TABS.map((status) => ({
          label: quotationStatus(status),
          filter: { status },
          current: query.status === status && !query.worklist,
        })),
      ];
  const rows = list.result.data;
  const first = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const summaryData = summary.ok ? summary.result.data : null;
  const referenceMs = summaryData
    ? Date.parse(summaryData.as_of)
    : Date.now();
  return (
    <div className="admin-products-page quotation-directory">
      <div className="admin-page-heading">
        <div>
          <div className="admin-products-title">
            <span className="admin-products-title-icon">
              <FileText size={24} aria-hidden="true" />
            </span>
            <h1>{followUps ? "Quotation follow-ups" : "Quotations"}</h1>
            <span className="admin-products-total">
              {pagination.total_items}
            </span>
          </div>
          <p className="muted">
            {followUps
              ? "Prioritize payment deadlines and dispatch work. Open a quotation to take action."
              : "Prepare, send and track customer quotations in one place."}
          </p>
        </div>
        <div className="quotation-heading-actions">
          <AdminLink
            href={
              followUps ? "/admin/quotations" : "/admin/quotations/overview"
            }
            className="button secondary"
          >
            {followUps ? "All quotations" : "Overview & workflow"}
          </AdminLink>
          <AdminLink href="/admin/quotations/new" className="button primary">
            <Plus size={18} aria-hidden="true" />
            Create from RFQ
          </AdminLink>
        </div>
      </div>
      {!followUps && <QuotationRequests />}
      <QuotationMetrics value={summaryData} compact />
      <section className="admin-products-list" aria-label="Quotation list">
        <nav className="quotation-tabs" aria-label="Quotation views">
          {tabs.map((tab) => (
            <AdminLink
              key={tab.label}
              href={quotationTabHref(path, query, tab.filter)}
              current={tab.current}
            >
              {tab.label}
            </AdminLink>
          ))}
        </nav>
        <div className="admin-products-toolbar">
          <form
            method="get"
            action={path}
            className="quotation-filters"
            role="search"
            aria-label="Search quotations"
          >
            {["rfq_id", "worklist", "reservation_before", "limit"].map(
              (key) =>
                query[key] && (
                  <input
                    key={key}
                    type="hidden"
                    name={key}
                    value={query[key]}
                  />
                ),
            )}
            <label className="quotation-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search quotation, RFQ or customer</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ""}
                maxLength={100}
                placeholder="Quotation, RFQ, customer or email"
              />
            </label>
            <label>
              <span className="sr-only">Status</span>
              <select
                name="status"
                aria-label="Status"
                defaultValue={query.status ?? ""}
              >
                <option value="">All statuses</option>
                {quotationQuery.shape.status.unwrap().options.map((value) => (
                  <option key={value} value={value}>
                    {quotationStatus(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Overall status</span>
              <select
                name="overall_status"
                aria-label="Overall status"
                defaultValue={query.overall_status ?? ""}
              >
                <option value="">All records</option>
                {["ACTIVE", "COMPLETED", "DECLINED", "EXPIRED"].map((value) => (
                  <option key={value} value={value}>
                    {quotationStatus(value)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button secondary">
              Apply filters
            </button>
            {params.size > (followUps ? 1 : 0) && (
              <AdminLink href={path} className="quotation-filter-clear">
                Clear filters
              </AdminLink>
            )}
          </form>
        </div>
        {query.worklist && (
          <p className="quotation-filter-note">
            Showing:{" "}
            {
              quotationWorklistLabels[
                query.worklist as keyof typeof quotationWorklistLabels
              ]
            }
            . Counts reflect the latest server state.
          </p>
        )}
        <ManagementTable
          label="Global quotation directory"
          columns={[
            "Quotation",
            "Customer",
            "RFQ",
            "Amount",
            "Status",
            "Deadline (Dhaka)",
            "Action",
          ]}
        >
          {rows.map((row) => {
            const urgency = deadlineUrgency(row, referenceMs);
            return (
              <tr key={row.id}>
                <td>
                  <div className="quotation-ref-cell">
                    <AdminLink
                      href={`/admin/quotations/${row.id}`}
                      className="quotation-reference"
                    >
                      {row.quotation_number}
                    </AdminLink>
                    <span className="quotation-version-tag">
                      Version {row.current_version}
                    </span>
                  </div>
                </td>
                <td>
                  <strong>
                    {row.customer?.full_name ?? "Open quotation for customer"}
                  </strong>
                  {(row.customer?.company_name || row.customer?.email) && (
                    <span className="quotation-customer-meta">
                      {[row.customer.company_name, row.customer.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </td>
                <td>
                  <AdminLink
                    href={`/admin/rfqs/${row.rfq_id}`}
                    className="quotation-rfq-link"
                  >
                    {row.rfq_number ?? "View RFQ"}
                  </AdminLink>
                </td>
                <td className="quotation-amount">
                  {row.version.billing_currency} {row.version.total_amount}
                </td>
                <td>
                  <div className="quotation-status-cell">
                    <span
                      className={`quotation-status quotation-status-${row.version.status.toLowerCase()}`}
                    >
                      {quotationStatus(row.version.status)}
                    </span>
                    <span className="quotation-overall-note">
                      {quotationStatus(row.overall_status)}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="quotation-deadline-cell">
                    <span>
                      {quotationDate(
                        row.version.status === "ACCEPTED"
                          ? row.version.reservation_expires_at
                          : row.version.valid_until,
                      )}
                    </span>
                    <div className="quotation-deadline-meta">
                      <span>
                        {row.version.status === "ACCEPTED"
                          ? "Payment deadline"
                          : row.version.valid_until
                            ? "Quote validity"
                            : "Not issued"}
                      </span>
                      {urgency === "urgent" && (
                        <span className="quotation-deadline-badge is-urgent">
                          <AlertTriangle size={12} aria-hidden="true" />
                          Within 24h
                        </span>
                      )}
                      {urgency === "overdue" && (
                        <span className="quotation-deadline-badge is-overdue">
                          Deadline passed
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <AdminLink
                    className="quotation-row-action"
                    href={`/admin/quotations/${row.id}`}
                  >
                    {quotationAction(row.version.status)}
                  </AdminLink>
                </td>
              </tr>
            );
          })}
        </ManagementTable>
        {!rows.length && (
          <div className="quotation-empty">
            <FileText size={32} aria-hidden="true" />
            <h2>No matching quotations</h2>
            <p>
              Change your filters or select an RFQ to prepare a new quotation.
            </p>
            <AdminLink href="/admin/quotations/new" className="button primary">
              Create from RFQ
            </AdminLink>
          </div>
        )}
        <div className="admin-products-list-footer">
          <span>
            {first}–{rows.length ? first + rows.length - 1 : 0} of{" "}
            {pagination.total_items} quotations
          </span>
          <ManagementPagination
            path={path}
            query={query}
            pagination={pagination}
            numbered
          />
        </div>
      </section>
    </div>
  );
}
