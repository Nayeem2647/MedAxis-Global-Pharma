import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../lib/api-client';
import { personalRatingSchema, readComparison, toggleComparison } from '../../lib/product-tools';
import { meta } from '../fixtures';

const items = [1, 2, 3, 4].map((number) => ({ id: `82f591d0-346b-4cc4-8d67-e25358fa027${number}`, name: `Product ${number}`, alternate_slugs: { en: `product-${number}`, zhCN: null } }));
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:4000'); vi.stubEnv('API_INTERNAL_BASE_URL', ''); });
describe('product comparison and rating boundaries', () => {
  it('limits a comparison to three distinct products and lets a selected product be removed', () => {
    let selected = toggleComparison([], items[0]);
    selected = toggleComparison(selected, items[1]); selected = toggleComparison(selected, items[2]);
    expect(() => toggleComparison(selected, items[3])).toThrow('COMPARISON_FULL');
    expect(toggleComparison(selected, items[0])).toEqual([items[1], items[2]]);
  });
  it('discards corrupt storage, duplicates, unsafe paths and oversized lists', () => {
    for (const value of ['broken', JSON.stringify({ version: 1, products: [...items] }), JSON.stringify({ version: 1, products: [items[0], items[0]] }), JSON.stringify({ version: 1, products: [{ ...items[0], alternate_slugs: { en: '../admin', zhCN: null } }] })]) expect(readComparison(value)).toEqual([]);
    expect(readComparison(JSON.stringify({ version: 1, products: items.slice(0, 3) }))).toEqual(items.slice(0, 3));
  });
  it('sends rating cookies only to rating endpoints and keeps their reads uncached', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: { average: 4.5, count: 2, my_rating: 5 }, meta }));
    vi.stubGlobal('fetch', fetcher);
    await apiRequest(`/v1/public/products/${items[0].id}/ratings`, personalRatingSchema, { ratingSession: true });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    await expect(apiRequest('/v1/public/cms/banners', personalRatingSchema, { ratingSession: true })).rejects.toThrow('restricted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
