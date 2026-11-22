import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '../../i18n/routing';
import type { z } from 'zod';
import type { paginationSchema } from '../../lib/api-client';
import { catalogPageHref, type CatalogQuery } from '../../lib/catalog-query';

export async function Pagination({ locale, path, query, pagination }: { locale: Locale; path: string; query: CatalogQuery; pagination: z.infer<typeof paginationSchema> }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const total = Math.max(1, pagination.total_pages);
  const current = Math.min(Math.max(1, pagination.page), total);
  const windowSize = 7;
  const start = Math.max(1, Math.min(current - Math.floor(windowSize / 2), total - windowSize + 1));
  const end = Math.min(total, start + windowSize - 1);
  const pages = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);

  return <nav className="pagination" aria-label={t('pagination')}>
    {pagination.has_prev && <Link className="button secondary pagination-nav" rel="prev" scroll={false} href={catalogPageHref(path, query, pagination.page - 1)}>{t('previous')}</Link>}
    <div className="pagination-pages">
      {pages.map((page) => (
        <Link
          key={page}
          className={`pagination-page${page === current ? ' is-active' : ''}`}
          aria-current={page === current ? 'page' : undefined}
          scroll={false}
          href={catalogPageHref(path, query, page)}
        >
          {page}
        </Link>
      ))}
    </div>
    <span className="pagination-summary">{t('pageOf', { page: pagination.page, pages: pagination.total_pages })}</span>
    {pagination.has_next && <Link className="button secondary pagination-nav" rel="next" scroll={false} href={catalogPageHref(path, query, pagination.page + 1)}>{t('next')}</Link>}
  </nav>;
}
