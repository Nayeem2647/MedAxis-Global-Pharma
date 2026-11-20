import { NextRequest, NextResponse } from 'next/server';
import { apiUrl } from './api-config';
import { parseApiResponse } from './api-client';
import { adminCookieHeader, adminFrontendOrigin, adminPrivateHeaders, expiredAdminCookie, mappedAdminCookies, sessionsSchema } from './admin-contract';

/** Page response renewal complements fresh server guards; never authenticates locally. */
export async function adminPageBoundary(request: NextRequest): Promise<NextResponse> {
  const secure = (response: NextResponse) => { for (const [key, value] of Object.entries(adminPrivateHeaders)) response.headers.set(key, value); return response; };
  // A second local dev server may use another port. Send the browser to the
  // configured admin origin before it submits credentials; the BFF stays strict.
  if (process.env.NODE_ENV === 'development') {
    try {
      const current = new URL(request.url);
      const configured = adminFrontendOrigin();
      const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
      if (loopback.has(current.hostname) && loopback.has(configured.hostname) && current.origin !== configured.origin) {
        const destination = new URL(configured.origin);
        destination.pathname = current.pathname;
        destination.search = current.search;
        return secure(NextResponse.redirect(destination, 307));
      }
    } catch { /* Existing configuration feedback is handled by the admin adapter. */ }
  }
  if (new URL(request.url).pathname === '/admin/login') return secure(NextResponse.next());
  const denied = () => { const url = new URL(request.url); url.pathname = '/admin/login'; url.search = ''; const response = secure(NextResponse.redirect(url, 307)); response.headers.append('Set-Cookie', expiredAdminCookie()); return response; };
  let cookie: string; try { cookie = adminCookieHeader(request.headers.get('cookie')); } catch { return denied(); }
  if (!cookie) return denied();
  try {
    const response = await fetch(apiUrl('/v1/admin/auth/sessions'), { headers: { Accept: 'application/json', Cookie: cookie, Origin: adminFrontendOrigin().origin }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403) return denied();
    const mapped = mappedAdminCookies(response.headers); await parseApiResponse(response, sessionsSchema, [200]);
    const next = secure(NextResponse.next()); for (const value of mapped) next.headers.append('Set-Cookie', value); return next;
  } catch {
    return secure(new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin temporarily unavailable | MedAxis</title><style>body{margin:0;background:#f0f7f9;color:#193746;font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{box-sizing:border-box;width:min(90%,520px);padding:36px;background:white;border:1px solid #dce8ed;border-radius:16px}h1{font-size:24px;line-height:1.3}p{color:#526b78}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#087f96}a:first-child{padding:10px 18px;background:#087f96;color:white;border-radius:7px;text-decoration:none}</style></head><body><main><strong>MedAxis Admin</strong><h1>Admin temporarily unavailable</h1><p>We could not verify your session because the server or database is taking too long to respond. Please try again shortly.</p><nav><a href="/admin">Try again</a><a href="/admin/login">Back to sign in</a></nav></main></body></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5' } }));
  }
}
