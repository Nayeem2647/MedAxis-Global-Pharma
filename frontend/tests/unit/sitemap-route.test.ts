import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '../../app/sitemap.xml/route';
import { meta, sitemapCatalog } from '../fixtures';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('API_INTERNAL_BASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://medaxisglobalpharma.com');
});

it('fetches the Express published feed with a catalog ISR tag and emits XML', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: sitemapCatalog, meta }));
  vi.stubGlobal('fetch', fetcher);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/xml');
  expect(String(fetcher.mock.calls[0][0])).toBe('https://api.example.test/v1/public/sitemap-catalog');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ next: { tags: ['catalog'], revalidate: 3600 } });
});

it('returns an uncached 503 for a broken feed instead of publishing an empty sitemap', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ unexpected: true })));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
