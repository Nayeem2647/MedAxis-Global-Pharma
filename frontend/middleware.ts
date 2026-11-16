import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { isLocale, routing, type Locale } from './i18n/routing';
import { findHistoricalRedirect } from './lib/redirects';
import { adminPageBoundary } from './lib/admin-edge';

const handleLocaleRouting = createMiddleware(routing);
const excludedPath = /^\/(?:api|_next|_vercel|q|admin)(?:\/|$)/;

export function initialLocale(request: NextRequest): Locale {
  const preference = request.cookies.get('medaxis_locale')?.value;
  if (isLocale(preference)) return preference;
  return request.headers.get('cf-ipcountry') === 'CN' || /^zh/i.test(request.headers.get('accept-language')?.trim() ?? '') ? 'zh-CN' : 'en';
}

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  if (/^\/admin(?:\/|$)/.test(pathname)) return adminPageBoundary(request);
  if (excludedPath.test(pathname) || pathname.includes('.')) return NextResponse.next();
  if (pathname === '/') {
    const destination = new URL(request.url);
    destination.pathname = `/${initialLocale(request)}`;
    const response = NextResponse.redirect(destination, 307);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie, CF-IPCountry, Accept-Language');
    return response;
  }
  const historical = await findHistoricalRedirect(pathname);
  if (historical) {
    const destination = new URL(request.url);
    destination.pathname = historical;
    return NextResponse.redirect(destination, 301);
  }
  return handleLocaleRouting(request);
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next(?:/|$)|_vercel(?:/|$)|q(?:/|$)|.*\\..*).*)'],
};
