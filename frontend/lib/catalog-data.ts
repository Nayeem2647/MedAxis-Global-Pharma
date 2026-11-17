import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { ApiError, apiRequest, paginationSchema } from './api-client';
import { catalogEntityPath, slugSchema, type CatalogKind } from './catalog-path';
import { catalogQueryString, catalogQuerySchema, type CatalogQuery } from './catalog-query';
import { catalogListSchema, homeProductSchema, masterDetailSchema, masterSchema, type CatalogMaster } from './public-catalog';
import { getSitemapCatalog } from './sitemap';
import type { Locale } from '../i18n/routing';

export type MasterKind = Exclude<CatalogKind, 'products'>;
export const directoryPageSize = 12;
const catalogCache = { revalidate: 3600, tags: ['catalog'] };

function pagination(value: unknown) {
  const parsed = paginationSchema.safeParse(value);
  if (!parsed.success) throw new ApiError('Catalog pagination is unavailable.', { status: 200, code: 'INVALID_API_RESPONSE' });
  return parsed.data;
}

export const getProducts = cache(async (locale: Locale, serialized: string) => {
  const query = catalogQuerySchema.parse(Object.fromEntries(new URLSearchParams(serialized)));
  const path = `/v1/public/products?${catalogQueryString(query)}&locale=${locale}`;
  const filtered = query.page !== 1 || query.limit !== 20 || Boolean(query.q || query.manufacturer || query.generic || query.category || query.dosage_form || query.cold_chain);
  const response = await apiRequest(path, catalogListSchema, filtered ? { cache: 'no-store' } : { next: catalogCache });
  return { ...response.data, pagination: pagination(response.meta.pagination) };
});

export const getProduct = cache(async (locale: Locale, slug: string) => {
  slugSchema.parse(slug);
  const sourcePath = `/${locale}/products/${encodeURIComponent(slug)}`;
  const response = await apiRequest(`/v1/public/products/${encodeURIComponent(slug)}?locale=${locale}`, homeProductSchema, { next: catalogCache, catalogRedirect: { sourcePath } });
  if (response.data.slug !== slug) throw new ApiError('Catalog identity does not match this URL.', { status: 200, code: 'INVALID_API_RESPONSE' });
  return response.data;
});

export const getMaster = cache(async (locale: Locale, kind: MasterKind, slug: string, serialized: string) => {
  slugSchema.parse(slug);
  const query = catalogQuerySchema.parse(Object.fromEntries(new URLSearchParams(serialized)));
  const filtered = query.page !== 1 || Boolean(query.q || query.manufacturer || query.generic || query.category || query.dosage_form || query.cold_chain);
  const response = await apiRequest(`/v1/public/${kind}/${encodeURIComponent(slug)}?${catalogQueryString(query)}&locale=${locale}`, masterDetailSchema, {
    ...(filtered ? { cache: 'no-store' } : { next: catalogCache }), catalogRedirect: { sourcePath: `/${locale}/${kind}/${encodeURIComponent(slug)}` },
  });
  if (response.data.slug !== slug) throw new ApiError('Catalog identity does not match this URL.', { status: 200, code: 'INVALID_API_RESPONSE' });
  return { profile: response.data, pagination: pagination(response.meta.pagination) };
});

async function mapBounded<T, U>(items: readonly T[], mapper: (item: T) => Promise<U>): Promise<PromiseSettledResult<U>[]> {
  const results: PromiseSettledResult<U>[] = [];
  for (let index = 0; index < items.length; index += 4) results.push(...await Promise.allSettled(items.slice(index, index + 4).map(mapper)));
  return results;
}

export const getDirectory = cache(async (locale: Locale, kind: MasterKind, page: number) => {
  const feed = await getSitemapCatalog();
  const entries = feed[kind];
  const selected = entries.slice((page - 1) * directoryPageSize, page * directoryPageSize);
  const profiles = await mapBounded(selected, async (entry) => {
    const result = await getMaster(locale, kind, locale === 'zh-CN' ? entry.zhCN ?? entry.en : entry.en, 'page=1&limit=1');
    // Project only public profile fields, not the nested product preview or meta.
    return masterSchema.parse(result.profile);
  });
  const totalPages = Math.max(1, Math.ceil(entries.length / directoryPageSize));
  return {
    profiles: profiles.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
    incomplete: profiles.some((result) => result.status === 'rejected'),
    pagination: { page, limit: directoryPageSize, total_items: entries.length, total_pages: totalPages, has_prev: page > 1, has_next: page < totalPages },
  };
});

// Only a fully resolved small feed becomes a complete picker. Larger catalogs
// retain slug inputs plus paginated directories, never a partial "all" selector.
export const getMasterOptions = unstable_cache(async (locale: Locale, kind: MasterKind): Promise<{ complete: boolean; options: CatalogMaster[] }> => {
  try {
    const feed = await getSitemapCatalog();
    if (feed[kind].length > directoryPageSize) return { complete: false, options: [] };
    const directory = await getDirectory(locale, kind, 1);
    return { complete: !directory.incomplete, options: directory.incomplete ? [] : directory.profiles };
  } catch { return { complete: false, options: [] }; }
}, ['public-master-options-v1'], catalogCache);

export const getFilterOptions = cache(async (locale: Locale, kind: MasterKind): Promise<CatalogMaster[]> => {
  try {
    const feed = await getSitemapCatalog();
    const entries = feed[kind].slice(0, 60);
    const profiles = await mapBounded(entries, async (entry) => {
      const result = await getMaster(locale, kind, locale === 'zh-CN' ? entry.zhCN ?? entry.en : entry.en, 'page=1&limit=1');
      return masterSchema.parse(result.profile);
    });
    return profiles.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  } catch { return []; }
});

export async function catalogStaticParams(kind: CatalogKind, locale: Locale) {
  try {
    const feed = await getSitemapCatalog();
    return feed[kind].slice(0, 12).flatMap((entry) => {
      const slug = locale === 'en' ? entry.en : entry.zhCN;
      return slug ? [{ slug }] : [];
    });
  } catch { return []; }
}

export const profileHref = (locale: Locale, kind: MasterKind, profile: CatalogMaster) => catalogEntityPath(locale, kind, profile.alternate_slugs);
export const defaultCatalogQuery: CatalogQuery = catalogQuerySchema.parse({});
