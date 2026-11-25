"use client";
import { useState, type FormEvent } from "react";
import type { WorkflowDetail } from "../../lib/rfq-workflow";
import type { JsonValue } from "../../lib/api-client";
import { MasterPicker } from "./MasterPicker";
import { grams, money } from "../quotation/WorkflowPrimitives";

export function WorkflowQuoteEditor({
  data: initial,
  busy,
  onSave,
}: {
  data: WorkflowDetail;
  busy: boolean;
  onSave(body: JsonValue, draftId?: string): Promise<void>;
}) {
  const [data] = useState(initial);
  const { rfq, quotation } = data;
  const current = quotation?.versions.find(
    (version) =>
      version.id === quotation.quotation.current_version_id &&
      version.status === "DRAFT",
  );
  const [currency, setCurrency] = useState(
    current?.billing_currency ?? rfq.preferred_currency,
  );
  const [weights, setWeights] = useState<Record<string, string>>(
    Object.fromEntries(
      rfq.items.map((line) => [
        line.id,
        current?.items.find((item) => item.rfq_item_id === line.id)
          ?.weight_per_pack_g ?? "",
      ]),
    ),
  );
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(
      rfq.items.map((line) => {
        const priced = current?.items.find(
          (item) => item.rfq_item_id === line.id,
        );
        return [
          line.id,
          priced?.availability_status === "AVAILABLE"
            ? priced.unit_quoted_price
            : "",
        ];
      }),
    ),
  );
  const [freight, setFreight] = useState(current?.freight_cost ?? "0");
  const [packed, setPacked] = useState(current?.packed_weight_g ?? "");
  const [issue, setIssue] = useState("");
  const available = rfq.items.filter(
    (line) => line.item_availability_status === "AVAILABLE",
  );
  const medicineWeight = available.reduce(
    (sum, line) => sum + Number(weights[line.id] || 0) * line.quantity,
    0,
  );
  const subtotal = available.reduce(
    (sum, line) => sum + Number(prices[line.id] || 0) * line.quantity,
    0,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (packed && Number(packed) < medicineWeight) {
      setIssue(
        "Packed shipment weight must be at least the total medicine weight.",
      );
      return;
    }
    setIssue("");
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const body: JsonValue = {
      billing_currency: currency,
      items: rfq.items.map((line) => {
        const product = data.catalog_products.find(
          (product) => product._id === line.product_id,
        );
        return {
          rfq_item_id: line.id,
          manufacturer_id:
            product?.manufacturer_id ?? value(`${line.id}_manufacturer`),
          availability_status: line.item_availability_status,
          ...(line.item_availability_status === "AVAILABLE"
            ? {
                selling_price: prices[line.id],
                weight_per_pack_g: weights[line.id],
              }
            : {}),
          ...(line.customer_facing_note
            ? { customer_facing_note: line.customer_facing_note }
            : {}),
          ...(!line.product_id
            ? {
                snapshot: {
                  brand_name: line.custom_medicine_name ?? "",
                  generic_name: value(`${line.id}_generic`),
                  strength: value(`${line.id}_strength`),
                  dosage_form: value(`${line.id}_dosage`),
                  pack_size: value(`${line.id}_pack`),
                },
              }
            : {}),
        };
      }),
      freight_amount: freight,
      insurance_amount: current?.insurance_cost ?? "0",
      ...(packed ? { packed_weight_g: packed } : {}),
      shipping_terms: {
        method: "EXPRESS_COURIER",
        named_place: value("named_place"),
        cold_chain_required: form.get("cold_chain") === "on",
        ...(value("temperature")
          ? { temperature_range: value("temperature") }
          : {}),
      },
      payment_terms: "BANK_WIRE_TT",
      ...(current
        ? {
            expected_current_version_id: current.id,
            expected_updated_at: current.updated_at,
          }
        : { rfq_id: rfq.id }),
    };
    await onSave(body, current ? quotation!.quotation.id : undefined);
  }
  return (
    <form onSubmit={submit} className="wf-form">
      <fieldset disabled={busy}>
        <p className="muted">
          Enter the selling price and approximate weight for one pack of each
          available medicine.
        </p>
        {rfq.items.map((line) => {
          const previous = current?.items.find(
            (item) => item.rfq_item_id === line.id,
          );
          const product = data.catalog_products.find(
            (product) => product._id === line.product_id,
          );
          return (
            <fieldset className="wf-line-editor" key={line.id}>
              <legend>
                {line.product_snapshot?.brand_name ?? line.custom_medicine_name}{" "}
                · {line.quantity} {line.packaging_unit}
              </legend>
              <p className="muted">
                {line.item_availability_status.toLowerCase()}
              </p>
              {!product && (
                <MasterPicker
                  kind="manufacturers"
                  name={`${line.id}_manufacturer`}
                  label="Manufacturer"
                  initial={previous ? [{ id: previous.manufacturer_id }] : []}
                />
              )}
              {line.item_availability_status === "AVAILABLE" && (
                <div className="wf-form-grid">
                  <label>
                    Selling price per pack ({currency})
                    <input
                      name={`${line.id}_price`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={prices[line.id]}
                      onChange={(event) =>
                        setPrices((values) => ({
                          ...values,
                          [line.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Approx. weight per pack (g)
                    <input
                      name={`${line.id}_weight`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={weights[line.id]}
                      onChange={(event) =>
                        setWeights((values) => ({
                          ...values,
                          [line.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              )}
              {!line.product_id && (
                <div className="wf-form-grid">
                  <label>
                    Generic name
                    <input
                      name={`${line.id}_generic`}
                      defaultValue={previous?.generic_name}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Strength
                    <input
                      name={`${line.id}_strength`}
                      defaultValue={previous?.strength ?? line.custom_strength}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Dosage form
                    <input
                      name={`${line.id}_dosage`}
                      defaultValue={previous?.dosage_form}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Pack size
                    <input
                      name={`${line.id}_pack`}
                      defaultValue={previous?.pack_size}
                      required
                      maxLength={200}
                    />
                  </label>
                </div>
              )}
            </fieldset>
          );
        })}
        <div className="wf-form-grid">
          <label>
            Currency
            <select
              aria-label="Currency"
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value as typeof currency)
              }
            >
              {["USD", "EUR", "CNY", "BDT"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Delivery charge ({currency})
            <input
              name="freight"
              type="number"
              min="0"
              step="0.01"
              value={freight}
              onChange={(event) => setFreight(event.target.value)}
              required
            />
          </label>
          <label>
            Estimated packed shipment weight (g, optional)
            <input
              name="packed"
              type="number"
              min="0.01"
              step="0.01"
              value={packed}
              onChange={(event) => setPacked(event.target.value)}
            />
          </label>
          <label>
            Destination / named place
            <input
              name="named_place"
              required
              maxLength={200}
              defaultValue={
                current?.shipping_terms.named_place ??
                [rfq.destination_city_port, rfq.destination_country]
                  .filter(Boolean)
                  .join(", ")
              }
            />
          </label>
        </div>
        <label className="wf-check">
          <input
            type="checkbox"
            name="cold_chain"
            defaultChecked={
              current?.shipping_terms.cold_chain_required ??
              data.catalog_products.some(
                (product) => product.cold_chain_required,
              )
            }
          />
          Cold-chain shipment required
        </label>
        <label>
          Temperature range (optional)
          <input
            name="temperature"
            maxLength={200}
            defaultValue={current?.shipping_terms.temperature_range}
          />
        </label>
        <dl className="wf-facts">
          <div>
            <dt>Approx. medicine weight</dt>
            <dd>{grams(medicineWeight)}</dd>
          </div>
          <div>
            <dt>Estimated packed shipment weight</dt>
            <dd>{grams(packed)}</dd>
          </div>
        </dl>
        <p className="wf-total">
          <span>Draft total</span>
          <strong>
            {money(
              subtotal +
                Number(freight || 0) +
                Number(current?.insurance_cost ?? 0),
              currency,
            )}
          </strong>
        </p>
        {issue && (
          <p className="form-error" role="alert">
            {issue}
          </p>
        )}
        <div className="wf-actions">
          <button
            type="submit"
            className="button primary"
            disabled={
              rfq.items.some(
                (line) => line.item_availability_status === "SOURCING",
              ) || !available.length
            }
          >
            Save draft & preview
          </button>
        </div>
      </fieldset>
    </form>
  );
}
