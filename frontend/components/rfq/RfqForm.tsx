'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Globe,
  Headphones,
  Lock,
  Minus,
  Pill,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useRfqSubmission } from '../../hooks/useRfqSubmission';
import {
  addCartItem,
  catalogCartId,
  changeCartQuantity,
  CartError,
  type CatalogCartInput,
  type CartItem,
} from '../../lib/cart';
import { cartLine, countryCodes, rfqBusinessSchema, rfqLineSchema, type RfqKind } from '../../lib/rfq';
import type { ContactConfig } from '../../lib/public-config';
import type { HomeProduct } from '../../lib/public-catalog';
import { productCartInput } from '../../lib/product-tools';
import { useCart } from '../layout/CartProvider';
import { ContactChannels } from '../layout/ContactDialog';
import { PrescriptionUpload } from './PrescriptionUpload';
import { MedicineSearch } from './MedicineSearch';

type FieldErrors = Record<string, boolean>;
type ItemMeta = { imageUrl?: string; subtitle?: string };

function stepForField(field: string): 0 | 1 {
  if (field === 'items' || field.startsWith('items.')) return 0;
  return 1;
}

const DIAL_CODES: { code: string; dial: string; label: string }[] = [
  { code: 'BD', dial: '+880', label: 'BD +880' },
  { code: 'CN', dial: '+86', label: 'CN +86' },
  { code: 'IN', dial: '+91', label: 'IN +91' },
  { code: 'US', dial: '+1', label: 'US +1' },
  { code: 'GB', dial: '+44', label: 'GB +44' },
  { code: 'AE', dial: '+971', label: 'AE +971' },
  { code: 'SA', dial: '+966', label: 'SA +966' },
  { code: 'PK', dial: '+92', label: 'PK +92' },
  { code: 'MY', dial: '+60', label: 'MY +60' },
  { code: 'SG', dial: '+65', label: 'SG +65' },
  { code: 'TH', dial: '+66', label: 'TH +66' },
  { code: 'ID', dial: '+62', label: 'ID +62' },
  { code: 'PH', dial: '+63', label: 'PH +63' },
  { code: 'VN', dial: '+84', label: 'VN +84' },
  { code: 'DE', dial: '+49', label: 'DE +49' },
  { code: 'FR', dial: '+33', label: 'FR +33' },
  { code: 'AU', dial: '+61', label: 'AU +61' },
  { code: 'CA', dial: '+1', label: 'CA +1' },
  { code: 'JP', dial: '+81', label: 'JP +81' },
  { code: 'KR', dial: '+82', label: 'KR +82' },
  { code: 'TW', dial: '+886', label: 'TW +886' },
  { code: 'HK', dial: '+852', label: 'HK +852' },
  { code: 'NG', dial: '+234', label: 'NG +234' },
  { code: 'KE', dial: '+254', label: 'KE +254' },
  { code: 'ZA', dial: '+27', label: 'ZA +27' },
  { code: 'EG', dial: '+20', label: 'EG +20' },
  { code: 'TR', dial: '+90', label: 'TR +90' },
  { code: 'BR', dial: '+55', label: 'BR +55' },
  { code: 'RU', dial: '+7', label: 'RU +7' },
  { code: 'OTHER', dial: '+', label: 'Other +' },
];

const DIAL_BY_COUNTRY = Object.fromEntries(DIAL_CODES.map((entry) => [entry.code, entry.dial]));

const UNIT_OPTIONS = ['BOX', 'VIAL', 'BOTTLE', 'PACK', 'STRIP'];

const BUYER_TYPES = [
  { value: 'B2B_HOSPITAL', labelKey: 'buyerHospital' },
  { value: 'B2C_PATIENT', labelKey: 'buyerPatient' },
  { value: 'B2B_WHOLESALE', labelKey: 'buyerDistributor' },
] as const;
type BuyerType = (typeof BUYER_TYPES)[number]['value'];

function buildInitialItems(
  kind: RfqKind,
  cartItems: readonly CartItem[],
  product?: CatalogCartInput,
  initialName?: string,
): CartItem[] {
  if (kind === 'cart') return cartItems.map((item) => ({ ...item }));
  if (product) return [{ ...product, strength: product.strength ?? '', kind: 'catalog', id: catalogCartId(product) }];
  if (initialName?.trim()) {
    return [
      {
        kind: 'custom',
        id: crypto.randomUUID(),
        name: initialName.trim(),
        strength: '',
        packagingUnit: 'BOX',
        quantity: 1,
      },
    ];
  }
  return [];
}

function formatUnitWord(unit: string): string {
  const lower = unit.trim().toLowerCase();
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : '';
}

function formatPackLabel(packSize?: string, packagingUnit?: string): string {
  const pack = packSize?.trim() ?? '';
  const unit = packagingUnit?.trim() ?? '';
  if (!pack) return unit ? formatUnitWord(unit) : '';
  if (!unit) return pack;
  if (pack.toLowerCase().includes(unit.toLowerCase())) return pack;
  return `${pack} ${formatUnitWord(unit)}`;
}

function SelectedItemRow({
  item,
  meta,
  locale,
  disabled,
  onRemove,
  onQtyChange,
  onUnitChange,
}: {
  item: CartItem;
  meta?: ItemMeta;
  locale: 'en' | 'zh-CN';
  disabled: boolean;
  onRemove(): void;
  onQtyChange(qty: number): void;
  onUnitChange(unit: string): void;
}) {
  const name = item.kind === 'catalog' ? (item.names?.[locale] ?? item.name) : item.name;
  const sub = meta?.subtitle || [item.strength, formatUnitWord(item.packagingUnit)].filter(Boolean).join(' · ');
  const unitChoices = UNIT_OPTIONS.includes(item.packagingUnit)
    ? UNIT_OPTIONS
    : [item.packagingUnit, ...UNIT_OPTIONS];

  return (
    <li className="rfq-selected-item flex flex-wrap sm:flex-nowrap items-center gap-3 px-2.5 py-2 w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <div className="rfq-selected-item-thumb w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-slate-50 border border-slate-200 flex items-center justify-center">
        {meta?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.imageUrl}
            alt={name}
            width={44}
            height={44}
            loading="lazy"
            className="w-11 h-11 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <Pill size={18} className="rfq-search-thumb-icon" aria-hidden="true" />
        )}
      </div>

      <div className="rfq-selected-info flex-1 min-w-0">
        <p className="rfq-selected-line m-0 truncate text-[15px] leading-snug text-slate-900">
          <strong className="font-bold text-slate-900">{name}</strong>
          {sub && <span className="font-normal text-slate-500">{` · ${sub}`}</span>}
        </p>
      </div>

      <div className="rfq-selected-controls flex items-center gap-2 shrink-0 ml-auto">
        <div className="rfq-qty-stepper shrink-0" aria-label={`Quantity for ${name}`}>
          <button
            type="button"
            className="rfq-qty-btn"
            aria-label={`Decrease quantity for ${name}`}
            disabled={disabled || item.quantity <= 1}
            onClick={() => onQtyChange(Math.max(1, item.quantity - 1))}
          >
            <Minus size={12} aria-hidden="true" />
          </button>
          <input
            type="number"
            className="rfq-qty-value"
            min={1}
            max={99999}
            step={1}
            value={item.quantity}
            disabled={disabled}
            aria-label={`Quantity for ${name}`}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v >= 1) onQtyChange(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
          <button
            type="button"
            className="rfq-qty-btn"
            aria-label={`Increase quantity for ${name}`}
            disabled={disabled}
            onClick={() => onQtyChange(item.quantity + 1)}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
        </div>

        <select
          className="rfq-unit-select w-24 sm:w-28 shrink-0"
          value={item.packagingUnit}
          disabled={disabled}
          aria-label={`Packaging unit for ${name}`}
          onChange={(e) => onUnitChange(e.target.value)}
        >
          {unitChoices.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="rfq-remove-btn shrink-0"
          aria-label={`Remove ${name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function RfqForm({
  kind,
  product,
  initialName,
  contact,
  onClose,
  active,
  onLockChange,
}: {
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
  const locale = useLocale() === 'zh-CN' ? ('zh-CN' as const) : ('en' as const);

  const cart = useCart();
  const [items, setItems] = useState<readonly CartItem[]>(() =>
    buildInitialItems(kind, cart.items, product, initialName),
  );
  const [itemMeta, setItemMeta] = useState<Record<string, ItemMeta>>({});

  const { state, locked, isLocked, submit, reconcile } = useRfqSubmission();
  const lastHandledState = useRef(state);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const uploadBusyRef = useRef(false);
  const wasActive = useRef(false);
  const previousStep = useRef(0);

  const [step, setStep] = useState<0 | 1>(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [buyer, setBuyer] = useState<BuyerType>('B2B_HOSPITAL');
  const [country, setCountry] = useState('');
  const [dialCode, setDialCode] = useState('+880');
  const [dialTouched, setDialTouched] = useState(false);
  const [token, setToken] = useState('');
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [prescriptions, setPrescriptions] = useState<string[]>([]);

  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [editedServerFields, setEditedServerFields] = useState<FieldErrors>({});
  const [listIssue, setListIssue] = useState<string>();
  const [dirty, setDirty] = useState(false);

  /* Expandable bottom panels on Step 1 */
  const [showCustom, setShowCustom] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customStrength, setCustomStrength] = useState('');
  const [customUnit, setCustomUnit] = useState('BOX');
  const [customQty, setCustomQty] = useState(1);
  const [itemNote, setItemNote] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');

  const countryOptions = useMemo(() => {
    let display: Intl.DisplayNames | undefined;
    try {
      display = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      display = undefined;
    }
    return [...countryCodes]
      .map((code) => ({ code, name: display?.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locale]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const busy = state.status === 'submitting';
  const succeeded = state.status === 'success' && Boolean(state.receipt);
  const emailRequired = locale === 'zh-CN' || country.trim().toUpperCase() === 'CN';

  const errors: FieldErrors = { ...localErrors };
  if (state.status === 'invalid') {
    for (const detail of state.error?.details ?? []) {
      if (!editedServerFields[detail.field]) errors[detail.field] = true;
    }
  }

  function invalid(field: string) {
    return errors[field] || undefined;
  }
  function fieldError(field: string) {
    return invalid(field) ? (
      <span className="rfq-field-error" id={`rfq-${field}`} role="alert">
        {t(field.endsWith('packaging_unit') ? 'unitInvalid' : 'fieldInvalid')}
      </span>
    ) : null;
  }
  function described(field: string) {
    return invalid(field) ? `rfq-${field}` : undefined;
  }
  const refreshChallenge = () => {
    setToken('');
    setChallengeVersion((v) => v + 1);
  };

  useEffect(() => {
    onLockChange(locked || uploadBusy);
  }, [locked, uploadBusy, onLockChange]);

  useEffect(() => {
    if (!dirty || succeeded || locked) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
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
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, step, localErrors, state.status]);

  useEffect(() => {
    if (state.status === 'challenge' || state.status === 'invalid') {
      setToken('');
      setChallengeVersion((v) => v + 1);
    }
    if (state.status === 'invalid') setEditedServerFields({});
  }, [state]);

  useEffect(() => {
    const newServerError = state !== lastHandledState.current && state.status === 'invalid';
    lastHandledState.current = state;
    const activeErrors = Object.entries({
      ...localErrors,
      ...(newServerError ? Object.fromEntries((state.error?.details ?? []).map((d) => [d.field, true])) : {}),
    })
      .filter(([, hasErr]) => hasErr)
      .map(([field]) => field);
    if (!activeErrors.length) return;
    const targetStep = Math.min(...activeErrors.map(stepForField)) as 0 | 1;
    setStep((current) => (current === targetStep ? current : targetStep));
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }, [localErrors, state]);

  function read(form: FormData, name: string) {
    return String(form.get(name) ?? '').trim();
  }
  function optional(form: FormData, name: string) {
    const v = read(form, name);
    return v ? { [name]: v } : {};
  }

  function combinedLineNotes(): string | undefined {
    const parts = [itemNote.trim(), deliveryNotes.trim()].filter(Boolean);
    if (!parts.length) return undefined;
    return parts.join(' | ').slice(0, 2000);
  }

  function buildLines(sourceItems: readonly CartItem[]) {
    const sharedNotes = combinedLineNotes();
    return sourceItems.map((item, index) =>
      cartLine(item, index === 0 ? sharedNotes : undefined),
    );
  }

  function commitPendingCustom(): readonly CartItem[] | null {
    if (!showCustom || !customName.trim()) return items;
    const normalizedName = customName.trim().normalize('NFC').toLowerCase();
    const normalizedStrength = customStrength.trim();
    if (
      items.some(
        (it) =>
          it.kind === 'custom' &&
          it.name.normalize('NFC').toLowerCase() === normalizedName &&
          it.strength === normalizedStrength,
      )
    ) {
      setCustomName('');
      setCustomStrength('');
      setCustomQty(1);
      setShowCustom(false);
      return items;
    }
    const newItem: CartItem = {
      kind: 'custom',
      id: crypto.randomUUID(),
      name: customName.trim(),
      strength: normalizedStrength,
      packagingUnit: customUnit.trim() || 'BOX',
      quantity: Math.max(1, customQty),
    };
    try {
      const next = addCartItem(items, newItem);
      if (kind === 'cart') {
        cart.addCustomItem({
          name: newItem.name,
          strength: newItem.strength,
          packagingUnit: newItem.packagingUnit,
          quantity: newItem.quantity,
        });
      }
      setItems(next);
      setCustomName('');
      setCustomStrength('');
      setCustomQty(1);
      setShowCustom(false);
      return next;
    } catch (error: unknown) {
      setListIssue(cartText(error instanceof CartError ? error.issue : 'invalidItem'));
      return null;
    }
  }

  function handleAddCustomItem() {
    if (isLocked() || uploadBusyRef.current) return;
    if (!customName.trim()) {
      setLocalErrors({ 'items.0.custom_medicine_name': true });
      return;
    }
    const next = commitPendingCustom();
    if (next) {
      setLocalErrors({});
      setListIssue(undefined);
      setDirty(true);
    }
  }

  function validateStep0(): boolean {
    const working = commitPendingCustom();
    if (!working) return false;
    if (working.length === 0) {
      setLocalErrors({ items: true });
      return false;
    }
    let lines: unknown;
    try {
      lines = buildLines(working);
    } catch {
      setLocalErrors({ items: true });
      return false;
    }
    const parsed = z.array(rfqLineSchema).min(1).max(100).safeParse(lines);
    if (!parsed.success) {
      setLocalErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.length ? `items.${issue.path.join('.')}` : 'items',
            true,
          ]),
        ),
      );
      return false;
    }
    return true;
  }

  function goToStep(target: 0 | 1) {
    if (locked || uploadBusy || target === step) return;
    if (target < step) {
      setLocalErrors({});
      setStep(target);
      return;
    }
    if (step === 0 && !validateStep0()) return;
    setLocalErrors({});
    setStep(target);
  }

  function completed() {
    if (kind === 'cart') cart.clearSubmittedItems(items);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 1) {
      goToStep(1);
      return;
    }
    if (isLocked() || uploadBusyRef.current) return;

    const working = commitPendingCustom();
    if (!working || working.length === 0) {
      setLocalErrors({ items: true });
      return;
    }

    const form = new FormData(event.currentTarget);
    let lines: unknown;
    try {
      lines = buildLines(working);
    } catch {
      setLocalErrors({ items: true });
      return;
    }

    const companyName = read(form, 'company_name');
    const rawPhone = read(form, 'whatsapp_number');
    const formattedPhone = rawPhone
      ? rawPhone.startsWith('+')
        ? rawPhone
        : `${dialCode}${rawPhone}`.trim()
      : '';

    // Hospital / Clinic treats Company / Hospital Name as optional when empty (Patient-side or hospital delivery address),
    // while Distributor requires Business / Wholesale company attribution.
    const customerType =
      buyer === 'B2B_WHOLESALE' || (buyer === 'B2B_HOSPITAL' && Boolean(companyName))
        ? 'B2B_WHOLESALE'
        : 'B2C_PATIENT';

    const parsed = rfqBusinessSchema.safeParse({
      contact: {
        full_name: read(form, 'full_name'),
        customer_type: customerType,
        preferred_locale: locale,
        ...(companyName ? { company_name: companyName } : {}),
        ...optional(form, 'email'),
        ...(formattedPhone ? { whatsapp_number: formattedPhone } : {}),
      },
      destination_country: country,
      ...optional(form, 'destination_city_port'),
      locale,
      items: lines,
      prescription_ids: prescriptions,
    });

    if (!parsed.success) {
      setLocalErrors(
        Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), true])),
      );
      return;
    }
    if (!token) {
      setLocalErrors({ turnstile_token: true });
      return;
    }
    setLocalErrors({});
    const submitKind: RfqKind = kind === 'cart' || working.length > 1 ? 'cart' : 'quick-quote';
    if (await submit(parsed.data, token, submitKind)) completed();
  }

  function selectMedicine(medicine: HomeProduct) {
    if (isLocked() || uploadBusyRef.current || !cart.hydrated) return;
    if (items.some((it) => it.kind === 'catalog' && it.productId === medicine.id)) return;
    const selected = productCartInput(medicine);
    const id = catalogCartId(selected);
    const packLabel = formatPackLabel(medicine.pack_size, medicine.packaging_unit);
    const subtitle = [medicine.generic.name || medicine.manufacturer.name, packLabel]
      .filter(Boolean)
      .join(' · ');

    setListIssue(undefined);
    try {
      const next = addCartItem(items, { ...selected, id, kind: 'catalog' });
      if (kind === 'cart') cart.addItem(selected);
      setItems(next);
      setItemMeta((prev) => ({
        ...prev,
        [id]: { imageUrl: medicine.primary_image_url ?? undefined, subtitle },
      }));
    } catch (error: unknown) {
      setListIssue(cartText(error instanceof CartError ? error.issue : 'invalidItem'));
      return;
    }
    setDirty(true);
    setLocalErrors({});
    setEditedServerFields((prev) => ({ ...prev, items: true }));
  }

  function updateQty(index: number, qty: number) {
    const item = items[index];
    if (!item) return;
    try {
      const updated = changeCartQuantity(items, item.id, qty);
      setItems(updated);
      if (kind === 'cart') cart.updateQuantity(item.id, qty);
      setDirty(true);
    } catch {
      setListIssue(cartText('quantityInvalid'));
    }
  }

  function updateUnit(index: number, unit: string) {
    const item = items[index];
    if (!item) return;
    const updated = items.map((it, i) => (i === index ? { ...it, packagingUnit: unit } : it));
    setItems(updated);
    setDirty(true);
  }

  function removeItem(index: number) {
    const item = items[index];
    if (!item) return;
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    if (kind === 'cart') cart.removeItem(item.id);
    setDirty(true);
  }

  const totalItems = items.length + (showCustom && customName.trim() ? 1 : 0);
  const totalUnits =
    items.reduce((sum, item) => sum + item.quantity, 0) +
    (showCustom && customName.trim() ? Math.max(1, customQty) : 0);

  const close = () => {
    if (!isLocked() && !uploadBusyRef.current) onClose();
  };

  const recovery =
    state.status === 'challenge'
      ? 'challengeRecovery'
      : state.status === 'conflict'
        ? 'conflictRecovery'
        : state.status === 'uncertain'
          ? state.error?.status === 429
            ? 'rateLimited'
            : state.error?.status === 503
              ? 'unavailable'
              : 'uncertain'
          : 'validationHelp';
  const requestId =
    state.error?.requestId && /^[\w-]{1,100}$/.test(state.error.requestId)
      ? state.error.requestId
      : undefined;

  const title = shell('quickQuote');

  return (
    <main id={active ? 'main-content' : undefined} className="quote-request-page" aria-label={title}>
      <div className="quote-request-shell max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* ── TOP HEADER ── */}
        <header className="quote-request-heading">
          <div className="quote-heading-left">
            <h1 ref={headingRef} tabIndex={-1}>
              {title}
            </h1>
            <span className="quote-confidential-badge">
              <Lock size={11} aria-hidden="true" />
              {t('confidentialBadge')}
            </span>
          </div>
          <button
            type="button"
            className="quote-return"
            onClick={close}
            disabled={locked || uploadBusy || !cart.hydrated}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t('backToWebsite')}
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
            <button className="rfq-cta-btn" style={{ maxWidth: '240px', margin: '0 auto' }} onClick={close}>
              {t('done')}
            </button>
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
                  {step > 0 ? <Check size={14} strokeWidth={3} /> : '1.'}
                </span>
                {t('stepSelectMedicines')}
              </button>

              <div className={`rfq-progress-line ${step > 0 ? 'is-full' : 'is-half'}`} aria-hidden="true" />

              <button
                type="button"
                className={`rfq-progress-step ${step === 1 ? 'is-active' : ''}`}
                disabled={locked || uploadBusy || !cart.hydrated}
                aria-current={step === 1 ? 'step' : undefined}
                onClick={() => goToStep(1)}
              >
                <span className="rfq-step-circle" aria-hidden="true">
                  2.
                </span>
                {t('stepDeliveryDocs')}
              </button>
            </nav>

            {/* ── TWO-COLUMN WORKSPACE (12-col grid) ── */}
            <div className="quote-request-workspace grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* ══════════ LEFT: FORM CARD (8 cols) ══════════ */}
              <div className="quote-form-card lg:col-span-8">
                {/* ── STEP 0: Select Medicines ── */}
                <div data-rfq-step="0" hidden={step !== 0} className="rfq-step-panel">
                  <h2>{t('step1Heading')}</h2>

                  <MedicineSearch
                    enabled={active && step === 0 && !locked && !uploadBusy && cart.hydrated}
                    selectedIds={items.flatMap((it) => (it.kind === 'catalog' ? [it.productId] : []))}
                    onSelect={selectMedicine}
                  />

                  {listIssue && (
                    <p role="alert" className="rfq-form-error">
                      {listIssue}
                    </p>
                  )}

                  {items.length > 0 ? (
                    <>
                      <div className="rfq-selected-heading">
                        <span>
                          {t('selectedMedicinesHeading')} ({items.length})
                        </span>
                      </div>
                      <ul className="rfq-selected-list">
                        {items.map((item, index) => (
                          <SelectedItemRow
                            key={item.id}
                            item={item}
                            meta={itemMeta[item.id]}
                            locale={locale}
                            disabled={locked || uploadBusy || !cart.hydrated}
                            onRemove={() => removeItem(index)}
                            onQtyChange={(qty) => updateQty(index, qty)}
                            onUnitChange={(unit) => updateUnit(index, unit)}
                          />
                        ))}
                      </ul>
                    </>
                  ) : (
                    !showCustom && <p className="rfq-empty-prompt">{t('selectedEmptyPrompt')}</p>
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
                      <span>{t('cantFindIt')}</span>
                      <span className="rfq-expand-accent">{t('addCustomMedicine')}</span>
                    </button>

                    <button
                      type="button"
                      className="rfq-expand-link"
                      onClick={() => setShowNote((v) => !v)}
                      aria-expanded={showNote}
                    >
                      <Plus size={14} aria-hidden="true" />
                      <span>{t('addItemNoteOptional')}</span>
                    </button>
                  </div>

                  {/* Custom medicine expandable panel */}
                  {showCustom && (
                    <div className="rfq-custom-expand" role="region" aria-label={t('addCustomMedicine')}>
                      <label className="rfq-custom-full">
                        {t('customMedicineName')}
                        <input
                          value={customName}
                          maxLength={200}
                          autoComplete="off"
                          placeholder="e.g. Osimertinib, Lorlatinib..."
                          aria-invalid={invalid('items.0.custom_medicine_name')}
                          onChange={(e) => {
                            setCustomName(e.target.value);
                            setLocalErrors((prev) => ({ ...prev, 'items.0.custom_medicine_name': false }));
                          }}
                        />
                        {fieldError('items.0.custom_medicine_name')}
                      </label>
                      <label>
                        {t('customStrengthLabel')}
                        <input
                          value={customStrength}
                          maxLength={100}
                          placeholder="e.g. 80mg"
                          onChange={(e) => setCustomStrength(e.target.value)}
                        />
                      </label>
                      <label>
                        {t('customUnitLabel')}
                        <select value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
                          {UNIT_OPTIONS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('customQtyLabel')}
                        <input
                          type="number"
                          min={1}
                          max={99999}
                          step={1}
                          value={customQty}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            setCustomQty(Number.isFinite(v) && v >= 1 ? v : 1);
                          }}
                        />
                      </label>
                      <div className="rfq-custom-actions">
                        <button type="button" className="rfq-custom-add-btn" onClick={handleAddCustomItem}>
                          <Plus size={14} aria-hidden="true" />
                          {t('addCustomItemBtn')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Note expandable panel */}
                  {showNote && (
                    <div className="rfq-note-expand" role="region" aria-label={t('addItemNoteOptional')}>
                      <textarea
                        rows={3}
                        maxLength={2000}
                        placeholder={t('itemNotePlaceholder')}
                        value={itemNote}
                        onChange={(e) => setItemNote(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* ── STEP 1: Delivery, Documentation & Contact ── */}
                <div data-rfq-step="1" hidden={step !== 1} className="rfq-step-panel">
                  <div className="rfq-step2-grid">
                    {/* Section 1: Delivery Destination */}
                    <div className="rfq-step2-section">
                      <h3>{t('sectionDeliveryHeading')}</h3>

                      <div className="rfq-segment-toggle" role="group" aria-label={t('buyerType')}>
                        {BUYER_TYPES.map(({ value, labelKey }) => (
                          <button
                            key={value}
                            type="button"
                            className={`rfq-segment-btn ${buyer === value ? 'is-active' : ''}`}
                            onClick={() => setBuyer(value)}
                            aria-pressed={buyer === value}
                            disabled={locked || uploadBusy}
                          >
                            {t(labelKey)}
                          </button>
                        ))}
                      </div>

                      <div className="rfq-field-group">
                        <label className="rfq-field-label" htmlFor="dest-country">
                          {t('countryLabel')}
                        </label>
                        <select
                          id="dest-country"
                          className="rfq-field-select"
                          name="destination_country"
                          value={country}
                          aria-invalid={invalid('destination_country')}
                          aria-describedby={described('destination_country')}
                          onChange={(e) => {
                            const nextCountry = e.target.value;
                            setCountry(nextCountry);
                            setLocalErrors((prev) => ({ ...prev, destination_country: false }));
                            if (!dialTouched && DIAL_BY_COUNTRY[nextCountry]) {
                              setDialCode(DIAL_BY_COUNTRY[nextCountry]);
                            }
                          }}
                        >
                          <option value="">{t('selectCountryPlaceholder')}</option>
                          {countryOptions.map(({ code, name }) => (
                            <option key={code} value={code}>
                              {name}
                            </option>
                          ))}
                        </select>
                        {fieldError('destination_country')}
                      </div>

                      <div className="rfq-field-group">
                        <label className="rfq-field-label" htmlFor="dest-city">
                          {t('cityAddressLabel')}
                        </label>
                        <input
                          id="dest-city"
                          className="rfq-field-input"
                          name="destination_city_port"
                          maxLength={200}
                          placeholder={t('cityAddressPlaceholder')}
                          aria-invalid={invalid('destination_city_port')}
                        />
                        {fieldError('destination_city_port')}
                      </div>
                    </div>

                    {/* Section 2: Prescription & Documents */}
                    <div className="rfq-step2-section">
                      <h3>
                        {t('sectionDocsHeading')}{' '}
                        <span className="rfq-optional-label">{t('optionalTag')}</span>
                      </h3>

                      <PrescriptionUpload
                        token={token}
                        disabled={locked}
                        onConsumed={refreshChallenge}
                        onChange={setPrescriptions}
                        onBusy={(value) => {
                          uploadBusyRef.current = value;
                          setUploadBusy(value);
                        }}
                      />
                      {fieldError('prescription_ids')}

                      <div className="rfq-field-group" style={{ marginTop: '14px' }}>
                        <label className="rfq-field-label" htmlFor="delivery_notes">
                          {t('deliveryNotesLabel')}{' '}
                          <span className="rfq-optional-label">{t('optionalTag')}</span>
                        </label>
                        <textarea
                          id="delivery_notes"
                          className="rfq-field-textarea"
                          rows={3}
                          maxLength={2000}
                          placeholder={t('deliveryNotesPlaceholder')}
                          value={deliveryNotes}
                          onChange={(e) => setDeliveryNotes(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Your Contact Details (Full Width 2-Col Grid) */}
                  <div className="rfq-step2-section" style={{ marginTop: '24px' }}>
                    <h3>{t('sectionContactHeading')}</h3>
                    <fieldset
                      disabled={locked || uploadBusy || !cart.hydrated}
                      style={{ border: 0, margin: 0, padding: 0 }}
                    >
                      <legend className="sr-only">{t('contactTitle')}</legend>

                      <div className="rfq-contact-grid">
                        <div className="rfq-field-group">
                          <label className="sr-only" htmlFor="full_name">
                            {t('fullName')}
                          </label>
                          <input
                            id="full_name"
                            className="rfq-field-input"
                            name="full_name"
                            autoComplete="name"
                            maxLength={200}
                            placeholder={t('fullNamePlaceholder')}
                            aria-invalid={invalid('contact.full_name')}
                            aria-describedby={described('contact.full_name')}
                            onChange={() => {
                              setEditedServerFields((prev) => ({ ...prev, 'contact.full_name': true }));
                              setLocalErrors((prev) => ({ ...prev, 'contact.full_name': false }));
                            }}
                          />
                          {fieldError('contact.full_name')}
                        </div>

                        <div className="rfq-field-group">
                          <label className="sr-only" htmlFor="email">
                            {t('email')}
                          </label>
                          <input
                            id="email"
                            className="rfq-field-input"
                            name="email"
                            type="email"
                            autoComplete="email"
                            inputMode="email"
                            maxLength={200}
                            placeholder={emailRequired ? `${t('emailPlaceholder')} *` : t('emailPlaceholder')}
                            aria-required={emailRequired}
                            aria-invalid={invalid('contact.email')}
                            aria-describedby={described('contact.email')}
                            onChange={() => {
                              setEditedServerFields((prev) => ({ ...prev, 'contact.email': true }));
                              setLocalErrors((prev) => ({ ...prev, 'contact.email': false }));
                            }}
                          />
                          {fieldError('contact.email')}
                        </div>

                        <div className="rfq-field-group">
                          <label className="sr-only" htmlFor="whatsapp_number">
                            {t('phoneWhatsappLabel')}
                          </label>
                          <div className="rfq-phone-wrap">
                            <select
                              className="rfq-phone-select"
                              aria-label="Country calling code"
                              value={dialCode}
                              onChange={(e) => {
                                setDialCode(e.target.value);
                                setDialTouched(true);
                              }}
                            >
                              {DIAL_CODES.map((entry) => (
                                <option key={entry.code} value={entry.dial}>
                                  {entry.label}
                                </option>
                              ))}
                            </select>
                            <input
                              id="whatsapp_number"
                              className="rfq-phone-input"
                              name="whatsapp_number"
                              autoComplete="tel"
                              inputMode="tel"
                              maxLength={50}
                              placeholder={`${t('phoneWhatsappLabel')} (${dialCode})`}
                              aria-invalid={invalid('contact.whatsapp_number')}
                              onChange={() =>
                                setEditedServerFields((prev) => ({ ...prev, 'contact.whatsapp_number': true }))
                              }
                            />
                          </div>
                          {fieldError('contact.whatsapp_number')}
                        </div>

                        <div className="rfq-field-group">
                          <label className="sr-only" htmlFor="company_name">
                            {t('companyHospitalLabel')}
                          </label>
                          <input
                            id="company_name"
                            className="rfq-field-input"
                            name="company_name"
                            autoComplete="organization"
                            maxLength={200}
                            placeholder={
                              buyer === 'B2B_WHOLESALE'
                                ? `${t('companyHospitalLabel')} *`
                                : t('companyHospitalPlaceholder')
                            }
                            aria-invalid={invalid('contact.company_name')}
                            aria-describedby={described('contact.company_name')}
                            onChange={() => {
                              setEditedServerFields((prev) => ({ ...prev, 'contact.company_name': true }));
                              setLocalErrors((prev) => ({ ...prev, 'contact.company_name': false }));
                            }}
                          />
                          {fieldError('contact.company_name')}
                        </div>
                      </div>
                    </fieldset>
                  </div>

                  {/* Verification & Error Recovery */}
                  <div className="rfq-challenge-section" aria-label={t('security')}>
                    <div className="rfq-security-label">
                      <ShieldCheck size={16} aria-hidden="true" />
                      {t('security')}
                    </div>
                    {siteKey ? (
                      <Turnstile
                        key={challengeVersion}
                        siteKey={siteKey}
                        options={{ size: 'compact', language: locale, theme: 'light', responseField: false }}
                        onSuccess={setToken}
                        onExpire={() => setToken('')}
                        onError={() => setToken('')}
                      />
                    ) : (
                      <p className="rfq-form-error" role="status">
                        {t('challengeUnavailable')}
                      </p>
                    )}
                    {!token && siteKey && (
                      <p className="small muted" style={{ marginTop: '8px' }}>
                        {t('challengeNeeded')}
                      </p>
                    )}
                    {fieldError('turnstile_token')}
                  </div>

                  {state.error && (
                    <div role="alert" className="rfq-recovery-box" style={{ marginTop: '14px' }}>
                      <p style={{ margin: 0 }}>{t(recovery)}</p>
                      {requestId && (
                        <p className="small" style={{ margin: '6px 0 0' }}>
                          {t('requestId')}: {requestId}
                        </p>
                      )}
                      {locked && state.key && (
                        <p className="small rfq-intent" style={{ margin: '4px 0 0' }}>
                          {t('intentId')}: {state.key}
                        </p>
                      )}
                    </div>
                  )}
                  {locked && (
                    <p className="small muted" role="status" style={{ marginTop: '10px' }}>
                      {t(busy ? 'submitting' : 'lockedHelp')}
                    </p>
                  )}

                  <p className="small muted" style={{ marginTop: '14px' }}>
                    {t('emailGuidance')}
                  </p>
                  <details className="rfq-details">
                    <summary>{t('officialContact')}</summary>
                    <ContactChannels contact={contact} />
                  </details>
                </div>
              </div>

              {/* ══════════ RIGHT: QUOTE SUMMARY SIDEBAR (4 cols) ══════════ */}
              <aside className="quote-summary-column lg:col-span-4">
                <div className="quote-summary-card">
                  <div className="quote-summary-title-row">
                    <h3>{t('summarySidebarTitle')}</h3>
                    <span className="quote-summary-pill">
                      {t('summaryPillCount', { items: totalItems, units: totalUnits })}
                    </span>
                  </div>

                  <div className="quote-summary-items-list">
                    {items.length > 0 || (showCustom && customName.trim()) ? (
                      <>
                        {items.map((item) => {
                          const name = item.kind === 'catalog' ? (item.names?.[locale] ?? item.name) : item.name;
                          return (
                            <div key={item.id} className="quote-summary-item-line">
                              {name} ({item.quantity} {item.packagingUnit})
                            </div>
                          );
                        })}
                        {showCustom && customName.trim() && (
                          <div className="quote-summary-item-line">
                            {customName.trim()} ({Math.max(1, customQty)} {customUnit})
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="quote-summary-empty-hint">{t('summaryNoItems')}</p>
                    )}
                  </div>

                  <div className="quote-trust-badges">
                    <div className="quote-trust-badge">
                      <div className="quote-trust-badge-icon">
                        <Headphones size={17} aria-hidden="true" />
                      </div>
                      <span>{t('trustResponse')}</span>
                    </div>
                    <div className="quote-trust-badge">
                      <div className="quote-trust-badge-icon">
                        <Globe size={17} aria-hidden="true" />
                      </div>
                      <span>{t('trustColdChain')}</span>
                    </div>
                    <div className="quote-trust-badge">
                      <div className="quote-trust-badge-icon">
                        <ShieldCheck size={17} aria-hidden="true" />
                      </div>
                      <span>{t('trustPrivacy')}</span>
                    </div>
                  </div>

                  <div className="quote-summary-cta">
                    {step === 1 && (
                      <button
                        type="button"
                        className="rfq-back-link"
                        disabled={locked || uploadBusy || !cart.hydrated}
                        onClick={() => goToStep(0)}
                      >
                        <ArrowLeft size={15} aria-hidden="true" />
                        {t('backToMedicinesLink')}
                      </button>
                    )}

                    {step === 0 ? (
                      <button
                        type="button"
                        className="rfq-cta-btn"
                        disabled={locked || uploadBusy || !cart.hydrated}
                        onClick={() => goToStep(1)}
                      >
                        {t('continueToDeliveryCta')}
                        <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    ) : locked && !busy ? (
                      <button
                        key="reconcile"
                        type="button"
                        className="rfq-cta-btn"
                        disabled={(state.status === 'challenge' && !token) || state.error?.code === 'INTENT_EXPIRED'}
                        onClick={async () => {
                          if (await reconcile(state.status === 'challenge' ? token : undefined)) completed();
                        }}
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
                        {busy ? t('submitting') : t('submitQuoteCta')}
                        <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
