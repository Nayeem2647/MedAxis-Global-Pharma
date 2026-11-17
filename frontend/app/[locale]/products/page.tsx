import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale } from '../../../i18n/routing';
import { buildLocalizedMetadata } from '../../../lib/seo';
import { getProducts } from '../../../lib/catalog-data';
import { catalogQueryString, readCatalogQuery, type SearchValues } from '../../../lib/catalog-query';
import { ApiError } from '../../../lib/api-client';
import { ProductCard } from '../../../components/catalog/ProductCard';
import { CatalogGridShell } from '../../../components/catalog/CatalogGridShell';
import { Filters } from '../../../components/catalog/Filters';
import { Pagination } from '../../../components/catalog/Pagination';
import { CatalogState } from '../../../components/catalog/CatalogState';
import { Breadcrumbs } from '../../../components/catalog/Breadcrumbs';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchValues> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const { query, valid, hasParameters } = readCatalogQuery(await searchParams);
  let unavailable = !valid;
  if (valid) try { await getProducts(locale, catalogQueryString(query)); } catch { unavailable = true; }
  return buildLocalizedMetadata({ locale, enPath: '/en/products', zhPath: '/zh-CN/products', title: `${t('products')} | MedAxis Global Pharma`, description: t('catalogDescription'), noindex: hasParameters || unavailable });
}

export default async function ProductsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const { query, valid } = readCatalogQuery(await searchParams);
  const path = `/${locale}/products`;
  let data: Awaited<ReturnType<typeof getProducts>> | null = null;
  let error: unknown;
  try {
    if (!valid) throw new ApiError('Invalid filters.', { status: 400, code: 'INVALID_REQUEST' });
    data = await getProducts(locale, catalogQueryString(query));
  } catch (failure: unknown) { error = failure; }
  return <main id="main-content" className="catalog-page"><div className="site-container section">
    <Breadcrumbs locale={locale} entries={[{ name: t('products'), href: path }]}/>
    <div className="catalog-heading"><p className="eyebrow">MEDAXIS GLOBAL PHARMA</p><h1>{t('products')}</h1><p>{t('catalogDescription')}</p></div>
    <Filters locale={locale} path={path} query={query} facets={data?.facets ?? { dosage_forms: [], cold_chain: [] }}/>
    {data?.products.length ? <>
      <CatalogGridShell resultsLabel={t('results', { count: data.pagination.total_items })} viewLabel={t('viewMode')} gridLabel={t('gridView')} listLabel={t('listView')}>
        {data.products.map((product) => <ProductCard key={product.id} product={product} locale={locale}/>)}
      </CatalogGridShell>
      <Pagination locale={locale} path={path} query={query} pagination={data.pagination}/>
    </> : <>
      {data && <p className="results-count" role="status">{t('results', { count: data.pagination.total_items })}</p>}
      <CatalogState locale={locale} error={error} query={query.q} path={path}/>
    </>}
  </div></main>;
}
