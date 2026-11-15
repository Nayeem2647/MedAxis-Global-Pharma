import type { RequestHandler } from 'express';
import { redactRoute, type AppLogger } from '../utils/logger.js';

export function requestLogger(logger: AppLogger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
      logger.log(level, 'request completed', {
        request_id: req.requestId,
        method: req.method,
        route: redactRoute(req.originalUrl),
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        admin_id: req.admin?.id,
      });
    });
    res.on('close', () => {
      if (!res.writableFinished) {
        logger.warn('request aborted', {
          request_id: req.requestId,
          method: req.method,
          route: redactRoute(req.originalUrl),
        });
      }
    });
    next();
  };
}
