import { expect as baseExpect, test, type Locator } from '@playwright/test';
import { installImageFixture } from './image-fixture';

const expect = baseExpect.configure({ timeout: 15_000 });

test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
});

async function chooseDropdown(form: Locator, key: 'manufacturer' | 'category' | 'generic', slug: string) {
  const field = form.locator(`[data-catalog-filter="${key}"]`);
  await field.locator('.filter-dropdown-trigger').click();
  await field.locator(`.filter-dropdown-options button[value="${slug}"]`).click();
}

test('catalog dropdown searches narrow options without submitting the products form', async ({ page }) => {
  test.setTimeout(90_000);
  const productSearch = 'Osimert 80mg';
  await page.goto(`/en/products?q=${encodeURIComponent(productSearch)}`, { timeout: 60_000 });
  const filters = [
    { key: 'manufacturer', slug: 'beacon', term: 'BEAC plc' },
    { key: 'category', slug: 'oncology', term: 'ONCO' },
    { key: 'generic', slug: 'osimertinib', term: 'mertin' },
  ];

  for (const { key, slug, term } of filters) {
    const field = page.locator(`[data-catalog-filter="${key}"]`);
    await field.locator('.filter-dropdown-trigger').click();
    const search = field.getByRole('searchbox');
    await search.fill('unmatched input');
    await expect(field.getByRole('status')).toHaveText('No matches found');
    await search.press('Enter');
    expect(new URL(page.url()).searchParams.has(key)).toBe(false);
    await search.fill(term);
    const option = field.locator(`button[value="${slug}"]`);
    await expect(option).toBeVisible();
    await expect(field.locator('button[value=""]')).toBeHidden();
    if (key === 'manufacturer') {
      await search.press('ArrowDown');
      await expect(option).toBeFocused();
      await option.press('Enter');
    } else {
      await search.press('Enter');
    }
    await expect(page).toHaveURL((url) => url.searchParams.get(key) === slug && url.searchParams.get('q') === productSearch);
    await field.locator('.filter-dropdown-trigger').click();
    await expect(search).toHaveValue('');
    await search.press('Escape');
    await expect(search).toBeHidden();
  }
  await expect(page.locator('.product-card')).toHaveCount(1);
});

const browseCases = [
  { key: 'manufacturer', directory: 'manufacturers', link: 'Browse by Manufacturer', all: 'All Manufacturers', slug: 'beacon', label: 'Beacon Pharmaceuticals PLC' },
  { key: 'generic', directory: 'generics', link: 'Browse by Generic', all: 'All Generics', slug: 'osimertinib', label: 'Osimertinib' },
];

for (const { key, directory, link, all, slug, label } of browseCases) {
  test(`${link} opens the catalog filter and replaces the directory`, async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.goto(`/en/products?browse=${key}`, { timeout: 60_000 });
    const field = page.locator(`[data-catalog-filter="${key}"]`);
    const trigger = field.locator('.filter-dropdown-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 40_000 });
    await page.goto('/en', { waitUntil: 'networkidle' });
    const products = page.locator('.desktop-nav').getByRole('button', { name: 'Products', exact: true });
    const browse = page.locator('.desktop-nav').getByRole('link', { name: link });
    const option = field.locator(`.filter-dropdown-options button[value="${slug}"]`);
    await products.hover();
    await browse.click();
    await expect(page).toHaveURL(/\/en\/products$/, { timeout: 40_000 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(option).toBeVisible();
    await expect(page.locator('.filter-dropdown-trigger[aria-expanded="true"]')).toHaveCount(1);
    await expect(trigger).toBeFocused();
    await trigger.press('ArrowDown');
    const allOption = field.getByRole('button', { name: all, exact: true });
    await expect(allOption).toBeFocused();
    await allOption.press('Escape');
    await expect(option).toBeHidden();

    await products.hover();
    await browse.click();
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL((url) => url.pathname === '/en/products' && url.search === `?${key}=${slug}`);
    await expect(trigger).toHaveText(label);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    for (const locale of ['en', 'zh-CN']) {
      const legacy = await request.get(`/${locale}/${directory}`, { maxRedirects: 0 });
      expect(legacy.status()).toBe(308);
      const destination = new URL(legacy.headers().location, legacy.url());
      expect(`${destination.pathname}${destination.search}`).toBe(`/${locale}/products?browse=${key}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/zh-CN/${directory}`);
    await expect(page).toHaveURL(/\/zh-CN\/products$/);
    await expect(field.locator(`.filter-dropdown-options button[value="${slug}-cn"]`)).toBeVisible();

    await page.goto('/en', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Toggle menu' }).click();
    await page.locator('#mobile-navigation').getByRole('link', { name: link }).click();
    await expect(page).toHaveURL(/\/en\/products$/);
    await expect(option).toBeVisible();
  });
}

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
    await chooseDropdown(form, 'manufacturer', manufacturer);
    await chooseDropdown(form, 'category', category);
    await chooseDropdown(form, 'generic', generic);
    await expect.poll(() => new URL(page.url()).searchParams.get('generic')).toBe(generic);
    const params = new URL(page.url()).searchParams;
    expect(params.get('manufacturer')).toBe(manufacturer);
    expect(params.get('category')).toBe(category);
    expect(params.get('q')).toBe(term);
    await expect(page.locator('.product-card')).toHaveCount(1);
    const letter = locale === 'en' ? 'O' : 'E';
    const alpha = form.locator('.filter-alpha');
    await alpha.getByRole('link', { name: letter, exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('initial')).toBe(letter);
    await expect(input).toHaveValue('');
    await expect(alpha.getByRole('link', { name: letter, exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('.product-card')).toContainText(locale === 'en' ? 'Osimert 80mg' : 'English-only medicine');
    await alpha.getByRole('link', { name: 'A', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('initial')).toBe('A');
    await expect(page.locator('.product-card')).toHaveCount(0);
    await form.locator('.alpha-all').click();
    await expect.poll(() => new URL(page.url()).searchParams.has('initial')).toBe(false);
    await expect(page.locator('.product-card')).toHaveCount(2);
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
  await chooseDropdown(form, 'manufacturer', 'beacon');
  await expect.poll(() => new URL(page.url()).searchParams.get('manufacturer')).toBe('beacon');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(new URL(page.url()).searchParams.get('limit')).toBe('1');
  await expect(page.locator('.product-card')).toContainText('Osimert 80mg');
  await chooseDropdown(form, 'category', 'oncology');
  await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe('oncology');
  await page.goBack();
  await expect(form.locator('input[name=manufacturer]')).toHaveValue('beacon');
  await expect(form.locator('input[name=category]')).toHaveValue('');
  await page.goForward();
  await expect(form.locator('input[name=category]')).toHaveValue('oncology');
  await page.reload();
  await expect(form.locator('input[name=manufacturer]')).toHaveValue('beacon');
  await expect(form.locator('input[name=category]')).toHaveValue('oncology');
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
