import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { z } from 'zod';
import { workflowIds as ids } from '../admin-fixtures';
const api = 'http://127.0.0.1:4100';
test('saved DRAFT editing preserves identity and sends an optimistic timestamp once', async ({ page, request }) => {
  const email = await setup(page, request, 'workflow-existing-draft');
  await page.goto(`/admin/quotations/${ids.quote}`);
  await expect(page.getByRole('heading', { name: 'Edit saved draft', exact: true })).toBeVisible();
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
async function setup(page: Page, request: APIRequestContext, scenario = 'management') {
  const email = `${randomUUID()}@fixture.example`;
  await request.post(`${api}/__test__/admin`, { data: { email, scenario } });
  await page.goto('/admin/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Continue to authenticator' }).click();
  await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'RFQ operations' })).toBeVisible();
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
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
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
  await picker.getByRole('button', { name: 'Next options' }).click();
  await expect(picker.getByText(/Page 2/)).toBeVisible();
  await picker.getByLabel('Search manufacturer').fill('Fixture manufacturer');
  await expect(picker.getByText(/1 active matches/)).toBeVisible();
});
test('master and scheduled CMS browse/edit retain exact registered bodies and reject public price copy', async ({
  page,
  request,
}) => {
  const email = await setup(page, request);
  await page.goto(`/admin/catalog/manufacturers/${ids.manufacturer}`);
  await page.getByRole('checkbox', { name: 'Active', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[0]).toMatchObject({
    path: 'catalog/manufacturers',
    body: {
      id: ids.manufacturer,
      is_active: false,
      country: 'BD',
      certifications: ['Supplied certificate'],
    },
  });
  await page.goto(`/admin/catalog/banners/${ids.prescription}`);
  await page.getByRole('textbox', { name: 'body', exact: true }).fill('USD 99');
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('Correct the listed form fields before submitting again.', {
      exact: true,
    }),
  ).toBeVisible();
  expect((await state(request, email)).writes).toHaveLength(1);
  await page.getByRole('textbox', { name: 'body', exact: true }).fill('Documented sourcing update.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[1]).toMatchObject({
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
  await page.route('https://cdn.medaxisglobalpharma.com/products/fixture-upload.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.goto(`/admin/catalog/products/${ids.rfq}`);
  await page.getByLabel('Upload product image').setInputFiles({
    name: 'spoof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<html>invalid</html>'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Image upload could not' })).toBeVisible();
  expect((await state(request, email)).writes).toHaveLength(0);
  await page.getByLabel('Upload product image').setInputFiles({
    name: 'valid.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByText('products/fixture-upload.png', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I verified these details' }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved. Server state refreshed.', { exact: true })).toBeVisible();
  expect((await state(request, email)).writes[1]).toMatchObject({
    body: { image_keys: ['products/fixture-upload.png'] },
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
  await expect(page.getByRole('heading', { name: 'Global quotation summary' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open quotation' })).toBeVisible();
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
