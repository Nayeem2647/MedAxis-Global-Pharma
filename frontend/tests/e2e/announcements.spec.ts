import { expect, test } from '@playwright/test';
import { installImageFixture } from './image-fixture';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.ANNOUNCEMENT_E2E_FIXTURES !== '1', 'Uses the dedicated announcement fixtures.');
  await installImageFixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://plausible.example.test/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
});

test('announcement pills sit between the two header bars across public pages and languages', async ({ page }, info) => {
  test.setTimeout(120_000);
  for (const path of ['/en', '/en/products', '/en/blog', '/zh-CN']) {
    await page.goto(path);
    const bar = page.locator('.announcement-bar');
    await expect(bar).toHaveCount(1);
    await expect(bar.locator('.announcement-pill')).toHaveCount(4);
    expect(await bar.evaluate((element) => element.previousElementSibling?.classList.contains('top-bar') && element.nextElementSibling?.classList.contains('site-header'))).toBe(true);
    await expect(page.locator('main .announcement-bar')).toHaveCount(0);
    await expect(bar.getByRole('link').first()).toHaveAttribute('href', '/en/products');
  }
  await page.goto('/en');
  for (const width of [1720, 1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, bottom: document.querySelector('.site-header')!.getBoundingClientRect().bottom }));
    expect(geometry.overflow).toBe(false);
    await page.screenshot({ path: info.outputPath(`announcement-header-${width}.png`), clip: { x: 0, y: 0, width, height: Math.ceil(geometry.bottom) } });
  }
});

test('announcement overflow controls and dismissal work on mobile without hiding navigation', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 950 });
  await page.goto('/en');
  const bar = page.getByRole('complementary', { name: 'Announcements', exact: true });
  const next = bar.getByRole('button', { name: 'Next announcements', exact: true });
  const previous = bar.getByRole('button', { name: 'Previous announcements', exact: true });
  await expect(next).toBeEnabled();
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(previous).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 950 });
  await expect(next).toBeHidden();
  const viewport = bar.locator('.announcement-viewport');
  await viewport.hover();
  await page.mouse.wheel(260, 0);
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  for (let index = 0; index < 4; index++) {
    await bar.getByRole('button', { name: /^Dismiss announcement:/ }).first().click();
  }
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.site-header')).toBeVisible();
  expect(await page.locator('.site-header').evaluate((element) => element.previousElementSibling?.classList.contains('top-bar'))).toBe(true);
});
