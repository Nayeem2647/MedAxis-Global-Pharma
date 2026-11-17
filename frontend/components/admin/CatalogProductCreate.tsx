'use client';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { apiRequest, ApiError } from '../../lib/api-client';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import type { RfqLine } from '../../lib/admin-workflow';
import { MasterPicker } from './MasterPicker';
import { AdminOperationFeedback } from './AdminOperationFeedback';
const required = z.string().trim().min(1).max(200);
export const catalogCreateBody = z.strictObject({ sku: required, manufacturer_id: z.uuidv4(), generic_id: z.uuidv4(), category_ids: z.array(z.uuidv4()).min(1).max(100).refine((rows) => new Set(rows).size === rows.length), translations: z.strictObject({ en: z.strictObject({ brand_name: required, slug: required.regex(/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u) }) }), strength: required.max(100), dosage_form: required.max(100), pack_size: required.max(100), packaging_unit: required.max(40).regex(/^[A-Z0-9_ -]+$/), cold_chain_required: z.boolean(), status: z.literal('DRAFT') });
export function CatalogProductCreate({ line, onClose }: { line: RfqLine; onClose(): void }) {
  const { operation, state } = useAdminOperation(); const [id, setId] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await operation.run(async () => {
      const parsed = catalogCreateBody.safeParse({ sku: form.get('sku'), manufacturer_id: form.get('manufacturer'), generic_id: form.get('generic'), category_ids: form.getAll('categories'), translations: { en: { brand_name: form.get('brand'), slug: form.get('slug') } }, strength: form.get('strength'), dosage_form: form.get('dosage_form'), pack_size: form.get('pack_size'), packaging_unit: form.get('packaging_unit'), cold_chain_required: form.get('cold_chain') === 'on', status: 'DRAFT' });
      if (!parsed.success) throw new ApiError('Invalid catalog fields.', { status: 422, code: 'VALIDATION_FAILED', responseValidated: true, details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), issue: 'Check this field.' })) });
      return (await apiRequest('/v1/admin/catalog/products', z.object({ _id: z.uuidv4() }), { method: 'POST', json: parsed.data, timeoutMs: 15_000 })).data;
    }, async () => undefined, (result) => setId(result._id));
  }
  return <section className="admin-create-product"><h3>Create a draft catalog product</h3><p className="small muted">Prefilled from this custom requirement. Creating a product does not change this RFQ line or its original association. Choose active records from the searchable, paginated master directories.</p><AdminOperationFeedback state={state}/>{id ? <p role="status">Created draft product: {id}. The RFQ remains uncatalogued.</p> : <form className="stack-form" onSubmit={submit}><fieldset disabled={state.busy || state.blocked} className="admin-form-grid">{[['brand', 'English brand name', line.custom_medicine_name ?? ''], ['strength', 'Strength', line.custom_strength ?? ''], ['sku', 'SKU', ''], ['slug', 'English slug', ''], ['dosage_form', 'Dosage form', ''], ['pack_size', 'Pack size', ''], ['packaging_unit', 'Packaging unit', line.packaging_unit]].map(([name, label, value]) => <label key={name}>{label}<input name={name} required defaultValue={value} maxLength={name === 'categories' ? 4000 : 200}/></label>)}<MasterPicker kind="manufacturers" name="manufacturer" label="Manufacturer"/><MasterPicker kind="generics" name="generic" label="Generic"/><MasterPicker kind="categories" name="categories" label="Categories" multiple/><label className="admin-check"><input name="cold_chain" type="checkbox"/>Requires cold chain</label><button className="button primary">Create catalog draft</button></fieldset></form>}<button className="button secondary" disabled={state.busy} onClick={onClose}>Close product form</button></section>;
}
