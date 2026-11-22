'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type MouseEvent } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { catalogQueryString, type CatalogQuery } from '../../lib/catalog-query';

export interface CatalogFilterField {
  key: 'manufacturer' | 'category' | 'generic';
  label: string;
  allLabel: string;
  options: { id: string; name: string; value: string; enSlug: string; zhSlug?: string }[];
}

interface CatalogFiltersProps {
  path: string;
  query: CatalogQuery;
  fields: CatalogFilterField[];
  locked: boolean;
  labels: { filters: string; search: string; placeholder: string; submit: string; alphabet: string; all: string; loading: string };
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function filterHref(path: string, query: CatalogQuery) {
  const params = new URLSearchParams(catalogQueryString({ ...query, q: query.q?.trim() || undefined }));
  if (query.page === 1) params.delete('page');
  if (query.limit === 20) params.delete('limit');
  return params.size ? `${path}?${params}` : path;
}

export function CatalogFilters({ path, query, fields, locked, labels }: CatalogFiltersProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState(query);
  const [pending, startTransition] = useTransition();
  const draftRef = useRef(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const lastIncoming = useRef(filterHref(path, query));
  const lastRequested = useRef<string | null>(null);

  function cancelSearch() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  useEffect(() => {
    setReady(true);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const incoming = filterHref(path, query);
    if (incoming === lastIncoming.current) return;
    lastIncoming.current = incoming;
    // A completed search must not overwrite text entered during that request.
    if (incoming === lastRequested.current) return;
    cancelSearch();
    lastRequested.current = null;
    draftRef.current = query;
    setDraft(query);
  }, [path, query]);

  function update(next: CatalogQuery) {
    draftRef.current = next;
    setDraft(next);
  }

  function navigate(next: CatalogQuery, replace = false) {
    cancelSearch();
    const href = filterHref(path, { ...next, page: 1 });
    lastRequested.current = href;
    startTransition(() => {
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  }

  function search(value: string) {
    const next = { ...draftRef.current, page: 1, q: value };
    update(next);
    cancelSearch();
    if (composing.current) return;
    if (!value) navigate(next, true);
    else timer.current = setTimeout(() => navigate(draftRef.current, true), 350);
  }

  function chooseLetter(event: MouseEvent<HTMLAnchorElement>, value: string | undefined) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const next = { ...draftRef.current, page: 1, q: value };
    update(next);
    navigate(next);
  }

  const activeLetter = draft.q?.trim().length === 1 ? draft.q.trim().toUpperCase() : null;

  return <form className="catalog-filters" action={path} method="get" aria-label={labels.filters} aria-busy={!ready || pending}
    onSubmit={(event) => { event.preventDefault(); if (!composing.current) navigate(draftRef.current); }}>
    {draft.dosage_form && <input type="hidden" name="dosage_form" value={draft.dosage_form}/>}
    {draft.cold_chain && <input type="hidden" name="cold_chain" value={draft.cold_chain}/>}
    {draft.limit !== 20 && <input type="hidden" name="limit" value={draft.limit}/>}
    <div className={`filter-primary${locked ? ' is-locked' : ''}`}>
      {fields.map(({ key, label, allLabel, options }) => {
        const active = draft[key] ?? '';
        return <label key={key} className="filter-field">
          <span>{label}</span>
          <select name={key} data-catalog-filter={key} value={active} disabled={!ready} onChange={(event) => {
            const next = { ...draftRef.current, page: 1, [key]: event.currentTarget.value || undefined };
            update(next);
            navigate(next);
          }}>
            <option value="">{allLabel}</option>
            {active && !options.some((option) => option.value === active) && <option value={active}>{active}</option>}
            {options.map((option) => <option key={option.id} value={option.value} data-en-slug={option.enSlug} data-zh-slug={option.zhSlug}>{option.name}</option>)}
          </select>
        </label>;
      })}
      <div className="filter-field filter-search">
        <label htmlFor="catalog-filter-q">{labels.search}</label>
        <div className="filter-search-box filter-actions">
          <input id="catalog-filter-q" name="q" type="search" maxLength={100} value={draft.q ?? ''} placeholder={labels.placeholder} disabled={!ready}
            onChange={(event) => search(event.currentTarget.value)}
            onCompositionStart={() => { composing.current = true; cancelSearch(); }}
            onCompositionEnd={(event) => { composing.current = false; search(event.currentTarget.value); }}/>
          <button className="filter-search-submit" type="submit" aria-label={labels.submit} disabled={!ready}>
            {pending ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true"/> : <Search size={18} aria-hidden="true"/>}
          </button>
        </div>
      </div>
    </div>
    <nav className="filter-alpha" aria-label={labels.alphabet}>
      <Link href={filterHref(path, { ...draft, page: 1, q: undefined })} scroll={false} prefetch={false}
        onClick={(event) => chooseLetter(event, undefined)} className={`alpha-pill alpha-all${!draft.q ? ' is-active' : ''}`} aria-current={!draft.q ? 'true' : undefined}>{labels.all}</Link>
      {alphabet.map((letter) => {
        const active = activeLetter === letter;
        const value = active ? undefined : letter;
        return <Link key={letter} href={filterHref(path, { ...draft, page: 1, q: value })} scroll={false} prefetch={false}
          onClick={(event) => chooseLetter(event, value)} className={`alpha-pill${active ? ' is-active' : ''}`} aria-current={active ? 'true' : undefined}>{letter}</Link>;
      })}
    </nav>
    <span className="sr-only" role="status">{pending ? labels.loading : ''}</span>
  </form>;
}
