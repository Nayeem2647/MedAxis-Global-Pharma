'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Filter, LoaderCircle, Search } from 'lucide-react';
import { masterRecord, readResource, resourceList, type MasterRecord } from '../../lib/admin-management';
import { feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { AdminLink } from './AdminShell';

type DirectoryKind = 'manufacturers' | 'categories' | 'generics';
const ProductSearchContext = createContext<{ value: string; change(value: string): void } | null>(null);

export function ProductListSearchProvider({ initialQuery, children }: { initialQuery: string; children: ReactNode }) {
  const [value, change] = useState(initialQuery);
  return <ProductSearchContext.Provider value={{ value, change }}>{children}</ProductSearchContext.Provider>;
}

export function ProductSearchInput({ toolbar = false }: { toolbar?: boolean }) {
  const search = useContext(ProductSearchContext);
  if (!search) throw new Error('Product search context is required.');
  return <input id={toolbar ? 'admin-product-toolbar-search' : 'admin-product-search'} type="search" name={toolbar ? undefined : 'q'} form={toolbar ? 'admin-product-filters' : undefined} value={search.value} onChange={(event) => search.change(event.currentTarget.value)} maxLength={100} placeholder={toolbar ? 'Search by Product Name' : 'Search products…'} aria-label={toolbar ? 'Search by Product Name' : undefined} />;
}

function DirectoryFilter({ kind, name, label, allLabel, initial = '' }: {
  kind: DirectoryKind; name: string; label: string; allLabel: string; initial?: string;
}) {
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [selectedName, setSelectedName] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<MasterRecord[]>([]);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AdminFeedbackValue>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!initial) return;
    const controller = new AbortController();
    void readResource(kind, initial, controller.signal).then((row) => {
      if (!controller.signal.aborted && 'name' in row.translations.en) setSelectedName(row.translations.en.name);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [initial, kind]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target) && details.current) details.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true);
    setProblem(undefined);
    const timer = setTimeout(() => {
      void resourceList(kind, new URLSearchParams({ page: String(page), limit: '20', ...(q.trim() ? { q: q.trim() } : {}) }), controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setRows(result.items.map((row) => masterRecord.parse({ ...row, _id: row.id })));
          setPages(result.pagination.total_pages);
        })
        .catch((error: unknown) => { if (!controller.signal.aborted) setProblem(feedbackValue(error)); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, open, q, page, attempt]);

  function select(id: string, name: string) {
    setValue(id);
    setSelectedName(name);
    if (details.current) {
      details.current.open = false;
      details.current.querySelector('summary')?.focus();
    }
  }

  return <div className="admin-product-filter-field">
    <span id={`${id}-label`}>{label}</span>
    <input type="hidden" name={name} value={value} />
    <details ref={details} className="admin-directory-filter" onToggle={(event) => setOpen(event.currentTarget.open)} onKeyDown={(event) => {
      if (event.key === 'Escape' && details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); }
    }}>
      <summary aria-labelledby={`${id}-label ${id}-value`}><span id={`${id}-value`}>{value ? selectedName || `Selected ${label.toLowerCase()}` : allLabel}</span><ChevronDown size={17} aria-hidden="true" /></summary>
      {open && <div className="admin-directory-popover" role="group" aria-label={`${label} options`}>
        <label className="admin-directory-search"><Search size={16} aria-hidden="true" /><input type="search" value={q} onChange={(event) => { setQ(event.currentTarget.value); setPage(1); }} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label.toLowerCase()}`} maxLength={100} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
        <button type="button" className="admin-directory-option" aria-pressed={!value} onClick={() => select('', '')}>{allLabel}</button>
        <div className="admin-directory-results" aria-busy={busy}>
          {busy ? <p role="status"><LoaderCircle size={15} aria-hidden="true" />Loading options…</p> : problem ? <div className="admin-directory-error" role="alert"><p>Options could not be loaded.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div> : rows.length ? rows.map((row) => <button type="button" className="admin-directory-option" key={row.id} aria-pressed={value === row.id} onClick={() => select(row.id, row.translations.en.name)}>{row.translations.en.name}{!row.is_active && <small>Inactive</small>}</button>) : <p>No matching options.</p>}
        </div>
        <div className="admin-directory-pagination"><button type="button" disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(1, pages)}</span><button type="button" disabled={busy || page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      </div>}
    </details>
  </div>;
}

export function ProductListFilters({ query }: { query: Record<string, string> }) {
  return <section className="admin-product-filter-panel" aria-labelledby="admin-product-filter-heading">
    <div className="admin-product-filter-heading"><h2 id="admin-product-filter-heading"><Filter size={17} aria-hidden="true" />Filter Products</h2></div>
    <form id="admin-product-filters" method="get" action="/admin/catalog/products" key={JSON.stringify(query)}>
      {query.limit && <input type="hidden" name="limit" value={query.limit} />}
      <div className="admin-product-filter-grid">
        <DirectoryFilter kind="manufacturers" name="manufacturer_id" label="Manufacturer" allLabel="All Manufacturers" initial={query.manufacturer_id} />
        <DirectoryFilter kind="categories" name="category_id" label="Therapeutic Category" allLabel="All Categories" initial={query.category_id} />
        <DirectoryFilter kind="generics" name="generic_id" label="Generics Name" allLabel="All Generics" initial={query.generic_id} />
        <div className="admin-product-filter-field"><label htmlFor="admin-product-search">Search</label><div className="admin-product-search-box"><ProductSearchInput /><button type="submit" aria-label="Search products"><Search size={21} aria-hidden="true" /></button></div></div>
      </div>
      <div className="admin-product-filter-actions"><AdminLink href="/admin/catalog/products" className="button secondary">Reset</AdminLink><button type="submit" className="button primary">Show data</button></div>
    </form>
  </section>;
}
