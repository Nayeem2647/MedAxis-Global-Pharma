import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Pill } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import { ApiError, ApiRedirect } from '../../lib/api-client';
import { QuoteButton } from '../layout/PublicShell';

export async function CatalogState({ locale, error, query, path }: { locale: Locale; error?: unknown; query?: string; path: string }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const moved = error instanceof ApiRedirect;
  const key = moved ? 'moved' : error instanceof ApiError && error.status === 429 ? 'rateLimited' : error instanceof ApiError && error.status === 400 ? 'invalidFilters' : error ? 'unavailable' : 'empty';
  return <div className="catalog-state" role={error ? 'status' : undefined}><Pill size={35}/><h2>{t(key)}</h2><p>{t(error ? 'tryAgainHelp' : 'emptyHelp')}</p>
    <div className="state-actions"><QuoteButton initialName={query}>{t('sendRequirement')}</QuoteButton><Link className="button secondary" href={moved ? error.location : path}>{t(moved ? 'openCurrent' : error ? 'tryAgain' : 'clearFilters')}</Link></div>
  </div>;
}
