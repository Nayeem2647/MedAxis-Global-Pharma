import { expect, test } from '@playwright/test';
import { installImageFixture } from './image-fixture';

test.beforeEach(async ({ page }) => { await installImageFixture(page); });

test('root respects geography, language, and the explicit preference cookie', async ({ request }) => {
  for (const [headers, locale] of [
    [{ 'cf-ipcountry': 'CN' }, 'zh-CN'],
    [{ 'accept-language': 'zh-CN,zh;q=0.9' }, 'zh-CN'],
    [{ 'cf-ipcountry': 'CN', cookie: 'medaxis_locale=en' }, 'en'],
  ] as const) {
    const response = await request.get('/', { headers, maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const destination = new URL(response.headers().location, response.url());
    expect(destination.pathname).toBe(`/${locale}`);
    expect(destination.origin).toBe(new URL(response.url()).origin);
    expect(response.headers()['cache-control']).toContain('no-store');
  }
});

test('direct Chinese catalog entry is never redirected by English preferences', async ({ request }) => {
  const response = await request.get('/zh-CN/products', {
    headers: { 'cf-ipcountry': 'US', 'accept-language': 'en-US', cookie: 'medaxis_locale=en' },
    maxRedirects: 0,
  });
  expect(response.headers().location).toBeUndefined();
  expect(new URL(response.url()).pathname).toBe('/zh-CN/products');
  expect(response.status()).toBe(200);
});

test('Chinese direct entry keeps its locale and emits reciprocal metadata without HTTP language alternates', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'US', 'accept-language': 'en-US', cookie: 'medaxis_locale=en' });
  const response = await page.goto('/zh-CN');
  expect(response?.status()).toBe(200);
  // Next.js may preload styles here; language alternates belong in the HTML metadata.
  expect(response?.headers().link ?? '').not.toMatch(/rel="?alternate"?|hreflang=/i);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('您的全球医药采购合作伙伴。');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://medaxisglobalpharma.com/zh-CN');
  for (const locale of ['en', 'zh-CN', 'x-default']) {
    await expect(page.locator(`link[rel="alternate"][hreflang="${locale}"]`)).toHaveAttribute('href', `https://medaxisglobalpharma.com/${locale === 'zh-CN' ? 'zh-CN' : 'en'}`);
  }
});

test('serves bilingual content without Google network dependencies or browser errors', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your Global Partner in Pharmaceutical Sourcing.');
  expect(response?.headers()['content-security-policy']).toContain('https://challenges.cloudflare.com');
  expect(requests.filter((url) => /googleapis\.com|gstatic\.com|google-analytics\.com|googletagmanager\.com|recaptcha/i.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test('private routes bypass locale redirects and have private search/referrer headers', async ({ request }) => {
  for (const path of ['/q/test-token', '/admin/login']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers().location).toBeUndefined();
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
  }
});

test('historical slugs produce a permanent redirect and keep query parameters', async ({ request }) => {
  const response = await request.get('/en/products/old-osimert?ref=email', { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  const destination = new URL(response.headers().location, response.url());
  expect(destination.origin).toBe(new URL(response.url()).origin);
  expect(destination.pathname).toBe('/en/products/osimert-80mg');
  expect(destination.search).toBe('?ref=email');
});

test('sitemap consumes the backend feed and robots excludes private routes', async ({ request, page }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/xml');
  const index=await response.text();expect(index).toContain('<sitemapindex');const children=[...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match)=>new URL(match[1]).pathname);expect(children).toHaveLength(5);const documents=await Promise.all(children.map(async(path)=>{const child=await request.get(path);expect(child.status()).toBe(200);return child.text();}));const xml=documents.join('');
  expect(xml).toContain('/en/products/osimert-80mg');
  expect(xml).toContain('hreflang="zh-CN"');
  expect(xml).toContain('hreflang="x-default" href="https://medaxisglobalpharma.com/en/products/osimert-80mg"');
  expect(xml).not.toMatch(/\/q\/|\/admin\/|\/api\//);
  const parsed = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    return {
      errors: document.getElementsByTagName('parsererror').length,
      entries: Array.from(document.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'url'), (url) => ({
        loc: url.getElementsByTagName('loc')[0]?.textContent,
        alternates: Array.from(url.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'link'), (link) => ({
          rel: link.getAttribute('rel'), hreflang: link.getAttribute('hreflang'), href: link.getAttribute('href'),
        })),
      })),
    };
  }, documents.join('').replaceAll(/<\?xml[^>]*>/g,'').replaceAll(/<\/?urlset[^>]*>/g,'').replace(/^/,'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">')+'</urlset>');
  expect(parsed.errors).toBe(0);
  for (const [kind, enSlug, zhSlug] of [
    ['products', 'osimert-80mg', '奥希替尼-80mg'],
    ['generics', 'osimertinib', 'osimertinib-cn'],
    ['manufacturers', 'beacon', 'beacon-cn'],
    ['categories', 'oncology', 'oncology-cn'],
  ]) {
    const en = `https://medaxisglobalpharma.com/en/${kind}/${encodeURIComponent(enSlug)}`;
    const zh = `https://medaxisglobalpharma.com/zh-CN/${kind}/${encodeURIComponent(zhSlug)}`;
    const alternates = [
      { rel: 'alternate', hreflang: 'en', href: en },
      { rel: 'alternate', hreflang: 'zh-CN', href: zh },
      { rel: 'alternate', hreflang: 'x-default', href: en },
    ];
    expect(parsed.entries).toContainEqual({ loc: en, alternates });
    expect(parsed.entries).toContainEqual({ loc: zh, alternates });
  }
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain('Disallow: /q/');
});

test('revalidation requires a bearer token and accepts backend catalog tags', async ({ request }) => {
  const denied = await request.post('/api/revalidate', { data: { tags: ['catalog'] } });
  expect(denied.status()).toBe(401);
  const accepted = await request.post('/api/revalidate', { headers: { Authorization: 'Bearer medaxis-local-e2e-secret' }, data: { tags: ['catalog', 'cms', 'settings'] } });
  expect(accepted.status()).toBe(200);
});
