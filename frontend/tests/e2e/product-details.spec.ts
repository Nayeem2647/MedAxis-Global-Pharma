import { test, expect } from '@playwright/test';

for (const locale of ['en', 'zh-CN']) {
  test(`${locale}: four-line product preview expands and related products scroll below it`, async ({ page }) => {
    const chinese = locale === 'zh-CN';
    await page.goto(`/${locale}/products/detail-preview-0${chinese ? '-cn' : ''}`);
    const disclosure = page.locator('.product-details-disclosure');
    const preview = disclosure.locator('.product-description-preview p');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS('-webkit-line-clamp', '4');
    const measurement = await preview.evaluate((element) => ({ height: element.clientHeight, full: element.scrollHeight, line: parseFloat(getComputedStyle(element).lineHeight) }));
    expect(measurement.height).toBeLessThanOrEqual(measurement.line * 4 + 1);
    expect(measurement.full).toBeGreaterThan(measurement.height);
    const more = disclosure.getByRole('button', { name: chinese ? '查看更多' : 'See More', exact: true });
    await more.click();
    await expect(disclosure.getByRole('button', { name: chinese ? '收起' : 'See Less', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(disclosure.locator('.product-rich-description h3')).toBeVisible();
    await expect(disclosure.locator('.product-rich-description li')).toHaveText('Manufacturer instructions apply.');
    expect(await page.evaluate(() => 'NEVER_EXECUTE_CATALOG_SCRIPT' in globalThis)).toBe(false);
    await disclosure.getByRole('button', { name: chinese ? '收起' : 'See Less', exact: true }).click();
    await expect(preview).toBeVisible();
    await expect(disclosure.locator('.product-rich-description')).toBeHidden();
    const similar = page.locator('.similar-products');
    await expect(similar.getByRole('heading', { name: chinese ? '相关产品' : 'Similar Products' })).toBeVisible();
    await expect(similar.locator('.product-card')).toHaveCount(6);
    await expect(similar.getByRole('link', { name: chinese ? '产品资料示例 0' : 'Detail preview medicine 0', exact: true })).toHaveCount(0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const next = similar.getByRole('button', { name: chinese ? '下一组相关产品' : 'Next similar products' });
      await expect(next).toBeEnabled();
      await next.click();
      await expect.poll(() => similar.locator('.similar-products-track').evaluate((element) => element.scrollLeft)).toBeGreaterThan(20);
      await similar.locator('.similar-products-track').evaluate((element) => element.scrollTo({ left: 0, behavior: 'instant' }));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
    }
    const link = similar.locator('.product-card-link').first();
    const destination = await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
  });
}
