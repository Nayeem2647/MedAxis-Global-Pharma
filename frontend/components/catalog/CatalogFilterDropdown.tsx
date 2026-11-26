'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { CatalogFilterField } from './CatalogFilters';

function OpenOnBrowse({ filter, onOpen }: { filter: CatalogFilterField['key']; onOpen: () => void }) {
  const requested = useSearchParams().get('browse') === filter;

  useEffect(() => {
    if (!requested) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('browse') !== filter) return;
    onOpen();
    url.searchParams.delete('browse');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [filter, onOpen, requested]);

  return null;
}

function searchableText(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\s-]+/g, ' ').trim();
}

export function CatalogFilterDropdown({ field, active, noMatches, onChoose }: {
  field: CatalogFilterField;
  active: string;
  noMatches: string;
  onChoose: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionsPanel = useRef<HTMLDivElement>(null);
  const activeOption = field.options.find((option) => option.value === active);
  const activeLabel = active ? activeOption?.name ?? active : field.allLabel;

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  const openOnArrival = useCallback(() => {
    setSearch('');
    setOpen(true);
    trigger.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) close();
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [close, open]);

  function choose(value: string) {
    trigger.current?.focus({ preventScroll: true });
    close();
    if (value !== active) onChoose(value);
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
      trigger.current?.focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const choices = Array.from(optionsPanel.current?.querySelectorAll<HTMLButtonElement>('button:not([hidden])') ?? []);
    if (!choices.length) return;
    const index = choices.findIndex((choice) => choice === event.target);
    const nextIndex = event.key === 'ArrowDown' ? (index + 1) % choices.length : (Math.max(index, 0) - 1 + choices.length) % choices.length;
    if (open) choices[nextIndex]?.focus();
    else {
      setOpen(true);
      requestAnimationFrame(() => choices[nextIndex]?.focus());
    }
  }

  const terms = searchableText(search).split(' ').filter(Boolean);
  const options = [
    { id: '', name: field.allLabel, value: '', enSlug: '', zhSlug: undefined },
    ...(active && !activeOption ? [{ id: active, name: active, value: active, enSlug: '', zhSlug: undefined }] : []),
    ...field.options,
  ].map((option) => {
    const text = searchableText(`${option.name} ${option.enSlug} ${option.zhSlug ?? ''}`);
    return { ...option, matches: terms.every((term) => text.includes(term)) };
  });
  const matches = options.filter((option) => option.matches);

  return <div ref={container} className="filter-field filter-dropdown" data-catalog-filter={field.key}
    onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close(); }}
    onKeyDown={handleKeys}>
    <Suspense><OpenOnBrowse filter={field.key} onOpen={openOnArrival}/></Suspense>
    <span id={`${id}-label`}>{field.label}</span>
    <input type="hidden" name={field.key} value={active}/>
    <button ref={trigger} type="button" className="filter-dropdown-trigger" aria-expanded={open}
      aria-labelledby={`${id}-label ${id}-value`} aria-controls={`${id}-options`} onClick={() => open ? close() : setOpen(true)}>
      <span id={`${id}-value`}>{activeLabel}</span><ChevronDown size={18} aria-hidden="true"/>
    </button>
    <div ref={optionsPanel} id={`${id}-options`} className="filter-dropdown-options" role="group" aria-labelledby={`${id}-label`} hidden={!open}>
      <div className="filter-dropdown-search">
        <input type="search" aria-label={field.searchLabel} placeholder={field.searchLabel} value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            if (optionsPanel.current) optionsPanel.current.scrollTop = 0;
          }} onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (matches.length === 1) choose(matches[0]!.value);
          }}/>
      </div>
      {options.map(({ id, name, value, enSlug, zhSlug, matches }) => <button key={id} type="button" value={value} hidden={!matches} aria-pressed={value === active}
        data-en-slug={enSlug || undefined} data-zh-slug={zhSlug} onClick={() => choose(value)}>
        <span>{name}</span>{value === active && <Check size={17} aria-hidden="true"/>}
      </button>)}
      {matches.length === 0 && <p className="filter-dropdown-empty" role="status">{noMatches}</p>}
    </div>
  </div>;
}
