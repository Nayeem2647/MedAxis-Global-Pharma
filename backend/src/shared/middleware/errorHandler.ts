import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES } from '../../config/constants.js';
import { AppError } from '../errors/AppError.js';
import { redactRoute, type AppLogger } from '../utils/logger.js';
import { buildErrorBody } from '../utils/response.js';

const SAFE_MONGOOSE_MESSAGES: Record<string, string> = {
  required: 'Field is required.',
  enum: 'Value is not an allowed option.',
  minlength: 'Value is too short.',
  maxlength: 'Value is too long.',
  min: 'Value is below the allowed minimum.',
  max: 'Value is above the allowed maximum.',
  unique: 'Value must be unique.',
};

const MONGO_UNAVAILABLE_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoTopologyClosedError',
  'MongoNotConnectedError',
  'MongoWaitQueueTimeoutError',
]);

interface LooseError {
  type?: string;
  name?: string;
  code?: number;
  errors?: Record<string, { kind?: string }>;
}

export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      issue: issue.message,
    }));
    return new AppError({
      status: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'The submission payload failed validation checks.',
      details,
      cause: err,
    });
  }

  const loose = (typeof err === 'object' && err !== null ? err : {}) as LooseError;
  if (loose.name === 'MulterError') {
    return AppError.badRequest('Multipart upload exceeds the permitted size, fields, or file count.');
  }

  if (loose.type === 'entity.parse.failed') {
    return new AppError({
      status: 400,
      code: ERROR_CODES.MALFORMED_JSON,
      message: 'The request body is not valid JSON.',
      cause: err,
    });
  }
  if (loose.type === 'entity.too.large') {
    return new AppError({
      status: 400,
      code: ERROR_CODES.INVALID_REQUEST,
      message: 'The request body exceeds the permitted size.',
      cause: err,
    });
  }
  if (
    loose.type === 'encoding.unsupported' ||
    loose.type === 'charset.unsupported' ||
    loose.type === 'request.aborted'
  ) {
    return new AppError({
      status: 400,
      code: ERROR_CODES.INVALID_REQUEST,
      message: 'The request body could not be read.',
      cause: err,
    });
  }

  if (loose.name === 'ValidationError' && loose.errors) {
    const details = Object.entries(loose.errors).map(([field, e]) => ({
      field,
      issue: (e?.kind && SAFE_MONGOOSE_MESSAGES[e.kind]) ?? 'Value is invalid.',
    }));
    return new AppError({
      status: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'The submission payload failed validation checks.',
      details,
      cause: err,
    });
  }
  if (loose.name === 'CastError') {
    return new AppError({
      status: 400,
      code: ERROR_CODES.INVALID_REQUEST,
      message: 'A supplied identifier or value is malformed.',
      cause: err,
    });
  }

  if (loose.code === 11000 || loose.code === 11001) {
    return new AppError({
      status: 409,
      code: ERROR_CODES.RESOURCE_STATE_CONFLICT,
      message: 'A resource with the same unique value already exists.',
      cause: err,
    });
  }
  if (loose.name && MONGO_UNAVAILABLE_NAMES.has(loose.name)) {
    return new AppError({
      status: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: 'A required service is temporarily unavailable. Please try again shortly.',
      retryAfter: 5,
      cause: err,
    });
  }

  return new AppError({
    status: 500,
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    message: 'An unexpected error occurred. Please try again later.',
    cause: err,
  });
}

export function errorHandler(logger: AppLogger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appError = normalizeError(err);
    const original = appError.cause ?? err;

    const logMeta = {
      request_id: req.requestId,
      method: req.method,
      route: redactRoute(req.originalUrl),
      status: appError.status,
      error_code: appError.code,
      admin_id: req.admin?.id,
    };
    if (appError.status >= 500) {
      logger.error('request failed', {
        ...logMeta,
        exception_type: original instanceof Error ? original.name : 'unknown',
        exception_path:
          original &&
          typeof original === 'object' &&
          'path' in original &&
          typeof original.path === 'string' &&
          /^[A-Za-z_][A-Za-z0-9_.]{0,100}$/.test(original.path)
            ? original.path.replace(/[a-f0-9]{64}/gi, '[redacted]')
            : undefined,
        storage_error_code:
          original && typeof original === 'object' && 'code' in original && typeof original.code === 'number'
            ? original.code
            : undefined,
        err: /\/(?:rfq-workflow|rfq|rfqs|prescriptions|quotation|quotations|fx-rates|customers|audit-logs|stream)(?:\/|$)|\/webhooks\/email-reply/i.test(
          req.path,
        )
          ? new Error('Private business operation failed')
          : original instanceof Error
            ? original
            : new Error(String(original)),
      });
    } else {
      logger.warn('request rejected', logMeta);
    }

    if (res.headersSent) {
      logger.error('response failed after headers were sent; terminating stream', { request_id: req.requestId });
      res.destroy();
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    if (Number.isInteger(appError.retryAfter) && (appError.retryAfter ?? 0) > 0) {
      res.setHeader('Retry-After', String(appError.retryAfter));
    }
    res.status(appError.status).json(
      buildErrorBody(res, {
        code: appError.code,
        message: appError.message,
        status: appError.status,
        details: appError.details,
      }),
    );
  };
}

export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) =>
    next(AppError.notFound('The requested route does not exist in this API version.', ERROR_CODES.ROUTE_NOT_FOUND));
}
