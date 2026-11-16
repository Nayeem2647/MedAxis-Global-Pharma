import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '../../i18n/routing';
import { getMasterOptions, type MasterKind } from '../../lib/catalog-data';
import type { CatalogQuery } from '../../lib/catalog-query';
import type { CatalogFacets } from '../../lib/public-catalog';
import { CatalogForm } from './CatalogForm';

export async function Filters({ locale, path, query, facets, lockedKind }: { locale: Locale; path: string; query: CatalogQuery; facets: CatalogFacets; lockedKind?: MasterKind }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const kinds = ['manufacturers', 'generics', 'categories'] as const;
  const options = await Promise.all(kinds.map((kind) => kind === lockedKind ? Promise.resolve({ complete: true, options: [] }) : getMasterOptions(locale, kind)));
  const keyFor: Record<MasterKind, 'manufacturer' | 'generic' | 'category'> = { manufacturers: 'manufacturer', generics: 'generic', categories: 'category' };
  return <CatalogForm className="catalog-filters" action={path} key={JSON.stringify(query)} label={t('filters')} loadingLabel={t('loading')}>
    <label className="filter-search">{t('searchMedicines')}<input name="q" type="search" maxLength={100} defaultValue={query.q} placeholder={t('searchPlaceholder')}/></label>
    {kinds.map((kind, index) => {
      if (kind === lockedKind) return null;
      const key = keyFor[kind];
      const data = options[index];
      const values = data.options.map((item) => ({ ...item, value: locale === 'zh-CN' ? item.alternate_slugs.zhCN ?? item.alternate_slugs.en : item.alternate_slugs.en }));
      const available = data.complete && (!query[key] || values.some((item) => item.value === query[key]));
      return <label key={kind}>{t(key)}{available ? <select name={key} data-catalog-filter={key} defaultValue={query[key] ?? ''}><option value="">{t('all')}</option>{values.map((item) => <option value={item.value} data-en-slug={item.alternate_slugs.en} data-zh-slug={item.alternate_slugs.zhCN ?? undefined} key={item.id}>{item.name}</option>)}</select>
        : <><input name={key} defaultValue={query[key]} maxLength={200} placeholder={t('localizedSlug')}/><Link className="filter-directory" href={`/${locale}/${kind}`}>{t('browseDirectory', { kind: t(kind) })}</Link></>}</label>;
    })}
    <label>{t('dosageForm')}<select name="dosage_form" defaultValue={query.dosage_form ?? ''}><option value="">{t('all')}</option>{query.dosage_form && !facets.dosage_forms.some((facet) => facet.name === query.dosage_form) && <option value={query.dosage_form}>{query.dosage_form}</option>}{facets.dosage_forms.map((facet) => <option key={facet.name} value={facet.name}>{facet.name} ({facet.count})</option>)}</select></label>
    <label>{t('handling')}<select name="cold_chain" defaultValue={query.cold_chain ?? ''}><option value="">{t('all')}</option>{[true, false].filter((required) => facets.cold_chain.some((facet) => facet.required === required) || query.cold_chain === String(required)).map((required) => <option key={String(required)} value={String(required)}>{t(required ? 'coldChain' : 'standardHandling')} ({facets.cold_chain.find((facet) => facet.required === required)?.count ?? 0})</option>)}</select></label>
    <label>{t('perPage')}<select name="limit" defaultValue={query.limit}>{[...new Set([20, 40, 100, query.limit])].sort((a, b) => a - b).map((limit) => <option key={limit}>{limit}</option>)}</select></label>
    <div className="filter-actions"><button className="button primary" type="submit">{t('applyFilters')}</button><Link className="button secondary" href={path}>{t('clearFilters')}</Link></div>
  </CatalogForm>;
}
