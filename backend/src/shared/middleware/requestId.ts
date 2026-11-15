import type { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Server-generated correlation ID (API-Spec.md 1.6).
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const id = uuidv4();
    req.requestId = id;
    res.locals.requestId = id;
    res.setHeader('X-Request-ID', id);
    next();
  };
}
