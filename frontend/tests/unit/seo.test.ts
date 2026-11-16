import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localizedAlternates } from '../../lib/seo';
import { renderSitemap, sitemapCatalogSchema } from '../../lib/sitemap';
import { GET as robots } from '../../app/robots.txt/route';
import { sitemapCatalog } from '../fixtures';

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://medaxisglobalpharma.com'));

describe('canonical metadata and sitemap', () => {
  it('keeps x-default on the equivalent English entity and canonical on the active locale', () => {
    expect(localizedAlternates('zh-CN', { en: '/products/osimert', 'zh-CN': '/products/osimert-cn' })).toEqual({
      canonical: 'https://medaxisglobalpharma.com/zh-CN/products/osimert-cn',
      languages: {
        en: 'https://medaxisglobalpharma.com/en/products/osimert',
        'zh-CN': 'https://medaxisglobalpharma.com/zh-CN/products/osimert-cn',
        'x-default': 'https://medaxisglobalpharma.com/en/products/osimert',
      },
    });
  });

  it('renders all catalog kinds with reciprocal localized links, lastmod, and entity-specific x-default', () => {
    const xml = renderSitemap(sitemapCatalogSchema.parse(sitemapCatalog));
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    for (const kind of ['products', 'generics', 'manufacturers', 'categories']) expect(xml).toContain(`/en/${kind}/`);
    expect(xml).toContain(`/zh-CN/products/${encodeURIComponent('奥希替尼-80mg')}`);
    expect(xml.match(/hreflang="x-default" href="https:\/\/medaxisglobalpharma.com\/en\/products\/osimert-80mg"/g)).toHaveLength(2);
    expect(xml).toContain('<lastmod>2026-11-15T12:00:00.000Z</lastmod>');
    expect(xml).not.toMatch(/\/q\/|\/admin\/|\/api\/|\/search/);
    expect(xml).not.toContain('/zh-CN/categories/oncology');
  });

  it.each(['../admin', '/q/private-token', 'item?query=value', '<script>', 'Uppercase'])('rejects unsafe catalog slug %s at the network boundary', (en) => {
    expect(sitemapCatalogSchema.safeParse({ ...sitemapCatalog, products: [{ ...sitemapCatalog.products[0], en }] }).success).toBe(false);
  });

  it('declares the sitemap and disallows private routes in robots.txt', async () => {
    const response = robots();
    const text = await response.text();
    for (const path of ['/q/', '/admin/', '/api/', '/dashboard/']) expect(text).toContain(`Disallow: ${path}`);
    expect(text).toContain('Sitemap: https://medaxisglobalpharma.com/sitemap.xml');
    expect(response.headers.get('content-type')).toContain('text/plain');
  });
});
