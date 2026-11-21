'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Download } from 'lucide-react';
import { z } from 'zod';
import { acceptedStatus } from '../../lib/quotation';
import { accountQuotationSchema } from '../../lib/customer-contract';
import { customerRequest } from '../../lib/customer-api';
import {
  QuotationBankCard,
  QuotationCommercialCards,
  QuotationProgress,
} from '../quotation/QuotationDocument';

export function CustomerQuotationDetails({ quotation, onBack, onRevision }: { quotation: z.infer<typeof accountQuotationSchema>; onBack(): void; onRevision(): void }) {
  const t = useTranslations('Customer');
  const tQuote = useTranslations('Quotation');
  const locale = useLocale();
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState(''); const [notice, setNotice] = useState('');
  const request = useRef({ notes: '', id: '' });
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
  const accepted = acceptedStatus(quotation.status);

  async function download() {
    if (busy) return; setBusy(true); setProblem('');
    try {
      const response = await fetch(`/api/customer/quotations/${quotation.id}/pdf`, { credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(45000) });
      if (!response.ok || !/^application\/pdf/i.test(response.headers.get('content-type') ?? '')) throw new Error();
      const blob = await response.blob(); if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error();
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `MedAxis-quotation-v${quotation.version_number}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setProblem(t('pdfUnavailable')); } finally { setBusy(false); }
  }
  async function revise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const notes = String(new FormData(event.currentTarget).get('notes') ?? '').trim();
    if (!notes) return;
    if (request.current.notes !== notes) request.current = { notes, id: crypto.randomUUID() };
    setBusy(true); setProblem('');
    try {
      await customerRequest(`quotations/${quotation.id}/revisions`, z.object({ message_id: z.uuid(), replayed: z.boolean() }), { method: 'POST', body: { notes, request_id: request.current.id } });
      setNotice(t('revisionSent')); onRevision();
    } catch { setProblem(t('revisionFailed')); } finally { setBusy(false); }
  }
  return <section className="customer-panel customer-quotation-detail">
    <button type="button" className="text-button" onClick={onBack}>{t('backToQuotations')}</button>
    <div className="customer-section-heading">
      <div>
        <p className="eyebrow">{t('quotation')}</p>
        <h2>{quotation.quotation_number} <span className="customer-version">v{quotation.version_number}</span></h2>
      </div>
      <button type="button" className="button secondary" disabled={busy} onClick={download}><Download size={17}/>{t('downloadPdf')}</button>
    </div>

    <QuotationProgress status={quotation.status} />

    <dl className="customer-facts">
      <div>
        <dt>{t('status')}</dt>
        <dd>
          <span className={`quotation-status is-${quotation.status.toLowerCase()}`}>
            {t.has(`statuses.${quotation.status}`) ? t(`statuses.${quotation.status}`) : quotation.status}
          </span>
        </dd>
      </div>
      {quotation.issued_at && (
        <div>
          <dt>{tQuote('issued')}</dt>
          <dd>{date(quotation.issued_at)}</dd>
        </div>
      )}
      <div><dt>{t('validUntil')}</dt><dd>{date(quotation.valid_until)}</dd></div>
      <div><dt>{t('currency')}</dt><dd>{quotation.billing_currency}</dd></div>
    </dl>

    {accepted && (
      <section className="quotation-confirmed">
        <CheckCircle2 size={24} aria-hidden="true" />
        <div>
          <h2>{tQuote('acceptedHeading')}</h2>
          <div className="quotation-confirmed-facts">
            {quotation.accepted_at && <p>{tQuote('acceptedAt')}: {date(quotation.accepted_at)}</p>}
            <p>{tQuote('reservationStatus')}: {tQuote(`reservation.${quotation.reservation_status}`)}</p>
            {quotation.reservation_expires_at && <p>{tQuote('reservationDeadline')}: {date(quotation.reservation_expires_at)}</p>}
          </div>
          <p className="small">{tQuote('reservationHelp')}</p>
        </div>
      </section>
    )}

    <div className="customer-quote-lines-header">
      <h3>{tQuote('itemsTitle')}</h3>
      <p className="small muted">{tQuote('availabilityCount', quotation.availability)}</p>
    </div>

    <div className="customer-table-wrap">
      <table className="customer-table">
        <thead>
          <tr>
            <th>{t('medicine')}</th>
            <th>{t('quantity')}</th>
            <th>{tQuote('availability')}</th>
            <th>{t('unitPrice')}</th>
            <th>{t('total')}</th>
          </tr>
        </thead>
        <tbody>
          {quotation.items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.brand_name}</strong>
                <span className="customer-muted-block">{item.generic_name} · {item.strength}</span>
                <span className="customer-muted-block">{item.dosage_form} · {item.pack_size}</span>
                {item.customer_facing_note && <span className="customer-muted-block">{item.customer_facing_note}</span>}
              </td>
              <td>{item.quantity} {item.packaging_unit}</td>
              <td>
                <span className={`quotation-line-badge is-${item.availability_status.toLowerCase()}`}>
                  {t.has(`statuses.${item.availability_status}`) ? t(`statuses.${item.availability_status}`) : item.availability_status}
                </span>
              </td>
              <td>{item.availability_status === 'AVAILABLE' ? `${quotation.billing_currency} ${item.unit_quoted_price}` : t('unavailableItem')}</td>
              <td>{item.availability_status === 'AVAILABLE' ? `${quotation.billing_currency} ${item.total_line_price}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <dl className="customer-quote-totals">
      <div><dt>{t('subtotal')}</dt><dd>{quotation.billing_currency} {quotation.subtotal_amount}</dd></div>
      <div><dt>{t('freight')}</dt><dd>{quotation.billing_currency} {quotation.freight_cost}</dd></div>
      <div><dt>{t('insurance')}</dt><dd>{quotation.billing_currency} {quotation.insurance_cost}</dd></div>
      <div className="quotation-total"><dt>{t('total')}</dt><dd>{quotation.billing_currency} {quotation.total_amount}</dd></div>
    </dl>

    <QuotationCommercialCards quotation={quotation} />
    <QuotationBankCard bankDetails={quotation.bank_details} />

    {quotation.is_current && quotation.status === 'SENT' && new Date(quotation.valid_until) > new Date() && (
      <form className="stack-form customer-revision-form" onSubmit={revise}>
        <h3>{t('requestRevision')}</h3>
        <label>{t('revisionNotes')}<textarea name="notes" required maxLength={2000} rows={4} disabled={busy}/></label>
        <button type="submit" className="button primary" disabled={busy}>{t(busy ? 'working' : 'sendRevision')}</button>
      </form>
    )}
    <p className="customer-field-help">{t('quoteDecisionHelp')}</p>
    {problem && <p role="alert" className="customer-feedback is-error">{problem}</p>}
    {notice && <p role="status" className="customer-feedback">{notice}</p>}
  </section>;
}
