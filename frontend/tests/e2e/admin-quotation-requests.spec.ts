import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { workflowIds } from '../admin-fixtures';

const api = 'http://127.0.0.1:4100';
test.setTimeout(60_000);

async function setup(page: Page, request: APIRequestContext, scenario = 'workflow-website-request') {
  const email = `${randomUUID()}@fixture.example`;
  await request.post(`${api}/__test__/admin`, { data: { email, scenario } });
  await page.goto('/admin/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Continue to authenticator', exact: true }).click();
  await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'RFQ operations', exact: true })).toBeVisible();
  return email;
}

test('the legacy overview retains website requests before a quotation is created', async ({ page, request }, info) => {
  const email = await setup(page, request);
  await expect(page.getByText('1 matching RFQs', { exact: true })).toBeVisible();
  for (const path of ['/admin/quotations/overview']) {
    await page.goto(path);
    const queue = page.getByRole('region', { name: 'Website quotation requests', exact: true });
    await expect(queue.getByRole('status')).toHaveText('1 awaiting review');
    await expect(queue.getByRole('link', { name: 'RFQ-WORKFLOW-001', exact: true })).toBeVisible();
    await expect(queue.getByRole('link', { name: 'Review request', exact: true })).toHaveAttribute('href', `/admin/rfqs/${workflowIds.rfq}`);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 1440 || width === 320) await page.screenshot({ path: info.outputPath(`${path.split('/').at(-1)}-requests-${width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('region', { name: 'Website quotation requests', exact: true }).getByRole('link', { name: 'Review request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'RFQ-WORKFLOW-001', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Prepare Fast Quote', exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: /RFQ inbox$/ }).click();
  await expect(page.getByText('1 matching RFQs', { exact: true })).toBeVisible();
  const state = await (await request.get(`${api}/__test__/admin?${new URLSearchParams({ email, action: 'workflow' })}`)).json();
  expect(state.data.quote).toBeNull();
  expect(state.data.writes).toEqual([]);
});

test('a new website request refreshes the open quotation list through live events', async ({ page, request }) => {
  const email = await setup(page, request, 'workflow-website-request-empty');
  await page.goto('/admin/quotations/overview');
  const queue = page.getByRole('region', { name: 'Website quotation requests', exact: true });
  await expect(queue.getByRole('status')).toHaveText('0 awaiting review');
  await expect(queue).toContainText('No new website requests are awaiting review.');
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible();
  await request.get(`${api}/__test__/admin?${new URLSearchParams({ email, action: 'event' })}`);
  await expect(queue.getByRole('status')).toHaveText('1 awaiting review');
  await expect(queue.getByRole('link', { name: 'RFQ-WORKFLOW-001', exact: true })).toBeVisible();
  expect(await page.content()).not.toContain('NEVER_RENDER_ADMIN_EVENT');
});

test('inbox failures show an unavailable count and can recover without hiding quotations', async ({ page, request }) => {
  await setup(page, request, 'workflow-website-request-down');
  await page.goto('/admin/quotations/overview');
  const queue = page.getByRole('region', { name: 'Website quotation requests', exact: true });
  await expect(queue.getByRole('status')).toHaveText('Request count unavailable');
  await expect(queue).toContainText('Website requests could not be loaded.');
  await expect(queue.getByText('0 awaiting review', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pending drafts', exact: true })).toBeVisible();
  await page.route('**/api/admin/rfqs?**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: [], meta: {
      timestamp: new Date().toISOString(), request_id: randomUUID(), pagination: { page: 1, limit: 5, total_items: 0, total_pages: 0, has_prev: false, has_next: false },
    } }) });
  });
  await queue.getByRole('button', { name: 'Refresh requests', exact: true }).click();
  await expect(queue.getByRole('status')).toHaveText('0 awaiting review');
  await expect(queue.getByRole('alert')).toHaveCount(0);
});
