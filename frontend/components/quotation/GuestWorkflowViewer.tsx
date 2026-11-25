"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Image from "next/image";
import { z } from "zod";
import { ApiError, apiRequest, type JsonValue } from "../../lib/api-client";
import { readGuestWorkflow, type GuestWorkflow } from "../../lib/rfq-workflow";
import { workflowLabels } from "../../lib/workflow-contract";
import { quotationDate } from "../../lib/admin-quotations";
import { WorkflowDialog } from "../admin/WorkflowDialog";
import {
  WorkflowBadge,
  WorkflowOfferSummary,
  WorkflowProgress,
  WorkflowThread,
  type WorkflowOffer,
  money,
} from "./WorkflowPrimitives";

export function GuestWorkflowViewer({ token }: { token: string }) {
  const [data, setData] = useState<GuestWorkflow | null>(null);
  const [problem, setProblem] = useState<ApiError>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [action, setAction] = useState<{
    kind: "accept" | "negotiate" | "decline";
    offer: WorkflowOffer;
    operationId: string;
  }>();
  const [scope, setScope] = useState("MEDICINE");
  const [uncertain, setUncertain] = useState(false);
  const frozen = useRef<{ kind: string; body: JsonValue } | undefined>(
    undefined,
  );
  const controller = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try {
      const next = await readGuestWorkflow(token, request.signal);
      if (!request.signal.aborted) {
        setData(next);
        setProblem(undefined);
      }
    } catch (error) {
      if (request.signal.aborted) return;
      const typed =
        error instanceof ApiError
          ? error
          : new ApiError("Unable to load this request.", {
              status: 503,
              code: "NETWORK_ERROR",
            });
      setProblem(typed);
      if ([401, 403, 404].includes(typed.status)) {
        setData(null);
        setAction(undefined);
      }
    }
  }, [token]);
  useEffect(() => {
    void read();
    const refresh = () => {
      if (document.visibilityState === "visible" && !locked.current)
        void read();
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [read]);
  async function send(kind: string, body: JsonValue) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setProblem(undefined);
    frozen.current = { kind, body };
    try {
      await apiRequest(
        `/v1/public/rfq-workflow/${token}/${kind}`,
        z.unknown(),
        { method: "POST", json: body, timeoutMs: 20000 },
      );
      setNotice(
        kind === "accept"
          ? "Your approval was recorded against this quotation version."
          : kind === "decline"
            ? "You declined this quotation."
            : "Your request was sent. Our team will respond on this same page.",
      );
      setUncertain(false);
      setAction(undefined);
      frozen.current = undefined;
      await read();
    } catch (error) {
      const typed =
        error instanceof ApiError
          ? error
          : new ApiError("The outcome could not be confirmed.", {
              status: 0,
              code: "NETWORK_ERROR",
            });
      setProblem(typed);
      if (typed.status === 409) {
        setAction(undefined);
        setUncertain(false);
        setNotice(
          "The offer or request changed. Review the latest offer before choosing an action.",
        );
        await read();
      } else if ([401, 403, 404].includes(typed.status)) {
        setAction(undefined);
        await read();
      } else if (![400, 422].includes(typed.status)) {
        setUncertain(true);
        setNotice(
          "The response was interrupted. Check the latest status or retry this same response.",
        );
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const expected = { expected_version_id: action.offer.id };
    if (action.kind === "accept")
      void send("accept", { ...expected, terms_accepted: true });
    else if (action.kind === "decline")
      void send("decline", {
        ...expected,
        reason: "OTHER",
        ...(text("notes") ? { notes: text("notes") } : {}),
      });
    else
      void send("negotiate", {
        ...expected,
        operation_id: action.operationId,
        scope,
        body: text("message"),
        ...(scope !== "DELIVERY" && text("medicine")
          ? { proposed_medicine_subtotal: text("medicine") }
          : {}),
        ...(scope !== "MEDICINE" && text("delivery")
          ? { proposed_delivery_charge: text("delivery") }
          : {}),
      });
  }
  const offer = data?.quote;
  const activeOffer =
    offer?.status === "SENT" &&
    Boolean(offer.valid_until && Date.parse(offer.valid_until) > Date.now());
  const mayApprove =
    activeOffer && data?.workflow_status !== "CHANGE_REQUESTED";
  const open = (kind: "accept" | "negotiate" | "decline") => {
    if (!offer) return;
    setUncertain(false);
    frozen.current = undefined;
    setProblem(undefined);
    setAction({ kind, offer, operationId: crypto.randomUUID() });
  };
  return (
    <div className="wf-guest-shell workflow-page">
      <header className="wf-guest-header">
        <Image
          src="/images/medaxis-logo.png"
          alt="MedAxis Global Pharma"
          width={190}
          height={52}
          priority
        />
        <span>Private request & quotation</span>
      </header>
      <main>
        {!data ? (
          <section className="wf-card wf-panel">
            <h1>
              {problem
                ? "Private request unavailable"
                : "Loading your request…"}
            </h1>
            <p>
              {problem
                ? [401, 403, 404].includes(problem.status)
                  ? "This link is invalid, expired or revoked. Contact MedAxis using your original RFQ email address to request renewed access."
                  : "Your request could not be loaded. Please try again."
                : "Checking your latest request status."}
            </p>
            <button
              className="button secondary"
              type="button"
              onClick={() => void read()}
            >
              Refresh status
            </button>
          </section>
        ) : (
          <>
            <div className="wf-page-heading">
              <div>
                <p className="wf-eyebrow">YOUR PRIVATE REQUEST</p>
                <h1>{data.rfq.rfq_number}</h1>
                <p>
                  {data.rfq.buyer_name} · {data.rfq.country}
                </p>
              </div>
              <WorkflowBadge status={data.workflow_status} />
            </div>
            {notice && (
              <p className="wf-flash" role="status">
                {notice}
              </p>
            )}
            {problem && (
              <p className="wf-warning" role="alert">
                {problem.status === 422 || problem.status === 400
                  ? "Please check your message and proposed amounts."
                  : "We could not refresh or confirm your response. Please retry or contact our team."}
              </p>
            )}
            <WorkflowProgress status={data.workflow_status} />
            <div className="wf-guest-grid">
              <div className="wf-stack">
                <section className="wf-card wf-panel">
                  <h2>
                    {offer
                      ? `Quotation v${offer.version_number}`
                      : "Request received"}
                  </h2>
                  {offer ? (
                    <WorkflowOfferSummary offer={offer} />
                  ) : (
                    <>
                      <p>
                        Our team is reviewing your medicines and will email you
                        when your quotation is ready. Return to this same
                        private link to view the offer.
                      </p>
                      <ul>
                        {data.rfq.items.map((line, index) => (
                          <li key={index}>
                            {line.name} · {line.quantity} {line.packaging_unit}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {data.history.length > 1 && (
                    <details>
                      <summary>Previous offer versions</summary>
                      {data.history
                        .filter((version) => version.id !== offer?.id)
                        .map((version) => (
                          <details key={version.id}>
                            <summary>
                              Quotation v{version.version_number} ·{" "}
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
                </section>
                <section className="wf-card wf-panel">
                  <h2>Messages about this offer</h2>
                  <WorkflowThread
                    messages={data.messages}
                    currency={offer?.billing_currency}
                  />
                </section>
              </div>
              <aside className="wf-stack">
                <section className="wf-next">
                  <h2>
                    {mayApprove
                      ? "Review your quotation"
                      : workflowLabels[data.workflow_status]}
                  </h2>
                  <p>
                    {data.workflow_status === "CHANGE_REQUESTED"
                      ? "Your request was sent. Check this page for the MedAxis response. You can still decline the quotation."
                      : mayApprove
                        ? `Choose how to respond to quotation v${offer?.version_number}.`
                        : data.workflow_status === "APPROVED"
                          ? "Your approval is confirmed. Our team will send verified payment instructions."
                          : data.workflow_status === "AWAITING_PAYMENT"
                            ? "Follow the verified bank wire instructions below and sent to your email."
                            : "Your latest order status is shown on this page."}
                  </p>
                  <div className="wf-stack">
                    {mayApprove && (
                      <>
                        <button
                          type="button"
                          className="button primary"
                          disabled={busy || Boolean(problem)}
                          onClick={() => open("accept")}
                        >
                          Approve quotation
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy || Boolean(problem)}
                          onClick={() => open("negotiate")}
                        >
                          Request a better offer
                        </button>
                      </>
                    )}
                    {activeOffer && (
                      <button
                        type="button"
                        className="button secondary wf-decline"
                        disabled={busy || Boolean(problem)}
                        onClick={() => open("decline")}
                      >
                        Decline quotation
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void read()}
                    >
                      Refresh status
                    </button>
                  </div>
                </section>
                {offer?.payment_requested_at && offer.bank_details && (
                  <section className="wf-card wf-panel">
                    <h2>Payment instructions</h2>
                    <p className="wf-total">
                      <span>Amount due</span>
                      <strong>
                        {money(offer.total_amount, offer.billing_currency)}
                      </strong>
                    </p>
                    <dl className="wf-facts">
                      <div>
                        <dt>Beneficiary</dt>
                        <dd>{offer.bank_details.beneficiary_name}</dd>
                      </div>
                      <div>
                        <dt>Bank</dt>
                        <dd>{offer.bank_details.bank_name}</dd>
                      </div>
                      <div>
                        <dt>Account</dt>
                        <dd>{offer.bank_details.account_number}</dd>
                      </div>
                      <div>
                        <dt>SWIFT</dt>
                        <dd>{offer.bank_details.swift_code}</dd>
                      </div>
                    </dl>
                    <p>{offer.bank_details.instructions}</p>
                    {offer.payment && (
                      <p className="wf-flash">
                        Payment confirmed · {offer.payment.reference}
                      </p>
                    )}
                  </section>
                )}
                {offer?.shipment && (
                  <section className="wf-card wf-panel">
                    <h2>Order updates</h2>
                    <dl className="wf-facts">
                      <div>
                        <dt>Courier</dt>
                        <dd>{offer.shipment.courier_name}</dd>
                      </div>
                      <div>
                        <dt>AWB / tracking number</dt>
                        <dd>{offer.shipment.awb_tracking_number}</dd>
                      </div>
                      {offer.shipment.estimated_delivery && (
                        <div>
                          <dt>Estimated delivery (Dhaka)</dt>
                          <dd>
                            {quotationDate(offer.shipment.estimated_delivery)}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt>Shipment status</dt>
                        <dd>
                          {offer.status === "DELIVERED"
                            ? "Delivered"
                            : "Dispatched"}
                        </dd>
                      </div>
                    </dl>
                  </section>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
      <footer>
        MedAxis Global Pharma · Keep this private link confidential.
      </footer>
      {action && (
        <WorkflowDialog
          title={
            action.kind === "accept"
              ? "Approve quotation"
              : action.kind === "decline"
                ? "Decline quotation"
                : "Request a better offer"
          }
          busy={busy}
          onClose={() => {
            if (!uncertain) setAction(undefined);
          }}
        >
          <p>
            Quotation v{action.offer.version_number} ·{" "}
            {money(action.offer.total_amount, action.offer.billing_currency)}
          </p>
          {notice && (
            <p className="wf-warning" role="status">
              {notice}
            </p>
          )}
          {problem && (
            <p className="form-error" role="alert">
              {problem.status === 422
                ? "Check the message and proposed amounts."
                : "The response could not be confirmed."}
            </p>
          )}
          {uncertain ? (
            <div className="wf-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void read()}
              >
                Check latest status
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  if (frozen.current)
                    void send(frozen.current.kind, frozen.current.body);
                }}
              >
                Retry same response
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="wf-form">
              <fieldset disabled={busy}>
                {action.kind === "negotiate" ? (
                  <>
                    <label>
                      What would you like us to change?
                      <select
                        value={scope}
                        onChange={(event) => setScope(event.target.value)}
                      >
                        <option value="MEDICINE">Medicine price</option>
                        <option value="DELIVERY">Delivery charge</option>
                        <option value="BOTH">Both</option>
                      </select>
                    </label>
                    {scope !== "DELIVERY" && (
                      <label>
                        Proposed medicine subtotal for all quoted items (
                        {action.offer.billing_currency}, optional)
                        <input
                          name="medicine"
                          type="number"
                          min="0.01"
                          step="0.01"
                        />
                      </label>
                    )}
                    {scope !== "MEDICINE" && (
                      <label>
                        Proposed delivery charge (
                        {action.offer.billing_currency}, optional)
                        <input
                          name="delivery"
                          type="number"
                          min="0"
                          step="0.01"
                        />
                      </label>
                    )}
                    <label>
                      Your message
                      <textarea
                        name="message"
                        rows={4}
                        maxLength={5000}
                        required
                      />
                    </label>
                  </>
                ) : action.kind === "accept" ? (
                  <label className="wf-check">
                    <input type="checkbox" required />I approve quotation v
                    {action.offer.version_number}, including the quoted
                    medicines, delivery charge, currency and payment terms.
                  </label>
                ) : (
                  <>
                    <p>Declining closes this quotation request.</p>
                    <label>
                      Reason / notes (optional)
                      <textarea name="notes" maxLength={2000} rows={3} />
                    </label>
                  </>
                )}
                <button className="button primary" type="submit">
                  {action.kind === "accept"
                    ? "Confirm approval"
                    : action.kind === "decline"
                      ? "Confirm decline"
                      : "Send request"}
                </button>
              </fieldset>
            </form>
          )}
        </WorkflowDialog>
      )}
    </div>
  );
}
