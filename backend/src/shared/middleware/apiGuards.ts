import type { RequestHandler } from 'express';
import {
  API_BASE_PATH,
  ERROR_CODES,
  MULTIPART_ROUTES,
  NON_JSON_RESPONSE_ROUTES,
  type RoutePattern,
} from '../../config/constants.js';
import { AppError } from '../errors/AppError.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT']);

const matches = (routes: readonly RoutePattern[], method: string, path: string): boolean =>
  routes.some((route) => route.method === method && route.pattern.test(path));

export function apiVersionGuard(): RequestHandler {
  return (req, _res, next) => {
    const path = req.path;
    if (path === API_BASE_PATH || path.startsWith(`${API_BASE_PATH}/`)) return next();
    return next(
      AppError.notFound(
        'Missing or unsupported API version. Use the documented /v1 base path.',
        ERROR_CODES.API_VERSION_NOT_SUPPORTED,
      ),
    );
  };
}

export function headerContract(): RequestHandler {
  return (req, _res, next) => {
    const { method, path } = req;

    if (MUTATING_METHODS.has(method)) {
      const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
      if (hasBody) {
        const contentType = (req.headers['content-type'] ?? '').toLowerCase();
        if (matches(MULTIPART_ROUTES, method, path)) {
          if (!contentType.startsWith('multipart/form-data')) {
            return next(AppError.badRequest('Content-Type must be multipart/form-data for this endpoint.'));
          }
        } else if (!/^application\/json(\s*;.*)?$/.test(contentType)) {
          return next(AppError.badRequest('Content-Type must be application/json.'));
        }
      }
    }

    if (!matches(NON_JSON_RESPONSE_ROUTES, method, path) && !acceptsJson(req.headers.accept)) {
      return next(AppError.badRequest('Accept header must allow application/json.'));
    }

    return next();
  };
}

export function acceptsJson(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;
  return accept.split(',').some((range) => {
    const parts = range.trim().toLowerCase().split(';');
    const type = parts[0] ?? '';
    const params = parts.slice(1);
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    if (!(q > 0)) return false;
    return type === '*/*' || type === 'application/*' || type === 'application/json';
  });
}
