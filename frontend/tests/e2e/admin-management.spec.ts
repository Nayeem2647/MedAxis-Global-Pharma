import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { z } from 'zod';
import { workflowIds as ids } from '../admin-fixtures';
const api = 'http://127.0.0.1:4100';

test('searchable dropdowns paginate, search Chinese names and save multiple category IDs', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'dropdown-controls', 30_000);
  await page.goto('/admin/catalog/products/new');
  const manufacturer = page.getByRole('combobox', { name: 'Search manufacturer', exact: true });
  const generic = page.getByRole('combobox', { name: 'Search generic', exact: true });
  const categories = page.getByRole('combobox', { name: 'Search categories', exact: true });
  await expect(manufacturer).toBeEnabled();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await manufacturer.click();
  const makers = page.getByRole('group', { name: 'Manufacturer', exact: true });
  await makers.getByRole('button', { name: 'Next options', exact: true }).click();
  await makers.getByRole('option', { name: /^Directory manufacturer 21/ }).click();
  await expect(manufacturer).toHaveAttribute('aria-expanded', 'false');
  await expect(manufacturer).toHaveValue('Directory manufacturer 21');
  await page.getByRole('button', { name: 'Clear manufacturer', exact: true }).click();
  await expect(page.locator('input[name="manufacturer_id"]')).toHaveCount(0);
  await manufacturer.fill('中文');
  await expect(makers.getByRole('status')).toHaveText('22 matches · Page 1 of 2');
  await makers.getByRole('option', { name: /^Fixture manufacturer/ }).click();
  await generic.click();
  await expect(page.getByRole('option', { name: /^Fixture generic/ })).toBeVisible();
  await generic.press('ArrowDown'); await generic.press('Enter');
  await expect(generic).toHaveValue('Fixture generic');
  await categories.click();
  const categoryGroup = page.getByRole('group', { name: 'Categories', exact: true });
  await categoryGroup.getByRole('option', { name: /^Fixture category/ }).click();
  await categories.press('Escape');
  await expect(categories).toHaveValue('Fixture category');
  await expect(categories).toHaveAttribute('title', 'Fixture category');
  await categories.click();
  await categoryGroup.getByRole('option', { name: /^Additional category/ }).click();
  await expect(categoryGroup.locator('input[name="category_ids"]')).toHaveCount(2);
  await categoryGroup.getByRole('button', { name: 'Remove Fixture category', exact: true }).click();
  await expect(categoryGroup.locator('input[name="category_ids"]')).toHaveCount(1);
  await categoryGroup.getByRole('option', { name: /^Fixture category/ }).click();
  await categories.press('Escape');
  await expect(categories).toHaveAttribute('aria-expanded', 'false');
  await expect(categories).toHaveValue('Additional category, Fixture category');
  await expect(categories).toHaveAttribute('title', 'Additional category, Fixture category');
  await expect(categoryGroup.locator('.admin-picker-selection')).toHaveCount(2);
  await page.getByLabel('Product name (EN)').fill('Dropdown medicine');
  await page.getByLabel('sku', { exact: true }).fill('DROPDOWN-001');
  await page.getByLabel('Strength', { exact: false }).fill('80 mg');
  await page.getByLabel('Dosage form', { exact: false }).fill('Tablet');
  await page.getByLabel('Pack size', { exact: false }).fill('30 tablets');
  await page.getByLabel('Packaging unit', { exact: false }).selectOption('BOX');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Saved successfully: Dropdown medicine.', { exact: true })).toBeVisible();
  const saved = await state(request, email);
  expect(saved.writes).toHaveLength(1);
  expect(saved.writes[0]).toMatchObject({ body: { manufacturer_id: ids.manufacturer, generic_id: ids.rfq, category_ids: [ids.prescription, ids.quote] } });
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(manufacturer).toHaveValue('Fixture manufacturer');
  await expect(generic).toHaveValue('Fixture generic');
  await expect(categoryGroup.locator('.admin-picker-selection')).toHaveCount(2);
  await expect(categories).toHaveValue('Additional category, Fixture category');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect((await page.locator('.product-master-grid').boundingBox())!.height).toBeLessThan(180);
  await page.locator('.product-medicine-card').screenshot({ path: 'test-results/master-dropdowns-desktop.png' });
});

test('dropdowns preserve selection through search errors, Escape and outside clicks on mobile', async ({ page, request }) => {
  test.setTimeout(90_000);
  await setup(page, request, 'dropdown-controls', 30_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/admin/catalog/products/${ids.rfq}`);
  const manufacturer = page.getByRole('combobox', { name: 'Search manufacturer', exact: true });
  await expect(manufacturer).toHaveValue('Fixture manufacturer');
  let failed = false;
  await page.route(/\/api\/admin\/catalog\/manufacturers(?:\?.*)?$/, async (route) => {
    if (!failed) { failed = true; await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, error: { status: 422, code: 'VALIDATION_FAILED', message: 'Fixture read error.' }, meta: { timestamp: new Date().toISOString(), request_id: randomUUID() } }) }); }
    else await route.continue();
  });
  await manufacturer.click();
  await expect(page.getByText('Options could not be loaded', { exact: true })).toBeVisible();
  await expect(page.locator('input[name="manufacturer_id"]')).toHaveValue(ids.manufacturer);
  await page.getByRole('button', { name: 'Retry options', exact: true }).click();
  await expect(page.getByRole('option', { name: /^Fixture manufacturer/ })).toBeVisible();
  await manufacturer.fill('no-match-98765');
  await expect(page.getByText('No matching active manufacturer.', { exact: true })).toBeVisible();
  await manufacturer.press('Escape');
  await expect(manufacturer).toHaveValue('Fixture manufacturer');
  await manufacturer.press('ArrowDown');
  await expect(page.getByRole('option', { name: /^Fixture manufacturer/ })).toBeVisible();
  await manufacturer.press('Escape');
  const generic = page.getByRole('combobox', { name: 'Search generic', exact: true });
  await expect(page.getByRole('combobox', { name: 'Search categories', exact: true })).toHaveValue('Fixture category');
  await generic.click();
  await expect(page.getByRole('listbox', { name: 'Generic options', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/master-dropdown-mobile.png' });
  await page.getByLabel('sku', { exact: true }).click();
  await expect(generic).toHaveAttribute('aria-expanded', 'false');
  await expect(generic).toHaveValue('Fixture generic');
});

for (const [kind, label] of [['manufacturers', 'Manufacturer'], ['generics', 'Generic'], ['categories', 'Category']] as const) {
  test(`confirmed ${kind} creation clears every input and allows another independent entry`, async ({ page, request }) => {
    test.setTimeout(90_000);
    const email = await setup(page, request, 'management', 30_000);
    await page.goto(`/admin/catalog/${kind}/new`);
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
    const name = page.getByLabel(`${label} name (EN)`, { exact: true });
    await name.fill(`First ${label}`);
    if (kind === 'generics') await page.getByLabel('Therapeutic indications (one per line)').fill('Verified indication for the first record.');
    if (kind === 'categories') await page.getByLabel('Sort order', { exact: true }).fill('9');
    await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
    await page.getByRole('textbox', { name: `${label} name (ZH)` }).fill('测试资料');
    if (kind === 'generics') await page.getByRole('group', { name: 'Chinese generic details' }).getByRole('textbox', { name: /^Description/ }).fill('人工核实的说明。');
    else {
      await page.locator(`#${kind === 'manufacturers' ? 'manufacturer-logo' : 'category-picture'}`).setInputFiles('public/images/medaxis-logo.png');
      await expect(page.getByRole('img', { name: `${label} ${kind === 'manufacturers' ? 'logo' : 'picture'} preview`, exact: true })).toBeVisible();
    }
    await page.locator('.admin-manufacturer-optional summary').click();
    await page.locator('input[name="en_slug"]').fill(`first-${kind}`);
    await page.locator('input[name="en_seo_title"]').fill('First record SEO');
    await page.getByRole('checkbox', { name: 'I verified these details' }).check();
    await page.getByRole('button', { name: 'Submit', exact: true }).evaluate((node) => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    await expect(page.getByText(`Saved successfully: First ${label}.`, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/admin/catalog/${kind}/new$`));
    await expect(page.getByRole('heading', { name: `Add New ${label}`, exact: true })).toBeVisible();
    await expect(name).toHaveValue('');
    await expect(page.locator('input[name="en_slug"]')).toHaveValue('');
    await expect(page.locator('input[name="en_seo_title"]')).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'I verified these details' })).not.toBeChecked();
    await expect(page.getByRole('img', { name: /(?:logo|picture) preview/ })).toHaveCount(0);
    if (kind === 'generics') await expect(page.getByLabel('Therapeutic indications (one per line)')).toHaveValue('');
    if (kind === 'categories') await expect(page.getByLabel('Sort order', { exact: true })).toHaveValue('0');
    const first = await state(request, email);
    expect(first.writes).toHaveLength(1);
    await name.fill(`Second ${label}`);
    await page.getByRole('checkbox', { name: 'I verified these details' }).check();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText(`Saved successfully: Second ${label}.`, { exact: true })).toBeVisible();
    const next = await state(request, email);
    expect(next.writes).toHaveLength(2);
    expect(next.writes[1]).toMatchObject({ path: `catalog/${kind}`, body: { translations: { en: { name: `Second ${label}` } } } });
    expect(next.writes[1]!.body).not.toHaveProperty('id');
    expect(next.writes[1]!.body).not.toHaveProperty('logo_data_url');
    expect(next.writes[1]!.body).not.toHaveProperty('translations.zhCN');
    await page.getByRole('link', { name: 'View saved record', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Edit Second ${label}`, exact: true })).toBeVisible();
    await expect(name).toHaveValue(`Second ${label}`);
    await name.fill(`Edited ${label}`);
    await page.getByRole('checkbox', { name: 'I verified these details' }).check();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
    await expect(name).toHaveValue(`Edited ${label}`);
    await expect(page.getByRole('link', { name: 'View saved record', exact: true })).toHaveCount(0);
  });
}

test('failed new generic submission keeps the entered data until a confirmed save', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'management', 30_000);
  await page.route(/\/api\/admin\/catalog\/generics$/, (route) => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, error: { status: 422, code: 'VALIDATION_FAILED', message: 'Check fields.', details: [{ field: 'translations.en.name', issue: 'Invalid name.' }] }, meta: { timestamp: new Date().toISOString(), request_id: randomUUID() } }) }));
  await page.goto('/admin/catalog/generics/new');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await page.getByLabel('Generic name (EN)', { exact: true }).fill('Keep this entry');
  await page.getByLabel('Therapeutic indications (one per line)').fill('Keep this verified indication.');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Correct the listed form fields before submitting again.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Generic name (EN)', { exact: true })).toHaveValue('Keep this entry');
  await expect(page.getByLabel('Therapeutic indications (one per line)')).toHaveValue('Keep this verified indication.');
  await expect(page.getByRole('link', { name: 'View saved record', exact: true })).toHaveCount(0);
  expect((await state(request, email)).writes).toHaveLength(0);
});

test('confirmed announcement creation clears copy and schedule while editing keeps saved values', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'management', 30_000);
  await page.goto('/admin/catalog/banners/new');
  await expect(page.getByRole('button', { name: 'Create record', exact: true })).toBeEnabled();
  await page.locator('input[name="en_title"]').fill('Sourcing update');
  await page.locator('textarea[name="en_body"]').fill('Send your sourcing requirements.');
  await page.getByLabel('Starts at (UTC, optional)', { exact: true }).fill('2031-01-02T10:00:00');
  await page.getByLabel('Ends at (UTC, optional)', { exact: true }).fill('2031-01-03T10:00:00');
  await page.getByLabel('Public relative link (optional)', { exact: true }).fill('/en/products');
  await page.getByLabel('Sort order', { exact: true }).fill('8');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Create record', exact: true }).click();
  await expect(page.getByText('Saved successfully: Sourcing update.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/catalog\/banners\/new$/);
  await expect(page.locator('input[name="en_title"]')).toHaveValue('');
  await expect(page.locator('textarea[name="en_body"]')).toHaveValue('');
  await expect(page.getByLabel('Starts at (UTC, optional)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Ends at (UTC, optional)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Public relative link (optional)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Sort order', { exact: true })).toHaveValue('0');
  await expect(page.getByRole('checkbox', { name: 'I verified these details' })).not.toBeChecked();
  expect((await state(request, email)).writes).toHaveLength(1);
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.locator('input[name="en_title"]')).toHaveValue('Sourcing update');
  await expect(page.getByLabel('Starts at (UTC, optional)', { exact: true })).toHaveValue('2031-01-02T10:00');
  await page.locator('input[name="en_title"]').fill('Edited sourcing update');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  await expect(page.locator('input[name="en_title"]')).toHaveValue('Edited sourcing update');
  await expect(page.getByLabel('Starts at (UTC, optional)', { exact: true })).toHaveValue('2031-01-02T10:00');
});

test('generic long indications save with normalized slugs and automatic Chinese description', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'generic-translation', 30_000);
  await page.goto('/admin/catalog/generics/new');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  const source = 'Verified medicine indication with EGFR T790M details. '.repeat(20).trim();
  await page.getByLabel('Generic name (EN)', { exact: true }).fill('Osimertinib');
  await page.getByLabel('Therapeutic indications (one per line)').fill(source);
  await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
  await page.getByRole('textbox', { name: 'Generic name (ZH)' }).fill('奥希替尼');
  const chinese = page.getByRole('group', { name: 'Chinese generic details' });
  await chinese.getByLabel('Page slug').fill('Osimertinib, Osimert, Tagrix,');
  await chinese.getByLabel('Page slug').blur();
  await expect(chinese.getByLabel('Page slug')).toHaveValue('osimertinib-osimert-tagrix');
  await expect(chinese.getByRole('textbox', { name: /^Description/ })).toHaveValue('经核实的适应症说明。EGFR T790M。');
  await page.getByLabel('Therapeutic indications (one per line)').fill('Updated verified EGFR T790M indication.');
  await expect(chinese.getByRole('textbox', { name: /^Description/ })).toHaveValue('更新后的适应症说明。EGFR T790M。');
  await page.getByLabel('Therapeutic indications (one per line)').fill(source);
  await expect(chinese.getByRole('textbox', { name: /^Description/ })).toHaveValue('经核实的适应症说明。EGFR T790M。');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit Osimertinib', exact: true })).toBeVisible({ timeout: 20_000 });
  const saved = await state(request, email);
  expect(saved.writes).toHaveLength(1);
  expect(saved.writes[0]).toMatchObject({ body: { therapeutic_indications: [source], translations: { en: { slug: 'osimertinib' }, zhCN: { slug: 'osimertinib-osimert-tagrix', description: '经核实的适应症说明。EGFR T790M。' } } } });
});

test('generic manual Chinese edits survive delayed translation and missing configuration', async ({ page, request }) => {
  test.setTimeout(90_000);
  await setup(page, request, 'generic-translation', 30_000);
  await page.goto('/admin/catalog/generics/new');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
  const chinese = page.getByRole('group', { name: 'Chinese generic details' });
  const sent = page.waitForRequest((request) => request.url().endsWith('/api/admin/catalog/translate-indications'));
  await page.getByLabel('Therapeutic indications (one per line)').fill('Slow verified EGFR T790M indication.');
  await sent;
  await chinese.getByRole('textbox', { name: /^Description/ }).fill('人工核实的中文说明。');
  await expect(chinese.getByRole('checkbox', { name: 'Automatically fill Chinese description' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await page.getByLabel('Therapeutic indications (one per line)').fill('Updated verified EGFR T790M indication.');
  await expect(chinese.getByRole('textbox', { name: /^Description/ })).toHaveValue('人工核实的中文说明。');
  await page.reload();
  await setup(page, request, 'management', 30_000);
  await page.goto('/admin/catalog/generics/new');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await page.getByLabel('Therapeutic indications (one per line)').fill('Verified EGFR T790M information.');
  await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
  await expect(page.getByRole('alert').filter({ hasText: 'Automatic translation is not configured' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
});

test('product form publishes six pictures, optional video and localized SEO with one save', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = await setup(page, request, 'product-form-media', 30_000);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await page.route('https://cdn.medaxisglobalpharma.com/products/s3/*.png', (route) => route.fulfill({ contentType: 'image/png', body: png }));
  await page.goto('/admin/catalog/products/new');
  await expect(page.getByRole('button', { name: 'Publish product', exact: true })).toBeEnabled();
  await page.getByLabel('Product name (EN)').fill('Catalog medicine');
  const description = page.getByRole('textbox', { name: 'Description (EN)', exact: true });
  await description.fill('Verified product description');
  await description.evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await page.getByRole('button', { name: 'Bold', exact: true }).first().click();
  await expect(description.locator('strong')).toHaveText('Verified product description');
  await page.getByLabel('Strength', { exact: false }).fill('80 mg');
  await page.getByLabel('Dosage form', { exact: false }).fill('Tablet');
  await page.getByLabel('Pack size', { exact: false }).fill('30 tablets');
  await page.getByLabel('Packaging unit', { exact: false }).selectOption('BOX');
  await page.getByRole('button', { name: 'Generate SKU', exact: true }).click();
  await expect(page.getByLabel('sku', { exact: true })).toHaveValue(/^MED-/);
  for (const [group, name] of [['Manufacturer', 'Fixture manufacturer'], ['Generic', 'Fixture generic'], ['Categories', 'Fixture category']]) {
    const picker = page.getByRole('group', { name: group, exact: true });
    await picker.getByRole('combobox').click();
    await picker.getByRole('option', { name: new RegExp(name!) }).click();
  }
  await page.getByRole('heading', { name: 'Product images', exact: true }).click();
  await page.getByLabel('Upload product image', { exact: true }).setInputFiles({ name: 'main.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('img', { name: 'Main product image preview' })).toBeVisible();
  await page.getByLabel('Upload additional pictures', { exact: true }).setInputFiles(Array.from({ length: 5 }, (_, i) => ({ name: `extra-${i}.png`, mimeType: 'image/png', buffer: png })));
  await expect(page.getByLabel('Upload additional pictures', { exact: true })).toBeDisabled();
  await expect(page.getByRole('img', { name: /^Additional product image/ })).toHaveCount(5);
  const formerAdditional = await page.getByRole('img', { name: 'Additional product image 1', exact: true }).getAttribute('src');
  await page.getByRole('button', { name: 'Set as main', exact: true }).first().click();
  await expect(page.getByRole('img', { name: 'Main product image preview' })).toHaveAttribute('src', formerAdditional!);
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!; context.fillStyle = '#078599'; context.fillRect(0, 0, 32, 32);
    const stream = canvas.captureStream(10); const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }); const chunks: BlobPart[] = [];
    return await new Promise<number[]>((resolve) => {
      let frames = 0;
      const timer = setInterval(() => { context.fillStyle = frames++ % 2 ? '#078599' : '#203d4c'; context.fillRect(0, 0, 32, 32); }, 50);
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => { clearInterval(timer); stream.getTracks().forEach((track) => track.stop()); void new Blob(chunks, { type: 'video/webm' }).arrayBuffer().then((data) => resolve([...new Uint8Array(data)])); };
      recorder.start(); setTimeout(() => recorder.stop(), 1000);
    });
  });
  const video = Buffer.from(videoBytes);
  await page.route('https://cdn.medaxisglobalpharma.com/products/s3/videos/**', (route) => route.fulfill({ contentType: 'video/webm', body: video }));
  await page.getByLabel('Upload product video', { exact: true }).setInputFiles({ name: 'product.webm', mimeType: 'video/webm', buffer: video });
  await expect(page.getByLabel('Product video preview', { exact: true })).toBeVisible();
  await page.getByLabel('Product video preview', { exact: true }).evaluate((node) => (node as HTMLVideoElement).load());
  await expect.poll(() => page.getByLabel('Product video preview', { exact: true }).evaluate((node) => { const video = node as HTMLVideoElement; return { width: video.videoWidth, error: video.error?.message, state: video.readyState }; }), { timeout: 15_000 }).toMatchObject({ width: 32 });
  await page.getByLabel('Meta title (EN)').fill('Catalog medicine sourcing');
  await page.getByLabel('Meta description (EN)').fill('Request details and a private quotation for this medicine.');
  await expect(page.getByLabel('Search result preview')).toContainText('Catalog medicine sourcing | MedAxis Global Pharma');
  await page.getByLabel('Chinese translation', { exact: true }).check();
  await page.getByRole('tab', { name: '中文 (ZH)', exact: true }).click();
  await page.getByLabel('Product name (ZH)').fill('产品资料');
  await page.getByLabel('Meta title (ZH)').fill('产品采购资料');
  await page.getByRole('tab', { name: 'English (EN)', exact: true }).click();
  await expect(page.getByLabel('Meta title (EN)')).toHaveValue('Catalog medicine sourcing');
  await page.getByRole('button', { name: 'Publish product', exact: true }).evaluate((node) => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(page.getByText('Saved successfully: Catalog medicine.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/catalog\/products\/new$/);
  await expect(page.getByLabel('Product name (EN)')).toHaveValue('');
  await expect(page.getByLabel('sku', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Meta title (EN)')).toHaveValue('');
  await expect(page.getByRole('img', { name: /^Additional product image/ })).toHaveCount(0);
  await expect(page.getByLabel('Product video preview', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Chinese translation', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('DRAFT');
  await expect(page.locator('.admin-picker-selection')).toHaveCount(0);
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit Product', exact: true })).toBeVisible({ timeout: 20_000 });
  const saved = await state(request, email);
  const writes = saved.writes.filter((write) => write.path === 'catalog/products');
  expect(writes).toHaveLength(1);
  const body = z.object({ image_keys: z.array(z.string()), video_key: z.string(), status: z.string(), translations: z.object({ en: z.object({ slug: z.string(), description: z.string(), seo_title: z.string() }), zhCN: z.object({ brand_name: z.string(), seo_title: z.string() }) }) }).parse(writes[0]!.body);
  expect(body.image_keys).toHaveLength(6);
  expect(body.video_key).toMatch(/^products\/s3\/videos\/.+\.webm$/);
  expect(body.status).toBe('PUBLISHED');
  expect(body.translations.en).toMatchObject({ slug: 'catalog-medicine-80-mg', seo_title: 'Catalog medicine sourcing' });
  expect(body.translations.en.description).toContain('<strong>Verified product description</strong>');
  expect(body.translations.zhCN.brand_name).toBe('产品资料');
  await expect(page.getByLabel('Product video preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Search manufacturer', exact: true })).toHaveValue('Fixture manufacturer');
  const desktopOverflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 2 && getComputedStyle(element).position !== 'absolute').slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(desktopOverflow)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/product-form-desktop.png', fullPage: true });
});

test('product form saves without video, reports required fields and fits a narrow screen', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'product-form-optional', 30_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/admin/catalog/products/new');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Check the highlighted fields before saving.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes).toHaveLength(0);
  await page.goto(`/admin/catalog/products/${ids.rfq}`);
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[0]).toMatchObject({ body: { video_key: null, status: 'DRAFT' } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/product-form-mobile.png', fullPage: true });
});

test('delete catalog entries directly from all four lists without confirmation or duplicate writes', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'management', 30_000);
  let dialogs = 0;
  page.on('dialog', async (dialog) => { dialogs++; await dialog.dismiss(); });
  await page.goto('/admin/catalog/products');
  const first = page.getByRole('button', { name: 'Delete Managed medicine 0', exact: true });
  await expect(first).toBeEnabled();
  await first.evaluate((node) => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(first).toHaveCount(0);
  for (const name of ['Managed medicine 1', 'Managed medicine 2']) {
    const button = page.getByRole('button', { name: `Delete ${name}`, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toHaveCount(0);
  }
  await expect(page.getByText('No matching products', { exact: true })).toBeVisible();
  for (const [kind, name] of [['manufacturers', 'Fixture manufacturer'], ['generics', 'Fixture generic'], ['categories', 'Fixture category']]) {
    await page.goto(`/admin/catalog/${kind}`);
    const button = page.getByRole('button', { name: `Delete ${name}`, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const saved = await state(request, email);
  expect(saved.writes).toHaveLength(6);
  expect(dialogs).toBe(0);
  for (const write of saved.writes) expect(write.body).toEqual({ expected_updated_at: '2026-11-15T12:00:00.000Z' });
});

test('delete explains why manufacturers, generics and categories in use cannot be removed', async ({ page, request }) => {
  test.setTimeout(90_000);
  await setup(page, request, 'management', 30_000);
  for (const [kind, name] of [['manufacturers', 'Fixture manufacturer'], ['generics', 'Fixture generic'], ['categories', 'Fixture category']]) {
    await page.goto(`/admin/catalog/${kind}`);
    const button = page.getByRole('button', { name: `Delete ${name}`, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByRole('table').getByRole('alert')).toHaveText('Used by a product. Reassign or delete those products first.');
    await expect(button).toBeEnabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('delete reconciles a lost response with a read without replaying the write', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'delete-loss', 30_000);
  await page.goto('/admin/catalog/products');
  const button = page.getByRole('button', { name: 'Delete Managed medicine 0', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveCount(0);
  expect((await state(request, email)).writes).toHaveLength(1);
});

test('delete requires a refreshed list after a stale record conflict', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = await setup(page, request, 'delete-conflict', 30_000);
  await page.goto('/admin/catalog/products');
  const button = page.getByRole('button', { name: 'Delete Managed medicine 0', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('table').getByRole('alert')).toHaveText('This record changed. Refresh the list to review it before deleting.');
  await expect(button).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh list', exact: true }).click();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveCount(0);
  const saved = await state(request, email);
  expect(saved.writes).toHaveLength(2);
  expect(saved.writes[0]!.body).not.toEqual(saved.writes[1]!.body);
});
test('saved DRAFT editing preserves identity and sends an optimistic timestamp once', async ({ page, request }) => {
  const email = await setup(page, request, 'workflow-existing-draft', 20_000);
  await page.goto(`/admin/quotations/${ids.quote}`);
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit saved draft', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to shipping', exact: true }).click();
  const before: unknown = await (
    await request.get(`${api}/__test__/admin?${new URLSearchParams({ email, action: 'workflow' })}`)
  ).json();
  const wire = z
    .object({
      data: z.object({
        quote: z.object({
          quotation: z.object({ current_version_id: z.string() }),
          versions: z.array(z.object({ id: z.string(), updated_at: z.string() })),
        }),
        writes: z.array(z.object({ path: z.string(), body: z.unknown() })),
      }),
    })
    .parse(before).data;
  await page.getByLabel('Freight amount', { exact: true }).fill('11.12345678');
  await page.getByRole('button', { name: 'Continue to review', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I reviewed every line' }).check();
  await page.getByRole('button', { name: 'Save draft changes', exact: true }).evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true }).first()).toBeVisible();
  const after: unknown = await (
    await request.get(`${api}/__test__/admin?${new URLSearchParams({ email, action: 'workflow' })}`)
  ).json();
  const next = z
    .object({
      data: z.object({
        quote: z.object({
          quotation: z.object({ current_version_id: z.string() }),
          versions: z.array(z.object({ id: z.string(), updated_at: z.string() })),
        }),
        writes: z.array(z.object({ path: z.string(), body: z.unknown() })),
      }),
    })
    .parse(after).data;
  expect(next.quote.versions).toHaveLength(1);
  expect(next.quote.quotation.current_version_id).toBe(wire.quote.quotation.current_version_id);
  expect(next.writes).toHaveLength(1);
  expect(next.writes[0]).toMatchObject({
    path: `quotations/${ids.quote}/draft`,
    body: {
      expected_current_version_id: wire.quote.quotation.current_version_id,
      expected_updated_at: wire.quote.versions[0].updated_at,
      freight_amount: '11.12345678',
    },
  });
});
async function setup(page: Page, request: APIRequestContext, scenario = 'management', navigationTimeout = 5000) {
  const email = `${randomUUID()}@fixture.example`;
  await request.post(`${api}/__test__/admin`, { data: { email, scenario } });
  await page.goto('/admin/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Continue to authenticator' }).click();
  await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'RFQ operations' })).toBeVisible({ timeout: navigationTimeout });
  return email;
}
async function state(request: APIRequestContext, email: string) {
  const response = await request.get(`${api}/__test__/admin?${new URLSearchParams({ email, action: 'management' })}`);
  const value: unknown = await response.json();
  return z
    .object({
      data: z.object({
        writes: z.array(z.object({ path: z.string(), body: z.unknown() })),
        commits: z.number(),
      }),
    })
    .parse(value).data;
}
test('browse unpublished records, archive a bilingual product and search/page the actual master directory', async ({
  page,
  request,
}) => {
  const email = await setup(page, request);
  await page.goto('/admin/catalog/products');
  await expect(page.getByRole('table')).toContainText('DRAFT');
  await expect(page.getByRole('table')).toContainText('ARCHIVED');
  await page.getByRole('link', { name: 'Edit Managed medicine 0', exact: true }).click();
  await page.getByLabel('sku', { exact: true }).fill('EDITED-SKU');
  await page.getByRole('combobox', { name:'Status', exact: true }).selectOption('ARCHIVED');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  const saved = await state(request, email);
  expect(saved.writes[0]).toMatchObject({
    path: `catalog/products/${ids.rfq}`,
    body: {
      sku: 'EDITED-SKU',
      status: 'ARCHIVED',
      translations: { en: { slug: 'managed-0' }, zhCN: { slug: '目录-0' } },
    },
  });
  await page.reload();
  await expect(page.getByLabel('sku', { exact: true })).toHaveValue('EDITED-SKU');
  expect(await page.content()).not.toContain('NEVER_RENDER_MANAGEMENT_SECRET');
  const picker = page.getByRole('group', { name: 'Manufacturer', exact: true });
  await picker.getByRole('combobox').click();
  await picker.getByRole('button', { name: 'Next options' }).click();
  await expect(picker.getByText(/Page 2/)).toBeVisible();
  await picker.getByLabel('Search manufacturer').fill('Fixture manufacturer');
  await expect(picker.getByText('1 matches', { exact: true })).toBeVisible();
});
test('category add and list support pictures while preserving translations and sort order', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const email = await setup(page, request, 'management', 30_000);
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  const menu = page.getByRole('navigation', { name: 'Admin navigation' });
  const categoryMenu = menu.getByRole('button', { name: 'Categories', exact: true });
  await expect(categoryMenu).toHaveAttribute('aria-expanded', 'false');
  await categoryMenu.click();
  await expect(categoryMenu).toHaveAttribute('aria-expanded', 'true');
  const links = page.locator('#admin-category-links');
  await links.getByRole('link', { name: 'List', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Picture', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Sort order', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview Fixture category', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Category preview: Fixture category' })).toBeVisible();
  await page.getByRole('button', { name: 'Close category preview', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toBe('medaxis-categories-page.csv');
  await page.getByLabel('Search by category name').fill('Fixture category');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Showing 1–1 of 1 categories')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('category-list-desktop.png'), fullPage: true });
  await links.getByRole('link', { name: 'Add new', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add New Category', exact: true })).toBeVisible();
  await expect(links.getByRole('link', { name: 'Add new', exact: true })).toHaveAttribute('aria-current', 'page');
  const name = page.getByLabel('Category name (EN)', { exact: true });
  const picture = page.locator('#category-picture');
  const preview = page.getByRole('img', { name: 'Category picture preview', exact: true });
  await name.fill('Reset this category');
  await page.getByLabel('Sort order', { exact: true }).fill('9');
  await picture.setInputFiles('public/images/medaxis-logo.png');
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(name).toHaveValue('');
  await expect(page.getByLabel('Sort order', { exact: true })).toHaveValue('0');
  await expect(preview).toHaveCount(0);
  await name.fill('New Category');
  await page.getByLabel('Sort order', { exact: true }).fill('7');
  await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
  await page.getByRole('textbox', { name: 'Category name (ZH)' }).fill('测试分类');
  await picture.setInputFiles('public/images/medaxis-logo.png');
  await expect(preview).toBeVisible();
  const expectedPicture = await preview.getAttribute('src');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('category-form-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('category-form-mobile.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit New Category', exact: true })).toBeVisible({ timeout: 30_000 });
  expect((await state(request, email)).writes[0]).toMatchObject({ path: 'catalog/categories', body: {
    translations: { en: { name: 'New Category', slug: 'new-category' }, zhCN: { name: '测试分类', slug: '测试分类' } },
    sort_order: 7, is_active: true, logo_data_url: expectedPicture,
  } });
  await page.reload();
  await expect(preview).toHaveAttribute('src', expectedPicture!);
  await expect(page.getByLabel('Sort order', { exact: true })).toHaveValue('7');
  await page.setViewportSize({ width: 1280, height: 720 });
  await links.getByRole('link', { name: 'List', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Home Category Status', exact: true })).toBeVisible();
  const statusSwitch = page.getByRole('switch', { name: 'Show New Category on homepage' });
  await expect(statusSwitch).toHaveAttribute('aria-checked', 'true');
  await statusSwitch.click();
  await expect(statusSwitch).toHaveAttribute('aria-checked', 'false');
  expect((await state(request, email)).writes[1]).toEqual({
    path: expect.stringMatching(/^catalog\/categories\/[a-f0-9-]+\/home-visibility$/),
    body: { show_on_home: false },
  });
  await page.reload();
  await expect(statusSwitch).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('link', { name: 'Edit New Category', exact: true }).click();
  await expect(preview).toHaveAttribute('src', expectedPicture!);
  await page.getByLabel('Sort order', { exact: true }).fill('8');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[2].body).not.toHaveProperty('logo_data_url');
  await page.getByRole('button', { name: 'Remove picture', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[3]).toMatchObject({ path: 'catalog/categories', body: { logo_data_url: null, sort_order: 8, is_active: true } });
  await page.reload();
  await expect(page.getByLabel('Category name (EN)', { exact: true })).toHaveValue('New Category');
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Category name (ZH)' })).toHaveValue('测试分类');
  await expect(page.getByLabel('Sort order', { exact: true })).toHaveValue('8');
  await links.getByRole('link', { name: 'List', exact: true }).click();
  const priority = page.getByRole('button', { name: 'Show New Category first on homepage' });
  await expect(priority).toBeDisabled();
  await statusSwitch.click();
  await expect(priority).toBeEnabled();
  await priority.click();
  await expect(priority).toHaveAttribute('aria-pressed', 'true');
  expect((await state(request, email)).writes.at(-1)?.body).toEqual({ home_featured: true });
  await page.reload();
  await expect(priority).toHaveAttribute('aria-pressed', 'true');
});

test('generic add and list share the manufacturer layout and preserve generic fields', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const email = await setup(page, request, 'management', 30_000);
  await page.goto('/admin/catalog/generics');
  await expect(page.getByRole('heading', { name: 'Generics', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Picture', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Therapeutic indications', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Supplied indication', exact: true })).toBeVisible();
  const statusSwitch = page.getByRole('switch', { name: 'Set Fixture generic active status' });
  await statusSwitch.click();
  await expect(statusSwitch).toHaveAttribute('aria-checked', 'false');
  expect((await state(request, email)).writes[0]).toMatchObject({ path: 'catalog/generics', body: { id: ids.rfq, is_active: false, therapeutic_indications: ['Supplied indication'] } });
  await page.getByRole('button', { name: 'Preview Fixture generic', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Generic preview: Fixture generic' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Generic preview: Fixture generic' }).locator('.admin-product-preview-image')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close generic preview', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toBe('medaxis-generics-page.csv');
  await page.getByLabel('Search by generic name').fill('Fixture generic');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Showing 1–1 of 1 generics')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('generic-list-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Add new generic', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add New Generic', exact: true })).toBeVisible();
  const name = page.getByLabel('Generic name (EN)', { exact: true });
  await name.fill('Reset this name');
  await expect(page.locator('#generic-picture')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(name).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' })).not.toBeChecked();
  await name.fill('New Generic');
  await page.getByLabel('Therapeutic indications (one per line)').fill('Owner supplied indication');
  await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
  await expect(page.getByRole('textbox', { name: 'Generic name (ZH)' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Generic name (ZH)' }).fill('测试通用名');
  await page.getByText('Additional details', { exact: true }).click();
  await page.locator('input[name="en_seo_title"]').fill('Generic catalog');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('generic-form-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('generic-form-mobile.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit New Generic', exact: true })).toBeVisible({ timeout: 30_000 });
  expect((await state(request, email)).writes[1]).toMatchObject({ path: 'catalog/generics', body: {
    translations: { en: { name: 'New Generic', slug: 'new-generic', seo_title: 'Generic catalog' }, zhCN: { name: '测试通用名', slug: '测试通用名' } },
    therapeutic_indications: ['Owner supplied indication'], is_active: true,
  } });
  expect((await state(request, email)).writes[1].body).not.toHaveProperty('logo_data_url');
  await page.reload();
  await expect(page.getByLabel('Generic name (EN)', { exact: true })).toHaveValue('New Generic');
  await expect(page.getByRole('textbox', { name: 'Generic name (ZH)' })).toHaveValue('测试通用名');
  await expect(page.getByLabel('Therapeutic indications (one per line)')).toHaveValue('Owner supplied indication');
  await expect(page.locator('#generic-picture')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[2].body).not.toHaveProperty('logo_data_url');
  await expect(page.getByRole('button', { name: 'Remove picture', exact: true })).toHaveCount(0);
});

test('new manufacturer saves a logo and organized Chinese details without a country code', async ({ page, request }) => {
  const email = await setup(page, request);
  await page.goto('/admin/catalog/manufacturers/new');
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible();
  const logo = page.locator('#manufacturer-logo');
  const preview = page.getByRole('img', { name: 'Manufacturer logo preview' });
  await logo.setInputFiles('public/images/medaxis-logo.png');
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByLabel('Manufacturer name (EN)', { exact: true }).fill('New Logo Maker');
  await expect(page.getByLabel('Country code', { exact: true })).toHaveCount(0);
  const chinese = page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' });
  const chineseName = page.getByRole('textbox', { name: 'Manufacturer name (ZH)' });
  await expect(chineseName).toBeHidden();
  await chinese.check();
  await chineseName.fill('测试药厂');
  await expect(page.getByRole('textbox', { name: 'SEO title', exact: true })).toBeHidden();
  await page.getByText('Search engine details', { exact: false }).click();
  await page.getByRole('textbox', { name: 'SEO title', exact: true }).fill('药厂目录');
  await logo.setInputFiles('public/images/medaxis-logo.png');
  await expect(preview).toBeVisible();
  const expected = await preview.getAttribute('src');
  expect(expected).toMatch(/^data:image\/(?:webp|png);base64,/);
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit New Logo Maker' })).toBeVisible();
  expect((await state(request, email)).writes[0]).toMatchObject({
    path: 'catalog/manufacturers',
    body: {
      logo_data_url: expected,
      translations: { en: { slug: 'new-logo-maker' }, zhCN: { slug: '测试药厂', seo_title: '药厂目录' } },
    },
  });
  await page.reload();
  await expect(preview).toHaveAttribute('src', expected!);
  await expect(chineseName).toHaveValue('测试药厂');
});

test('duplicate manufacturer slug explains the conflict and preserves an editable form', async ({ page, request }) => {
  test.slow();
  const email = await setup(page, request, 'management', 30_000);
  let submissions = 0;
  await page.route(/\/api\/admin\/catalog\/manufacturers$/, async (route) => {
    if (route.request().method() === 'POST' && ++submissions === 1) {
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({
        success: false, error: { status: 422, code: 'CATALOG_SLUG_CONFLICT', message: 'Page slug already used.', details: [{ field: 'translations.en.slug', issue: 'Already used.' }] },
        meta: { timestamp: new Date().toISOString(), request_id: randomUUID() },
      }) });
    } else await route.continue();
  });
  await page.goto('/admin/catalog/manufacturers/new');
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible();
  const name = page.getByLabel('Manufacturer name (EN)', { exact: true });
  await name.fill('Duplicate Maker');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  const submit = page.getByRole('button', { name: 'Submit', exact: true });
  await submit.click();
  await expect(page.getByText('An existing record already uses this page slug.', { exact: false })).toBeVisible();
  await expect(page.getByText('Check: English page slug', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open existing manufacturers' })).toHaveAttribute('href', '/admin/catalog/manufacturers');
  await expect(page.getByText('The request could not be confirmed.', { exact: false })).toHaveCount(0);
  await expect(name).toHaveValue('Duplicate Maker');
  await expect(name).toBeEditable();
  expect((await state(request, email)).writes).toHaveLength(0);
  await name.fill('Different Maker');
  await submit.click();
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit Different Maker', exact: true })).toBeVisible({ timeout: 30_000 });
  expect((await state(request, email)).writes).toHaveLength(1);
  expect(submissions).toBe(2);
});

test('manufacturer logo outage leaves the form editable and permits saving without the logo', async ({ page, request }) => {
  const email = await setup(page, request, 'manufacturer-logo-down');
  await page.goto('/admin/catalog/manufacturers/new');
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible();
  const name = page.getByLabel('Manufacturer name (EN)', { exact: true });
  await name.fill('Test Manufacturer');
  await page.getByRole('checkbox', { name: 'Include Simplified Chinese translation' }).check();
  const chineseName = page.getByRole('textbox', { name: 'Manufacturer name (ZH)' });
  await chineseName.fill('测试药厂');
  await page.locator('#manufacturer-logo').setInputFiles('public/images/medaxis-logo.png');
  await expect(page.getByRole('img', { name: 'Manufacturer logo preview' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  const submit = page.getByRole('button', { name: 'Submit', exact: true });
  await submit.click();
  await expect(page.getByText('Manufacturer was not saved because logo storage is unavailable.', { exact: false })).toBeVisible();
  await expect(name).toBeEditable();
  await expect(chineseName).toHaveValue('测试药厂');
  expect((await state(request, email)).writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Remove logo' }).click();
  await submit.click();
  await page.getByRole('link', { name: 'View saved record', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit Test Manufacturer' })).toBeVisible();
  expect((await state(request, email)).writes).toHaveLength(1);
});

test('master and scheduled CMS browse/edit retain exact registered bodies and reject public price copy', async ({
  page,
  request,
}) => {
  test.slow();
  const email = await setup(page, request, 'management', 30_000);
  const sidebar = page.getByRole('navigation', { name: 'Admin navigation' });
  const manufacturers = sidebar.getByRole('button', { name: 'Manufacturers' });
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await manufacturers.click();
  await expect(manufacturers).toHaveAttribute('aria-expanded', 'true');
  await manufacturers.click();
  await expect(sidebar.getByRole('link', { name: 'Add new', exact: true })).toBeHidden();
  await manufacturers.click();
  await sidebar.getByRole('link', { name: 'Add new', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add New Manufacturer' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Add new', exact: true })).toHaveAttribute('aria-current', 'page');
  await sidebar.getByRole('link', { name: 'List', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manufacturers', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'List', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('columnheader', { name: 'Manufacturer Logo' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Total Product' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Total RFQ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  const statusSwitch = page.getByRole('switch', { name: 'Set Fixture manufacturer active status' });
  await expect(statusSwitch).toHaveAttribute('aria-checked', 'true');
  await statusSwitch.click();
  await expect(statusSwitch).toHaveAttribute('aria-checked', 'false');
  await statusSwitch.click();
  await expect(statusSwitch).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: 'Page 2' }).click();
  await expect(page.getByText('Showing 21–23 of 23 manufacturers')).toBeVisible();
  await page.getByLabel('Search by manufacturer name').fill('Fixture manufacturer');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Showing 1–1 of 1 manufacturers')).toBeVisible();
  await page.getByRole('link', { name: 'Edit Fixture manufacturer', exact: true }).click();
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Active', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[2]).toMatchObject({
    path: 'catalog/manufacturers',
    body: {
      id: ids.manufacturer,
      is_active: false,
      certifications: ['Supplied certificate'],
    },
  });
  await page.goto(`/admin/catalog/banners/${ids.prescription}`);
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'body', exact: true }).fill('USD 99');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('Correct the listed form fields before submitting again.', {
      exact: true,
    }),
  ).toBeVisible();
  expect((await state(request, email)).writes).toHaveLength(3);
  await page.getByRole('textbox', { name: 'body', exact: true }).fill('Documented sourcing update.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[3]).toMatchObject({
    path: 'cms/banners',
    body: {
      id: ids.prescription,
      link_path: '/en/products',
      starts_at: '2030-01-01T00:00:00.000Z',
    },
  });
});
test('catalog image transport validates signatures and stores the returned key', async ({ page, request }) => {
  const email = await setup(page, request);
  await page.route('https://cdn.medaxisglobalpharma.com/products/s3/fixture-upload.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.goto(`/admin/catalog/products/${ids.rfq}`);
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible();
  await page.getByLabel('Upload product image').setInputFiles({
    name: 'spoof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<html>invalid</html>'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Choose valid JPEG' })).toBeVisible();
  expect((await state(request, email)).writes).toHaveLength(0);
  await page.getByLabel('Upload product image').setInputFiles({
    name: 'valid.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByRole('img', { name: 'Main product image preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[1]).toMatchObject({
    body: { image_keys: ['products/s3/fixture-upload.png'] },
  });
});
test('CSV 200 invalid stays invalid, changed files require validation and 202 shows the committed count once', async ({
  page,
  request,
}) => {
  const email = await setup(page, request);
  await page.goto('/admin/catalog/import');
  const input = page.getByLabel('CSV file');
  await input.setInputFiles({
    name: 'catalog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('sku\ninvalid-row'),
  });
  await page.getByRole('button', { name: 'Validate dry run' }).click();
  await expect(page.getByText('Invalid · 0 of 1 valid · 0 committed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit validated CSV' })).toHaveCount(0);
  await input.setInputFiles({
    name: 'catalog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('sku\nCSV-FIXTURE'),
  });
  await page.getByRole('button', { name: 'Validate dry run' }).click();
  await expect(page.getByRole('button', { name: 'Commit validated CSV' })).toBeVisible();
  await input.setInputFiles({
    name: 'catalog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('sku\nCHANGED'),
  });
  await expect(page.getByRole('button', { name: 'Commit validated CSV' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Validate dry run' }).click();
  await page.getByRole('checkbox', { name: 'Commit this unchanged' }).check();
  await page.getByRole('button', { name: 'Commit validated CSV' }).evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(page.getByText('Valid · 1 of 1 valid · 1 committed')).toBeVisible();
  expect((await state(request, email)).commits).toBe(1);
});
test('lost CSV commit response blocks another import rather than blindly replaying', async ({ page, request }) => {
  const email = await setup(page, request, 'management-import-loss');
  await page.goto('/admin/catalog/import');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'catalog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('sku\nCSV-FIXTURE'),
  });
  await page.getByRole('button', { name: 'Validate dry run' }).click();
  await page.getByRole('checkbox', { name: 'Commit this unchanged' }).check();
  await page.getByRole('button', { name: 'Commit validated CSV' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Import delivery is uncertain' })).toBeVisible();
  await expect(page.getByLabel('CSV file')).toBeDisabled();
  expect((await state(request, email)).commits).toBe(1);
});
test('private customers, audit, settings, quote summary and one-time MFA rotation work without public storage', async ({
  page,
  request,
  context,
}) => {
  const email = await setup(page, request, 'workflow-sent');
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.goto('/admin/customers?q=fixture&buyer_type=B2B_WHOLESALE&country=CN');
  await page.getByRole('link', { name: 'View history' }).click();
  await expect(page.getByRole('heading', { name: 'Customer profile fixture' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'RFQ-WORKFLOW-001', exact: true })).toBeVisible();
  await page.goto('/admin/audit-logs?actor_type=SUPER_ADMIN&action=PRODUCT_SAVED');
  expect(await page.content()).not.toContain('NEVER_RENDER_AUDIT_SECRET');
  await page.goto('/admin/quotations');
  await expect(page.getByRole('region', { name: 'Quotation summary' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View / revise' })).toBeVisible();
  await page.goto('/admin/settings');
  await page.getByLabel('Configured units (one per line)').fill('BOX\nBOTTLE');
  await page.getByRole('button', { name: 'Save packaging units' }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes).toContainEqual({
    path: 'settings',
    body: { packaging_units: { units: ['BOX', 'BOTTLE'] } },
  });
  await page.goto('/admin/settings/security');
  await expect(page.getByRole('button', { name: 'Rotate enrolled authenticator' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I am ready to replace' }).check();
  await page.getByRole('button', { name: 'Rotate enrolled authenticator' }).click();
  await expect(page.getByText('BACKUP-ONCE-0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I saved them · clear now' }).click();
  await expect(page.getByText('BACKUP-ONCE-0', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Rotation completed.', { exact: false })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    })),
  ).toEqual({ local: {}, session: {} });
  expect(requests.filter((url) => /plausible|google-analytics/.test(url))).toEqual([]);
  const response = await context.request.get('/admin/settings');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
});
test('management screens fit desktop, tablet and 390/320px with visible focus and no overflow', async ({
  page,
  request,
}, info) => {
  await setup(page, request);
  for (const path of [
    '/admin/catalog/products',
    '/admin/catalog/manufacturers',
    `/admin/catalog/products/${ids.rfq}`,
    '/admin/settings',
    '/admin/customers',
    '/admin/audit-logs',
  ]) {
    await page.goto(path);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${path.split('/').at(-1)}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Apply filters' }).focus();
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeFocused();
});
