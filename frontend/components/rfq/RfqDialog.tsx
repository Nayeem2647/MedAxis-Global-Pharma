'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useRfqSubmission } from '../../hooks/useRfqSubmission';
import { CartError, type CatalogCartInput, type CartItem } from '../../lib/cart';
import { cartLine, rfqBusinessSchema, type RfqKind } from '../../lib/rfq';
import type { ContactConfig } from '../../lib/public-config';
import { useCart } from '../layout/CartProvider';
import { ContactChannels } from '../layout/ContactDialog';
import { Modal } from '../layout/Modal';
import { PrescriptionUpload } from './PrescriptionUpload';

type FieldErrors = Record<string, boolean>;
export function RfqDialog({ kind, product, initialName, contact, onClose }: {
  kind: RfqKind; product?: CatalogCartInput; initialName?: string; contact: ContactConfig; onClose(): void;
}) {
  const t = useTranslations('Rfq');
  const cartText = useTranslations('Cart');
  const shell = useTranslations('Shell');
  const locale = useLocale() === 'zh-CN' ? 'zh-CN' : 'en';
  const cart = useCart();
  const [snapshot] = useState<readonly CartItem[]>(() => cart.items.map((item) => ({ ...item })));
  const { state, locked, isLocked, submit, reconcile } = useRfqSubmission();
  const formRef = useRef<HTMLFormElement>(null);
  const uploadBusyRef = useRef(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [buyer, setBuyer] = useState('B2C_PATIENT');
  const [country, setCountry] = useState('');
  const [preferredLocale, setPreferredLocale] = useState<string>(locale);
  const [token, setToken] = useState('');
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [prescriptions, setPrescriptions] = useState<string[]>([]);
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [listIssue, setListIssue] = useState<string>();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const busy = state.status === 'submitting';
  const emailRequired = locale === 'zh-CN' || preferredLocale === 'zh-CN' || country.trim().toUpperCase() === 'CN';
  const errors: FieldErrors = { ...localErrors };
  if (state.status === 'invalid') for (const detail of state.error?.details ?? []) errors[detail.field] = true;
  function invalid(field: string) { return errors[field] || undefined; }
  function fieldError(field: string) {
    return invalid(field) ? <span className="field-error" id={`rfq-${field}`} role="alert">{t(field.endsWith('packaging_unit') ? 'unitInvalid' : 'fieldInvalid')}</span> : null;
  }
  function described(field: string) { return invalid(field) ? `rfq-${field}` : undefined; }
  const refreshChallenge = () => { setToken(''); setChallengeVersion((value) => value + 1); };
  useEffect(() => { if (state.status === 'challenge' || state.status === 'invalid') { setToken(''); setChallengeVersion((value) => value + 1); } }, [state]);
  useEffect(() => { if (Object.keys(localErrors).length || state.status === 'invalid') formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [localErrors, state]);
  function read(form: FormData, name: string) { return String(form.get(name) ?? '').trim(); }
  function optional(form: FormData, name: string) { const value = read(form, name); return value ? { [name]: value } : {}; }
  function quickLine(form: FormData) {
    return { quantity: Number(form.get('quantity')), packaging_unit: read(form, 'unit'),
      ...(read(form, 'items.0.line_notes') ? { line_notes: read(form, 'items.0.line_notes') } : {}),
      ...(product ? { is_uncatalogued: false, product_id: product.productId } : { is_uncatalogued: true, custom_medicine_name: read(form, 'name'), ...(read(form, 'strength') ? { custom_strength: read(form, 'strength') } : {}) }),
    };
  }
  function completed() { if (kind === 'cart') cart.clearSubmittedItems(snapshot); }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocked() || uploadBusyRef.current) return;
    const form = new FormData(event.currentTarget);
    let lines: unknown;
    try { lines = kind === 'quick-quote' ? [quickLine(form)] : snapshot.map((item, index) => ({ ...cartLine(item),
      packaging_unit: read(form, `items.${index}.packaging_unit`),
      ...(read(form, `items.${index}.line_notes`) ? { line_notes: read(form, `items.${index}.line_notes`) } : {}) }));
    } catch { setLocalErrors({ items: true }); return; }
    const parsed = rfqBusinessSchema.safeParse({
      contact: { full_name: read(form, 'full_name'), customer_type: buyer, preferred_locale: preferredLocale,
        ...optional(form, 'company_name'), ...optional(form, 'email'), ...optional(form, 'whatsapp_number'), ...optional(form, 'wechat_id') },
      destination_country: country, ...optional(form, 'destination_city_port'), ...optional(form, 'preferred_currency'), locale,
      items: lines,
      prescription_ids: prescriptions,
    });
    if (!parsed.success) { setLocalErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), true]))); return; }
    if (!token) { setLocalErrors({ turnstile_token: true }); return; }
    setLocalErrors({});
    if (await submit(parsed.data, token, kind)) completed();
  }
  function saveToList() {
    if (isLocked() || uploadBusyRef.current || !formRef.current) return;
    const form = new FormData(formRef.current);
    try {
      const quantity = Number(form.get('quantity'));
      if (product) cart.addItem({ ...product, quantity });
      else cart.addCustomItem({ name: read(form, 'name'), strength: read(form, 'strength'), packagingUnit: read(form, 'unit'), quantity });
      onClose(); cart.setDrawerOpen(true);
    } catch (error: unknown) { setListIssue(cartText(error instanceof CartError ? error.issue : 'invalidItem')); }
  }
  const close = () => { if (!isLocked() && !uploadBusyRef.current) onClose(); };
  const recovery = state.status === 'challenge' ? 'challengeRecovery' : state.status === 'conflict' ? 'conflictRecovery'
    : state.status === 'uncertain' ? (state.error?.status === 429 ? 'rateLimited' : state.error?.status === 503 ? 'unavailable' : 'uncertain') : 'validationHelp';
  const requestId = state.error?.requestId && /^[\w-]{1,100}$/.test(state.error.requestId) ? state.error.requestId : undefined;
  return <Modal title={kind === 'quick-quote' ? shell('quickQuote') : t('cartTitle')} onClose={close} closeDisabled={locked || uploadBusy}>
    {state.status === 'success' && state.receipt ? <div className="rfq-success" role="status"><CheckCircle2 size={36}/><h3>{t('success')}</h3><p className="rfq-reference">{state.receipt.rfq_number}</p><p>{t('successHelp')}</p>
      <p className="small muted">{t('emailGuidance')}</p><details className="rfq-details"><summary>{t('officialContact')}</summary><ContactChannels contact={contact}/></details>
      <button className="button primary" onClick={close}>{t('done')}</button></div>
    : <>
      <p className="muted">{t('intro')}</p>
      <form ref={formRef} className="stack-form rfq-form" noValidate onSubmit={send}>
        <fieldset disabled={locked || uploadBusy} className="rfq-fields"><legend>{t('requirements')}</legend>
          {kind === 'quick-quote' ? <>
            <label>{cartText('medicine')}<input name="name" maxLength={200} defaultValue={product?.name ?? initialName} readOnly={Boolean(product)} autoComplete="off" aria-invalid={invalid('items.0.custom_medicine_name')} aria-describedby={described('items.0.custom_medicine_name')}/>{fieldError('items.0.custom_medicine_name')}{fieldError('items.0.product_id')}</label>
            <div className="form-pair"><label>{cartText('strength')}<input name="strength" maxLength={100} defaultValue={product?.strength} readOnly={Boolean(product)} aria-invalid={invalid('items.0.custom_strength')}/>{fieldError('items.0.custom_strength')}</label>
              <label>{cartText('unit')}<input name="unit" maxLength={40} defaultValue={product?.packagingUnit ?? 'BOX'} readOnly={Boolean(product)} aria-invalid={invalid('items.0.packaging_unit')} aria-describedby={described('items.0.packaging_unit')}/>{fieldError('items.0.packaging_unit')}</label></div>
            {!product && <p className="small muted">{t('unitHelp')}</p>}
            <label>{cartText('quantity')}<input name="quantity" type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} defaultValue={product?.quantity ?? 1} aria-invalid={invalid('items.0.quantity')} aria-describedby={described('items.0.quantity')}/>{fieldError('items.0.quantity')}</label>
          </> : <ul className="rfq-lines">{snapshot.map((item, index) => <li key={item.id}>
            <strong>{item.kind === 'catalog' ? item.names?.[locale] ?? item.name : item.name}</strong><p className="small muted">{item.strength} · {item.quantity}</p>
            <label>{cartText('unit')}<input name={`items.${index}.packaging_unit`} defaultValue={item.packagingUnit} readOnly={item.kind === 'catalog'} maxLength={40} aria-invalid={invalid(`items.${index}.packaging_unit`)} aria-describedby={described(`items.${index}.packaging_unit`)}/>{fieldError(`items.${index}.packaging_unit`)}</label>
            {item.kind === 'custom' && <p className="small muted">{t('unitHelp')}</p>}
            {fieldError(`items.${index}.product_id`)}{fieldError(`items.${index}.quantity`)}
            <details className="rfq-details"><summary>{t('lineNotes')}</summary><label><span className="sr-only">{t('lineNotes')} {index + 1}</span><textarea name={`items.${index}.line_notes`} maxLength={2000} rows={2} aria-invalid={invalid(`items.${index}.line_notes`)}/>{fieldError(`items.${index}.line_notes`)}</label></details>
          </li>)}</ul>}
          {fieldError('items')}
        </fieldset>
        <fieldset disabled={locked || uploadBusy} className="rfq-fields"><legend>{t('contactTitle')}</legend>
          <label>{t('buyerType')}<select value={buyer} onChange={(event) => setBuyer(event.currentTarget.value)}><option value="B2C_PATIENT">{t('patient')}</option><option value="B2B_WHOLESALE">{t('wholesale')}</option></select></label>
          <label>{t('fullName')}<input name="full_name" autoComplete="name" maxLength={200} aria-invalid={invalid('contact.full_name')} aria-describedby={described('contact.full_name')}/>{fieldError('contact.full_name')}</label>
          {buyer === 'B2B_WHOLESALE' && <label>{t('company')}<input name="company_name" autoComplete="organization" maxLength={200} aria-invalid={invalid('contact.company_name')} aria-describedby={described('contact.company_name')}/>{fieldError('contact.company_name')}</label>}
          <label>{t('country')}<input name="destination_country" autoComplete="country" maxLength={2} placeholder="BD / CN" value={country} onChange={(event) => setCountry(event.currentTarget.value.toUpperCase())} aria-invalid={invalid('destination_country')} aria-describedby={described('destination_country')}/>{fieldError('destination_country')}</label>
          <label>{t('preferredLocale')}<select value={preferredLocale} onChange={(event) => setPreferredLocale(event.currentTarget.value)}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
          <p className="small muted">{t(emailRequired ? 'emailRequired' : 'contactHelp')}</p>
          <label>{t('email')}{emailRequired ? ' *' : ''}<input name="email" type="email" autoComplete="email" inputMode="email" maxLength={200} aria-required={emailRequired} aria-invalid={invalid('contact.email')} aria-describedby={described('contact.email')}/>{fieldError('contact.email')}</label>
          <div className="form-pair"><label>WhatsApp<input name="whatsapp_number" autoComplete="tel" inputMode="tel" maxLength={50} aria-invalid={invalid('contact.whatsapp_number')}/>{fieldError('contact.whatsapp_number')}</label>
            <label>{t('wechat')}<input name="wechat_id" maxLength={100} autoComplete="off" aria-invalid={invalid('contact.wechat_id')}/>{fieldError('contact.wechat_id')}</label></div>
          <details className="rfq-details"><summary>{t('optionalDetails')}</summary><div className="stack-form">
            <label>{t('city')}<input name="destination_city_port" autoComplete="address-level2" maxLength={200} aria-invalid={invalid('destination_city_port')}/>{fieldError('destination_city_port')}</label>
            <label>{t('currency')}<select name="preferred_currency"><option value="">{t('unspecified')}</option>{['USD', 'EUR', 'CNY', 'BDT'].map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>{fieldError('preferred_currency')}</label>
            {kind === 'quick-quote' && <label>{t('lineNotes')}<textarea name="items.0.line_notes" rows={3} maxLength={2000} aria-invalid={invalid('items.0.line_notes')}/>{fieldError('items.0.line_notes')}</label>}
          </div></details>
        </fieldset>
        <section className="rfq-challenge" aria-label={t('security')}><div className="rfq-security"><ShieldCheck size={18}/>{t('security')}</div>
          {siteKey ? <Turnstile key={challengeVersion} siteKey={siteKey} options={{ size: 'compact', language: locale, theme: 'light', responseField: false }}
            onSuccess={setToken} onExpire={() => setToken('')} onError={() => { setToken(''); }}/>
            : <p className="form-error" role="status">{t('challengeUnavailable')}</p>}
          {!token && siteKey && <p className="small muted">{t('challengeNeeded')}</p>}{fieldError('turnstile_token')}
        </section>
        <details className="rfq-details"><summary>{t('prescriptionTitle')}</summary>
          <PrescriptionUpload token={token} disabled={locked} onConsumed={refreshChallenge} onChange={setPrescriptions} onBusy={(value) => { uploadBusyRef.current = value; setUploadBusy(value); }}/>
          {fieldError('prescription_ids')}
        </details>
        {state.error && <div role="alert" className="rfq-recovery"><p>{t(recovery)}</p>
          {requestId && <p className="small">{t('requestId')}: {requestId}</p>}
          {locked && state.key && <p className="small rfq-intent">{t('intentId')}: {state.key}</p>}
        </div>}
        {locked && <p className="small muted" role="status">{t(busy ? 'submitting' : 'lockedHelp')}</p>}
        {locked && !busy ? <button type="button" className="button primary" disabled={state.status === 'challenge' && !token || state.error?.code === 'INTENT_EXPIRED'} onClick={async () => { if (await reconcile(state.status === 'challenge' ? token : undefined)) completed(); }}>{t(state.status === 'challenge' ? 'retryChallenge' : 'reconcile')}</button>
          : <button type="submit" className="button primary" disabled={busy || uploadBusy || !token || !cart.hydrated}>{t(busy ? 'submitting' : 'submit')}<ArrowRight size={17}/></button>}
        <p className="small muted">{t('emailGuidance')}</p>
        <details className="rfq-details"><summary>{t('officialContact')}</summary><ContactChannels contact={contact}/></details>
        {kind === 'quick-quote' && <><p className="small muted">{cartText('savedLocally')}</p>{listIssue && <p role="alert" className="form-error">{listIssue}</p>}
          <button type="button" className="button secondary" disabled={locked || uploadBusy || !cart.hydrated} onClick={saveToList}>{cartText('addToList')}</button></>}
      </form>
    </>}
  </Modal>;
}
