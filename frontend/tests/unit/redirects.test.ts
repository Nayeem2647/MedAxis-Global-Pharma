import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LruCache } from '../../lib/lru-cache';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('API_INTERNAL_BASE_URL', '');
});

describe('historical redirect lookup', () => {
  it('uses manual REST redirects and caches positive results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 301, headers: { location: '/zh-CN/products/current' } }));
    vi.stubGlobal('fetch', fetcher);
    const { findHistoricalRedirect } = await import('../../lib/redirects');
    await expect(findHistoricalRedirect('/zh-CN/products/old')).resolves.toBe('/zh-CN/products/current');
    await expect(findHistoricalRedirect('/zh-CN/products/old')).resolves.toBe('/zh-CN/products/current');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.example.test/v1/public/products/old?locale=zh-CN');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it.each(['https://evil.test/en/products/new', '//evil.test/new', '/admin/login', '/en/products/old', '/en/products/%6fld', '/en/products/new?unsafe=1', '/en/generics/new', '/en/products/%2fadmin'])('rejects unsafe or looping Location: %s', async (location) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 301, headers: { location } })));
    const { findHistoricalRedirect } = await import('../../lib/redirects');
    await expect(findHistoricalRedirect('/en/products/old')).resolves.toBeNull();
  });

  it('fails open on network problems and does not cache transient failures or live paths', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/en/products/new' } }));
    vi.stubGlobal('fetch', fetcher);
    const { findHistoricalRedirect } = await import('../../lib/redirects');
    await expect(findHistoricalRedirect('/en/products/old')).resolves.toBeNull();
    await expect(findHistoricalRedirect('/en/products/old')).resolves.toBeNull();
    await expect(findHistoricalRedirect('/en/products/old')).resolves.toBe('/en/products/new');
  });

  it('coalesces simultaneous lookups and caches confirmed missing paths', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    const { findHistoricalRedirect } = await import('../../lib/redirects');
    await Promise.all([findHistoricalRedirect('/en/products/missing'), findHistoricalRedirect('/en/products/missing')]);
    await findHistoricalRedirect('/en/products/missing');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it('evicts the least recently used entry and expires after one hour without sliding the TTL', () => {
  let now = 0;
  const cache = new LruCache<string, string>(2, 3_600_000, () => now);
  cache.set('a', 'A'); cache.set('b', 'B');
  expect(cache.get('a')).toBe('A');
  cache.set('c', 'C');
  expect(cache.get('b')).toBeUndefined();
  now = 3_599_999;
  expect(cache.get('a')).toBe('A');
  now = 3_600_000;
  expect(cache.get('a')).toBeUndefined();
});
