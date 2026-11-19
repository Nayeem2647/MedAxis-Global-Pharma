import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const api = 'http://127.0.0.1:4100';
async function configure(request: APIRequestContext, scenario = 'normal') { const email = `${randomUUID()}@fixture.example`; expect((await request.post(`${api}/__test__/admin`, { data: { email, scenario } })).ok()).toBe(true); return email; }
async function state(request: APIRequestContext, email: string, action?: string) { const response = await request.get(`${api}/__test__/admin?${new URLSearchParams({ email, ...(action ? { action } : {}) })}`); return (await response.json()) as { data: { calls: { path: string; method: string; cookie: string; origin: string; query: string }[]; connects: number; disconnects: number; active: number; revoked: boolean; other_cookie?: string } }; }
async function password(page: Page, email: string) { await page.goto('/admin/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill('fixture-password'); await page.getByRole('button', { name: 'Continue to authenticator' }).click(); await expect(page.getByRole('heading', { name: 'Complete two-factor verification' })).toBeVisible(); }
async function login(page: Page, email: string, backup = false) { await password(page, email); if (backup) { await page.getByRole('button', { name: 'Use a backup code' }).click(); await page.getByLabel('Backup code', { exact: true }).fill('FIXTURE-BACKUP'); } else await page.getByLabel('Authenticator code', { exact: true }).fill('123456'); await page.getByRole('button', { name: 'Verify and sign in' }).click(); await expect(page).toHaveURL(/\/admin$/); await expect(page.getByRole('heading', { name: 'RFQ operations' })).toBeVisible(); }
const forbidden = /NEVER_RENDER_ADMIN|token_hash|password_hash|FIXTURE-FULL|FIXTURE-PRE|plausible\.example|PublicShell|CartProvider/;

test('admin profile settings save identity, picture and password', async ({ page, request }) => {
  await page.route('https://fixture-avatars.s3.ap-southeast-1.amazonaws.com/**', (route) =>
    route.fulfill({ path: 'public/images/medaxis-logo.png', contentType: 'image/png' }));
  const email = await configure(request); await login(page, email);
  await page.locator('.admin-account > summary').click();
  await page.locator('.admin-account-menu').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Profile Information' })).toBeVisible();
  await expect(page.locator('.admin-account-identity')).toContainText(email);
  const basic = page.locator('#basic-information');
  await basic.getByRole('textbox', { name: 'Full Name' }).fill('MedAxis Owner');
  await basic.getByRole('textbox', { name: 'Phone Number' }).fill('+880 1234567890');
  await basic.locator('input[name="email"]').fill('owner@example.test');
  const chooser = page.waitForEvent('filechooser');
  await basic.getByRole('button', { name: 'Change profile picture' }).click();
  await (await chooser).setFiles('public/images/medaxis-logo.png');
  await expect(basic.getByText('Picture ready. Select Save Changes to apply it.')).toBeVisible();
  const picture = await page.getByRole('img', { name: 'Current profile picture' }).getAttribute('src');
  expect(picture).toMatch(/^data:image\/jpeg;base64,/);
  await basic.getByLabel('Current password').fill('fixture-password');
  await basic.getByRole('button', { name: 'Save Changes' }).click();
  await expect(basic.getByText('Profile changes saved.')).toBeVisible();
  await expect(page.locator('.admin-account > summary')).toContainText('MedAxis Owner');
  await page.reload();
  await expect(page.locator('#basic-information').getByRole('textbox', { name: 'Full Name' })).toHaveValue('MedAxis Owner');
  const saved = page.getByRole('img', { name: 'Current profile picture' });
  await expect(saved).toHaveAttribute('src', /avatars\/s3\/fixture\.jpg\?X-Amz-Expires=120/);
  await expect.poll(() => saved.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const passwordCard = page.locator('#change-password');
  await passwordCard.getByLabel('Current Password').fill('fixture-password');
  await passwordCard.locator('input[name="new_password"]').fill('A longer private password');
  await passwordCard.getByLabel('Confirm Password').fill('A longer private password');
  await passwordCard.getByRole('button', { name: 'Save Changes' }).click();
  await expect(passwordCard.getByText('Password changed. Other sessions have been signed out.')).toBeVisible();
});

test('password-only/forged state cannot obtain private HTML, data or RSC', async ({ page, request, context }) => {
  const email = await configure(request); await password(page, email);
  const pre = (await context.cookies()).find((value) => value.name === 'pre_auth_session'); expect(pre).toMatchObject({ path: '/api/admin/auth', httpOnly: true, secure: true, sameSite: 'Strict' }); expect(await page.evaluate(() => document.cookie)).not.toContain('pre_auth_session');
  const denied = await context.request.get('/admin', { maxRedirects: 0 }); expect(denied.status()).toBe(307); expect(new URL(denied.headers().location, 'http://127.0.0.1:3100').href).toBe('http://127.0.0.1:3100/admin/login');
  const passwordOnly = await context.request.get('/api/admin/rfqs'); expect(passwordOnly.status()).toBe(401); expect(await passwordOnly.text()).not.toContain('Authorized buyer fixture');
  expect((await state(request, email)).data.calls.some((call) => call.path === 'rfqs')).toBe(false);
  await context.addCookies([{ name: 'medaxis_admin_session', value: 'forged', url: 'http://127.0.0.1:3100', httpOnly: true, sameSite: 'Strict' }]);
  await page.evaluate(() => { localStorage.setItem('admin', 'true'); sessionStorage.setItem('authenticated', 'true'); });
  for (const rsc of [false, true]) { const response = await context.request.get(`/admin${rsc ? '?_rsc=security' : ''}`, { maxRedirects: 0, headers: rsc ? { RSC: '1' } : {} }); expect(response.status()).toBe(307); expect(await response.text()).not.toContain('Authorized buyer fixture'); }
  expect((await request.get('/api/admin/rfqs')).status()).toBe(401); await page.goto('/admin'); await expect(page).toHaveURL(/\/admin\/login$/);
});

test('MFA maps/renews full cookies, protects HTML/RSC and uses authoritative RFQ/FX data', async ({ page, request, context }) => {
  const email = await configure(request); const destinations: string[] = []; page.on('request', (value) => destinations.push(value.url()));
  const mfaReply = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/admin/auth/verify-totp'); await login(page, email);
  const relayed = (await (await mfaReply).headersArray()).filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value);
  expect(relayed).toHaveLength(2); expect(relayed.find((value) => value.startsWith('pre_auth_session='))).toMatch(/Path=\/api\/admin\/auth;.*Max-Age=0/);
  expect(relayed.find((value) => value.startsWith('medaxis_admin_session='))).toMatch(/^medaxis_admin_session=s%3A[^;]+; Path=\/;.*HttpOnly;.*SameSite=Strict;.*Secure/);
  const cookies = await context.cookies(); expect(cookies.filter((value) => value.name === 'medaxis_admin_session')).toHaveLength(1); expect(cookies.find((value) => value.name === 'medaxis_admin_session')).toMatchObject({ path: '/', httpOnly: true, sameSite: 'Strict', secure: true }); expect(cookies.some((value) => value.name === 'pre_auth_session')).toBe(false);
  await expect(page.getByText('47 matching RFQs')).toBeVisible(); await expect(page.getByText('122.50000000', { exact: true })).toBeVisible(); await expect(page.getByText('RFQ-2026-001', { exact: true })).toBeVisible();
  for (const rsc of [false, true]) { const response = await context.request.get(`/admin${rsc ? '?_rsc=private' : ''}`, { headers: rsc ? { RSC: '1' } : {} }); expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toContain('no-store'); expect(response.headers()['referrer-policy']).toBe('no-referrer'); expect(response.headers()['x-robots-tag']).toContain('noindex');
    const renewal = response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie' && header.value.startsWith('medaxis_admin_session=')); expect(renewal).toHaveLength(1); expect(renewal[0].value).toContain(`medaxis_admin_session=${cookies.find((value) => value.name === 'medaxis_admin_session')?.value}; Path=/;`); expect(renewal[0].value).toMatch(/HttpOnly;.*SameSite=Strict;.*Secure/); expect(renewal[0].value).not.toContain('Domain=');
    const body = await response.text(); expect(body).not.toMatch(forbidden); expect(body).toContain('Authorized buyer fixture'); }
  expect(await page.locator('body').innerHTML()).not.toMatch(forbidden); expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({ local: {}, session: {} }); expect(await page.evaluate(() => document.cookie)).not.toContain('medaxis_admin_session');
  expect(destinations.filter((url) => /plausible|google-analytics|recaptcha|4100\/v1\/admin/.test(url))).toEqual([]);
  const calls = (await state(request, email)).data.calls; expect(calls.filter((call) => call.path === 'auth/sessions').length).toBeGreaterThanOrEqual(4); expect(calls.every((call) => call.origin === 'http://127.0.0.1:3100')).toBe(true); expect(calls.find((call) => call.path === 'auth/verify-totp')?.cookie).toContain('pre_auth_session=');
  const navigation = page.waitForResponse((response) => response.request().isNavigationRequest() && new URL(response.url()).pathname === '/admin/rfqs'); await page.getByRole('link', { name: 'RFQ inbox', exact: true }).click(); expect((await navigation).headers()['cache-control']).toContain('no-store');
  expect((await state(request, email)).data.calls.filter((call) => call.path === 'auth/sessions').length).toBeGreaterThan(calls.filter((call) => call.path === 'auth/sessions').length);
});

test('filters, pagination, reset and empty state send only registered query fields', async ({ page, request }) => {
  const email = await configure(request); await login(page, email); await page.getByRole('link', { name: 'Next', exact: true }).click(); await expect(page.getByText('RFQ-2026-002', { exact: true })).toBeVisible();
  await page.getByLabel('Search', { exact: true }).fill('no-matches'); await page.getByLabel('Status', { exact: true }).selectOption('SUBMITTED'); await page.getByRole('button', { name: 'Apply filters' }).click(); await expect(page.getByText('No RFQs match these filters.')).toBeVisible(); expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await page.getByRole('link', { name: 'Clear', exact: true }).click(); await expect(page.getByText('47 matching RFQs')).toBeVisible();
  const query = (await state(request, email)).data.calls.filter((call) => call.path === 'rfqs').map((call) => new URLSearchParams(call.query)); expect(query.some((value) => value.get('page') === '2')).toBe(true); expect(query.some((value) => value.get('q') === 'no-matches' && value.get('page') === '1')).toBe(true); for (const value of query) expect([...value.keys()].every((key) => ['page', 'limit', 'q', 'status', 'buyer_type', 'date_from', 'date_to'].includes(key))).toBe(true);
});

test('backup-code MFA, session revocation and confirmed logout preserve cookie rules', async ({ page, request, context }) => {
  const email = await configure(request); await login(page, email, true); await page.getByRole('link', { name: 'Sessions', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Other active session' })).toBeVisible(); const revoke = page.getByRole('button', { name: 'Revoke other sessions' }); await expect(revoke).toBeDisabled(); await page.getByRole('checkbox', { name: 'Revoke every other' }).check(); await revoke.click(); await expect(page.getByText('1 other session(s) revoked.')).toBeVisible(); await expect(page.getByRole('heading', { name: 'Other active session' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/\/admin\/login$/); expect((await context.cookies()).some((value) => ['pre_auth_session', 'medaxis_admin_session'].includes(value.name))).toBe(false); expect((await state(request, email)).data.revoked).toBe(true); await page.goto('/admin/sessions'); await expect(page).toHaveURL(/\/admin\/login$/);
  await expect.poll(async () => (await state(request, email)).data.active).toBe(0);
  await page.goBack(); await expect(page).toHaveURL(/\/admin\/login$/); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible(); expect(await page.content()).not.toContain('Authorized buyer fixture');
});

test('revoking another session blocks its API/HTML/RSC and keeps the current session usable', async ({ page, request, browser }) => {
  const email = await configure(request); await login(page, email); const seeded = (await state(request, email, 'other-session')).data.other_cookie; expect(seeded).toBeTruthy();
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    await other.addCookies([{ name: 'medaxis_admin_session', value: seeded!, domain: '127.0.0.1', path: '/', httpOnly: true, secure: true, sameSite: 'Strict' }]); const otherPage = await other.newPage(); await otherPage.goto('/admin'); await expect(otherPage.getByRole('heading', { name: 'RFQ operations' })).toBeVisible();
    await page.getByRole('link', { name: 'Sessions', exact: true }).click(); await page.getByRole('checkbox', { name: 'Revoke every other' }).check(); await page.getByRole('button', { name: 'Revoke other sessions' }).click(); await expect(page.getByText('1 other session(s) revoked.')).toBeVisible();
    expect((await other.request.get('/api/admin/rfqs')).status()).toBe(401);
    for (const rsc of [false, true]) { const response = await other.request.get(`/admin${rsc ? '?_rsc=revoked' : ''}`, { maxRedirects: 0, headers: rsc ? { RSC: '1' } : {} }); expect(response.status()).toBe(307); expect(response.headers()['cache-control']).toContain('no-store'); expect(await response.text()).not.toContain('Authorized buyer fixture'); }
    await expect(otherPage).toHaveURL(/\/admin\/login$/, { timeout: 12_000 }); await page.getByRole('link', { name: 'RFQ inbox', exact: true }).click(); await expect(page.getByText('47 matching RFQs')).toBeVisible();
  } finally { await other.close(); }
});

test('live events deduplicate, refetch after reconnect and reauthenticate on expiry', async ({ page, request }) => {
  const email = await configure(request); await login(page, email); await expect(page.getByText('Live: connected', { exact: true })).toBeVisible(); await expect(page.getByRole('checkbox', { name: 'Sound alerts' })).not.toBeChecked(); const first = (await state(request, email)).data; expect(first.active).toBe(1);
  await state(request, email, 'event'); await expect(page.getByText('New enquiry: RFQ-LIVE-001', { exact: true })).toHaveCount(1); await expect.poll(async () => (await state(request, email)).data.calls.filter((call) => call.path === 'rfqs').length).toBeGreaterThan(first.calls.filter((call) => call.path === 'rfqs').length);
  await state(request, email, 'disconnect'); await expect.poll(async () => (await state(request, email)).data.connects, { timeout: 12_000 }).toBeGreaterThan(1); await expect.poll(async () => (await state(request, email)).data.active).toBe(1);
  await state(request, email, 'expire'); await expect(page).toHaveURL(/\/admin\/login$/, { timeout: 12_000 });
});

test('production BFF streams heartbeats then reconnects/refetches after its real 55-second duration limit', async ({ page, request }) => {
  test.setTimeout(85_000);
  const email = await configure(request); const firstResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/admin/stream'); await login(page, email);
  await expect(page.getByText('Live: connected', { exact: true })).toBeVisible(); const first = await firstResponse; expect(first.status()).toBe(200); const headers = await first.allHeaders(); expect(headers['content-type']).toContain('text/event-stream'); expect(headers['x-accel-buffering']).toBe('no'); expect(headers['cache-control']).toContain('no-store');
  const initial = (await state(request, email)).data; const started = performance.now(); expect(initial.active).toBe(1);
  await expect.poll(async () => (await state(request, email)).data.connects, { timeout: 72_000, intervals: [1000] }).toBe(2);
  expect(performance.now() - started).toBeGreaterThan(50_000); expect(performance.now() - started).toBeLessThan(72_000);
  await expect.poll(async () => (await state(request, email)).data.calls.filter((call) => call.path === 'rfqs').length).toBeGreaterThan(initial.calls.filter((call) => call.path === 'rfqs').length);
  await expect.poll(async () => (await state(request, email)).data.calls.filter((call) => call.path === 'fx-rates').length).toBeGreaterThan(initial.calls.filter((call) => call.path === 'fx-rates').length);
  const final = (await state(request, email)).data; expect(final.active).toBe(1); expect(final.disconnects).toBe(1); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/\/admin\/login$/); await expect.poll(async () => (await state(request, email)).data.active).toBe(0);
});

test('lockout, HTML upstream errors and BFF Origin/path attacks fail safely', async ({ page, request }) => {
  const email = await configure(request, 'lockout'); await page.goto('/admin/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill('fixture-password'); await page.getByRole('button', { name: 'Continue to authenticator' }).click(); await expect(page.getByRole('alert', { name: 'Admin request feedback' })).toContainText('Retry after 900 seconds.'); await page.getByRole('button', { name: 'Continue to authenticator' }).click(); expect((await state(request, email)).data.calls.filter((call) => call.path === 'auth/login')).toHaveLength(1);
  expect((await request.post('/api/admin/auth/logout', { data: {}, headers: { origin: 'https://evil.example' } })).status()).toBe(403); expect((await request.get('/api/admin/catalog/unregistered')).status()).toBe(404); expect((await request.get('/api/admin/rfqs?price=1')).status()).toBe(400);
  const proxyEmail = await configure(request, 'proxy'); await login(page, proxyEmail); await expect(page.getByRole('alert', { name: 'Admin request feedback' })).toBeVisible(); expect(await page.content()).not.toContain('NEVER_RENDER_ADMIN_PROXY');
});

test('human inactivity locks and signs out without background session polling', async ({ page, request }) => {
  const email = await configure(request); await login(page, email); await expect(page.getByText('Live: connected', { exact: true })).toBeVisible(); const before = (await state(request, email)).data.calls.filter((call) => call.path === 'auth/sessions').length;
  await page.clock.install(); await page.clock.fastForward(31 * 60_000); await expect(page).toHaveURL(/\/admin\/login$/); const after = (await state(request, email)).data; expect(after.revoked).toBe(true); expect(after.calls.filter((call) => call.path === 'auth/sessions').length).toBe(before);
});

test('console and login fit desktop/tablet/mobile with keyboard focus', async ({ page, request }, testInfo) => {
  const email = await configure(request); await login(page, email);
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: 950 }); await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`admin-${width}.png`), fullPage: true }); }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByLabel('Search', { exact: true }).focus(); await expect(page.getByLabel('Search', { exact: true })).toBeFocused(); await page.keyboard.press('Tab'); await expect(page.getByLabel('Status', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL(/\/admin\/login$/); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath('admin-login-320.png'), fullPage: true });
});

