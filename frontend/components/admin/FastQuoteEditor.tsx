"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../../lib/api-client";
import {
  availability,
  decimalForInput,
  bankInputSchema,
  currencies,
  draftBody,
  pricingSchema,
  quoteWriteResult,
  reviseBody,
  type AdminOperation,
  type AdminSettings,
  type OperationState,
  type QuotationDetail,
  type RfqDetail,
} from "../../lib/admin-workflow";
import type { AdminFx } from "../../lib/admin-contract";
import { useAdminOperation } from "../../hooks/useAdminOperation";
import { AdminLink } from "./AdminShell";
import { AdminOperationFeedback } from "./AdminOperationFeedback";
import { MasterPicker } from "./MasterPicker";
import { updateDraftBody } from "../../lib/admin-management";
import { QuoteSummary } from "./QuoteSummary";
import { quotationStatus } from "../../lib/admin-quotations";

export function BankFields({ bank }: { bank?: unknown }) {
  const parsed = bankInputSchema.safeParse(bank);
  const value = parsed.success ? parsed.data : undefined;
  return (
    <>
      <h3>Verified bank wire details</h3>
      {(
        [
          "beneficiary_name",
          "bank_name",
          "account_number",
          "swift_code",
          "bank_address",
          "instructions",
        ] as const
      ).map((key) => (
        <label key={key}>
          {key.replaceAll("_", " ")}
          <input
            name={`bank_${key}`}
            defaultValue={value?.[key] ?? ""}
            required={key !== "bank_address"}
            maxLength={key === "instructions" ? 4000 : 500}
          />
        </label>
      ))}
      <label className="admin-check">
        <input type="checkbox" required />I verified these wire details through
        the authorized company records.
      </label>
    </>
  );
}
export function bankFromForm(form: FormData) {
  const address = String(form.get("bank_bank_address") ?? "").trim();
  return bankInputSchema.parse({
    configured: true,
    instructions: form.get("bank_instructions"),
    beneficiary_name: form.get("bank_beneficiary_name"),
    bank_name: form.get("bank_bank_name"),
    account_number: form.get("bank_account_number"),
    swift_code: form.get("bank_swift_code"),
    ...(address ? { bank_address: address } : {}),
  });
}
export function QuoteEditor({
  rfq,
  settings,
  fx,
  quote,
  operation,
  state,
  refresh,
  onCommitted,
}: {
  rfq: RfqDetail;
  settings: AdminSettings;
  fx: AdminFx;
  quote?: QuotationDetail;
  operation: AdminOperation;
  state: OperationState;
  refresh(): Promise<void>;
  onCommitted?(result: ReturnType<typeof quoteWriteResult.parse>): void;
}) {
  const current = quote?.versions.find(
    (version) => version.id === quote.quotation.current_version_id,
  );
  const costs = quote?.internal_costs.find(
    (cost) => cost.quotation_version_id === current?.id,
  );
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rfq.items.map((line) => [
        line.id,
        current?.items.find((item) => item.rfq_item_id === line.id)
          ?.availability_status ?? line.item_availability_status,
      ]),
    ),
  );
  const [shipping, setShipping] = useState(
    current?.shipping_terms.method ??
      settings.shipping_presets?.value.methods[0] ??
      "EXPRESS_COURIER",
  );
  const [created, setCreated] =
    useState<ReturnType<typeof quoteWriteResult.parse>>();
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [stepError, setStepError] = useState("");
  useEffect(() => setReady(true), []);
  const [review, setReview] = useState<Record<string, string>>({});
  const editor = useRef<HTMLFormElement>(null);
  function changeStep(target: number) {
    if (!editor.current) return;
    if (target > step) {
      const form = new FormData(editor.current);
      if (step === 0) {
        const missing = rfq.items.findIndex(
          (line) => !form.get(`${line.id}_manufacturer`),
        );
        if (missing !== -1) {
          setStepError(`Select a manufacturer for line ${missing + 1}.`);
          return;
        }
        if (!Object.values(statuses).includes("AVAILABLE")) {
          setStepError(
            "At least one medicine must be available before saving a quotation.",
          );
          return;
        }
      }
      const panel = editor.current.querySelector(`[data-quote-step="${step}"]`);
      const invalid = Array.from(
        panel?.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >("input, select, textarea") ?? [],
      ).find((field) => !field.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
    }
    setStepError("");
    const confirmation = editor.current.elements.namedItem("review_pricing");
    if (confirmation instanceof HTMLInputElement) confirmation.checked = false;
    setReview(
      Object.fromEntries(
        Array.from(new FormData(editor.current), ([key, value]) => [
          key,
          String(value),
        ]),
      ),
    );
    setStep(target);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 2) {
      changeStep(step + 1);
      return;
    }
    const invalid = Array.from(
      event.currentTarget.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input, select, textarea"),
    ).find((field) => !field.checkValidity());
    if (invalid) {
      setStep(
        Number(
          invalid
            .closest("[data-quote-step]")
            ?.getAttribute("data-quote-step") ?? 2,
        ),
      );
      requestAnimationFrame(() => invalid.reportValidity());
      return;
    }
    const form = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(form.get(name) ?? "").trim() || undefined;
    await operation.run(
      async () => {
        const bank = bankInputSchema.safeParse(
          settings.wire_instructions?.value,
        );
        const input = {
          billing_currency: form.get("billing_currency"),
          freight_amount: form.get("freight"),
          insurance_amount: form.get("insurance"),
          payment_terms: "BANK_WIRE_TT",
          shipping_terms: {
            method: form.get("method"),
            ...(shipping === "INCOTERM"
              ? { incoterm: form.get("incoterm") }
              : {}),
            named_place: form.get("place"),
            cold_chain_required: form.get("cold_chain") === "on",
            ...(optional("temperature")
              ? { temperature_range: optional("temperature") }
              : {}),
          },
          ...(bank.success ? { bank_details: bank.data } : {}),
          ...(optional("internal_notes")
            ? { internal_procurement_notes: optional("internal_notes") }
            : {}),
          items: rfq.items.map((line) => ({
            rfq_item_id: line.id,
            manufacturer_id: form.get(`${line.id}_manufacturer`),
            availability_status: statuses[line.id],
            ...(statuses[line.id] === "AVAILABLE"
              ? {
                  procurement_cost_bdt: form.get(`${line.id}_cost`),
                  markup_percent: form.get(`${line.id}_markup`),
                }
              : {}),
            ...(optional(`${line.id}_note`)
              ? { customer_facing_note: optional(`${line.id}_note`) }
              : {}),
            ...(line.is_uncatalogued
              ? {
                  snapshot: {
                    brand_name: form.get(`${line.id}_brand_name`),
                    generic_name: form.get(`${line.id}_generic_name`),
                    strength: form.get(`${line.id}_strength`),
                    dosage_form: form.get(`${line.id}_dosage_form`),
                    pack_size: form.get(`${line.id}_pack_size`),
                  },
                }
              : {}),
          })),
        };
        const parsed = pricingSchema.safeParse(input);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          setStep(
            issue?.path[0] === "items" || issue?.path[0] === "billing_currency"
              ? 0
              : 1,
          );
          setStepError(
            `${issue?.path[0] === "items" && typeof issue.path[1] === "number" ? `Line ${issue.path[1] + 1}: ` : ""}${issue?.message ?? "Check the highlighted inputs."}`,
          );
          throw new ApiError("Invalid pricing inputs.", {
            status: 422,
            code: "VALIDATION_FAILED",
            responseValidated: true,
            details: parsed.error.issues.map((issue) => ({
              field: issue.path.join("."),
              issue: "Check this field.",
            })),
          });
        }
        let body;
        try {
          body =
            current?.status === "DRAFT"
              ? updateDraftBody.parse({
                  ...parsed.data,
                  expected_current_version_id: current.id,
                  expected_updated_at: current.updated_at,
                })
              : current
                ? reviseBody.parse({
                    ...parsed.data,
                    expected_current_version_id: current.id,
                    issue_immediately: form.get("issue_immediately") === "on",
                    ...(optional("validity")
                      ? { validity_days: Number(form.get("validity")) }
                      : {}),
                    allow_stale_fx: form.get("allow_stale") === "on",
                  })
                : draftBody.parse({ ...parsed.data, rfq_id: rfq.id });
        } catch {
          throw new ApiError("Invalid version options.", {
            status: 422,
            code: "VALIDATION_FAILED",
            responseValidated: true,
          });
        }
        return (
          await apiRequest(
            current
              ? `/v1/admin/quotations/${quote!.quotation.id}/${current.status === "DRAFT" ? "draft" : "revise"}`
              : "/v1/admin/quotations/draft",
            quoteWriteResult,
            {
              method: current?.status === "DRAFT" ? "PATCH" : "POST",
              json: body,
              timeoutMs: 20_000,
            },
          )
        ).data;
      },
      refresh,
      (result) => {
        setCreated(result);
        onCommitted?.(result);
      },
    );
  }
  const disabled = !ready || state.busy || state.blocked || !!created;
  return (
    <>
      {!quote && <AdminOperationFeedback state={state} />}
      <section className="admin-panel quotation-editor">
        <h2>
          {current?.status === "DRAFT"
            ? "Edit saved draft"
            : current
              ? "Prepare a new quotation version"
              : "Prepare Fast Quote"}
        </h2>
        <p className="muted">
          Review each step, then save. Final customer totals are calculated when
          the draft is saved.
        </p>
        <div className="quotation-source">
          <div>
            <strong>{rfq.rfq_number}</strong>
            <span>
              {rfq.contact_snapshot.full_name} ·{" "}
              {rfq.contact_snapshot.company_name ??
                rfq.contact_snapshot.customer_type.replaceAll("_", " ")}
            </span>
          </div>
          <div>
            <strong>{rfq.destination_country}</strong>
            <span>
              {rfq.destination_city_port ?? "Destination to confirm"} ·{" "}
              {rfq.items.length} medicine lines
            </span>
          </div>
        </div>
        <form ref={editor} onSubmit={submit} noValidate className="stack-form">
          <fieldset disabled={disabled}>
            <nav
              className="quotation-stepper"
              aria-label="Quotation preparation steps"
            >
              {["Medicines & pricing", "Shipping & terms", "Review & save"].map(
                (label, index) => (
                  <button
                    type="button"
                    key={label}
                    aria-current={step === index ? "step" : undefined}
                    disabled={disabled || index > step + 1}
                    onClick={() => changeStep(index)}
                  >
                    <span>{index + 1}</span>
                    {label}
                  </button>
                ),
              )}
            </nav>
            {stepError && (
              <p role="alert" className="admin-feedback">
                {stepError}
              </p>
            )}
            <div data-quote-step="0" hidden={step !== 0}>
              <h3>Medicines & pricing</h3>
              <p className="small muted">
                Procurement costs and markup are visible only to administrators.
              </p>
              <div className="admin-rate-grid">
                {fx.rates.map((rate) => (
                  <p key={rate.currency}>
                    {rate.currency}:{" "}
                    {rate.available
                      ? `${rate.active_rate_to_bdt} · ${rate.mode}${rate.stale ? " · stale" : ""}`
                      : "unavailable"}
                  </p>
                ))}
              </div>
              <div className="admin-form-grid">
                <label>
                  Billing currency
                  <select
                    name="billing_currency"
                    aria-label="Billing currency"
                    defaultValue={
                      current?.billing_currency ?? rfq.preferred_currency
                    }
                  >
                    {currencies.map((currency) => (
                      <option key={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
              </div>
              {rfq.items.map((line, index) => {
                const priced = current?.items.find(
                  (item) => item.rfq_item_id === line.id,
                );
                const cost = costs?.items.find(
                  (item) => item.rfq_item_id === line.id,
                );
                return (
                  <section className="admin-pricing-line" key={line.id}>
                    <h3>
                      Line {index + 1}:{" "}
                      {line.product_snapshot?.brand_name ??
                        line.custom_medicine_name}
                    </h3>
                    <p>
                      {line.quantity} {line.packaging_unit} · Original RFQ
                      quantity and packaging are retained.
                    </p>
                    <div className="admin-form-grid">
                      <MasterPicker
                        kind="manufacturers"
                        name={`${line.id}_manufacturer`}
                        label={`Manufacturer line ${index + 1}`}
                        initial={priced ? [{ id: priced.manufacturer_id }] : []}
                      />
                      <label>
                        Quote availability
                        <select
                          aria-label={`Quote availability line ${index + 1}`}
                          value={statuses[line.id]}
                          onChange={(event) => {
                            const status = event.currentTarget.value;
                            setStatuses((value) => ({
                              ...value,
                              [line.id]: status,
                            }));
                          }}
                        >
                          {availability.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      {statuses[line.id] === "AVAILABLE" && (
                        <>
                          <label>
                            Procurement cost per unit (BDT)
                            <input
                              name={`${line.id}_cost`}
                              inputMode="decimal"
                              pattern="[0-9]{1,18}([.][0-9]{1,8})?"
                              title="Use a nonnegative amount with up to eight decimal places."
                              required
                              defaultValue={
                                cost
                                  ? decimalForInput(
                                      cost.procurement_unit_cost_bdt,
                                    )
                                  : undefined
                              }
                            />
                          </label>
                          <label>
                            Markup percent
                            <input
                              name={`${line.id}_markup`}
                              inputMode="decimal"
                              pattern="[0-9]{1,18}([.][0-9]{1,8})?"
                              title="Use a nonnegative amount with up to eight decimal places."
                              required
                              defaultValue={
                                cost
                                  ? decimalForInput(cost.markup_percent)
                                  : undefined
                              }
                            />
                          </label>
                        </>
                      )}
                      <label>
                        Customer note
                        <input
                          name={`${line.id}_note`}
                          required={statuses[line.id] === "UNAVAILABLE"}
                          defaultValue={
                            priced?.customer_facing_note ??
                            line.customer_facing_note
                          }
                          maxLength={2000}
                        />
                      </label>
                      {line.is_uncatalogued &&
                        (
                          [
                            "brand_name",
                            "generic_name",
                            "strength",
                            "dosage_form",
                            "pack_size",
                          ] as const
                        ).map((key) => (
                          <label key={key}>
                            Custom {key.replaceAll("_", " ")}
                            <input
                              name={`${line.id}_${key}`}
                              required
                              maxLength={200}
                              defaultValue={
                                priced?.[key] ??
                                (key === "brand_name"
                                  ? line.custom_medicine_name
                                  : key === "strength"
                                    ? line.custom_strength
                                    : "")
                              }
                            />
                          </label>
                        ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <div data-quote-step="1" hidden={step !== 1}>
              <h3>Shipping & terms</h3>
              <div className="admin-form-grid">
                <label>
                  Freight amount
                  <input
                    name="freight"
                    inputMode="decimal"
                    pattern="[0-9]{1,18}([.][0-9]{1,8})?"
                    title="Use a nonnegative amount with up to eight decimal places."
                    required
                    defaultValue={decimalForInput(current?.freight_cost ?? "0")}
                  />
                </label>
                <label>
                  Insurance amount
                  <input
                    name="insurance"
                    inputMode="decimal"
                    pattern="[0-9]{1,18}([.][0-9]{1,8})?"
                    title="Use a nonnegative amount with up to eight decimal places."
                    required
                    defaultValue={decimalForInput(
                      current?.insurance_cost ?? "0",
                    )}
                  />
                </label>
                <label>
                  Shipping method
                  <select
                    name="method"
                    aria-label="Shipping method"
                    value={shipping}
                    onChange={(event) =>
                      setShipping(event.currentTarget.value as typeof shipping)
                    }
                  >
                    <option>EXPRESS_COURIER</option>
                    <option>INCOTERM</option>
                  </select>
                </label>
                {shipping === "INCOTERM" && (
                  <label>
                    Incoterm
                    <select
                      name="incoterm"
                      aria-label="Incoterm"
                      defaultValue={
                        current?.shipping_terms.incoterm ??
                        settings.shipping_presets?.value.incoterms[0]
                      }
                    >
                      {["FCA", "CIP", "DAP", "CPT", "FOB", "CIF"].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                <label>
                  Named place
                  <input
                    name="place"
                    required
                    defaultValue={
                      current?.shipping_terms.named_place ??
                      rfq.destination_city_port ??
                      ""
                    }
                  />
                </label>
                <label>
                  Temperature range
                  <input
                    name="temperature"
                    defaultValue={current?.shipping_terms.temperature_range}
                  />
                </label>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    name="cold_chain"
                    defaultChecked={current?.shipping_terms.cold_chain_required}
                  />
                  Cold-chain shipping required
                </label>
              </div>
              <p>Payment: bank wire (TT).</p>
              <label>
                Internal procurement notes
                <textarea
                  name="internal_notes"
                  maxLength={5000}
                  defaultValue={costs?.internal_procurement_notes}
                />
              </label>
              {current?.status === "SENT" && (
                <div className="admin-form-grid">
                  <label>
                    Validity days
                    <input
                      name="validity"
                      type="number"
                      min={1}
                      max={365}
                      defaultValue={
                        settings.payment_presets?.value.quote_validity_days
                      }
                    />
                  </label>
                  <label className="admin-check">
                    <input type="checkbox" name="issue_immediately" />
                    Issue revised version immediately
                  </label>
                  <label className="admin-check">
                    <input type="checkbox" name="allow_stale" />
                    Allow stale server FX rates when issuing
                  </label>
                </div>
              )}
            </div>
            <div data-quote-step="2" hidden={step !== 2}>
              <h3>Review before saving</h3>
              <dl className="admin-facts">
                <dt>Customer</dt>
                <dd>{rfq.contact_snapshot.full_name}</dd>
                <dt>Email</dt>
                <dd>
                  {rfq.contact_snapshot.email ??
                    "Missing — add an email to the RFQ before issuing"}
                </dd>
                <dt>Currency</dt>
                <dd>{review.billing_currency}</dd>
                <dt>Shipping</dt>
                <dd>
                  {review.method} · {review.place}
                  {review.cold_chain === "on" ? " · Cold chain" : ""}
                </dd>
                <dt>Freight / insurance</dt>
                <dd>
                  {review.freight} / {review.insurance}
                </dd>
              </dl>
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <caption>
                    Admin review — procurement costs and markup stay private
                  </caption>
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Requested</th>
                      <th>Availability</th>
                      <th>Cost per unit (BDT)</th>
                      <th>Markup %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.items.map((line) => (
                      <tr key={line.id}>
                        <td>
                          {line.product_snapshot?.brand_name ??
                            review[`${line.id}_brand_name`]}
                        </td>
                        <td>
                          {line.quantity} {line.packaging_unit}
                        </td>
                        <td>{quotationStatus(statuses[line.id]!)}</td>
                        <td>
                          {statuses[line.id] === "AVAILABLE"
                            ? review[`${line.id}_cost`]
                            : "Not payable"}
                        </td>
                        <td>
                          {statuses[line.id] === "AVAILABLE"
                            ? review[`${line.id}_markup`]
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                {review.issue_immediately === "on"
                  ? `The revised version will be issued immediately with ${review.validity} days of validity.`
                  : "Saving a draft does not send it. Review the calculated customer totals on the saved quotation before issuing."}
              </p>
              <label className="admin-check">
                <input type="checkbox" name="review_pricing" required />I
                reviewed every line, per-unit cost, manufacturer and shipping
                requirement.
              </label>
              <button className="button primary">
                {state.busy
                  ? "Saving…"
                  : current?.status === "DRAFT"
                    ? "Save draft changes"
                    : current
                      ? "Create revised version"
                      : "Create draft once"}
              </button>
            </div>
            <div className="quotation-step-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => changeStep(step - 1)}
                >
                  Back
                </button>
              )}
              {step < 2 && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => changeStep(step + 1)}
                >
                  {step === 0 ? "Continue to shipping" : "Continue to review"}
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </section>
      {created && (
        <>
          <QuoteSummary version={created.version} />
          {created.fx_preview && (
            <section className="admin-panel">
              <h2>Server FX preview</h2>
              <pre className="admin-prewrap">
                {JSON.stringify(created.fx_preview, null, 2)}
              </pre>
            </section>
          )}
          <AdminLink
            className="button primary"
            href={`/admin/quotations/${created.quotation_id ?? created.version.quotation_id}`}
          >
            Open saved quotation
          </AdminLink>
        </>
      )}
    </>
  );
}
export function FastQuoteCreate({
  rfq,
  settings,
  fx,
}: {
  rfq: RfqDetail;
  settings: AdminSettings;
  fx: AdminFx;
}) {
  const { operation, state } = useAdminOperation();
  return (
    <>
      <AdminLink href={`/admin/rfqs/${rfq.id}`}>← {rfq.rfq_number}</AdminLink>
      <QuoteEditor
        rfq={rfq}
        settings={settings}
        fx={fx}
        operation={operation}
        state={state}
        refresh={async () => {
          /* Read only: discover an already-created active quote after response loss. */ const detail =
            await import("../../lib/admin-workflow").then((module) =>
              module.readRfq(rfq.id),
            );
          if (
            operation.getSnapshot().uncertain &&
            detail.quotations.some((quote) => quote.overall_status === "ACTIVE")
          )
            window.location.assign(`/admin/rfqs/${rfq.id}`);
        }}
      />
    </>
  );
}
