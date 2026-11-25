import { expect, test, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';
import { installImageFixture } from './image-fixture';

async function contrastRatio(locator: Locator, foreground = 'color') {
  return locator.evaluate((element, property) => {
    function luminance(value: string) {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${value}`);
      const linear = channels.map((channel) => { const srgb = channel / 255; return srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4; });
      return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
    }
    const style = getComputedStyle(element);
    const color = luminance(style.getPropertyValue(property));
    let surface: Element | null = property === 'outline-color' ? element.parentElement : element;
    let background = 'rgb(255, 255, 255)';
    while (surface) {
      const value = getComputedStyle(surface).backgroundColor;
      if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break; }
      surface = surface.parentElement;
    }
    const backdrop = luminance(background);
    return (Math.max(color, backdrop) + .05) / (Math.min(color, backdrop) + .05);
  }, foreground);
}

async function expectDialogControlsToFit(dialog: Locator) {
  const geometry = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, viewport: innerWidth, scroll: element.scrollWidth, client: element.clientWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  const controls = dialog.locator('button:visible, a[href]:visible, input:visible, select:visible, textarea:visible, summary:visible');
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) continue;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height, await control.evaluate((element) => element.outerHTML.slice(0, 300))).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(geometry.left);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(geometry.right);
    await expect(control).toBeInViewport();
  }
}

test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
  await page.route('https://plausible.example.test/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '/* isolated analytics fixture */' }));
});

test('server HTML, hydrated DOM and RSC have reciprocal metadata and zero public prices', async ({ request, page }) => {
  const revalidated = await request.post('/api/revalidate', {
    headers: { Authorization: 'Bearer medaxis-local-e2e-secret' }, data: { tags: ['catalog', 'cms'] },
  });
  expect(revalidated.status()).toBe(200);
  const backend = await request.get('http://127.0.0.1:4100/v1/public/products?locale=en');
  expect(await backend.text()).toContain('USD 9876.54');
  const priceLeak = /NEVER_RENDER_PRIVATE_PRICE|NEVER_RENDER_INTERNAL_COST|procurement_cost_bdt|unit_price|\b(?:USD|CNY|EUR|BDT)\s*\d|[$¥￥€৳]\s*\d[\d,]*\.\d{2}/;
  for (const locale of ['en', 'zh-CN']) {
    const response = await request.get(`/${locale}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(locale === 'en' ? 'Osimert 80mg' : '奥希替尼 80mg');
    expect(html).toContain(locale === 'en' ? 'Sourcing desk update' : '采购服务公告');
    const metadata = await page.evaluate((source) => {
      const document = new DOMParser().parseFromString(source, 'text/html');
      return {
        canonicals: Array.from(document.querySelectorAll('link[rel="canonical"]'), (link) => link.getAttribute('href')),
        alternates: Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'), (link) => ({ language: link.getAttribute('hreflang'), href: link.getAttribute('href') })),
        inlineRscCount: Array.from(document.scripts).filter((script) => script.textContent?.includes('self.__next_f.push')).length,
      };
    }, html);
    expect(metadata.canonicals).toEqual([`https://medaxisglobalpharma.com/${locale}`]);
    expect(metadata.alternates).toEqual([
      { language: 'en', href: 'https://medaxisglobalpharma.com/en' },
      { language: 'zh-CN', href: 'https://medaxisglobalpharma.com/zh-CN' },
      { language: 'x-default', href: 'https://medaxisglobalpharma.com/en' },
    ]);
    expect(metadata.inlineRscCount).toBeGreaterThan(0);
    expect(html).not.toMatch(priceLeak);

    const rsc = await request.get(`/${locale}`, { headers: { RSC: '1' } });
    expect(rsc.status()).toBe(200);
    expect(rsc.headers()['content-type']).toContain('text/x-component');
    const payload = await rsc.text();
    expect(payload).toContain(locale === 'en' ? 'Osimert 80mg' : '奥希替尼 80mg');
    expect(payload).not.toMatch(priceLeak);

    await page.goto(`/${locale}`);
    await expect(page.getByRole('heading', { name: locale === 'en' ? 'Osimert 80mg' : '奥希替尼 80mg', exact: true })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://medaxisglobalpharma.com/${locale}`);
    for (const language of ['en', 'zh-CN', 'x-default']) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute('href', `https://medaxisglobalpharma.com/${language === 'zh-CN' ? 'zh-CN' : 'en'}`);
    }
    expect(await page.content()).not.toMatch(priceLeak);
    expect(await page.locator('body').innerText()).not.toMatch(priceLeak);
  }
});

test('locale switch writes a one-year cookie and overrides China geo on root reload', async ({ page, context }) => {
  await page.goto('/en');
  const origin = new URL(page.url()).origin;
  await page.getByRole('navigation', { name: 'Language', exact: true }).getByRole('link', { name: '简体中文' }).click();
  await expect(page).toHaveURL(/\/zh-CN$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const chineseCookie = (await context.cookies([page.url()])).find((value) => value.name === 'medaxis_locale');
  expect(chineseCookie).toMatchObject({ value: 'zh-CN', path: '/', sameSite: 'Lax', httpOnly: false });
  expect(chineseCookie?.expires).toBeGreaterThan(Date.now() / 1000 + 31_536_000 - 120);
  expect(chineseCookie?.expires).toBeLessThan(Date.now() / 1000 + 31_536_000 + 120);
  await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'US', 'accept-language': 'en-US' });
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/zh-CN`);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('navigation', { name: '语言', exact: true }).getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en$/);
  const cookie = (await context.cookies([page.url()])).find((value) => value.name === 'medaxis_locale');
  expect(cookie).toMatchObject({ value: 'en', path: '/', sameSite: 'Lax' });
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 31_536_000 - 120);
  expect(cookie?.expires).toBeLessThan(Date.now() / 1000 + 31_536_000 + 120);
  await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'CN' });
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/en`);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('locale switch uses the supplied reciprocal metadata path and preserves query context', async ({ page }) => {
  await page.goto('/en/terms?ref=partner');
  await page.locator('link[rel="alternate"][hreflang="zh-CN"]').evaluate((link) => link.setAttribute('href', 'https://medaxisglobalpharma.com/zh-CN/privacy'));
  await page.getByRole('navigation', { name: 'Language', exact: true }).getByRole('link', { name: '简体中文' }).click();
  // A concurrent production run can take longer than the 5s assertion window
  // to finish its RSC navigation; still require the exact counterpart and query.
  await page.waitForURL(/\/zh-CN\/privacy\?ref=partner$/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/zh-CN\/privacy\?ref=partner$/);
});

test('RFQ cart merges catalog rows, persists quantity and supports custom add/remove/clear', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en');
  const add = page.getByRole('button', { name: 'Add Osimert 80mg to RFQ list', exact: true });
  await add.click();
  const drawer = page.getByRole('dialog', { name: 'Your RFQ list', exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await add.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Quantity for Osimert 80mg', { exact: true })).toHaveValue('2');
  await drawer.getByLabel('Quantity for Osimert 80mg', { exact: true }).fill('6');
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Quotation cart, 1 items/ }).click();
  await expect(drawer.getByLabel('Quantity for Osimert 80mg', { exact: true })).toHaveValue('6');
  await drawer.getByRole('button', { name: 'Add a medicine requirement', exact: true }).click();
  const quote = page.getByRole('main', { name: 'Request Quick Quote', exact: true });
  await quote.getByLabel('Medicine name', { exact: true }).fill('Custom medicine');
  await quote.getByLabel('Quantity', { exact: true }).fill('3');
  await quote.getByRole('button', { name: 'Add to RFQ list', exact: true }).click();
  await expect(drawer.getByText('Custom medicine', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Remove Osimert 80mg', exact: true }).click();
  await expect(drawer.getByLabel('Quantity for Osimert 80mg', { exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Clear list', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Your list starts here' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('medaxis_rfq_cart'))).toBe('{"version":1,"items":[]}');
  expect(errors).toEqual([]);
});

test('stored cart hydrates without mismatches and stays usable when storage is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && /hydration|server rendered/i.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => {
    try { localStorage.setItem('medaxis_rfq_cart', JSON.stringify({ version: 1, items: [{ kind: 'custom', id: '4d5e6f7a-8b9c-4d1e-8f3a-4b5c6d7e8f9a', name: 'Stored medicine', strength: '', quantity: 4, packagingUnit: 'BOX' }] })); } catch { /* inaccessible origin */ }
    Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  await page.goto('/en');
  await page.getByRole('button', { name: /Quotation cart, 1 items/ }).click();
  await expect(page.getByRole('dialog').getByText('Stored medicine', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Osimert 80mg to RFQ list', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your RFQ list', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Quotation cart, 2 items/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('public analytics is enabled while quotation/admin paths never load its script', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('plausible.example.test')) requests.push(request.url()); });
  await page.goto('/en');
  await expect(page.locator('script#medaxis-plausible')).toHaveAttribute('src', 'https://plausible.example.test/js/pa-test.js');
  expect(requests).toHaveLength(1);
  for (const path of ['/q/private-test-token', '/admin/login']) {
    requests.length = 0;
    await page.goto(path);
    await expect(page.locator('script#medaxis-plausible')).toHaveCount(0);
    expect(requests).toEqual([]);
  }
});

test('contact opens the official WhatsApp number and utility pages are noindex', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('button', { name: 'WhatsApp / WeChat', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: /Chat on WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/8801560066410');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Privacy & cookies', exact: true }).click();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('owner-supplied WeChat QR loads in both locales and serves the original JPEG', async ({ page, request }, testInfo) => {
  const original = await request.get('/images/wechat-contact.jpeg');
  expect(original.status()).toBe(200);
  expect(original.headers()['content-type']).toContain('image/jpeg');
  expect(createHash('sha256').update(await original.body()).digest('hex')).toBe('6f7da6232bd6e2edb515b662d10287bff4a0313aa74dcd33c37875cd179848bf');
  for (const locale of ['en', 'zh-CN']) {
    await page.setViewportSize(locale === 'en' ? { width: 1000, height: 1100 } : { width: 390, height: 844 });
    await page.goto(`/${locale}`);
    await page.getByRole('button', { name: 'WhatsApp / WeChat', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const qr = dialog.getByRole('img', { name: locale === 'en' ? 'Official MedAxis WeChat contact QR code' : 'MedAxis 官方微信联系二维码' });
    await qr.scrollIntoViewIfNeeded();
    await expect(qr).toHaveAttribute('src', '/images/wechat-contact.jpeg');
    await expect(qr).toHaveJSProperty('naturalWidth', 616);
    await expect(qr).toHaveJSProperty('naturalHeight', 624);
    await expect(dialog.getByRole('link', { name: locale === 'en' ? 'Open full-size QR code' : '查看原始尺寸二维码', exact: true })).toHaveAttribute('href', '/images/wechat-contact.jpeg');
    await expect(dialog.getByText(locale === 'en' ? 'Contact details for this channel will be available soon.' : '此渠道的联系方式将于稍后提供。', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`wechat-contact-${locale}.png`) });
    await page.keyboard.press('Escape');
  }
});

test('bilingual homepage, anchors and touch controls work from 320px through desktop', async ({ page }, testInfo) => {
  for (const locale of ['en', 'zh-CN']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/${locale}`);
    await expect(page.locator('.product-card')).toHaveCount(2);
    await expect(page.locator('.sourcing-tile')).toHaveCount(4);
    await expect(page.locator('.category-card h3')).toHaveText(locale === 'en' ? 'Oncology' : '肿瘤科');
    await expect(page.locator('#trusted-manufacturers')).toBeVisible();
    await expect(page.locator('#trusted-manufacturers .manufacturer-logo-item').first()).toHaveAttribute('title', locale === 'en' ? 'Beacon Pharmaceuticals PLC' : 'Beacon 制药');
    await expect(page.getByRole('searchbox', { name: locale === 'en' ? 'Search medicines' : '搜索药品' })).toHaveCount(1);
    for (const action of await page.locator('.header-quote, .add-product').all()) expect(await contrastRatio(action)).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`homepage-${locale}-desktop.png`), fullPage: true });
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const targets = await page.locator('.site-header button, .locale-switcher a').evaluateAll((elements) => elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => { const bounds = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') ?? element.textContent, width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right }; }));
      for (const target of targets) {
        expect(target.width, `${locale} ${width}px: ${target.label}`).toBeGreaterThanOrEqual(44);
        expect(target.height, `${locale} ${width}px: ${target.label}`).toBeGreaterThanOrEqual(44);
        expect(target.left, `${locale} ${width}px: ${target.label}`).toBeGreaterThanOrEqual(0);
        expect(target.right, `${locale} ${width}px: ${target.label}`).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: testInfo.outputPath(`homepage-${locale}-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: locale === 'en' ? 'Toggle menu' : '展开或收起菜单', exact: true }).click();
    const navigation = page.getByRole('navigation', { name: locale === 'en' ? 'Mobile navigation' : '移动导航', exact: true });
    await expect(navigation).toBeVisible();
    for (const anchor of ['catalog', 'popular', 'reviews', 'cold-chain', 'trusted-manufacturers']) {
      await expect(page.locator(`#${anchor}`)).toHaveCount(1);
    }
    await navigation.getByRole('link', { name: locale === 'en' ? 'Products' : '产品', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/products$`));
    await expect(navigation).toHaveCount(0);
  }
});

test('mobile quotation page supports keyboard navigation and local medicine-list additions', async ({ page }) => {
  const submissions: string[] = [];
  page.on('request', (request) => { if (/\/v1\/public\/rfq/.test(request.url())) submissions.push(request.url()); });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en');
  const trigger = page.getByRole('button', { name: 'Start an enquiry', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en\/request-quote$/);
  const quote = page.getByRole('main', { name: 'Request Quick Quote', exact: true });
  await expect(quote).toBeVisible();
  await quote.getByLabel('Medicine name', { exact: true }).fill('Patient requirement');
  await page.keyboard.press('Escape');
  await expect(quote.getByLabel('Medicine name', { exact: true })).toHaveValue('Patient requirement');
  await quote.getByRole('button', { name: 'Back to website', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en$/);
  await page.locator('.header-quote').focus();
  await page.keyboard.press('Enter');
  await quote.getByLabel('Medicine name', { exact: true }).fill('Patient requirement');
  await quote.getByRole('button', { name: 'Add to RFQ list', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Your RFQ list', exact: true });
  await expect(drawer.getByText('Patient requirement', { exact: true })).toBeVisible();
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Quotation cart, 1 items', exact: true })).toBeVisible();
  expect(submissions).toEqual([]);
});

test('bilingual action states retain contrast, visible focus and reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const measurements: Record<string, number> = {};
  for (const locale of ['en', 'zh-CN']) {
    await page.goto(`/${locale}`);
    const primary = page.locator('.header-quote');
    const bright = page.locator('.add-product').first();
    for (const [name, action] of [['primary', primary], ['bright', bright]] as const) {
      await page.mouse.move(0, 0);
      measurements[`${locale}.${name}.normal`] = await contrastRatio(action);
      await action.hover();
      measurements[`${locale}.${name}.hover`] = await contrastRatio(action);
    }
    // Exercise the disabled visual state without changing cart or shell state.
    await page.mouse.move(0, 0);
    await primary.evaluate((element) => element.setAttribute('disabled', ''));
    await expect(primary).toBeDisabled();
    measurements[`${locale}.primary.disabled`] = await contrastRatio(primary);
    await primary.evaluate((element) => element.removeAttribute('disabled'));
    await primary.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(primary).toBeFocused();
    expect(await primary.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    await expect(primary).toHaveCSS('outline-style', 'solid');
    await expect(primary).toHaveCSS('outline-width', '3px');
    expect(await contrastRatio(primary, 'outline-color')).toBeGreaterThanOrEqual(3);
    await expect(primary).toHaveCSS('transition-duration', '0s');
    await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
    const tile = page.locator('.tile-link').first();
    await tile.hover();
    await expect(tile.locator('svg')).toHaveCSS('transform', 'none');
  }
  for (const [state, ratio] of Object.entries(measurements)) expect(ratio, state).toBeGreaterThanOrEqual(4.5);
  await testInfo.attach('measured-action-contrast', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('bilingual 320px quotation page, cart and contact have reachable touch controls', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const locale of ['en', 'zh-CN']) {
    await page.goto(`/${locale}`);
    await page.locator('.header-quote').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/request-quote$`));
    const quote = page.locator('.quote-request-page:visible');
    await expectDialogControlsToFit(quote);
    await page.screenshot({ path: testInfo.outputPath(`quick-quote-${locale}-320.png`) });
    await quote.getByRole('button', { name: locale === 'en' ? 'Back to website' : '返回网站', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await page.locator('.cart-button').click();
    await expectDialogControlsToFit(dialog);
    await page.screenshot({ path: testInfo.outputPath(`cart-${locale}-320.png`) });
    await page.keyboard.press('Escape');
    await page.locator('.footer-contact').click();
    await expect(dialog.locator('.contact-channel h3').first()).toHaveText(locale === 'zh-CN' ? 'WeChat' : 'WhatsApp');
    await expectDialogControlsToFit(dialog);
    await dialog.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`contact-${locale}-320.png`) });
    await page.keyboard.press('Escape');
    await expect(page.locator('.footer-contact')).toBeFocused();
  }
});
