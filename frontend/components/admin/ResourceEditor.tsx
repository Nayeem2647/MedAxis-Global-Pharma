'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { Factory, ImageIcon, Layers, Pill } from 'lucide-react';
import { apiRequest } from '../../lib/api-client';
import { z } from 'zod';
import {
  adminMultipart,
  bannerBody,
  categoryBody,
  genericBody,
  imageReceipt,
  manufacturerBody,
  MAX_MANUFACTURER_LOGO_LENGTH,
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
import { ProductEditor } from './ProductEditor';
import { productSlug } from '../../lib/product-form';
import { GenericIndicationsTranslation } from './GenericIndicationsTranslation';

async function encodeMasterImage(file: File) {
  await validateCatalogImage(file);
  const bitmap = await createImageBitmap(file);
  try {
    const size = 500;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preview is unavailable.');
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    const logo = canvas.toDataURL('image/webp', 0.85);
    if (logo.length > MAX_MANUFACTURER_LOGO_LENGTH) throw new Error('Choose a smaller or simpler image.');
    return logo;
  } finally {
    bitmap.close();
  }
}

function savedChineseDescription(record: ResourceRecord | null) {
  const value = record?.translations.zhCN;
  return value && 'description' in value ? value.description ?? '' : '';
}

export function ResourceEditor(props: { kind: ResourceKind; initial: ResourceRecord | null; units: string[] }) {
  const [sequence, setSequence] = useState(0);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const created = (record: ResourceRecord) => {
    setSaved({ id: record.id, name: resourceName(record) });
    // A fresh editor resets both native fields and React state after a confirmed create.
    setSequence((value) => value + 1);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const key = `${props.kind}:${props.initial?.id ?? `new-${sequence}`}`;
  return <>
    {!props.initial && saved && <div className="admin-feedback admin-created-feedback" role="status">
      <p><strong>Saved successfully: {saved.name}.</strong> The form is ready for another entry.</p>
      <AdminLink href={`/admin/catalog/${props.kind}/${saved.id}`} className="button secondary">View saved record</AdminLink>
    </div>}
    {props.kind === 'products'
      ? <ProductEditor key={key} initial={props.initial && 'sku' in props.initial ? props.initial : null} units={props.units} onCreated={created} />
      : <LegacyResourceEditor key={key} {...props} onCreated={created} />}
  </>;
}

function LegacyResourceEditor({
  kind,
  initial,
  units,
  onCreated,
}: {
  kind: ResourceKind;
  initial: ResourceRecord | null;
  units: string[];
  onCreated: (record: ResourceRecord) => void;
}) {
  const { operation, state } = useAdminOperation();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [row, setRow] = useState(initial);
  const [zh, setZh] = useState(!!initial?.translations.zhCN);
  const [review, setReview] = useState(!!(initial && 'review_metadata' in initial && initial.review_metadata));
  const [keys, setKeys] = useState(initial && 'image_keys' in initial ? initial.image_keys : []);
  const [receipt, setReceipt] = useState<ReturnType<typeof imageReceipt.parse>>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadUnknown, setUploadUnknown] = useState(false);
  const [selectedLogo, setSelectedLogo] = useState<{ url: string; name: string } | null>();
  const [logoError, setLogoError] = useState('');
  const [preparingLogo, setPreparingLogo] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [genericIndications, setGenericIndications] = useState(initial && 'therapeutic_indications' in initial ? initial.therapeutic_indications?.join('\n') ?? '' : '');
  const [chineseDescription, setChineseDescription] = useState(savedChineseDescription(initial));
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationVersion, setTranslationVersion] = useState(0);
  const translated = useCallback(() => {
    const review = formRef.current?.querySelector<HTMLInputElement>('input[data-claims-review]');
    if (review) review.checked = false;
  }, []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const errorFor = (path: string) => fieldErrors[path] ? <p className="form-error" role="alert">{fieldErrors[path]}</p> : null;
  function checkInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) setFieldErrors(Object.fromEntries(result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return [path.startsWith('therapeutic_indications') ? 'therapeutic_indications' : path,
        path.startsWith('therapeutic_indications') ? 'Use up to 5000 characters in total and at most 100 entries.'
          : path.endsWith('.slug') ? 'Use a single page slug with words separated by hyphens, or leave it blank to generate one from the name.'
          : path.endsWith('.name') ? 'Enter the name for this language.' : issue.message];
    })));
    return validatedInput(schema, input);
  }
  const manufacturer = kind === 'manufacturers';
  const generic = kind === 'generics';
  const category = kind === 'categories';
  const masterForm = manufacturer || generic || category;
  const masterLabel = manufacturer ? 'Manufacturer' : category ? 'Category' : 'Generic';
  const imageLabel = manufacturer ? 'Manufacturer logo' : `${masterLabel} picture`;
  const imageInputId = manufacturer ? 'manufacturer-logo' : `${masterLabel.toLowerCase()}-picture`;
  const chineseFieldsId = `${masterLabel.toLowerCase()}-chinese-fields`;
  const savedLogo = row && 'logo_data_url' in row ? row.logo_data_url : undefined;
  const logoPreview = selectedLogo === undefined ? savedLogo : selectedLogo?.url;
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
      if (generic) {
        setGenericIndications('therapeutic_indications' in next ? next.therapeutic_indications?.join('\n') ?? '' : '');
        setChineseDescription(savedChineseDescription(next));
        setTranslationVersion((old) => old + 1);
      }
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preparingLogo || translationBusy) return;
    setFieldErrors({});
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
          if (masterForm && (result.slug || result.name))
            result.slug = productSlug(result.slug || result.name || '');
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
              ? checkInput(manufacturerBody, {
                  ...base,
                  certifications: String(form.get('certifications') ?? '')
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
                  ...(selectedLogo !== undefined ? { logo_data_url: selectedLogo?.url ?? null } : {}),
                })
              : kind === 'generics'
                ? checkInput(genericBody, {
                    ...base,
                    therapeutic_indications: String(form.get('therapeutic_indications') ?? '')
                      .split('\n')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                : checkInput(categoryBody, {
                    ...base,
                    ...(selectedLogo !== undefined ? { logo_data_url: selectedLogo?.url ?? null } : {}),
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
        if (!row) onCreated(result);
        else {
          setRow(result);
          setSelectedLogo(undefined);
        }
      },
    );
  }
  async function chooseLogo(file: File) {
    setPreparingLogo(true);
    setLogoError('');
    try {
      setSelectedLogo({ url: await encodeMasterImage(file), name: file.name });
    } catch {
      setLogoError('Choose a readable JPEG, PNG or WebP image up to 5 MiB.');
    } finally {
      setPreparingLogo(false);
    }
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
      setKeys((current) => [...new Set([...current, result.object_key])].slice(0, 20));
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
  const disabled = !ready || state.busy || state.blocked || uploading || preparingLogo;
  const languages: ('en' | 'zhCN')[] = masterForm ? [] : ['en'];
  if (zh && !masterForm) languages.push('zhCN');
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
      <div className={masterForm ? 'admin-page-heading admin-manufacturer-heading' : 'admin-page-heading'}>
        <div>
          {!masterForm && <AdminLink href={`/admin/catalog/${kind}`}>← Browse {kind}</AdminLink>}
          <h1>{masterForm && (manufacturer ? <Factory size={26} aria-hidden="true" /> : category ? <Layers size={26} aria-hidden="true" /> : <Pill size={26} aria-hidden="true" />)}{row ? `Edit ${resourceName(row)}` : kind === 'products' ? 'Add New Product' : masterForm ? `Add New ${masterLabel}` : `Create ${kind}`}</h1>
        </div>
        {row && (
          <button className="button secondary" disabled={state.busy} onClick={() => void operation.refresh(refresh)}>
            Refresh saved state
          </button>
        )}
      </div>
      {!masterForm && <AdminOperationFeedback state={state} />}
      <form ref={formRef} className={masterForm ? 'stack-form admin-panel admin-manufacturer-form' : 'stack-form admin-panel'} onSubmit={submit} onReset={masterForm ? () => {
        setSelectedLogo(undefined);
        setLogoError('');
        setZh(!!row?.translations.zhCN);
        setGenericIndications(row && 'therapeutic_indications' in row ? row.therapeutic_indications?.join('\n') ?? '' : '');
        setChineseDescription(savedChineseDescription(row));
        setTranslationVersion((old) => old + 1);
        setFieldErrors({});
      } : undefined}>
        <fieldset disabled={disabled}>
          {masterForm && <>
            <div className="admin-manufacturer-language">English (EN)</div>
            <div className={generic ? 'admin-generic-basics' : 'admin-manufacturer-basics'}>
              <div className={generic ? 'admin-manufacturer-fields admin-form-grid' : 'admin-manufacturer-fields'}>
                <label>{masterLabel} name (EN)
                  <input name="en_name" required maxLength={200} placeholder={manufacturer ? 'e.g. Beacon Pharmaceuticals' : 'e.g. Osimertinib'} defaultValue={fieldValue('en', 'name')} />
                  {errorFor('translations.en.name')}
                </label>
                {!generic && <div>
                  <label htmlFor={imageInputId}>{imageLabel} <small>1:1 · 500 × 500 px</small></label>
                  <div className="admin-manufacturer-file">
                    <span>{selectedLogo?.name || (logoPreview ? manufacturer ? 'Saved logo' : 'Saved picture' : 'Choose file')}</span>
                    <label className="admin-manufacturer-browse" htmlFor={imageInputId}>Browse</label>
                    <input id={imageInputId} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void chooseLogo(file);
                    }} />
                  </div>
                  {logoError && <p className="form-error" role="alert">{logoError}</p>}
                  {preparingLogo && <p role="status">{manufacturer ? 'Preparing logo…' : 'Preparing picture…'}</p>}
                </div>}
                {generic && <label>Therapeutic indications (one per line)
                  <textarea name="therapeutic_indications" rows={6} maxLength={5000} placeholder="Enter verified therapeutic indications. Paragraphs are supported."
                    value={genericIndications} onChange={(event) => setGenericIndications(event.target.value)} />
                  <small>Up to 5000 characters in total. Each new line starts another entry.</small>
                  {errorFor('therapeutic_indications')}
                </label>}
              </div>
              {!generic && <div className="admin-manufacturer-preview">
                <div className="admin-manufacturer-image">
                  {logoPreview
                    ? <Image src={logoPreview} alt={`${imageLabel} preview`} width={220} height={220} unoptimized />
                    : <ImageIcon size={48} aria-hidden="true" />}
                </div>
                {logoPreview && (
                  <button type="button" className="admin-manufacturer-remove" onClick={() => {
                    setSelectedLogo(selectedLogo ? undefined : null);
                    setLogoError('');
                  }}>
                    {selectedLogo && savedLogo ? manufacturer ? 'Discard new logo' : 'Discard new picture' : manufacturer ? 'Remove logo' : 'Remove picture'}
                  </button>
                )}
              </div>}
            </div>
          </>}
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
          {masterForm && <details className="admin-manufacturer-optional">
            <summary>Additional details</summary>
            <div className="admin-form-grid">
              <label>Slug<input name="en_slug" defaultValue={fieldValue('en', 'slug')} maxLength={200} placeholder="Generated from the name" onBlur={(event) => { event.currentTarget.value = productSlug(event.currentTarget.value); }} />{errorFor('translations.en.slug')}<small>One URL slug, not a list of brand names. Leave blank to generate from the name.</small></label>
              <label>Description<textarea name="en_description" defaultValue={fieldValue('en', 'description')} maxLength={5000} /></label>
              <label>SEO title<input name="en_seo_title" defaultValue={fieldValue('en', 'seo_title')} maxLength={200} /></label>
              <label>Meta description<input name="en_meta_description" defaultValue={fieldValue('en', 'meta_description')} maxLength={500} /></label>
              {manufacturer && <label>Certifications (one per line)<textarea name="certifications" defaultValue={master && 'certifications' in master ? master.certifications?.join('\n') : ''} /></label>}
            </div>
          </details>}
          {masterForm ? (
            <section className="admin-manufacturer-chinese" aria-label="Simplified Chinese translation">
              <div className="admin-manufacturer-chinese-heading">
                <h2>Simplified Chinese <span lang="zh-CN">简体中文</span></h2>
                <label className="admin-check">
                  <input type="checkbox" checked={zh} aria-controls={chineseFieldsId}
                    onChange={(event) => setZh(event.currentTarget.checked)} />
                  Include Simplified Chinese translation
                </label>
                {!zh && (
                  <p className="small muted">
                    {row?.translations.zhCN
                      ? 'Saving with this option off removes the saved Chinese translation.'
                      : 'The Chinese catalog uses the English information when this option is off.'}
                  </p>
                )}
              </div>
              <fieldset className="admin-manufacturer-chinese-fields" id={chineseFieldsId}
                aria-label={`Chinese ${masterLabel.toLowerCase()} details`} hidden={!zh} disabled={!zh}>
                <div className="admin-manufacturer-chinese-grid">
                  <label><span>{masterLabel} name (ZH) <small className="admin-manufacturer-field-required">Required</small></span>
                    <input name="zhCN_name" required maxLength={200} lang="zh-CN" defaultValue={fieldValue('zhCN', 'name')} />
                    {errorFor('translations.zhCN.name')}
                  </label>
                  <label><span>Page slug <small>Optional</small></span>
                    <input name="zhCN_slug" maxLength={200} placeholder="Generated from the Chinese name"
                      onBlur={(event) => { event.currentTarget.value = productSlug(event.currentTarget.value); }}
                      defaultValue={fieldValue('zhCN', 'slug')} />
                    <small>One URL slug, not a list of brand names. Leave blank to generate from the Chinese name.</small>
                    {errorFor('translations.zhCN.slug')}
                  </label>
                </div>
                {generic ? <GenericIndicationsTranslation key={translationVersion} enabled={zh} disabled={disabled} indications={genericIndications} value={chineseDescription}
                  onChange={setChineseDescription} onBusy={setTranslationBusy} onGenerated={translated} /> : <label><span>Description <small>Optional</small></span>
                  <textarea name="zhCN_description" rows={4} maxLength={5000} lang="zh-CN"
                    defaultValue={fieldValue('zhCN', 'description')} />
                </label>}
                <details className="admin-manufacturer-chinese-seo">
                  <summary>Search engine details <small>Optional</small></summary>
                  <div className="admin-manufacturer-chinese-grid">
                    <label>SEO title
                      <input name="zhCN_seo_title" maxLength={200} lang="zh-CN" defaultValue={fieldValue('zhCN', 'seo_title')} />
                    </label>
                    <label>Meta description
                      <textarea name="zhCN_meta_description" rows={2} maxLength={500} lang="zh-CN"
                        defaultValue={fieldValue('zhCN', 'meta_description')} />
                    </label>
                  </div>
                </details>
              </fieldset>
            </section>
          ) : (
            <label className="admin-check">
              <input type="checkbox" checked={zh} onChange={(event) => setZh(event.currentTarget.checked)} />
              Include Simplified Chinese translation
            </label>
          )}
          {languages.map((lang) => (
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
            <input type="checkbox" data-claims-review required />I verified these details and public-facing claims.
          </label>
          {masterForm && <AdminOperationFeedback state={state} />}
          {masterForm && state.problem?.code === 'CATALOG_SLUG_CONFLICT' && (
            <p><AdminLink href={`/admin/catalog/${kind}`}>Open existing {kind}</AdminLink> to edit the saved {masterLabel.toLowerCase()}.</p>
          )}
          {masterForm ? <div className="admin-manufacturer-actions">
            <button type="reset" className="button secondary">Reset</button>
            <button className="button primary" disabled={translationBusy}>{translationBusy ? 'Translating…' : state.busy ? 'Saving…' : row ? 'Save changes' : 'Submit'}</button>
          </div> : <button className="button primary">{state.busy ? 'Saving…' : row ? 'Save changes' : 'Create record'}</button>}
        </fieldset>
      </form>
      <p className="small muted">
        Historical slugs are reserved. Public changes trigger the backend ISR webhook; the browser never receives its
        secret. Archive products or deactivate masters instead of deleting them.
      </p>
    </>
  );
}
