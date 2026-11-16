import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiRedirect, apiRequest } from '../../lib/api-client';
import { catalogEntityPath, normalizeCatalogSlug, validateCatalogRedirect } from '../../lib/catalog-path';
import { catalogQuerySchema, catalogQueryString, catalogPageHref, readCatalogQuery } from '../../lib/catalog-query';
import { homeProductSchema, catalogListSchema } from '../../lib/public-catalog';
import { buildLocalizedMetadata } from '../../lib/seo';
import { productStructuredData, serializeStructuredData } from '../../lib/catalog-seo';
import { localizedCatalogSearch } from '../../lib/locale-navigation';
import { product, list, catalogMeta } from '../catalog-fixtures';

vi.mock('next/cache', () => ({ unstable_cache: (callback: unknown) => callback }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('API_INTERNAL_BASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://medaxisglobalpharma.com');
});

describe('allowlisted catalog boundaries', () => {
  it('strips nested commercial/admin data and renders rich content only as plain text', () => {
    const parsed = homeProductSchema.parse({ ...product, unit_price: 'PRIVATE', internal_notes: 'PRIVATE', description: '<p>Public</p><script>execute()</script><img src=x onerror=execute()>',
      manufacturer: { ...product.manufacturer, procurement_cost_bdt: 'PRIVATE' }, alternate_slugs: { en: 'medicine', zhCN: null }, translations: { en: { ...product.translations.en, margin: 'PRIVATE' } } });
    expect(parsed.description).toBe('Public');
    expect(JSON.stringify(parsed)).not.toMatch(/PRIVATE|execute|onerror|unit_price|margin|procurement/);
    const parsedList = catalogListSchema.parse({ ...list, facets: { ...list.facets, price_ranges: ['PRIVATE'] } });
    expect(JSON.stringify(parsedList)).not.toContain('PRIVATE');
  });
  it.each([{ id: undefined, _id: product.id }, { locale: 'zhCN' }, { image_urls: ['javascript:alert(1)'] }, { cold_chain_required: 'false' }, { translations: {} }])('rejects malformed public identity or fields: %j', (override) => {
    expect(homeProductSchema.safeParse({ ...product, ...override }).success).toBe(false);
  });
  it('preserves actual optional clinical text without inventing Rx/review data', () => {
    const parsed = homeProductSchema.parse({ ...product, storage_condition: 'Manufacturer instructions', indication_summary: '<strong>Provided context</strong>', prescription_required: true, reviewed_at: 'PRIVATE' });
    expect(parsed.indication_summary).toBe('Provided context');
    expect(parsed.storage_condition).toBe('Manufacturer instructions');
    expect(parsed).not.toHaveProperty('prescription_required');
    expect(parsed).not.toHaveProperty('reviewed_at');
  });
});

describe('queries and pagination', () => {
  it('omits blank filters and never forwards unsupported sorting/price keys', () => {
    const parsed = readCatalogQuery({ q: '  ', manufacturer: '', page: '2', sort: 'price', featured: 'true', currency: 'USD' });
    expect(parsed.valid).toBe(true);
    expect(catalogQueryString(parsed.query)).toBe('page=2&limit=20');
    expect(parsed.hasParameters).toBe(true);
  });
  it.each([{ limit: '101' }, { page: '0' }, { q: 'x'.repeat(101) }, { manufacturer: '/admin' }, { cold_chain: 'yes' }, { q: ['a', 'b'] }])('rejects invalid filter %j', (query) => {
    expect(readCatalogQuery(query).valid).toBe(false);
  });
  it('encodes query values, retains false and preserves filters while paginating', () => {
    const query = catalogQuerySchema.parse({ q: '药品 & tablets', category: '肿瘤科', cold_chain: 'false', limit: 1 });
    const href = catalogPageHref('/zh-CN/products', query, 2);
    const url = new URL(href, 'https://example.test');
    expect(url.searchParams.get('q')).toBe('药品 & tablets');
    expect(url.searchParams.get('category')).toBe('肿瘤科');
    expect(url.searchParams.get('cold_chain')).toBe('false');
    expect(url.searchParams.get('page')).toBe('2');
  });
  it('translates known slug filters, resets pagination and drops unresolvable filters', () => {
    const query = localizedCatalogSearch('?manufacturer=beacon&category=unlisted&page=4&q=Medicine&ref=email', 'zh-CN', [{ field: 'manufacturer', en: 'beacon', zhCN: 'beacon-cn' }]);
    const parameters = new URLSearchParams(query);
    expect(parameters.get('manufacturer')).toBe('beacon-cn');
    expect(parameters.has('category')).toBe(false);
    expect(parameters.has('page')).toBe(false);
    expect(parameters.get('q')).toBe('Medicine');
    expect(parameters.get('ref')).toBe('email');
  });
  it('bounds static generation and does not build a partial complete picker for a large feed', async () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({ en: `item-${index}`, zhCN: null, updated_at: catalogMeta.timestamp }));
    const feed = { products: entries, manufacturers: entries.slice(0, 13), generics: [], categories: [] };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const data = url.pathname.endsWith('sitemap-catalog') ? feed : { ...product.manufacturer, slug: 'item-12', alternate_slugs: { en: 'item-12', zhCN: null }, products: [], facets: list.facets };
      return Response.json({ success: true, data, meta: { ...catalogMeta, pagination: { ...catalogMeta.pagination, limit: 1 } } });
    });
    vi.stubGlobal('fetch', fetcher);
    const { getMasterOptions, getDirectory, catalogStaticParams } = await import('../../lib/catalog-data');
    expect(await getMasterOptions('en', 'manufacturers')).toEqual({ complete: false, options: [] });
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('/sitemap-catalog'))).toBe(true);
    expect(await catalogStaticParams('products', 'en')).toHaveLength(12);
    expect(await catalogStaticParams('products', 'zh-CN')).toEqual([]);
    const directory = await getDirectory('en', 'manufacturers', 2);
    expect(directory.profiles).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/manufacturers/'))).toHaveLength(1);
  });
  it('validates real facets and envelope pagination before consumption', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: list, meta: { ...catalogMeta, internal_notes: 'PRIVATE' } }));
    vi.stubGlobal('fetch', fetcher);
    const { getProducts } = await import('../../lib/catalog-data');
    const result = await getProducts('zh-CN', 'page=1&limit=20');
    expect(result.pagination.total_items).toBe(1);
    expect(result.facets.cold_chain[0]).toEqual({ required: false, count: 1 });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('locale')).toBe('zh-CN');
    fetcher.mockResolvedValue(Response.json({ success: true, data: list, meta: { ...catalogMeta, pagination: undefined } }));
    await expect(getProducts('en', 'page=2&limit=1')).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });
});

describe('exact counterparts and safe structured data', () => {
  it('decodes framework Unicode parameters once while rejecting escaped path separators', () => {
    expect(normalizeCatalogSlug(encodeURIComponent('奥希替尼-80mg'))).toBe('奥希替尼-80mg');
    for (const value of ['%2fadmin', '%252fadmin', '%ZZ', '../admin']) expect(normalizeCatalogSlug(value)).toBeNull();
  });
  it('rejects contradictory translation and alternate identities', () => {
    expect(homeProductSchema.safeParse({ ...product, alternate_slugs: { en: 'unrelated', zhCN: 'medicine-cn' } }).success).toBe(false);
  });
  it('never waits for an unfinished cancellation branch to sanitize proxy HTML', async () => {
    const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 403, headers: { 'Content-Type': 'text/html' } })));
    await expect(apiRequest('/v1/public/products', catalogListSchema)).rejects.toMatchObject({ status: 403, code: 'ACCESS_DENIED' });
  });
  it('supports an English entity with no translated hreflang', () => {
    const metadata = buildLocalizedMetadata({ locale: 'en', enPath: '/en/products/medicine', zhPath: null, title: 'Medicine', description: 'Info' });
    expect(metadata.alternates?.languages).toEqual({ en: 'https://medaxisglobalpharma.com/en/products/medicine', 'x-default': 'https://medaxisglobalpharma.com/en/products/medicine' });
  });
  it('keeps the direct untranslated Chinese path self-canonical and noindex', () => {
    const metadata = buildLocalizedMetadata({ locale: 'zh-CN', enPath: '/en/products/medicine', zhPath: null, currentPath: '/zh-CN/products/medicine', title: 'Medicine', description: 'Info' });
    expect(metadata.alternates?.canonical).toBe('https://medaxisglobalpharma.com/zh-CN/products/medicine');
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.languages).not.toHaveProperty('zh-CN');
    expect(() => buildLocalizedMetadata({ locale: 'zh-CN', enPath: '/en/products/medicine', zhPath: null, title: '', description: '' })).toThrow();
    expect(catalogEntityPath('zh-CN', 'products', { en: 'medicine', zhCN: null })).toBe('/en/products/medicine');
  });
  it('projects truthful identity/specifications and safely serializes script terminators', () => {
    const schema = productStructuredData(homeProductSchema.parse({ ...product, unit_price: 'PRIVATE', description: '</script><script>execute()</script>' }), 'en', []);
    expect(schema.activeIngredient).toBe('Manufacturer');
    expect(schema.dosageForm).toBe('Tablet');
    expect(JSON.stringify(schema)).not.toMatch(/PRIVATE|price|Offer|rating|review/i);
    expect(serializeStructuredData({ name: '</script><script>execute()</script>' })).not.toContain('<');
  });
});

describe('catalog 301 handling', () => {
  it('surfaces one validated manual 301 without retrying or following it', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 301, headers: { Location: '/zh-CN/products/medicine-cn' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest('/v1/public/products/old?locale=zh-CN', homeProductSchema, { catalogRedirect: { sourcePath: '/zh-CN/products/old' } })).rejects.toBeInstanceOf(ApiRedirect);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });
  it.each(['https://evil.test/en/products/new', '/admin/login', '/en/generics/new', '/en/products/old', '/en/products/new?unsafe=1'])('rejects a corrupt redirect without a retry: %s', async (target) => {
    expect(validateCatalogRedirect('/en/products/old', target)).toBeNull();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 301, headers: { Location: target } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest('/v1/public/products/old?locale=en', homeProductSchema, { catalogRedirect: { sourcePath: '/en/products/old' } })).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
