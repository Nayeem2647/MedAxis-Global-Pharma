import { quotationDate, quotationStatus } from "../../lib/admin-quotations";
import type { AdminVersion } from "../../lib/admin-workflow";

export function FxRatesCard({
  title,
  capturedAt,
  stale,
  ratesToBdt,
  modes,
  fetchedAt,
}: {
  title: string;
  capturedAt: string;
  stale: boolean;
  ratesToBdt: Record<"USD" | "EUR" | "CNY", string>;
  modes?: Record<"USD" | "EUR" | "CNY", string>;
  fetchedAt?: Record<"USD" | "EUR" | "CNY", string>;
}) {
  return (
    <section className="admin-panel quotation-fx-panel">
      <div className="admin-section-heading">
        <h2>{title}</h2>
        <span
          className={`quotation-status ${stale ? "quotation-status-accepted" : "quotation-status-payment_received"}`}
        >
          {stale ? "Stale rates used" : "Fresh rates"}
        </span>
      </div>
      <p className="small muted">
        Captured {quotationDate(capturedAt)} (Dhaka)
      </p>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Currency</th>
              <th>Rate to BDT</th>
              {modes && <th>Mode</th>}
              {fetchedAt && <th>Fetched (Dhaka)</th>}
            </tr>
          </thead>
          <tbody>
            {(["USD", "EUR", "CNY"] as const).map((currency) => (
              <tr key={currency}>
                <td>
                  <strong>{currency}</strong>
                </td>
                <td className="quotation-amount">{ratesToBdt[currency]}</td>
                {modes && <td>{modes[currency].replaceAll("_", " ")}</td>}
                {fetchedAt && <td>{quotationDate(fetchedAt[currency])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function QuoteSummary({ version }: { version: AdminVersion }) {
  return (
    <section className="admin-panel quotation-summary-card">
      <div className="admin-section-heading">
        <div>
          <h2>Commercial version {version.version_number}</h2>
          <p className="small muted">
            {version.items.length}{" "}
            {version.items.length === 1 ? "medicine line" : "medicine lines"} ·{" "}
            {version.billing_currency}
          </p>
        </div>
        <span
          className={`quotation-status quotation-status-${version.status.toLowerCase()}`}
        >
          {quotationStatus(version.status)}
        </span>
      </div>

      <div
        className="admin-table-scroll"
        role="region"
        tabIndex={0}
        aria-label="Quotation lines"
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Quantity</th>
              <th>Availability</th>
              <th>Unit price</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {version.items.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.brand_name}</strong>
                  <span>
                    {line.generic_name} · {line.strength} · {line.dosage_form} ·{" "}
                    {line.pack_size}
                  </span>
                  {line.customer_facing_note && (
                    <p className="small muted">{line.customer_facing_note}</p>
                  )}
                </td>
                <td>
                  {line.quantity} {line.packaging_unit}
                </td>
                <td>
                  <span
                    className={`quotation-status ${
                      line.availability_status === "AVAILABLE"
                        ? "quotation-status-payment_received"
                        : line.availability_status === "SOURCING"
                          ? "quotation-status-accepted"
                          : "quotation-status-declined"
                    }`}
                  >
                    {quotationStatus(line.availability_status)}
                  </span>
                </td>
                <td className="quotation-amount">
                  {line.availability_status === "AVAILABLE"
                    ? `${version.billing_currency} ${line.unit_quoted_price}`
                    : "Not payable"}
                </td>
                <td className="quotation-amount">
                  {line.availability_status === "AVAILABLE"
                    ? `${version.billing_currency} ${line.total_line_price}`
                    : "Not payable"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="quotation-totals-box">
        <dl className="admin-facts">
          <dt>Subtotal</dt>
          <dd className="quotation-amount">
            {version.billing_currency} {version.subtotal_amount}
          </dd>
          <dt>Freight</dt>
          <dd className="quotation-amount">{version.freight_cost}</dd>
          <dt>Insurance</dt>
          <dd className="quotation-amount">{version.insurance_cost}</dd>
          <dt>Server total</dt>
          <dd className="quotation-amount quotation-server-total">
            <strong>
              {version.billing_currency} {version.total_amount}
            </strong>
          </dd>
        </dl>
      </div>

      <dl className="admin-facts">
        <dt>Shipping</dt>
        <dd>
          {version.shipping_terms.method.replaceAll("_", " ")}{" "}
          {version.shipping_terms.incoterm} ·{" "}
          {version.shipping_terms.named_place}
          {version.shipping_terms.cold_chain_required
            ? " · Cold-chain handling"
            : ""}{" "}
          {version.shipping_terms.temperature_range}
        </dd>
        <dt>Payment</dt>
        <dd>{version.payment_terms.replaceAll("_", " ")}</dd>
        {version.valid_until && (
          <>
            <dt>Valid until</dt>
            <dd>{quotationDate(version.valid_until)}</dd>
          </>
        )}
        {version.reservation_expires_at && (
          <>
            <dt>Server reservation expiry</dt>
            <dd>
              {quotationDate(version.reservation_expires_at)} ·{" "}
              {version.reservation_status}
            </dd>
          </>
        )}
        {version.payment && (
          <>
            <dt>Recorded wire payment</dt>
            <dd>
              {version.payment.currency} {version.payment.amount} ·{" "}
              {version.payment.reference} ·{" "}
              {quotationDate(version.payment.received_at)}
            </dd>
          </>
        )}
        {version.shipment && (
          <>
            <dt>Shipment</dt>
            <dd>
              {version.shipment.courier_name} ·{" "}
              {version.shipment.awb_tracking_number} ·{" "}
              {quotationDate(version.shipment.dispatched_at)}
              {version.shipment.estimated_delivery
                ? ` · Estimated ${quotationDate(version.shipment.estimated_delivery)}`
                : ""}
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
    </section>
  );
}
