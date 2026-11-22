import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { installImageFixture } from './image-fixture';
import { bannerVideo } from './banner-video-fixture';

test.use({ timezoneId: 'Asia/Dhaka' });

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
  await page.route('https://cdn.medaxisglobalpharma.com/products/s3/**', (route) => route.fulfill({ contentType: route.request().url().endsWith('.webm') ? 'video/webm' : 'image/png', body: route.request().url().endsWith('.webm') ? bannerVideo : image }));
});

test('banner studio previews media, saves schedules and edits announcements without overflow', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const email = `${randomUUID()}@fixture.example`;
  await request.post('http://127.0.0.1:4100/__test__/admin', { data: { email, scenario: 'management' } });
  await page.goto('/admin/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Continue to authenticator' }).click();
  await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'RFQ operations' })).toBeVisible({ timeout: 30_000 });
  await page.goto('/admin/catalog/banners?limit=1');
  await expect(page.getByRole('button', { name: /Home hero/ })).toBeEnabled();
  await page.locator('#banner-media-file').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('.banner-live-preview img')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.banner-live-preview .hero-preview-query')).toHaveText('Search medicines, brands or generics...');
  await expect(page.locator('.banner-live-preview .hero-search-preview')).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Headline & description' }).click();
  await page.getByLabel('Title (EN)', { exact: true }).fill('Your next sourcing partner');
  await page.getByLabel('Description (EN)', { exact: true }).fill('Documented sourcing support.');
  await expect(page.locator('.banner-live-preview .hero-preview-query')).toHaveText('Search medicines, brands or generics...');
  await page.locator('summary').filter({ hasText: 'Translation' }).click();
  await page.getByLabel('Include Simplified Chinese translation', { exact: false }).check();
  await page.getByLabel('Title (ZH)', { exact: true }).fill('医药采购服务');
  await page.getByLabel('Description (ZH)', { exact: true }).fill('提交您的采购需求。');
  await page.getByLabel('Preview language').selectOption('zh-CN');
  await expect(page.locator('.banner-live-preview .hero-preview-query')).toHaveText('搜索药品、品牌或通用名…');
  await page.getByLabel('Preview language').selectOption('en');
  await page.locator('summary').filter({ hasText: 'Translation' }).click();
  await page.getByRole('button', { name: 'Mobile preview', exact: true }).click();
  await expect(page.locator('.banner-preview-canvas')).toHaveClass(/is-mobile/);
  await page.getByLabel('Starts at (local time)', { exact: true }).fill('2030-01-01T00:00:00');
  await page.getByLabel('Ends at (local time)', { exact: true }).fill('2030-01-02T00:00:00');
  await expect(page.getByText('Dates use your local time zone', { exact: false })).toContainText('Asia/Dhaka');
  await expect(page.getByText('Scheduled', { exact: true }).first()).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await page.screenshot({ path: info.outputPath(`banner-studio-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('main *')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })) }));
    expect(overflow.scroll <= overflow.width, JSON.stringify(overflow)).toBe(true);
  }
  let failRefresh = true;
  await page.route('**/api/admin/cms/banners?**', async (route) => {
    if (failRefresh) await route.fulfill({ json: { success: true, data: [], meta: { timestamp: '2026-11-21T00:00:00.000Z', request_id: 'banner-refresh-fixture' } } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved. The latest state could not be loaded; use Refresh state.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  failRefresh = false;
  await page.getByRole('button', { name: 'Refresh state', exact: true }).click();
  await expect(page.getByText('Server state refreshed.', { exact: true })).toBeVisible();
  const result = await request.get(`http://127.0.0.1:4100/__test__/admin?${new URLSearchParams({ email, action: 'management' })}`);
  const { data } = await result.json();
  expect(data.writes).toContainEqual({ path: 'cms/banners', body: expect.objectContaining({ placement: 'MAIN_HERO', starts_at: '2029-12-31T18:00:00.000Z', ends_at: '2030-01-01T18:00:00.000Z', media_type: 'IMAGE' }) });
  expect(data.writes.filter((write: { path: string }) => write.path === 'cms/banners')).toHaveLength(1);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Your next sourcing partner', exact: true })).toBeVisible();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Your next sourcing partner', exact: true }).click();
  await expect(page.getByLabel('Starts at (local time)', { exact: true })).toHaveValue('2030-01-01T00:00');
  await expect(page.getByLabel('Ends at (local time)', { exact: true })).toHaveValue('2030-01-02T00:00');
  await page.getByRole('switch', { name: 'Toggle publish for Your next sourcing partner', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Toggle publish for Your next sourcing partner', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Your next sourcing partner', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Scheduled sourcing update', exact: true }).click();
  await expect(page.locator('.banner-announcement-preview')).toContainText('Scheduled sourcing update');
  await page.getByLabel('Enable banner during its scheduled dates').uncheck();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Toggle publish for Scheduled sourcing update', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByLabel('Filter by banner type').selectOption('BLOG_BANNER');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page.locator('.banner-table-empty')).toBeVisible();
});

test('public banners preserve heading and search, support manual pause and fit mobile', async ({ page }, info) => {
  test.skip(process.env.BANNER_E2E_FIXTURES !== '1', 'Uses the dedicated public banner fixture.');
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en');
  const banner = page.locator('.placement-banner-hero');
  await expect(banner.getByRole('heading', { level: 1 })).toHaveText('Your Global Partner in Pharmaceutical Sourcing.');
  await banner.hover();
  await expect(banner.getByRole('search')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('search')).toBeVisible();
  await banner.locator('.hero-overlay-panel').evaluate((element) => { element.dataset.retained = 'yes'; });
  await banner.getByRole('search').locator('input[name=q]').fill('Osimert');
  await banner.getByRole('button', { name: 'Next banner', exact: true }).click();
  await expect(banner.locator('.placement-banner-overlay')).toHaveCount(0);
  await expect(banner.locator('.hero-overlay-panel')).toHaveAttribute('data-retained', 'yes');
  await expect(banner.getByRole('search').locator('input[name=q]')).toHaveValue('Osimert');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Play banner animation' })).toHaveAttribute('aria-pressed', 'true');
  await banner.getByRole('button', { name: 'Previous banner' }).click();
  for (const path of ['/en', '/en/products', '/en/blog', '/zh-CN']) {
    await page.goto(path);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await page.screenshot({ path: info.outputPath(`${path.replaceAll('/', '-')}-${width}.png`), fullPage: true });
    }
  }
});

test('hero text reveals in stages after one second while search works immediately', async ({ page }) => {
  test.skip(process.env.BANNER_E2E_FIXTURES !== '1', 'Uses the dedicated public banner fixture.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en');
  const panel = page.locator('.placement-banner-hero .hero-overlay-panel');
  const timings = await panel.locator('.hero-reveal').evaluateAll((elements) => elements.map((element) => {
    const animation = element.getAnimations()[0]!;
    animation.pause();
    animation.currentTime = 0;
    const timing = animation.effect!.getTiming();
    return { delay: timing.delay ?? 0, duration: timing.duration };
  }));
  expect(timings).toHaveLength(5);
  expect(timings[0]!.delay).toBe(1000);
  expect(timings.every((timing, index) => !index || timing.delay > timings[index - 1]!.delay)).toBe(true);
  await expect(panel.locator('h1')).toHaveCSS('opacity', '0');
  await expect(panel.getByRole('search').locator('input[name=q]')).toBeVisible();
  await expect(panel.getByRole('search').locator('input[name=q]')).toBeEditable();
  await panel.locator('.hero-reveal').evaluateAll((elements) => elements.forEach((element) => {
    element.getAnimations().forEach((animation) => { animation.currentTime = 5000; });
  }));
  await expect(panel.locator('h1')).toHaveCSS('opacity', '1');
  await panel.getByRole('search').locator('input[name=q]').fill('Osimert');
  await expect(panel).toHaveAttribute('data-revealed', 'true');
  await page.getByRole('button', { name: 'Next banner', exact: true }).click();
  await expect(panel.locator('h1')).toHaveCSS('opacity', '1');
  await expect(panel.getByRole('search').locator('input[name=q]')).toHaveValue('Osimert');
});

test('hero search and quote actions work over image and video backgrounds in both languages', async ({ page }) => {
  test.skip(process.env.BANNER_E2E_FIXTURES !== '1', 'Uses the dedicated public banner fixture.');
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const locale of ['en', 'zh-CN']) {
    await page.goto(`/${locale}`);
    const hero = page.locator('.placement-banner-hero');
    await hero.getByRole('button', { name: locale === 'en' ? 'Next banner' : '下一张横幅', exact: true }).click();
    await expect(hero.locator('video')).toBeVisible();
    await hero.hover();
    await expect(hero.getByRole('search')).toBeVisible();
    await hero.getByRole('button', { name: locale === 'en' ? 'Request a Quote' : '获取报价', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const query = locale === 'en' ? 'Osimert 80mg' : '奥希替尼 80mg';
    await hero.getByRole('search').locator('input[name=q]').fill(query);
    await hero.getByRole('search').locator('input[name=q]').press('Enter');
    await page.waitForURL((url) => url.pathname === `/${locale}/products`);
    expect(new URL(page.url()).searchParams.get('q')).toBe(query);
    await expect(page.locator('.product-card')).toHaveCount(1);
  }
});

test('explicit play resumes rotation with keyboard focus and reduced motion', async ({ page }) => {
  test.skip(process.env.BANNER_E2E_FIXTURES !== '1', 'Uses the dedicated public banner fixture.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en');
  const banner = page.locator('.placement-banner-hero');
  const slide = banner.getByRole('group');
  await page.clock.install();
  await page.clock.fastForward(6100);
  await expect(slide).toHaveAttribute('aria-label', '1 / 2');
  const play = banner.getByRole('button', { name: 'Play banner animation' });
  await play.focus();
  await play.press('Enter');
  await expect(banner.getByRole('button', { name: 'Pause banner animation' })).toBeVisible();
  await page.clock.fastForward(6100);
  await expect(slide).toHaveAttribute('aria-label', '2 / 2');
  await banner.getByRole('button', { name: 'Pause banner animation' }).press('Enter');
  await expect(banner.getByRole('button', { name: 'Play banner animation' })).toBeVisible();
  await page.clock.fastForward(6100);
  await expect(slide).toHaveAttribute('aria-label', '2 / 2');
});

test('video banners stay still with reduced motion and respond to play and pause', async ({ page }) => {
  test.skip(process.env.BANNER_E2E_FIXTURES !== '1', 'Uses the dedicated public banner fixture.');
  await page.route('**/products/s3/videos/banner-fixture.webm', (route) => route.fulfill({ contentType: 'video/webm', body: bannerVideo }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/blog');
  const banner = page.locator('.placement-banner-blog');
  await banner.getByRole('button', { name: 'Next banner' }).click();
  const media = banner.locator('video');
  await expect(media).toBeVisible();
  await expect.poll(() => media.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => media.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await banner.getByRole('button', { name: 'Play banner animation' }).click();
  await expect.poll(() => media.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await banner.getByRole('button', { name: 'Pause banner animation' }).click();
  await expect.poll(() => media.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
});
