'use client';
import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { apiRequest } from '../../lib/api-client';
import { z } from 'zod';
import {
  adminMultipart,
  bannerBody,
  categoryBody,
  genericBody,
  imageReceipt,
  manufacturerBody,
  productBody,
  readResource,
  resourceName,
  resourcePath,
  resourceSchema,
  validatedInput,
  validateCatalogImage,
  type ResourceKind,
  type ResourceRecord,
} from '../../lib/admin-management';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { AdminOperationFeedback } from './AdminOperationFeedback';
import { MasterPicker } from './MasterPicker';
import { AdminLink } from './AdminShell';

export function ResourceEditor({
  kind,
  initial,
  units,
}: {
  kind: ResourceKind;
  initial: ResourceRecord | null;
  units: string[];
}) {
  const { operation, state } = useAdminOperation();
  const [row, setRow] = useState(initial);
  const [zh, setZh] = useState(!!initial?.translations.zhCN);
  const [review, setReview] = useState(!!(initial && 'review_metadata' in initial && initial.review_metadata));
  const [keys, setKeys] = useState(initial && 'image_keys' in initial ? initial.image_keys : []);
  const [receipt, setReceipt] = useState<ReturnType<typeof imageReceipt.parse>>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadUnknown, setUploadUnknown] = useState(false);
  const product = row && 'sku' in row ? row : null;
  const master = row && 'is_active' in row && 'slug' in row.translations.en ? row : null;
  const banner = row && 'link_path' in row ? row : null;
  const translations = (lang: 'en' | 'zhCN') => {
    const value = row?.translations[lang];
    return value ?? {};
  };
  const fieldValue = (lang: 'en' | 'zhCN', key: string) => {
    const value = Object.entries(translations(lang)).find(([name]) => name === key)?.[1];
    return typeof value === 'string' ? value : '';
  };
  async function refresh() {
    if (row) {
      const next = await readResource(kind, row.id);
      if (next.updated_at !== row.updated_at) operation.reconcileAdvancedVersion();
      setRow(next);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (key: string) => String(form.get(key) ?? '').trim() || undefined;
    const checked = (key: string) => form.get(key) === 'on';
    await operation.run(
      async () => {
        const translate = (lang: 'en' | 'zhCN') => {
          const result: Record<string, string> = {};
          for (const key of kind === 'banners'
            ? ['title', 'body']
            : kind === 'products'
              ? [
                  'brand_name',
                  'slug',
                  'description',
                  'seo_title',
                  'meta_description',
                  'indication_summary',
                  'usage_notes',
                  'storage_condition',
                  'image_alt_text',
                ]
              : ['name', 'slug', 'description', 'seo_title', 'meta_description']) {
            const value = optional(`${lang}_${key}`);
            if (value) result[key] = value;
          }
          return result;
        };
        const content = {
          en: translate('en'),
          ...(zh ? { zhCN: translate('zhCN') } : {}),
        };
        let body: unknown;
        if (kind === 'products') {
          body = validatedInput(productBody, {
            sku: form.get('sku'),
            manufacturer_id: form.get('manufacturer_id'),
            generic_id: form.get('generic_id'),
            category_ids: form.getAll('category_ids'),
            translations: content,
            strength: form.get('strength'),
            dosage_form: form.get('dosage_form'),
            pack_size: form.get('pack_size'),
            packaging_unit: form.get('packaging_unit'),
            cold_chain_required: checked('cold_chain_required'),
            storage_condition: optional('storage_condition'),
            image_keys: keys,
            status: form.get('status'),
            ...(review
              ? {
                  review_metadata: {
                    kind: form.get('review_kind'),
                    reviewed_at: optional('review_date') ? new Date(`${optional('review_date')}Z`).toISOString() : '',
                    reviewer_name: form.get('reviewer_name'),
                  },
                }
              : row
                ? { review_metadata: null }
                : {}),
          });
          if (row && !zh && typeof body === 'object' && body !== null && 'translations' in body)
            body = { ...body, translations: { ...content, zhCN: null } };
        } else if (kind === 'banners')
          body = validatedInput(bannerBody, {
            ...(row ? { id: row.id } : {}),
            translations: content,
            is_active: checked('is_active'),
            sort_order: Number(form.get('sort_order')),
            starts_at: optional('starts_at') ? new Date(`${optional('starts_at')}Z`).toISOString() : undefined,
            ends_at: optional('ends_at') ? new Date(`${optional('ends_at')}Z`).toISOString() : undefined,
            link_path: optional('link_path'),
          });
        else {
          const base = {
            ...(row ? { id: row.id } : {}),
            translations: content,
            is_active: checked('is_active'),
          };
          body =
            kind === 'manufacturers'
              ? validatedInput(manufacturerBody, {
                  ...base,
                  country: String(form.get('country')).toUpperCase(),
                  certifications: String(form.get('certifications') ?? '')
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              : kind === 'generics'
                ? validatedInput(genericBody, {
                    ...base,
                    therapeutic_indications: String(form.get('therapeutic_indications') ?? '')
                      .split('\n')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                : validatedInput(categoryBody, {
                    ...base,
                    sort_order: Number(form.get('sort_order')),
                  });
        }
        return (
          await apiRequest(resourcePath(kind, kind === 'products' ? row?.id : undefined), resourceSchema(kind), {
            method: kind === 'products' && row ? 'PATCH' : 'POST',
            json: z.json().parse(JSON.parse(JSON.stringify(body))),
            timeoutMs: 20_000,
          })
        ).data;
      },
      async () => undefined,
      (result) => {
        setRow(result);
        if (!row) window.location.assign(`/admin/catalog/${kind}/${result.id}`);
      },
    );
  }
  async function upload(file: File) {
    if (uploading || uploadUnknown) return;
    setUploading(true);
    setUploadError('');
    try {
      await validateCatalogImage(file);
      const form = new FormData();
      form.set('image', file);
      const result = await adminMultipart('/api/admin/catalog/images', form, imageReceipt);
      setKeys((current) => [...new Set([...current, result.r2_object_key])].slice(0, 20));
      setReceipt(result);
    } catch (error: unknown) {
      setUploadError(
        error instanceof Error && error.name === 'ApiError'
          ? 'Image upload could not be completed. Review the file and storage configuration.'
          : 'Image upload delivery is uncertain. Check storage before another upload.',
      );
      if (!(error instanceof Error && error.name === 'ApiError')) setUploadUnknown(true);
    } finally {
      setUploading(false);
    }
  }
  const disabled = state.busy || state.blocked || uploading;
  const translationFields =
    kind === 'banners'
      ? ['title', 'body']
      : kind === 'products'
        ? [
            'brand_name',
            'slug',
            'description',
            'seo_title',
            'meta_description',
            'indication_summary',
            'usage_notes',
            'storage_condition',
            'image_alt_text',
          ]
        : ['name', 'slug', 'description', 'seo_title', 'meta_description'];
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <AdminLink href={`/admin/catalog/${kind}`}>← Browse {kind}</AdminLink>
          <h1>{row ? `Edit ${resourceName(row)}` : kind === 'products' ? 'Add New Product' : `Create ${kind}`}</h1>
        </div>
        {row && (
          <button className="button secondary" disabled={state.busy} onClick={() => void operation.refresh(refresh)}>
            Refresh saved state
          </button>
        )}
      </div>
      <AdminOperationFeedback state={state} />
      <form className="stack-form admin-panel" onSubmit={submit}>
        <fieldset disabled={disabled}>
          {kind === 'products' && (
            <>
              <div className="admin-form-grid">
                {(['sku', 'strength', 'dosage_form', 'pack_size'] as const).map((key) => (
                  <label key={key}>
                    {key.replaceAll('_', ' ')}
                    <input name={key} required maxLength={key === 'sku' ? 200 : 100} defaultValue={product?.[key]} />
                  </label>
                ))}
                <label>
                  Packaging unit
                  <select name="packaging_unit" required defaultValue={product?.packaging_unit ?? ''}>
                    <option value="">Select configured unit</option>
                    {[...new Set([...units, ...(product ? [product.packaging_unit] : [])])].map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={product?.status ?? 'DRAFT'}>
                    {['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Storage condition
                  <input name="storage_condition" maxLength={200} defaultValue={product?.storage_condition} />
                </label>
                <label className="admin-check">
                  <input type="checkbox" name="cold_chain_required" defaultChecked={product?.cold_chain_required} />
                  Cold chain required
                </label>
              </div>
              <MasterPicker
                kind="manufacturers"
                name="manufacturer_id"
                label="Manufacturer"
                initial={product ? [{ id: product.manufacturer_id }] : []}
              />
              <MasterPicker
                kind="generics"
                name="generic_id"
                label="Generic"
                initial={product ? [{ id: product.generic_id }] : []}
              />
              <MasterPicker
                kind="categories"
                name="category_ids"
                label="Categories"
                initial={product?.category_ids.map((id) => ({ id }))}
                multiple
              />
              <section>
                <h2>Catalog images</h2>
                <p className="small muted">
                  JPEG, PNG or WebP, up to 5 MiB each. Upload stores a server-issued asset key. Removing a key here
                  removes its product association.
                </p>
                <label>
                  Upload product image
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={keys.length >= 20 || uploadUnknown}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void upload(file);
                    }}
                  />
                </label>
                {uploading && <p role="status">Uploading image…</p>}
                {uploadError && <p role="alert">{uploadError}</p>}
                {receipt && (
                  <div>
                    <Image src={receipt.url} alt="Uploaded product preview" width={160} height={160} unoptimized />
                    <p>
                      {receipt.mime_type} · {receipt.file_size_bytes} bytes
                    </p>
                  </div>
                )}
                {keys.map((key) => (
                  <div key={key} className="admin-picker-selection">
                    <span>{key}</span>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setKeys((items) => items.filter((value) => value !== key))}
                    >
                      Remove image
                    </button>
                  </div>
                ))}
              </section>
              <label className="admin-check">
                <input type="checkbox" checked={review} onChange={(event) => setReview(event.currentTarget.checked)} />
                Record an actual completed review
              </label>
              {review && (
                <div className="admin-form-grid">
                  <label>
                    Review kind
                    <select name="review_kind" defaultValue={product?.review_metadata?.kind ?? 'TECHNICAL'}>
                      <option>TECHNICAL</option>
                      <option>MEDICAL</option>
                    </select>
                  </label>
                  <label>
                    Reviewed at (UTC)
                    <input
                      type="datetime-local"
                      name="review_date"
                      required
                      defaultValue={product?.review_metadata?.reviewed_at.slice(0, 19)}
                      step="1"
                    />
                  </label>
                  <label>
                    Reviewer name
                    <input
                      name="reviewer_name"
                      required
                      maxLength={200}
                      defaultValue={product?.review_metadata?.reviewer_name}
                    />
                  </label>
                  <p className="small muted">
                    Enter the person and date of a real review. A catalog update is not a medical review.
                  </p>
                </div>
              )}
            </>
          )}
          {kind !== 'products' && (
            <div className="admin-form-grid">
              <label className="admin-check">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={row && 'is_active' in row ? row.is_active : true}
                />
                Active
              </label>
              {kind === 'manufacturers' && (
                <>
                  <label>
                    Country (ISO code)
                    <input
                      name="country"
                      required
                      pattern="[A-Za-z]{2}"
                      maxLength={2}
                      defaultValue={master && 'country' in master ? master.country : ''}
                    />
                  </label>
                  <label>
                    Actual certifications (one per line)
                    <textarea
                      name="certifications"
                      defaultValue={master && 'certifications' in master ? master.certifications?.join('\n') : ''}
                    />
                  </label>
                </>
              )}
              {kind === 'generics' && (
                <label>
                  Therapeutic indications (one per line)
                  <textarea
                    name="therapeutic_indications"
                    defaultValue={
                      master && 'therapeutic_indications' in master ? master.therapeutic_indications?.join('\n') : ''
                    }
                  />
                </label>
              )}
              {(kind === 'categories' || kind === 'banners') && (
                <label>
                  Sort order
                  <input
                    name="sort_order"
                    type="number"
                    min="0"
                    step="1"
                    required
                    defaultValue={row && 'sort_order' in row ? row.sort_order : 0}
                  />
                </label>
              )}
              {kind === 'banners' && (
                <>
                  <label>
                    Starts at (UTC, optional)
                    <input
                      name="starts_at"
                      type="datetime-local"
                      defaultValue={row && 'starts_at' in row ? row.starts_at?.slice(0, 19) : ''}
                      step="1"
                    />
                  </label>
                  <label>
                    Ends at (UTC, optional)
                    <input
                      name="ends_at"
                      type="datetime-local"
                      defaultValue={row && 'ends_at' in row ? row.ends_at?.slice(0, 19) : ''}
                      step="1"
                    />
                  </label>
                  <label>
                    Public relative link (optional)
                    <input
                      name="link_path"
                      placeholder="/en/products"
                      maxLength={500}
                      defaultValue={banner?.link_path}
                    />
                  </label>
                  <p className="small muted">
                    An active banner is visible only inside its configured schedule. Use sourcing information without
                    public prices, discounts or unsupported clinical claims.
                  </p>
                </>
              )}
            </div>
          )}
          <label className="admin-check">
            <input type="checkbox" checked={zh} onChange={(event) => setZh(event.currentTarget.checked)} />
            Include Simplified Chinese translation
          </label>
          {(['en', ...(zh ? (['zhCN'] as const) : [])] as const).map((lang) => (
            <fieldset className="admin-translation" key={lang}>
              <legend>{lang === 'en' ? 'English' : '简体中文'}</legend>
              <div className="admin-form-grid">
                {translationFields.map((key) => (
                  <label key={key}>
                    {key.replaceAll('_', ' ')}
                    {['description', 'body', 'indication_summary', 'usage_notes'].includes(key) ? (
                      <textarea
                        name={`${lang}_${key}`}
                        required={key === 'body'}
                        defaultValue={fieldValue(lang, key)}
                        maxLength={key === 'body' || key === 'description' ? 5000 : 2000}
                      />
                    ) : (
                      <input
                        name={`${lang}_${key}`}
                        required={['brand_name', 'name', 'slug', 'title'].includes(key)}
                        defaultValue={fieldValue(lang, key)}
                        maxLength={key === 'meta_description' || key === 'storage_condition' ? 500 : 200}
                      />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="admin-check">
            <input type="checkbox" required />I verified these details and public-facing claims.
          </label>
          <button className="button primary">{state.busy ? 'Saving…' : row ? 'Save changes' : 'Create record'}</button>
        </fieldset>
      </form>
      <p className="small muted">
        Historical slugs are reserved. Public changes trigger the backend ISR webhook; the browser never receives its
        secret. Archive products or deactivate masters instead of deleting them.
      </p>
    </>
  );
}
