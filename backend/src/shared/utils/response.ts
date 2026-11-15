import type { Response } from 'express';
import type { ErrorCode } from '../../config/constants.js';
import type { ErrorDetail } from '../errors/AppError.js';

export interface PaginationMeta {
  page: number;
  limit: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface ResponseMeta {
  timestamp: string;
  request_id: string;
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export function buildMeta(res: Response, extra: Record<string, unknown> = {}): ResponseMeta {
  return {
    timestamp: new Date().toISOString(),
    request_id: String(res.locals.requestId ?? ''),
    ...extra,
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  { status = 200, meta = {} }: { status?: number; meta?: Record<string, unknown> } = {},
): Response {
  return res.status(status).json({
    success: true,
    data,
    meta: buildMeta(res, meta),
  });
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  { page, limit, totalItems }: { page: number; limit: number; totalItems: number },
  { status = 200 }: { status?: number } = {},
): Response {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  return sendSuccess(res, items, {
    status,
    meta: {
      pagination: {
        page,
        limit,
        total_items: totalItems,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    },
  });
}

export function buildErrorBody(
  res: Response,
  { code, message, status, details }: { code: ErrorCode; message: string; status: number; details?: ErrorDetail[] },
): {
  success: false;
  error: { code: ErrorCode; message: string; status: number; details?: ErrorDetail[] };
  meta: ResponseMeta;
} {
  const error: { code: ErrorCode; message: string; status: number; details?: ErrorDetail[] } = {
    code,
    message,
    status,
  };
  if (Array.isArray(details) && details.length > 0) error.details = details;
  return {
    success: false,
    error,
    meta: buildMeta(res),
  };
}
