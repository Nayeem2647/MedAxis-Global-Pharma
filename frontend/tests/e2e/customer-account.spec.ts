import { test, expect } from '@playwright/test';
import { installImageFixture } from './image-fixture';
import en from '../../messages/customer-en.json' with { type: 'json' };
import zh from '../../messages/customer-zh-CN.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
  await page.route('https://plausible.example.test/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
});

test('account forms cannot submit credentials in a URL before JavaScript is ready', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3100/en/register', { waitUntil: 'domcontentloaded' });
    const form = page.locator('.customer-access-form form');
    await expect(form).toHaveAttribute('method', 'post');
    await expect(form.locator('input[name=password]')).toBeDisabled();
    await expect(form.getByRole('button', { name: en.createAccount, exact: true })).toBeDisabled();
  } finally { await context.close(); }
});

for (const locale of ['en', 'zh-CN']) {
  test(`${locale}: customer registration, drafts, verification, RFQs, quotations, revision, PDF and login`, async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    const t = locale === 'en' ? en : zh;
    const email = `customer-${crypto.randomUUID()}@example.test`; const password = 'Browser customer password 2026!';
    await page.goto(`/${locale}/register`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.top-bar-login-btn')).toHaveAttribute('href', `/${locale}/login`);
    await page.getByLabel(t.fullName, { exact: true }).fill('Browser customer');
    await page.getByLabel(t.country, { exact: true }).fill('BD');
    await page.getByLabel(t.email, { exact: true }).fill(email);
    await page.getByLabel(t.password, { exact: true }).fill(password);
    await page.getByLabel(t.confirmPassword, { exact: true }).fill(password);
    await page.getByRole('button', { name: t.createAccount, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/account`));
    await expect(page.getByRole('heading', { name: locale === 'en' ? 'Hello, Browser customer' : '您好，Browser customer' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: t.verificationSent })).toBeVisible();
    const nav = page.getByRole('navigation', { name: t.accountNavigation });
    await nav.getByRole('button', { name: t.drafts, exact: true }).click();
    await page.getByRole('button', { name: t.newDraft, exact: true }).click();
    await page.getByLabel(t.draftTitle).fill('Saved sourcing requirement');
    await page.getByLabel(t.medicine, { exact: true }).fill('Requested medicine');
    await page.getByLabel(t.quantity, { exact: true }).fill('2');
    await page.getByRole('button', { name: t.saveDraft }).click();
    await expect(page.getByRole('heading', { name: 'Saved sourcing requirement' })).toBeVisible();
    await expect(page.getByRole('button', { name: t.submitRfq, exact: true })).toBeDisabled();
    const verify = await request.get(`http://127.0.0.1:4100/__test__/customer?email=${encodeURIComponent(email)}`);
    const link = (await verify.json()).data.verify_url as string;
    await page.goto(link);
    await page.getByRole('button', { name: t.verifyEmail, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t.verified })).toBeVisible();
    await page.getByRole('link', { name: t.openDashboard }).click();
    await nav.getByRole('button', { name: t.drafts, exact: true }).click();
    await page.getByRole('button', { name: t.submitRfq, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'RFQ-CUSTOMER-002' })).toBeVisible();
    await nav.getByRole('button', { name: t.rfqs, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'RFQ-CUSTOMER-002' })).toBeVisible();
    await page.getByRole('heading', { name: 'RFQ-CUSTOMER-002' }).locator('xpath=../..').getByRole('button', { name: t.viewDetails }).click();
    await expect(page.getByRole('region', { name: 'Order progress' }).getByRole('listitem')).toHaveCount(7);
    await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
    await nav.getByRole('button', { name: t.quotations, exact: true }).click();
    await page.getByRole('button', { name: t.viewQuotation, exact: true }).click();
    await expect(page.locator('.customer-quote-totals')).toContainText('USD 34.69135780');
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: t.downloadPdf, exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe('MedAxis-quotation-v1.pdf');
    await page.getByLabel(t.revisionNotes).fill('Please review this sourcing request.');
    await page.getByRole('button', { name: t.sendRevision, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t.revisionSent })).toBeVisible();
    await page.getByRole('button', { name: t.openRfqWorkflow, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'RFQ-CUSTOMER-001' })).toBeVisible();
    await page.getByRole('button', { name: 'Request a better offer', exact: true }).click();
    const reply = page.getByRole('dialog', { name: 'Request a better offer' });
    await reply.getByLabel('Your message').fill('Could you reduce the delivery charge?');
    await reply.getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(page.getByText('Could you reduce the delivery charge?', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve quotation', exact: true })).toHaveCount(0);
    await nav.getByRole('button', { name: t.revisions, exact: true }).click();
    await expect(page.getByText('Please review this sourcing request.', { exact: true })).toBeVisible();
    await nav.getByRole('button', { name: t.history, exact: true }).click();
    await expect(page.locator('.customer-history')).toContainText(t.events.REVISION_REQUESTED);
    await nav.getByRole('button', { name: t.profile, exact: true }).click();
    await page.getByLabel(t.fullName, { exact: true }).fill('Updated customer');
    await page.getByRole('button', { name: t.saveProfile, exact: true }).click();
    await expect(page.getByRole('heading', { name: locale === 'en' ? 'Hello, Updated customer' : '您好，Updated customer' })).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`customer-${locale}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.top-bar-register-btn').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await page.goto(`/${locale}/login`);
    await page.getByLabel(t.email, { exact: true }).fill(email); await page.getByLabel(t.password, { exact: true }).fill('incorrect-password');
    await page.getByRole('button', { name: t.signIn, exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: t.invalidCredentials })).toBeVisible();
    await page.getByLabel(t.password, { exact: true }).fill(password); await page.getByRole('button', { name: t.signIn, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/account`));
    const response = await request.get(`/${locale}/account`); expect(response.headers()['x-robots-tag']).toContain('noindex'); expect(response.headers()['cache-control']).toContain('no-store');
  });
}
