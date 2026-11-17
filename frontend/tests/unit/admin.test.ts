import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { meta } from '../fixtures';
import { adminCookieHeader, adminProxyRule, mappedAdminCookies, sessionsSchema, adminRfqsSchema, adminFxSchema } from '../../lib/admin-contract';
import { proxyAdmin } from '../../lib/admin-proxy';
import { adminPageBoundary } from '../../lib/admin-edge';
import { apiRequest } from '../../lib/api-client';
import { adminFiltersSchema, rfqPage, rfqQuery } from '../../lib/admin-data';
import { AdminSseParser, AdminStreamConnection, adminReconnectDelay, type AdminStreamEvent } from '../../lib/admin-stream';

const id = '82f591d0-346b-4cc4-8d67-e25358fa0272';
const signed = 's%3Aopaque-signature.UNCHANGED';
const full = `medaxis_admin_session=${signed}`;
const pre = 'pre_auth_session=s%3Apreauth.UNCHANGED';
const expires = '2030-11-16T12:00:00.000Z';
const session = { id, current: true, ip_address: '127.0.0.*', geo: { country: 'BD', city: null }, user_agent: 'Test browser', last_active_at: meta.timestamp, expires_at: expires };
const cookie = (pair: string, path: string) => `${pair}; Path=${path}; HttpOnly; SameSite=Strict; Secure; Max-Age=1800`;
const success = (data: unknown, headers?: HeadersInit) => Response.json({ success: true, data, meta }, { headers });
const request = (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => new Request(`https://medaxis.test/api/admin/${path}`, { method, headers: { origin: 'https://medaxis.test', cookie: `${full}; ${pre}; medaxis_locale=en; unrelated=secret`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test'); vi.stubEnv('API_INTERNAL_BASE_URL', ''); vi.stubEnv('ADMIN_FRONTEND_ORIGIN', 'https://medaxis.test'); });
afterEach(() => vi.useRealTimers());

describe('opaque admin cookies and private boundary', () => {
  it('maps separate cookies, preserves signed bytes/security and removes upstream domains', () => {
    const headers = new Headers(); headers.append('Set-Cookie', cookie(full, '/v1/admin') + '; Domain=api.test'); headers.append('Set-Cookie', cookie(pre, '/v1/admin/auth'));
    expect(mappedAdminCookies(headers, true)).toEqual([cookie(full, '/').replace('; Path=/', '; Path=/'), cookie(pre, '/api/admin/auth')]);
    expect(adminCookieHeader(`${full}; ${pre}; prescription_upload_session=private`)).toBe(full);
    expect(adminCookieHeader(`${full}; ${pre}`, true)).toBe(pre);
    expect(() => adminCookieHeader(`${full}; ${full}`)).toThrow();
  });
  it('last logout clear wins over renewal without duplicate cookie variants', () => {
    const headers = new Headers(); headers.append('Set-Cookie', cookie(full, '/v1/admin')); headers.append('Set-Cookie', 'medaxis_admin_session=; Path=/v1/admin; Max-Age=0; HttpOnly; SameSite=Strict; Secure');
    expect(mappedAdminCookies(headers, true)).toEqual(['medaxis_admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure']);
  });
  it.each(['Path=/; HttpOnly; SameSite=Strict; Secure', 'Path=/v1/admin; SameSite=Strict; Secure', 'Path=/v1/admin; HttpOnly; SameSite=Lax; Secure', 'Path=/v1/admin; HttpOnly; SameSite=Strict'])('rejects weakened production attributes: %s', (attributes) => {
    expect(() => mappedAdminCookies(new Headers({ 'set-cookie': `${full}; ${attributes}` }), true)).toThrow();
  });
  it.each(['', `${pre}`, `${full}; ${full}`])('password-only/missing/ambiguous cookies cannot access private pages: %s', async (value) => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const response = await adminPageBoundary(new NextRequest('https://medaxis.test/admin/rfqs', { headers: { cookie: value } }));
    expect(response.status).toBe(307); expect(response.headers.get('location')).toBe('https://medaxis.test/admin/login'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('consults Express for forged cookies and relays verified renewals on the page response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(success([session], { 'set-cookie': cookie(full, '/v1/admin') })); vi.stubGlobal('fetch', fetcher);
    expect((await adminPageBoundary(new NextRequest('https://medaxis.test/admin', { headers: { cookie: full } }))).status).toBe(307);
    const response = await adminPageBoundary(new NextRequest('https://medaxis.test/admin', { headers: { cookie: full } }));
    expect(response.headers.get('set-cookie')).toContain(`${full}; Path=/;`); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('cookie')).toBe(full);
  });
});

describe('fixed-origin Node admin adapter', () => {
  it.each([['https://evil.test', 'same-origin'], ['https://medaxis.test', 'cross-site'], ['', 'none']])('denies unsafe mutation Origin %s/%s', async (origin, site) => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    expect((await proxyAdmin(request('auth/logout', 'POST', {}, { origin, 'sec-fetch-site': site }), ['auth', 'logout'])).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([['https://evil.test', 'GET'], ['catalog/unregistered', 'GET'], ['rfqs', 'DELETE'], ['auth/verify-email', 'POST']])('does not invent/proxy path %s %s', (path, method) => expect(adminProxyRule(path, method)).toBeNull());
  it('forwards only approved headers and opaque pre-auth to MFA; relays each cookie separately', async () => {
    const headers = new Headers(); headers.append('Set-Cookie', cookie(full, '/v1/admin')); headers.append('Set-Cookie', 'pre_auth_session=; Path=/v1/admin/auth; HttpOnly; SameSite=Strict; Secure; Max-Age=0');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success({ admin: { id, email: 'admin@test.example', password_hash: 'NEVER_RENDER' }, session_id: id, expires_at: expires }, headers)); vi.stubGlobal('fetch', fetcher);
    const response = await proxyAdmin(request('auth/verify-totp', 'POST', { code: '123456' }, { authorization: 'secret', 'x-forwarded-for': 'fake' }), ['auth', 'verify-totp']);
    expect(response.status).toBe(200); const sent = new Headers(fetcher.mock.calls[0][1]?.headers); expect(sent.get('cookie')).toBe(pre); expect(sent.get('origin')).toBe('https://medaxis.test'); expect(sent.has('authorization')).toBe(false); expect(sent.has('x-forwarded-for')).toBe(false);
    expect(response.headers.getSetCookie()).toHaveLength(2); expect(await response.text()).not.toContain('password_hash');
  });
  it('rejects unknown/duplicate queries and invalid auth payloads before upstream work', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    expect((await proxyAdmin(request('rfqs?price=1'), ['rfqs'])).status).toBe(400);
    expect((await proxyAdmin(request('rfqs?page=1&page=2'), ['rfqs'])).status).toBe(400);
    expect((await proxyAdmin(request('auth/verify-totp', 'POST', { code: '123456', bypass: true }), ['auth', 'verify-totp'])).status).toBe(422); expect(fetcher).not.toHaveBeenCalled();
  });
  it('sanitizes HTML and preserves lockout Retry-After; auth writes never retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('<html>NEVER_RENDER_PROXY</html>', { status: 403, headers: { 'retry-after': '900', 'content-type': 'text/html' } })); vi.stubGlobal('fetch', fetcher);
    const response = await proxyAdmin(request('auth/login', 'POST', { email: 'admin@test.example', password: 'secret' }), ['auth', 'login']);
    expect(response.status).toBe(403); expect(response.headers.get('retry-after')).toBe('900'); expect(await response.text()).not.toContain('NEVER_RENDER');
    await expect(apiRequest('/v1/admin/auth/login', z.unknown(), { method: 'POST', json: { email: 'admin@test.example', password: 'secret' } })).rejects.toMatchObject({ status: 403, retryAfterSeconds: 900 }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('streams without buffering and cancels upstream on disconnect', async () => {
    const cancel = vi.fn(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(out) { out.enqueue(new TextEncoder().encode(': ping\n\n')); }, cancel }), { headers: { 'content-type': 'text/event-stream' } })); vi.stubGlobal('fetch', fetcher);
    const response = await proxyAdmin(request('stream'), ['stream']); expect(response.headers.get('x-accel-buffering')).toBe('no'); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const reader = response.body!.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toBe(': ping\n\n'); await reader.cancel(); expect(cancel).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('aborts a live BFF upstream at 55 seconds, before the registered 60-second route limit', async () => {
    vi.useFakeTimers(); let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (_input, options) => {
      upstreamSignal = options?.signal ?? undefined;
      return new Response(new ReadableStream({ start(out) { out.enqueue(new TextEncoder().encode(': connected\n\n')); upstreamSignal?.addEventListener('abort', () => out.error(new Error('deadline'))); } }), { headers: { 'content-type': 'text/event-stream' } });
    }));
    const response = await proxyAdmin(request('stream'), ['stream']); const reader = response.body!.getReader(); await reader.read();
    await vi.advanceTimersByTimeAsync(54_999); expect(upstreamSignal?.aborted).toBe(false); await vi.advanceTimersByTimeAsync(1); expect(upstreamSignal?.aborted).toBe(true); expect((await reader.read()).done).toBe(true); reader.releaseLock();
  });
  it('keeps multipart boundaries and binary content out of JSON transport', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(success({ uploaded: true })).mockResolvedValueOnce(new Response('%PDF-private', { headers: { 'content-type': 'application/pdf' } })); vi.stubGlobal('fetch', fetcher);
    const form = new FormData(); form.set('image', new Blob(['fixture'], { type: 'image/png' }), 'fixture.png');
    const response = await proxyAdmin(new Request('https://medaxis.test/api/admin/catalog/images', { method: 'POST', headers: { origin: 'https://medaxis.test', cookie: full }, body: form }), ['catalog', 'images']); expect(response.status).toBe(200); expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('content-type')).toContain('boundary=');
    const binary = await proxyAdmin(request(`prescriptions/${id}/stream`), ['prescriptions', id, 'stream']); expect(await binary.text()).toBe('%PDF-private');
  });
  it('maps browser admin logical paths locally while public calls keep the configured API origin', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://medaxis.test' } }); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => success('ok')); vi.stubGlobal('fetch', fetcher);
    await apiRequest('/v1/admin/settings', z.string()); await apiRequest('/v1/public/products', z.string());
    expect(String(fetcher.mock.calls[0][0])).toBe('https://medaxis.test/api/admin/settings'); expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer' }); expect(String(fetcher.mock.calls[1][0])).toBe('https://api.test/v1/public/products');
  });
});

describe('admin data and live events', () => {
  it('requires actual pagination/full sessions and rejects unsupported filters', () => {
    expect(sessionsSchema.safeParse([{ ...session, current: false }]).success).toBe(false); expect(adminRfqsSchema.safeParse([{ id }]).success).toBe(false);
    expect(adminFxSchema.safeParse({ rates: [{ currency: 'BDT', available: false }], last_error_code: null }).success).toBe(false);
    expect(() => rfqPage([], meta)).toThrow(); expect(adminFiltersSchema.safeParse({ sort: 'price' }).success).toBe(false); expect(adminFiltersSchema.safeParse({ date_from: '2026-02-30' }).success).toBe(false);
    const query = new URLSearchParams(rfqQuery(adminFiltersSchema.parse({ q: 'buyer & supplier', status: 'QUOTED', date_to: '2026-11-16' }))); expect(query.get('q')).toBe('buyer & supplier'); expect(query.get('date_to')).toBe('2026-11-16T23:59:59.999Z'); expect(query.get('limit')).toBe('20');
  });
  it('parses chunked events, strips extra data and ignores malformed IDs/timestamps/JSON', () => {
    const rows: AdminStreamEvent[] = []; const parser = new AdminSseParser((event) => rows.push(event));
    const data = JSON.stringify({ rfq_id: id, rfq_number: 'RFQ-2026-001', created_at: meta.timestamp, contact: 'NEVER_RENDER' });
    const frame = `retry: 5000\r\n: ping\r\n\r\nid: ${id}\r\nevent: NEW_RFQ\r\ndata: ${data}\r\n\r\n`;
    for (const char of frame) parser.push(char);
    parser.push(`id: fake\nevent: NEW_RFQ\ndata: ${data}\n\nid: ${id}\nevent: NEW_RFQ\ndata: {broken}\n\n`);
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain('NEVER_RENDER'); expect(() => parser.push('x'.repeat(65_537))).toThrow();
  });
  it('validates all three registered event payloads and rejects bad dates/IDs/types', () => {
    const emit = vi.fn(); const parser = new AdminSseParser(emit);
    const frame = (type: string, data: unknown) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    parser.push(frame('QUOTATION_ACCEPTED', { quotation_id: id, version_id: id, rfq_id: id, accepted_at: meta.timestamp, customer_email: 'NEVER_RENDER' }));
    parser.push(frame('CLARIFICATION_REPLY', { rfq_id: id, received_at: meta.timestamp }));
    parser.push(frame('NEW_RFQ', { rfq_id: id, rfq_number: 'RFQ-001', created_at: meta.timestamp }));
    parser.push(frame('NEW_RFQ', { rfq_id: id, rfq_number: 'RFQ-001', created_at: 'not-a-date' }));
    parser.push(frame('QUOTATION_ACCEPTED', { quotation_id: 'not-an-id', version_id: id, rfq_id: id, accepted_at: meta.timestamp }));
    parser.push(frame('CLARIFICATION_REPLY', { rfq_id: id, received_at: '2026-99-99' })); parser.push(frame('ADMIN_CONTACT_DOCUMENT', { rfq_id: id }));
    expect(emit).toHaveBeenCalledTimes(3); expect(JSON.stringify(emit.mock.calls)).not.toContain('NEVER_RENDER');
  });
  it('uses one bounded reconnect mechanism, deduplicates and reauthenticates on session loss', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const event = vi.fn(); const reconnect = vi.fn(); const unauthorized = vi.fn(); const state = vi.fn();
    const frame = `id: ${id}\nevent: CLARIFICATION_REPLY\ndata: ${JSON.stringify({ rfq_id: id, received_at: meta.timestamp })}\n\n`;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response(frame + frame, { headers: { 'content-type': 'text/event-stream' } })).mockImplementationOnce(async () => new Response('', { headers: { 'content-type': 'text/event-stream' } })).mockResolvedValueOnce(new Response(null, { status: 401 }));
    const connection = new AdminStreamConnection({ event, reconnect, unauthorized, state }, fetcher); connection.start(); connection.start(); await vi.advanceTimersByTimeAsync(0);
    expect(event).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(4999); expect(fetcher).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(1); expect(reconnect).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(5000); expect(unauthorized).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(3); connection.stop();
    expect(adminReconnectDelay(0, 0)).toBe(5000); expect(adminReconnectDelay(10, 1)).toBe(30_000);
  });
  it('stopping a pending connection aborts it and prevents late reconnection', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined; const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => { signal = options?.signal ?? undefined; return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))); });
    const connection = new AdminStreamConnection({ event: vi.fn(), state: vi.fn(), reconnect: vi.fn(), unauthorized: vi.fn() }, fetcher); connection.start(); connection.stop(); await vi.advanceTimersByTimeAsync(100_000); expect(signal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('25-second heartbeat traffic keeps the stream alive; silence triggers the 40-second watchdog', async () => {
    vi.useFakeTimers(); let output: ReadableStreamDefaultController<Uint8Array> | undefined; let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      signal = options?.signal ?? undefined;
      return new Response(new ReadableStream({ start(out) { output = out; out.enqueue(new TextEncoder().encode(': connected\n\n')); signal?.addEventListener('abort', () => out.error(new Error('aborted'))); } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const unauthorized = vi.fn(); const connection = new AdminStreamConnection({ event: vi.fn(), state: vi.fn(), reconnect: vi.fn(), unauthorized }, fetcher); connection.start(); await vi.advanceTimersByTimeAsync(0);
    for (let heartbeat = 0; heartbeat < 2; heartbeat++) { await vi.advanceTimersByTimeAsync(25_000); expect(signal?.aborted).toBe(false); output?.enqueue(new TextEncoder().encode(': ping\n\n')); await vi.advanceTimersByTimeAsync(0); }
    await vi.advanceTimersByTimeAsync(39_999); expect(signal?.aborted).toBe(false); await vi.advanceTimersByTimeAsync(1); expect(signal?.aborted).toBe(true); expect(unauthorized).not.toHaveBeenCalled(); connection.stop(); await vi.advanceTimersByTimeAsync(10_000); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('invokes the default browser fetch without binding it to the connection object', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async function(this: unknown) { expect(this).not.toBeInstanceOf(AdminStreamConnection); return new Response(null, { status: 401 }); }); vi.stubGlobal('fetch', fetcher);
    const unauthorized = vi.fn(); const connection = new AdminStreamConnection({ event: vi.fn(), state: vi.fn(), reconnect: vi.fn(), unauthorized }); connection.start(); await vi.advanceTimersByTimeAsync(0); expect(unauthorized).toHaveBeenCalledOnce(); connection.stop();
  });
});
