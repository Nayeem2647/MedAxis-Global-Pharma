import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { z } from 'zod';
import { catalogListSchema } from '../../lib/public-catalog';
import { rfqBusinessSchema } from '../../lib/rfq';
import { meta } from '../fixtures';
import { installImageFixture } from './image-fixture';

test.setTimeout(60000);
test.use({ actionTimeout: 10000 });

const apiOrigin = 'http://127.0.0.1:4100';
const cors = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3100' };

async function installCatalog(page: Page, request: APIRequestContext) {
  const response = await request.get(`${apiOrigin}/v1/public/products?locale=en`);
  const template = z.object({ data: catalogListSchema }).parse(await response.json()).data.products[0]!;
  const medicines = Array.from({ length: 12 }, (_, index) => {
    const name = `Catalog medicine ${index + 1}`;
    const slug = `catalog-medicine-${index + 1}`;
    return { ...template, id: `82f591d0-346b-4cc4-8d67-e25358fa02${String(index).padStart(2, '0')}`,
      sku: `CATALOG-${index + 1}`, brand_name: name, slug, alternate_slugs: { en: slug, zhCN: null },
      translations: { en: { brand_name: name, slug } }, strength: `${(index + 1) * 10} mg`, packaging_unit: 'PACK',
      dosage_form: index < 6 ? 'Tablet' : 'Capsule' };
  });
  const queries: URLSearchParams[] = [];
  await page.route(`${apiOrigin}/v1/public/products?**`, async (route) => {
    const parameters = new URL(route.request().url()).searchParams;
    queries.push(parameters);
    const query = (parameters.get('q') ?? '').toLowerCase();
    if (query === 'malformed') {
      await route.fulfill({ contentType: 'application/json', headers: cors, body: '{}' }); return;
    }
    if (query === 'slow') await new Promise((resolve) => setTimeout(resolve, 1000));
    let rows = medicines.filter((medicine) => `${medicine.brand_name} ${medicine.sku} ${medicine.generic.name} ${medicine.manufacturer.name}`.toLowerCase().includes(query));
    const forms = [...new Set(rows.map((medicine) => medicine.dosage_form))];
    if (parameters.get('dosage_form')) rows = rows.filter((medicine) => medicine.dosage_form === parameters.get('dosage_form'));
    const pageNumber = Number(parameters.get('page') ?? 1);
    const limit = Number(parameters.get('limit') ?? 5);
    const totalPages = Math.ceil(rows.length / limit);
    await route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true,
      data: { products: rows.slice((pageNumber - 1) * limit, pageNumber * limit), facets: { dosage_forms: forms.map((name) => ({ name, count: 6 })), cold_chain: [] } },
      meta: { ...meta, pagination: { page: pageNumber, limit, total_items: rows.length, total_pages: totalPages, has_next: pageNumber < totalPages, has_prev: pageNumber > 1 } } }) });
  });
  return { medicines, queries };
}

async function submitForm(page: Page) {
  const form = page.getByRole('main');
  await form.getByRole('button', { name: 'Continue to Delivery', exact: true }).click();
  await form.getByRole('combobox', { name: 'Country', exact: true }).fill('Bangladesh');
  await form.getByRole('option', { name: 'Bangladesh BD', exact: true }).click();
  await form.getByRole('button', { name: 'Patient Home', exact: true }).click();
  await form.locator('input[name=full_name]').fill('Catalog buyer');
  await form.locator('input[name=email]').fill('catalog@example.test');
  await form.getByRole('button', { name: 'Submit Quote Request', exact: true }).click();
}

function captureSubmission(page: Page, kind: 'quick-quote' | 'cart') {
  return new Promise<z.infer<typeof rfqBusinessSchema>>((resolve) => {
    void page.route(`${apiOrigin}/v1/public/rfq/${kind}`, async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'content-type,x-idempotency-key,accept', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } }); return;
      }
      const payload = rfqBusinessSchema.safeExtend({ idempotency_key: z.uuidv4(), turnstile_token: z.string().min(1) }).parse(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, meta,
        data: { rfq_id: crypto.randomUUID(), rfq_number: 'RFQ-2026-CATALOG', status: 'SUBMITTED', total_items: payload.items.length, created_at: meta.timestamp } }) });
      resolve(payload);
    });
  });
}

test.beforeEach(async ({ page }) => { await installImageFixture(page); });

test('quotation searches and filters the full catalog, paginates and submits the selected product identity', async ({ page, request }) => {
  const { medicines, queries } = await installCatalog(page, request);
  const submitted = captureSubmission(page, 'quick-quote');
  await page.goto('/en/request-quote');
  const search = page.locator('.rfq-search-wrap');
  await search.getByLabel('Search medicines', { exact: true }).click();
  await expect(search.getByRole('status')).toHaveText('12 medicines found');
  await search.getByRole('button', { name: 'Next medicines', exact: true }).click();
  await expect(search).toContainText('Page 2 of 2');
  await search.getByRole('combobox', { name: 'Dosage form', exact: true }).selectOption('Capsule');
  await expect(search.getByRole('status')).toHaveText('6 medicines found');
  await expect(search.getByRole('button', { name: 'Add Catalog medicine 1 to quotation', exact: true })).toHaveCount(0);
  await search.getByLabel('Search medicines', { exact: true }).fill('CATALOG-12');
  await expect(search.getByRole('status')).toHaveText('1 medicine found');
  await search.getByRole('button', { name: 'Add Catalog medicine 12 to quotation', exact: true }).click();
  const form = page.getByRole('main');
  await expect(form.locator('.rfq-selected-list')).toContainText('Catalog medicine 12');
  await expect(form.getByRole('combobox', { name: 'Packaging unit for Catalog medicine 12', exact: true })).toHaveValue('PACK');
  await form.getByRole('spinbutton', { name: 'Quantity for Catalog medicine 12', exact: true }).fill('4');
  await expect(form.locator('.quote-summary-items-list')).toContainText('4 PACK');
  await submitForm(page);
  expect((await submitted).items).toEqual([{ is_uncatalogued: false, product_id: medicines[11]!.id, quantity: 4, packaging_unit: 'PACK' }]);
  await expect(form).toContainText('RFQ-2026-CATALOG');
  expect(queries.some((query) => query.get('dosage_form') === 'Capsule' && query.get('q') === 'CATALOG-12' && query.get('page') === '1')).toBe(true);
});

test('search handles empty results, invalid responses, retry, stale requests and mobile layout', async ({ page, request }, info) => {
  await installCatalog(page, request);
  await page.goto('/en/request-quote');
  const search = page.locator('.rfq-search-wrap');
  const input = search.getByLabel('Search medicines', { exact: true });
  await input.fill('no matches');
  await expect(search.getByRole('status')).toHaveText('No medicines found. Try another search or dosage form.');
  await input.fill('malformed');
  await expect(search.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible();
  await search.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(search.getByRole('status')).toHaveText('Medicines could not be loaded. Please try again.');
  const slow = page.waitForRequest((request) => new URL(request.url()).searchParams.get('q') === 'slow');
  await input.fill('slow'); await slow; await input.fill('Beacon');
  await expect(search.getByRole('status')).toHaveText('12 medicines found');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Continue to Delivery', exact: true })).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('main *')].filter((element) => { const r = element.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })).slice(0, 20) })); expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    if (width === 1440 || width === 320) await page.screenshot({ path: info.outputPath(`medicine-search-${width}.png`), fullPage: true });
  }
  await input.click();
  await expect(search.getByRole('status')).toHaveText('12 medicines found');
});

test('replacing a catalog selection with a custom medicine submits the custom identity', async ({ page, request }) => {
  await installCatalog(page, request); const submitted = captureSubmission(page, 'quick-quote');
  await page.goto('/en/request-quote');
  await page.getByLabel('Search medicines', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Catalog medicine 1 to quotation', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Catalog medicine 1', exact: true }).click();
  await page.getByRole('button', { name: "Can't find it? Add custom medicine", exact: true }).click();
  const custom = page.getByRole('region', { name: 'Add custom medicine', exact: true });
  await custom.getByLabel('Medicine / Generic Name', { exact: true }).fill('Custom request');
  await custom.getByLabel('Strength / Dose', { exact: true }).fill('25 mg');
  await custom.getByRole('button', { name: 'Add to list', exact: true }).click();
  await submitForm(page);
  expect((await submitted).items).toEqual([{ is_uncatalogued: true, custom_medicine_name: 'Custom request', custom_strength: '25 mg', quantity: 1, packaging_unit: 'BOX' }]);
});

test('several catalog selections and quantity edits submit the quotation as a cart RFQ', async ({ page, request }) => {
  const { medicines } = await installCatalog(page, request); const submitted = captureSubmission(page, 'cart');
  await page.goto('/en/request-quote'); await page.getByLabel('Search medicines', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Catalog medicine 1 to quotation', exact: true }).click();
  await page.getByLabel('Search medicines', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Catalog medicine 2 to quotation', exact: true }).click();
  await page.getByRole('button', { name: 'Increase quantity for Catalog medicine 2', exact: true }).click();
  await expect(page.locator('.rfq-selected-list > li')).toHaveCount(2);
  await expect(page.locator('.quote-summary-items-list')).toContainText('2 PACK');
  await submitForm(page);
  expect((await submitted).items).toEqual([
    { is_uncatalogued: false, product_id: medicines[0]!.id, quantity: 1, packaging_unit: 'PACK' },
    { is_uncatalogued: false, product_id: medicines[1]!.id, quantity: 2, packaging_unit: 'PACK' },
  ]);
  await expect(page.getByRole('main')).toContainText('RFQ-2026-CATALOG');
});
