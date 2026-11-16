import { NextRequest, NextResponse } from 'next/server';
import { apiUrl } from './api-config';
import { parseApiResponse } from './api-client';
import { adminCookieHeader, adminFrontendOrigin, adminPrivateHeaders, expiredAdminCookie, mappedAdminCookies, sessionsSchema } from './admin-contract';

/** Page response renewal complements fresh server guards; never authenticates locally. */
export async function adminPageBoundary(request: NextRequest): Promise<NextResponse> {
  const secure = (response: NextResponse) => { for (const [key, value] of Object.entries(adminPrivateHeaders)) response.headers.set(key, value); return response; };
  if (new URL(request.url).pathname === '/admin/login') return secure(NextResponse.next());
  const denied = () => { const url = new URL(request.url); url.pathname = '/admin/login'; url.search = ''; const response = secure(NextResponse.redirect(url, 307)); response.headers.append('Set-Cookie', expiredAdminCookie()); return response; };
  let cookie: string; try { cookie = adminCookieHeader(request.headers.get('cookie')); } catch { return denied(); }
  if (!cookie) return denied();
  try {
    const response = await fetch(apiUrl('/v1/admin/auth/sessions'), { headers: { Accept: 'application/json', Cookie: cookie, Origin: adminFrontendOrigin().origin }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403) return denied();
    const mapped = mappedAdminCookies(response.headers); await parseApiResponse(response, sessionsSchema, [200]);
    const next = secure(NextResponse.next()); for (const value of mapped) next.headers.append('Set-Cookie', value); return next;
  } catch { return secure(new NextResponse('The admin session could not be verified. Please reload and try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })); }
}
