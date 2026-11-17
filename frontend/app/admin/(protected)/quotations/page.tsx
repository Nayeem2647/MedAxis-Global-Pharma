import { z } from "zod";
import { guardedAdminRead } from "../../../../lib/admin-server";
import {
  paramsFor,
  quotationQuery,
  quotationRow,
  summarySchema,
  requirePagination,
} from "../../../../lib/admin-management";
import { AdminUnavailable } from "../../../../components/admin/AdminFeedback";
import { AdminLink } from "../../../../components/admin/AdminShell";
import {
  ManagementPagination,
  ManagementTable,
} from "../../../../components/admin/ManagementTable";
import { QuotationMetrics } from "../../../../components/admin/QuotationMetrics";
export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let query: URLSearchParams;
  try {
    query = paramsFor(await searchParams, [
      "page",
      "limit",
      "q",
      "rfq_id",
      "overall_status",
      "status",
      "reservation_before",
    ]);
    quotationQuery.parse(Object.fromEntries(query));
  } catch {
    return <AdminUnavailable problem={{ status: 422 }} />;
  }
  const [list, summary] = await Promise.all([
    guardedAdminRead(
      `/v1/admin/quotations?${query}`,
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
  return (
    <>
      <h1>Quotations</h1>
      <QuotationMetrics value={summary.ok ? summary.result.data : null} />
      <section className="admin-panel">
        <form action="/admin/quotations" className="admin-filters">
          <label>
            Business reference
            <input
              name="q"
              defaultValue={query.get("q") ?? ""}
              maxLength={100}
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={query.get("status") ?? ""}>
              <option value="">All current versions</option>
              {quotationQuery.shape.status.unwrap().options.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Overall status
            <select
              name="overall_status"
              defaultValue={query.get("overall_status") ?? ""}
            >
              <option value="">All quotations</option>
              {["ACTIVE", "COMPLETED", "DECLINED", "EXPIRED"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Reservation before (ISO UTC)
            <input
              name="reservation_before"
              defaultValue={query.get("reservation_before") ?? ""}
              placeholder="2026-11-18T00:00:00Z"
            />
          </label>
          <button className="button primary">Apply filters</button>
          <AdminLink href="/admin/quotations">Clear</AdminLink>
        </form>
        <ManagementTable
          label="Global quotation directory"
          columns={[
            "Quotation",
            "State",
            "Commercial total",
            "Reservation",
            "Manage",
          ]}
        >
          {list.result.data.map((row) => (
            <tr key={row.id}>
              <td>
                {row.quotation_number}
                <span>Version {row.current_version}</span>
              </td>
              <td>
                {row.overall_status}
                <span>{row.version.status}</span>
              </td>
              <td>
                {row.version.billing_currency} {row.version.total_amount}
              </td>
              <td>
                {row.version.reservation_status}
                <span>
                  {row.version.reservation_expires_at ?? "No active deadline"}
                </span>
              </td>
              <td>
                <AdminLink href={`/admin/quotations/${row.id}`}>
                  Open quotation
                </AdminLink>
              </td>
            </tr>
          ))}
        </ManagementTable>
        {!list.result.data.length && <p>No matching quotations.</p>}
        <ManagementPagination
          path="/admin/quotations"
          query={Object.fromEntries(query)}
          pagination={pagination}
        />
      </section>
    </>
  );
}
