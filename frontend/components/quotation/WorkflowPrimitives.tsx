"use client";
import type { z } from "zod";
import type { adminVersionSchema } from "../../lib/admin-workflow";
import {
  offerMessage,
  workflowLabels,
  workflowStage,
  workflowSteps,
  type workflowStatus,
} from "../../lib/workflow-contract";
import { quotationDate } from "../../lib/admin-quotations";
import { decimalForInput } from "../../lib/admin-workflow";
export type WorkflowOffer = z.infer<typeof adminVersionSchema>;
export function money(value: string | number, currency: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimalForInput(String(value)));
  if (!match) return `${currency} —`;
  const decimals = (match[2] ?? "").padEnd(3, "0");
  const cents =
    BigInt(match[1]) * BigInt(100) +
    BigInt(decimals.slice(0, 2)) +
    (decimals[2] >= "5" ? BigInt(1) : BigInt(0));
  return `${currency} ${new Intl.NumberFormat("en-US").format(cents / BigInt(100))}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
export const grams = (value?: string | number) =>
  value === undefined || value === ""
    ? "Not provided"
    : `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(value))} g`;
export function WorkflowBadge({
  status,
}: {
  status: z.infer<typeof workflowStatus>;
}) {
  return (
    <span
      className={`wf-badge ${["COMPLETED", "PAID", "APPROVED"].includes(status) ? "is-green" : ["UNDER_REVIEW", "CHANGE_REQUESTED", "AWAITING_PAYMENT", "EXPIRED"].includes(status) ? "is-amber" : ["DECLINED", "CLOSED"].includes(status) ? "is-red" : ""}`}
    >
      {workflowLabels[status]}
    </span>
  );
}
export function WorkflowProgress({ status }: { status: string }) {
  const stage = workflowStage(status);
  return (
    <section className="wf-card wf-progress" aria-label="Order progress">
      <div className="wf-card-heading">
        <h2>Order progress</h2>
        <span className="muted">
          {status === "DECLINED"
            ? "Closed by customer"
            : stage === 7
              ? "All steps complete"
              : `Step ${stage + 1} of 7`}
        </span>
      </div>
      <ol>
        {workflowSteps.map((label, index) => (
          <li
            key={label}
            className={
              stage === 7 || index < stage
                ? "is-done"
                : index === stage
                  ? "is-current"
                  : ""
            }
            aria-current={index === stage ? "step" : undefined}
          >
            <span>{stage === 7 || index < stage ? "✓" : index + 1}</span>
            <strong>{label}</strong>
            <small>
              {stage === 7 || index < stage
                ? "Done"
                : index === stage
                  ? "In progress"
                  : "Pending"}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function WorkflowOfferSummary({ offer }: { offer: WorkflowOffer }) {
  return (
    <div className="wf-offer">
      <div className="wf-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quoted item</th>
              <th>Quantity</th>
              <th>Selling price / pack</th>
              <th>Approx. weight / pack</th>
              <th>Line weight</th>
            </tr>
          </thead>
          <tbody>
            {offer.items.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.brand_name}</strong>
                  <small>
                    {line.strength} · {line.pack_size}
                  </small>
                  {line.customer_facing_note && (
                    <small>{line.customer_facing_note}</small>
                  )}
                </td>
                <td>
                  {line.quantity} {line.packaging_unit}
                </td>
                <td>
                  {line.availability_status === "AVAILABLE"
                    ? money(line.unit_quoted_price, offer.billing_currency)
                    : line.availability_status.toLowerCase()}
                </td>
                <td>{grams(line.weight_per_pack_g)}</td>
                <td>{grams(line.line_weight_g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="wf-facts">
        <div>
          <dt>Medicine subtotal</dt>
          <dd>{money(offer.subtotal_amount, offer.billing_currency)}</dd>
        </div>
        <div>
          <dt>Delivery charge</dt>
          <dd>{money(offer.freight_cost, offer.billing_currency)}</dd>
        </div>
        {Number(offer.insurance_cost) > 0 && (
          <div>
            <dt>Insurance</dt>
            <dd>{money(offer.insurance_cost, offer.billing_currency)}</dd>
          </div>
        )}
        <div>
          <dt>Approx. medicine weight</dt>
          <dd>{grams(offer.medicine_weight_g)}</dd>
        </div>
        <div>
          <dt>Estimated packed shipment weight</dt>
          <dd>{grams(offer.packed_weight_g)}</dd>
        </div>
        <div>
          <dt>Valid until (Dhaka)</dt>
          <dd>
            {offer.valid_until
              ? quotationDate(offer.valid_until)
              : "Set when sent"}
          </dd>
        </div>
        <div>
          <dt>Shipping</dt>
          <dd>
            {offer.shipping_terms.incoterm ?? "Express courier"} ·{" "}
            {offer.shipping_terms.named_place}
          </dd>
        </div>
      </dl>
      <p className="wf-total">
        <span>Quotation total</span>
        <strong>{money(offer.total_amount, offer.billing_currency)}</strong>
      </p>
    </div>
  );
}
export function WorkflowThread({
  messages,
  currency,
}: {
  messages: z.infer<typeof offerMessage>[];
  currency?: string;
}) {
  return messages.length ? (
    <div className="wf-thread">
      {messages.map((message) => (
        <article
          key={message.id}
          className={message.author === "BUYER" ? "is-buyer" : ""}
        >
          <strong>
            {message.author === "BUYER" ? "Customer" : "MedAxis"} ·{" "}
            {message.kind === "REQUEST"
              ? "Requested a better offer"
              : message.kind === "RETAINED"
                ? "Current offer retained"
                : message.kind === "COUNTEROFFER"
                  ? "Counteroffer sent"
                  : "Revised offer sent"}
          </strong>
          <small>
            Quotation v{message.version_number} ·{" "}
            {quotationDate(message.created_at)} (Dhaka)
          </small>
          {message.scope && (
            <small>
              {message.scope === "BOTH"
                ? "Medicine price and delivery charge"
                : message.scope === "MEDICINE"
                  ? "Medicine price"
                  : "Delivery charge"}
            </small>
          )}
          <p>{message.body}</p>
          {message.proposed_medicine_subtotal !== undefined && (
            <p>
              Proposed medicine subtotal for all quoted items:{" "}
              {currency
                ? money(message.proposed_medicine_subtotal, currency)
                : message.proposed_medicine_subtotal}
            </p>
          )}
          {message.proposed_delivery_charge !== undefined && (
            <p>
              Proposed delivery charge:{" "}
              {currency
                ? money(message.proposed_delivery_charge, currency)
                : message.proposed_delivery_charge}
            </p>
          )}
        </article>
      ))}
    </div>
  ) : (
    <p className="muted">No changes requested yet.</p>
  );
}
