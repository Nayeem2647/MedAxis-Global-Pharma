import { FilePlus2, Search } from "lucide-react";
import { adminRfqsSchema, rfqStatuses } from "../../../../../lib/admin-contract";
import { adminFiltersSchema, rfqQuery } from "../../../../../lib/admin-data";
import { requirePagination } from "../../../../../lib/admin-management";
import {
  quotationDate,
  quotationStatus,
} from "../../../../../lib/admin-quotations";
import { guardedAdminRead } from "../../../../../lib/admin-server";
import { AdminUnavailable } from "../../../../../components/admin/AdminFeedback";
import { AdminLink } from "../../../../../components/admin/AdminShell";
import {
  ManagementPagination,
  ManagementTable,
} from "../../../../../components/admin/ManagementTable";
import type { QuotationSearch } from "../../../../../components/admin/QuotationDirectory";

const RFQ_QUICK_TABS = [
  { label: "All RFQs", status: "" },
  { label: "Submitted", status: "SUBMITTED" },
  { label: "Under review", status: "UNDER_REVIEW" },
  { label: "Need clarification", status: "NEED_CLARIFICATION" },
  { label: "Quoted", status: "QUOTED" },
] as const;

export default async function NewQuotation({
  searchParams,
}: {
  searchParams: QuotationSearch;
}) {
  const parsed = adminFiltersSchema.safeParse(await searchParams);
  if (!parsed.success) return <AdminUnavailable problem={{ status: 422 }} />;
  const result = await guardedAdminRead(
    `/v1/admin/rfqs?${rfqQuery(parsed.data)}`,
    adminRfqsSchema,
  );
  if (!result.ok) return <AdminUnavailable problem={result.problem} />;
  let pagination;
  try {
    pagination = requirePagination(result.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }

  const filters = parsed.data;

  function rfqTabHref(status: string) {
    const next = new URLSearchParams(rfqQuery(filters));
    next.delete("page");
    if (status) next.set("status", status);
    else next.delete("status");
    const qs = next.toString();
    return `/admin/quotations/new${qs ? `?${qs}` : ""}`;
  }

  const hasFilters = Boolean(
    parsed.data.q || parsed.data.status || parsed.data.buyer_type,
  );

  return (
    <div className="admin-products-page quotation-directory">
      <div className="admin-page-heading">
        <div>
          <AdminLink href="/admin/quotations">← All quotations</AdminLink>
          <div className="admin-products-title">
            <span className="admin-products-title-icon">
              <FilePlus2 size={24} aria-hidden="true" />
            </span>
            <h1>Create quotation from RFQ</h1>
            <span className="admin-products-total">
              {pagination.total_items}
            </span>
          </div>
          <p className="muted">
            Select an open enquiry first. Requested medicines, quantities and
            buyer details carry through to pricing.
          </p>
        </div>
      </div>

      <section className="admin-products-list" aria-label="Available RFQs">
        <nav className="quotation-tabs" aria-label="RFQ stages">
          {RFQ_QUICK_TABS.map((tab) => (
            <AdminLink
              key={tab.label}
              href={rfqTabHref(tab.status)}
              current={(parsed.data.status ?? "") === tab.status}
            >
              {tab.label}
            </AdminLink>
          ))}
        </nav>

        <div className="admin-products-toolbar">
          <form
            action="/admin/quotations/new"
            role="search"
            aria-label="Filter RFQs"
            className="quotation-filters"
          >
            <label className="quotation-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search RFQs</span>
              <input
                type="search"
                name="q"
                defaultValue={parsed.data.q ?? ""}
                placeholder="Search RFQ or customer"
                maxLength={100}
              />
            </label>
            <label>
              <span className="sr-only">RFQ status</span>
              <select
                name="status"
                aria-label="RFQ status"
                defaultValue={parsed.data.status ?? ""}
              >
                <option value="">All RFQ statuses</option>
                {rfqStatuses.map((status) => (
                  <option key={status} value={status}>
                    {quotationStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Buyer type</span>
              <select
                name="buyer_type"
                aria-label="Buyer type"
                defaultValue={parsed.data.buyer_type ?? ""}
              >
                <option value="">All buyers</option>
                <option value="B2B_WHOLESALE">Wholesale (B2B)</option>
                <option value="B2C_PATIENT">Patient (B2C)</option>
              </select>
            </label>
            <button className="button secondary">Search RFQs</button>
            {hasFilters && (
              <AdminLink
                href="/admin/quotations/new"
                className="quotation-filter-clear"
              >
                Clear filters
              </AdminLink>
            )}
          </form>
        </div>

        <ManagementTable
          label="Choose an RFQ"
          columns={[
            "RFQ",
            "Customer",
            "Destination",
            "Status",
            "Received (Dhaka)",
            "Action",
          ]}
        >
          {result.result.data.map((row) => {
            const closedOrQuoted = [
              "CLOSED",
              "CANCELLED",
              "CONVERTED",
              "QUOTED",
            ].includes(row.status);
            return (
              <tr key={row.id}>
                <td>
                  <div className="quotation-ref-cell">
                    <AdminLink
                      href={`/admin/rfqs/${row.id}`}
                      className="quotation-reference"
                    >
                      {row.rfq_number}
                    </AdminLink>
                    <div className="quotation-rfq-tags">
                      <span className="quotation-version-tag">
                        {row.inquiry_type === "QUICK_QUOTE"
                          ? "Quick Quote"
                          : "Cart RFQ"}
                      </span>
                      {row.has_prescription && (
                        <span className="quotation-version-tag is-rx">Rx</span>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <strong>{row.contact_snapshot.full_name}</strong>
                  {(row.contact_snapshot.company_name ||
                    row.contact_snapshot.email) && (
                    <span className="quotation-customer-meta">
                      {[
                        row.contact_snapshot.company_name,
                        row.contact_snapshot.email,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </td>
                <td>{row.destination_country}</td>
                <td>
                  <span
                    className={`quotation-status quotation-status-${row.status.toLowerCase()}`}
                  >
                    {quotationStatus(row.status)}
                  </span>
                </td>
                <td>{quotationDate(row.created_at)}</td>
                <td>
                  <AdminLink
                    className="quotation-row-action"
                    href={
                      closedOrQuoted
                        ? `/admin/rfqs/${row.id}`
                        : `/admin/rfqs/${row.id}/quote`
                    }
                  >
                    {closedOrQuoted ? "View RFQ / quotations" : "Select RFQ"}
                  </AdminLink>
                </td>
              </tr>
            );
          })}
        </ManagementTable>

        {!result.result.data.length && (
          <div className="quotation-empty">
            <h2>No matching RFQs</h2>
            <p>Try another reference, status or customer name.</p>
          </div>
        )}

        <div className="admin-products-list-footer">
          <span>
            {pagination.total_items} enquiries · Active quotations are checked
            before a new draft can be created.
          </span>
          <ManagementPagination
            path="/admin/quotations/new"
            query={Object.fromEntries(
              new URLSearchParams(rfqQuery(parsed.data)),
            )}
            pagination={pagination}
            numbered
          />
        </div>
      </section>
    </div>
  );
}
