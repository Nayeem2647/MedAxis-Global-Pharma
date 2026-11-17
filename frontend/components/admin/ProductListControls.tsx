'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Eye, FileSpreadsheet, LoaderCircle, Pill, X } from 'lucide-react';
import { apiRequest } from '../../lib/api-client';
import { productRecord, readResource, type ProductRecord } from '../../lib/admin-management';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { AdminOperationFeedback } from './AdminOperationFeedback';
import { CatalogImage } from '../catalog/CatalogImage';

export function ProductStatusFilter({ value }: { value: string }) {
  return <label className="admin-products-status-filter"><span className="sr-only">Status</span><select name="status" form="admin-product-filters" defaultValue={value} aria-label="Status" onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>;
}

export function ProductListExport({ products }: { products: ProductRecord[] }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  function download() {
    const cell = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
    const columns = ['SKU', 'Product Name', 'Strength', 'Dosage Form', 'Pack Size', 'Packaging Unit', 'Cold Chain Required', 'Status'];
    const rows = products.map((row) => [row.sku, row.translations.en.brand_name, row.strength, row.dosage_form, row.pack_size, row.packaging_unit, String(row.cold_chain_required), row.status]);
    const csv = '\uFEFF' + [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'medaxis-products-page.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
    trigger.current?.focus();
  }
  return <div className="admin-products-export" ref={container} onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()); }
  }}><button ref={trigger} type="button" className="button secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} disabled={!products.length}><Download size={17} aria-hidden="true" />Export<ChevronDown size={14} aria-hidden="true" /></button>
    {open && <div className="admin-products-export-menu" role="menu" aria-label="Product export"><p>Current page · {products.length} products</p><button type="button" role="menuitem" onClick={download}><FileSpreadsheet size={17} aria-hidden="true" />Download CSV</button></div>}
  </div>;
}

export function ProductPublication({ product }: { product: ProductRecord }) {
  const [row, setRow] = useState(product);
  const { operation, state } = useAdminOperation();
  const published = row.status === 'PUBLISHED';
  async function refresh() {
    const next = await readResource('products', row.id);
    if ('sku' in next) setRow(next);
  }
  async function toggle() {
    await operation.run(async () => (
      await apiRequest(`/v1/admin/catalog/products/${row.id}`, productRecord, {
        method: 'PATCH', json: { status: published ? 'DRAFT' : 'PUBLISHED' }, timeoutMs: 15_000,
      })
    ).data, refresh, setRow);
    if (operation.getSnapshot().notice === 'Saved. Server state refreshed.') window.location.reload();
  }
  return <div className="admin-product-publication">
    <button type="button" role="switch" className="admin-product-switch" aria-checked={published} aria-label={`Publish ${row.translations.en.brand_name}`} disabled={state.busy || state.blocked || row.status === 'ARCHIVED'} title={row.status === 'ARCHIVED' ? 'Edit this archived product to publish it again' : published ? 'Move to draft' : 'Publish product'} onClick={() => void toggle()}><span>{state.busy && <LoaderCircle size={12} aria-hidden="true" />}</span></button>
    <span className={`admin-product-status is-${row.status.toLowerCase()}`}>{row.status}</span>
    <AdminOperationFeedback state={state} />
    {state.blocked && <button type="button" className="admin-product-refresh" disabled={state.busy} onClick={() => void operation.refresh(refresh)}>Refresh status</button>}
  </div>;
}

export function ProductPreview({ product, image }: { product: ProductRecord; image: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const name = product.translations.en.brand_name;
  return <>
    <button type="button" className="admin-product-action" aria-label={`Preview ${name}`} onClick={() => dialog.current?.showModal()}><Eye size={17} aria-hidden="true" /></button>
    <dialog ref={dialog} className="admin-product-preview" aria-label={`Product preview: ${name}`} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="admin-product-preview-heading"><h2>Product preview</h2><button type="button" className="icon-button" aria-label="Close product preview" onClick={() => dialog.current?.close()}><X size={21} aria-hidden="true" /></button></div>
      <div className="admin-product-preview-body">
        <div className="admin-product-preview-image">{image ? <CatalogImage src={image} alt={product.translations.en.image_alt_text ?? name} width={240} height={240} sizes="240px" fallbackLabel="No image" /> : <Pill size={54} strokeWidth={1.2} aria-hidden="true" />}</div>
        <h3>{name}</h3>
        {product.translations.zhCN && <p lang="zh-CN">{product.translations.zhCN.brand_name}</p>}
        <dl>{[['SKU', product.sku], ['Strength', product.strength], ['Dosage form', product.dosage_form], ['Pack size', product.pack_size], ['Packaging unit', product.packaging_unit], ['Status', product.status], ['Cold chain', product.cold_chain_required ? 'Required' : 'Standard'], ...(product.storage_condition ? [['Storage', product.storage_condition]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </div>
    </dialog>
  </>;
}
