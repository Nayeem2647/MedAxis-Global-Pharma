import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { PRIVATE_QUOTATION_PATH_PREFIX } from '../../config/constants.js';

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'self'"] } },
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    xPoweredBy: false,
  });
}

export function privateQuotationHeaders(): RequestHandler {
  return (req, res, next) => {
    if (
      req.path.toLowerCase().startsWith('/v1/public/rfq-workflow/') ||
      req.path.toLowerCase().startsWith(PRIVATE_QUOTATION_PATH_PREFIX) ||
      req.originalUrl.toLowerCase().startsWith(PRIVATE_QUOTATION_PATH_PREFIX)
    ) {
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  };
}

export function corsPolicy(allowedOrigins: readonly string[]): RequestHandler {
  const allowlist = new Set(allowedOrigins);
  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      return callback(null, allowlist.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'cf-turnstile-response', 'x-idempotency-key', 'If-Match'],
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
}
