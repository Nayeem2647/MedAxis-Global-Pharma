'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Check, CheckCircle2, Copy, CreditCard, FileText, Snowflake, Truck } from 'lucide-react';
import { acceptedStatus, type CustomerQuotation } from '../../lib/quotation';

const lifecycleSteps = ['SENT', 'ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED'] as const;

function CopyFieldButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('Quotation');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard permission unavailable */
    }
  }

  return (
    <button
      type="button"
      className="quotation-copy-btn"
      aria-label={t('copyField', { label })}
      onClick={() => void onCopy()}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span>{t(copied ? 'copied' : 'copy')}</span>
    </button>
  );
}

export function QuotationDocument({ quotation: q }: { quotation: CustomerQuotation }) {
  const t = useTranslations('Quotation');
  const locale = useLocale();
  const stamp = (value: string) => (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC
    </time>
  );
  const money = (amount: string) => <span className="commercial-amount">{q.billing_currency} {amount}</span>;
  const accepted = acceptedStatus(q.status);
  const currentStepIndex = lifecycleSteps.indexOf(q.status as (typeof lifecycleSteps)[number]);

  return <>
    <div className="quotation-document-title">
      <div>
        <p className="eyebrow">{t('privateDocument')}</p>
        <h1>{t(accepted ? 'proformaTitle' : 'title')}</h1>
        <p className="muted quotation-version-label">{t('version', { number: q.version_number })}</p>
      </div>
      <span className={`quotation-status is-${q.status.toLowerCase()}`}>{t(`status.${q.status}`)}</span>
    </div>

    {currentStepIndex >= 0 && (
      <ol className="quotation-progress" aria-label={t('progressLabel')}>
        {lifecycleSteps.map((step, index) => {
          const done = index < currentStepIndex || (index === currentStepIndex && q.status === 'DELIVERED');
          const active = index === currentStepIndex && q.status !== 'DELIVERED';
          return (
            <li key={step} className={`quotation-progress-step${done ? ' is-done' : active ? ' is-active' : ''}`}>
              <span className="quotation-progress-marker" aria-hidden="true">
                {done ? <Check size={14} /> : index + 1}
              </span>
              <span className="quotation-progress-label">{t(`steps.${step}`)}</span>
            </li>
          );
        })}
      </ol>
    )}

    <div className="quotation-facts">
      <section className="quotation-card">
        <h2><Building2 size={17} aria-hidden="true" />{t('preparedFor')}</h2>
        <strong className="quotation-buyer-name">{q.contact.full_name}</strong>
        {q.contact.company_name && <p>{q.contact.company_name}</p>}
        {q.contact.email && <p>{q.contact.email}</p>}
        {q.contact.whatsapp_number && <p>WhatsApp: {q.contact.whatsapp_number}</p>}
        {q.contact.wechat_id && <p>WeChat: {q.contact.wechat_id}</p>}
      </section>
      <section className="quotation-card">
        <h2><FileText size={17} aria-hidden="true" />{t('title')}</h2>
        <dl>
          {q.issued_at && <><dt>{t('issued')}</dt><dd>{stamp(q.issued_at)}</dd></>}
          <dt>{t('validUntil')}</dt><dd>{stamp(q.valid_until)}</dd>
          <dt>{t('billingCurrency')}</dt><dd>{q.billing_currency}</dd>
        </dl>
      </section>
    </div>

    {accepted && (
      <section className="quotation-confirmed">
        <CheckCircle2 size={24} aria-hidden="true" />
        <div>
          <h2>{t('acceptedHeading')}</h2>
          <div className="quotation-confirmed-facts">
            {q.accepted_at && <p>{t('acceptedAt')}: {stamp(q.accepted_at)}</p>}
            <p>{t('reservationStatus')}: {t(`reservation.${q.reservation_status}`)}</p>
            {q.reservation_expires_at && <p>{t('reservationDeadline')}: {stamp(q.reservation_expires_at)}</p>}
          </div>
          <p className="small">{t('reservationHelp')}</p>
        </div>
      </section>
    )}

    <section className="quotation-lines-section">
      <div className="quotation-lines-header">
        <h2>{t('itemsTitle')}</h2>
        <p className="small muted">{t('availabilityCount', q.availability)}</p>
      </div>
      <div className="quotation-table-scroll" tabIndex={0} role="region" aria-label={t('itemsTitle')}>
        <table className="quotation-table">
          <thead>
            <tr>
              <th>{t('medicine')}</th>
              <th>{t('quantity')}</th>
              <th>{t('availability')}</th>
              <th>{t('unitPrice')}</th>
              <th>{t('lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.brand_name}</strong>
                  <span>{item.generic_name} · {item.strength}</span>
                  <span>{item.dosage_form} · {item.pack_size}</span>
                  {item.customer_facing_note && <p className="small quotation-line-note">{item.customer_facing_note}</p>}
                </td>
                <td data-label={t('quantity')}>{item.quantity}<span>{item.packaging_unit}</span></td>
                <td data-label={t('availability')}>
                  <span className={`quotation-line-badge is-${item.availability_status.toLowerCase()}`}>
                    {t(`availabilityLabel.${item.availability_status}`)}
                  </span>
                </td>
                <td data-label={t('unitPrice')}>
                  {item.availability_status === 'AVAILABLE' ? money(item.unit_quoted_price) : <span className="muted">{t('notPayable')}</span>}
                </td>
                <td data-label={t('lineTotal')}>
                  {item.availability_status === 'AVAILABLE' ? money(item.total_line_price) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">{t('unavailableHelp')}</p>
    </section>

    <dl className="quotation-totals">
      <div><dt>{t('subtotal')}</dt><dd>{money(q.subtotal_amount)}</dd></div>
      <div><dt>{t('freight')}</dt><dd>{money(q.freight_cost)}</dd></div>
      <div><dt>{t('insurance')}</dt><dd>{money(q.insurance_cost)}</dd></div>
      <div className="quotation-total"><dt>{t('total')}</dt><dd>{money(q.total_amount)}</dd></div>
    </dl>

    <div className="quotation-commercial-terms">
      <section className="quotation-card">
        <h2><Truck size={17} aria-hidden="true" />{t('shippingTitle')}</h2>
        <p>{q.shipping_terms.method === 'INCOTERM' ? q.shipping_terms.incoterm : t('expressCourier')} · {q.shipping_terms.named_place}</p>
        {q.shipping_terms.cold_chain_required && (
          <p className="quotation-cold-chain">
            <Snowflake size={17} aria-hidden="true" />
            {t('coldChain')}{q.shipping_terms.temperature_range ? ` · ${q.shipping_terms.temperature_range}` : ''}
          </p>
        )}
        {q.shipment && (
          <div className="quotation-shipment-box">
            <p>{t('courier')}: <strong>{q.shipment.courier_name}</strong></p>
            <div className="quotation-copy-row">
              <p>{t('tracking')}: <strong>{q.shipment.awb_tracking_number}</strong></p>
              <CopyFieldButton value={q.shipment.awb_tracking_number} label={t('tracking')} />
            </div>
            <p>{t('dispatched')}: {stamp(q.shipment.dispatched_at)}</p>
            {q.shipment.estimated_delivery && <p>{t('estimatedDelivery')}: {stamp(q.shipment.estimated_delivery)}</p>}
          </div>
        )}
        {q.delivered_at && <p>{t('delivered')}: {stamp(q.delivered_at)}</p>}
      </section>

      <section className="quotation-card">
        <h2><CreditCard size={17} aria-hidden="true" />{t('paymentTitle')}</h2>
        <p>{t('wireTerms')}</p>
        {q.payment && (
          <div className="quotation-shipment-box">
            <p>{t('paymentReference')}: <strong>{q.payment.reference}</strong></p>
            <p>{q.payment.currency} {q.payment.amount}</p>
            <p>{t('received')}: {stamp(q.payment.received_at)}</p>
          </div>
        )}
      </section>
    </div>

    <section className="quotation-bank quotation-card">
      <h2>{t('bankTitle')}</h2>
      {q.bank_details ? (
        <>
          <p className="small muted quotation-bank-help">{t('bankHelp')}</p>
          <dl>
            <dt>{t('beneficiary')}</dt>
            <dd className="quotation-copy-row">
              <span>{q.bank_details.beneficiary_name}</span>
              <CopyFieldButton value={q.bank_details.beneficiary_name} label={t('beneficiary')} />
            </dd>
            <dt>{t('bankName')}</dt>
            <dd>{q.bank_details.bank_name}</dd>
            <dt>{t('accountNumber')}</dt>
            <dd className="quotation-copy-row">
              <span>{q.bank_details.account_number}</span>
              <CopyFieldButton value={q.bank_details.account_number} label={t('accountNumber')} />
            </dd>
            <dt>SWIFT</dt>
            <dd className="quotation-copy-row">
              <span>{q.bank_details.swift_code}</span>
              <CopyFieldButton value={q.bank_details.swift_code} label="SWIFT" />
            </dd>
            {q.bank_details.bank_address && (
              <>
                <dt>{t('bankAddress')}</dt>
                <dd>{q.bank_details.bank_address}</dd>
              </>
            )}
            {q.bank_details.currency && (
              <>
                <dt>{t('bankCurrency')}</dt>
                <dd>{q.bank_details.currency}</dd>
              </>
            )}
          </dl>
          <p className="quotation-bank-instructions">{q.bank_details.instructions}</p>
        </>
      ) : (
        <p className="muted">{t('bankUnavailable')}</p>
      )}
    </section>
  </>;
}
