import { expect, test } from '@playwright/test';
import { installImageFixture } from './image-fixture';

const privateData = /NEVER_RENDER_|NEVER_INVENT_REVIEW_DATE|procurement_cost_bdt|unit_price|priceCurrency|"offers"|"aggregateRating"|\b(?:USD|CNY|EUR|BDT)\s*\d|[$¥￥€৳]\s*\d[\d,]*\.\d{2}/;
declare global { interface Window { catalogCLS: number } }

test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
  await page.route('https://plausible.example.test/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '/* analytics fixture */' }));
});

test('homepage GET search, facets, pagination and clear/reset retain localized URL state', async ({ page }) => {
  test.setTimeout(60_000);
  for (const locale of ['en', 'zh-CN']) {
    const chinese = locale === 'zh-CN';
    await page.goto(`/${locale}`);
    const search = page.getByRole('search');
    await search.locator('input[name=q]').fill(chinese ? '奥希替尼 80mg' : 'Osimert 80mg');
    await search.locator('select[name=category]').selectOption(chinese ? 'oncology-cn' : 'oncology');
    await search.locator('input[name=q]').press('Enter');
    await page.waitForURL((url) => url.pathname === `/${locale}/products`, { timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get('category')).toBe(chinese ? 'oncology-cn' : 'oncology');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, follow');
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `https://medaxisglobalpharma.com/${locale}/products`);
    await page.getByRole('link', { name: chinese ? '清除筛选' : 'Clear filters', exact: true }).click();
    await page.waitForURL(`**/${locale}/products`, { timeout: 15_000 });
    await expect(page.locator('.product-card')).toHaveCount(2);
    await expect(page.locator('select[name=dosage_form] option[value=Tablet]')).toHaveText('Tablet (2)');
    await page.goto(`/${locale}/products?limit=1`);
    await expect(page.locator('select[name=limit]')).toHaveValue('1');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await page.locator('.pagination a[rel=next]').click();
    await page.waitForURL((url) => url.searchParams.get('page') === '2', { timeout: 15_000 });
    await expect(page.locator('.product-card')).toContainText('English-only medicine');
    await page.locator('input[name=q]').fill(chinese ? '奥希替尼 80mg' : 'Osimert 80mg');
    const manufacturer = page.locator('[data-catalog-filter="manufacturer"]');
    await manufacturer.locator('.filter-dropdown-trigger').click();
    await manufacturer.locator(`.filter-dropdown-options button[value="${chinese ? 'beacon-cn' : 'beacon'}"]`).click();
    await page.locator('select[name=cold_chain]').selectOption('true');
    await page.locator('.filter-actions button').click();
    await page.waitForURL((url) => url.searchParams.get('q') === (chinese ? '奥希替尼 80mg' : 'Osimert 80mg') && !url.searchParams.has('page'), { timeout: 15_000 });
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('.product-card')).toContainText(chinese ? '奥希替尼 80mg' : 'Osimert 80mg');
    await page.getByRole('link', { name: chinese ? '清除筛选' : 'Clear filters', exact: true }).click();
    await page.waitForURL(`**/${locale}/products`, { timeout: 15_000 });
    const generic = page.locator('[data-catalog-filter="generic"]');
    await generic.locator('.filter-dropdown-trigger').click();
    await generic.locator(`.filter-dropdown-options button[value="${chinese ? 'osimertinib-cn' : 'osimertinib'}"]`).click();
    await page.locator('select[name=dosage_form]').selectOption('Tablet');
    await page.locator('select[name=cold_chain]').selectOption('false');
    await page.locator('.filter-actions button').click();
    await page.waitForURL((url) => url.searchParams.get('cold_chain') === 'false', { timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get('generic')).toBe(chinese ? 'osimertinib-cn' : 'osimertinib');
    expect(new URL(page.url()).searchParams.get('dosage_form')).toBe('Tablet');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('.product-card')).toContainText('English-only medicine');
  }
});

test('entity pages expose exact reciprocal SEO and safe HTML, RSC and structured data', async ({ page, request }) => {
  test.setTimeout(120_000);
  for (const [kind, en, zh] of [['products', 'osimert-80mg', '奥希替尼-80mg'], ['manufacturers', 'beacon', 'beacon-cn'], ['generics', 'osimertinib', 'osimertinib-cn'], ['categories', 'oncology', 'oncology-cn']]) {
    for (const locale of ['en', 'zh-CN']) {
      const path = `/${locale}/${kind}/${encodeURIComponent(locale === 'en' ? en : zh)}`;
      const html = await request.get(path);
      expect(html.status()).toBe(200);
      expect(await html.text()).not.toMatch(privateData);
      const rsc = await request.get(path, { headers: { RSC: '1' } });
      expect(rsc.headers()['content-type']).toContain('text/x-component');
      expect(await rsc.text()).not.toMatch(privateData);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `https://medaxisglobalpharma.com${path}`);
      await expect(page.locator('link[hreflang=en]')).toHaveAttribute('href', `https://medaxisglobalpharma.com/en/${kind}/${en}`);
      await expect(page.locator('link[hreflang="zh-CN"]')).toHaveAttribute('href', `https://medaxisglobalpharma.com/zh-CN/${kind}/${encodeURIComponent(zh)}`);
      await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute('href', `https://medaxisglobalpharma.com/en/${kind}/${en}`);
      expect(await page.content()).not.toMatch(privateData);
      expect(await page.evaluate(() => 'NEVER_EXECUTE_CATALOG_SCRIPT' in globalThis)).toBe(false);
      for (const source of await page.locator('script[type="application/ld+json"]').allTextContents()) {
        const value: unknown = JSON.parse(source);
        expect(JSON.stringify(value)).not.toMatch(privateData);
        expect(source).not.toMatch(/"(?:offers|price|priceCurrency|aggregateRating|review)"/);
      }
    }
  }
});

test('different translated slugs switch exactly while absent translations stay direct and noindex', async ({ page, request }) => {
  await page.goto('/en/products/osimert-80mg');
  await page.getByRole('navigation', { name: 'Language', exact: true }).getByRole('link', { name: '简体中文' }).click();
  await page.waitForURL(`**/zh-CN/products/${encodeURIComponent('奥希替尼-80mg')}`, { timeout: 15_000 });
  await page.setExtraHTTPHeaders({ cookie: 'medaxis_locale=en', 'cf-ipcountry': 'US' });
  const fallback = await page.goto('/zh-CN/products/english-only-medicine');
  expect(fallback?.status()).toBe(200);
  await expect(page).toHaveURL(/\/zh-CN\/products\/english-only-medicine$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('English-only medicine');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://medaxisglobalpharma.com/zh-CN/products/english-only-medicine');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, follow');
  await expect(page.locator('link[hreflang="zh-CN"]')).toHaveCount(0);
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute('href', 'https://medaxisglobalpharma.com/en/products/english-only-medicine');
  const sitemap = await request.get('/sitemap.xml');
  const index=await sitemap.text();const children=[...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match)=>new URL(match[1]).pathname);const xml=(await Promise.all(children.map(async(path)=>(await request.get(path)).text()))).join('');
  expect(xml).not.toContain('/zh-CN/products/english-only-medicine');
  for (const path of ['/products', '/services', '/services/pharmaceutical-sourcing', '/categories']) expect(xml).toContain(`/en${path}</loc>`);
  expect(xml).not.toContain('/en/manufacturers</loc>');
  expect(xml).not.toContain('/en/generics</loc>');
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) { expect(new URL(match[1]).search).toBe(''); expect(match[1]).not.toMatch(/\/privacy|\/terms|\/admin\/|\/q\/|\/api\//); }
});

test('locale switching maps catalog filter slugs and resets the page', async ({ page }) => {
  await page.goto('/en/products?manufacturer=beacon&category=oncology&page=2&limit=1&ref=email');
  await page.getByRole('navigation', { name: 'Language', exact: true }).getByRole('link', { name: '简体中文' }).click();
  await page.waitForURL((url) => url.pathname === '/zh-CN/products' && url.searchParams.get('manufacturer') === 'beacon-cn', { timeout: 15_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get('category')).toBe('oncology-cn');
  expect(url.searchParams.has('page')).toBe(false);
  expect(url.searchParams.get('ref')).toBe('email');
  await expect(page.locator('input[name=manufacturer]')).toHaveValue('beacon-cn');
  await expect(page.locator('.product-card')).toHaveCount(1);
});

test('historical entity paths keep HTTP 301 and invalid targets never redirect', async ({ request }) => {
  for (const [kind, current] of [['products', 'osimert-80mg'], ['generics', 'osimertinib'], ['manufacturers', 'beacon'], ['categories', 'oncology']]) {
    const response = await request.get(`/en/${kind}/old-entry?ref=partner`, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    const location = new URL(response.headers().location, response.url());
    expect(location.pathname).toBe(`/en/${kind}/${current}`);
    expect(location.search).toBe('?ref=partner');
    expect(location.origin).toBe(new URL(response.url()).origin);
  }
  const unsafe = await request.get('/en/products/unsafe-redirect', { maxRedirects: 0 });
  expect(unsafe.headers().location).toBeUndefined();
  expect(await unsafe.text()).not.toContain('https://evil.test');
  const missing = await request.get('/en/products/not-a-product');
  expect(missing.status()).toBe(404);
});

test('empty search prefills a custom requirement and catalog additions merge across views', async ({ page }) => {
  test.setTimeout(90_000);
  const submissions: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/v1/public/rfq/')) submissions.push(request.url());
  });
  await page.goto('/en');
  await page.getByRole('button', { name: 'Add Osimert 80mg to RFQ list', exact: true }).click();
  await page.goto('/en/products/osimert-80mg');
  await page.getByRole('button', { name: 'Add Osimert 80mg to RFQ list', exact: true }).click();
  await page.goto('/en/products?q=Uncatalogued%20medicine');
  await page.getByRole('button', { name: 'Send your requirement', exact: true }).click();
  const dialog = page.getByRole('main');
  await expect(dialog.getByLabel('Medicine name', { exact: true })).toHaveValue('Uncatalogued medicine');
  await expect(dialog.getByLabel('Medicine name', { exact: true })).toBeEditable();
  await dialog.getByRole('button', { name: 'Add to RFQ list', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Quantity for Osimert 80mg', { exact: true })).toHaveValue('2');
  const stored = await page.evaluate(() => localStorage.getItem('medaxis_rfq_cart'));
  expect(stored).toContain('"kind":"custom"');
  expect(stored).toContain('Uncatalogued medicine');
  expect(submissions).toEqual([]);
});

test('429, malformed JSON and proxy HTML render localized sanitized errors', async ({ page }) => {
  test.setTimeout(60_000);
  for (const [query, heading] of [['rate-limit', 'The catalog is receiving many requests'], ['proxy-error', 'Catalog details are temporarily unavailable'], ['malformed', 'Catalog details are temporarily unavailable']]) {
    await page.goto(`/en/products?q=${query}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await page.content()).not.toContain('NEVER_RENDER_PROXY_SECRET');
    await expect(page.getByRole('button', { name: 'Send your requirement', exact: true })).toBeEnabled();
  }
});

test('a later search supersedes an unfinished stale read', async ({ page, request }) => {
  const state = await request.get('http://127.0.0.1:4100/__test__/state');
  const before: unknown = await state.json();
  if (!before || typeof before !== 'object' || !('slowDone' in before) || typeof before.slowDone !== 'number') throw new Error('Invalid fixture state.');
  const count = before.slowDone;
  await page.goto('/en/products');
  await page.locator('input[name=q]').fill('slow');
  const started = page.waitForRequest((req) => new URL(req.url()).pathname === '/en/products' && new URL(req.url()).searchParams.get('q') === 'slow');
  await page.locator('.filter-actions button').click();
  const staleRequest = await started;
  const cancelled = page.waitForEvent('requestfailed', { predicate: (request) => request === staleRequest, timeout: 15_000 });
  await page.goto('/en/products?q=Osimert%2080mg');
  expect((await cancelled).failure()?.errorText).toMatch(/aborted|cancelled/i);
  await expect.poll(async () => {
    const response = await request.get('http://127.0.0.1:4100/__test__/state');
    const value: unknown = await response.json();
    return value && typeof value === 'object' && 'slowDone' in value && typeof value.slowDone === 'number' ? value.slowDone : 0;
  }).toBeGreaterThan(count);
  await expect(page).toHaveURL(/q=Osimert%2080mg$/);
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card')).toContainText('Osimert 80mg');
});

test('catalog/detail/hub/services stay responsive with sized images and measured CLS', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.catalogCLS = 0;
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) {
      if ('hadRecentInput' in entry && !entry.hadRecentInput && 'value' in entry && typeof entry.value === 'number') window.catalogCLS += entry.value;
    } }).observe({ type: 'layout-shift', buffered: true });
  });
  const measurements: Record<string, number> = {};
  for (const locale of ['en', 'zh-CN']) {
    for (const suffix of ['/products', '/products/english-only-medicine', `/manufacturers/${locale === 'en' ? 'beacon' : 'beacon-cn'}`, '/services/pharmaceutical-sourcing']) {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}${suffix}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        for (const image of await page.locator('.product-gallery img, .product-image img').all()) {
          await image.scrollIntoViewIfNeeded();
          await expect(image).toHaveJSProperty('complete', true);
          await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement ? element.naturalWidth : 0)).toBeGreaterThan(0);
          expect(Number(await image.getAttribute('width'))).toBeGreaterThan(0);
          expect(Number(await image.getAttribute('height'))).toBeGreaterThan(0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const shift = await page.evaluate(() => window.catalogCLS);
        measurements[`${locale}${suffix}@${width}`] = shift;
        expect(shift, `${locale}${suffix}@${width}`).toBeLessThanOrEqual(.1);
        if (width === 1440 || width === 320) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: testInfo.outputPath(`${locale}-${suffix.replaceAll('/', '-')}-${width}.png`), fullPage: true });
        }
      }
    }
  }
  await testInfo.attach('measured-cls', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('unavailable product images retain a useful stable fallback', async ({ page }) => {
  await page.route('**/_next/image?**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/en/products/english-only-medicine');
  await expect(page.locator('.gallery-main .catalog-image-fallback')).toContainText('Image unavailable');
  const bounds = await page.locator('.gallery-main').boundingBox();
  expect(bounds?.width).toBeGreaterThan(100);
  expect(bounds?.height).toBeGreaterThan(100);
});

test('product gallery switches photos and video while product enquiries retain their context', async ({ page }) => {
  await page.route('**/products/local/videos/product-fixture.mp4', (route) => route.fulfill({ contentType: 'video/mp4', body: '' }));
  for (const locale of ['en', 'zh-CN']) {
    const chinese = locale === 'zh-CN';
    await page.goto(`/${locale}/products/english-only-medicine`);
    await expect(page.locator('.product-save-enquiry')).toBeEnabled();
    const gallery = page.locator('.product-gallery');
    await expect(gallery.locator('.gallery-main img')).toHaveAttribute('src', /test-fixture\.png/);
    await gallery.getByRole('button', { name: chinese ? '查看第 2 张产品图片' : 'Show product photo 2', exact: true }).click();
    await expect(gallery.locator('.gallery-main img')).toHaveAttribute('src', /test-fixture-back\.png/);
    await gallery.getByRole('button', { name: chinese ? '产品视频' : 'Product video', exact: true }).click();
    const video = gallery.locator('video');
    await expect(video).toBeVisible();
    await expect(video).toHaveJSProperty('controls', true);
    await expect(video).toHaveJSProperty('autoplay', false);
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video).toHaveCSS('object-fit', 'contain');
    await gallery.getByRole('button', { name: chinese ? '下一张图片或视频' : 'Next photo or video', exact: true }).click();
    await expect(gallery.locator('video')).toHaveCount(0);
    await expect(gallery.getByRole('button', { name: chinese ? '查看第 1 张产品图片' : 'Show product photo 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const whatsapp = page.locator('.product-whatsapp');
    const href = await whatsapp.getAttribute('href');
    expect(new URL(href!).searchParams.get('text')).toContain('English-only medicine');
    expect(new URL(href!).searchParams.get('text')).toContain('80 mg');
    await page.locator('.product-price-inquiry').click();
    await expect(page.getByRole('main').getByLabel(chinese ? '药品名称' : 'Medicine name', { exact: true })).toHaveValue('English-only medicine');
    await page.getByRole('main').getByRole('button', { name: chinese ? '返回网站' : 'Back to website', exact: true }).click();
  }
});

test('paginated master directories link to real locale profiles', async ({ page }) => {
  for (const locale of ['en', 'zh-CN']) {
    for (const [kind, en, zh] of [['manufacturers', 'beacon', 'beacon-cn'], ['generics', 'osimertinib', 'osimertinib-cn'], ['categories', 'oncology', 'oncology-cn']]) {
      await page.goto(`/${locale}/${kind}`);
      await expect(page.locator('.directory-grid article')).toHaveCount(1);
      await expect(page.locator('.directory-grid h2 a')).toHaveAttribute('href', `/${locale}/${kind}/${locale === 'en' ? en : zh}`);
      await page.locator('.directory-grid h2 a').click();
      await expect(page.locator('.product-card')).toHaveCount(2);
    }
  }
});

test('catalog search remains a native GET form without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: 'http://127.0.0.1:3100' });
  try {
    const page = await context.newPage();
    await installImageFixture(page);
    await page.goto('/en');
    await page.getByRole('search').locator('input[name=q]').fill('Osimert 80mg');
    await page.getByRole('search').locator('button[type=submit]').click();
    await expect(page).toHaveURL(/\/en\/products\?.*q=Osimert\+80mg/);
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('.product-card')).toContainText('Osimert 80mg');
  } finally { await context.close(); }
});
