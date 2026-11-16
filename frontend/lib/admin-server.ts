import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiRequest, ApiError, type RuntimeSchema } from './api-client';
import { adminCookieHeader, adminFrontendOrigin, sessionsSchema, type AdminSession } from './admin-contract';

export interface AdminProblem { status: number; requestId?: string; retryAfterSeconds?: number; fields: string[] }
export function adminProblem(error: unknown): AdminProblem {
  return error instanceof ApiError ? { status: error.status, requestId: /^[\w-]{1,100}$/.test(error.requestId ?? '') ? error.requestId : undefined, retryAfterSeconds: error.retryAfterSeconds,
    fields: error.details.map((detail) => detail.field).filter((field) => /^[\w.]{1,100}$/.test(field)) } : { status: 503, fields: [] };
}
type Verified = { ok: true; cookie: string; current: AdminSession; sessions: AdminSession[] } | { ok: false; problem: AdminProblem };
/** Every call consults Express; no local signing, cookie writes, cache or pre-auth fallback. */
export async function requireAdminSession(): Promise<Verified> {
  let cookie: string;
  // Next's cookies() decodes percent escapes. Signed Express cookies must be
  // forwarded from the raw header, including their original s%3A prefix.
  try { cookie = adminCookieHeader((await headers()).get('cookie')); } catch { redirect('/admin/login'); }
  if (!cookie) redirect('/admin/login');
  try {
    const result = await apiRequest('/v1/admin/auth/sessions', sessionsSchema, { headers: { Cookie: cookie, Origin: adminFrontendOrigin().origin }, cache: 'no-store', timeoutMs: 8000 });
    const current = result.data.find((row) => row.current);
    if (!current) redirect('/admin/login');
    return { ok: true, cookie, current, sessions: result.data };
  } catch (error: unknown) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) redirect('/admin/login');
    return { ok: false, problem: adminProblem(error) };
  }
}
export async function guardedAdminRead<T>(path: string, schema: RuntimeSchema<T>) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth;
  try {
    const result = await apiRequest(path, schema, { headers: { Cookie: auth.cookie, Origin: adminFrontendOrigin().origin }, cache: 'no-store', timeoutMs: 12_000 });
    return { ok: true as const, result };
  } catch (error: unknown) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) redirect('/admin/login');
    return { ok: false as const, problem: adminProblem(error) };
  }
}
