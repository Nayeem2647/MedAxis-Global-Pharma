import { Search } from "lucide-react";
import { adminRfqsSchema } from "../../../../../lib/admin-contract";
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
  return (
    <div className="admin-products-page quotation-directory">
      <div className="admin-page-heading">
        <div>
          <AdminLink href="/admin/quotations">All quotations</AdminLink>
          <h1>Create quotation from RFQ</h1>
          <p className="muted">
            Select the enquiry first. Requested medicines, quantities and buyer
            details carry through to pricing.
          </p>
        </div>
      </div>
      <section className="admin-products-list">
        <div className="admin-products-toolbar">
          <form
            action="/admin/quotations/new"
            role="search"
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
            <button className="button secondary">Search RFQs</button>
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
          {result.result.data.map((row) => (
            <tr key={row.id}>
              <td>{row.rfq_number}</td>
              <td>
                <strong>{row.contact_snapshot.full_name}</strong>
                <span>{row.contact_snapshot.company_name}</span>
                <span>{row.contact_snapshot.email}</span>
              </td>
              <td>{row.destination_country}</td>
              <td>{quotationStatus(row.status)}</td>
              <td>{quotationDate(row.created_at)}</td>
              <td>
                <AdminLink
                  className="quotation-row-action"
                  href={
                    ["CLOSED", "CANCELLED", "CONVERTED", "QUOTED"].includes(
                      row.status,
                    )
                      ? `/admin/rfqs/${row.id}`
                      : `/admin/rfqs/${row.id}/quote`
                  }
                >
                  {["CLOSED", "CANCELLED", "CONVERTED", "QUOTED"].includes(
                    row.status,
                  )
                    ? "View RFQ / quotations"
                    : "Select RFQ"}
                </AdminLink>
              </td>
            </tr>
          ))}
        </ManagementTable>
        {!result.result.data.length && (
          <div className="quotation-empty">
            <h2>No matching RFQs</h2>
            <p>Try another reference or customer name.</p>
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
