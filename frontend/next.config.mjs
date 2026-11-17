import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const isDev = process.env.NODE_ENV !== 'production';

function configuredOrigin(value, name, httpsOnly = false) {
  if (!value) return undefined;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || (httpsOnly && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${name} must be an ${httpsOnly ? 'HTTPS ' : 'HTTP(S) '}origin without credentials, query, or path.`);
  }
  return url.origin;
}

const apiOrigin = configuredOrigin(process.env.NEXT_PUBLIC_API_BASE_URL, 'NEXT_PUBLIC_API_BASE_URL');
const assetOrigin = configuredOrigin(process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL, 'NEXT_PUBLIC_R2_PUBLIC_BASE_URL', true);
const plausibleScript = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL;
const plausibleOrigin = plausibleScript && !plausibleScript.startsWith('/') ? configuredOrigin(new URL(plausibleScript).origin, 'NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL', true) : undefined;
const plausibleApiOrigin = configuredOrigin(process.env.NEXT_PUBLIC_PLAUSIBLE_API_HOST, 'NEXT_PUBLIC_PLAUSIBLE_API_HOST', true);
const imageOrigins = [...new Set(['https://cdn.medaxisglobalpharma.com', assetOrigin].filter(Boolean))];
// App Router uses inline bootstrap scripts. This static CSP preserves ISR; nonce-based
// CSP would require dynamic rendering. Production never permits unsafe-eval.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${plausibleOrigin ? ` ${plausibleOrigin}` : ''}${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imageOrigins.join(' ')}`,
  "font-src 'self'",
  `connect-src 'self' https://challenges.cloudflare.com${apiOrigin ? ` ${apiOrigin}` : ''}${plausibleOrigin ? ` ${plausibleOrigin}` : ''}${plausibleApiOrigin ? ` ${plausibleApiOrigin}` : ''}${isDev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Private bearer-token paths must not enter Next's development access logs.
  logging: { incomingRequests: { ignore: [/^\/q(?:\/|$)/, /^\/(?:api\/)?admin(?:\/|$)/] } },
  // Resolve SEO and missing-entity metadata before committing HTTP headers.
  htmlLimitedBots: /.*/,
  // Keep the original request URL available to middleware. NextURL normalizes
  // loopback addresses to localhost, which would otherwise split locale cookies.
  skipMiddlewareUrlNormalize: true,
  images: {
    remotePatterns: imageOrigins.map((origin) => {
      const url = new URL(origin);
      return { protocol: 'https', hostname: url.hostname, port: url.port, pathname: '/**', search: '' };
    }),
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      ...['/q/:path*', '/admin/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      })),
      { source: '/admin/rfqs/:path*', headers: [{ key: 'Content-Security-Policy', value: csp.replace('frame-src https://challenges.cloudflare.com', "frame-src 'self' blob:") }] },
    ];
  },
};

export default withNextIntl(config);
