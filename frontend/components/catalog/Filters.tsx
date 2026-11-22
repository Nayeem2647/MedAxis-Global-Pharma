import { getTranslations } from 'next-intl/server';
import type { Locale } from '../../i18n/routing';
import { getFilterOptions, type MasterKind } from '../../lib/catalog-data';
import type { CatalogQuery } from '../../lib/catalog-query';
import type { CatalogFacets } from '../../lib/public-catalog';
import { CatalogFilters, type CatalogFilterField } from './CatalogFilters';

export async function Filters({ locale, path, query, lockedKind }: { locale: Locale; path: string; query: CatalogQuery; facets?: CatalogFacets; lockedKind?: MasterKind }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const kinds = ['manufacturers', 'categories', 'generics'] as const;
  const options = await Promise.all(kinds.map((kind) => kind === lockedKind ? Promise.resolve([]) : getFilterOptions(locale, kind)));
  const config: Record<MasterKind, { key: 'manufacturer' | 'category' | 'generic'; label: string; allLabel: string }> = {
    manufacturers: { key: 'manufacturer', label: t('filterManufacturer'), allLabel: t('allManufacturers') },
    categories: { key: 'category', label: t('filterCategory'), allLabel: t('allCategories') },
    generics: { key: 'generic', label: t('filterGeneric'), allLabel: t('allGenerics') },
  };
  const fields: CatalogFilterField[] = kinds.flatMap((kind, index) => kind === lockedKind ? [] : [{
    ...config[kind],
    options: options[index].map((item) => ({
      id: item.id, name: item.name,
      value: locale === 'zh-CN' ? item.alternate_slugs.zhCN ?? item.alternate_slugs.en : item.alternate_slugs.en,
      enSlug: item.alternate_slugs.en,
      zhSlug: item.alternate_slugs.zhCN ?? undefined,
    })),
  }]);
  return <CatalogFilters key={path} path={path} query={query} fields={fields} locked={Boolean(lockedKind)} labels={{
    filters: t('filters'), search: t('filterSearch'), placeholder: t('searchProductsPlaceholder'),
    submit: t('searchCatalog'), alphabet: t('alphabetFilter'), all: t('all'), loading: t('loading'),
  }}/>;
}
