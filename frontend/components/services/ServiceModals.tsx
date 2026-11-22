'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Mail,
  MessageCircle,
  Printer,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { ContactConfig } from '../../lib/public-config';
import { Modal } from '../layout/Modal';
import { usePublicShell } from '../layout/PublicShell';
import type { ServiceId, ServicesCopy } from './services-copy';

export function SampleCoaModal({
  copy,
  onClose,
  onRequestQuote,
}: {
  copy: ServicesCopy['coaModal'];
  onClose(): void;
  onRequestQuote(): void;
}) {
  return (
    <Modal title={copy.title} onClose={onClose} className="svc-modal svc-coa-modal">
      <p className="svc-modal-sub">{copy.subtitle}</p>

      <div className="svc-coa-sheet">
        <div className="svc-coa-watermark" aria-hidden="true">
          <span>{copy.watermark}</span>
          <span>{copy.watermark}</span>
          <span>{copy.watermark}</span>
        </div>

        <div className="svc-coa-banner">
          <div className="svc-coa-brand">
            <FileCheck2 size={20} aria-hidden="true" />
            <div>
              <strong>MedAxis Global Pharma</strong>
              <span>{copy.docNumberLabel}: {copy.docNumber}</span>
            </div>
          </div>
          <span className="svc-coa-verified-stamp">
            <ShieldCheck size={14} aria-hidden="true" />
            COA VERIFIED
          </span>
        </div>

        <dl className="svc-coa-meta-grid">
          <div>
            <dt>{copy.productLabel}</dt>
            <dd>{copy.productValue}</dd>
          </div>
          <div>
            <dt>{copy.batchLabel}</dt>
            <dd className="is-mono">{copy.batchValue}</dd>
          </div>
          <div>
            <dt>{copy.mfgDateLabel}</dt>
            <dd>{copy.mfgDateValue}</dd>
          </div>
          <div>
            <dt>{copy.expDateLabel}</dt>
            <dd>{copy.expDateValue}</dd>
          </div>
          <div>
            <dt>{copy.originLabel}</dt>
            <dd>{copy.originValue}</dd>
          </div>
          <div>
            <dt>{copy.storageLabel}</dt>
            <dd>{copy.storageValue}</dd>
          </div>
        </dl>

        <div className="svc-coa-table-wrap">
          <table className="svc-coa-table">
            <thead>
              <tr>
                {copy.tableHeaders.map((header) => (
                  <th key={header} scope="col">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {copy.rows.map(([parameter, spec, result, status]) => (
                <tr key={parameter}>
                  <td><strong>{parameter}</strong></td>
                  <td>{spec}</td>
                  <td>{result}</td>
                  <td>
                    <span className="svc-pass-badge">{status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="svc-coa-signoff">
          <span>{copy.qaSignOffLabel}</span>
          <strong>{copy.qaSignOffValue}</strong>
        </div>
      </div>

      <p className="svc-coa-disclaimer">{copy.disclaimer}</p>

      <div className="svc-modal-actions">
        <button type="button" className="svc-btn svc-btn-secondary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" />
          <span>{copy.printAction}</span>
        </button>
        <button
          type="button"
          className="svc-btn svc-btn-primary"
          onClick={() => {
            onClose();
            onRequestQuote();
          }}
        >
          <span>{copy.requestVerifiedCta}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Modal>
  );
}

interface QuoteSubmissionSnapshot {
  ref: string;
  company: string;
  contactPerson: string;
  channel: string;
  serviceLabel: string;
  medicine: string;
  destination: string;
}

export function ServiceQuickQuoteModal({
  copy,
  tabs,
  initialService,
  locale,
  contact,
  onClose,
}: {
  copy: ServicesCopy['quoteModal'];
  tabs: ServicesCopy['tabs'];
  initialService: ServiceId;
  locale: string;
  contact?: ContactConfig;
  onClose(): void;
}) {
  const { openQuickQuote } = usePublicShell();
  const [company, setCompany] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [channel, setChannel] = useState('');
  const [serviceType, setServiceType] = useState<ServiceId>(initialService);
  const [medicine, setMedicine] = useState('');
  const [destination, setDestination] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<QuoteSubmissionSnapshot | null>(null);

  const selectedServiceLabel = tabs.find((item) => item.id === serviceType)?.label ?? serviceType;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!company.trim()) next.company = copy.requiredField;
    if (!contactPerson.trim()) next.contactPerson = copy.requiredField;
    if (!channel.trim() || channel.trim().length < 4) next.channel = copy.invalidChannel;
    if (!medicine.trim()) next.medicine = copy.requiredField;
    if (!destination.trim()) next.destination = copy.requiredField;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    const timestampPart = String(Date.now()).slice(-6);
    setSubmitted({
      ref: `MX-SVC-${timestampPart}`,
      company: company.trim(),
      contactPerson: contactPerson.trim(),
      channel: channel.trim(),
      serviceLabel: selectedServiceLabel,
      medicine: medicine.trim(),
      destination: destination.trim(),
    });
  }

  const whatsAppHref = submitted && contact?.whatsapp
    ? `${contact.whatsapp}?text=${encodeURIComponent(
        `[${submitted.ref}] Service: ${submitted.serviceLabel} | Company: ${submitted.company} | Contact: ${submitted.contactPerson} (${submitted.channel}) | Medicine: ${submitted.medicine} | Destination: ${submitted.destination}`,
      )}`
    : null;

  return (
    <Modal title={copy.title} onClose={onClose} className="svc-modal svc-quote-modal">
      {submitted ? (
        <div className="svc-quote-success" role="status">
          <div className="svc-success-icon">
            <CheckCircle2 size={34} aria-hidden="true" />
          </div>
          <h3>{copy.successTitle}</h3>
          <p className="svc-modal-sub">{copy.successSubtitle}</p>

          <div className="svc-ref-box">
            <span>{copy.referenceLabel}</span>
            <strong>{submitted.ref}</strong>
          </div>

          <div className="svc-summary-box">
            <h4>{copy.summaryHeading}</h4>
            <dl>
              <div><dt>{copy.companyLabel}</dt><dd>{submitted.company}</dd></div>
              <div><dt>{copy.contactPersonLabel}</dt><dd>{submitted.contactPerson}</dd></div>
              <div><dt>{copy.channelLabel}</dt><dd>{submitted.channel}</dd></div>
              <div><dt>{copy.serviceTypeLabel}</dt><dd>{submitted.serviceLabel}</dd></div>
              <div><dt>{copy.medicineLabel}</dt><dd>{submitted.medicine}</dd></div>
              <div><dt>{copy.destinationLabel}</dt><dd>{submitted.destination}</dd></div>
            </dl>
          </div>

          <div className="svc-modal-actions">
            {whatsAppHref && (
              <a
                href={whatsAppHref}
                target="_blank"
                rel="noopener noreferrer"
                className="svc-btn svc-btn-primary"
              >
                <MessageCircle size={16} aria-hidden="true" />
                <span>{copy.whatsAppFallback}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              className="svc-btn svc-btn-secondary"
              onClick={() => {
                setSubmitted(null);
                setMedicine('');
              }}
            >
              {copy.submitAnother}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="svc-modal-sub">{copy.subtitle}</p>
          {Object.keys(errors).length > 0 && (
            <p className="svc-form-banner-error" role="alert">
              {copy.validationSummary}
            </p>
          )}

          <form className="svc-quote-form" onSubmit={handleSubmit} noValidate>
            <div className="svc-form-grid">
              <label className="svc-field">
                <span>
                  <Building2 size={14} aria-hidden="true" />
                  {copy.companyLabel} *
                </span>
                <input
                  type="text"
                  name="company"
                  value={company}
                  onChange={(e) => {
                    setCompany(e.currentTarget.value);
                    if (errors.company) setErrors((prev) => ({ ...prev, company: '' }));
                  }}
                  placeholder={copy.companyPlaceholder}
                  aria-invalid={Boolean(errors.company) || undefined}
                />
                {errors.company && <em className="svc-field-err" role="alert">{errors.company}</em>}
              </label>

              <label className="svc-field">
                <span>
                  <User size={14} aria-hidden="true" />
                  {copy.contactPersonLabel} *
                </span>
                <input
                  type="text"
                  name="contactPerson"
                  value={contactPerson}
                  onChange={(e) => {
                    setContactPerson(e.currentTarget.value);
                    if (errors.contactPerson) setErrors((prev) => ({ ...prev, contactPerson: '' }));
                  }}
                  placeholder={copy.contactPersonPlaceholder}
                  aria-invalid={Boolean(errors.contactPerson) || undefined}
                />
                {errors.contactPerson && <em className="svc-field-err" role="alert">{errors.contactPerson}</em>}
              </label>

              <label className="svc-field svc-field-wide">
                <span>
                  <Mail size={14} aria-hidden="true" />
                  {copy.channelLabel} *
                </span>
                <input
                  type="text"
                  name="channel"
                  value={channel}
                  onChange={(e) => {
                    setChannel(e.currentTarget.value);
                    if (errors.channel) setErrors((prev) => ({ ...prev, channel: '' }));
                  }}
                  placeholder={copy.channelPlaceholder}
                  aria-invalid={Boolean(errors.channel) || undefined}
                />
                {errors.channel && <em className="svc-field-err" role="alert">{errors.channel}</em>}
              </label>

              <label className="svc-field">
                <span>{copy.serviceTypeLabel} *</span>
                <select
                  name="serviceType"
                  value={serviceType}
                  onChange={(e) => setServiceType(e.currentTarget.value as ServiceId)}
                >
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="svc-field">
                <span>{copy.destinationLabel} *</span>
                <select
                  name="destination"
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.currentTarget.value);
                    if (errors.destination) setErrors((prev) => ({ ...prev, destination: '' }));
                  }}
                  aria-invalid={Boolean(errors.destination) || undefined}
                >
                  <option value="">{copy.destinationPlaceholder}</option>
                  {copy.countries.map((country) => (
                    <option key={country.code} value={country.label}>
                      {country.label}
                    </option>
                  ))}
                </select>
                {errors.destination && <em className="svc-field-err" role="alert">{errors.destination}</em>}
              </label>

              <label className="svc-field svc-field-wide">
                <span>{copy.medicineLabel} *</span>
                <textarea
                  name="medicine"
                  rows={3}
                  value={medicine}
                  onChange={(e) => {
                    setMedicine(e.currentTarget.value);
                    if (errors.medicine) setErrors((prev) => ({ ...prev, medicine: '' }));
                  }}
                  placeholder={copy.medicinePlaceholder}
                  aria-invalid={Boolean(errors.medicine) || undefined}
                />
                {errors.medicine && <em className="svc-field-err" role="alert">{errors.medicine}</em>}
              </label>
            </div>

            <div className="svc-security-row">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>{copy.securityNote}</span>
            </div>

            <div className="svc-modal-actions">
              <Link
                href={`/${locale}/request-quote`}
                className="svc-full-rfq-link"
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  openQuickQuote(undefined, medicine.trim() || undefined);
                }}
              >
                {copy.fullRfqLink}
              </Link>
              <button type="submit" className="svc-btn svc-btn-primary">
                <span>{copy.submitLabel}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}
