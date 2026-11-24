'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2,
  Globe, Headphones, Lock, Minus, Pill,
  Plus, ShieldCheck, Trash2, UploadCloud,
} from 'lucide-react';
import { useRfqSubmission } from '../../hooks/useRfqSubmission';
import { addCartItem, catalogCartId, CartError, type CatalogCartInput, type CartItem } from '../../lib/cart';
import { cartLine, rfqBusinessSchema, rfqLineSchema, type RfqKind } from '../../lib/rfq';
import type { ContactConfig } from '../../lib/public-config';
import type { HomeProduct } from '../../lib/public-catalog';
import { productCartInput } from '../../lib/product-tools';
import { useCart } from '../layout/CartProvider';
import { ContactChannels } from '../layout/ContactDialog';
import { PrescriptionUpload } from './PrescriptionUpload';
import { MedicineSearch } from './MedicineSearch';

type FieldErrors = Record<string, boolean>;

/** Map api field path → which of our 2 steps it lives in */
function stepForField(field: string): 0 | 1 {
  if (field === 'items' || field.startsWith('items.')) return 0;
  return 1;
}

/* ─── Country phone prefix map (most common destinations) ─── */
const PHONE_PREFIXES: Record<string, string> = {
  BD: '+880', CN: '+86', IN: '+91', US: '+1', GB: '+44',
  DE: '+49', AE: '+971', SA: '+966', PK: '+92', MY: '+60',
  SG: '+65', TH: '+66', ID: '+62', PH: '+63', VN: '+84',
  FR: '+33', AU: '+61', CA: '+1', BR: '+55', NG: '+234',
};

function getPhonePrefix(country: string): string {
  return PHONE_PREFIXES[country.toUpperCase()] ?? '+';
}

/* ─── Buyer-destination types ─── */
const BUYER_TYPES = [
  { value: 'B2B_HOSPITAL', label: 'Hospital / Clinic' },
  { value: 'B2C_PATIENT', label: 'Patient Home' },
  { value: 'B2B_WHOLESALE', label: 'Distributor' },
] as const;
type BuyerType = (typeof BUYER_TYPES)[number]['value'];

/* ─── All world countries (abbreviated) ─── */
const COUNTRY_OPTIONS = [
  { code: 'BD', name: 'Bangladesh' }, { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' }, { code: 'PK', name: 'Pakistan' },
  { code: 'AE', name: 'UAE' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'MY', name: 'Malaysia' }, { code: 'SG', name: 'Singapore' },
  { code: 'TH', name: 'Thailand' }, { code: 'ID', name: 'Indonesia' },
  { code: 'PH', name: 'Philippines' }, { code: 'VN', name: 'Vietnam' },
  { code: 'NG', name: 'Nigeria' }, { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' }, { code: 'ET', name: 'Ethiopia' },
  { code: 'ZA', name: 'South Africa' }, { code: 'EG', name: 'Egypt' },
  { code: 'MA', name: 'Morocco' }, { code: 'TR', name: 'Turkey' },
  { code: 'RU', name: 'Russia' }, { code: 'UA', name: 'Ukraine' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' }, { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' }, { code: 'NL', name: 'Netherlands' },
  { code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' }, { code: 'NZ', name: 'New Zealand' },
  { code: 'BR', name: 'Brazil' }, { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' }, { code: 'CL', name: 'Chile' },
  { code: 'JP', name: 'Japan' }, { code: 'KR', name: 'South Korea' },
  { code: 'TW', name: 'Taiwan' }, { code: 'HK', name: 'Hong Kong' },
  { code: 'MO', name: 'Macau' }, { code: 'MM', name: 'Myanmar' },
  { code: 'KH', name: 'Cambodia' }, { code: 'LA', name: 'Laos' },
  { code: 'LK', name: 'Sri Lanka' }, { code: 'NP', name: 'Nepal' },
  { code: 'AF', name: 'Afghanistan' }, { code: 'IQ', name: 'Iraq' },
  { code: 'IR', name: 'Iran' }, { code: 'JO', name: 'Jordan' },
  { code: 'KW', name: 'Kuwait' }, { code: 'QA', name: 'Qatar' },
  { code: 'BH', name: 'Bahrain' }, { code: 'OM', name: 'Oman' },
  { code: 'YE', name: 'Yemen' }, { code: 'LB', name: 'Lebanon' },
  { code: 'SY', name: 'Syria' }, { code: 'PS', name: 'Palestine' },
];

/** Inline packaging unit options */
const UNIT_OPTIONS = ['BOX', 'VIAL', 'BOTTLE', 'STRIP', 'AMPOULE', 'SACHET', 'TUBE', 'PACK'];

/* ─────────────────────────────────────────────────────────────
   Inline cart-line stepper (shown in selected medicines list)
───────────────────────────────────────────────────────────── */
function SelectedItemRow({
  item,
  index,
  locale,
  disabled,
  onRemove,
  onQtyChange,
  onUnitChange,
}: {
  item: CartItem;
  index: number;
  locale: 'en' | 'zh-CN';
  disabled: boolean;
  onRemove(): void;
  onQtyChange(qty: number): void;
  onUnitChange(unit: string): void;
}) {
  const name = item.kind === 'catalog' ? (item.names?.[locale] ?? item.name) : item.name;
  const sub = item.strength || '';

  return (
    <li className="rfq-selected-item">
      {/* Thumbnail placeholder (CartItem has no imageUrl) */}
      <div className="rfq-selected-item-thumb">
        <Pill size={18} className="rfq-search-thumb-icon" aria-hidden="true" />
      </div>

      {/* Info */}
      <div className="rfq-selected-info">
        <strong>{name}</strong>
        {sub && <span>{sub}</span>}
        {/* hidden fields for form submission */}
        <input type="hidden" name={`items.${index}.product_id`} value={item.kind === 'catalog' ? item.id : ''} readOnly />
        <input type="hidden" name={`items.${index}.custom_medicine_name`} value={item.kind === 'custom' ? item.name : ''} readOnly />
        <input type="hidden" name={`items.${index}.custom_strength`} value={item.kind === 'custom' ? (item.strength ?? '') : ''} readOnly />
        <input type="hidden" name={`items.${index}.quantity`} value={item.quantity} readOnly />
      </div>

      {/* Qty stepper */}
      <div className="rfq-qty-stepper" aria-label={`Quantity for ${name}`}>
        <button
          type="button"
          className="rfq-qty-btn"
          aria-label="Decrease"
          disabled={disabled || item.quantity <= 1}
          onClick={() => onQtyChange(Math.max(1, item.quantity - 1))}
        >
          <Minus size={12} aria-hidden="true" />
        </button>
        <input
          type="number"
          className="rfq-qty-value"
          min={1}
          max={9999}
          step={1}
          value={item.quantity}
          disabled={disabled}
          aria-label={`Quantity: ${item.quantity}`}
          onChange={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) onQtyChange(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        />
        <button
          type="button"
          className="rfq-qty-btn"
          aria-label="Increase"
          disabled={disabled || item.quantity >= 9999}
          onClick={() => onQtyChange(item.quantity + 1)}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </div>

      {/* Unit */}
      <select
        className="rfq-unit-select"
        name={`items.${index}.packaging_unit`}
        value={item.packagingUnit}
        disabled={disabled || item.kind === 'catalog'}
        aria-label={`Packaging unit for ${name}`}
        onChange={(e) => onUnitChange(e.target.value)}
      >
        {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        {!UNIT_OPTIONS.includes(item.packagingUnit) && <option value={item.packagingUnit}>{item.packagingUnit}</option>}
      </select>

      {/* Remove */}
      <button
        type="button"
        className="rfq-remove-btn"
        aria-label={`Remove ${name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN RfqForm
───────────────────────────────────────────────────────────── */
export function RfqForm({ kind, product, initialName, contact, onClose, active, onLockChange }: {
  kind: RfqKind;
  product?: CatalogCartInput;
  initialName?: string;
  contact: ContactConfig;
  onClose(): void;
  active: boolean;
  onLockChange(value: boolean): void;
}) {
  const t = useTranslations('Rfq');
  const cartText = useTranslations('Cart');
  const shell = useTranslations('Shell');
  const locale = useLocale() === 'zh-CN' ? 'zh-CN' as const : 'en' as const;

  const cart = useCart();
  const [snapshot, setSnapshot] = useState<readonly CartItem[]>(() => cart.items.map((item) => ({ ...item })));
  const [selectedProduct, setSelectedProduct] = useState(product);

  const { state, locked, isLocked, submit, reconcile } = useRfqSubmission();
  const lastHandledState = useRef(state);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const uploadBusyRef = useRef(false);
  const wasActive = useRef(false);
  const previousStep = useRef(0);

  /* 2-step: 0 = medicines, 1 = delivery+contact+submit */
  const [step, setStep] = useState<0 | 1>(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [buyer, setBuyer] = useState<BuyerType>('B2C_PATIENT');
  const [country, setCountry] = useState('');
  const preferredLocale = locale;
  const [token, setToken] = useState('');
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [prescriptions, setPrescriptions] = useState<string[]>([]);

  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [editedServerFields, setEditedServerFields] = useState<FieldErrors>({});
  const [listIssue, setListIssue] = useState<string>();
  const [listAdded, setListAdded] = useState<string>();
  const [dirty, setDirty] = useState(false);

  /* Expandable panels */
  const [showCustom, setShowCustom] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customStrength, setCustomStrength] = useState('');
  const [customUnit, setCustomUnit] = useState('BOX');
  const [noteText, setNoteText] = useState('');

  /* Quick-quote single product recap */
  const [productRecap, setProductRecap] = useState({
    name: product?.name ?? initialName ?? '',
    quantity: String(product?.quantity ?? 1),
    unit: product?.packagingUnit ?? 'BOX',
    strength: product?.strength ?? '',
    city: '',
    lineUnits: snapshot.map((item) => item.packagingUnit),
  });

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const busy = state.status === 'submitting';
  const succeeded = state.status === 'success' && Boolean(state.receipt);
  const emailRequired = locale === 'zh-CN' || preferredLocale === 'zh-CN' || country.trim().toUpperCase() === 'CN';

  const errors: FieldErrors = { ...localErrors };
  if (state.status === 'invalid') {
    for (const detail of state.error?.details ?? []) {
      if (!editedServerFields[detail.field]) errors[detail.field] = true;
    }
  }

  function invalid(field: string) { return errors[field] || undefined; }
  function fieldError(field: string) {
    return invalid(field)
      ? <span className="rfq-field-error" id={`rfq-${field}`} role="alert">{t(field.endsWith('packaging_unit') ? 'unitInvalid' : 'fieldInvalid')}</span>
      : null;
  }
  function described(field: string) { return invalid(field) ? `rfq-${field}` : undefined; }
  const refreshChallenge = () => { setToken(''); setChallengeVersion((v) => v + 1); };

  /* ── Effects ── */
  useEffect(() => { onLockChange(locked || uploadBusy); }, [locked, uploadBusy, onLockChange]);

  useEffect(() => {
    if (!dirty || succeeded || locked) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, succeeded, locked]);

  useEffect(() => {
    const changed = previousStep.current !== step;
    const activated = active && !wasActive.current;
    wasActive.current = active;
    previousStep.current = step;
    if (!active || (!changed && !activated)) return;
    if (Object.keys(localErrors).length || state.status === 'invalid') return;
    const frame = requestAnimationFrame(() => {
      if (changed) {
        const legend = formRef.current?.querySelector<HTMLElement>(`[data-rfq-step="${step}"] legend`);
        legend?.focus({ preventScroll: true });
        legend?.scrollIntoView({ block: 'start' });
      } else headingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, step, localErrors, state.status]);

  useEffect(() => {
    if (state.status === 'challenge' || state.status === 'invalid') { setToken(''); setChallengeVersion((v) => v + 1); }
    if (state.status === 'invalid') setEditedServerFields({});
  }, [state]);

  useEffect(() => {
    const newServerError = state !== lastHandledState.current && state.status === 'invalid';
    lastHandledState.current = state;
    const activeErrors = Object.entries({
      ...localErrors,
      ...(newServerError ? Object.fromEntries((state.error?.details ?? []).map((d) => [d.field, true])) : {}),
    }).filter(([, hasErr]) => hasErr).map(([field]) => field);
    if (!activeErrors.length) return;
    const targetStep = Math.min(...activeErrors.map(stepForField)) as 0 | 1;
    setStep((current) => (current === targetStep ? current : targetStep));
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }, [localErrors, state]);

  /* ── Form helpers ── */
  function read(form: FormData, name: string) { return String(form.get(name) ?? '').trim(); }
  function optional(form: FormData, name: string) { const v = read(form, name); return v ? { [name]: v } : {}; }

  function quickLine(form: FormData) {
    return {
      quantity: Number(form.get('quantity')),
      packaging_unit: read(form, 'unit'),
      ...(noteText ? { line_notes: noteText } : {}),
      ...(selectedProduct
        ? { is_uncatalogued: false, product_id: selectedProduct.productId }
        : { is_uncatalogued: true, custom_medicine_name: read(form, 'name'), ...(read(form, 'strength') ? { custom_strength: read(form, 'strength') } : {}) }),
    };
  }

  function buildLines(form: FormData) {
    return kind === 'quick-quote'
      ? [quickLine(form)]
      : snapshot.map((item, index) => ({
          ...cartLine(item),
          packaging_unit: read(form, `items.${index}.packaging_unit`) || item.packagingUnit,
          ...(noteText ? { line_notes: noteText } : {}),
        }));
  }

  /* ── Step 0 validation ── */
  function validateStep0(): boolean {
    if (!formRef.current) return false;
    const form = new FormData(formRef.current);
    if (kind === 'cart' && snapshot.length === 0) {
      setLocalErrors({ items: true });
      return false;
    }
    let lines: unknown;
    try { lines = buildLines(form); } catch { setLocalErrors({ items: true }); return false; }
    const parsed = z.array(rfqLineSchema).min(1).max(100).safeParse(lines);
    if (!parsed.success) {
      setLocalErrors(Object.fromEntries(parsed.error.issues.map((issue) => [
        issue.path.length ? `items.${issue.path.join('.')}` : 'items', true,
      ])));
      return false;
    }
    return true;
  }

  function goToStep(target: 0 | 1) {
    if (locked || uploadBusy || target === step) return;
    if (target < step) { setLocalErrors({}); setStep(target); return; }
    if (step === 0 && !validateStep0()) return;
    setLocalErrors({});
    setStep(target);
  }

  function completed() { if (kind === 'cart') cart.clearSubmittedItems(snapshot); }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 1) { goToStep(1); return; }
    if (isLocked() || uploadBusyRef.current) return;
    const form = new FormData(event.currentTarget);
    let lines: unknown;
    try { lines = buildLines(form); } catch { setLocalErrors({ items: true }); return; }
    const parsed = rfqBusinessSchema.safeParse({
      contact: {
        full_name: read(form, 'full_name'),
        customer_type: buyer === 'B2B_HOSPITAL' ? 'B2B_WHOLESALE' : buyer,
        preferred_locale: preferredLocale,
        ...optional(form, 'company_name'),
        ...optional(form, 'email'),
        ...optional(form, 'whatsapp_number'),
        ...optional(form, 'wechat_id'),
      },
      destination_country: country,
      ...optional(form, 'destination_city_port'),
      locale,
      items: lines,
      prescription_ids: prescriptions,
    });
    if (!parsed.success) { setLocalErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), true]))); return; }
    if (!token) { setLocalErrors({ turnstile_token: true }); return; }
    setLocalErrors({});
    if (await submit(parsed.data, token, kind)) completed();
  }

  /* ── Medicine selection (cart mode) ── */
  function selectMedicine(medicine: HomeProduct) {
    if (isLocked() || uploadBusyRef.current || !cart.hydrated) return;
    const selected = productCartInput(medicine);
    setListIssue(undefined);
    if (kind === 'cart') {
      try {
        const next = addCartItem(snapshot, { ...selected, id: catalogCartId(selected), kind: 'catalog' });
        cart.addItem(selected);
        setSnapshot(next);
        setListAdded(t('medicineAddedNamed', { name: medicine.brand_name }));
        setTimeout(() => setListAdded(undefined), 3000);
      } catch (error: unknown) { setListIssue(cartText(error instanceof CartError ? error.issue : 'invalidItem')); return; }
    } else {
      setSelectedProduct(selected);
      setProductRecap((prev) => ({ ...prev, name: selected.name, strength: selected.strength, unit: selected.packagingUnit }));
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[name="quantity"]')?.focus());
    }
    setDirty(true);
    setLocalErrors({});
    setEditedServerFields((prev) => ({ ...prev, items: true, 'items.0.product_id': true, 'items.0.custom_medicine_name': true, 'items.0.custom_strength': true, 'items.0.packaging_unit': true }));
  }

  function updateQty(index: number, qty: number) {
    const item = snapshot[index];
    if (!item) return;
    const updated = snapshot.map((it, i) => i === index ? { ...it, quantity: qty } : it);
    setSnapshot(updated);
    cart.updateQuantity(item.id, qty);
    setDirty(true);
  }

  function removeItem(index: number) {
    const item = snapshot[index];
    if (!item) return;
    const next = snapshot.filter((_, i) => i !== index);
    setSnapshot(next);
    if (item.kind === 'catalog') cart.removeItem(item.id);
    setDirty(true);
  }

  /* Sidebar counts */
  const totalItems = kind === 'cart' ? snapshot.length : (productRecap.name ? 1 : 0);
  const totalUnits = kind === 'cart'
    ? snapshot.reduce((sum, item) => sum + item.quantity, 0)
    : Number(productRecap.quantity) || 0;

  const close = () => { if (!isLocked() && !uploadBusyRef.current) onClose(); };

  const recovery = state.status === 'challenge' ? 'challengeRecovery'
    : state.status === 'conflict' ? 'conflictRecovery'
    : state.status === 'uncertain' ? (state.error?.status === 429 ? 'rateLimited' : state.error?.status === 503 ? 'unavailable' : 'uncertain')
    : 'validationHelp';
  const requestId = state.error?.requestId && /^[\w-]{1,100}$/.test(state.error.requestId) ? state.error.requestId : undefined;

  const title = kind === 'quick-quote' ? shell('quickQuote') : t('cartTitle');

  return (
    <main id={active ? 'main-content' : undefined} className="quote-request-page" aria-label={title}>
      <div className="quote-request-shell">

        {/* ── TOP HEADER ── */}
        <header className="quote-request-heading">
          <div className="quote-heading-left">
            <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
            <span className="quote-confidential-badge" aria-label="Private and confidential enquiry">
              <Lock size={11} aria-hidden="true" />
              PRIVATE &amp; CONFIDENTIAL
            </span>
          </div>
          <button type="button" className="quote-return" onClick={close} disabled={locked || uploadBusy || !cart.hydrated}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to website
          </button>
        </header>

        {/* ── SUCCESS STATE ── */}
        {state.status === 'success' && state.receipt ? (
          <div className="rfq-success" role="status">
            <CheckCircle2 size={48} aria-hidden="true" />
            <h3>{t('success')}</h3>
            <p className="rfq-reference">{state.receipt.rfq_number}</p>
            <p>{t('successHelp')}</p>
            <p className="small muted">{t('emailGuidance')}</p>
            <details className="rfq-details" style={{ marginBottom: '20px' }}>
              <summary>{t('officialContact')}</summary>
              <ContactChannels contact={contact} />
            </details>
            <button className="rfq-cta-btn" style={{ maxWidth: '240px', margin: '0 auto' }} onClick={close}>{t('done')}</button>
          </div>
        ) : (
          <form ref={formRef} noValidate onSubmit={send}>

            {/* ── 2-STEP PROGRESS BAR ── */}
            <nav className="rfq-progress-bar" aria-label={t('stepsLabel')}>
              <button
                type="button"
                className={`rfq-progress-step ${step > 0 ? 'is-done' : 'is-active'}`}
                disabled={locked || uploadBusy || !cart.hydrated}
                aria-current={step === 0 ? 'step' : undefined}
                onClick={() => goToStep(0)}
              >
                <span className="rfq-step-circle" aria-hidden="true">
                  {step > 0 ? <Check size={14} /> : '1'}
                </span>
                Select Medicines
              </button>

              <div className={`rfq-progress-line ${step > 0 ? 'is-filled' : ''}`} aria-hidden="true" />

              <button
                type="button"
                className={`rfq-progress-step ${step === 1 ? 'is-active' : ''}`}
                disabled={locked || uploadBusy || !cart.hydrated}
                aria-current={step === 1 ? 'step' : undefined}
                onClick={() => goToStep(1)}
              >
                <span className="rfq-step-circle" aria-hidden="true">2</span>
                Delivery &amp; Documentation
              </button>
            </nav>

            {/* ── TWO-COLUMN WORKSPACE ── */}
            <div className="quote-request-workspace">

              {/* ══════════ LEFT: FORM CARD ══════════ */}
              <div className="quote-form-card">

                {/* ── STEP 0: Select Medicines ── */}
                <div data-rfq-step="0" hidden={step !== 0} className="rfq-step-panel">
                  <h2>1. What medicines do you need?</h2>

                  {/* Medicine search */}
                  <MedicineSearch
                    enabled={active && step === 0 && !locked && !uploadBusy && cart.hydrated}
                    selectedId={selectedProduct?.productId}
                    addToList={kind === 'cart'}
                    onSelect={selectMedicine}
                  />

                  {/* Success add notice */}
                  {listAdded && <p role="status" className="small" style={{ color: '#0D7377', marginBottom: '8px' }}>{listAdded}</p>}
                  {listIssue && <p role="alert" className="rfq-form-error">{listIssue}</p>}

                  {/* Quick-quote: single product fields */}
                  {kind === 'quick-quote' && (
                    <div style={{ marginTop: '16px' }}>
                      <input type="hidden" name="name" value={productRecap.name} readOnly />
                      <input type="hidden" name="strength" value={productRecap.strength} readOnly />
                      <input type="hidden" name="unit" value={productRecap.unit} readOnly />
                      <input type="hidden" name="quantity" value={productRecap.quantity} readOnly />
                    </div>
                  )}

                  {/* Cart mode: selected medicines list */}
                  {kind === 'cart' && snapshot.length > 0 && (
                    <>
                      <div className="rfq-selected-heading">
                        <span>Selected Medicines</span>
                        <span className="rfq-selected-count-badge">{snapshot.length}</span>
                      </div>
                      <ul className="rfq-selected-list">
                        {snapshot.map((item, index) => (
                          <SelectedItemRow
                            key={item.id}
                            item={item}
                            index={index}
                            locale={locale}
                            disabled={locked || uploadBusy || !cart.hydrated}
                            onRemove={() => removeItem(index)}
                            onQtyChange={(qty) => updateQty(index, qty)}
                            onUnitChange={(unit) => {
                              const updated = snapshot.map((it, i) => i === index ? { ...it, packagingUnit: unit } : it);
                              setSnapshot(updated);
                            }}
                          />
                        ))}
                      </ul>
                    </>
                  )}

                  {fieldError('items')}

                  {/* Expandable bottom links */}
                  <div className="rfq-expand-links">
                    <button
                      type="button"
                      className="rfq-expand-link"
                      onClick={() => setShowCustom((v) => !v)}
                      aria-expanded={showCustom}
                    >
                      <Plus size={14} aria-hidden="true" />
                      Can&apos;t find it?{' '}
                      <span style={{ textDecoration: 'underline' }}>Add custom medicine</span>
                    </button>
                    <button
                      type="button"
                      className="rfq-expand-link"
                      onClick={() => setShowNote((v) => !v)}
                      aria-expanded={showNote}
                    >
                      <Plus size={14} aria-hidden="true" />
                      Add item note (optional)
                    </button>
                  </div>

                  {/* Custom medicine expand panel */}
                  {showCustom && (
                    <div className="rfq-custom-expand" role="region" aria-label="Custom medicine details">
                      <label className="rfq-custom-full">
                        Medicine / Generic Name
                        <input
                          name="name"
                          maxLength={200}
                          value={customName}
                          autoComplete="off"
                          placeholder="e.g. Osimertinib, Lorlatinib..."
                          aria-invalid={invalid('items.0.custom_medicine_name')}
                          aria-describedby={described('items.0.custom_medicine_name')}
                          onChange={(e) => { setCustomName(e.target.value); setProductRecap((prev) => ({ ...prev, name: e.target.value })); }}
                        />
                        {fieldError('items.0.custom_medicine_name')}
                      </label>
                      <label>
                        Strength / Dose
                        <input
                          name="strength"
                          maxLength={100}
                          value={customStrength}
                          placeholder="e.g. 80mg"
                          aria-invalid={invalid('items.0.custom_strength')}
                          onChange={(e) => { setCustomStrength(e.target.value); setProductRecap((prev) => ({ ...prev, strength: e.target.value })); }}
                        />
                      </label>
                      <label>
                        Packaging Unit
                        <select
                          name="unit"
                          value={customUnit}
                          aria-invalid={invalid('items.0.packaging_unit')}
                          aria-describedby={described('items.0.packaging_unit')}
                          onChange={(e) => { setCustomUnit(e.target.value); setProductRecap((prev) => ({ ...prev, unit: e.target.value })); }}
                        >
                          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        {fieldError('items.0.packaging_unit')}
                      </label>
                      <label>
                        Quantity
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={99999}
                          step={1}
                          defaultValue={product?.quantity ?? 1}
                          aria-invalid={invalid('items.0.quantity')}
                          aria-describedby={described('items.0.quantity')}
                          onChange={(e) => setProductRecap((prev) => ({ ...prev, quantity: e.target.value }))}
                        />
                        {fieldError('items.0.quantity')}
                      </label>
                    </div>
                  )}

                  {/* Note expand panel */}
                  {showNote && (
                    <div className="rfq-note-expand" role="region" aria-label="Item note">
                      <textarea
                        name="items.0.line_notes"
                        rows={3}
                        maxLength={2000}
                        placeholder="Any special requirements, alternate brands, or packaging preferences..."
                        value={noteText}
                        aria-invalid={invalid('items.0.line_notes')}
                        onChange={(e) => setNoteText(e.target.value)}
                      />
                      {fieldError('items.0.line_notes')}
                    </div>
                  )}
                </div>

                {/* ── STEP 1: Delivery + Docs + Contact ── */}
                <div data-rfq-step="1" hidden={step !== 1} className="rfq-step-panel">
                  <div className="rfq-step2-grid">

                    {/* Left column: Delivery + Contact */}
                    <div>
                      {/* Section 1: Delivery Destination */}
                      <div className="rfq-step2-section">
                        <h3>1. Delivery Destination</h3>

                        {/* Buyer type toggle */}
                        <div className="rfq-segment-toggle" role="group" aria-label="Buyer type">
                          {BUYER_TYPES.map(({ value, label }) => (
                            <button
                              key={value}
                              type="button"
                              className={`rfq-segment-btn ${buyer === value ? 'is-active' : ''}`}
                              onClick={() => setBuyer(value)}
                              aria-pressed={buyer === value}
                              disabled={locked || uploadBusy}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <div className="rfq-field-group">
                          <label className="rfq-field-label" htmlFor="dest-country">Country</label>
                          <select
                            id="dest-country"
                            className="rfq-field-select"
                            name="destination_country"
                            value={country}
                            aria-invalid={invalid('destination_country')}
                            aria-describedby={described('destination_country')}
                            onChange={(e) => setCountry(e.target.value)}
                          >
                            <option value="">Select destination country</option>
                            {COUNTRY_OPTIONS.map(({ code, name }) => (
                              <option key={code} value={code}>{name}</option>
                            ))}
                          </select>
                          {fieldError('destination_country')}
                        </div>

                        <div className="rfq-field-group">
                          <label className="rfq-field-label" htmlFor="dest-city">City &amp; Delivery Address</label>
                          <input
                            id="dest-city"
                            className="rfq-field-input"
                            name="destination_city_port"
                            maxLength={200}
                            placeholder="Enter your full address"
                            aria-invalid={invalid('destination_city_port')}
                          />
                          {fieldError('destination_city_port')}
                        </div>
                      </div>

                      {/* Section 3: Contact Details */}
                      <div className="rfq-step2-section" style={{ marginTop: '24px' }}>
                        <h3>3. Your Contact Details</h3>
                        <fieldset disabled={locked || uploadBusy || !cart.hydrated} style={{ border: 0, margin: 0, padding: 0 }}>
                          <legend className="sr-only">{t('contactTitle')}</legend>

                          <div className="rfq-contact-grid">
                            <div className="rfq-field-group">
                              <label className="rfq-field-label" htmlFor="full_name">Full Name</label>
                              <input
                                id="full_name"
                                className="rfq-field-input"
                                name="full_name"
                                autoComplete="name"
                                maxLength={200}
                                placeholder="Full Name"
                                aria-invalid={invalid('contact.full_name')}
                                aria-describedby={described('contact.full_name')}
                                onChange={() => setEditedServerFields((prev) => ({ ...prev, 'contact.full_name': true }))}
                              />
                              {fieldError('contact.full_name')}
                            </div>

                            <div className="rfq-field-group">
                              <label className="rfq-field-label" htmlFor="email">Email Address</label>
                              <input
                                id="email"
                                className="rfq-field-input"
                                name="email"
                                type="email"
                                autoComplete="email"
                                inputMode="email"
                                maxLength={200}
                                placeholder="Email Address"
                                aria-required={emailRequired}
                                aria-invalid={invalid('contact.email')}
                                aria-describedby={described('contact.email')}
                                onChange={() => setEditedServerFields((prev) => ({ ...prev, 'contact.email': true }))}
                              />
                              {fieldError('contact.email')}
                            </div>

                            <div className="rfq-field-group">
                              <label className="rfq-field-label" htmlFor="whatsapp_number">Phone / WhatsApp</label>
                              <div className="rfq-phone-wrap">
                                <span className="rfq-phone-code" aria-label="Country calling code">
                                  {country ? getPhonePrefix(country) : '+'}
                                </span>
                                <input
                                  id="whatsapp_number"
                                  className="rfq-phone-input"
                                  name="whatsapp_number"
                                  autoComplete="tel"
                                  inputMode="tel"
                                  maxLength={50}
                                  placeholder="Phone / WhatsApp"
                                  aria-invalid={invalid('contact.whatsapp_number')}
                                  onChange={() => setEditedServerFields((prev) => ({ ...prev, 'contact.whatsapp_number': true }))}
                                />
                              </div>
                              {fieldError('contact.whatsapp_number')}
                            </div>

                            <div className="rfq-field-group">
                              <label className="rfq-field-label" htmlFor="company_name">Company / Hospital Name <span style={{ color: '#93aab8', fontWeight: 500 }}>(Optional)</span></label>
                              <input
                                id="company_name"
                                className="rfq-field-input"
                                name="company_name"
                                autoComplete="organization"
                                maxLength={200}
                                placeholder="Company / Hospital Name (Optional)"
                                aria-invalid={invalid('contact.company_name')}
                                onChange={() => setEditedServerFields((prev) => ({ ...prev, 'contact.company_name': true }))}
                              />
                            </div>
                          </div>

                          {/* Preferred language (hidden but functional) */}
                          <input type="hidden" name="preferred_locale" value={preferredLocale} readOnly />
                        </fieldset>
                      </div>
                    </div>

                    {/* Right column: Prescription + Notes + Turnstile */}
                    <div>
                      {/* Section 2: Prescription & Documents */}
                      <div className="rfq-step2-section">
                        <h3>2. Prescription &amp; Documents <span style={{ color: '#93aab8', fontWeight: 500 }}>(Optional)</span></h3>

                        {/* Drag-drop zone delegating to PrescriptionUpload */}
                        <div className="rfq-dropzone" aria-label="Prescription file upload area">
                          <div className="rfq-dropzone-icon">
                            <UploadCloud size={32} aria-hidden="true" />
                          </div>
                          <p>
                            Drop prescription, import permit, or supporting docs here (PDF, JPG, PNG)
                            or{' '}
                            <span className="rfq-dropzone-link">Browse Files</span>
                          </p>
                        </div>

                        {/* PrescriptionUpload handles actual upload logic */}
                        <div style={{ display: 'none' }}>
                          <PrescriptionUpload
                            token={token}
                            disabled={locked}
                            onConsumed={refreshChallenge}
                            onChange={setPrescriptions}
                            onBusy={(value) => { uploadBusyRef.current = value; setUploadBusy(value); }}
                          />
                        </div>
                        {fieldError('prescription_ids')}

                        <div className="rfq-field-group">
                          <label className="rfq-field-label" htmlFor="delivery_notes">
                            Delivery or special handling notes{' '}
                            <span style={{ color: '#93aab8', fontWeight: 500 }}>(Optional)</span>
                          </label>
                          <textarea
                            id="delivery_notes"
                            className="rfq-field-textarea"
                            name="items.0.line_notes"
                            rows={4}
                            maxLength={2000}
                            placeholder="Any specific timing, packaging, or special delivery requirements..."
                            aria-invalid={invalid('items.0.line_notes')}
                          />
                        </div>
                      </div>

                      {/* Turnstile / Security */}
                      <div className="rfq-challenge-section" aria-label={t('security')}>
                        <div className="rfq-security-label">
                          <ShieldCheck size={16} aria-hidden="true" />
                          {t('security')}
                        </div>
                        {siteKey
                          ? <Turnstile
                              key={challengeVersion}
                              siteKey={siteKey}
                              options={{ size: 'compact', language: locale, theme: 'light', responseField: false }}
                              onSuccess={setToken}
                              onExpire={() => setToken('')}
                              onError={() => setToken('')}
                            />
                          : <p className="rfq-form-error" role="status">{t('challengeUnavailable')}</p>
                        }
                        {!token && siteKey && <p className="small muted" style={{ marginTop: '8px' }}>{t('challengeNeeded')}</p>}
                        {fieldError('turnstile_token')}
                      </div>

                      {/* Error recovery */}
                      {state.error && (
                        <div role="alert" className="rfq-recovery-box" style={{ marginTop: '14px' }}>
                          <p style={{ margin: 0 }}>{t(recovery)}</p>
                          {requestId && <p className="small" style={{ margin: '6px 0 0' }}>{t('requestId')}: {requestId}</p>}
                          {locked && state.key && <p className="small rfq-intent" style={{ margin: '4px 0 0' }}>{t('intentId')}: {state.key}</p>}
                        </div>
                      )}
                      {locked && <p className="small muted" role="status" style={{ marginTop: '10px' }}>{t(busy ? 'submitting' : 'lockedHelp')}</p>}

                      <p className="small muted" style={{ marginTop: '14px' }}>{t('emailGuidance')}</p>
                      <details className="rfq-details">
                        <summary>{t('officialContact')}</summary>
                        <ContactChannels contact={contact} />
                      </details>
                    </div>
                  </div>
                </div>
              </div>

              {/* ══════════ RIGHT: QUOTE SUMMARY SIDEBAR ══════════ */}
              <aside className="quote-summary-column">
                <div className="quote-summary-card">
                  {/* Title + count pill */}
                  <div className="quote-summary-title-row">
                    <h3>Quote Summary</h3>
                    <span className="quote-summary-pill">
                      {totalItems} item{totalItems !== 1 ? 's' : ''} selected ({totalUnits} total unit{totalUnits !== 1 ? 's' : ''})
                    </span>
                  </div>

                  {/* Item breakdown */}
                  <div className="quote-summary-items-list">
                    {kind === 'cart' ? (
                      snapshot.length > 0
                        ? snapshot.map((item, index) => {
                            const name = item.kind === 'catalog' ? (item.names?.[locale] ?? item.name) : item.name;
                            const unit = productRecap.lineUnits[index] ?? item.packagingUnit;
                            return (
                              <div key={item.id} className="quote-summary-item-line">
                                {name} ({item.quantity} {unit})
                              </div>
                            );
                          })
                        : <p className="quote-summary-empty-hint">No medicines added yet</p>
                    ) : (
                      productRecap.name
                        ? <div className="quote-summary-item-line">{productRecap.name} ({productRecap.quantity} {productRecap.unit})</div>
                        : <p className="quote-summary-empty-hint">No medicine specified yet</p>
                    )}
                  </div>

                  {/* Trust badges */}
                  <div className="quote-trust-badges">
                    <div className="quote-trust-badge">
                      <div className="quote-trust-badge-icon"><Headphones size={18} aria-hidden="true" /></div>
                      <span>24h Team Response</span>
                    </div>
                    <div className="quote-trust-badge">
                      <div className="quote-trust-badge-icon"><Globe size={18} aria-hidden="true" /></div>
                      <span>DHL Worldwide Cold-Chain</span>
                    </div>
                    <div className="quote-trust-badge">
                      <div className="quote-trust-badge-icon"><ShieldCheck size={18} aria-hidden="true" /></div>
                      <span>100% Private Enquiry</span>
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="quote-summary-cta">
                    {step === 1 && (
                      <button
                        type="button"
                        className="rfq-back-link"
                        disabled={locked || uploadBusy || !cart.hydrated}
                        onClick={() => goToStep(0)}
                      >
                        <ArrowLeft size={15} aria-hidden="true" />
                        Back to Medicines
                      </button>
                    )}

                    {step === 0 ? (
                      <button
                        type="button"
                        className="rfq-cta-btn"
                        disabled={locked || uploadBusy || !cart.hydrated}
                        onClick={() => { if (validateStep0()) { setLocalErrors({}); setStep(1); } }}
                      >
                        Continue to Delivery
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    ) : locked && !busy ? (
                      <button
                        key="reconcile"
                        type="button"
                        className="rfq-cta-btn"
                        disabled={(state.status === 'challenge' && !token) || state.error?.code === 'INTENT_EXPIRED'}
                        onClick={async () => { if (await reconcile(state.status === 'challenge' ? token : undefined)) completed(); }}
                      >
                        {t(state.status === 'challenge' ? 'retryChallenge' : 'reconcile')}
                      </button>
                    ) : (
                      <button
                        key="submit"
                        type="submit"
                        className="rfq-cta-btn"
                        disabled={busy || uploadBusy || !token || !cart.hydrated}
                      >
                        {t(busy ? 'submitting' : 'submit')}
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </aside>

            </div>{/* end workspace */}
          </form>
        )}
      </div>
    </main>
  );
}
