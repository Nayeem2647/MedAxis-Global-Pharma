'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type MouseEvent } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { catalogQueryString, type CatalogQuery } from '../../lib/catalog-query';
import { CatalogFilterDropdown } from './CatalogFilterDropdown';

export interface CatalogFilterField {
  key: 'manufacturer' | 'category' | 'generic';
  label: string;
  allLabel: string;
  searchLabel: string;
  options: { id: string; name: string; value: string; enSlug: string; zhSlug?: string }[];
}

interface CatalogFiltersProps {
  path: string;
  query: CatalogQuery;
  fields: CatalogFilterField[];
  locked: boolean;
  labels: { filters: string; search: string; placeholder: string; submit: string; alphabet: string; all: string; loading: string; noOptionMatches: string };
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
  const [navigation, setNavigation] = useState<{ href: string; replace: boolean } | null>(null);
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
    if (incoming !== lastIncoming.current) {
      lastIncoming.current = incoming;
      if (incoming !== lastRequested.current) {
        cancelSearch();
        lastRequested.current = null;
        setNavigation(null);
        draftRef.current = query;
        setDraft(query);
        return;
      }
    }

    // Keep the latest filter choice queued while a catalog navigation is still loading.
    if (!navigation || (pending && !navigation.replace)) return;
    setNavigation(null);
    lastRequested.current = navigation.href;
    startTransition(() => {
      if (navigation.replace) router.replace(navigation.href, { scroll: false });
      else router.push(navigation.href, { scroll: false });
    });
  }, [path, query, navigation, pending, router]);

  function update(next: CatalogQuery) {
    draftRef.current = next;
    setDraft(next);
  }

  function navigate(next: CatalogQuery, replace = false) {
    cancelSearch();
    setNavigation({ href: filterHref(path, { ...next, page: 1 }), replace });
  }

  function search(value: string) {
    const next = { ...draftRef.current, page: 1, q: value, initial: undefined };
    update(next);
    cancelSearch();
    if (composing.current) return;
    if (!value) navigate(next, true);
    else timer.current = setTimeout(() => navigate(draftRef.current, true), 350);
  }

  function chooseLetter(event: MouseEvent<HTMLAnchorElement>, value: string | undefined) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const next = letterQuery(draftRef.current, value);
    update(next);
    navigate(next);
  }

  function chooseFilter(key: CatalogFilterField['key'], value: string) {
    const next = { ...draftRef.current, page: 1, [key]: value || undefined };
    update(next);
    navigate(next);
  }

  function letterQuery(current: CatalogQuery, initial?: string): CatalogQuery {
    return { ...current, page: 1, q: undefined, initial };
  }

  const allActive = !draft.initial && !draft.q;
  const busy = pending || navigation !== null;

  return <form className="catalog-filters" action={path} method="get" aria-label={labels.filters} aria-busy={!ready || busy}
    onSubmit={(event) => { event.preventDefault(); if (!composing.current) navigate(draftRef.current); }}>
    {draft.dosage_form && <input type="hidden" name="dosage_form" value={draft.dosage_form}/>}
    {draft.cold_chain && <input type="hidden" name="cold_chain" value={draft.cold_chain}/>}
    {draft.limit !== 20 && <input type="hidden" name="limit" value={draft.limit}/>}
    {draft.initial && <input type="hidden" name="initial" value={draft.initial}/>}
    <div className={`filter-primary${locked ? ' is-locked' : ''}`}>
      {fields.map((field) => <CatalogFilterDropdown key={field.key} field={field} active={draft[field.key] ?? ''}
        noMatches={labels.noOptionMatches} onChoose={(value) => chooseFilter(field.key, value)}/>)}
      <div className="filter-field filter-search">
        <label htmlFor="catalog-filter-q">{labels.search}</label>
        <div className="filter-search-box filter-actions">
          <input id="catalog-filter-q" name="q" type="search" maxLength={100} value={draft.q ?? ''} placeholder={labels.placeholder} disabled={!ready}
            onChange={(event) => search(event.currentTarget.value)}
            onCompositionStart={() => { composing.current = true; cancelSearch(); }}
            onCompositionEnd={(event) => { composing.current = false; search(event.currentTarget.value); }}/>
          <button className="filter-search-submit" type="submit" aria-label={labels.submit} disabled={!ready}>
            {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true"/> : <Search size={18} aria-hidden="true"/>}
          </button>
        </div>
      </div>
    </div>
    <nav className="filter-alpha" aria-label={labels.alphabet}>
      <Link href={filterHref(path, letterQuery(draft))} scroll={false} prefetch={false}
        onClick={(event) => chooseLetter(event, undefined)} className={`alpha-pill alpha-all${allActive ? ' is-active' : ''}`} aria-current={allActive ? 'true' : undefined}>{labels.all}</Link>
      {alphabet.map((letter) => {
        const active = draft.initial === letter;
        const value = active ? undefined : letter;
        return <Link key={letter} href={filterHref(path, letterQuery(draft, value))} scroll={false} prefetch={false}
          onClick={(event) => chooseLetter(event, value)} className={`alpha-pill${active ? ' is-active' : ''}`} aria-current={active ? 'true' : undefined}>{letter}</Link>;
      })}
    </nav>
    <span className="sr-only" role="status">{busy ? labels.loading : ''}</span>
  </form>;
}
