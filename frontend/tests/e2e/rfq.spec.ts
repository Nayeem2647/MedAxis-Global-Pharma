import { expect, test, type Page, type Route } from '@playwright/test';
import { z } from 'zod';
import { rfqBusinessSchema } from '../../lib/rfq';
import { meta } from '../fixtures';
import { installImageFixture } from './image-fixture';

const payloadSchema = rfqBusinessSchema.safeExtend({ idempotency_key: z.uuidv4(), turnstile_token: z.string().min(1) });
const id = '82f591d0-346b-4cc4-8d67-e25358fa0272';
const cors = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3100', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-idempotency-key,accept', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Expose-Headers': 'x-request-id' };
const pdf = { name: 'private-prescription.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nprivate medical test fixture') };
function body(route: Route) { const value: unknown = route.request().postDataJSON(); return payloadSchema.parse(value); }
async function reply(route: Route, status: number, data: unknown, extra: Record<string, string> = {}) {
  await route.fulfill({ status, headers: { ...cors, ...extra }, contentType: 'application/json', body: JSON.stringify({ success: true, data, meta }) });
}
async function confirmed(route: Route, number = 'RFQ-2026-00001', status = 201) {
  const input = body(route);
  expect(route.request().headers()['x-idempotency-key']).toBe(input.idempotency_key);
  await reply(route, status, { rfq_id: id, rfq_number: number, status: 'SUBMITTED', total_items: input.items.length, created_at: meta.timestamp, procurement_cost_bdt: 'NEVER_RENDER_INTERNAL_COST' });
}
async function failure(route: Route, status: number, code: string, details?: { field: string; issue: string }[]) {
  await route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify({ success: false, error: { status, code, message: 'NEVER_RENDER_UPSTREAM_SECRET', details }, meta }) });
}
async function api(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route('http://127.0.0.1:4100/v1/public/**', async (route) => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    await handler(route);
  });
}
async function quick(page: Page, locale = 'en') {
  await page.goto(`/${locale}`); await page.locator('.header-quote').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=name]').fill('Uncatalogued medicine');
  await dialog.locator('input[name=full_name]').fill('Private Buyer');
  await dialog.locator('input[name=destination_country]').fill('BD');
  await dialog.locator('input[name=email]').fill('buyer@example.test');
  await expect(dialog.locator('button[type=submit]')).toBeEnabled();
  return dialog;
}
test.beforeEach(async ({ page }) => {
  await installImageFixture(page);
  await page.route('https://plausible.example.test/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '/* no analytics during tests */' }));
});

test('Quick Quote sends one nested line, locks duplicate submits and confirms the actual reference', async ({ page }) => {
  const requests: ReturnType<typeof body>[] = [];
  await api(page, async (route) => { requests.push(body(route)); await new Promise((resolve) => setTimeout(resolve, 300)); await confirmed(route); });
  const dialog = await quick(page);
  await dialog.locator('input[name=quantity]').fill('3');
  await dialog.getByText('Optional delivery details & notes', { exact: true }).click();
  await dialog.locator('textarea[name="items.0.line_notes"]').fill('Line-specific requirement');
  await dialog.locator('button[type=submit]').evaluate((element) => { if (!(element instanceof HTMLButtonElement)) throw new Error('Expected button'); element.click(); element.click(); });
  await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ contact: { full_name: 'Private Buyer', customer_type: 'B2C_PATIENT', email: 'buyer@example.test', preferred_locale: 'en' }, destination_country: 'BD', locale: 'en', prescription_ids: [], items: [{ is_uncatalogued: true, custom_medicine_name: 'Uncatalogued medicine', quantity: 3, packaging_unit: 'BOX', line_notes: 'Line-specific requirement' }] });
  expect(requests[0]?.items[0]).not.toHaveProperty('product_id'); expect(requests[0]).not.toHaveProperty('notes');
  expect(await page.content()).not.toContain('NEVER_RENDER_INTERNAL_COST');
  const stored = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  expect(stored).not.toMatch(/Private Buyer|buyer@example|prescription|idempotency|turnstile/);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await quick(page); await page.getByRole('dialog').locator('button[type=submit]').click();
  await expect(page.getByRole('dialog').getByText('RFQ-2026-00001', { exact: true })).toBeVisible();
  expect(requests[1]?.idempotency_key).not.toBe(requests[0]?.idempotency_key);
});

for (const status of [429, 503]) test(`${status} / proxy HTML preserves frozen body and recovers the same intent`, async ({ page }) => {
  test.setTimeout(45_000);
  const bodies: string[] = [];
  await api(page, async (route) => {
    bodies.push(route.request().postData() ?? '');
    if (bodies.length <= 4) await route.fulfill({ status, contentType: 'text/html', headers: { ...cors, 'Retry-After': '1', 'x-request-id': 'proxy-request-id' }, body: '<html>NEVER_RENDER_PROXY_SECRET</html>' });
    else await confirmed(route, 'RFQ-2026-00429', 200);
  });
  const dialog = await quick(page); await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('button', { name: 'Check / retry the same enquiry', exact: true })).toBeVisible({ timeout: 20_000 });
  expect(bodies).toHaveLength(4); expect(new Set(bodies).size).toBe(1);
  await expect(dialog.locator('input[name=full_name]')).toBeDisabled(); await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('proxy-request-id'); expect(await dialog.innerText()).not.toContain('NEVER_RENDER_PROXY_SECRET');
  await dialog.getByRole('button', { name: 'Check / retry the same enquiry', exact: true }).click();
  await expect(dialog.getByText('RFQ-2026-00429', { exact: true })).toBeVisible(); expect(new Set(bodies).size).toBe(1);
});

test('a committed enquiry whose response is lost is replayed once without creating another RFQ', async ({ page }) => {
  test.setTimeout(45_000);
  const committed = new Map<string, { serialized: string; number: string }>();
  const attempts: string[] = [];
  await api(page, async (route) => {
    const input = body(route);
    const serialized = route.request().postData() ?? '';
    attempts.push(serialized);
    const previous = committed.get(input.idempotency_key);
    if (!previous) {
      committed.set(input.idempotency_key, { serialized, number: `RFQ-2026-${String(committed.size + 1).padStart(5, '0')}` });
      // The controlled upstream commits, then loses its first HTTP response.
      await route.abort('connectionreset'); return;
    }
    expect(serialized).toBe(previous.serialized);
    await confirmed(route, previous.number, 200);
  });
  const dialog = await quick(page);
  await dialog.locator('button[type=submit]').evaluate((button) => { if (!(button instanceof HTMLButtonElement)) throw new Error('Expected submit'); button.click(); button.click(); });
  await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(committed.size).toBe(1); expect(attempts).toHaveLength(2); expect(new Set(attempts).size).toBe(1);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await quick(page); await page.getByRole('dialog').locator('button[type=submit]').click();
  await expect(page.getByRole('dialog').getByText('RFQ-2026-00002', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(committed.size).toBe(2); expect(attempts).toHaveLength(4);
  expect(bodyKeys(attempts).size).toBe(2);
});

function bodyKeys(values: string[]): Set<string> {
  return new Set(values.map((value) => { const input: unknown = JSON.parse(value); return payloadSchema.parse(input).idempotency_key; }));
}

test('RFQ contact, prescriptions and challenge data never enter analytics, browser storage or public console output', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  page.on('pageerror', (error) => logs.push(error.message));
  await api(page, async (route) => { await confirmed(route); });
  const dialog = await quick(page);
  const payloads = await page.evaluate(() => {
    const transform = window.plausible?.o?.transformRequest;
    if (!transform) throw new Error('Analytics privacy transform is missing.');
    const secret = 'PRIVATE_MEDICAL_SESSION_SENTINEL';
    const publicUrl = `${location.origin}/en?email=buyer@example.test&turnstile_token=${secret}#${secret}`;
    return {
      origin: location.origin,
      pageview: transform({ n: 'pageview', u: publicUrl, d: 'untrusted-domain', props: { full_name: 'Private Buyer', prescription_ids: [secret], turnstile_token: secret }, r: `${location.origin}/q/${secret}`, session: secret, medical: secret }),
      custom: transform({ n: 'RFQSubmitted', u: publicUrl, props: { email: 'buyer@example.test', prescription: secret } }),
      private: transform({ n: 'pageview', u: `${location.origin}/q/${secret}` }),
      encodedPrivate: transform({ n: 'pageview', u: `${location.origin}/en/%71/${secret}` }),
      foreign: transform({ n: 'pageview', u: `https://foreign.example/en/${secret}` }),
    };
  });
  expect(payloads.pageview).toEqual({ n: 'pageview', u: `${payloads.origin}/en`, d: 'medaxisglobalpharma.com' });
  expect(payloads.custom).toBeNull(); expect(payloads.private).toBeNull(); expect(payloads.encodedPrivate).toBeNull(); expect(payloads.foreign).toBeNull();
  await dialog.locator('button[type=submit]').click(); await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
  const sensitive = /PRIVATE_MEDICAL_SESSION_SENTINEL|Private Buyer|buyer@example\.test|prescription|turnstile_token|idempotency_key/;
  expect(JSON.stringify(stored)).not.toMatch(sensitive); expect(logs.join('\n')).not.toMatch(sensitive);
});

test('403 reacquires only the challenge, then 409 requires same-intent reconciliation', async ({ page }) => {
  const requests: ReturnType<typeof body>[] = [];
  await api(page, async (route) => {
    requests.push(body(route));
    if (requests.length === 1) await failure(route, 403, 'TURNSTILE_VERIFICATION_FAILED');
    else if (requests.length === 2) await failure(route, 409, 'IDEMPOTENCY_KEY_CONFLICT');
    else await confirmed(route, 'RFQ-2026-00409', 200);
  });
  const dialog = await quick(page); await dialog.locator('button[type=submit]').click();
  const retry = dialog.getByRole('button', { name: 'Retry with new verification', exact: true });
  await expect(retry).toBeEnabled(); await expect(dialog.locator('input[name=email]')).toHaveValue('buyer@example.test');
  await retry.click();
  await expect(dialog).toContainText('This attempt cannot yet be reconciled');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check / retry the same enquiry', exact: true }).click();
  await expect(dialog.getByText('RFQ-2026-00409', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(3); expect(requests[1]?.idempotency_key).toBe(requests[0]?.idempotency_key);
  expect(requests[1]?.turnstile_token).not.toBe(requests[0]?.turnstile_token);
  expect(requests[1]).toEqual({ ...requests[0], turnstile_token: requests[1]?.turnstile_token }); expect(requests[2]).toEqual(requests[1]);
});

test('nested 422 errors map to fields and permit a corrected, newly verified enquiry', async ({ page }) => {
  const keys: string[] = [];
  await api(page, async (route) => {
    keys.push(body(route).idempotency_key);
    if (keys.length === 1) await failure(route, 422, 'VALIDATION_FAILED', [{ field: 'items.0.packaging_unit', issue: 'NEVER_RENDER_UPSTREAM_SECRET' }, { field: 'contact.email', issue: 'Check email.' }]);
    else await confirmed(route);
  });
  const dialog = await quick(page); await dialog.locator('button[type=submit]').click();
  await expect(dialog.locator('input[name=unit]')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.locator('input[name=email]')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('This packaging unit was not accepted'); expect(await dialog.innerText()).not.toContain('NEVER_RENDER_UPSTREAM_SECRET');
  await dialog.locator('input[name=unit]').fill('PACK'); await expect(dialog.locator('button[type=submit]')).toBeEnabled(); await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible(); expect(keys[1]).not.toBe(keys[0]);
});

test('Chinese patient and B2B rules require email/company while prescriptions remain optional', async ({ page }) => {
  const requests: ReturnType<typeof body>[] = [];
  await api(page, async (route) => { requests.push(body(route)); await confirmed(route); });
  const dialog = await quick(page, 'zh-CN');
  await dialog.locator('input[name=destination_country]').fill('CN'); await dialog.locator('input[name=email]').fill('');
  await dialog.locator('input[name=whatsapp_number]').fill('+8801560066410');
  await dialog.locator('button[type=submit]').click(); await expect(dialog.locator('input[name=email]')).toHaveAttribute('aria-invalid', 'true'); expect(requests).toHaveLength(0);
  await dialog.locator('input[name=email]').fill('buyer@example.test');
  await dialog.locator('select').first().selectOption('B2B_WHOLESALE'); await dialog.locator('button[type=submit]').click();
  await expect(dialog.locator('input[name=company_name]')).toHaveAttribute('aria-invalid', 'true'); expect(requests).toHaveLength(0);
  await dialog.locator('input[name=company_name]').fill('Buyer Company'); await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible();
  expect(requests[0]).toMatchObject({ contact: { customer_type: 'B2B_WHOLESALE', company_name: 'Buyer Company', preferred_locale: 'zh-CN' }, locale: 'zh-CN', destination_country: 'CN', prescription_ids: [] });
  await expect(dialog).toContainText('系统不会自动发送微信通知');
});

test('an English page independently requires email for Chinese preference or China destination', async ({ page }) => {
  const requests: ReturnType<typeof body>[] = [];
  await api(page, async (route) => { requests.push(body(route)); await confirmed(route); });
  for (const reason of ['preferred_locale', 'destination_country']) {
    const dialog = await quick(page);
    await dialog.locator('input[name=email]').fill('');
    await dialog.locator('input[name=whatsapp_number]').fill('+8801560066410');
    if (reason === 'preferred_locale') await dialog.locator('select').nth(1).selectOption('zh-CN');
    else await dialog.locator('input[name=destination_country]').fill('CN');
    const before = requests.length;
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.locator('input[name=email]')).toHaveAttribute('aria-invalid', 'true'); expect(requests).toHaveLength(before);
    await expect(dialog.locator('input[name=full_name]')).toHaveValue('Private Buyer');
    await expect(dialog.locator('input[name=whatsapp_number]')).toHaveValue('+8801560066410');
    await dialog.locator('input[name=email]').fill('buyer@example.test'); await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible(); expect(requests.at(-1)?.prescription_ids).toEqual([]);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  }
});

test('cart confirmation removes submitted quantities and preserves newer medicine-list additions', async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let submitted = false;
  await api(page, async (route) => { expect(body(route).items[0]).toMatchObject({ product_id: id, is_uncatalogued: false, quantity: 2, packaging_unit: 'BOX' }); submitted = true; await pending; await confirmed(route); });
  await page.goto('/en');
  const add = page.getByRole('button', { name: 'Add Osimert 80mg to RFQ list', exact: true }); await add.click(); await add.click();
  await page.getByRole('button', { name: 'Quotation cart, 1 items', exact: true }).click();
  await page.getByRole('button', { name: 'Submit this RFQ list', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.locator('input[name=full_name]').fill('Cart Buyer'); await dialog.locator('input[name=destination_country]').fill('BD'); await dialog.locator('input[name=email]').fill('buyer@example.test');
  await expect(dialog.locator('button[type=submit]')).toBeEnabled(); await dialog.locator('button[type=submit]').click(); await expect.poll(() => submitted).toBe(true);
  await page.evaluate(() => {
    const raw = localStorage.getItem('medaxis_rfq_cart'); if (!raw) throw new Error('Cart missing');
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || !('items' in input) || !Array.isArray(input.items)) throw new Error('Invalid cart');
    for (const item of input.items) { if (typeof item === 'object' && item && 'quantity' in item) item.quantity = 4; }
    const value = JSON.stringify(input); localStorage.setItem('medaxis_rfq_cart', value); window.dispatchEvent(new StorageEvent('storage', { key: 'medaxis_rfq_cart', newValue: value }));
  });
  release?.(); await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click(); await page.getByRole('button', { name: 'Quotation cart, 1 items', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Quantity for Osimert 80mg', { exact: true })).toHaveValue('2');
});

test('credentialed multipart upload retains the HttpOnly ownership cookie and private previews stay in memory', async ({ page, context }) => {
  const uploads: string[] = []; let rfqCookie = '';
  await page.addInitScript(() => { const original = URL.revokeObjectURL; window.revokedPrescriptionUrls = []; URL.revokeObjectURL = (url) => { window.revokedPrescriptionUrls.push(url); original(url); }; });
  await api(page, async (route) => {
    if (route.request().url().endsWith('/prescriptions/upload')) {
      expect(route.request().headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      const multipart = route.request().postDataBuffer()?.toString() ?? '';
      expect(multipart).toContain('name="prescription"'); expect(multipart).toContain('name="turnstile_token"'); expect(multipart).not.toContain('idempotency_key');
      const prescriptionId = crypto.randomUUID(); uploads.push(prescriptionId);
      await reply(route, 201, { prescription_id: prescriptionId, mime_type: 'application/pdf', file_size_bytes: pdf.buffer.length, uploaded_at: meta.timestamp }, { 'Set-Cookie': 'prescription_upload_session=fixture-owned-session; HttpOnly; SameSite=Strict; Path=/v1/public; Max-Age=7776000' });
    } else { expect(body(route).prescription_ids).toEqual(uploads); rfqCookie = (await route.request().allHeaders()).cookie ?? ''; await confirmed(route); }
  });
  const dialog = await quick(page); await dialog.getByText('Optional prescription attachments', { exact: true }).click();
  for (let index = 0; index < 5; index++) {
    const picker = dialog.locator('input[type=file]'); await expect(picker).toBeEnabled(); await picker.setInputFiles({ ...pdf, name: `private-${index}.pdf` });
    await expect(dialog.getByText('Uploaded privately', { exact: true })).toHaveCount(index + 1);
  }
  await expect(dialog.locator('input[type=file]')).toBeDisabled();
  const cookies = await context.cookies('http://127.0.0.1:4100/v1/public/rfq/quick-quote');
  expect(cookies.find((cookie) => cookie.name === 'prescription_upload_session')).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/v1/public' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('prescription_upload_session');
  const stored = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  expect(stored).not.toMatch(/prescription|fixture-owned-session|private-\d|buyer@example|Private Buyer/);
  await expect(dialog.locator('button[type=submit]')).toBeEnabled(); await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible(); expect(rfqCookie).toContain('prescription_upload_session=fixture-owned-session');
  await expect.poll(() => page.evaluate(() => window.revokedPrescriptionUrls.filter((url) => url.startsWith('blob:')).length)).toBe(5);
});

test('spoofed/oversized files never upload; upload cancellation does not block an attachment-free enquiry', async ({ page }) => {
  let uploads = 0;
  await api(page, async (route) => {
    if (route.request().url().endsWith('/prescriptions/upload')) { uploads++; await new Promise((resolve) => setTimeout(resolve, 1500)); await reply(route, 201, { prescription_id: id, mime_type: 'application/pdf', file_size_bytes: pdf.buffer.length, uploaded_at: meta.timestamp }).catch(() => undefined); }
    else { expect(body(route).prescription_ids).toEqual([]); await confirmed(route); }
  });
  const dialog = await quick(page); await dialog.getByText('Optional prescription attachments', { exact: true }).click();
  const picker = dialog.locator('input[type=file]');
  await picker.setInputFiles({ name: 'spoof.png', mimeType: 'image/png', buffer: pdf.buffer }); await expect(dialog).toContainText('whose content matches'); expect(uploads).toBe(0);
  await picker.setInputFiles({ ...pdf, buffer: Buffer.alloc(5_242_881) }); await expect(dialog).toContainText('non-empty file no larger'); expect(uploads).toBe(0);
  await picker.setInputFiles(pdf); await expect(dialog.getByRole('button', { name: 'Cancel upload', exact: true })).toBeVisible();
  await expect.poll(() => uploads).toBe(1); await dialog.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(dialog.locator('button[type=submit]')).toBeEnabled(); await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByText('RFQ-2026-00001', { exact: true })).toBeVisible(); expect(uploads).toBe(1);
});

test('bilingual RFQ fields, optional sections and contact artwork fit desktop/tablet/mobile', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const locale of ['en', 'zh-CN']) for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = await quick(page, locale);
    const text = locale === 'en' ? 'Optional delivery details & notes' : '选填：配送信息与备注'; await dialog.getByText(text, { exact: true }).click();
    await dialog.getByText(locale === 'en' ? 'Optional prescription attachments' : '选填：处方附件', { exact: true }).click();
    await dialog.getByText(locale === 'en' ? 'Official WeChat & WhatsApp contact' : '官方微信与 WhatsApp', { exact: true }).click();
    const geometry = await dialog.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right, viewport: innerWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width); expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    for (const control of await dialog.locator('input:visible, select:visible, textarea:visible, button:visible, summary:visible').all()) {
      const bounds = await control.boundingBox(); expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(dialog.locator('.contact-channel h3').first()).toHaveText(locale === 'zh-CN' ? 'WeChat' : 'WhatsApp');
    await dialog.evaluate((element) => { element.scrollTop = 0; }); await page.screenshot({ path: testInfo.outputPath(`rfq-${locale}-${width}.png`) });
    await dialog.getByRole('button', { name: locale === 'en' ? 'Close' : '关闭', exact: true }).click();
  }
});

declare global { interface Window { revokedPrescriptionUrls: string[] } }
