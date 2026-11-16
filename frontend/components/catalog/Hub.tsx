import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale } from '../../i18n/routing';
import { ApiError } from '../../lib/api-client';
import { getMaster, type MasterKind } from '../../lib/catalog-data';
import { normalizeCatalogSlug } from '../../lib/catalog-path';
import { catalogQueryString, readCatalogQuery, type SearchValues } from '../../lib/catalog-query';
import { entityMetadata } from '../../lib/catalog-seo';
import { Breadcrumbs } from './Breadcrumbs';
import { CatalogState } from './CatalogState';
import { Filters } from './Filters';
import { ProductCard } from './ProductCard';
import { Pagination } from './Pagination';

export type HubProps = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<SearchValues> };
export async function hubMetadata({ params, searchParams }: HubProps, kind: MasterKind): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params;
  const slug = normalizeCatalogSlug(rawSlug);
  if (!isLocale(locale) || !slug) notFound();
  const { query, hasParameters, valid } = readCatalogQuery(await searchParams);
  if (!valid) return { robots: { index: false, follow: true } };
  try { return entityMetadata(locale, kind, slug, (await getMaster(locale, kind, slug, catalogQueryString(query))).profile, hasParameters); }
  catch (error: unknown) { if (error instanceof ApiError && error.status === 404) notFound(); return { title: 'MedAxis Global Pharma', robots: { index: false, follow: true } }; }
}

export async function Hub({ params, searchParams, kind }: HubProps & { kind: MasterKind }) {
  const { locale, slug: rawSlug } = await params;
  const slug = normalizeCatalogSlug(rawSlug);
  if (!isLocale(locale) || !slug) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const { query, valid } = readCatalogQuery(await searchParams);
  const path = `/${locale}/${kind}/${encodeURIComponent(slug)}`;
  let result: Awaited<ReturnType<typeof getMaster>>;
  try {
    if (!valid) throw new ApiError('Invalid filters.', { status: 400, code: 'INVALID_REQUEST' });
    result = await getMaster(locale, kind, slug, catalogQueryString(query));
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <main id="main-content" className="section site-container"><CatalogState locale={locale} error={error} path={path}/></main>;
  }
  const { profile, pagination } = result;
  return <main id="main-content" className="catalog-page"><div className="section site-container">
    <Breadcrumbs locale={locale} entries={[{ name: t(kind), href: `/${locale}/${kind}` }, { name: profile.name, href: path }]}/>
    <header className="catalog-heading"><p className="eyebrow">{t(kind)}</p><h1>{profile.name}</h1>{profile.description && <p>{profile.description}</p>}</header>
    {locale === 'zh-CN' && profile.alternate_slugs.zhCN === null && <p className="translation-notice">{t('untranslated')}</p>}
    {profile.country && <p className="profile-country">{t('country')}: {profile.country}</p>}
    {profile.certifications && profile.certifications.length > 0 && <section className="profile-facts"><h2>{t('certifications')}</h2><ul>{profile.certifications.map((value) => <li key={value}>{value}</li>)}</ul></section>}
    {profile.therapeutic_indications && profile.therapeutic_indications.length > 0 && <section className="profile-facts"><h2>{t('indications')}</h2><ul>{profile.therapeutic_indications.map((value) => <li key={value}>{value}</li>)}</ul></section>}
    <p className="medical-notice">{t('medicalNotice')}</p>
    <Filters locale={locale} path={path} query={query} facets={profile.facets} lockedKind={kind}/><p className="results-count" role="status">{t('results', { count: pagination.total_items })}</p>
    {profile.products.length ? <><div className="product-grid">{profile.products.map((product) => <ProductCard key={product.id} product={product} locale={locale}/>)}</div><Pagination locale={locale} path={path} query={query} pagination={pagination}/></> : <CatalogState locale={locale} query={query.q} path={path}/>}
  </div></main>;
}
