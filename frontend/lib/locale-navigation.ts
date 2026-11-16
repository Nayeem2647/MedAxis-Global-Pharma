import type { Locale } from '../i18n/routing';
import { publicLocalePath } from './seo';

export function counterpartPath(locale: Locale, pathname: string, provided?: string): string {
  const explicit = provided ? publicLocalePath(provided, locale) : null;
  return explicit ?? pathname.replace(/^\/(en|zh-CN)(?=\/|$)/, `/${locale}`);
}

export interface CatalogLocaleFilter { field: 'manufacturer' | 'generic' | 'category'; en: string; zhCN: string | null }
export function localizedCatalogSearch(search: string, locale: Locale, filters: readonly CatalogLocaleFilter[]): string {
  const parameters = new URLSearchParams(search);
  for (const field of ['manufacturer', 'generic', 'category'] as const) {
    const value = parameters.get(field);
    if (!value) continue;
    const pair = filters.find((filter) => filter.field === field && (filter.en === value || filter.zhCN === value));
    const translated = locale === 'en' ? pair?.en : pair?.zhCN;
    if (translated) parameters.set(field, translated); else parameters.delete(field);
    parameters.delete('page');
  }
  const query = parameters.toString();
  return query ? `?${query}` : '';
}
