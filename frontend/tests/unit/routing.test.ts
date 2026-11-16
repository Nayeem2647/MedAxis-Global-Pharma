import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '../../middleware';

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test'); vi.stubEnv('API_INTERNAL_BASE_URL', ''); });

describe('Edge locale routing', () => {
  it('preserves the original loopback origin and query when redirecting the root', async () => {
    vi.stubEnv('__NEXT_NO_MIDDLEWARE_URL_NORMALIZE', 'true');
    const response = await middleware(new NextRequest('http://127.0.0.1:3100/?source=partner', { headers: { cookie: 'medaxis_locale=zh-CN' } }));
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3100/zh-CN?source=partner');
  });

  const localeCases: { headers: Record<string, string>; locale: string }[] = [
    { headers: { 'cf-ipcountry': 'CN' }, locale: 'zh-CN' },
    { headers: { 'accept-language': 'zh-TW,zh;q=0.9' }, locale: 'zh-CN' },
    { headers: { 'cf-ipcountry': 'US', 'accept-language': 'en-US,zh;q=0.5' }, locale: 'en' },
    { headers: { cookie: 'medaxis_locale=en', 'cf-ipcountry': 'CN' }, locale: 'en' },
    { headers: { cookie: 'medaxis_locale=zh-CN', 'cf-ipcountry': 'US' }, locale: 'zh-CN' },
    { headers: { cookie: 'medaxis_locale=invalid', 'cf-ipcountry': 'CN' }, locale: 'zh-CN' },
    { headers: {}, locale: 'en' },
  ];
  it.each(localeCases)('chooses $locale only at the root using $headers', async ({ headers, locale }) => {
    const response = await middleware(new NextRequest('https://medaxis.test/?source=test', { headers }));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`https://medaxis.test/${locale}?source=test`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it.each(['/zh-CN', '/zh-CN/products', '/en', '/en/products'])('preserves direct access to %s regardless of geo/cookie', async (path) => {
    const response = await middleware(new NextRequest(`https://medaxis.test${path}`, { headers: { 'cf-ipcountry': 'CN', cookie: 'medaxis_locale=en' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('link')).toBeNull();
  });

  it.each(['/q/token', '/q', '/admin/login', '/api/revalidate', '/_next/static/a.js', '/sitemap.xml', '/robots.txt', '/logo.svg'])('bypasses %s', async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await middleware(new NextRequest(`https://medaxis.test${path}`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('emits a real 301 and retains query parameters for historical slugs', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 301, headers: { location: '/en/products/current' } })));
    const response = await middleware(new NextRequest('https://medaxis.test/en/products/historical-routing-test?ref=email'));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://medaxis.test/en/products/current?ref=email');
  });
});
