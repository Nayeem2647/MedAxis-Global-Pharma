'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Snowflake } from 'lucide-react';
import { acceptedStatus, type CustomerQuotation } from '../../lib/quotation';

export function QuotationDocument({ quotation: q }: { quotation: CustomerQuotation }) {
  const t = useTranslations('Quotation');
  const locale = useLocale();
  const stamp = (value: string) => <time dateTime={value}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC</time>;
  const money = (amount: string) => <span className="commercial-amount">{q.billing_currency} {amount}</span>;
  const accepted = acceptedStatus(q.status);
  return <>
    <div className="quotation-document-title"><div><p className="eyebrow">{t('privateDocument')}</p><h1>{t(accepted ? 'proformaTitle' : 'title')}</h1><p className="muted">{t('version', { number: q.version_number })}</p></div><span className="quotation-status">{t(`status.${q.status}`)}</span></div>
    <div className="quotation-facts"><section><h2>{t('preparedFor')}</h2><strong>{q.contact.full_name}</strong>{q.contact.company_name && <p>{q.contact.company_name}</p>}
      {q.contact.email && <p>{q.contact.email}</p>}{q.contact.whatsapp_number && <p>WhatsApp: {q.contact.whatsapp_number}</p>}{q.contact.wechat_id && <p>WeChat: {q.contact.wechat_id}</p>}
    </section><dl>{q.issued_at && <><dt>{t('issued')}</dt><dd>{stamp(q.issued_at)}</dd></>}<dt>{t('validUntil')}</dt><dd>{stamp(q.valid_until)}</dd><dt>{t('billingCurrency')}</dt><dd>{q.billing_currency}</dd></dl></div>
    {accepted && <section className="quotation-confirmed"><CheckCircle2 size={24}/><div><h2>{t('acceptedHeading')}</h2>
      {q.accepted_at && <p>{t('acceptedAt')}: {stamp(q.accepted_at)}</p>}
      <p>{t('reservationStatus')}: {t(`reservation.${q.reservation_status}`)}</p>
      {q.reservation_expires_at && <p>{t('reservationDeadline')}: {stamp(q.reservation_expires_at)}</p>}
      <p className="small">{t('reservationHelp')}</p></div></section>}
    <section className="quotation-lines-section"><h2>{t('itemsTitle')}</h2><p className="small muted">{t('availabilityCount', q.availability)}</p>
      <div className="quotation-table-scroll" tabIndex={0} role="region" aria-label={t('itemsTitle')}><table className="quotation-table"><thead><tr><th>{t('medicine')}</th><th>{t('quantity')}</th><th>{t('availability')}</th><th>{t('unitPrice')}</th><th>{t('lineTotal')}</th></tr></thead>
        <tbody>{q.items.map((item) => <tr key={item.id}><td><strong>{item.brand_name}</strong><span>{item.generic_name} · {item.strength}</span><span>{item.dosage_form} · {item.pack_size}</span>{item.customer_facing_note && <p className="small quotation-line-note">{item.customer_facing_note}</p>}</td>
          <td data-label={t('quantity')}>{item.quantity}<span>{item.packaging_unit}</span></td><td data-label={t('availability')}>{t(`availabilityLabel.${item.availability_status}`)}</td><td data-label={t('unitPrice')}>{item.availability_status === 'AVAILABLE' ? money(item.unit_quoted_price) : <span className="muted">{t('notPayable')}</span>}</td><td data-label={t('lineTotal')}>{item.availability_status === 'AVAILABLE' ? money(item.total_line_price) : '—'}</td></tr>)}</tbody></table></div>
      <p className="small muted">{t('unavailableHelp')}</p>
    </section>
    <dl className="quotation-totals"><div><dt>{t('subtotal')}</dt><dd>{money(q.subtotal_amount)}</dd></div><div><dt>{t('freight')}</dt><dd>{money(q.freight_cost)}</dd></div><div><dt>{t('insurance')}</dt><dd>{money(q.insurance_cost)}</dd></div><div className="quotation-total"><dt>{t('total')}</dt><dd>{money(q.total_amount)}</dd></div></dl>
    <div className="quotation-commercial-terms"><section><h2>{t('shippingTitle')}</h2><p>{q.shipping_terms.method === 'INCOTERM' ? q.shipping_terms.incoterm : t('expressCourier')} · {q.shipping_terms.named_place}</p>
      {q.shipping_terms.cold_chain_required && <p className="quotation-cold-chain"><Snowflake size={17}/>{t('coldChain')}{q.shipping_terms.temperature_range ? ` · ${q.shipping_terms.temperature_range}` : ''}</p>}
      {q.shipment && <><p>{t('courier')}: {q.shipment.courier_name}</p><p>{t('tracking')}: {q.shipment.awb_tracking_number}</p><p>{t('dispatched')}: {stamp(q.shipment.dispatched_at)}</p>{q.shipment.estimated_delivery && <p>{t('estimatedDelivery')}: {stamp(q.shipment.estimated_delivery)}</p>}</>}
      {q.delivered_at && <p>{t('delivered')}: {stamp(q.delivered_at)}</p>}
    </section><section><h2>{t('paymentTitle')}</h2><p>{t('wireTerms')}</p>{q.payment && <><p>{t('paymentReference')}: {q.payment.reference}</p><p>{q.payment.currency} {q.payment.amount}</p><p>{t('received')}: {stamp(q.payment.received_at)}</p></>}</section></div>
    <section className="quotation-bank"><h2>{t('bankTitle')}</h2>{q.bank_details ? <><p className="small muted">{t('bankHelp')}</p><dl>
      <dt>{t('beneficiary')}</dt><dd>{q.bank_details.beneficiary_name}</dd><dt>{t('bankName')}</dt><dd>{q.bank_details.bank_name}</dd><dt>{t('accountNumber')}</dt><dd>{q.bank_details.account_number}</dd><dt>SWIFT</dt><dd>{q.bank_details.swift_code}</dd>
      {q.bank_details.bank_address && <><dt>{t('bankAddress')}</dt><dd>{q.bank_details.bank_address}</dd></>}{q.bank_details.currency && <><dt>{t('bankCurrency')}</dt><dd>{q.bank_details.currency}</dd></>}
    </dl><p className="quotation-bank-instructions">{q.bank_details.instructions}</p></> : <p className="muted">{t('bankUnavailable')}</p>}</section>
  </>;
}
