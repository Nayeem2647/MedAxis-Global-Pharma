'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, ShoppingBag } from 'lucide-react';
import { z } from 'zod';
import { customerRequest } from '../../lib/customer-api';
import { draftBodySchema, type CustomerDraft, type CustomerProfile } from '../../lib/customer-contract';
import { useCart } from '../layout/CartProvider';

export function CustomerDraftEditor({ draft, profile, units, onSaved, onCancel }: { draft?: CustomerDraft; profile: CustomerProfile; units: string[]; onSaved(): void; onCancel(): void }) {
  const t = useTranslations('Customer'); const cart = useCart();
  const blank = () => ({ name: '', strength: '', quantity: 1, packaging_unit: units[0] ?? 'BOX', notes: '' });
  const [items, setItems] = useState<z.infer<typeof draftBodySchema>['items']>(draft?.items ?? [blank()]);
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState('');
  function update(index: number, change: Partial<typeof items[number]>) { setItems((current) => current.map((item, i) => i === index ? { ...item, ...change } : item)); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    const parsed = draftBodySchema.safeParse({ title: form.get('title'), destination_country: String(form.get('destination_country') ?? '').toUpperCase(), preferred_currency: form.get('preferred_currency'), items });
    if (!parsed.success) { setProblem(t('checkFields')); return; }
    setBusy(true); setProblem('');
    try {
      if (draft) await customerRequest(`drafts/${draft.id}`, z.object({ saved: z.boolean(), revision: z.number() }), { method: 'PATCH', body: { ...parsed.data, revision: draft.revision } });
      else await customerRequest('drafts', z.object({ id: z.uuid() }), { method: 'POST', body: parsed.data });
      onSaved();
    } catch { setProblem(t('saveFailed')); } finally { setBusy(false); }
  }
  return <section className="customer-panel"><div className="customer-section-heading"><h2>{t(draft ? 'editDraft' : 'newDraft')}</h2><button type="button" className="text-button" onClick={onCancel} disabled={busy}>{t('cancel')}</button></div>
    <form className="stack-form" onSubmit={save}><fieldset disabled={busy} className="customer-form-fields">
      <label>{t('draftTitle')}<input name="title" required maxLength={200} defaultValue={draft?.title}/></label>
      <div className="form-pair"><label>{t('destination')}<input name="destination_country" required pattern="[A-Za-z]{2}" minLength={2} maxLength={2} defaultValue={draft?.destination_country ?? profile.country}/></label><label>{t('currency')}<select name="preferred_currency" defaultValue={draft?.preferred_currency ?? 'USD'}>{['USD', 'CNY', 'EUR', 'BDT'].map((value) => <option key={value}>{value}</option>)}</select></label></div>
      {cart.items.length > 0 && <button type="button" className="button secondary customer-import-cart" onClick={() => setItems(cart.items.map((item) => ({ ...(item.kind === 'catalog' ? { product_id: item.productId } : {}), name: item.name, strength: item.strength, quantity: item.quantity, packaging_unit: item.packagingUnit, notes: '' })))}><ShoppingBag size={17}/>{t('importQuoteList', { count: cart.items.length })}</button>}
      <p className="customer-field-help">{t('draftHelp')}</p>
      <div className="customer-draft-lines">{items.map((item, index) => <div className="customer-draft-line" key={index}>
        <div className="customer-line-heading"><strong>{t('itemNumber', { number: index + 1 })}</strong><button type="button" className="customer-remove-line" disabled={items.length === 1} aria-label={t('removeItem', { number: index + 1 })} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Trash2 size={17}/></button></div>
        <div className="form-pair"><label>{t('medicine')}<input required maxLength={200} value={item.name} readOnly={Boolean(item.product_id)} onChange={(event) => update(index, { name: event.target.value })}/></label><label>{t('strength')}<input maxLength={100} value={item.strength ?? ''} readOnly={Boolean(item.product_id)} onChange={(event) => update(index, { strength: event.target.value })}/></label></div>
        <div className="form-pair"><label>{t('quantity')}<input type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required value={item.quantity || ''} onChange={(event) => update(index, { quantity: Number(event.target.value) })}/></label><label>{t('unit')}<input list="customer-packaging-units" required maxLength={40} value={item.packaging_unit} onChange={(event) => update(index, { packaging_unit: event.target.value })}/></label></div>
        <label>{t('itemNotes')}<textarea maxLength={2000} rows={2} value={item.notes ?? ''} onChange={(event) => update(index, { notes: event.target.value })}/></label>
      </div>)}</div>
      <datalist id="customer-packaging-units">{units.map((unit) => <option key={unit} value={unit}/>)}</datalist>
      <button type="button" className="button secondary" disabled={items.length >= 100} onClick={() => setItems((current) => [...current, blank()])}><Plus size={17}/>{t('addItem')}</button>
      {problem && <p role="alert" className="customer-feedback is-error">{problem}</p>}
      <button className="button primary" type="submit" disabled={busy}>{t(busy ? 'working' : 'saveDraft')}</button>
    </fieldset></form>
  </section>;
}
