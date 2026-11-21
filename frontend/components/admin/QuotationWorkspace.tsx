"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { apiRequest, ApiError } from "../../lib/api-client";
import { adminFxSchema, type AdminFx } from "../../lib/admin-contract";
import {
  adminVersionSchema,
  decimalForInput,
  fulfillmentBody,
  fulfillmentNext,
  quoteWriteResult,
  readAdminQuotation,
  readRfq,
  resendBody,
  safeMagicLink,
  sendBody,
  settingsSchema,
  type AdminSettings,
  type QuotationDetail,
  type RfqDetail,
} from "../../lib/admin-workflow";
import { useAdminOperation } from "../../hooks/useAdminOperation";
import { AdminLink, useAdminLive } from "./AdminShell";
import { AdminOperationFeedback } from "./AdminOperationFeedback";
import { BankFields, bankFromForm, QuoteEditor } from "./FastQuoteEditor";
import { QuoteSummary, FxRatesCard } from "./QuoteSummary";
import { quotationDate, quotationStatus } from "../../lib/admin-quotations";

export function QuotationWorkspace({
  initial,
  initialRfq,
  initialSettings,
  initialFx,
}: {
  initial: QuotationDetail;
  initialRfq: RfqDetail;
  initialSettings: AdminSettings | null;
  initialFx: AdminFx | null;
}) {
  const [tab, setTab] = useState("Overview");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [quote, setQuote] = useState(initial);
  const [rfq, setRfq] = useState(initialRfq);
  const [settings, setSettings] = useState(initialSettings);
  const [fx, setFx] = useState(initialFx);
  const [selected, setSelected] = useState<string>();
  const [revisionMode, setRevisionMode] = useState(false);
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { operation, state } = useAdminOperation();
  const { revision, expire } = useAdminLive();
  const stale = useRef<AbortController | null>(null);
  const current = quote.versions.find(
    (version) => version.id === quote.quotation.current_version_id,
  )!;
  const shown =
    quote.versions.find((version) => version.id === selected) ?? current;
  const costs = quote.internal_costs.find(
    (cost) => cost.quotation_version_id === shown.id,
  );
  async function refresh() {
    stale.current?.abort();
    const controller = new AbortController();
    stale.current = controller;
    try {
      const [document, source, config, rates] = await Promise.allSettled([
        readAdminQuotation(quote.quotation.id, controller.signal),
        readRfq(rfq.id, controller.signal),
        apiRequest("/v1/admin/settings", settingsSchema, {
          signal: controller.signal,
        }),
        apiRequest("/v1/admin/fx-rates", adminFxSchema, {
          signal: controller.signal,
        }),
      ]);
      for (const result of [document, source, config, rates])
        if (
          result.status === "rejected" &&
          result.reason instanceof ApiError &&
          [401, 403].includes(result.reason.status)
        )
          throw result.reason;
      if (document.status === "rejected") throw document.reason;
      if (source.status === "rejected") throw source.reason;
      if (!controller.signal.aborted) {
        const next = document.value;
        const authoritative = next.versions.find(
          (version) => version.id === next.quotation.current_version_id,
        );
        if (
          authoritative &&
          (authoritative.id !== current.id ||
            authoritative.status !== current.status ||
            authoritative.updated_at !== current.updated_at)
        )
          operation.reconcileAdvancedVersion();
        setQuote(next);
        setRfq(source.value);
        setSettings(config.status === "fulfilled" ? config.value.data : null);
        setFx(rates.status === "fulfilled" ? rates.value.data : null);
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        expire();
      throw error;
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (revision) void operation.refresh(refresh);
    return () => stale.current?.abort();
    // Event-driven refresh only; private writes are never effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  async function action(
    event: FormEvent<HTMLFormElement>,
    kind: "send" | "resend" | "fulfillment",
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMagicLink(null);
    setLinkCopied(false);
    await operation.run(
      async () => {
        let body;
        try {
          if (kind === "send")
            body = sendBody.parse({
              expected_version_id: current.id,
              validity_days: Number(form.get("validity")),
              allow_stale_fx: form.get("allow_stale") === "on",
              bank_details: bankFromForm(form),
            });
          else if (kind === "resend")
            body = resendBody.parse({ expected_version_id: current.id });
          else {
            const next = fulfillmentNext(current);
            if (!next) throw new Error("No permitted fulfillment transition.");
            const estimate = String(form.get("estimated_delivery") ?? "");
            body = fulfillmentBody.parse({
              expected_version_id: current.id,
              status: next,
              ...(next === "PAYMENT_RECEIVED"
                ? {
                    wire_reference: form.get("wire_reference"),
                    amount: form.get("amount"),
                    currency: form.get("currency"),
                  }
                : next === "DISPATCHED"
                  ? {
                      courier_name: form.get("courier_name"),
                      awb_tracking_number: form.get("awb_tracking_number"),
                      ...(estimate
                        ? {
                            estimated_delivery: new Date(
                              `${estimate}+06:00`,
                            ).toISOString(),
                          }
                        : {}),
                    }
                  : {}),
            });
          }
        } catch (error: unknown) {
          throw new ApiError("Check action fields.", {
            status: 422,
            code: "VALIDATION_FAILED",
            responseValidated: true,
            details:
              error instanceof z.ZodError
                ? error.issues.map((issue) => ({
                    field: issue.path.join("."),
                    issue: "Check this field.",
                  }))
                : [],
          });
        }
        const path = `/v1/admin/quotations/${quote.quotation.id}/${kind}`;
        if (kind === "fulfillment")
          return {
            version: (
              await apiRequest(path, adminVersionSchema, {
                method: "PATCH",
                json: body,
                timeoutMs: 20_000,
              })
            ).data,
          };
        return (
          await apiRequest(path, quoteWriteResult, {
            method: "POST",
            json: body,
            timeoutMs: 20_000,
          })
        ).data;
      },
      refresh,
      (result) => {
        if ("magic_link_url" in result && result.magic_link_url)
          setMagicLink(safeMagicLink(result.magic_link_url));
        setSelected(undefined);
      },
    );
  }
  const next = fulfillmentNext(current, now);
  const disabled = !ready || state.busy || state.blocked;
  const active = quote.quotation.overall_status === "ACTIVE";
  const canIssue =
    active &&
    current.status === "DRAFT" &&
    !!current.contact.email &&
    !current.items.some((line) => line.availability_status === "SOURCING") &&
    rfq.status !== "NEED_CLARIFICATION";
  const isCurrent = shown.id === current.id;
  const blockers = [
    !current.contact.email &&
      "The buyer email is missing. The buyer contact must be corrected before this draft can be issued.",
    current.items.some((line) => line.availability_status === "SOURCING") &&
      "Some medicines are still being sourced. Resolve their availability in Medicines & pricing.",
    rfq.status === "NEED_CLARIFICATION" &&
      "The RFQ is awaiting clarification. Resolve it from the RFQ page.",
  ].filter(Boolean);
  const tabs = [
    "Overview",
    "Medicines & pricing",
    "Customer & delivery",
    "Versions",
    "Activity",
  ] as const;
  return (
    <div className="quotation-workspace">
      <div className="admin-page-heading">
        <div>
          <AdminLink href="/admin/quotations">All quotations</AdminLink>
          <h1>{quote.quotation.quotation_number}</h1>
          <p>
            Current version {quote.quotation.current_version} ·{" "}
            <span
              className={`quotation-status quotation-status-${current.status.toLowerCase()}`}
            >
              {quotationStatus(current.status)}
            </span>
          </p>
        </div>
        <div className="admin-filter-actions">
          <AdminLink
            className="button secondary"
            href={`/admin/rfqs/${rfq.id}`}
          >
            {rfq.rfq_number}
          </AdminLink>
          <button
            className="button secondary"
            disabled={state.busy}
            onClick={() => void operation.refresh(refresh)}
          >
            Refresh state
          </button>
        </div>
      </div>
      <AdminOperationFeedback state={state} />
      {(!settings || !fx) && (
        <p className="admin-feedback">
          Pricing configuration or rates are unavailable. Existing commercial
          totals and permitted fulfillment remain usable; refresh before
          preparing pricing.
        </p>
      )}
      {magicLink && (
        <section className="admin-panel quotation-link-banner">
          <h2>Private customer link</h2>
          <p>
            Sharing this link gives access to the customer quotation. Keep it
            private; this copy disappears when you leave or dismiss it.
          </p>
          <input
            aria-label="Private customer link"
            value={magicLink}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="admin-filter-actions">
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(magicLink)
                  .then(() => setLinkCopied(true))
                  .catch(() => undefined)
              }
            >
              Copy private link
            </button>
            {linkCopied && (
              <span className="quotation-copy-status" role="status">
                Copied to clipboard
              </span>
            )}
            <button
              className="button secondary"
              onClick={() => {
                setMagicLink(null);
                setLinkCopied(false);
              }}
            >
              Dismiss link
            </button>
          </div>
        </section>
      )}
      <nav
        className="quotation-tabs"
        aria-label="Quotation sections"
        role="tablist"
      >
        {tabs.map((label) => (
          <button
            key={label}
            id={`quote-tab-${tabs.indexOf(label)}`}
            type="button"
            role="tab"
            disabled={!ready}
            tabIndex={tab === label ? 0 : -1}
            onKeyDown={(event) => {
              const index = tabs.indexOf(label);
              const target =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : undefined;
              if (target !== undefined) {
                event.preventDefault();
                setTab(tabs[target]!);
                document.getElementById(`quote-tab-${target}`)?.focus();
              }
            }}
            aria-selected={tab === label}
            aria-controls={`quote-panel-${tabs.indexOf(label)}`}
            onClick={() => setTab(label)}
          >
            {label}
            {label === "Versions" ? ` (${quote.versions.length})` : ""}
          </button>
        ))}
      </nav>
      {!isCurrent && (
        <div className="quotation-history-notice">
          <p>
            Viewing version {shown.version_number} ·{" "}
            {quotationStatus(shown.status)}. Historical versions are read-only.
          </p>
          <button
            className="button secondary"
            onClick={() => {
              setSelected(undefined);
              setTab("Overview");
            }}
          >
            Return to current version
          </button>
        </div>
      )}
      <div
        role="tabpanel"
        id="quote-panel-0"
        aria-labelledby="quote-tab-0"
        hidden={tab !== "Overview"}
      >
        <section className="admin-panel quotation-at-a-glance">
          <div>
            <span>Customer</span>
            <strong>{shown.contact.full_name}</strong>
            <small>{shown.contact.company_name ?? shown.contact.email}</small>
          </div>
          <div>
            <span>Quotation total</span>
            <strong>
              {shown.billing_currency} {shown.total_amount}
            </strong>
            <small>{quotationStatus(shown.status)}</small>
          </div>
          <div>
            <span>
              {shown.status === "ACCEPTED" ? "Payment deadline" : "Valid until"}
            </span>
            <strong>
              {quotationDate(
                shown.status === "ACCEPTED"
                  ? shown.reservation_expires_at
                  : shown.valid_until,
              )}
            </strong>
            <small>Dhaka time</small>
          </div>
        </section>

        <div className="quotation-workspace-grid">
          <div className="quotation-workspace-main">
            <QuoteSummary version={shown} />
          </div>

          <aside
            className="quotation-workspace-aside"
            aria-label="Quotation actions and summary"
          >
            {isCurrent && active && current.status === "DRAFT" && (
              <section className="admin-panel">
                <h2>Issue saved draft</h2>
                <p>
                  Review the saved draft total alongside. Current FX rates are
                  locked when issuing, so the final customer total may change.
                  Use Medicines &amp; pricing to edit the draft.
                </p>
                <button
                  className="button secondary"
                  disabled={disabled || !settings || !fx}
                  onClick={() => setTab("Medicines & pricing")}
                >
                  Edit draft
                </button>
                {blockers.length > 0 && (
                  <ul className="admin-feedback">
                    {blockers.map((message) => (
                      <li key={String(message)}>{message}</li>
                    ))}
                  </ul>
                )}
                <form
                  className="stack-form"
                  onSubmit={(event) => void action(event, "send")}
                >
                  <fieldset
                    disabled={disabled || !canIssue}
                    className="admin-form-grid"
                  >
                    <div className="quotation-send-review">
                      <strong>Recipient: {current.contact.full_name}</strong>
                      <p>{current.contact.email ?? "Email required"}</p>
                      <p>
                        Customer total: {current.billing_currency}{" "}
                        {current.total_amount} · Version{" "}
                        {current.version_number}
                      </p>
                    </div>
                    <label>
                      Validity days
                      <input
                        name="validity"
                        type="number"
                        min={1}
                        max={365}
                        required
                        defaultValue={
                          settings?.payment_presets?.value.quote_validity_days ??
                          7
                        }
                      />
                    </label>
                    <label className="admin-check">
                      <input name="allow_stale" type="checkbox" />
                      Allow stale server FX rates
                    </label>
                    <BankFields
                      bank={
                        current.bank_details ?? settings?.wire_instructions?.value
                      }
                    />
                    <label className="admin-check">
                      <input type="checkbox" required />I reviewed the recipient,
                      currency, total and validity above.
                    </label>
                    <button className="button primary">Issue quotation</button>
                  </fieldset>
                </form>
              </section>
            )}
            {isCurrent && active && current.status === "SENT" && (
              <section className="admin-panel">
                <h2>Sent quotation actions</h2>
                <p>
                  The customer can review this version until{" "}
                  {quotationDate(current.valid_until)} (Dhaka).
                </p>
                <button
                  className="button secondary"
                  disabled={disabled || revisionMode || !settings || !fx}
                  onClick={() => {
                    setMagicLink(null);
    setLinkCopied(false);
                    setLinkCopied(false);
                    setRevisionMode(true);
                    setTab("Medicines & pricing");
                  }}
                >
                  Prepare revision
                </button>
                <form
                  className="stack-form"
                  onSubmit={(event) => void action(event, "resend")}
                >
                  <fieldset disabled={disabled}>
                    <label className="admin-check">
                      <input type="checkbox" required />
                      Rotate the secret link and invalidate the previous link.
                    </label>
                    <button className="button secondary">
                      Resend with new link
                    </button>
                  </fieldset>
                </form>
              </section>
            )}
            {isCurrent && active && next && (
              <section className="admin-panel">
                <h2>Fulfillment: {next.replaceAll("_", " ")}</h2>
                <p>
                  {next === "PAYMENT_RECEIVED"
                    ? "Verify the bank transfer before recording payment."
                    : next === "DISPATCHED"
                      ? "Add the courier and tracking details for this shipment."
                      : "Confirm delivery using the supporting records."}
                </p>
                <form
                  key={`${current.id}-${current.status}`}
                  className="stack-form"
                  onSubmit={(event) => void action(event, "fulfillment")}
                >
                  <fieldset disabled={disabled} className="admin-form-grid">
                    {next === "PAYMENT_RECEIVED" && (
                      <>
                        <label>
                          Wire reference
                          <input
                            name="wire_reference"
                            required
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Verified payment amount
                          <input
                            name="amount"
                            required
                            inputMode="decimal"
                            defaultValue={decimalForInput(current.total_amount)}
                          />
                        </label>
                        <label>
                          Payment currency
                          <input
                            name="currency"
                            readOnly
                            value={current.billing_currency}
                          />
                        </label>
                      </>
                    )}
                    {next === "DISPATCHED" && (
                      <>
                        <label>
                          Courier name
                          <input name="courier_name" required maxLength={200} />
                        </label>
                        <label>
                          AWB tracking number
                          <input
                            name="awb_tracking_number"
                            required
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Estimated delivery (Dhaka, optional)
                          <input
                            name="estimated_delivery"
                            type="datetime-local"
                          />
                        </label>
                      </>
                    )}
                    <label className="admin-check">
                      <input type="checkbox" required />I verified this
                      transition and its supporting records.
                    </label>
                    <button className="button primary">
                      Record {next.replaceAll("_", " ").toLowerCase()}
                    </button>
                  </fieldset>
                </form>
              </section>
            )}
            {isCurrent && current.status === "ACCEPTED" && !next && (
              <p className="admin-feedback">
                The server reservation is expired or unavailable. Payment cannot
                be recorded through this state. Refresh to confirm.
              </p>
            )}
            <section className="admin-panel quotation-aside-contact">
              <div className="admin-section-heading">
                <h2>Buyer snapshot</h2>
                <button
                  type="button"
                  className="quotation-bank-toggle"
                  onClick={() => setTab("Customer & delivery")}
                >
                  Full details
                </button>
              </div>
              <dl className="admin-facts">
                <dt>Email</dt>
                <dd>{shown.contact.email ?? "Not supplied"}</dd>
                <dt>Destination</dt>
                <dd>
                  {rfq.destination_country}
                  {rfq.destination_city_port
                    ? ` · ${rfq.destination_city_port}`
                    : ""}
                </dd>
                {shown.contact.whatsapp_number && (
                  <>
                    <dt>WhatsApp</dt>
                    <dd>{shown.contact.whatsapp_number}</dd>
                  </>
                )}
              </dl>
            </section>
          </aside>
        </div>
      </div>
      <div
        role="tabpanel"
        id="quote-panel-1"
        aria-labelledby="quote-tab-1"
        hidden={tab !== "Medicines & pricing"}
      >
        {isCurrent &&
          active &&
          current.status === "DRAFT" &&
          settings &&
          fx && (
            <QuoteEditor
              key={`${current.id}-${current.updated_at}`}
              rfq={rfq}
              settings={settings}
              fx={fx}
              quote={quote}
              operation={operation}
              state={state}
              refresh={refresh}
            />
          )}
        {isCurrent &&
          revisionMode &&
          settings &&
          fx &&
          active &&
          current.status === "SENT" && (
            <QuoteEditor
              key={current.id}
              rfq={rfq}
              settings={settings}
              fx={fx}
              quote={quote}
              operation={operation}
              state={state}
              refresh={refresh}
              onCommitted={(result) => {
                setRevisionMode(false);
                setTab("Overview");
                if (result.magic_link_url)
                  setMagicLink(safeMagicLink(result.magic_link_url));
              }}
            />
          )}
        {!(
          isCurrent &&
          active &&
          (current.status === "DRAFT" || revisionMode)
        ) && (
          <section className="admin-panel">
            <h2>Saved pricing</h2>
            <p>
              View customer line prices in Overview.{" "}
              {isCurrent && current.status === "SENT"
                ? "Use Prepare revision in Overview to change the sent quotation."
                : "Pricing is read-only for this version."}
            </p>
          </section>
        )}
        <details className="admin-panel">
          <summary>Internal procurement, markup & margins · admin only</summary>
          {costs ? (
            <>
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Cost per unit (BDT)</th>
                      <th>Markup percent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.items.map((line) => (
                      <tr key={line.rfq_item_id}>
                        <td>
                          {shown.items.find(
                            (item) => item.rfq_item_id === line.rfq_item_id,
                          )?.brand_name ?? "RFQ line"}
                        </td>
                        <td>{line.procurement_unit_cost_bdt}</td>
                        <td>{line.markup_percent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="admin-facts">
                <dt>Procurement cost BDT</dt>
                <dd>{costs.procurement_cost_bdt}</dd>
                <dt>Calculated base BDT</dt>
                <dd>{costs.calculated_base_bdt}</dd>
                <dt>Target markup percent</dt>
                <dd>{costs.target_markup_percent}</dd>
                <dt>Gross margin BDT</dt>
                <dd>{costs.gross_margin_bdt ?? "Not supplied"}</dd>
                <dt>Effective margin percent</dt>
                <dd>
                  {costs.effective_gross_margin_percent ?? "Not supplied"}
                </dd>
              </dl>
              {costs.internal_procurement_notes && (
                <p className="admin-prewrap">
                  {costs.internal_procurement_notes}
                </p>
              )}
            </>
          ) : (
            <p>No internal cost record was supplied for this version.</p>
          )}
        </details>
        {shown.locked_fx_rates && (
          <details className="admin-panel">
            <summary>Server-locked FX · admin only</summary>
            <FxRatesCard
              title="Locked exchange rates"
              capturedAt={shown.locked_fx_rates.captured_at}
              stale={shown.locked_fx_rates.stale_rates_used}
              ratesToBdt={shown.locked_fx_rates.rates_to_bdt}
              modes={shown.locked_fx_rates.modes}
              fetchedAt={shown.locked_fx_rates.fetched_at}
            />
          </details>
        )}
      </div>
      <div
        role="tabpanel"
        id="quote-panel-2"
        aria-labelledby="quote-tab-2"
        hidden={tab !== "Customer & delivery"}
      >
        <section className="admin-panel">
          <h2>Customer & delivery</h2>
          <dl className="admin-facts">
            <dt>Customer</dt>
            <dd>{shown.contact.full_name}</dd>
            <dt>Company</dt>
            <dd>{shown.contact.company_name ?? "—"}</dd>
            <dt>Email</dt>
            <dd>{shown.contact.email ?? "Not supplied"}</dd>
            <dt>WhatsApp</dt>
            <dd>{shown.contact.whatsapp_number ?? "—"}</dd>
            <dt>WeChat</dt>
            <dd>{shown.contact.wechat_id ?? "—"}</dd>
            <dt>Requested destination (RFQ)</dt>
            <dd>
              {rfq.destination_country} ·{" "}
              {rfq.destination_city_port ?? "Not supplied"}
            </dd>
            <dt>Agreed shipping</dt>
            <dd>
              {shown.shipping_terms.method.replaceAll("_", " ")}{" "}
              {shown.shipping_terms.incoterm} ·{" "}
              {shown.shipping_terms.named_place}
            </dd>
            <dt>Handling</dt>
            <dd>
              {shown.shipping_terms.cold_chain_required
                ? "Cold chain required"
                : "Standard handling"}{" "}
              {shown.shipping_terms.temperature_range}
            </dd>
          </dl>
        </section>
        {shown.bank_details && (
          <section className="admin-panel">
            <h2>Authorized bank wire instructions</h2>
            <p className="admin-prewrap">{shown.bank_details.instructions}</p>
            <dl className="admin-facts">
              {(
                [
                  "beneficiary_name",
                  "bank_name",
                  "account_number",
                  "swift_code",
                  "bank_address",
                ] as const
              ).map(
                (key) =>
                  shown.bank_details?.[key] && (
                    <div key={key}>
                      <dt>{key.replaceAll("_", " ")}</dt>
                      <dd>{shown.bank_details[key]}</dd>
                    </div>
                  ),
              )}
            </dl>
          </section>
        )}
      </div>
      <div
        role="tabpanel"
        id="quote-panel-3"
        aria-labelledby="quote-tab-3"
        hidden={tab !== "Versions"}
      >
        <section className="admin-panel">
          <h2>Version history</h2>
          <p>Each sent version retains its customer snapshot and prices.</p>
          <div className="admin-version-list">
            {quote.versions.map((version) => (
              <article key={version.id} className="quotation-version">
                <strong>
                  Version {version.version_number}
                  {version.id === current.id ? " · Current" : ""}
                </strong>
                <span>{quotationStatus(version.status)}</span>
                <span>
                  {version.billing_currency} {version.total_amount}
                </span>
                <small>{quotationDate(version.created_at)} (Dhaka)</small>
                <button
                  className="button secondary"
                  onClick={() => {
                    setSelected(version.id);
                    setMagicLink(null);
    setLinkCopied(false);
                    setTab("Overview");
                  }}
                >
                  View version {version.version_number}
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
      <div
        role="tabpanel"
        id="quote-panel-4"
        aria-labelledby="quote-tab-4"
        hidden={tab !== "Activity"}
      >
        <section className="admin-panel">
          <h2>Quotation activity</h2>
          <p className="muted">
            Recorded milestones from saved quotation versions. All times are
            shown in Dhaka time.
          </p>
          <ol className="quotation-timeline">
            {[...quote.versions]
              .sort((a, b) => b.version_number - a.version_number)
              .map((version) => (
                <li key={version.id}>
                  <strong>
                    Version {version.version_number} ·{" "}
                    {quotationStatus(version.status)}
                  </strong>
                  <dl className="admin-facts">
                    <dt>Created</dt>
                    <dd>{quotationDate(version.created_at)}</dd>
                    {version.issued_at && (
                      <>
                        <dt>Issued</dt>
                        <dd>{quotationDate(version.issued_at)}</dd>
                      </>
                    )}
                    {version.accepted_at && (
                      <>
                        <dt>Accepted</dt>
                        <dd>{quotationDate(version.accepted_at)}</dd>
                      </>
                    )}
                    {version.payment && (
                      <>
                        <dt>Payment recorded</dt>
                        <dd>
                          {quotationDate(version.payment.received_at)} ·{" "}
                          {version.payment.reference}
                        </dd>
                      </>
                    )}
                    {version.shipment && (
                      <>
                        <dt>Dispatched</dt>
                        <dd>
                          {quotationDate(version.shipment.dispatched_at)} ·{" "}
                          {version.shipment.courier_name} ·{" "}
                          {version.shipment.awb_tracking_number}
                        </dd>
                      </>
                    )}
                    {version.delivered_at && (
                      <>
                        <dt>Delivered</dt>
                        <dd>{quotationDate(version.delivered_at)}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
