"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, Search } from "lucide-react";
import { ApiError } from "../../lib/api-client";
import {
  readLedger,
  type LedgerFilters,
  type LedgerPage,
} from "../../lib/rfq-workflow";
import {
  workflowLabels,
  workflowQueues,
  workflowStatuses,
} from "../../lib/workflow-contract";
import { countryCodes } from "../../lib/rfq";
import { AdminLink, useAdminLive } from "./AdminShell";
import {
  AdminFeedback,
  feedbackValue,
  type AdminFeedbackValue,
} from "./AdminFeedback";
import { WorkflowBadge } from "../quotation/WorkflowPrimitives";
const day = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
  }).format(new Date(value));
const time = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    timeStyle: "short",
  }).format(new Date(value));
const names = new Intl.DisplayNames(["en"], { type: "region" });
export function WorkflowLedger({
  filters,
  initialActive,
  initialHistory,
  initialProblem,
}: {
  filters: LedgerFilters;
  initialActive: LedgerPage | null;
  initialHistory: LedgerPage | null;
  initialProblem?: AdminFeedbackValue;
}) {
  const [activePage, setActivePage] = useState(initialActive);
  const [historyPage, setHistoryPage] = useState(initialHistory);
  const [problem, setProblem] = useState(initialProblem);
  const [busy, setBusy] = useState(false);
  const { active, revision, expire } = useAdminLive();
  const expireRef = useRef(expire);
  useEffect(() => {
    expireRef.current = expire;
  }, [expire]);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!active) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    const results = await Promise.allSettled([
      readLedger(filters, false, request.signal),
      readLedger(filters, true, request.signal),
    ]);
    if (request.signal.aborted) return;
    setProblem(undefined);
    if (results[0].status === "fulfilled") setActivePage(results[0].value);
    if (results[1].status === "fulfilled") setHistoryPage(results[1].value);
    for (const result of results)
      if (result.status === "rejected") {
        if (
          result.reason instanceof ApiError &&
          [401, 403].includes(result.reason.status)
        )
          expireRef.current();
        else setProblem(feedbackValue(result.reason));
      }
    setBusy(false);
  }, [active, filters]);
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh, revision]);
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  const href = (change: Record<string, string | number>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...change }))
      if (value !== "") query.set(key, String(value));
    return `/admin/quotations?${query}`;
  };
  const summary = activePage?.summary ?? historyPage?.summary;
  function rows(page: LedgerPage | null, history: boolean) {
    let previousDay = "";
    return (
      <section
        className="wf-ledger-section"
        aria-label={history ? "Closed history" : "Active quotations"}
      >
        <div className="wf-card-heading">
          <h2>{history ? "Closed history" : "Active quotations"}</h2>
          <span>
            {page
              ? `${page.pagination.total_items} requests`
              : "Count unavailable"}
          </span>
        </div>
        {!page ? (
          <p className="wf-empty">
            Requests could not be loaded. Refresh to try again.
          </p>
        ) : page.rows.length ? (
          <>
            <div
              className="wf-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={
                history ? "Closed history table" : "Active quotations table"
              }
            >
              <table className="wf-ledger">
                <thead>
                  <tr>
                    <th>Request / Received</th>
                    <th>Buyer name</th>
                    <th>Country</th>
                    <th>Prescription & attachments</th>
                    <th>Live status</th>
                    <th>Review</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => {
                    const date = day(row.created_at);
                    const group = date !== previousDay;
                    previousDay = date;
                    return (
                      <Fragment key={row._id}>
                        {group && (
                          <tr className="wf-date-row">
                            <th colSpan={7}>{date}</th>
                          </tr>
                        )}
                        <tr>
                          <td>
                            <AdminLink
                              href={`/admin/rfqs/${row._id}?workflow=1`}
                              className="wf-reference"
                            >
                              {row.rfq_number}
                            </AdminLink>
                            <small>{time(row.created_at)} · Dhaka</small>
                          </td>
                          <td>
                            <strong>
                              {row.contact_snapshot.company_name ||
                                row.contact_snapshot.full_name}
                            </strong>
                            <small>
                              {row.contact_snapshot.customer_type ===
                              "B2B_WHOLESALE"
                                ? "Wholesale enquiry"
                                : "Patient enquiry"}
                            </small>
                          </td>
                          <td>
                            {names.of(row.destination_country) ??
                              row.destination_country}
                          </td>
                          <td>
                            {row.attachments.length ? (
                              row.attachments.map((file, index) => (
                                <small key={file._id} className="wf-file-label">
                                  <FileText size={14} aria-hidden="true" />
                                  {file.attachment_kind === "SUPPORTING"
                                    ? "Supporting document"
                                    : "Prescription"}{" "}
                                  {index + 1}
                                </small>
                              ))
                            ) : (
                              <small>No attachments</small>
                            )}
                          </td>
                          <td>
                            <WorkflowBadge status={row.workflow_status} />
                          </td>
                          <td>
                            <AdminLink
                              href={`/admin/rfqs/${row._id}?workflow=1`}
                              className="button secondary"
                              title={`Review ${row.rfq_number}`}
                            >
                              Review
                            </AdminLink>
                          </td>
                          <td>
                            <AdminLink
                              href={`/admin/rfqs/${row._id}?workflow=1&action=1`}
                              className="button primary"
                              title={`Action for ${row.rfq_number}`}
                            >
                              Action
                            </AdminLink>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {page.pagination.total_pages > 1 && (
              <nav
                className="wf-pagination"
                aria-label={history ? "History pages" : "Active request pages"}
              >
                {page.pagination.has_prev && (
                  <AdminLink
                    className="button secondary"
                    href={href({
                      [history ? "history_page" : "page"]:
                        page.pagination.page - 1,
                    })}
                  >
                    Previous
                  </AdminLink>
                )}
                <span>
                  Page {page.pagination.page} of {page.pagination.total_pages}
                </span>
                {page.pagination.has_next && (
                  <AdminLink
                    className="button secondary"
                    href={href({
                      [history ? "history_page" : "page"]:
                        page.pagination.page + 1,
                    })}
                  >
                    Next
                  </AdminLink>
                )}
              </nav>
            )}
          </>
        ) : (
          <p className="wf-empty">No matching requests.</p>
        )}
      </section>
    );
  }
  return (
    <div className="workflow-page">
      <div className="wf-page-heading">
        <div>
          <p className="wf-eyebrow">QUOTATION DESK</p>
          <h1>{workflowQueues[filters.queue]}</h1>
          <p>Website requests and their current status</p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !active}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          {busy ? "Refreshing…" : "Refresh worklist"}
        </button>
      </div>
      <nav className="wf-queues" aria-label="Quotation queues">
        {Object.entries(workflowQueues).map(([key, label]) => (
          <AdminLink
            key={key}
            href={href({ queue: key, page: 1, history_page: 1 })}
            current={filters.queue === key}
          >
            {label}
          </AdminLink>
        ))}
      </nav>
      <div className="wf-metrics">
        {[
          ["Open requests", summary?.open_requests],
          ["Awaiting customer", summary?.awaiting_customer],
          ["Payment follow-up", summary?.payment_followup],
          ["Completed", summary?.completed],
        ].map(([label, count]) => (
          <article key={label} className="wf-card">
            <span>{label}</span>
            <strong>{count ?? "—"}</strong>
          </article>
        ))}
      </div>
      {problem && <AdminFeedback problem={problem} />}
      <div className="wf-card">
        <form className="wf-toolbar" action="/admin/quotations" method="get">
          <input type="hidden" name="queue" value={filters.queue} />
          <label>
            <span>
              <Search size={16} />
              Search buyer or RFQ
            </span>
            <input
              name="q"
              type="search"
              defaultValue={filters.q}
              maxLength={100}
              placeholder="Buyer name or RFQ number"
            />
          </label>
          <label>
            Country
            <select
              aria-label="Country"
              name="country"
              defaultValue={filters.country}
            >
              <option value="">All countries</option>
              {[...countryCodes].map((country) => (
                <option key={country} value={country}>
                  {names.of(country) ?? country}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Status"
              name="status"
              defaultValue={filters.status}
            >
              <option value="">All statuses</option>
              {workflowStatuses.map((status) => (
                <option key={status} value={status}>
                  {workflowLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <div className="wf-actions">
            <button className="button primary" type="submit">
              Apply filters
            </button>
            <AdminLink href="/admin/quotations" className="button secondary">
              Clear
            </AdminLink>
          </div>
        </form>
        {filters.queue !== "HISTORY" && rows(activePage, false)}
        {["ALL", "HISTORY"].includes(filters.queue) && rows(historyPage, true)}
      </div>
    </div>
  );
}
