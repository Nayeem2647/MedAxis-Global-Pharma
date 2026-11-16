import { z } from 'zod';
import { apiUrl } from './api-config';

export const paginationSchema = z.object({
  page: z.number().int().positive().max(100_000), limit: z.number().int().positive().max(100),
  total_items: z.number().int().nonnegative(), total_pages: z.number().int().nonnegative(),
  has_next: z.boolean(), has_prev: z.boolean(),
});
const metaSchema = z.object({
  timestamp: z.iso.datetime(), request_id: z.string().min(1), pagination: paginationSchema.optional(),
});
const detailSchema = z.object({ field: z.string(), issue: z.string() });
const failureSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string().min(1), message: z.string().min(1), status: z.number().int().min(400).max(599), details: z.array(detailSchema).optional() }),
  meta: metaSchema,
});
const successSchema = z.object({ success: z.literal(true), data: z.unknown(), meta: metaSchema });

export type ApiMeta = z.infer<typeof metaSchema>;
export type ApiFieldDetail = z.infer<typeof detailSchema>;
export type ApiFailure = z.infer<typeof failureSchema>;
export interface ApiSuccess<T> { success: true; data: T; meta: ApiMeta }
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
export interface RuntimeSchema<T> { parse(value: unknown): T }
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly ApiFieldDetail[];
  readonly requestId?: string;
  readonly responseValidated: boolean;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: { status: number; code: string; details?: readonly ApiFieldDetail[]; requestId?: string; cause?: unknown; responseValidated?: boolean; retryAfterSeconds?: number }) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? [];
    this.requestId = options.requestId;
    this.responseValidated = options.responseValidated ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class ApiRedirect extends Error {
  readonly status = 301;
  constructor(readonly location: string) { super('This catalog URL has moved.'); this.name = 'ApiRedirect'; }
}

interface NextFetchOptions { revalidate?: number | false; tags?: string[] }
export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: JsonValue;
  headers?: HeadersInit;
  idempotencyKey?: string;
  signal?: AbortSignal;
  cache?: RequestCache;
  next?: NextFetchOptions;
  /** Only catalog detail readers opt in; all other requests reject redirects. */
  catalogRedirect?: { sourcePath: string };
  /** HttpOnly prescription staging ownership, restricted to the RFQ intake endpoints. */
  prescriptionSession?: boolean;
  successStatuses?: readonly number[];
  /** Per-attempt deadline; an interrupted write remains an uncertain outcome. */
  timeoutMs?: number;
}

const transientStatuses = new Set([429, 500, 503]);
const idempotentMutation = /^\/v1\/public\/(?:rfq\/(?:quick-quote|cart)|quotation\/accept\/[^/?]+)$/;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function retryDelay(retryAfter: string | null, retry: number, random = Math.random()): number {
  if (retryAfter !== null && /^(?:0|[1-9]\d*)$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (Number.isSafeInteger(seconds) && seconds * 1000 <= 2_147_483_647) return seconds * 1000;
  }
  return Math.min(30_000, 1000 * 2 ** retry + Math.max(0, Math.min(random, 1)) * 1000);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function fallbackError(response: Response): ApiError {
  const codes: Record<number, string> = {
    400: 'INVALID_REQUEST', 401: 'AUTHENTICATION_REQUIRED', 403: 'ACCESS_DENIED', 404: 'RESOURCE_NOT_FOUND',
    409: 'CONFLICT', 422: 'VALIDATION_FAILED', 429: 'RATE_LIMIT_EXCEEDED', 500: 'INTERNAL_SERVER_ERROR', 503: 'SERVICE_UNAVAILABLE',
  };
  return new ApiError(response.status === 429 ? 'Too many requests. Please try again later.' : 'The request could not be completed. Please try again.', {
    status: response.status, code: codes[response.status] ?? (response.ok ? 'INVALID_API_RESPONSE' : 'HTTP_ERROR'),
    requestId: response.headers.get('x-request-id') ?? undefined,
    retryAfterSeconds: retryAfterSeconds(response),
  });
}
function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483 ? Number(value) : undefined;
}

function releaseBody(response: Response): void {
  // Next's deduplicated fetch can return a tee branch. Awaiting its cancellation
  // waits for the other consumer and can stall an otherwise complete HTTP error.
  try { void response.body?.cancel().catch(() => undefined); } catch { /* Preserve the original HTTP status. */ }
}

export async function parseApiResponse<T>(response: Response, schema: RuntimeSchema<T>, successStatuses?: readonly number[]): Promise<ApiSuccess<T>> {
  // Proxy HTML and binary responses are never rendered or passed to a JSON parser.
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
    await releaseBody(response);
    throw fallbackError(response);
  }
  let input: unknown;
  try { input = await response.json(); } catch (cause: unknown) {
    if (cause instanceof TypeError) {
      throw new ApiError('The server connection was interrupted. Please try again.', { status: 0, code: 'NETWORK_ERROR', cause });
    }
    throw fallbackError(response);
  }
  const failure = failureSchema.safeParse(input);
  if (failure.success && !response.ok && failure.data.error.status === response.status) {
    throw new ApiError(failure.data.error.message, {
      status: response.status, code: failure.data.error.code,
      details: failure.data.error.details, requestId: failure.data.meta.request_id,
      responseValidated: true,
      retryAfterSeconds: retryAfterSeconds(response),
    });
  }
  if (!response.ok) throw fallbackError(response);
  if (successStatuses && !successStatuses.includes(response.status)) throw fallbackError(response);
  const envelope = successSchema.safeParse(input);
  if (!envelope.success || !Object.prototype.hasOwnProperty.call(input, 'data')) throw fallbackError(response);
  try {
    return { success: true, data: schema.parse(envelope.data.data), meta: envelope.data.meta };
  } catch (cause: unknown) {
    throw new ApiError('The server returned an invalid response.', {
      status: response.status, code: 'INVALID_API_RESPONSE', requestId: envelope.data.meta.request_id, cause,
    });
  }
}

async function request<T>(path: string, options: ApiRequestOptions, read: (response: Response) => Promise<T>, accept = 'application/json'): Promise<T> {
  const url = apiUrl(path);
  const method = options.method ?? 'GET';
  const admin = path.startsWith('/v1/admin/');
  const privateQuotation = url.pathname.startsWith('/v1/public/quotation/');
  if (options.prescriptionSession && (method !== 'POST' || !/^\/v1\/public\/rfq\/(?:quick-quote|cart)$/.test(url.pathname))) {
    throw new Error('Prescription credentials are restricted to RFQ intake.');
  }
  const headers = new Headers(options.headers);
  headers.set('Accept', accept);
  if (options.json !== undefined) headers.set('Content-Type', 'application/json');
  if (method === 'GET' && options.json !== undefined) throw new Error('GET requests cannot include a JSON body.');

  const bodyKey = options.json && typeof options.json === 'object' && !Array.isArray(options.json)
    ? options.json.idempotency_key : undefined;
  const key = options.idempotencyKey ?? headers.get('x-idempotency-key') ?? (typeof bodyKey === 'string' ? bodyKey : undefined);
  if (key !== undefined) {
    if (!uuidV4.test(key) || (bodyKey !== undefined && bodyKey !== key) || (headers.has('x-idempotency-key') && headers.get('x-idempotency-key') !== key)) {
      throw new Error('A valid, identical UUID v4 idempotency key is required in the header and payload.');
    }
    headers.set('x-idempotency-key', key);
  }
  const canRetry = method === 'GET' || (method === 'POST' && idempotentMutation.test(url.pathname) && key !== undefined);
  // Serialize once so all retries replay the exact original payload and key.
  const body = options.json === undefined ? undefined : JSON.stringify(options.json);
  const init: RequestInit & { next?: NextFetchOptions } = {
    method, headers, body, signal: options.signal, redirect: options.catalogRedirect ? 'manual' : 'error',
    credentials: admin || options.prescriptionSession ? 'include' : 'omit',
    cache: admin || privateQuotation || method !== 'GET' ? 'no-store' : options.cache,
    ...(privateQuotation || admin ? { referrerPolicy: 'no-referrer' as const } : {}),
    ...(!admin && !privateQuotation && method === 'GET' && options.next ? { next: options.next } : {}),
  };

  for (let attempt = 0; ; attempt += 1) {
    options.signal?.throwIfAborted();
    const attemptSignal = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined;
    const signal = attemptSignal && options.signal ? AbortSignal.any([attemptSignal, options.signal]) : attemptSignal ?? options.signal;
    let response: Response;
    try { response = await fetch(url, { ...init, signal }); } catch (cause: unknown) {
      options.signal?.throwIfAborted();
      if (canRetry && attempt < 3) { await delay(retryDelay(null, attempt), options.signal); continue; }
      throw new ApiError('Unable to reach the server. Please try again.', { status: 0, code: 'NETWORK_ERROR', cause });
    }
    if (options.catalogRedirect && response.status >= 300 && response.status < 400) {
      const { validateCatalogRedirect } = await import('./catalog-path');
      const target = response.status === 301 ? validateCatalogRedirect(options.catalogRedirect.sourcePath, response.headers.get('location')) : null;
      await releaseBody(response);
      if (target) throw new ApiRedirect(target);
      throw new ApiError('The server returned an invalid catalog redirect.', { status: response.status, code: 'INVALID_REDIRECT' });
    }
    if (canRetry && transientStatuses.has(response.status) && attempt < 3) {
      await releaseBody(response);
      await delay(retryDelay(response.headers.get('retry-after'), attempt), options.signal);
      continue;
    }
    try { return await read(response); } catch (error: unknown) {
      options.signal?.throwIfAborted();
      if ((attemptSignal?.aborted || error instanceof ApiError && error.status === 0) && canRetry && attempt < 3) {
        await delay(retryDelay(null, attempt), options.signal);
        continue;
      }
      if (attemptSignal?.aborted) throw new ApiError('The server connection timed out.', { status: 0, code: 'NETWORK_ERROR', cause: error });
      throw error;
    }
  }
}

export function apiRequest<T>(path: string, schema: RuntimeSchema<T>, options: ApiRequestOptions = {}): Promise<ApiSuccess<T>> {
  return request(path, options, (response) => parseApiResponse(response, schema, options.successStatuses));
}

/** Private PDF delivery shares JSON retry/error handling without exposing token URLs as links. */
export function apiQuotationPdf(path: string, signal?: AbortSignal): Promise<Blob> {
  if (!/^\/v1\/public\/quotation\/pdf\/[a-f0-9]{64}$/.test(path)) throw new Error('A valid private quotation PDF path is required.');
  return request(path, { signal, timeoutMs: 25_000 }, async (response) => {
    if (!response.ok || response.status !== 200 || !/^application\/pdf(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      // Normal JSON before-stream failures retain their typed status/code/request ID.
      await parseApiResponse(response, z.never(), [200]);
      throw fallbackError(response);
    }
    let blob: Blob;
    try { blob = await response.blob(); } catch (cause: unknown) {
      throw new ApiError('The document connection was interrupted.', { status: 0, code: 'NETWORK_ERROR', cause });
    }
    if (!blob.size || await blob.slice(0, 5).text() !== '%PDF-') throw fallbackError(response);
    signal?.throwIfAborted();
    return blob;
  }, 'application/pdf, application/json');
}
