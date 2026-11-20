import { z } from 'zod';
import { apiUrl } from './api-config';
import { ApiError, parseApiResponse } from './api-client';
import { adminFrontendOrigin } from './admin-contract';
import { CUSTOMER_COOKIE, customerPrivateHeaders, customerProxyRule } from './customer-contract';

function failure(status: number, code = 'ACCESS_DENIED') {
  return Response.json({ success: false, error: { status, code, message: 'The customer request could not be completed.' }, meta: { request_id: crypto.randomUUID(), timestamp: new Date().toISOString() } }, { status, headers: customerPrivateHeaders });
}
export async function proxyCustomer(request: Request, segments: readonly string[]) {
  const path = segments.join('/');
  if (!customerProxyRule(path, request.method)) return failure(404, 'RESOURCE_NOT_FOUND');
  const url = new URL(request.url);
  if (url.pathname !== `/api/customer/${path}` || /[%\\]/.test(url.pathname)) return failure(400, 'INVALID_REQUEST');
  let configured: URL;
  try { configured = adminFrontendOrigin(); } catch { return failure(503, 'SERVICE_UNAVAILABLE'); }
  const local = new Set(['localhost', '127.0.0.1', '[::1]']);
  const localDevelopment = process.env.NODE_ENV !== 'production' && local.has(url.hostname) && local.has(configured.hostname);
  if ((!localDevelopment && url.origin !== configured.origin) || (request.headers.get('host') ?? url.host) !== url.host) return failure(403);
  const mutation = request.method !== 'GET';
  if (mutation && (request.headers.get('origin') !== url.origin || ![null, 'same-origin', 'none'].includes(request.headers.get('sec-fetch-site')))) return failure(403);
  if ([...url.searchParams.keys()].some((key) => !['page', 'limit'].includes(key) || url.searchParams.getAll(key).length !== 1) || [...url.searchParams.values()].some((value) => !/^[1-9]\d{0,5}$/.test(value))) return failure(400, 'INVALID_REQUEST');
  const headers = new Headers({ Accept: path.endsWith('/pdf') ? 'application/pdf' : 'application/json', Origin: configured.origin });
  const cookies = (request.headers.get('cookie') ?? '').split(';').map((value) => value.trim()).filter((value) => value.startsWith(`${CUSTOMER_COOKIE}=`));
  if (cookies.length > 1 || cookies.some((value) => value.length > 2200 || /[\r\n,\s]/.test(value))) return failure(400, 'INVALID_REQUEST');
  if (cookies[0]) headers.set('Cookie', cookies[0]);
  const agent = request.headers.get('user-agent'); if (agent) headers.set('User-Agent', agent.slice(0, 2000));
  let body: string | undefined;
  if (mutation) {
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) return failure(415, 'UNSUPPORTED_MEDIA_TYPE');
    if (Number(request.headers.get('content-length') ?? 0) > 512000) return failure(413, 'REQUEST_TOO_LARGE');
    const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 512000) { await reader.cancel(); return failure(413, 'REQUEST_TOO_LARGE'); } chunks.push(value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = new TextDecoder().decode(bytes);
    try { JSON.parse(body); } catch { return failure(400, 'INVALID_REQUEST'); }
    headers.set('Content-Type', 'application/json');
  }
  const outgoing = new Headers(customerPrivateHeaders);
  try {
    const response = await fetch(apiUrl(`/v1/public/customer/${path}${url.search}`), { method: request.method, headers, body, cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]) });
    for (const cookie of response.headers.getSetCookie()) {
      if (!cookie.startsWith(`${CUSTOMER_COOKIE}=`) || /[\r\n]/.test(cookie)) continue;
      if (!/;\s*HttpOnly(?:;|$)/i.test(cookie) || !/;\s*SameSite=Strict(?:;|$)/i.test(cookie) || process.env.NODE_ENV === 'production' && !/;\s*Secure(?:;|$)/i.test(cookie)) throw new Error('Invalid customer cookie.');
      outgoing.append('Set-Cookie', cookie.replace(/;\s*Path=[^;]*/i, '; Path=/api/customer').replace(/;\s*Domain=[^;]*/i, ''));
    }
    const retry = response.headers.get('retry-after'); if (retry && /^\d{1,7}$/.test(retry)) outgoing.set('Retry-After', retry);
    if (response.ok && path.endsWith('/pdf') && /^application\/pdf/i.test(response.headers.get('content-type') ?? '')) {
      outgoing.set('Content-Type', 'application/pdf'); outgoing.set('Content-Disposition', 'attachment; filename="MedAxis-quotation.pdf"');
      return new Response(response.body, { status: response.status, headers: outgoing });
    }
    const result = await parseApiResponse(response, z.unknown());
    return Response.json(result, { status: response.status, headers: outgoing });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    const result = failure(apiError?.status && apiError.status >= 400 ? apiError.status : 503, apiError?.code ?? 'SERVICE_UNAVAILABLE');
    for (const cookie of outgoing.getSetCookie()) result.headers.append('Set-Cookie', cookie);
    if (outgoing.has('Retry-After')) result.headers.set('Retry-After', outgoing.get('Retry-After')!);
    return result;
  }
}
