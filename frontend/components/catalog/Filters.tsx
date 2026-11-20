import Link from 'next/link';
import { Search } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '../../i18n/routing';
import { getFilterOptions, type MasterKind } from '../../lib/catalog-data';
import type { CatalogQuery } from '../../lib/catalog-query';
import type { CatalogFacets } from '../../lib/public-catalog';
import { CatalogForm } from './CatalogForm';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export async function Filters({ locale, path, query, lockedKind }: { locale: Locale; path: string; query: CatalogQuery; facets?: CatalogFacets; lockedKind?: MasterKind }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const kinds = ['manufacturers', 'categories', 'generics'] as const;
  const options = await Promise.all(kinds.map((kind) => kind === lockedKind ? Promise.resolve([]) : getFilterOptions(locale, kind)));
  const config: Record<MasterKind, { key: 'manufacturer' | 'category' | 'generic'; label: string; allLabel: string }> = {
    manufacturers: { key: 'manufacturer', label: t('filterManufacturer'), allLabel: t('allManufacturers') },
    categories: { key: 'category', label: t('filterCategory'), allLabel: t('allCategories') },
    generics: { key: 'generic', label: t('filterGeneric'), allLabel: t('allGenerics') },
  };
  const activeLetter = query.q?.trim().length === 1 ? query.q.trim().toUpperCase() : null;

  function letterHref(letter?: string) {
    const params = new URLSearchParams();
    if (letter) params.set('q', letter);
    if (query.manufacturer) params.set('manufacturer', query.manufacturer);
    if (query.category) params.set('category', query.category);
    if (query.generic) params.set('generic', query.generic);
    if (query.dosage_form) params.set('dosage_form', query.dosage_form);
    if (query.cold_chain) params.set('cold_chain', query.cold_chain);
    if (query.limit !== 20) params.set('limit', String(query.limit));
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }

  return <CatalogForm className="catalog-filters" action={path} key={JSON.stringify(query)} label={t('filters')} loadingLabel={t('loading')} autoSubmitOnSelect>
    {query.dosage_form && <input type="hidden" name="dosage_form" value={query.dosage_form}/>}
    {query.cold_chain && <input type="hidden" name="cold_chain" value={query.cold_chain}/>}
    {query.limit !== 20 && <input type="hidden" name="limit" value={String(query.limit)}/>}

    <div className={`filter-primary${lockedKind ? ' is-locked' : ''}`}>
      {kinds.map((kind, index) => {
        if (kind === lockedKind) return null;
        const { key, label, allLabel } = config[kind];
        const items = options[index];
        const values = items.map((item) => ({
          ...item,
          value: locale === 'zh-CN' ? item.alternate_slugs.zhCN ?? item.alternate_slugs.en : item.alternate_slugs.en,
        }));
        const activeValue = query[key];
        const hasActiveInList = !activeValue || values.some((item) => item.value === activeValue);

        return <label key={kind} className="filter-field">
          <span>{label}</span>
          <select name={key} data-catalog-filter={key} defaultValue={activeValue ?? ''}>
            <option value="">{allLabel}</option>
            {!hasActiveInList && activeValue && <option value={activeValue}>{activeValue}</option>}
            {values.map((item) => (
              <option value={item.value} data-en-slug={item.alternate_slugs.en} data-zh-slug={item.alternate_slugs.zhCN ?? undefined} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>;
      })}
      <div className="filter-field filter-search">
        <label htmlFor="catalog-filter-q">{t('filterSearch')}</label>
        <div className="filter-search-box filter-actions">
          <input id="catalog-filter-q" name="q" type="search" maxLength={100} defaultValue={query.q} placeholder={t('searchProductsPlaceholder')}/>
          <button className="filter-search-submit" type="submit" aria-label={t('searchCatalog')}>
            <Search size={18} aria-hidden="true"/>
          </button>
        </div>
      </div>
    </div>

    <nav className="filter-alpha" aria-label={t('alphabetFilter')}>
      <Link href={letterHref(undefined)} className={`alpha-pill alpha-all${!query.q ? ' is-active' : ''}`} aria-current={!query.q ? 'true' : undefined}>
        {t('all')}
      </Link>
      {alphabet.map((letter) => {
        const active = activeLetter === letter;
        return <Link key={letter} href={letterHref(active ? undefined : letter)} className={`alpha-pill${active ? ' is-active' : ''}`} aria-current={active ? 'true' : undefined}>
          {letter}
        </Link>;
      })}
    </nav>
  </CatalogForm>;
}
