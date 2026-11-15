import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { AppError } from '../errors/AppError.js';

/** One shared bucket for quick quote and cart: switching endpoints does not reset the quota. */
export function rfqRateLimiter() {
  return rateLimit({
    windowMs: 10 * 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.clientIp || req.ip || 'unknown'),
    handler: (_req, res, next, options) => {
      const until = res.getHeader('Retry-After');
      next(AppError.tooManyRequests(Number(until) || Math.ceil(options.windowMs / 1000)));
    },
  });
}

/** Shared across every magic-link operation, including malformed/unknown tokens. */
export function quotationProbeLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.clientIp || req.ip || 'unknown'),
    handler: (_req, res, next, options) =>
      next(AppError.tooManyRequests(Number(res.getHeader('Retry-After')) || Math.ceil(options.windowMs / 1000))),
  });
}
