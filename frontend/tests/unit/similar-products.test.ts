import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSimilarProducts } from '../../lib/catalog-data';
import { homeProductSchema } from '../../lib/public-catalog';
import { product, list, catalogMeta, master } from '../catalog-fixtures';

vi.mock('next/cache', () => ({ unstable_cache: (callback: unknown) => callback }));
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('API_INTERNAL_BASE_URL', '');
});
const current = homeProductSchema.parse(product);
const otherMaster = { ...master, id: '4b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', slug: 'other', alternate_slugs: { en: 'other', zhCN: 'other-cn' } };
const sameGeneric = { ...product, id: '92f591d0-346b-4cc4-8d67-e25358fa0272' };
const sameCategory = { ...product, id: 'a2f591d0-346b-4cc4-8d67-e25358fa0272', generic: otherMaster };
const unrelated = { ...product, id: 'b2f591d0-346b-4cc4-8d67-e25358fa0272', generic: otherMaster, categories: [otherMaster] };
const response = (products: unknown[]) => Response.json({ success: true, data: { products, facets: list.facets }, meta: catalogMeta });

describe('similar published products', () => {
  it.each(['en', 'zh-CN'] as const)('uses %s master slugs, excludes the current/unrelated products and ranks generic matches first', async (locale) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => new URL(String(url)).searchParams.has('generic')
      ? response([product, sameCategory, sameGeneric, unrelated]) : response([sameGeneric, sameCategory, product]));
    vi.stubGlobal('fetch', fetcher);
    const result = await getSimilarProducts(locale, current);
    expect(result.products.map((item) => item.id)).toEqual([sameGeneric.id, sameCategory.id]);
    expect(result.unavailable).toBe(false);
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('generic')).toBe(locale === 'en' ? 'manufacturer' : 'manufacturer-cn');
    expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.get('category')).toBe(locale === 'en' ? 'manufacturer' : 'manufacturer-cn');
  });
  it('keeps category matches when the generic request is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (new URL(String(url)).searchParams.has('generic')) return new Response(null, { status: 503, headers: { 'Retry-After': '0' } });
      return response([sameCategory]);
    }));
    expect((await getSimilarProducts('en', current)).products.map((item) => item.id)).toEqual([sameCategory.id]);
  });
  it('distinguishes no published matches from a failed catalog request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response([product]));
    vi.stubGlobal('fetch', fetcher);
    expect(await getSimilarProducts('en', current)).toEqual({ products: [], unavailable: false });
    fetcher.mockImplementation(async () => new Response(null, { status: 503, headers: { 'Retry-After': '0' } }));
    expect(await getSimilarProducts('en', current)).toEqual({ products: [], unavailable: true });
  });
  it('caps a deduplicated preview at six products', async () => {
    const candidates = Array.from({ length: 7 }, (_, index) => ({ ...sameGeneric, id: `92f591d0-346b-4cc4-8d67-e25358fa028${index}` }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => response([...candidates, ...candidates])));
    const result = await getSimilarProducts('en', current);
    expect(result.products).toHaveLength(6);
    expect(new Set(result.products.map((item) => item.id)).size).toBe(6);
  });
});
