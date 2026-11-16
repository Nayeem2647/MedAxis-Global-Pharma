import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { installImageFixture } from './image-fixture';

const stateSchema = z.object({ accepted: z.number(), accepts: z.number(), calls: z.array(z.object({ kind: z.string(), key: z.string().optional(), body: z.unknown().optional(), referrer: z.string().optional() })) });
const forbidden = /NEVER_RENDER_|NEVER_INVENT_BUSINESS_NUMBER|procurement_cost_bdt|procurement_unit_cost_bdt|locked_fx_rate|markup_percent|gross_margin|internal_cost_data|calculated_base_bdt|magic_link_token_hash|internal_procurement_notes|private_admin_note/;
function privateHeaders(headers: Record<string, string>) {
  expect(headers['cache-control']).toContain('private'); expect(headers['cache-control']).toContain('no-store');
  expect(headers['referrer-policy']).toBe('no-referrer'); expect(headers['x-robots-tag']).toContain('noindex, nofollow, noarchive');
}
async function configure(request: APIRequestContext, scenario = 'sent') {
  const token = randomBytes(32).toString('hex');
  const response = await request.post('http://127.0.0.1:4100/__test__/quotation', { data: { token, scenario } }); expect(response.status()).toBe(200); return token;
}
async function state(request: APIRequestContext, token: string) { const response = await request.get(`http://127.0.0.1:4100/__test__/quotation/${token}`); const input: unknown = await response.json(); return stateSchema.parse(input); }
test.beforeEach(async ({ page }) => { await installImageFixture(page); });

test('private HTML/DOM/RSC allowlists customer prices and bank details without public providers or analytics', async ({ page, request }) => {
  const token = await configure(request);
  const paths: string[] = []; const logs: string[] = [];
  page.on('request', (req) => paths.push(req.url())); page.on('console', (message) => logs.push(message.text()));
  const response = await page.goto(`/q/${token}`); expect(response?.status()).toBe(200);
  privateHeaders(response?.headers() ?? {});
  await expect(page.getByRole('heading', { name: 'Quotation', exact: true })).toBeVisible();
  await expect(page.getByText('USD 383.1900', { exact: true })).toBeVisible(); await expect(page.getByText('PRIVATE-ACCOUNT-012345', { exact: true })).toBeVisible();
  const html = await response?.text(); expect(html).not.toMatch(forbidden); expect(html).toContain('123.4500'); expect(html).toContain('quotation-buyer@example.test');
  expect(await page.content()).not.toMatch(forbidden); expect(await page.locator('body').innerText()).not.toMatch(forbidden);
  const rsc = await request.get(`/q/${token}`, { headers: { RSC: '1' } }); expect(rsc.headers()['content-type']).toContain('text/x-component'); privateHeaders(rsc.headers());
  const payload = await rsc.text(); expect(payload).not.toMatch(forbidden); expect(payload).toContain('383.1900');
  await expect(page.locator('.site-header, .site-footer, .cart-button, .header-quote, script#medaxis-plausible')).toHaveCount(0);
  await expect(page.locator('link[rel=canonical], link[hreflang], meta[property^="og:"], meta[name^="twitter:"]')).toHaveCount(0);
  await expect(page.locator('meta[name=referrer]')).toHaveAttribute('content', 'no-referrer'); await expect(page.locator('meta[name=robots]').first()).toHaveAttribute('content', /noindex.*nofollow.*noarchive/);
  expect(await page.title()).not.toMatch(/Private Quotation Buyer|PRIVATE-ACCOUNT|quotation-buyer/);
  expect(paths.filter((url) => /plausible\.example|googleapis|google-analytics|recaptcha|\/v1\/admin\//.test(url))).toEqual([]);
  const storage = await page.evaluate(() => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) })); expect(storage).toEqual({ local: {}, session: {} });
  expect(logs.join('\n')).not.toMatch(new RegExp(`${token}|Private Quotation Buyer|PRIVATE-ACCOUNT|quotation-buyer`));
});

test('accept terms, double click, response-loss replay and reload keep one acceptance and the server deadline', async ({ page, request }) => {
  const token = await configure(request, 'accept-lost'); await page.goto(`/q/${token}`);
  const accept = page.getByRole('button', { name: 'Accept quotation', exact: true }); await expect(accept).toBeDisabled();
  await page.getByRole('checkbox').focus(); await page.keyboard.press('Space'); await page.keyboard.press('Tab'); await expect(accept).toBeFocused();
  await accept.evaluate((button) => { if (!(button instanceof HTMLButtonElement)) throw new Error('Expected button'); button.click(); button.click(); });
  await expect(page.getByRole('heading', { name: 'Quotation accepted', exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('This quotation is already accepted.', { exact: false })).toBeVisible();
  const recorded = await state(request, token); expect(recorded.accepted).toBe(1); expect(recorded.accepts).toBe(2);
  const writes = recorded.calls.filter((call) => call.kind === 'accept'); expect(new Set(writes.map((call) => call.key)).size).toBe(1);
  for (const call of writes) { expect(call.key).toMatch(/^[a-f0-9-]{36}$/); expect(call.body).toEqual({ terms_accepted: true }); expect(call.referrer).toBeUndefined(); }
  await expect(page.locator('time[datetime="2026-11-21T10:00:00.000Z"]')).toBeVisible();
  await page.reload(); await expect(page.locator('time[datetime="2026-11-21T10:00:00.000Z"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept quotation', exact: true })).toHaveCount(0); expect((await state(request, token)).accepted).toBe(1);
});

test('500 acceptance failures expose an actionable same-key retry', async ({ page, request }) => {
  const token = await configure(request, 'accept-recover'); await page.goto(`/q/${token}`); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Accept quotation', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry the same acceptance', exact: true }); await expect(retry).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByText('We could not confirm your acceptance.', { exact: false })).toBeVisible();
  expect((await state(request, token)).accepts).toBe(4); await retry.click();
  await expect(page.getByRole('heading', { name: 'Quotation accepted', exact: true })).toBeVisible();
  const recorded = await state(request, token); expect(recorded.accepted).toBe(1); expect(recorded.accepts).toBe(5); expect(new Set(recorded.calls.filter((call) => call.kind === 'accept').map((call) => call.key)).size).toBe(1);
});

test('expired quotations disclose no old commercial document and submit one optional-note refresh request', async ({ page, request }) => {
  const token = await configure(request, 'expired'); const response = await page.goto(`/q/${token}`); privateHeaders(response?.headers() ?? {});
  await expect(page.getByRole('heading', { name: 'This quotation has expired', exact: true })).toBeVisible(); expect(await page.content()).not.toMatch(/Private Quotation Buyer|PRIVATE-ACCOUNT|383\.1900|procurement_cost/);
  await page.locator('summary').filter({ hasText: 'Request an updated quotation' }).click(); await page.getByRole('button', { name: 'Request an updated quotation', exact: true }).click();
  await expect(page.getByText('Your updated-quotation request was received.', { exact: false })).toBeVisible();
  const writes = (await state(request, token)).calls.filter((call) => call.kind === 'request-refresh'); expect(writes).toHaveLength(1); expect(writes[0]?.body).toEqual({}); expect(writes[0]?.key).toBeUndefined();
});

test('missing/superseded/proxy/malformed states are safe and never use admin reads', async ({ page, request }) => {
  for (const [scenario, heading] of [['missing', 'Quotation unavailable'], ['superseded', 'A newer quotation version is available'], ['proxy', 'The quotation service is temporarily unavailable'], ['malformed', 'We could not confirm this quotation']]) {
    const token = await configure(request, scenario); const response = await page.goto(`/q/${token}`);
    privateHeaders(response?.headers() ?? {});
    if (scenario === 'missing') expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible(); expect(await page.content()).not.toMatch(forbidden);
    await expect(page.getByRole('button', { name: 'Accept quotation', exact: true })).toHaveCount(0);
    expect(page.url()).toContain(`/q/${token}`);
  }
  const invalid = await page.goto('/q/not-a-token'); expect(invalid?.status()).toBe(404); privateHeaders(invalid?.headers() ?? {}); await expect(page.getByRole('heading', { name: 'Quotation unavailable', exact: true })).toBeVisible();
});

test('confirmed revision uses only notes; uncertain revision never posts again and preserves input', async ({ page, request }) => {
  for (const scenario of ['sent', 'revision-uncertain']) {
    const token = await configure(request, scenario); await page.goto(`/q/${token}`); await page.locator('summary').filter({ hasText: 'Request a revision' }).click();
    const notes = page.getByRole('textbox', { name: 'What would you like revised?', exact: true }); await notes.fill('Please confirm an alternative pack.'); await page.getByRole('button', { name: 'Request a revision', exact: true }).click();
    await expect(page.getByText(scenario === 'sent' ? 'Your revision request was received.' : 'Your request may already have been received.', { exact: false })).toBeVisible();
    await expect(notes).toHaveValue('Please confirm an alternative pack.'); await expect(notes).toBeDisabled();
    await page.getByRole('button', { name: 'Check current status', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Request a revision', exact: true })).toBeDisabled();
    const writes = (await state(request, token)).calls.filter((call) => call.kind === 'request-revision'); expect(writes).toHaveLength(1); expect(writes[0]?.body).toEqual({ notes: 'Please confirm an alternative pack.' }); expect(writes[0]?.key).toBeUndefined();
  }
});

test('refresh uncertainty stays locked; decline uncertainty reconciles through current server state', async ({ page, request }) => {
  const expired = await configure(request, 'expired-uncertain'); await page.goto(`/q/${expired}`); await page.locator('summary').filter({ hasText: 'Request an updated quotation' }).click();
  await page.getByLabel('Notes (optional)', { exact: true }).fill('Please update availability.'); await page.getByRole('button', { name: 'Request an updated quotation', exact: true }).click();
  await expect(page.getByText('Your request may already have been received.', { exact: false })).toBeVisible(); await expect(page.getByRole('button', { name: 'Request an updated quotation', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check current status', exact: true }).click(); expect((await state(request, expired)).calls.filter((call) => call.kind === 'request-refresh')).toHaveLength(1);
  // A page reload is deliberate here; no browser storage or hidden auto-replay is used.
  page.once('dialog', (dialog) => dialog.accept());
  const token = await configure(request, 'decline-uncertain'); await page.goto(`/q/${token}`); await page.locator('summary').filter({ hasText: 'Decline quotation' }).click();
  const form = page.locator('.quotation-decision').filter({ has: page.getByRole('button', { name: 'Decline quotation', exact: true }) });
  expect(await form.locator('option').evaluateAll((options) => options.map((option) => option.getAttribute('value')))).toEqual(['PRICE', 'LEAD_TIME', 'SPECIFICATION', 'OTHER']);
  await form.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('SPECIFICATION'); await form.getByRole('button', { name: 'Decline quotation', exact: true }).click();
  await expect(page.getByText('This quotation is declined.', { exact: false })).toBeVisible(); const writes = (await state(request, token)).calls.filter((call) => call.kind === 'decline'); expect(writes).toHaveLength(1); expect(writes[0]?.body).toEqual({ reason: 'SPECIFICATION' });
});

test('validated PDF downloads use a version filename and revoke the blob URL', async ({ page, request }) => {
  await page.addInitScript(() => { window.quotationRevoked = []; const revoke = URL.revokeObjectURL; URL.revokeObjectURL = (url) => { window.quotationRevoked.push(url); revoke(url); }; });
  const token = await configure(request); await page.goto(`/q/${token}`);
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download quotation PDF', exact: true }).click(); const download = await downloaded; expect(download.suggestedFilename()).toBe('quotation-v2.pdf');
  await expect.poll(() => page.evaluate(() => window.quotationRevoked.length)).toBe(1); await expect(page.locator('a[href*="/quotation/pdf/"]')).toHaveCount(0);
  expect((await state(request, token)).calls.filter((call) => call.kind === 'pdf').every((call) => call.referrer === undefined)).toBe(true);
});

test('PDF JSON expiry, proxy HTML and fake PDF bytes produce sanitized recovery', async ({ page, request }) => {
  test.setTimeout(45_000);
  for (const scenario of ['pdf-expired', 'pdf-proxy', 'pdf-invalid']) {
    const token = await configure(request, scenario); await page.goto(`/q/${token}`); await page.getByRole('button', { name: 'Download quotation PDF', exact: true }).click();
    if (scenario === 'pdf-expired') { await expect(page.getByRole('heading', { name: 'This quotation has expired', exact: true })).toBeVisible(); await expect(page.getByText('PRIVATE-ACCOUNT-012345', { exact: true })).toHaveCount(0); }
    else await expect(page.locator('.quotation-recovery')).toContainText(scenario === 'pdf-proxy' ? 'Please check the current status again' : 'We could not confirm the result', { timeout: 20_000 });
    expect(await page.content()).not.toMatch(forbidden);
  }
});

test('MicroMessenger hides PDF downloads and shows bilingual Open in Browser guidance', async ({ browser, request }) => {
  const token = await configure(request); const context = await browser.newContext({ userAgent: 'Mozilla/5.0 MicroMessenger/8.0' }); const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:3100/q/${token}`); await expect(page.getByText('To download your quotation PDF, tap ··· → Open in Browser.', { exact: true })).toBeVisible();
    await expect(page.getByText('如需下载报价 PDF，请点击右上角 ··· → 在浏览器中打开。', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Download quotation PDF', exact: true })).toHaveCount(0);
    expect((await state(request, token)).calls.filter((call) => call.kind === 'pdf')).toHaveLength(0);
  } finally { await context.close(); }
});

test('local language toggle preserves the token path, terms, notes and independent official contact dialog', async ({ page, request }) => {
  const token = await configure(request); await page.goto(`/q/${token}`); await page.getByRole('checkbox').check(); await page.locator('summary').filter({ hasText: 'Request a revision' }).click(); await page.getByLabel('What would you like revised?', { exact: true }).fill('Keep these notes.');
  await page.getByRole('button', { name: '简体中文', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN'); expect(page.url()).toBe(`http://127.0.0.1:3100/q/${token}`);
  await expect(page.getByRole('checkbox')).toBeChecked(); await expect(page.getByRole('textbox', { name: '请说明需要修改的内容', exact: true })).toHaveValue('Keep these notes.'); await expect(page.getByText('USD 383.1900', { exact: true })).toBeVisible();
  const qrRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/images/wechat-contact.jpeg');
  const contact = page.locator('header').getByRole('button', { name: '联系团队', exact: true }); await contact.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog.locator('.contact-channel h3').first()).toHaveText('WeChat'); await expect(dialog.getByRole('link', { name: '查看原始尺寸二维码', exact: true })).toHaveAttribute('href', '/images/wechat-contact.jpeg');
  await expect(dialog.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/8801560066410');
  const links = await dialog.locator('a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))); expect(links.join('\n')).not.toContain(token);
  expect((await (await qrRequest).allHeaders()).referer).toBeUndefined();
  const originalQr = await request.get('/images/wechat-contact.jpeg'); expect(originalQr.status()).toBe(200);
  expect(createHash('sha256').update(await originalQr.body()).digest('hex')).toBe('6f7da6232bd6e2edb515b662d10287bff4a0313aa74dcd33c37875cd179848bf');
  await page.keyboard.press('Escape'); await expect(contact).toBeFocused();
  const cookies = await page.context().cookies(); expect(cookies.some((cookie) => cookie.name === 'medaxis_locale')).toBe(false);
});

test('commercial document fits both languages at desktop, tablet, 390px and 320px', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000); const token = await configure(request);
  for (const locale of ['en', 'zh-CN']) for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`/q/${token}`); if (locale === 'zh-CN') await page.getByRole('button', { name: '简体中文', exact: true }).click();
    await expect(page.getByText('USD 383.1900', { exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })); expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    for (const button of await page.locator('button:visible').all()) { const bounds = await button.boundingBox(); expect(bounds?.height).toBeGreaterThanOrEqual(44); }
    await page.screenshot({ path: testInfo.outputPath(`quotation-${locale}-${width}.png`), fullPage: true });
  }
});

declare global { interface Window { quotationRevoked: string[] } }
