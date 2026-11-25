"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { FileText, Mail, ShieldCheck } from "lucide-react";
import { apiRequest, ApiError, type JsonValue } from "../../lib/api-client";
import { readWorkflow, type WorkflowDetail } from "../../lib/rfq-workflow";
import {
  type AdminSettings,
  quoteWriteResult,
  type RfqDetail,
} from "../../lib/admin-workflow";
import { workflowLabels } from "../../lib/workflow-contract";
import { quotationDate } from "../../lib/admin-quotations";
import { useAdminOperation } from "../../hooks/useAdminOperation";
import { AdminLink, useAdminLive } from "./AdminShell";
import { AdminOperationFeedback } from "./AdminOperationFeedback";
import { WorkflowDialog } from "./WorkflowDialog";
import { WorkflowQuoteEditor } from "./WorkflowQuoteEditor";
import { PrescriptionViewer } from "./PrescriptionViewer";
import { BankFields, bankFromForm } from "./FastQuoteEditor";
import {
  WorkflowBadge,
  WorkflowOfferSummary,
  WorkflowProgress,
  WorkflowThread,
  money,
} from "../quotation/WorkflowPrimitives";

type Mode =
  | "actions"
  | "review"
  | "create"
  | "preview"
  | "respond"
  | "payment-request"
  | "payment"
  | "dispatch"
  | "delivery"
  | "guest-link"
  | null;
export function RfqWorkflowWorkspace({
  initial,
  settings,
  initialAction = false,
}: {
  initial: WorkflowDetail;
  settings: AdminSettings | null;
  initialAction?: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [data, setData] = useState(initial);
  const [mode, setMode] = useState<Mode>(initialAction ? "actions" : null);
  const [file, setFile] = useState<string>();
  const latest = useRef(initial);
  const stale = useRef<AbortController | null>(null);
  const { revision, expire } = useAdminLive();
  const expiry = useRef(expire);
  expiry.current = expire;
  const { operation, state } = useAdminOperation();
  const rfq = data.rfq;
  const current = data.quotation?.versions.find(
    (version) => version.id === data.quotation?.quotation.current_version_id,
  );
  const disabled = !ready || state.busy || state.blocked;
  async function refresh() {
    stale.current?.abort();
    const controller = new AbortController();
    stale.current = controller;
    try {
      const next = await readWorkflow(rfq.id, controller.signal);
      if (controller.signal.aborted) return;
      if (
        JSON.stringify([
          next.rfq.updated_at,
          next.workflow_status,
          next.quotation?.quotation.current_version_id,
          next.quotation?.versions.at(-1)?.updated_at,
        ]) !==
        JSON.stringify([
          latest.current.rfq.updated_at,
          latest.current.workflow_status,
          latest.current.quotation?.quotation.current_version_id,
          latest.current.quotation?.versions.at(-1)?.updated_at,
        ])
      )
        operation.reconcileAdvancedVersion();
      latest.current = next;
      setData(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && [401, 403].includes(error.status))
        expiry.current();
      throw error;
    }
  }
  useEffect(() => {
    if (revision) void operation.refresh(refresh);
    return () => stale.current?.abort();
    // Each event reconciles this RFQ without replaying any mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  const workflowPath = `/v1/admin/rfq-workflow/${rfq.id}`;
  async function write(
    path: string,
    body: JsonValue,
    next: Mode = null,
    method: "POST" | "PATCH" = "POST",
  ) {
    await operation.run(
      () =>
        apiRequest(path, z.unknown(), { method, json: body, timeoutMs: 20000 }),
      refresh,
      () => setMode(next),
    );
  }
  const reviewed = Boolean(rfq.workflow?.reviewed_at);
  const canReview = [
    "SUBMITTED",
    "UNDER_REVIEW",
    "NEED_CLARIFICATION",
  ].includes(rfq.status);
  const canCreate =
    reviewed &&
    !rfq.items.some((line) => line.item_availability_status === "SOURCING") &&
    rfq.items.some((line) => line.item_availability_status === "AVAILABLE");
  const action =
    data.workflow_status === "CHANGE_REQUESTED"
      ? {
          title: "Customer requested a change",
          hint: "Review the buyer’s proposal and send a revised offer, a counteroffer, or a written explanation.",
          mode: "respond" as Mode,
          label: "Respond to request",
        }
      : current?.status === "DRAFT"
        ? {
            title: "Prepare the quotation",
            hint: "Review the customer-facing preview and verify bank details before sending.",
            mode: "preview" as Mode,
            label: "Preview quotation",
          }
        : data.workflow_status === "APPROVED"
          ? {
              title: "Customer reviewed and approved",
              hint: "Send the payment request using the approved offer and verified bank instructions.",
              mode: "payment-request" as Mode,
              label: "Request payment",
            }
          : data.workflow_status === "AWAITING_PAYMENT"
            ? {
                title: "Awaiting payment",
                hint: "Verify the amount, currency and bank transaction reference before marking this request as paid.",
                mode: "payment" as Mode,
                label: "Mark as paid",
              }
            : data.workflow_status === "PAID"
              ? {
                  title: "Ready to dispatch",
                  hint: "Record the courier and tracking number to share them with the customer.",
                  mode: "dispatch" as Mode,
                  label: "Add delivery details",
                }
              : data.workflow_status === "DISPATCHED"
                ? {
                    title: "In transit",
                    hint: "Confirm delivery after the courier records a successful handover.",
                    mode: "delivery" as Mode,
                    label: "Complete delivery",
                  }
                : [
                      "SENT",
                      "REVISED",
                      "COUNTEROFFER",
                      "RETAINED",
                      "EXPIRED",
                    ].includes(data.workflow_status)
                  ? {
                      title: workflowLabels[data.workflow_status],
                      hint: "The private request link shows the customer their latest offer and order status.",
                      mode: "guest-link" as Mode,
                      label: "Manage guest access",
                    }
                  : ["COMPLETED", "DECLINED", "CLOSED"].includes(
                        data.workflow_status,
                      )
                    ? {
                        title: workflowLabels[data.workflow_status],
                        hint: "This record is available in closed history with its offers and conversation.",
                        mode: null,
                        label: "Closed request",
                      }
                    : {
                        title: reviewed
                          ? "Prepare the quotation"
                          : "Review the request",
                        hint: reviewed
                          ? canCreate
                            ? "Set selling prices and weights, then preview the quotation before sending."
                            : "Resolve sourcing lines and mark at least one medicine available before creating the quotation."
                          : "Check buyer details, requested medicines and private attachments. Save the review to unlock quotation creation.",
                        mode:
                          reviewed && canCreate
                            ? ("create" as Mode)
                            : ("review" as Mode),
                        label:
                          reviewed && canCreate
                            ? "Create quotation"
                            : "Review request",
                      };
  function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !data.quotation) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    if (mode === "preview") {
      let bank;
      try {
        bank = bankFromForm(form);
      } catch {
        return;
      }
      void write(`/v1/admin/quotations/${data.quotation.quotation.id}/send`, {
        expected_version_id: current.id,
        validity_days: Number(form.get("validity")),
        allow_stale_fx: true,
        bank_details: bank,
      });
    } else if (mode === "payment-request")
      void write(`${workflowPath}/payment-request`, {
        expected_version_id: current.id,
      });
    else if (mode === "payment")
      void write(
        `/v1/admin/quotations/${data.quotation.quotation.id}/fulfillment`,
        {
          expected_version_id: current.id,
          status: "PAYMENT_RECEIVED",
          amount: text("amount"),
          currency: text("currency"),
          wire_reference: text("reference"),
        },
        null,
        "PATCH",
      );
    else if (mode === "dispatch") {
      const date = text("eta");
      void write(
        `/v1/admin/quotations/${data.quotation.quotation.id}/fulfillment`,
        {
          expected_version_id: current.id,
          status: "DISPATCHED",
          courier_name: text("courier"),
          awb_tracking_number: text("tracking"),
          ...(date
            ? {
                estimated_delivery: new Date(
                  `${date}T18:00:00+06:00`,
                ).toISOString(),
              }
            : {}),
        },
        null,
        "PATCH",
      );
    } else if (mode === "delivery")
      void write(
        `/v1/admin/quotations/${data.quotation.quotation.id}/fulfillment`,
        {
          expected_version_id: current.id,
          status: "DELIVERED",
          delivery_evidence: text("evidence"),
        },
        null,
        "PATCH",
      );
  }
  return (
    <div className="workflow-page">
      <AdminLink href="/admin/quotations" className="wf-back">
        All Quotations
      </AdminLink>
      <div className="wf-page-heading">
        <div>
          <h1>{rfq.rfq_number}</h1>
          <p>
            {rfq.contact_snapshot.company_name ||
              rfq.contact_snapshot.full_name}{" "}
            · {rfq.destination_country} · Website request
          </p>
        </div>
        <div className="wf-actions">
          <WorkflowBadge status={data.workflow_status} />
          <button
            type="button"
            className="button secondary"
            disabled={state.busy}
            onClick={() => void operation.refresh(refresh)}
          >
            Refresh record
          </button>
        </div>
      </div>
      <AdminOperationFeedback state={state} />
      <WorkflowProgress status={data.workflow_status} />
      <div className="wf-columns">
        <div className="wf-stack">
          <section className="wf-card wf-panel">
            <h2>Buyer details</h2>
            <AdminLink
              href={`/admin/rfqs/${rfq.id}/sourcing`}
              className="wf-back"
            >
              Internal sourcing & clarification
            </AdminLink>
            <dl className="wf-facts">
              <div>
                <dt>Buyer</dt>
                <dd>{rfq.contact_snapshot.full_name}</dd>
              </div>
              <div>
                <dt>Request type</dt>
                <dd>
                  {rfq.contact_snapshot.customer_type === "B2B_WHOLESALE"
                    ? "Wholesale enquiry"
                    : "Patient enquiry"}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  {rfq.contact_snapshot.email ??
                    "Not supplied on original request"}
                </dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>
                  {[rfq.destination_city_port, rfq.destination_country]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
              </div>
              <div>
                <dt>Received (Dhaka)</dt>
                <dd>{quotationDate(rfq.created_at)}</dd>
              </div>
              <div>
                <dt>Preferred currency</dt>
                <dd>{rfq.preferred_currency}</dd>
              </div>
            </dl>
          </section>
          <section className="wf-card">
            <div className="wf-card-heading">
              <h2>Requested items</h2>
              <small>{rfq.items.length} items</small>
            </div>
            <div className="wf-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Quantity</th>
                    <th>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {rfq.items.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <strong>
                          {line.product_snapshot?.brand_name ??
                            line.custom_medicine_name}
                        </strong>
                        <small>
                          {line.custom_strength} ·{" "}
                          {line.product_snapshot?.pack_size}
                        </small>
                        {line.line_notes && (
                          <small>Buyer note: {line.line_notes}</small>
                        )}
                      </td>
                      <td>
                        {line.quantity} {line.packaging_unit}
                      </td>
                      <td>
                        {reviewed
                          ? line.item_availability_status.toLowerCase()
                          : "Pending review"}
                        {line.customer_facing_note && (
                          <small>{line.customer_facing_note}</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="wf-card wf-panel">
            <h2>Prescription & attachments</h2>
            {rfq.prescriptions.length ? (
              rfq.prescriptions.map((attachment, index) => (
                <div key={attachment.id} className="wf-file">
                  <FileText aria-hidden="true" />
                  <div>
                    <strong>
                      {attachment.attachment_kind === "SUPPORTING"
                        ? "Supporting document"
                        : "Prescription"}{" "}
                      {index + 1}
                    </strong>
                    <small>
                      {attachment.mime_type} ·{" "}
                      {Math.ceil(attachment.file_size_bytes / 1024)} KB · Admin
                      view
                    </small>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={
                      !["ACTIVE", "PENDING"].includes(attachment.purge_status)
                    }
                    onClick={() => setFile(attachment.id)}
                  >
                    View file
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">
                No prescription or supporting document attached. Review can
                continue.
              </p>
            )}
          </section>
          {current && (
            <section className="wf-card wf-panel">
              <div className="wf-card-heading">
                <h2>Quotation v{current.version_number}</h2>
                <small>
                  {current.status === "DRAFT"
                    ? "Draft · Not sent"
                    : workflowLabels[data.workflow_status]}
                </small>
              </div>
              <WorkflowOfferSummary offer={current} />
              {current.shipment && (
                <dl className="wf-facts">
                  <div>
                    <dt>Courier</dt>
                    <dd>{current.shipment.courier_name}</dd>
                  </div>
                  <div>
                    <dt>AWB / tracking number</dt>
                    <dd>{current.shipment.awb_tracking_number}</dd>
                  </div>
                  {current.shipment.estimated_delivery && (
                    <div>
                      <dt>Estimated delivery (Dhaka)</dt>
                      <dd>
                        {quotationDate(current.shipment.estimated_delivery)}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {current.payment && (
                <p className="muted">
                  Bank payment verified: {current.payment.reference} ·{" "}
                  {money(current.payment.amount, current.payment.currency)}
                </p>
              )}
              {data.quotation && data.quotation.versions.length > 1 && (
                <details>
                  <summary>Offer version history</summary>
                  {data.quotation.versions
                    .filter((version) => version.id !== current.id)
                    .map((version) => (
                      <details key={version.id}>
                        <summary>
                          Quotation v{version.version_number} ·{" "}
                          {version.status.toLowerCase()} ·{" "}
                          {money(
                            version.total_amount,
                            version.billing_currency,
                          )}
                        </summary>
                        <WorkflowOfferSummary offer={version} />
                      </details>
                    ))}
                </details>
              )}
              <AdminLink
                href={`/admin/quotations/${current.quotation_id}`}
                className="wf-back"
              >
                Detailed quotation document
              </AdminLink>
            </section>
          )}
          <section className="wf-card wf-panel">
            <h2>Negotiation</h2>
            <WorkflowThread
              messages={rfq.workflow?.messages ?? []}
              currency={current?.billing_currency}
            />
          </section>
        </div>
        <aside className="wf-stack">
          <section className="wf-next">
            <p className="wf-eyebrow">NEXT ACTION</p>
            <h2>{action.title}</h2>
            <p>{action.hint}</p>
            <div className="wf-actions">
              <button
                type="button"
                className="button secondary"
                disabled={disabled || !canReview}
                onClick={() => setMode("review")}
              >
                Review
              </button>
              <button
                type="button"
                className="button primary"
                disabled={disabled || !action.mode}
                onClick={() => setMode("actions")}
              >
                Action
              </button>
            </div>
          </section>
          <section className="wf-card wf-panel">
            <h2>Guest access</h2>
            <p className="muted">
              <ShieldCheck size={17} />
              The original RFQ email receives a private link to this request and
              its latest offer.
            </p>
            <button
              className="button secondary"
              type="button"
              disabled={disabled}
              onClick={() => setMode("guest-link")}
            >
              Manage private link
            </button>
          </section>
          <section className="wf-card wf-panel">
            <h2>Email delivery</h2>
            <p className="muted">
              Queued messages retry automatically. Refresh to check delivery.
            </p>
            {data.email_delivery.length ? (
              data.email_delivery.map((job) => (
                <div key={job._id}>
                  <strong>{emailLabel(job.template_id)}</strong>
                  <small>
                    {job.status.toLowerCase().replaceAll("_", " ")} ·{" "}
                    {job.attempt_count} attempts
                  </small>
                  {job.sent_at && (
                    <small>Sent {quotationDate(job.sent_at)} (Dhaka)</small>
                  )}
                </div>
              ))
            ) : (
              <p className="muted">No email deliveries recorded yet.</p>
            )}
          </section>
          <section className="wf-card wf-panel">
            <h2>Activity</h2>
            <ol className="wf-timeline">
              <li>
                <strong>Website request received</strong>
                <small>{quotationDate(rfq.created_at)}</small>
              </li>
              {rfq.workflow?.reviewed_at && (
                <li>
                  <strong>Medicine review saved</strong>
                  <small>{quotationDate(rfq.workflow.reviewed_at)}</small>
                </li>
              )}
              {data.quotation?.versions
                .filter((version) => version.issued_at)
                .map((version) => (
                  <li key={version.id}>
                    <strong>Quotation v{version.version_number} sent</strong>
                    <small>{quotationDate(version.issued_at)}</small>
                  </li>
                ))}
              {current?.accepted_at && (
                <li>
                  <strong>
                    Customer approved quotation v{current.version_number}
                  </strong>
                  <small>{quotationDate(current.accepted_at)}</small>
                </li>
              )}
              {current?.payment_requested_at && (
                <li>
                  <strong>Payment instructions requested by email</strong>
                  <small>{quotationDate(current.payment_requested_at)}</small>
                </li>
              )}
              {current?.payment && (
                <li>
                  <strong>Bank payment verified</strong>
                  <small>{quotationDate(current.payment.received_at)}</small>
                </li>
              )}
              {current?.shipment && (
                <li>
                  <strong>Shipment dispatched</strong>
                  <small>{quotationDate(current.shipment.dispatched_at)}</small>
                </li>
              )}
              {current?.delivered_at && (
                <li>
                  <strong>Delivery confirmed</strong>
                  <small>{quotationDate(current.delivered_at)}</small>
                </li>
              )}
            </ol>
          </section>
        </aside>
      </div>
      {file && (
        <PrescriptionViewer id={file} onClose={() => setFile(undefined)} />
      )}
      {mode && (
        <WorkflowDialog
          title={
            mode === "actions"
              ? "Quotation actions"
              : mode === "review"
                ? "Review request"
                : mode === "create"
                  ? "Create quotation"
                  : mode === "preview"
                    ? "Customer-facing preview"
                    : mode === "respond"
                      ? "Respond to buyer"
                      : mode === "payment-request"
                        ? "Request payment"
                        : mode === "payment"
                          ? "Confirm payment"
                          : mode === "dispatch"
                            ? "Delivery details"
                            : mode === "delivery"
                              ? "Complete delivery"
                              : "Private guest link"
          }
          busy={state.busy}
          onClose={() => setMode(null)}
        >
          <AdminOperationFeedback state={state} />
          {mode === "actions" && (
            <>
              <WorkflowBadge status={data.workflow_status} />
              <h3>{action.title}</h3>
              <p>{action.hint}</p>
              {action.mode && (
                <button
                  className="button primary"
                  disabled={disabled}
                  onClick={() => setMode(action.mode)}
                >
                  {action.label}
                </button>
              )}
            </>
          )}
          {mode === "review" && (
            <ReviewRequest
              rfq={rfq}
              busy={disabled}
              onSave={(body) => write(`${workflowPath}/review`, body)}
            />
          )}
          {mode === "create" && (
            <WorkflowQuoteEditor
              data={data}
              busy={disabled}
              onSave={async (body, id) => {
                await operation.run(
                  () =>
                    apiRequest(
                      id
                        ? `/v1/admin/quotations/${id}/draft`
                        : "/v1/admin/quotations/draft",
                      quoteWriteResult,
                      {
                        method: id ? "PATCH" : "POST",
                        json: body,
                        timeoutMs: 20000,
                      },
                    ),
                  refresh,
                  () => setMode("preview"),
                );
              }}
            />
          )}
          {mode === "respond" && current && (
            <RespondToBuyer
              data={data}
              busy={disabled}
              onSave={(body) => write(`${workflowPath}/respond`, body)}
            />
          )}
          {mode === "guest-link" && (
            <>
              <p>
                <Mail size={18} />
                Original RFQ email:{" "}
                <strong>{rfq.contact_snapshot.email ?? "Not supplied"}</strong>
              </p>
              <p className="muted">
                Reissuing replaces the previous request link and emails access
                only to this address. Revocation closes access through the
                request link.
              </p>
              {rfq.guest_expires_at && (
                <p>
                  Link expires: {quotationDate(rfq.guest_expires_at)} (Dhaka)
                  {rfq.guest_revoked_at ? " · Revoked" : ""}
                </p>
              )}
              <div className="wf-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={disabled || !rfq.contact_snapshot.email}
                  onClick={() =>
                    void write(`${workflowPath}/guest-link`, {
                      action: "REISSUE",
                    })
                  }
                >
                  Reissue link by email
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled || Boolean(rfq.guest_revoked_at)}
                  onClick={() =>
                    void write(`${workflowPath}/guest-link`, {
                      action: "REVOKE",
                    })
                  }
                >
                  Revoke request link
                </button>
              </div>
            </>
          )}
          {[
            "preview",
            "payment-request",
            "payment",
            "dispatch",
            "delivery",
          ].includes(mode) &&
            current && (
              <form onSubmit={submitAction} className="wf-form">
                <fieldset disabled={disabled}>
                  {mode === "preview" && (
                    <>
                      <WorkflowOfferSummary offer={current} />
                      {current.status === "DRAFT" ? (
                        <>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => setMode("create")}
                          >
                            Edit draft
                          </button>
                          <label>
                            Validity days
                            <input
                              name="validity"
                              type="number"
                              min={1}
                              max={365}
                              defaultValue={
                                settings?.payment_presets?.value
                                  .quote_validity_days ?? 7
                              }
                              required
                            />
                          </label>
                          <BankFields
                            bank={
                              current.bank_details ??
                              settings?.wire_instructions?.value
                            }
                          />
                          <label className="wf-check">
                            <input type="checkbox" required />I reviewed the
                            prices, weights, delivery charge and customer-facing
                            quotation.
                          </label>
                          <button type="submit" className="button primary">
                            Send quotation to customer
                          </button>
                        </>
                      ) : (
                        <p>
                          This quotation was already sent. Customer decisions
                          appear in this record.
                        </p>
                      )}
                    </>
                  )}
                  {mode === "payment-request" && (
                    <>
                      <p>
                        Send verified bank wire instructions to{" "}
                        <strong>{rfq.contact_snapshot.email}</strong>.
                      </p>
                      <p className="wf-total">
                        <span>Amount due</span>
                        <strong>
                          {money(
                            current.total_amount,
                            current.billing_currency,
                          )}
                        </strong>
                      </p>
                      <label className="wf-check">
                        <input type="checkbox" required />I verified the
                        beneficiary and bank details in the approved quotation.
                      </label>
                      <button type="submit" className="button primary">
                        Send payment request
                      </button>
                    </>
                  )}
                  {mode === "payment" && (
                    <>
                      <p className="wf-total">
                        <span>Amount due</span>
                        <strong>
                          {money(
                            current.total_amount,
                            current.billing_currency,
                          )}
                        </strong>
                      </p>
                      <label>
                        Verified amount
                        <input
                          name="amount"
                          type="number"
                          step="0.01"
                          min="0.01"
                          defaultValue={current.total_amount}
                          required
                        />
                      </label>
                      <label>
                        Currency
                        <select
                          aria-label="Currency"
                          name="currency"
                          defaultValue={current.billing_currency}
                        >
                          {["USD", "EUR", "CNY", "BDT"].map((currency) => (
                            <option key={currency}>{currency}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Bank transaction / wire reference
                        <input name="reference" maxLength={200} required />
                      </label>
                      <label className="wf-check">
                        <input type="checkbox" required />I verified the settled
                        transfer amount, currency and bank transaction
                        reference.
                      </label>
                      <button type="submit" className="button primary">
                        Record confirmed payment
                      </button>
                    </>
                  )}
                  {mode === "dispatch" && (
                    <>
                      <label>
                        Courier name
                        <input name="courier" maxLength={200} required />
                      </label>
                      <label>
                        AWB / tracking number
                        <input name="tracking" maxLength={200} required />
                      </label>
                      <label>
                        Estimated delivery (optional)
                        <input name="eta" type="date" />
                      </label>
                      <button type="submit" className="button primary">
                        Save details & mark dispatched
                      </button>
                    </>
                  )}
                  {mode === "delivery" && (
                    <>
                      <p>
                        {current.shipment?.courier_name} ·{" "}
                        {current.shipment?.awb_tracking_number}
                      </p>
                      <label>
                        Delivery evidence / courier proof of delivery reference
                        <textarea
                          name="evidence"
                          maxLength={2000}
                          rows={3}
                          required
                        />
                      </label>
                      <button type="submit" className="button primary">
                        Mark as completed
                      </button>
                    </>
                  )}
                </fieldset>
              </form>
            )}
        </WorkflowDialog>
      )}
    </div>
  );
}

function ReviewRequest({
  rfq: initial,
  busy,
  onSave,
}: {
  rfq: RfqDetail;
  busy: boolean;
  onSave(body: JsonValue): Promise<void>;
}) {
  const [rfq] = useState(initial);
  const [statuses, setStatuses] = useState(
    Object.fromEntries(
      rfq.items.map((line) => [line.id, line.item_availability_status]),
    ),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onSave({
      expected_updated_at: rfq.updated_at,
      items: rfq.items.map((line) => ({
        id: line.id,
        availability: statuses[line.id],
        note: String(form.get(`${line.id}_note`) ?? "").trim(),
      })),
    });
  }
  return (
    <form onSubmit={submit} className="wf-form">
      <fieldset disabled={busy}>
        <p>
          {rfq.contact_snapshot.full_name} · {rfq.destination_country} ·{" "}
          {rfq.prescriptions.length} private attachments
        </p>
        <p className="muted">
          Confirm the buyer details and check any attachments in this record
          before saving the review.
        </p>
        {rfq.items.map((line) => (
          <fieldset key={line.id} className="wf-line-editor">
            <legend>
              {line.product_snapshot?.brand_name ?? line.custom_medicine_name} ·{" "}
              {line.quantity} {line.packaging_unit}
            </legend>
            <label>
              Availability
              <select
                aria-label="Availability"
                name={`${line.id}_availability`}
                value={statuses[line.id]}
                onChange={(event) =>
                  setStatuses((values) => ({
                    ...values,
                    [line.id]: event.target
                      .value as typeof line.item_availability_status,
                  }))
                }
              >
                {["AVAILABLE", "SOURCING", "UNAVAILABLE"].map((status) => (
                  <option key={status} value={status}>
                    {status.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Customer-facing note
              <textarea
                name={`${line.id}_note`}
                maxLength={2000}
                required={statuses[line.id] === "UNAVAILABLE"}
                defaultValue={line.customer_facing_note}
              />
            </label>
          </fieldset>
        ))}
        <label className="wf-check">
          <input type="checkbox" required />I reviewed the buyer, requested
          medicines and available private attachments.
        </label>
        <button type="submit" className="button primary">
          Save review
        </button>
      </fieldset>
    </form>
  );
}

function RespondToBuyer({
  data: initial,
  busy,
  onSave,
}: {
  data: WorkflowDetail;
  busy: boolean;
  onSave(body: JsonValue): Promise<void>;
}) {
  const [data] = useState(initial);
  const [response, setResponse] = useState<
    "ACCEPT" | "COUNTEROFFER" | "RETAINED"
  >("COUNTEROFFER");
  const [operationId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<JsonValue>();
  const quote = data.quotation!.versions.find(
    (version) => version.id === data.quotation!.quotation.current_version_id,
  )!;
  const proposal = data.rfq.workflow?.messages?.find(
    (message) => message.id === data.rfq.workflow?.pending_request_id,
  );
  if (!proposal)
    return <p>This request was already answered. Refresh the record.</p>;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      expected_version_id: quote.id,
      request_id: proposal!.id,
      operation_id: operationId,
      mode: response,
      body: String(form.get("body") ?? "").trim(),
      ...(response !== "RETAINED"
        ? {
            prices: quote.items
              .filter((line) => line.availability_status === "AVAILABLE")
              .map((line) => ({
                rfq_item_id: line.rfq_item_id,
                selling_price: String(form.get(line.id) ?? ""),
              })),
            delivery_charge: String(form.get("delivery")),
            validity_days: Number(form.get("validity")),
          }
        : {}),
    };
    setPreview(body);
  }
  return (
    <div className="wf-stack">
      <WorkflowThread messages={[proposal]} currency={quote.billing_currency} />
      {preview ? (
        <>
          <p>
            The customer must approve these terms. Sending a revised offer will
            supersede the current version.
          </p>
          {typeof preview === "object" &&
            preview !== null &&
            !Array.isArray(preview) && (
              <>
                <p>Response: {String(preview.mode)}</p>
                <p className="wf-message-preview">{String(preview.body)}</p>
                {preview.delivery_charge !== undefined && (
                  <p>
                    Delivery charge:{" "}
                    {money(
                      String(preview.delivery_charge),
                      quote.billing_currency,
                    )}
                  </p>
                )}
                {Array.isArray(preview.prices) && (
                  <ul>
                    {preview.prices.map((line) =>
                      typeof line === "object" &&
                      line &&
                      !Array.isArray(line) ? (
                        <li key={String(line.rfq_item_id)}>
                          {
                            quote.items.find(
                              (item) => item.rfq_item_id === line.rfq_item_id,
                            )?.brand_name
                          }
                          :{" "}
                          {money(
                            String(line.selling_price),
                            quote.billing_currency,
                          )}{" "}
                          / pack
                        </li>
                      ) : null,
                    )}
                  </ul>
                )}
              </>
            )}
          <div className="wf-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              Edit response
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void onSave(preview)}
            >
              Send response to customer
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="wf-form">
          <fieldset disabled={busy}>
            <label>
              Response
              <select
                aria-label="Response"
                value={response}
                onChange={(event) =>
                  setResponse(event.target.value as typeof response)
                }
              >
                <option value="ACCEPT">
                  Accept buyer’s proposal and send a revised offer
                </option>
                <option value="COUNTEROFFER">Send counteroffer</option>
                <option value="RETAINED">Keep current offer and explain</option>
              </select>
            </label>
            {response !== "RETAINED" && (
              <div key={response} className="wf-stack">
                {quote.items
                  .filter((line) => line.availability_status === "AVAILABLE")
                  .map((line) => (
                    <label key={line.id}>
                      {line.brand_name} · price per pack (
                      {quote.billing_currency})
                      <input
                        name={line.id}
                        type="number"
                        min="0.01"
                        step="0.01"
                        defaultValue={
                          response === "ACCEPT" &&
                          proposal.proposed_medicine_subtotal
                            ? (
                                (Number(line.unit_quoted_price) *
                                  Number(proposal.proposed_medicine_subtotal)) /
                                Number(quote.subtotal_amount)
                              ).toFixed(2)
                            : line.unit_quoted_price
                        }
                        required
                      />
                    </label>
                  ))}
                <label>
                  Delivery charge ({quote.billing_currency})
                  <input
                    name="delivery"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={
                      response === "ACCEPT"
                        ? (proposal.proposed_delivery_charge ??
                          quote.freight_cost)
                        : quote.freight_cost
                    }
                    required
                  />
                </label>
                <label>
                  Validity days
                  <input
                    name="validity"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={7}
                    required
                  />
                </label>
              </div>
            )}
            <label>
              Reply to customer
              <textarea name="body" rows={4} maxLength={5000} required />
            </label>
            <button type="submit" className="button primary">
              Preview response
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}

function emailLabel(template?: string) {
  const labels: Record<string, string> = {
    "rfq-confirmation": "Request acknowledgement",
    "new-rfq-admin-alert": "New RFQ admin alert",
    "quotation-sent": "Quotation",
    accepted: "Approval confirmation",
    "payment-request": "Payment instructions",
    "payment-received": "Payment confirmation",
    dispatch: "Shipment update",
    delivered: "Delivery confirmation",
    "negotiation-reply": "Offer response",
    "revision-request": "Buyer change request",
  };
  return labels[template ?? ""] ?? "Workflow notification";
}
