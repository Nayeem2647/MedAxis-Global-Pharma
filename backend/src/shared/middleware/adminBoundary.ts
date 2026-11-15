import type { RequestHandler } from 'express';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';

export function adminBoundary(env: AppEnv): RequestHandler {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && !env.PUBLIC_ORIGIN.includes(origin))
      return next(AppError.forbidden());
    next();
  };
}
