import { expect, test } from '@playwright/test';
import { installImageFixture } from './image-fixture';

test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
  await page.route('https://plausible.example.test/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
});

test('three-column list, quote actions, persistent bounded comparison and quick view work together', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/en/products?q=product-tools');
  const cards = page.locator('.product-card');
  await expect(cards).toHaveCount(4);
  await expect(page.locator('.cart-button')).toBeEnabled();
  await page.getByRole('button', { name: 'List View', exact: true }).click();
  await expect(page.locator('.product-grid')).toHaveClass(/is-list/);
  const positions = await cards.evaluateAll((elements) => elements.map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y }; }));
  expect(positions[0].y).toBe(positions[1].y); expect(positions[1].y).toBe(positions[2].y); expect(positions[3].y).toBeGreaterThan(positions[0].y);
  await cards.first().hover();
  await expect(cards.first().locator('.product-hover-actions')).toHaveCSS('opacity', '1');
  await cards.first().getByRole('button', { name: 'Add Osimert 80mg to quote', exact: true }).click();
  await expect(page.locator('.cart-badge')).toHaveText('1');
  for (let index = 0; index < 3; index++) { await cards.nth(index).hover(); await cards.nth(index).getByRole('button', { name: /to comparison$/ }).click(); }
  await cards.nth(3).hover(); await cards.nth(3).getByRole('button', { name: /to comparison$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'You can compare up to 3 products.' })).toBeVisible();
  await page.locator('.comparison-tray').getByRole('button', { name: 'Compare (3)', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: 'Compare products', exact: true });
  await expect(comparison.getByRole('table')).toBeVisible();
  await expect(comparison.getByRole('columnheader')).toHaveCount(4);
  await expect(comparison.getByRole('rowheader', { name: 'Active ingredient', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.comparison-tray').getByRole('button', { name: 'Compare (3)', exact: true })).toBeVisible();
  await cards.first().hover(); await cards.first().getByRole('button', { name: 'Quick view of Osimert 80mg', exact: true }).click();
  const quickView = page.getByRole('dialog', { name: 'Quick View', exact: true });
  await expect(quickView.getByRole('heading', { name: 'Osimert 80mg', exact: true })).toBeVisible();
  await quickView.getByRole('button', { name: 'Request a quote', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.getByRole('dialog').locator('input[name=name]')).toHaveValue('Osimert 80mg');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'List View', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('product-list-three-columns.png'), fullPage: true });
});

test('a saved customer rating can be updated without increasing its count', async ({ page }) => {
  await page.goto('/en/products?q=product-tools');
  const card = page.locator('.product-card').first();
  await card.locator('.customer-rating').click();
  const dialog = page.getByRole('dialog', { name: 'Rate this product', exact: true });
  await dialog.getByRole('radio', { name: '5 stars', exact: true }).check();
  await dialog.getByRole('button', { name: 'Submit rating', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Your rating has been saved.');
  await page.keyboard.press('Escape');
  await expect(card.locator('.customer-rating-count')).toHaveText('5.0 (1)');
  await card.locator('.customer-rating').click();
  await expect(dialog.getByRole('radio', { name: '5 stars', exact: true })).toBeChecked();
  await dialog.getByRole('radio', { name: '3 stars', exact: true }).check();
  await dialog.getByRole('button', { name: 'Update rating', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Your rating has been saved.');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(card.locator('.customer-rating-count')).toHaveText('3.0 (1)');
});

test('Chinese mobile controls are reachable without hover and dialogs stay inside the screen', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh-CN/products?q=product-tools');
  await expect(page.locator('.cart-button')).toBeEnabled();
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  const card = page.locator('.product-card').first();
  await card.focus();
  await card.locator('.product-hover-actions button').last().focus();
  await expect(card.locator('.product-hover-actions')).toHaveCSS('opacity', '1');
  await card.locator('.product-hover-actions button').last().click();
  await expect(page.getByRole('dialog', { name: '快速查看', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await card.locator('.customer-rating').click();
  await expect(page.getByRole('dialog', { name: '为此产品评分', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '1 星', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`product-tools-zh-${width}.png`), fullPage: true });
  }
});
