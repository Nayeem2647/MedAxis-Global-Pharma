import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiRequest, retryDelay } from '../../lib/api-client';
import { meta, requestId } from '../fixtures';

const dataSchema = z.object({ value: z.string() });
const success = () => Response.json({ success: true, data: { value: 'ok' }, meta });
const key = '82f591d0-346b-4cc4-8d67-e25358fa0272';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('API_INTERNAL_BASE_URL', '');
});
afterEach(() => vi.useRealTimers());

describe('REST contracts and validation', () => {
  it('validates envelope and endpoint data, uses configured origin and JSON Accept', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest('/v1/public/products?locale=en', dataSchema)).resolves.toEqual({ success: true, data: { value: 'ok' }, meta });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://api.example.test/v1/public/products?locale=en');
    expect(new Headers(options?.headers).get('accept')).toBe('application/json');
    expect(options?.credentials).toBe('omit');
  });

  it('includes admin cookies and prevents caching even when the caller asks to cache', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetcher);
    await apiRequest('/v1/admin/settings', dataSchema, { cache: 'force-cache', next: { tags: ['settings'] } });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('next');
  });

  it.each([
    { success: true, data: { value: 3 }, meta },
    { success: true, data: { value: 'ok' }, meta: { timestamp: 'invalid' } },
    { success: true, meta },
    null,
    ['unexpected'],
  ])('rejects malformed success payloads: %j', async (payload) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)));
    await expect(apiRequest('/v1/public/products', dataSchema)).rejects.toMatchObject({ status: 200, code: 'INVALID_API_RESPONSE' });
  });

  it('retains validation fields and request ID without retrying 422', async () => {
    const details = [{ field: 'items.0.quantity', issue: 'Must be positive.' }];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid quantity.', status: 422, details }, meta }, { status: 422 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest('/v1/public/products', dataSchema)).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED', requestId, details });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sanitizes Cloudflare HTML using status and request ID', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>PRIVATE proxy internals<script>alert(1)</script></html>', { status: 502, headers: { 'content-type': 'text/html', 'x-request-id': requestId } })));
    const error: unknown = await apiRequest('/v1/public/products', dataSchema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR', requestId });
    if (error instanceof ApiError) expect(error.message).not.toMatch(/PRIVATE|html|script/);
  });

  it('handles malformed JSON and a lying 2xx error envelope', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{broken', { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(Response.json({ success: false, error: { code: 'NO', message: 'No', status: 403 }, meta }));
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest('/v1/public/products', dataSchema)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    await expect(apiRequest('/v1/public/products', dataSchema)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });

  it('fails clearly for missing config or paths outside the versioned API', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    await expect(apiRequest('/v1/public/products', dataSchema)).rejects.toThrow('NEXT_PUBLIC_API_BASE_URL');
    await expect(apiRequest('https://other.example/v1/public/products', dataSchema)).rejects.toThrow('API paths');
  });

  it.each(['/v1/public/../../admin/settings', '/v1/public/%2e%2e/admin/settings'])('rejects API path traversal %s', async (path) => {
    await expect(apiRequest(path, dataSchema)).rejects.toThrow('traversal');
  });

  it('uses the private override only on the server', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetcher);
    vi.stubEnv('API_INTERNAL_BASE_URL', 'http://private-backend:4000');
    await apiRequest('/v1/public/products', dataSchema);
    expect(String(fetcher.mock.calls[0][0])).toContain('http://private-backend:4000/');
    vi.stubGlobal('window', {});
    await apiRequest('/v1/public/products', dataSchema);
    expect(String(fetcher.mock.calls[1][0])).toContain('https://api.example.test/');
  });
});

describe('bounded retries', () => {
  it('honors integer Retry-After, including delays above the fallback cap', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '40' } }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetcher);
    const result = apiRequest('/v1/public/products', dataSchema);
    await vi.advanceTimersByTimeAsync(39_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toHaveProperty('data.value', 'ok');
  });

  it.each([429, 500, 503])('stops after three retries for %i, including HTML proxy failures', async (status) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('<html>unavailable</html>', { status, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetcher);
    const check = expect(apiRequest('/v1/public/products', dataSchema)).rejects.toMatchObject({ status });
    await vi.runAllTimersAsync();
    await check;
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('retries transient network failures and returns a typed error after exhaustion', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetcher);
    const check = expect(apiRequest('/v1/public/products', dataSchema)).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    await vi.runAllTimersAsync();
    await check;
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('retries a read connection interrupted after response headers arrive', async () => {
    vi.useFakeTimers();
    const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError('connection reset')); } });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(broken, { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetcher);
    const result = apiRequest('/v1/public/products', dataSchema);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toHaveProperty('data.value', 'ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries quotation acceptance with the same header key and strict terms-only payload', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetcher);
    const result = apiRequest('/v1/public/quotation/accept/abc', dataSchema, { method: 'POST', idempotencyKey: key, json: { terms_accepted: true } });
    await vi.runAllTimersAsync();
    await result;
    expect(fetcher.mock.calls[1][1]?.body).toBe('{"terms_accepted":true}');
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('x-idempotency-key')).toBe(key);
  });

  it('replays identical RFQ JSON and key after a 503, despite later caller mutation', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetcher);
    const json = { idempotency_key: key, quantity: 1 };
    const result = apiRequest('/v1/public/rfq/quick-quote', dataSchema, { method: 'POST', json });
    json.quantity = 999;
    await vi.runAllTimersAsync();
    await result;
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = fetcher.mock.calls[0][1];
    const second = fetcher.mock.calls[1][1];
    expect(first?.body).toBe(JSON.stringify({ idempotency_key: key, quantity: 1 }));
    expect(second?.body).toBe(first?.body);
    expect(new Headers(second?.headers).get('x-idempotency-key')).toBe(key);
  });

  it.each([
    { path: '/v1/admin/settings', idempotencyKey: key },
    { path: '/v1/public/rfq/cart', idempotencyKey: undefined },
  ])('does not retry unsupported or unkeyed mutations: $path', async ({ path, idempotencyKey }) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest(path, dataSchema, { method: 'POST', idempotencyKey, json: {} })).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 409, 422])('never retries HTTP %i even on a keyed mutation', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest('/v1/public/rfq/cart', dataSchema, { method: 'POST', idempotencyKey: key, json: {} })).rejects.toMatchObject({ status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched idempotency keys before sending', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    await expect(apiRequest('/v1/public/rfq/cart', dataSchema, { method: 'POST', idempotencyKey: key, json: { idempotency_key: 'other' } })).rejects.toThrow('identical');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('aborts a retry backoff without issuing another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const check = expect(apiRequest('/v1/public/products', dataSchema, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await check;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses bounded exponential jitter for invalid or missing Retry-After', () => {
    expect(retryDelay(null, 0, 0)).toBe(1000);
    expect(retryDelay('invalid', 1, 0.5)).toBe(2500);
    expect(retryDelay('0', 8, 1)).toBe(0);
    expect(retryDelay(null, 8, 1)).toBe(30_000);
  });
});
