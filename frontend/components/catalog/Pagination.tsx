import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '../../i18n/routing';
import type { z } from 'zod';
import type { paginationSchema } from '../../lib/api-client';
import { catalogPageHref, type CatalogQuery } from '../../lib/catalog-query';

export async function Pagination({ locale, path, query, pagination }: { locale: Locale; path: string; query: CatalogQuery; pagination: z.infer<typeof paginationSchema> }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  return <nav className="pagination" aria-label={t('pagination')}>
    {pagination.has_prev && <Link className="button secondary" rel="prev" href={catalogPageHref(path, query, pagination.page - 1)}>{t('previous')}</Link>}
    <span>{t('pageOf', { page: pagination.page, pages: pagination.total_pages })}</span>
    {pagination.has_next && <Link className="button secondary" rel="next" href={catalogPageHref(path, query, pagination.page + 1)}>{t('next')}</Link>}
  </nav>;
}
