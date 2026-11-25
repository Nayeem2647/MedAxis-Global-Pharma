'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronDown, Download, Eye, FileSpreadsheet, Layers, LoaderCircle, Pin, X } from 'lucide-react';
import { apiRequest } from '../../lib/api-client';
import {
  manufacturerBody,
  genericBody,
  masterLabels,
  type MasterDirectoryKind,
  masterRecord,
  validatedInput,
  type MasterRecord,
} from '../../lib/admin-management';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { InlineStatusNotice } from './AdminOperationFeedback';
import { CatalogImage } from '../catalog/CatalogImage';

export type { MasterDirectoryKind } from '../../lib/admin-management';

function useClientReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function MasterStatusFilter({ value, kind }: { value: string; kind: MasterDirectoryKind }) {
  const ready = useClientReady();
  return (
    <label className="admin-products-status-filter">
      <span className="sr-only">Active setting</span>
      <select
        name="is_active"
        form={`admin-${kind}-filters`}
        defaultValue={value}
        disabled={!ready}
        aria-label="Active setting"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </label>
  );
}

export function MasterListExport({ rows: records, kind }: { rows: MasterRecord[]; kind: MasterDirectoryKind }) {
  const ready = useClientReady();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  function download() {
    const cell = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
    const manufacturer = kind === 'manufacturers';
    const columns = manufacturer ? ['Manufacturer Name', 'Slug', 'Country', 'Total Product', 'Total RFQ', 'Status'] : kind === 'categories' ? ['Category Name', 'Slug', 'Sort order', 'Status'] : ['Generic Name', 'Slug', 'Therapeutic Indications', 'Status'];
    const rows = records.map((row) => [
      row.translations.en.name,
      row.translations.en.slug,
      ...(manufacturer ? [row.country ?? '', String(row.product_count ?? 0), String(row.rfq_count ?? 0)] : kind === 'categories' ? [String(row.sort_order ?? 0)] : [(row.therapeutic_indications ?? []).join('; ')]),
      row.is_active ? 'Active' : 'Inactive',
    ]);
    const csv = '\uFEFF' + [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `medaxis-${kind}-page.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div
      className="admin-products-export"
      ref={container}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="button secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={!ready || !records.length}
      >
        <Download size={17} aria-hidden="true" />
        Export
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="admin-products-export-menu" role="menu" aria-label={`${masterLabels[kind]} export`}>
          <p>Current page · {records.length} {kind}</p>
          <button type="button" role="menuitem" onClick={download}>
            <FileSpreadsheet size={17} aria-hidden="true" />
            Download CSV
          </button>
        </div>
      )}
    </div>
  );
}

export function MasterStatusSwitch({ record, kind }: { record: MasterRecord; kind: MasterDirectoryKind }) {
  const [row, setRow] = useState(record);
  const router = useRouter();
  const ready = useClientReady();
  const path = `/v1/admin/catalog/${kind}`;
  const { operation, state } = useAdminOperation();
  const category = kind === 'categories';
  const checked = row.is_active && (!category || row.show_on_home !== false);
  const featured = row.home_featured === true;
  const inactiveCategory = category && !row.is_active;
  const disabled = !ready || state.busy || state.blocked || inactiveCategory;
  const name = row.translations.en.name;
  const title = category
    ? inactiveCategory
      ? 'Activate this category in its editor to show it on the homepage'
      : `${checked ? 'Hide from' : 'Show on'} the homepage`
    : `${checked ? 'Deactivate' : 'Activate'} ${masterLabels[kind].toLowerCase()}`;

  async function refresh() {
    const next = (await apiRequest(`${path}/${row.id}`, masterRecord)).data;
    setRow((current) => ({
      ...next,
      logo_url: next.logo_data_url ?? current.logo_url,
      product_count: current.product_count,
      rfq_count: current.rfq_count,
    }));
    if (category) router.refresh();
  }

  async function saveHomeOrCatalogStatus(homeSetting?: { show_on_home: boolean } | { home_featured: boolean }) {
    const payload = homeSetting ?? validatedInput(kind === 'manufacturers' ? manufacturerBody : genericBody, {
      id: row.id,
      translations: row.translations,
      is_active: !checked,
      ...(kind === 'manufacturers' ? {
        ...(row.country ? { country: row.country } : {}),
        ...(row.certifications ? { certifications: row.certifications } : {}),
      } : { ...(row.therapeutic_indications ? { therapeutic_indications: row.therapeutic_indications } : {}) }),
    });
    await operation.run(
      async () =>
        (
          await apiRequest(category ? `${path}/${row.id}/home-visibility` : path, masterRecord, {
            method: category ? 'PATCH' : 'POST',
            json: payload,
            timeoutMs: 15_000,
          })
        ).data,
      refresh,
      (saved) =>
        setRow((current) => ({
          ...saved,
          logo_url: saved.logo_data_url ?? current.logo_url,
          product_count: current.product_count,
          rfq_count: current.rfq_count,
        })),
    );
  }

  return (
    <div className="admin-manufacturer-status">
      <button
        type="button"
        role="switch"
        className="admin-product-switch"
        aria-checked={checked}
        aria-label={category ? `Show ${name} on homepage` : `Set ${name} active status`}
        disabled={disabled}
        title={title}
        onClick={() => void saveHomeOrCatalogStatus(category ? { show_on_home: !checked } : undefined)}
      >
        <span>{state.busy && <LoaderCircle size={12} aria-hidden="true" />}</span>
      </button>
      {category && (
        <button
          type="button"
          className="button secondary admin-category-priority"
          aria-pressed={featured}
          aria-label={`Show ${name} first on homepage`}
          title={checked ? 'Show in the first group. Lower Sort order values appear earlier.' : 'Turn on homepage visibility to feature this category.'}
          disabled={disabled || !checked}
          onClick={() => void saveHomeOrCatalogStatus({ home_featured: !featured })}
        >
          <Pin size={14} fill={featured ? 'currentColor' : 'none'} aria-hidden="true" />
          Show first
        </button>
      )}
      <InlineStatusNotice state={state} onRetry={() => void operation.refresh(refresh)} />
    </div>
  );
}

export function MasterPreview({
  record: row,
  logo = null,
  kind,
}: {
  record: MasterRecord;
  logo?: string | null;
  kind: MasterDirectoryKind;
}) {
  const ready = useClientReady();
  const dialog = useRef<HTMLDialogElement>(null);
  const name = row.translations.en.name;
  const label = masterLabels[kind];

  return (
    <>
      <button
        type="button"
        className="admin-product-action"
        aria-label={`Preview ${name}`}
        disabled={!ready}
        onClick={() => dialog.current?.showModal()}
      >
        <Eye size={17} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        className="admin-product-preview"
        aria-label={`${label} preview: ${name}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="admin-product-preview-heading">
          <h2>{label} preview</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${label.toLowerCase()} preview`}
            onClick={() => dialog.current?.close()}
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>
        <div className="admin-product-preview-body">
          {kind !== 'generics' && <div className="admin-product-preview-image">
            {logo ? (
              <CatalogImage
                src={logo}
                alt={name}
                width={220}
                height={140}
                sizes="220px"
                fallbackLabel={kind === 'manufacturers' ? 'No logo' : 'No picture'}
              />
            ) : (
              kind === 'manufacturers' ? <Building2 size={54} strokeWidth={1.2} aria-hidden="true" /> : <Layers size={54} strokeWidth={1.2} aria-hidden="true" />
            )}
          </div>}
          <h3>{name}</h3>
          {row.translations.zhCN && <p lang="zh-CN">{row.translations.zhCN.name}</p>}
          <dl>
            {[
              ['Slug', row.translations.en.slug],
              ...(kind === 'manufacturers' ? [
                ['Country', row.country ?? 'Not specified'],
                ['Total Product', String(row.product_count ?? 0)],
                ['Total RFQ', String(row.rfq_count ?? 0)],
              ] : kind === 'categories' ? [['Sort order', String(row.sort_order ?? 0)]] : [['Therapeutic indications', row.therapeutic_indications?.join(', ') || 'Not specified']]),
              ['Status', row.is_active ? 'Active' : 'Inactive'],
              ...(kind === 'manufacturers' && row.certifications?.length
                ? [['Certifications', row.certifications.join(', ')]]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </dialog>
    </>
  );
}
