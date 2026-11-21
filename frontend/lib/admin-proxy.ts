import { z } from 'zod';
import { apiUrl } from './api-config';
import { ApiError, parseApiResponse } from './api-client';
import { ADMIN_COOKIE, adminCookieHeader, adminFrontendOrigin, adminPasswordBody, adminPrivateHeaders, adminProfileBody, adminProxyRule, backupBody, expiredAdminCookie, forgotPasswordBody, forgotPasswordResult, loginBody, loginResult, logoutResult, mappedAdminCookies, mfaResult, resetPasswordBody, resetPasswordResult, revokeResult, sessionsSchema, totpBody } from './admin-contract';

function failure(status: number, code: string, requestId = crypto.randomUUID(), details?: readonly { field: string; issue: string }[]): Response {
  return Response.json({ success: false, error: { status, code, message: status === 401 ? 'Admin authentication is required.' : status === 403 ? 'This admin action was denied.' : 'The admin request could not be completed.', ...(details?.length ? { details } : {}) }, meta: { request_id: requestId, timestamp: new Date().toISOString() } }, { status, headers: adminPrivateHeaders });
}
async function bodyBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new ApiError('Request too large.', { status: 413, code: 'REQUEST_TOO_LARGE' });
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new ApiError('Request too large.', { status: 413, code: 'REQUEST_TOO_LARGE' }); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
}
function pipeResponse(upstream: Response, headers: Headers, controller: AbortController, clean: () => void): Response {
  const reader = upstream.body?.getReader();
  if (!reader) { clean(); controller.abort(); return failure(502, 'INVALID_API_RESPONSE'); }
  const stream = new ReadableStream<Uint8Array>({
    async pull(out) { try { const part = await reader.read(); if (part.done) { clean(); out.close(); } else out.enqueue(part.value); } catch { clean(); try { out.close(); } catch { /* Disconnected downstream. */ } } },
    async cancel() { clean(); controller.abort(); try { await reader.cancel(); } catch { /* Aborted upstream. */ } },
  });
  return new Response(stream, { status: upstream.status, headers });
}

/** Fixed-origin Node BFF; Express owns all session decisions and signed values. */
export async function proxyAdmin(request: Request, segments: readonly string[]): Promise<Response> {
  const path = segments.join('/'); const rule = adminProxyRule(path, request.method);
  if (!rule) return failure(404, 'RESOURCE_NOT_FOUND');
  let origin: URL;
  try { origin = adminFrontendOrigin(); } catch { return failure(503, 'SERVICE_UNAVAILABLE'); }
  const url = new URL(request.url);
  if (url.pathname !== `/api/admin/${path}` || /[%\\]/.test(url.pathname)) return failure(400, 'INVALID_REQUEST');
  const host = request.headers.get('host') ?? url.host;
  if (host !== origin.host || url.protocol !== origin.protocol && !['localhost', '127.0.0.1'].includes(origin.hostname)) return failure(403, 'ACCESS_DENIED');
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (mutation && (request.headers.get('origin') !== origin.origin || ![null, 'same-origin', 'none'].includes(request.headers.get('sec-fetch-site')))) return failure(403, 'ACCESS_DENIED');
  if ([...url.searchParams.keys()].some((key) => !rule.query.includes(key) || url.searchParams.getAll(key).length !== 1)) return failure(400, 'INVALID_REQUEST');
  const headers = new Headers({ Accept: rule.kind === 'sse' ? 'text/event-stream' : rule.kind === 'binary' ? 'application/pdf, image/jpeg, image/png, application/json' : 'application/json', Origin: origin.origin });
  const agent = request.headers.get('user-agent'); if (agent) headers.set('User-Agent', agent.slice(0, 2000));
  try { const cookie = rule.anonymous ? '' : adminCookieHeader(request.headers.get('cookie'), rule.preAuth); if (cookie) headers.set('Cookie', cookie); }
  catch { return failure(400, 'INVALID_REQUEST'); }
  for (const name of ['x-idempotency-key', 'if-match']) { const value = request.headers.get(name); if (value && value.length <= 200 && !/[\r\n]/.test(value)) headers.set(name, value); }
  let body: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (mutation) {
      const type = request.headers.get('content-type') ?? '';
      if (rule.kind === 'multipart' ? !/^multipart\/form-data\s*;.*boundary=/i.test(type) : !/^application\/json(?:\s*;|$)/i.test(type)) return failure(415, 'UNSUPPORTED_MEDIA_TYPE');
      headers.set('Content-Type', type);
      const multipartLimitBytes = (path === 'catalog/videos' ? 102 : path === 'catalog/images' ? 26 : 6) * 1024 * 1024;
      body = new Uint8Array(await bodyBytes(request, rule.kind === 'multipart' ? multipartLimitBytes : 1024 * 1024));
      if (rule.kind !== 'multipart') {
        let input: unknown; try { input = JSON.parse(new TextDecoder().decode(body)); } catch { return failure(400, 'INVALID_REQUEST'); }
        const schema = path === 'auth/login' ? loginBody : path === 'auth/forgot-password' ? forgotPasswordBody : path === 'auth/reset-password' ? resetPasswordBody : path === 'auth/verify-totp' ? totpBody : path === 'auth/verify-backup-code' ? backupBody : path === 'auth/profile' ? adminProfileBody : path === 'auth/change-password' ? adminPasswordBody : /^auth\//.test(path) ? z.strictObject({}) : null;
        if (schema) { const parsed = schema.safeParse(input); if (!parsed.success) return failure(422, 'VALIDATION_FAILED', undefined, parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), issue: 'Check this field.' }))); }
      }
    }
  } catch (error: unknown) { return error instanceof ApiError ? failure(error.status, error.code) : failure(400, 'INVALID_REQUEST'); }
  const controller = new AbortController(); const abort = () => controller.abort(); request.signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, rule.kind === 'sse' || path === 'catalog/videos' || path === 'catalog/images' ? 55_000 : 25_000);
  const clean = () => { clearTimeout(timeout); request.signal.removeEventListener('abort', abort); };
  let cookieValues: string[] = [];
  try {
    request.signal.throwIfAborted();
    const upstream = await fetch(apiUrl(`/v1/admin/${path}${url.search}`), { method: request.method, headers, body, cache: 'no-store', redirect: 'manual', referrerPolicy: 'no-referrer', signal: controller.signal });
    cookieValues = mappedAdminCookies(upstream.headers);
    if (upstream.status === 401 && !rule.anonymous && !rule.preAuth) cookieValues = [...cookieValues.filter((value) => !value.startsWith(`${ADMIN_COOKIE}=`)), expiredAdminCookie()];
    const outgoing = new Headers(adminPrivateHeaders); for (const value of cookieValues) outgoing.append('Set-Cookie', value);
    const retry = upstream.headers.get('retry-after'); if (retry && /^\d{1,7}$/.test(retry)) outgoing.set('Retry-After', retry);
    const requestId = upstream.headers.get('x-request-id'); if (requestId && /^[\w-]{1,100}$/.test(requestId)) outgoing.set('X-Request-ID', requestId);
    if (upstream.status >= 300 && upstream.status < 400) throw new ApiError('Upstream redirect rejected.', { status: 502, code: 'INVALID_REDIRECT' });
    if (rule.kind === 'sse' && upstream.ok && /^text\/event-stream(?:;|$)/i.test(upstream.headers.get('content-type') ?? '')) { outgoing.set('Content-Type', 'text/event-stream'); outgoing.set('X-Accel-Buffering', 'no'); return pipeResponse(upstream, outgoing, controller, clean); }
    if (rule.kind === 'binary' && upstream.ok && /^(?:application\/pdf|image\/(?:jpeg|png))(?:;|$)/i.test(upstream.headers.get('content-type') ?? '')) { outgoing.set('Content-Type', upstream.headers.get('content-type')!); outgoing.set('Content-Disposition', 'attachment; filename="private-prescription"'); return pipeResponse(upstream, outgoing, controller, clean); }
    if (rule.kind === 'sse' || rule.kind === 'binary') { await parseApiResponse(upstream, z.never()); throw new ApiError('Invalid stream response.', { status: 502, code: 'INVALID_API_RESPONSE' }); }
    const schema = path === 'auth/login' ? loginResult : path === 'auth/forgot-password' ? forgotPasswordResult : path === 'auth/reset-password' ? resetPasswordResult : /^auth\/verify-/.test(path) ? mfaResult : path === 'auth/sessions' ? sessionsSchema : path === 'auth/logout' ? logoutResult : path === 'auth/revoke-sessions' ? revokeResult : z.unknown();
    const result = await parseApiResponse<unknown>(upstream, schema); outgoing.set('Content-Type', 'application/json'); clean();
    return new Response(JSON.stringify(result), { status: upstream.status, headers: outgoing });
  } catch (error: unknown) {
    clean(); controller.abort(); const typed = error instanceof ApiError ? error : null;
    const status = typed && typed.status >= 400 && typed.status <= 599 ? typed.status : 503;
    const result = failure(status, typed && /^[A-Z_]{1,80}$/.test(typed.code) ? typed.code : 'SERVICE_UNAVAILABLE', typed?.requestId && /^[\w-]{1,100}$/.test(typed.requestId) ? typed.requestId : undefined,
      typed?.details.filter((detail) => /^[\w.[\]-]{1,160}$/.test(detail.field)).map((detail) => ({ field: detail.field, issue: 'Check this field.' })));
    for (const value of cookieValues) result.headers.append('Set-Cookie', value);
    if (typed?.retryAfterSeconds !== undefined) result.headers.set('Retry-After', String(typed.retryAfterSeconds)); return result;
  }
}
