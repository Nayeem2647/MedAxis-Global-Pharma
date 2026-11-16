import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale } from '../../i18n/routing';
import { getDirectory, profileHref, type MasterKind } from '../../lib/catalog-data';
import { readCatalogQuery, type SearchValues } from '../../lib/catalog-query';
import { buildLocalizedMetadata } from '../../lib/seo';
import { Breadcrumbs } from './Breadcrumbs';
import { CatalogState } from './CatalogState';
import { Pagination } from './Pagination';

export type DirectoryProps = { params: Promise<{ locale: string }>; searchParams: Promise<SearchValues> };
export async function directoryMetadata({ params, searchParams }: DirectoryProps, kind: MasterKind): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  return buildLocalizedMetadata({ locale, enPath: `/en/${kind}`, zhPath: `/zh-CN/${kind}`, title: `${t(kind)} | MedAxis Global Pharma`, description: t('directoryDescription'), noindex: readCatalogQuery(await searchParams).hasParameters });
}

export async function Directory({ params, searchParams, kind }: DirectoryProps & { kind: MasterKind }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const { query, valid } = readCatalogQuery(await searchParams);
  const path = `/${locale}/${kind}`;
  let data: Awaited<ReturnType<typeof getDirectory>>;
  try { if (!valid) throw new Error('Invalid page.'); data = await getDirectory(locale, kind, query.page); }
  catch (error: unknown) { return <main id="main-content" className="section site-container"><CatalogState locale={locale} error={error} path={path}/></main>; }
  return <main id="main-content" className="section site-container"><Breadcrumbs locale={locale} entries={[{ name: t(kind), href: path }]}/><header className="catalog-heading"><p className="eyebrow">MEDAXIS GLOBAL PHARMA</p><h1>{t(kind)}</h1><p>{t('directoryDescription')}</p></header>
    {data.incomplete && <p role="status" className="translation-notice">{t('partialDirectory')}</p>}
    {data.profiles.length ? <div className="directory-grid">{data.profiles.map((profile) => <article key={profile.id}><h2><Link href={profileHref(locale, kind, profile)}>{profile.name}</Link></h2>{profile.description && <p>{profile.description}</p>}{locale === 'zh-CN' && !profile.alternate_slugs.zhCN && <p className="small muted">{t('englishProfile')}</p>}<Link className="text-button" href={profileHref(locale, kind, profile)}>{t('viewProfile')}</Link></article>)}</div> : <CatalogState locale={locale} path={path}/>}
    <Pagination locale={locale} path={path} query={{ page: query.page, limit: 12 }} pagination={data.pagination}/>
  </main>;
}
