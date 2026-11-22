import { expect as baseExpect, test } from '@playwright/test';
import { installImageFixture } from './image-fixture';

const expect = baseExpect.configure({ timeout: 15_000 });

test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
});

for (const locale of ['en', 'zh-CN']) {
  test(`${locale}: live search and combined filters retain the document, focus, banner and scroll`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/${locale}/products`, { waitUntil: 'networkidle' });
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.resourceType() === 'document') documents.push(request.url());
    });
    const form = page.locator('.catalog-filters');
    const input = form.locator('input[name=q]');
    await expect(input).toBeEditable();
    await expect(page.locator('.product-card')).toHaveCount(2);
    await page.evaluate(() => {
      document.documentElement.dataset.filterDocument = 'retained';
      document.querySelector<HTMLInputElement>('input#catalog-filter-q')!.dataset.filterInput = 'retained';
      const banner = document.querySelector<HTMLElement>('.products-banner-slot');
      if (banner) banner.dataset.filterBanner = 'retained';
    });
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    const scroll = await page.evaluate(() => scrollY);
    const term = locale === 'en' ? 'Osimert 80mg' : '奥希替尼 80mg';
    if (locale === 'en') await input.pressSequentially(term, { delay: 25 });
    else await input.fill(term);
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(term);
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('data-filter-input', 'retained');
    expect(Math.abs(await page.evaluate(() => scrollY) - scroll)).toBeLessThan(5);

    const manufacturer = locale === 'en' ? 'beacon' : 'beacon-cn';
    const category = locale === 'en' ? 'oncology' : 'oncology-cn';
    const generic = locale === 'en' ? 'osimertinib' : 'osimertinib-cn';
    await form.locator('select[name=manufacturer]').selectOption(manufacturer);
    await form.locator('select[name=category]').selectOption(category);
    await form.locator('select[name=generic]').selectOption(generic);
    await expect.poll(() => new URL(page.url()).searchParams.get('generic')).toBe(generic);
    const params = new URL(page.url()).searchParams;
    expect(params.get('manufacturer')).toBe(manufacturer);
    expect(params.get('category')).toBe(category);
    expect(params.get('q')).toBe(term);
    await expect(page.locator('.product-card')).toHaveCount(1);
    await form.locator('.filter-alpha').getByRole('link', { name: 'O', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('O');
    await expect(input).toHaveValue('O');
    await form.locator('.alpha-all').click();
    await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
    await expect(input).toHaveValue('');
    expect(new URL(page.url()).searchParams.get('manufacturer')).toBe(manufacturer);
    await expect(page.locator('html')).toHaveAttribute('data-filter-document', 'retained');
    const banner = page.locator('.products-banner-slot');
    if (await banner.count()) await expect(banner).toHaveAttribute('data-filter-banner', 'retained');
    expect(documents).toEqual([]);
  });
}

test('filter navigation resets pagination and restores controls on back, forward and reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/products?limit=1&page=2');
  const form = page.locator('.catalog-filters');
  await expect(page.locator('.product-card')).toContainText('English-only medicine');
  await form.locator('select[name=manufacturer]').selectOption('beacon');
  await expect.poll(() => new URL(page.url()).searchParams.get('manufacturer')).toBe('beacon');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(new URL(page.url()).searchParams.get('limit')).toBe('1');
  await expect(page.locator('.product-card')).toContainText('Osimert 80mg');
  await form.locator('select[name=category]').selectOption('oncology');
  await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe('oncology');
  await page.goBack();
  await expect(form.locator('select[name=manufacturer]')).toHaveValue('beacon');
  await expect(form.locator('select[name=category]')).toHaveValue('');
  await page.goForward();
  await expect(form.locator('select[name=category]')).toHaveValue('oncology');
  await page.reload();
  await expect(form.locator('select[name=manufacturer]')).toHaveValue('beacon');
  await expect(form.locator('select[name=category]')).toHaveValue('oncology');
  await expect(page.locator('.product-card')).toContainText('Osimert 80mg');
  await page.locator('.pagination a[rel=next]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
  await expect(page.locator('.product-card')).toContainText('English-only medicine');
  await form.locator('input[name=q]').fill('Osimert 80mg');
  await expect(page.locator('.product-card')).toContainText('Osimert 80mg');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
});

test('new typing supersedes a slow search without losing the latest input', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/en/products');
  const input = page.locator('.catalog-filters input[name=q]');
  const started = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/en/products' && url.searchParams.get('q') === 'slow';
  });
  await input.fill('slow');
  await started;
  await input.fill('Osimert 80mg');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Osimert 80mg');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(input).toHaveValue('Osimert 80mg');
  await expect(input).toBeFocused();
  await expect(page.locator('.product-card')).toContainText('Osimert 80mg');
  await expect(page.locator('.catalog-filters')).toHaveAttribute('aria-busy', 'false');
});

test('Chinese composition waits for the completed search term', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/zh-CN/products');
  const input = page.locator('.catalog-filters input[name=q]');
  await expect(input).toBeEditable();
  await input.dispatchEvent('compositionstart');
  await input.fill('奥希替尼 80mg');
  await page.waitForTimeout(500);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  await input.dispatchEvent('compositionend');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('奥希替尼 80mg');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(input).toHaveValue('奥希替尼 80mg');
});
